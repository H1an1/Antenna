import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { execSync } from "child_process";
import { createHash } from "crypto";

// ─── Built-in Supabase config (shared backend, zero config) ─────────

const BUILTIN_SUPABASE_URL = "https://bcudjloikmpcqwcptuyd.supabase.co";
const BUILTIN_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJjdWRqbG9pa21wY3F3Y3B0dXlkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0MTg1NDgsImV4cCI6MjA4OTk5NDU0OH0.FaoC3QfpfHP1npNGjRchJAoAp2PdZtQe_WhP-t-GN1o";

// ─── Types ───────────────────────────────────────────────────────────

interface AntennaConfig {
  supabaseUrl?: string;
  supabaseKey?: string;
  defaultRadiusM?: number;
  matchExpiryHours?: number;
  maxMatches?: number;
  autoScanOnLocation?: boolean;
}

interface Profile {
  id?: string;
  device_id: string;
  display_name: string | null;
  line1: string | null;
  line2: string | null;
  line3: string | null;
  visible: boolean;
  last_seen_at?: string;
}

interface MatchResult {
  device_id: string;
  display_name: string | null;
  line1: string | null;
  line2: string | null;
  line3: string | null;
  score: number;
  reason: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────

let _supabaseClient: SupabaseClient | null = null;
let _supabaseUrl: string | null = null;
const _lastScanTime = new Map<string, number>();
const SCAN_DEBOUNCE_MS = 30_000;

function getConfig(api: any): AntennaConfig {
  const cfg = api.config?.plugins?.entries?.antenna?.config ?? {};
  return {
    supabaseUrl: cfg.supabaseUrl || BUILTIN_SUPABASE_URL,
    supabaseKey: cfg.supabaseKey || BUILTIN_SUPABASE_ANON_KEY,
    defaultRadiusM: cfg.defaultRadiusM ?? 500,
    matchExpiryHours: cfg.matchExpiryHours ?? 168,
    maxMatches: cfg.maxMatches ?? 5,
    autoScanOnLocation: cfg.autoScanOnLocation ?? true,
  };
}

function getSupabase(cfg: AntennaConfig): SupabaseClient {
  const url = cfg.supabaseUrl!;
  if (_supabaseClient && _supabaseUrl === url) return _supabaseClient;
  _supabaseClient = createClient(url, cfg.supabaseKey!);
  _supabaseUrl = url;
  return _supabaseClient;
}

function profileSlugCandidate(displayName: string | null | undefined, deviceId: string) {
  const fromName = String(displayName || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 30);
  if (fromName) return fromName;
  return `user-${createHash("sha1").update(deviceId).digest("hex").slice(0, 10)}`;
}

function isRateLimited(deviceId: string): boolean {
  const now = Date.now();
  const last = _lastScanTime.get(deviceId);
  if (last && now - last < SCAN_DEBOUNCE_MS) return true;
  _lastScanTime.set(deviceId, now);
  if (_lastScanTime.size > 1000) {
    for (const [k, v] of _lastScanTime) {
      if (now - v > SCAN_DEBOUNCE_MS * 2) _lastScanTime.delete(k);
    }
  }
  return false;
}

function fuzzyCoords(lat: number, lng: number) {
  return {
    lat: Math.round(lat * 1000) / 1000,
    lng: Math.round(lng * 1000) / 1000,
  };
}

// TODO: Replace with LLM-based matching for better Chinese support
// Kept for potential future server-side pre-filtering
function extractWords(profile: Partial<Profile>): string[] {
  const text = [profile.line1, profile.line2, profile.line3]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return text.split(/[\s,，。.!！?？、;；:：]+/).filter((w) => w.length > 1);
}

function deriveDeviceId(senderId: string, channel: string): string {
  return `${channel}:${senderId}`;
}

/** Wrap result as MCP tool response */
function ok(data: any) {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

async function generateEmbeddingForQuery(cfg: AntennaConfig, text: string): Promise<number[] | null> {
  try {
    const res = await fetch(`${cfg.supabaseUrl}/functions/v1/generate-embedding`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${cfg.supabaseKey}` },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.embedding || null;
  } catch {
    return null;
  }
}

function intentSearchReason(query: string, profile: any): string {
  if (profile.recommendation_reason) return profile.recommendation_reason;
  const tags = Array.isArray(profile.interest_tags) && profile.interest_tags.length
    ? ` Tags: ${profile.interest_tags.slice(0, 3).join(", ")}.`
    : "";
  const score = typeof profile.match_score === "number" ? ` Score: ${profile.match_score.toFixed(2)}.` : "";
  return `Matches the intent "${query}".${tags}${score}`.trim();
}

// ─── Cron helpers ────────────────────────────────────────────────────

const FOLLOW_UP_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const FOLLOW_UP_MAX_DURATION_MS = 2 * 60 * 60 * 1000; // 2 hours
const _activeFollowUps = new Map<string, string>(); // "deviceA→deviceB" → cronJobId

function cronJobId(deviceA: string, deviceB: string): string {
  // Stable, filesystem-safe id
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `antenna-follow-${safe(deviceA)}-${safe(deviceB)}`;
}

/** Send a real-time notification to a user via openclaw agent --deliver */
function notifyUser(
  channel: string,
  userId: string,
  message: string,
  logger: any,
): void {
  try {
    execSync(
      `openclaw agent` +
      ` --message ${JSON.stringify(message)}` +
      ` --deliver` +
      ` --reply-channel ${channel}` +
      ` --reply-to "${userId}"`,
      { timeout: 30_000, encoding: "utf-8" },
    );
    logger.info(`Antenna: notified ${channel}:${userId}`);
  } catch (err: any) {
    logger.warn(`Antenna: notify failed for ${channel}:${userId}: ${err.message}`);
  }
}

function startFollowUpCron(
  deviceId: string,
  targetDeviceId: string,
  channel: string,
  userId: string,
  targetName: string,
  logger: any,
): void {
  const jobId = cronJobId(deviceId, targetDeviceId);
  const key = `${deviceId}→${targetDeviceId}`;

  // Already tracking this pair
  if (_activeFollowUps.has(key)) return;

  const message = [
    `[Antenna follow-up] 检查匹配状态：`,
    `运行 antenna_check_matches（sender_id="${userId}", channel="${channel}"）。`,
    `如果 ${targetName}（${targetDeviceId}）已经 mutual match，`,
    `用 message tool 通知用户：「${targetName} 也接受了你的匹配！」并附上对方的联系方式（如果有）。`,
    `然后运行：openclaw cron remove ${jobId}`,
    `如果还没有 mutual，回复 HEARTBEAT_OK。`,
  ].join(" ");

  try {
    // Create recurring 15-min job
    execSync(
      `openclaw cron add` +
      ` --name "Antenna: 等待 ${targetName} 回应"` +
      ` --every 15m` +
      ` --session isolated` +
      ` --message ${JSON.stringify(message)}` +
      ` --announce` +
      ` --channel ${channel}` +
      ` --to "${userId}"`,
      { timeout: 10_000, encoding: "utf-8" },
    );

    _activeFollowUps.set(key, jobId);
    logger.info(`Antenna: follow-up cron created for ${key} (job: ${jobId})`);

    // Schedule auto-cleanup after 2 hours
    setTimeout(() => {
      try {
        execSync(`openclaw cron remove ${jobId}`, { timeout: 5_000 });
        logger.info(`Antenna: follow-up expired for ${key}`);
      } catch {
        // Job may already be removed
      }
      _activeFollowUps.delete(key);
    }, FOLLOW_UP_MAX_DURATION_MS);
  } catch (err: any) {
    logger.warn(`Antenna: failed to create follow-up cron: ${err.message}`);
  }
}

function stopFollowUpCron(deviceA: string, deviceB: string, logger: any): void {
  const key = `${deviceA}→${deviceB}`;
  const jobId = _activeFollowUps.get(key);
  if (!jobId) return;

  try {
    execSync(`openclaw cron remove ${jobId}`, { timeout: 5_000 });
    logger.info(`Antenna: follow-up stopped for ${key}`);
  } catch {
    // Already removed
  }
  _activeFollowUps.delete(key);
}

// ─── Plugin ──────────────────────────────────────────────────────────

export default function register(api: any) {
  const logger = api.logger;

  // ═══════════════════════════════════════════════════════════════════
  // Tool: antenna_scan
  // ═══════════════════════════════════════════════════════════════════
  api.registerTool({
    name: "antenna_scan",
    description:
      "Scan for nearby people at a given location. Returns raw profile cards of nearby people — the agent should read these cards and decide who to recommend based on its understanding of the user. Use when the user shares their location or asks 'who is nearby'.",
    parameters: {
      type: "object",
      properties: {
        lat: { type: "number", description: "Latitude" },
        lng: { type: "number", description: "Longitude" },
        radius_m: { type: "number", description: "Search radius in meters (default: 500)" },
        sender_id: { type: "string", description: "The sender's user ID (from message context)" },
        channel: { type: "string", description: "The channel name (telegram, whatsapp, etc.)" },
      },
      required: ["lat", "lng", "sender_id", "channel"],
    },
    async execute(_id: string, params: any) {
      const cfg = getConfig(api);
      const supabase = getSupabase(cfg);
      const deviceId = deriveDeviceId(params.sender_id, params.channel);
      const radius = params.radius_m ?? cfg.defaultRadiusM ?? 500;

      if (isRateLimited(deviceId)) {
        return ok({ nearby: [], message: "刚刚才扫描过，稍等一会儿再试。", rate_limited: true });
      }

      const fuzzy = fuzzyCoords(params.lat, params.lng);

      const { error: upsertErr } = await supabase.rpc("upsert_profile_location", {
        p_device_id: deviceId, p_lng: fuzzy.lng, p_lat: fuzzy.lat,
      });
      if (upsertErr) {
        logger.warn("Antenna: upsert_profile_location failed:", upsertErr.message);
      }

      const { data: nearby, error } = await supabase.rpc("nearby_profiles", {
        p_lat: fuzzy.lat, p_lng: fuzzy.lng, p_radius_m: radius,
      });

      if (error) return ok({ error: error.message });

      const others = (nearby ?? []).filter((p: Profile) => p.device_id !== deviceId);

      if (others.length === 0) {
        return ok({ nearby: [], message: `在 ${radius}m 范围内没有发现其他人。试试扩大范围？` });
      }

      // Return raw profile cards — the agent decides who to recommend
      const _refMap: Record<string, string> = {};
      const profiles = others.map((p: Profile, i: number) => {
        const ref = String(i + 1);
        _refMap[ref] = p.device_id;
        return {
          ref: ref,
          name: p.display_name || "匿名",
          personal_description: p.line1,
          looking_for: p.line2,
          conversation_style: p.line3,
          more_information: null,
          profile_slug: null,
          distance_m: p.distance_m ?? p.dist_meters ?? null,
        };
      });
      (api as any)._antennaRefMap = _refMap;
      try { await supabase.rpc("save_scan_refs", { p_owner: deviceId, p_refs: _refMap }); } catch {}

      return ok({
        profiles: profiles,
        total: others.length,
        radius_m: radius,
        instruction: "根据你对用户的了解（记忆、偏好、最近的状态），判断哪些人值得推荐，为每个推荐写一句个性化的匹配理由。",
      });
    },
  });

  // ═══════════════════════════════════════════════════════════════════
  // Tool: antenna_find_people
  // ═══════════════════════════════════════════════════════════════════
  api.registerTool({
    name: "antenna_find_people",
    description:
      "Find 1-3 people by a free-form intent. Returns privacy-safe refs; use ref with antenna_accept if the user wants an intro.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free-form user intent describing the kind of person to find" },
        sender_id: { type: "string", description: "The sender's user ID" },
        channel: { type: "string", description: "The channel name" },
        limit: { type: "number", description: "Maximum profiles to return, 1-3" },
      },
      required: ["query", "sender_id", "channel"],
    },
    async execute(_id: string, params: any) {
      const cfg = getConfig(api);
      const supabase = getSupabase(cfg);
      const deviceId = deriveDeviceId(params.sender_id, params.channel);
      const query = String(params.query || "").trim();
      const limit = Math.min(Math.max(Number(params.limit) || 3, 1), 3);
      if (query.length < 2) return ok({ count: 0, profiles: [], message: "Tell me what kind of person you want to find." });

      const embedding = await generateEmbeddingForQuery(cfg, query);
      const { data, error } = await supabase.rpc("antenna_intent_search_people", {
        p_device_id: deviceId,
        p_query: query,
        p_query_embedding: embedding ? `[${embedding.join(",")}]` : null,
        p_limit: limit,
      });
      if (error) return ok({ error: error.message });

      const _refMap: Record<string, string> = {};
      const profiles = (data || []).map((p: any, i: number) => {
        const ref = String(i + 1);
        _refMap[ref] = p.device_id;
        return {
          ref: ref,
          display_name: p.display_name || "匿名",
          profile_slug: p.profile_slug || null,
          personal_description: p.personal_description || null,
          looking_for: p.looking_for || null,
          conversation_style: p.conversation_style || null,
          more_information: p.more_information || null,
          interest_tags: p.interest_tags || [],
          city: p.city || null,
          match_score: typeof p.match_score === "number" ? Math.round(p.match_score * 1000) / 1000 : null,
          recommendation_reason: intentSearchReason(query, p),
        };
      });
      (api as any)._antennaRefMap = { ...(api as any)._antennaRefMap, ..._refMap };
      if (Object.keys(_refMap).length > 0) {
        try { await supabase.rpc("save_scan_refs", { p_owner: deviceId, p_refs: _refMap }); } catch {}
      }

      return ok({
        count: profiles.length,
        profiles,
        query,
        message: profiles.length
          ? "Intent search results. Recommend only the best fit(s), then use ref with antenna_accept if the user wants an intro."
          : "No relevant active profiles found for that intent right now.",
      });
    },
  });

  // ═══════════════════════════════════════════════════════════════════
  // Tool: antenna_profile
  // ═══════════════════════════════════════════════════════════════════
  api.registerTool({
    name: "antenna_profile",
    description:
      "View or update the user's Antenna profile (name card). The profile has a display name and three lines describing who they are.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["get", "set"], description: "'get' to view profile, 'set' to update it" },
        sender_id: { type: "string", description: "The sender's user ID" },
        channel: { type: "string", description: "The channel name" },
        display_name: { type: "string", description: "Display name" },
        line1: { type: "string", description: "First line (who you are / what you do)" },
        line2: { type: "string", description: "Second line (what you're into)" },
        line3: { type: "string", description: "Third line (what you're looking for)" },
        visible: { type: "boolean", description: "Whether to be visible to others" },
      },
      required: ["action", "sender_id", "channel"],
    },
    async execute(_id: string, params: any) {
      const cfg = getConfig(api);
      const supabase = getSupabase(cfg);
      const deviceId = deriveDeviceId(params.sender_id, params.channel);

      if (params.action === "get") {
        const { data, error } = await supabase.rpc("get_profile", { p_device_id: deviceId });
        if (error || !data) {
          return ok({ exists: false, message: "你还没有名片。告诉我你是谁、做什么、想认识什么人，我帮你创建。" });
        }
        return ok({
          exists: true,
          profile: { display_name: data.display_name,
            line1: data.line1, line2: data.line2, line3: data.line3, visible: data.visible },
        });
      }

      const { data, error } = await supabase.rpc("upsert_profile", {
        p_device_id: deviceId,
        p_display_name: params.display_name ?? null, p_emoji: null,
        p_line1: params.line1 ?? null, p_line2: params.line2 ?? null,
        p_line3: params.line3 ?? null, p_visible: params.visible ?? true,
        p_api_key: null,
      });

      if (error) return ok({ error: error.message });

      let publicUrl = null;
      try {
        const { data: profile } = await supabase.rpc("get_profile", { p_device_id: deviceId });
        let profileSlug = profile?.profile_slug || null;
        if (!profileSlug) {
          const targetSlug = profileSlugCandidate(params.display_name, deviceId);
          const { data: slugResult } = await supabase.rpc("set_profile_slug", { p_device_id: deviceId, p_slug: targetSlug, p_api_key: null });
          if (slugResult?.set) profileSlug = targetSlug;
        }
        if (profileSlug) publicUrl = `https://www.antenna.fyi/p/${profileSlug}`;
      } catch {}

      return ok({
        updated: true,
        profile: { display_name: data.display_name,
          line1: data.line1, line2: data.line2, line3: data.line3, visible: data.visible },
        public_url: publicUrl,
        next_step: "IMPORTANT: Send the public_url to the user — this is their shareable profile link. Then call antenna_bind to generate a GPS link. Do not skip either step.",
      });
    },
  });

  // ═══════════════════════════════════════════════════════════════════
  // Tool: antenna_checkin
  // ═══════════════════════════════════════════════════════════════════
  api.registerTool({
    name: "antenna_checkin",
    description:
      "Check in at a location — update your position so others can find you when they scan. Use when the user says 'I'm at XX' or wants to be discoverable without scanning others. Also works with place names (agent should geocode first).",
    parameters: {
      type: "object",
      properties: {
        lat: { type: "number", description: "Latitude" },
        lng: { type: "number", description: "Longitude" },
        sender_id: { type: "string", description: "The sender's user ID" },
        channel: { type: "string", description: "The channel name" },
        place_name: { type: "string", description: "Optional: name of the place (for confirmation message)" },
      },
      required: ["lat", "lng", "sender_id", "channel"],
    },
    async execute(_id: string, params: any) {
      const cfg = getConfig(api);
      const supabase = getSupabase(cfg);
      const deviceId = deriveDeviceId(params.sender_id, params.channel);
      const fuzzy = fuzzyCoords(params.lat, params.lng);

      // Check if user has a profile first
      const { data: profile } = await supabase.rpc("get_profile", { p_device_id: deviceId });
      if (!profile) {
        return ok({
          checked_in: false,
          message: "你还没有名片，别人看到你也不知道你是谁。先创建一个名片吧（告诉我你是谁、做什么、想认识什么人）。",
        });
      }

      const { error } = await supabase.rpc("upsert_profile_location", {
        p_device_id: deviceId, p_lng: fuzzy.lng, p_lat: fuzzy.lat,
      });

      if (error) return ok({ error: error.message });

      const place = params.place_name ? ` (${params.place_name})` : "";
      return ok({
        checked_in: true,
        message: `已签到${place} 📍 现在附近的人扫描就能看到你了。`,
      });
    },
  });

  // ═══════════════════════════════════════════════════════════════════
  // Tool: antenna_accept
  // ═══════════════════════════════════════════════════════════════════
  api.registerTool({
    name: "antenna_accept",
    description:
      "Accept a match. Optionally share contact info (WeChat, Telegram, phone, etc). If both sides accept, they can exchange contact info through their agents.",
    parameters: {
      type: "object",
      properties: {
        sender_id: { type: "string" },
        channel: { type: "string" },
        ref: { type: "string", description: "Ref number from scan/find results" },
        target_device_id: { type: "string", description: "The device_id of the person to accept" },
        contact_info: { type: "string", description: "Optional contact info to share (e.g. 'WeChat: yi_xxx')" },
      },
      required: ["sender_id", "channel"],
    },
    async execute(_id: string, params: any) {
      const cfg = getConfig(api);
      const supabase = getSupabase(cfg);
      const deviceId = deriveDeviceId(params.sender_id, params.channel);
      let targetId = params.target_device_id;
      if (!targetId && params.ref) {
        targetId = (api as any)._antennaRefMap?.[params.ref];
        if (!targetId) {
          const { data } = await supabase.rpc("resolve_ref", { p_owner: deviceId, p_ref: params.ref });
          targetId = data;
        }
      }
      if (!targetId) return ok({ accepted: false, error: "No target. Provide ref or target_device_id." });

      const { error } = await supabase.rpc("upsert_match", {
        p_device_id_a: deviceId, p_device_id_b: targetId,
        p_status: "accepted", p_contact_info: params.contact_info ?? null,
      });

      if (error) return ok({ error: error.message });

      const { data: myMatches } = await supabase.rpc("get_my_matches", { p_device_id: deviceId });
      const reverse = (myMatches || []).find(
        (m: any) => m.device_id_a === targetId && m.device_id_b === deviceId
      );

      if (reverse) {
        // Mutual match! Stop any follow-up cron for this pair
        stopFollowUpCron(deviceId, targetId, logger);
        stopFollowUpCron(targetId, deviceId, logger);

        return ok({
          accepted: true, mutual: true,
          their_contact: reverse.contact_info_a || null,
          message: reverse.contact_info_a
            ? `双方都接受了！对方分享的联系方式：${reverse.contact_info_a}`
            : "双方都接受了！但对方还没有分享联系方式，等 TA 分享后会通知你。",
        });
      }

      // Not mutual yet — start a follow-up cron (check every 15min for 2h)
      const { data: targetProfile } = await supabase.rpc("get_profile", { p_device_id: targetId });
      const targetName = targetProfile?.display_name || "对方";

      startFollowUpCron(
        deviceId, targetId,
        params.channel, params.sender_id, targetName, logger,
      );

      return ok({
        accepted: true, mutual: false,
        message: "已接受。我会在接下来 2 小时内每 15 分钟检查一次对方是否回应，有消息第一时间告诉你。",
      });
    },
  });

  // ═══════════════════════════════════════════════════════════════════
  // Tool: antenna_check_matches
  // ═══════════════════════════════════════════════════════════════════
  api.registerTool({
    name: "antenna_check_matches",
    description:
      "Check for any mutual matches or new contact info shared by matched people. Use periodically or when the user asks about match status.",
    parameters: {
      type: "object",
      properties: {
        sender_id: { type: "string" },
        channel: { type: "string" },
      },
      required: ["sender_id", "channel"],
    },
    async execute(_id: string, params: any) {
      const cfg = getConfig(api);
      const supabase = getSupabase(cfg);
      const deviceId = deriveDeviceId(params.sender_id, params.channel);

      const { data: allMatches } = await supabase.rpc("get_my_matches", { p_device_id: deviceId });

      if (!allMatches?.length) {
        return ok({ mutual_matches: [], incoming_accepts: [], message: "目前没有进行中的匹配。" });
      }

      // Matches I initiated
      const myMatches = allMatches.filter((m: any) => m.device_id_a === deviceId);
      // Matches where someone else accepted me
      const incomingMatches = allMatches.filter((m: any) => m.device_id_b === deviceId);

      // --- Mutual matches (both sides accepted) ---
      const mutualMatches = [];
      for (const match of myMatches) {
        const reverse = incomingMatches.find(
          (m: any) => m.device_id_a === match.device_id_b
        );
        if (reverse) {
          // Clean up follow-up crons for this mutual pair
          stopFollowUpCron(deviceId, match.device_id_b, logger);
          stopFollowUpCron(match.device_id_b, deviceId, logger);

          const { data: profile } = await supabase.rpc("get_profile", { p_device_id: match.device_id_b });
          mutualMatches.push({
            device_id: match.device_id_b,
            name: profile?.display_name || "匿名",
            line1: profile?.line1, line2: profile?.line2, line3: profile?.line3,
            their_contact: reverse.contact_info_a || null, you_shared: match.contact_info_a || null,
          });
        }
      }

      // --- Incoming accepts (someone accepted me but I haven't accepted them yet) ---
      const incomingAccepts = [];
      for (const match of incomingMatches) {
        const iAccepted = myMatches.find(
          (m: any) => m.device_id_b === match.device_id_a
        );
        if (!iAccepted) {
          // They accepted me but I haven't responded
          const { data: profile } = await supabase.rpc("get_profile", { p_device_id: match.device_id_a });
          incomingAccepts.push({
            device_id: match.device_id_a,
            name: profile?.display_name || "匿名",
            line1: profile?.line1, line2: profile?.line2, line3: profile?.line3,
          });
        }
      }

      const messages = [];
      if (mutualMatches.length > 0) messages.push(`${mutualMatches.length} 个双向匹配！可以交换联系方式了`);
      if (incomingAccepts.length > 0) messages.push(`${incomingAccepts.length} 个人想认识你，等你回应`);
      if (messages.length === 0) messages.push("你接受了一些匹配，但对方还没有回应。耐心等等 ⏳");

      return ok({
        mutual_matches: mutualMatches,
        incoming_accepts: incomingAccepts,
        message: messages.join("；"),
      });
    },
  });

  // ═══════════════════════════════════════════════════════════════════
  // Service: poll for new matches every 10 minutes → notify instantly
  // ═══════════════════════════════════════════════════════════════════
  const _notifiedMatches = new Set<string>(); // "deviceA→deviceB" already notified

  let _pollTimer: ReturnType<typeof setInterval> | null = null;

  api.registerService({
    id: "antenna-match-poller",
    start: () => {
      logger.info("Antenna: match poller started (10 min interval, real-time notify)");
      _pollTimer = setInterval(async () => {
        try {
          const cfg = getConfig(api);
          const supabase = getSupabase(cfg);

          // Get all profiles that have been active in last 24h
          const { data: activeProfiles } = await supabase
            .rpc("nearby_profiles", { p_lat: 0, p_lng: 0, p_radius_m: 999999999 })
            .select("device_id");

          if (!activeProfiles?.length) return;

          for (const profile of activeProfiles) {
            const deviceId = profile.device_id;
            const { data: matches } = await supabase.rpc("get_my_matches", { p_device_id: deviceId });
            if (!matches?.length) continue;

            // Find new matches created in last 10 min
            const newMatches = matches.filter((m: any) => {
              const created = new Date(m.created_at).getTime();
              const key = `${m.device_id_a}→${m.device_id_b}`;
              return Date.now() - created < 10 * 60 * 1000 && !_notifiedMatches.has(key);
            });

            if (newMatches.length === 0) continue;

            // Parse channel and userId from device_id (format: "channel:userId")
            const parts = deviceId.split(":");
            if (parts.length < 2) continue;
            const channel = parts[0];
            const userId = parts.slice(1).join(":");

            // Check for mutual matches
            const myMatches = matches.filter((m: any) => m.device_id_a === deviceId);
            const incomingMatches = matches.filter((m: any) => m.device_id_b === deviceId);

            for (const match of newMatches) {
              const notifyKey = `${match.device_id_a}→${match.device_id_b}`;
              _notifiedMatches.add(notifyKey);

              // Is this a new mutual match?
              if (match.device_id_a === deviceId) {
                const reverse = incomingMatches.find((m: any) => m.device_id_a === match.device_id_b);
                if (reverse) {
                  const { data: theirProfile } = await supabase.rpc("get_profile", { p_device_id: match.device_id_b });
                  const name = theirProfile?.display_name || "对方";
                  const contact = reverse.contact_info_a ? `\n对方的联系方式：${reverse.contact_info_a}` : "";
                  notifyUser(
                    channel, userId,
                    `[Antenna] 🎉 双向匹配成功！${name} 也接受了你！${contact}\n\n用 antenna_check_matches 查看详情。`,
                    logger,
                  );
                  // Clean up follow-up crons
                  stopFollowUpCron(deviceId, match.device_id_b, logger);
                }
              } else if (match.device_id_b === deviceId) {
                // Someone new accepted me
                const { data: theirProfile } = await supabase.rpc("get_profile", { p_device_id: match.device_id_a });
                const name = theirProfile?.display_name || "有人";
                const iAccepted = myMatches.find((m: any) => m.device_id_b === match.device_id_a);
                if (iAccepted) {
                  // I already accepted them → mutual!
                  const contact = match.contact_info_a ? `\n对方的联系方式：${match.contact_info_a}` : "";
                  notifyUser(
                    channel, userId,
                    `[Antenna] 🎉 双向匹配成功！${name} 也接受了你！${contact}\n\n用 antenna_check_matches 查看详情。`,
                    logger,
                  );
                  stopFollowUpCron(deviceId, match.device_id_a, logger);
                } else {
                  // They accepted me but I haven't responded
                  notifyUser(
                    channel, userId,
                    `[Antenna] 📩 ${name} 想认识你！看看 TA 的名片，决定要不要接受？\n\n用 antenna_check_matches 查看详情。`,
                    logger,
                  );
                }
              }
            }

            // Prune old entries from _notifiedMatches (keep last 24h)
            if (_notifiedMatches.size > 5000) {
              _notifiedMatches.clear();
            }
          }
        } catch (err: any) {
          logger.warn("Antenna: match poll error:", err.message);
        }
      }, 10 * 60 * 1000); // 10 minutes
    },
    stop: () => {
      if (_pollTimer) clearInterval(_pollTimer);
      logger.info("Antenna: match poller stopped");
    },
  });

  // ═══════════════════════════════════════════════════════════════════
  // Hook: auto-scan when location is received
  // ═══════════════════════════════════════════════════════════════════
  api.on(
    "before_prompt_build",
    (event: any, ctx: any) => {
      try {
        const cfg = getConfig(api);
        let hint = "";

        // --- Auto-scan on location ---
        if (cfg.autoScanOnLocation === false) return {};

        const lat = ctx?.LocationLat;
        const lon = ctx?.LocationLon;
        if (lat == null || lon == null) return {};

        const isLive = ctx?.LocationIsLive ?? false;
        const locationName = ctx?.LocationName ?? "";
        hint = isLive
          ? `\n\n[Antenna] 📡 收到实时位置 (${lat.toFixed(4)}, ${lon.toFixed(4)})${locationName ? ` — ${locationName}` : ""}。请使用 antenna_scan 工具查看附近有谁。参数：lat=${lat}, lng=${lon}, sender_id 和 channel 从消息上下文获取。`
          : `\n\n[Antenna] 📍 收到位置 (${lat.toFixed(4)}, ${lon.toFixed(4)})${locationName ? ` — ${locationName}` : ""}。请使用 antenna_scan 工具查看附近有谁。参数：lat=${lat}, lng=${lon}, sender_id 和 channel 从消息上下文获取。`;

        return { prependContext: hint };
      } catch {
        return {};
      }
    },
    { priority: 5 }
  );

  logger.info("Antenna plugin loaded 📡");
}
