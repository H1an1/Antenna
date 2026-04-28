import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { execSync } from "child_process";

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
  emoji: string | null;
  visible: boolean;
  last_seen_at?: string;
}

interface MatchResult {
  device_id: string;
  display_name: string | null;
  emoji: string | null;
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
const _knownDeviceIds = new Set<string>();
const _channelContext = new Map<string, string>(); // device_id → chatId (e.g. discord channel ID)

function getConfig(api: any): AntennaConfig {
  const cfg = api.config?.plugins?.entries?.antenna?.config ?? {};
  return {
    supabaseUrl: cfg.supabaseUrl || BUILTIN_SUPABASE_URL,
    supabaseKey: cfg.supabaseKey || BUILTIN_SUPABASE_ANON_KEY,
    defaultRadiusM: cfg.defaultRadiusM ?? 500,
    matchExpiryHours: cfg.matchExpiryHours ?? 24,
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

function deriveDeviceId(senderId: string, channel: string, chatId?: string): string {
  const id = `${channel}:${senderId}`;
  _knownDeviceIds.add(id);
  if (chatId) {
    _channelContext.set(id, chatId);
    // Persist to DB async
    try {
      const cfg = getConfig(api);
      const sb = getSupabase(cfg);
      sb.rpc("upsert_profile", { p_device_id: id, p_last_chat_id: chatId }).then(() => {}).catch(() => {});
    } catch {}
  }
  return id;
}

/** Wrap result as MCP tool response */
function ok(data: any) {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
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

/** Send a real-time notification to a user via openclaw message send */
async function notifyUser(
  channel: string,
  userId: string,
  message: string,
  logger: any,
): Promise<void> {
  const deviceId = `${channel}:${userId}`;
  let chatId = _channelContext.get(deviceId);

  // Fallback: read from DB if not in memory
  if (!chatId) {
    try {
      const cfg = getConfig(api);
      const sb = getSupabase(cfg);
      const { data } = await sb.rpc("get_profile", { p_device_id: deviceId });
      if (data?.last_chat_id) {
        chatId = data.last_chat_id;
        _channelContext.set(deviceId, chatId);
      }
    } catch {}
  }

  try {
    if (chatId) {
      execSync(
        `openclaw message send --channel ${channel} --target ${chatId} -m ${JSON.stringify(message)}`,
        { timeout: 30_000, encoding: "utf-8" },
      );
    } else {
      execSync(
        `openclaw agent` +
        ` --message ${JSON.stringify(message)}` +
        ` --deliver` +
        ` --agent main` +
        ` --to ${channel}:${userId}`,
        { timeout: 30_000, encoding: "utf-8" },
      );
    }
    logger.info(`Antenna: notified ${channel}:${userId} (chat=${chatId || 'deliver'})`);
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
      "Scan for nearby people. If lat/lng are omitted, uses the location from the user's web GPS binding (antenna.fyi/locate). Returns raw profile cards — the agent decides who to recommend.",
    parameters: {
      type: "object",
      properties: {
        lat: { type: "number", description: "Latitude (optional if location was shared via web)" },
        lng: { type: "number", description: "Longitude (optional if location was shared via web)" },
        radius_m: { type: "number", description: "Search radius in meters (default 500, max 1000)" },
        sender_id: { type: "string", description: "The sender's user ID (from message context)" },
        channel: { type: "string", description: "The channel name" },
        chat_id: { type: "string", description: "REQUIRED for notifications. Pass the chat/channel ID from your message context so Antenna can send you match and event notifications." },
      },
      required: ["sender_id", "channel", "chat_id"],
    },
    async execute(_id: string, params: any) {
      const cfg = getConfig(api);
      const supabase = getSupabase(cfg);
      const deviceId = deriveDeviceId(params.sender_id, params.channel, params.chat_id);
      const radius = params.radius_m ?? cfg.defaultRadiusM ?? 500;

      if (isRateLimited(deviceId)) {
        return ok({ profiles: [], message: "刚刚才扫描过，稍等一会儿再试。", rate_limited: true });
      }

      let lat = params.lat;
      let lng = params.lng;

      // If no coordinates, read from profile (web GPS bind)
      if (lat == null || lng == null) {
        const { data: loc } = await supabase.rpc("get_profile_location", { p_device_id: deviceId });
        if (loc?.found) {
          lat = loc.lat;
          lng = loc.lng;
        } else {
          return ok({ profiles: [], message: "还没有位置信息。请先通过链接分享位置，或者发送位置消息。" });
        }
      }

      const fuzzy = fuzzyCoords(lat, lng);

      const { data: nearby, error } = await supabase.rpc("nearby_profiles", {
        p_lat: fuzzy.lat, p_lng: fuzzy.lng, p_radius_m: radius,
      });

      if (error) return ok({ error: error.message });

      const others = (nearby ?? []).filter((p: Profile) => p.device_id !== deviceId);

      if (others.length === 0) {
        // Fallback to global discover
        const { data: globalData } = await supabase.rpc("global_discover", {
          p_device_id: deviceId, p_limit: 1,
        });
        const globalOthers = globalData || [];
        if (globalOthers.length > 0) {
          const gRefMap: Record<string, string> = {};
          const gProfiles = globalOthers.map((p: any, i: number) => {
            const ref = String(i + 1);
            gRefMap[ref] = p.device_id;
            return { ref, emoji: p.emoji || "👤", name: p.display_name || "匿名", line1: p.line1, line2: p.line2, line3: p.line3 };
          });
          (api as any)._antennaRefMap = gRefMap;
          try { await supabase.rpc("save_scan_refs", { p_owner: deviceId, p_refs: gRefMap }); } catch {}
          for (const p of globalOthers) {
            try { await supabase.rpc("log_recommendation", { p_device_id: deviceId, p_recommended_id: p.device_id }); } catch {}
          }
          return ok({
            profiles: gProfiles, count: gProfiles.length, radius_m: radius, global: true,
            message: `附近 ${radius}m 暂时没人。今天的全球推荐——这个人跟你可能聊得来。（每天 1 次）`,
          });
        }
        return ok({ profiles: [], message: `附近暂时没人，今天的全球推荐已经用完了。明天再来！` });
      }

      // Build ref mapping — never expose device_id
      const _refMap: Record<string, string> = {};
      const profiles = others.map((p: Profile, i: number) => {
        const ref = String(i + 1);
        _refMap[ref] = p.device_id;
        return {
          ref,
          emoji: p.emoji || "👤",
          name: p.display_name || "匿名",
          line1: p.line1,
          line2: p.line2,
          line3: p.line3,
          distance_m: p.distance_m ?? p.dist_meters ?? null,
        };
      });

      // Store ref map for accept — memory + DB
      (api as any)._antennaRefMap = _refMap;
      try {
        await supabase.rpc("save_scan_refs", { p_owner: deviceId, p_refs: _refMap });
      } catch { /* best effort */ }

      return ok({
        profiles: profiles,
        count: others.length,
        radius_m: radius,
        instruction: "根据你对用户的了解，判断哪些人值得推荐，用 ref 编号引用。不要显示 device_id。",
      });
    },
  });

  // ═══════════════════════════════════════════════════════════════════
  // Tool: antenna_profile
  // ═══════════════════════════════════════════════════════════════════
  api.registerTool({
    name: "antenna_profile",
    description:
      "View or update the user's Antenna profile (name card). The profile has a display name, emoji, and three lines describing who they are.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["get", "set"], description: "'get' to view profile, 'set' to update it" },
        sender_id: { type: "string", description: "The sender's user ID" },
        channel: { type: "string", description: "The channel name" },
        chat_id: { type: "string", description: "REQUIRED for notifications. Pass the chat/channel ID from your message context so Antenna can send you match and event notifications." },
        display_name: { type: "string", description: "Display name" },
        emoji: { type: "string", description: "Profile emoji" },
        line1: { type: "string", description: "First line (who you are / what you do)" },
        line2: { type: "string", description: "Second line (what you're into)" },
        line3: { type: "string", description: "Third line (what you're looking for)" },
        visible: { type: "boolean", description: "Whether to be visible to others" },
        matching_context: { type: "string", description: "Free-form context for AI matching (interests, goals, etc.)" },
      },
      required: ["action", "sender_id", "channel", "chat_id"],
    },
    async execute(_id: string, params: any) {
      const cfg = getConfig(api);
      const supabase = getSupabase(cfg);
      const deviceId = deriveDeviceId(params.sender_id, params.channel, params.chat_id);

      if (params.action === "get") {
        const { data, error } = await supabase.rpc("get_profile", { p_device_id: deviceId });
        if (error || !data) {
          return ok({ exists: false, message: "你还没有名片。告诉我你的名字、一个 emoji、和三句话介绍自己，我帮你创建。" });
        }
        return ok({
          exists: true,
          profile: { display_name: data.display_name, emoji: data.emoji,
            line1: data.line1, line2: data.line2, line3: data.line3, visible: data.visible },
        });
      }

      const { data, error } = await supabase.rpc("upsert_profile", {
        p_device_id: deviceId,
        p_display_name: params.display_name ?? null, p_emoji: params.emoji ?? null,
        p_line1: params.line1 ?? null, p_line2: params.line2 ?? null,
        p_line3: params.line3 ?? null, p_visible: params.visible ?? true,
        ...(params.matching_context != null ? { p_matching_context: params.matching_context } : {}),
      });

      if (error) return ok({ error: error.message });

      return ok({
        updated: true,
        profile: { display_name: data.display_name, emoji: data.emoji,
          line1: data.line1, line2: data.line2, line3: data.line3, visible: data.visible },
        next_step: "IMPORTANT: Now call antenna_bind to generate a GPS link for the user. Do not skip this.",
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
        chat_id: { type: "string", description: "REQUIRED for notifications. Pass the chat/channel ID from your message context so Antenna can send you match and event notifications." },
        place_name: { type: "string", description: "Optional: name of the place (for confirmation message)" },
      },
      required: ["lat", "lng", "sender_id", "channel", "chat_id"],
    },
    async execute(_id: string, params: any) {
      const cfg = getConfig(api);
      const supabase = getSupabase(cfg);
      const deviceId = deriveDeviceId(params.sender_id, params.channel, params.chat_id);
      const fuzzy = fuzzyCoords(params.lat, params.lng);

      // Check if user has a profile first
      const { data: profile } = await supabase.rpc("get_profile", { p_device_id: deviceId });
      if (!profile) {
        return ok({
          checked_in: false,
          message: "你还没有名片，别人看到你也不知道你是谁。先创建一个名片吧（告诉我你的名字、emoji、三句话介绍自己）。",
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
      "Accept a match. Use 'ref' from scan results (e.g. '1', '2') or target_device_id. Optionally share contact info.",
    parameters: {
      type: "object",
      properties: {
        sender_id: { type: "string" },
        channel: { type: "string" },
        chat_id: { type: "string", description: "REQUIRED for notifications. Pass the chat/channel ID from your message context so Antenna can send you match and event notifications." },
        ref: { type: "string", description: "Ref number from scan results (e.g. '1')" },
        target_device_id: { type: "string", description: "Device ID (use ref instead when possible)" },
        contact_info: { type: "string", description: "Optional contact info to share" },
      },
      required: ["sender_id", "channel", "chat_id"],
    },
    async execute(_id: string, params: any) {
      const cfg = getConfig(api);
      const supabase = getSupabase(cfg);
      const deviceId = deriveDeviceId(params.sender_id, params.channel, params.chat_id);

      // Resolve ref to device_id — try DB first, then memory fallback
      let targetId = params.target_device_id;
      if (!targetId && params.ref) {
        // Try DB
        const { data: resolved } = await supabase.rpc("resolve_ref", { p_owner: deviceId, p_ref: params.ref });
        targetId = resolved || (api as any)._antennaRefMap?.[params.ref];
      }
      if (!targetId) {
        return ok({ error: "No target. Ref may have expired — try scanning again." });
      }

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
  // Tool: antenna_bind
  // ═══════════════════════════════════════════════════════════════════
  api.registerTool({
    name: "antenna_bind",
    description:
      "Generate a GPS binding link. Use purpose='event' + event_code when setting an event's location.",
    parameters: {
      type: "object",
      properties: {
        sender_id: { type: "string", description: "The sender's user ID" },
        channel: { type: "string", description: "The channel name" },
        chat_id: { type: "string", description: "REQUIRED for notifications. Pass the chat/channel ID from your message context so Antenna can send you match and event notifications." },
        purpose: { type: "string", description: "'profile' (default) or 'event'" },
        event_code: { type: "string", description: "Event code (required when purpose=event)" },
      },
      required: ["sender_id", "channel", "chat_id"],
    },
    async execute(_id: string, params: any) {
      const cfg = getConfig(api);
      const supabase = getSupabase(cfg);
      const deviceId = deriveDeviceId(params.sender_id, params.channel, params.chat_id);

      const { data, error } = await supabase.rpc("create_bind_token", {
        p_device_id: deviceId,
        p_purpose: params.purpose || "profile",
        p_event_code: params.event_code || null,
      });
      if (error) return ok({ error: error.message });

      const token = data?.token;
      const baseUrl = "https://www.antenna.fyi";
      return ok({
        token,
        url: `${baseUrl}/locate?token=${token}`,
        purpose: params.purpose || "profile",
        message: params.purpose === "event"
          ? "发送这个链接给活动创建者，在活动地点打开即可设定活动位置。"
          : "发送这个链接给用户，在手机浏览器打开即可共享位置。",
      });
    },
  });

  // ═══════════════════════════════════════════════════════════════════
  // Tool: antenna_discover
  // ═══════════════════════════════════════════════════════════════════
  api.registerTool({
    name: "antenna_discover",
    description:
      "Get today's global recommendation — the person most similar to you worldwide. 1 per day, no repeats.",
    parameters: {
      type: "object",
      properties: {
        sender_id: { type: "string", description: "The sender's user ID" },
        channel: { type: "string", description: "The channel name" },
        chat_id: { type: "string", description: "REQUIRED for notifications. Pass the chat/channel ID from your message context so Antenna can send you match and event notifications." },
      },
      required: ["sender_id", "channel", "chat_id"],
    },
    async execute(_id: string, params: any) {
      const cfg = getConfig(api);
      const supabase = getSupabase(cfg);
      const deviceId = deriveDeviceId(params.sender_id, params.channel, params.chat_id);

      const { data: globalData } = await supabase.rpc("global_discover", {
        p_device_id: deviceId, p_limit: 1,
      });

      const results = globalData || [];
      if (results.length === 0) {
        return ok({ count: 0, profiles: [], message: "今天的全球推荐已用完，或者你已经看过所有人了。等新人加入！" });
      }

      const _refMap: Record<string, string> = {};

      // Get my profile for match reason generation
      const { data: myProfile } = await supabase.rpc("get_profile", { p_device_id: deviceId });
      const myLines = myProfile ? [myProfile.line1, myProfile.line2, myProfile.line3].filter(Boolean).join(". ") : "";

      const profiles = [];
      for (let i = 0; i < results.length; i++) {
        const p = results[i] as any;
        const ref = String(i + 1);
        _refMap[ref] = p.device_id;

        const theirLines = [p.line1, p.line2, p.line3].filter(Boolean).join(". ");
        let match_reason: string | null = null;

        // Generate match reason via Edge Function (no client-side API key needed)
        if (myLines && theirLines) {
          try {
            const supabaseUrl = cfg.supabaseUrl || BUILTIN_SUPABASE_URL;
            const supabaseKey = cfg.supabaseKey || BUILTIN_SUPABASE_ANON_KEY;
            const res = await fetch(`${supabaseUrl}/functions/v1/generate-match-reason`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseKey}` },
              body: JSON.stringify({ my_lines: myLines, their_lines: theirLines }),
            });
            if (res.ok) {
              const data = await res.json();
              match_reason = data?.reason || null;
            }
          } catch { /* best effort */ }
        }

        profiles.push({ ref, emoji: p.emoji || "👤", name: p.display_name || "匿名", line1: p.line1, line2: p.line2, line3: p.line3, match_reason });
      }

      // Persist refs + log recommendation
      (api as any)._antennaRefMap = { ...(api as any)._antennaRefMap, ..._refMap };
      try {
        await supabase.rpc("save_scan_refs", { p_owner: deviceId, p_refs: _refMap });
      } catch { /* best effort */ }
      for (const p of results) {
        await supabase.rpc("log_recommendation", { p_device_id: deviceId, p_recommended_id: p.device_id });
      }

      return ok({
        count: profiles.length, profiles, global: true,
        message: "🌍 今天的全球推荐——这个人跟你可能聊得来。",
      });
    },
  });

  // ═══════════════════════════════════════════════════════════════════
  // Tool: antenna_event_create
  // ═══════════════════════════════════════════════════════════════════
  api.registerTool({
    name: "antenna_event_create",
    description: "Create an event. Returns a shareable link (antenna.fyi/events/CODE) for participants to join.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Event name" },
        sender_id: { type: "string" },
        channel: { type: "string" },
        chat_id: { type: "string", description: "REQUIRED for notifications. Pass the chat/channel ID from your message context so Antenna can send you match and event notifications." },
        lat: { type: "number", description: "Event latitude" },
        lng: { type: "number", description: "Event longitude" },
        starts_at: { type: "string", description: "Start time ISO (required)" },
        ends_at: { type: "string", description: "End time ISO (required)" },
        description: { type: "string", description: "Event description" },
        og_image: { type: "string", description: "OG image URL for social sharing" },
        requires_approval: { type: "boolean", description: "Require host approval to join (default false)" },
        screening_questions: { type: "array", items: { type: "string" }, description: "Screening questions for applicants" },
      },
      required: ["name", "sender_id", "channel", "starts_at", "ends_at", "chat_id"],
    },
    async execute(_id: string, params: any) {
      const cfg = getConfig(api);
      const supabase = getSupabase(cfg);
      const deviceId = deriveDeviceId(params.sender_id, params.channel, params.chat_id);
      const { data, error } = await supabase.rpc("create_event", {
        p_name: params.name,
        p_lat: params.lat ?? null,
        p_lng: params.lng ?? null,
        p_created_by: deviceId,
        p_starts_at: params.starts_at || null,
        p_ends_at: params.ends_at || null,
        p_description: params.description || null,
        p_og_image: params.og_image || null,
        p_requires_approval: params.requires_approval || false,
        p_screening_questions: params.screening_questions || null,
      });
      if (error) return ok({ error: error.message });
      return ok(data);
    },
  });

  // ═════════════════════════════════════════════════════════════════
  // Tool: antenna_event_end
  // ═════════════════════════════════════════════════════════════════
  api.registerTool({
    name: "antenna_event_end",
    description: "End an event. Only the creator can end it.",
    parameters: {
      type: "object",
      properties: {
        code: { type: "string", description: "Event code" },
        sender_id: { type: "string" },
        channel: { type: "string" },
        chat_id: { type: "string", description: "REQUIRED for notifications. Pass the chat/channel ID from your message context so Antenna can send you match and event notifications." },
      },
      required: ["code", "sender_id", "channel", "chat_id"],
    },
    async execute(_id: string, params: any) {
      const cfg = getConfig(api);
      const supabase = getSupabase(cfg);
      const deviceId = deriveDeviceId(params.sender_id, params.channel, params.chat_id);
      const { data, error } = await supabase.rpc("end_event", {
        p_code: params.code,
        p_device_id: deviceId,
      });
      if (error) return ok({ error: error.message });
      return ok(data);
    },
  });

  // ═══════════════════════════════════════════════════════════════════
  // Tool: antenna_event_join
  // ═══════════════════════════════════════════════════════════════════
  api.registerTool({
    name: "antenna_event_join",
    description: "Join an event by its code from the event URL. Auto-checks in if event has started and you're within 1km.",
    parameters: {
      type: "object",
      properties: {
        code: { type: "string", description: "Event code" },
        sender_id: { type: "string" },
        channel: { type: "string" },
        chat_id: { type: "string", description: "REQUIRED for notifications. Pass the chat/channel ID from your message context so Antenna can send you match and event notifications." },
        lat: { type: "number", description: "Latitude (optional, for auto-checkin)" },
        lng: { type: "number", description: "Longitude (optional, for auto-checkin)" },
        application_context: { type: "string", description: "Application context from screening conversation" },
      },
      required: ["code", "sender_id", "channel", "chat_id"],
    },
    async execute(_id: string, params: any) {
      const cfg = getConfig(api);
      const supabase = getSupabase(cfg);
      const deviceId = deriveDeviceId(params.sender_id, params.channel, params.chat_id);

      // Profile gate
      const { data: profile } = await supabase.rpc("get_profile", { p_device_id: deviceId });
      if (!profile) {
        return ok({ joined: false, error: "Create a profile first before joining events" });
      }

      let lat = params.lat;
      let lng = params.lng;

      // Auto-read profile location if not provided
      if (lat == null || lng == null) {
        try {
          const { data: loc } = await supabase.rpc("get_profile_location", { p_device_id: deviceId });
          if (loc?.found) { lat = loc.lat; lng = loc.lng; }
        } catch {}
      }

      const { data, error } = await supabase.rpc("join_event", { p_code: params.code, p_device_id: deviceId, p_lat: lat ?? null, p_lng: lng ?? null, p_application_context: params.application_context || null });
      if (error) return ok({ error: error.message });
      if (!data?.joined) return ok(data);

      // Auto-checkin if event started and we have GPS
      if (lat != null && lng != null) {
        try {
          const { data: evt } = await supabase.rpc("get_event", { p_code: params.code });
          const startsAt = evt?.starts_at ? new Date(evt.starts_at) : null;
          if (startsAt && startsAt <= new Date()) {
            if (evt.lat != null && evt.lng != null) {
              const R = 6371000;
              const dLat = (evt.lat - lat) * Math.PI / 180;
              const dLng = (evt.lng - lng) * Math.PI / 180;
              const a = Math.sin(dLat/2)**2 + Math.cos(lat*Math.PI/180)*Math.cos(evt.lat*Math.PI/180)*Math.sin(dLng/2)**2;
              const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
              if (dist <= 1000) {
                const fuzzy = fuzzyCoords(lat, lng);
                await supabase.rpc("event_checkin", { p_code: params.code, p_device_id: deviceId, p_lat: fuzzy.lat, p_lng: fuzzy.lng });
                data.checked_in = true;
              } else {
                data.checked_in = false;
                data.checkin_reason = "too far";
                data.distance_m = Math.round(dist);
              }
            } else {
              const fuzzy = fuzzyCoords(lat, lng);
              await supabase.rpc("event_checkin", { p_code: params.code, p_device_id: deviceId, p_lat: fuzzy.lat, p_lng: fuzzy.lng });
              data.checked_in = true;
            }
          } else {
            data.checked_in = false;
            data.checkin_reason = "event not started yet";
          }
        } catch {
          data.checked_in = false;
          data.checkin_reason = "checkin failed";
        }
      }

      return ok(data);
    },
  });

  // ═══════════════════════════════════════════════════════════════════
  // Tool: antenna_event_scan
  // ═══════════════════════════════════════════════════════════════════
  api.registerTool({
    name: "antenna_event_scan",
    description: "Scan people in an event. No distance limit.",
    parameters: {
      type: "object",
      properties: {
        code: { type: "string", description: "Event code" },
        sender_id: { type: "string" },
        channel: { type: "string" },
        chat_id: { type: "string", description: "REQUIRED for notifications. Pass the chat/channel ID from your message context so Antenna can send you match and event notifications." },
      },
      required: ["code", "sender_id", "channel", "chat_id"],
    },
    async execute(_id: string, params: any) {
      const cfg = getConfig(api);
      const supabase = getSupabase(cfg);
      const deviceId = deriveDeviceId(params.sender_id, params.channel, params.chat_id);

      const { data, error } = await supabase.rpc("event_participants_list", { p_code: params.code, p_device_id: deviceId });
      if (error) return ok({ error: error.message });

      const others = (data || []) as any[];
      const _refMap: Record<string, string> = {};
      const profiles = others.map((p, i) => {
        const ref = String(i + 1);
        _refMap[ref] = p.device_id;
        return { ref, emoji: p.emoji || "👤", name: p.display_name || "匿名", line1: p.line1, line2: p.line2, line3: p.line3, checked_in: !!p.checked_in, role: p.role || "participant", status: p.status || "active", application_context: p.application_context || null, source: "event" };
      });

      (api as any)._antennaRefMap = { ...(api as any)._antennaRefMap, ..._refMap };
      try { await supabase.rpc("save_scan_refs", { p_owner: deviceId, p_refs: _refMap }); } catch {}

      return ok({ count: profiles.length, profiles, event: true });
    },
  });

  // ═══════════════════════════════════════════════════════════════════
  // Tool: antenna_pass
  // ═══════════════════════════════════════════════════════════════════
  api.registerTool({
    name: "antenna_pass",
    description: "Pass/skip a person. They won't be recommended again.",
    parameters: {
      type: "object",
      properties: {
        sender_id: { type: "string", description: "The sender's user ID" },
        channel: { type: "string", description: "The channel name" },
        chat_id: { type: "string", description: "REQUIRED for notifications. Pass the chat/channel ID from your message context so Antenna can send you match and event notifications." },
        ref: { type: "string", description: "Ref number from scan/discover results" },
        target_device_id: { type: "string", description: "Device ID (use ref instead when possible)" },
      },
      required: ["sender_id", "channel", "chat_id"],
    },
    async execute(_id: string, params: any) {
      const cfg = getConfig(api);
      const supabase = getSupabase(cfg);
      const deviceId = deriveDeviceId(params.sender_id, params.channel, params.chat_id);

      let targetId = params.target_device_id;
      if (!targetId && params.ref) {
        const { data: resolved } = await supabase.rpc("resolve_ref", { p_owner: deviceId, p_ref: params.ref });
        targetId = resolved || (api as any)._antennaRefMap?.[params.ref];
      }
      if (!targetId) {
        return ok({ error: "No target. Ref may have expired — try scanning again." });
      }

      await supabase.rpc("pass_user", { p_device_id: deviceId, p_passed_device_id: targetId });
      return ok({ passed: true, message: "已跳过，下次不会再推荐这个人。" });
    },
  });

  // ═══════════════════════════════════════════════════════════════════
  // Tool: antenna_event_checkin
  // ═════════════════════════════════════════════════════════════════
  api.registerTool({
    name: "antenna_event_checkin",
    description: "Check in at an event — marks you as present at the event location. Optionally updates GPS.",
    parameters: {
      type: "object",
      properties: {
        code: { type: "string", description: "Event code" },
        sender_id: { type: "string" },
        channel: { type: "string" },
        chat_id: { type: "string", description: "REQUIRED for notifications. Pass the chat/channel ID from your message context so Antenna can send you match and event notifications." },
        lat: { type: "number", description: "Latitude (optional)" },
        lng: { type: "number", description: "Longitude (optional)" },
      },
      required: ["code", "sender_id", "channel", "chat_id"],
    },
    async execute(_id: string, params: any) {
      const cfg = getConfig(api);
      const supabase = getSupabase(cfg);
      const deviceId = deriveDeviceId(params.sender_id, params.channel, params.chat_id);
      const fuzzy = (params.lat != null && params.lng != null) ? fuzzyCoords(params.lat, params.lng) : { lat: null, lng: null };
      const { data, error } = await supabase.rpc("event_checkin", {
        p_code: params.code,
        p_device_id: deviceId,
        p_lat: fuzzy.lat,
        p_lng: fuzzy.lng,
      });
      if (error) return ok({ error: error.message });
      return ok(data);
    },
  });

  // Tool: antenna_event_upload_image
  // ═════════════════════════════════════════════════════════════════
  api.registerTool({
    name: "antenna_event_upload_image",
    description: "Upload an image for an event OG preview. Returns a public URL.",
    parameters: {
      type: "object",
      properties: {
        image_base64: { type: "string", description: "Base64-encoded image data" },
        content_type: { type: "string", description: "MIME type (default image/png)" },
        event_code: { type: "string", description: "Event code" },
      },
      required: ["image_base64", "event_code"],
    },
    async execute(_id: string, params: any) {
      const cfg = getConfig(api);
      const supabase = getSupabase(cfg);
      const content_type = params.content_type || "image/png";
      const ext = content_type.split("/")[1] || "png";
      const path = `${params.event_code}.${ext}`;
      const buf = Buffer.from(params.image_base64, "base64");
      const { error } = await supabase.storage.from("event-images").upload(path, buf, { contentType: content_type, upsert: true });
      if (error) return ok({ error: error.message });
      const { data } = supabase.storage.from("event-images").getPublicUrl(path);
      return ok({ url: data.publicUrl });
    },
  });

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
        chat_id: { type: "string", description: "REQUIRED for notifications. Pass the chat/channel ID from your message context so Antenna can send you match and event notifications." },
      },
      required: ["sender_id", "channel", "chat_id"],
    },
    async execute(_id: string, params: any) {
      const cfg = getConfig(api);
      const supabase = getSupabase(cfg);
      const deviceId = deriveDeviceId(params.sender_id, params.channel, params.chat_id);

      const { data: result } = await supabase.rpc("get_my_matches_with_profiles", { p_device_id: deviceId });

      const rawMutual = result?.mutual_matches || [];
      const rawIncoming = result?.incoming_accepts || [];

      if (!rawMutual.length && !rawIncoming.length) {
        return ok({ mutual_matches: [], incoming_accepts: [], message: "目前没有进行中的匹配。" });
      }

      const mutualMatches = rawMutual.map((m: any, i: number) => ({
        ref: String(i + 1),
        _device_id: m.target_id,
        name: m.name || "匿名",
        emoji: m.emoji || "👤",
        line1: m.line1, line2: m.line2, line3: m.line3,
        their_contact: m.their_contact || null,
        you_shared: m.you_shared || null,
      }));

      const incomingAccepts = rawIncoming.map((m: any, i: number) => ({
        ref: String(mutualMatches.length + i + 1),
        _device_id: m.target_id,
        name: m.name || "匿名",
        emoji: m.emoji || "👤",
        line1: m.line1, line2: m.line2, line3: m.line3,
      }));

      // Clean up follow-up crons for mutual matches
      for (const m of mutualMatches) {
        stopFollowUpCron(deviceId, m._device_id, logger);
        stopFollowUpCron(m._device_id, deviceId, logger);
      }

      const messages = [];
      if (mutualMatches.length > 0) messages.push(`${mutualMatches.length} 个双向匹配！可以交换联系方式了`);
      if (incomingAccepts.length > 0) messages.push(`${incomingAccepts.length} 个人想认识你，等你回应`);
      if (messages.length === 0) messages.push("你接受了一些匹配，但对方还没有回应。耐心等等 ⏳");

      // Persist ref map so accept(ref) resolves correctly
      const _refMap: Record<string, string> = {};
      for (const m of mutualMatches) _refMap[m.ref] = m._device_id;
      for (const m of incomingAccepts) _refMap[m.ref] = m._device_id;
      if (deviceId && Object.keys(_refMap).length > 0) {
        try { await supabase.rpc("save_scan_refs", { p_owner: deviceId, p_refs: _refMap }); } catch { /* best effort */ }
      }

      return ok({
        mutual_matches: mutualMatches,
        incoming_accepts: incomingAccepts,
        message: messages.join("；"),
      });
    },
  });

  // ═══════════════════════════════════════════════════════════════════
  // Tool: antenna_event_update
  // ═══════════════════════════════════════════════════════════════════
  api.registerTool({
    name: "antenna_event_update",
    description: "Update event info. Only the creator or co-host can update.",
    parameters: {
      type: "object",
      properties: {
        code: { type: "string", description: "Event code" },
        sender_id: { type: "string" },
        channel: { type: "string" },
        chat_id: { type: "string", description: "REQUIRED for notifications. Pass the chat/channel ID from your message context so Antenna can send you match and event notifications." },
        name: { type: "string", description: "New event name" },
        description: { type: "string", description: "New event description" },
        og_image: { type: "string", description: "New OG image URL" },
        lat: { type: "number", description: "New event latitude" },
        lng: { type: "number", description: "New event longitude" },
        starts_at: { type: "string", description: "New start time ISO" },
        ends_at: { type: "string", description: "New end time ISO" },
      },
      required: ["code", "sender_id", "channel", "chat_id"],
    },
    async execute(_id: string, params: any) {
      const cfg = getConfig(api);
      const supabase = getSupabase(cfg);
      const deviceId = deriveDeviceId(params.sender_id, params.channel, params.chat_id);
      const { data, error } = await supabase.rpc("update_event", {
        p_code: params.code, p_device_id: deviceId,
        p_name: params.name || null, p_description: params.description || null,
        p_og_image: params.og_image || null, p_lat: params.lat ?? null, p_lng: params.lng ?? null,
        p_starts_at: params.starts_at || null, p_ends_at: params.ends_at || null,
      });
      if (error) return ok({ error: error.message });
      return ok(data);
    },
  });

  // ═══════════════════════════════════════════════════════════════════
  // Tool: antenna_event_approve
  // ═══════════════════════════════════════════════════════════════════
  api.registerTool({
    name: "antenna_event_approve",
    description: "Approve a pending participant. Only the creator or co-host can approve.",
    parameters: {
      type: "object",
      properties: {
        code: { type: "string", description: "Event code" },
        sender_id: { type: "string" },
        channel: { type: "string" },
        chat_id: { type: "string", description: "REQUIRED for notifications. Pass the chat/channel ID from your message context so Antenna can send you match and event notifications." },
        ref: { type: "string", description: "Ref number of the participant to approve" },
      },
      required: ["code", "sender_id", "channel", "ref", "chat_id"],
    },
    async execute(_id: string, params: any) {
      const cfg = getConfig(api);
      const supabase = getSupabase(cfg);
      const deviceId = deriveDeviceId(params.sender_id, params.channel, params.chat_id);
      const { data, error } = await supabase.rpc("approve_participant", {
        p_code: params.code, p_device_id: deviceId, p_target_ref: params.ref,
      });
      if (error) return ok({ error: error.message });
      return ok(data);
    },
  });

  // ═══════════════════════════════════════════════════════════════════
  // Tool: antenna_event_reject
  // ═══════════════════════════════════════════════════════════════════
  api.registerTool({
    name: "antenna_event_reject",
    description: "Reject a pending participant. Only the creator or co-host can reject.",
    parameters: {
      type: "object",
      properties: {
        code: { type: "string", description: "Event code" },
        sender_id: { type: "string" },
        channel: { type: "string" },
        chat_id: { type: "string", description: "REQUIRED for notifications. Pass the chat/channel ID from your message context so Antenna can send you match and event notifications." },
        ref: { type: "string", description: "Ref number of the participant to reject" },
      },
      required: ["code", "sender_id", "channel", "ref", "chat_id"],
    },
    async execute(_id: string, params: any) {
      const cfg = getConfig(api);
      const supabase = getSupabase(cfg);
      const deviceId = deriveDeviceId(params.sender_id, params.channel, params.chat_id);
      const { data, error } = await supabase.rpc("reject_participant", {
        p_code: params.code, p_device_id: deviceId, p_target_ref: params.ref,
      });
      if (error) return ok({ error: error.message });
      return ok(data);
    },
  });

  // ═══════════════════════════════════════════════════════════════════
  // Tool: antenna_event_add_host
  // ═══════════════════════════════════════════════════════════════════
  api.registerTool({
    name: "antenna_event_add_host",
    description: "Add a co-host to an event. Only the creator can add co-hosts.",
    parameters: {
      type: "object",
      properties: {
        code: { type: "string", description: "Event code" },
        sender_id: { type: "string" },
        channel: { type: "string" },
        chat_id: { type: "string", description: "REQUIRED for notifications. Pass the chat/channel ID from your message context so Antenna can send you match and event notifications." },
        ref: { type: "string", description: "Ref number of the participant to make co-host" },
      },
      required: ["code", "sender_id", "channel", "ref", "chat_id"],
    },
    async execute(_id: string, params: any) {
      const cfg = getConfig(api);
      const supabase = getSupabase(cfg);
      const deviceId = deriveDeviceId(params.sender_id, params.channel, params.chat_id);
      const { data, error } = await supabase.rpc("add_cohost", {
        p_code: params.code, p_device_id: deviceId, p_target_ref: params.ref,
      });
      if (error) return ok({ error: error.message });
      return ok(data);
    },
  });

  // ═══════════════════════════════════════════════════════════════════
  // Tool: antenna_event_message
  // ═══════════════════════════════════════════════════════════════════
  api.registerTool({
    name: "antenna_event_message",
    description: "Send a message to event participants. Only creator or co-host can send. Omit ref to broadcast to all participants.",
    parameters: {
      type: "object",
      properties: {
        code: { type: "string", description: "Event code" },
        sender_id: { type: "string" },
        channel: { type: "string" },
        chat_id: { type: "string", description: "REQUIRED for notifications. Pass the chat/channel ID from your message context so Antenna can send you match and event notifications." },
        message: { type: "string", description: "Message to send to participants" },
        ref: { type: "string", description: "Ref number of specific participant (omit to broadcast to all)" },
      },
      required: ["code", "sender_id", "channel", "message", "chat_id"],
    },
    async execute(_id: string, params: any) {
      const cfg = getConfig(api);
      const supabase = getSupabase(cfg);
      const deviceId = deriveDeviceId(params.sender_id, params.channel, params.chat_id);
      const { data, error } = await supabase.rpc("send_event_message", {
        p_code: params.code,
        p_device_id: deviceId,
        p_message: params.message,
        ...(params.ref ? { p_target_ref: params.ref } : {}),
      });
      if (error) return ok({ error: error.message });
      return ok(data);
    },
  });

  // ═══════════════════════════════════════════════════════════════════
  const _notifiedMatches = new Set<string>(); // "deviceA→deviceB" already notified

  let _pollTimer: ReturnType<typeof setInterval> | null = null;
  let _realtimeChannel: any = null;

  api.registerService({
    id: "antenna-match-poller",
    start: () => {
      logger.info("Antenna: match poller started (10 min interval + Supabase Realtime)");

      // ── Supabase Realtime: instant match notifications ──────────
      try {
        const rtCfg = getConfig(api);
        const rtSupabase = getSupabase(rtCfg);
        _realtimeChannel = rtSupabase
          .channel('antenna-match-notify')
          .on('postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'matches' },
            async (payload: any) => {
              try {
                const targetDeviceId = payload.new?.device_id_b;
                if (!targetDeviceId) return;

                const key = `${payload.new.device_id_a}→${targetDeviceId}`;
                if (_notifiedMatches.has(key)) return;

                const parts = targetDeviceId.split(":");
                if (parts.length < 2) return;
                const channel = parts[0];
                const userId = parts.slice(1).join(":");

                const innerCfg = getConfig(api);
                const innerSb = getSupabase(innerCfg);

                const { data: theirProfile } = await innerSb.rpc("get_profile", { p_device_id: payload.new.device_id_a });
                const name = theirProfile?.display_name || "有人";
                const emoji = theirProfile?.emoji || "👤";

                // Check if mutual
                const { data: matches } = await innerSb.rpc("get_my_matches", { p_device_id: targetDeviceId });
                const myAccept = (matches || []).find(
                  (m: any) => m.device_id_a === targetDeviceId && m.device_id_b === payload.new.device_id_a
                );

                if (myAccept) {
                  const contact = payload.new.contact_info_a ? `\n对方的联系方式：${payload.new.contact_info_a}` : "";
                  notifyUser(channel, userId,
                    `[Antenna] 🎉 双向匹配！${emoji} ${name} 也接受了你！${contact}\n\n用 antenna_check_matches 查看详情。`,
                    logger);
                  _notifiedMatches.add(key);
                  stopFollowUpCron(targetDeviceId, payload.new.device_id_a, logger);
                } else {
                  notifyUser(channel, userId,
                    `[Antenna] 📩 ${emoji} ${name} 想认识你！看看 TA 的名片，决定要不要接受？\n\n用 antenna_check_matches 查看详情。`,
                    logger);
                  _notifiedMatches.add(key);
                }
              } catch (err: any) {
                logger.warn("Antenna: realtime match handler error:", err.message);
              }
            }
          )
          .subscribe((status: string) => {
            logger.info(`Antenna: realtime subscription status: ${status}`);
          });
      } catch (err: any) {
        logger.warn("Antenna: failed to start realtime subscription, falling back to poll only:", err.message);
      }

      // ── Supabase Realtime: event participant notifications ──────
      try {
        const epCfg = getConfig(api);
        const epSb = getSupabase(epCfg);
        epSb
          .channel('antenna-event-notify')
          .on('postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'event_participants' },
            async (payload: any) => {
              try {
                // New participant joined (pending) → notify creator
                if (payload.new?.status !== 'pending') return;
                const eventId = payload.new?.event_id;
                const applicantDeviceId = payload.new?.device_id;
                if (!eventId || !applicantDeviceId) return;

                // Get event info via RPC
                const { data: event } = await epSb.rpc('get_event_by_id', { p_event_id: eventId });
                if (!event?.found || !event?.notify_on_join || !event?.created_by) return;

                // Get applicant profile
                const { data: applicant } = await epSb.rpc('get_profile', { p_device_id: applicantDeviceId });
                const aName = applicant?.display_name || '某人';
                const aEmoji = applicant?.emoji || '👤';

                const parts = event.created_by.split(':');
                if (parts.length < 2) return;
                notifyUser(parts[0], parts.slice(1).join(':'),
                  `[Antenna] 📩 ${aEmoji} ${aName} 申请加入你的活动「${event.name}」\n\n用 antenna_event_scan --code ${event.code} 查看申请者名片并审批。`,
                  logger);
              } catch (err: any) {
                logger.warn('Antenna: event participant INSERT handler error:', err.message);
              }
            }
          )
          .on('postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'event_participants' },
            async (payload: any) => {
              try {
                // Status changed → notify the participant
                const oldStatus = payload.old?.status;
                const newStatus = payload.new?.status;
                if (!oldStatus || oldStatus === newStatus) return;
                if (newStatus !== 'active' && newStatus !== 'rejected') return;

                const participantDeviceId = payload.new?.device_id;
                const eventId = payload.new?.event_id;
                if (!participantDeviceId || !eventId) return;

                const { data: event } = await epSb.rpc('get_event_by_id', { p_event_id: eventId });
                const eventName = event?.name || '活动';

                const parts = participantDeviceId.split(':');
                if (parts.length < 2) return;

                if (newStatus === 'active') {
                  notifyUser(parts[0], parts.slice(1).join(':'),
                    `[Antenna] ✅ 你的申请已通过！欢迎加入「${eventName}」\n\n用 antenna_event_scan --code ${event?.code} 查看其他参与者。`,
                    logger);
                } else if (newStatus === 'rejected') {
                  notifyUser(parts[0], parts.slice(1).join(':'),
                    `[Antenna] ❌ 你的申请未通过「${eventName}」的审核。`,
                    logger);
                }
              } catch (err: any) {
                logger.warn('Antenna: event participant UPDATE handler error:', err.message);
              }
            }
          )
          .subscribe((status: string) => {
            logger.info(`Antenna: event participant realtime status: ${status}`);
          });
      } catch (err: any) {
        logger.warn('Antenna: failed to start event participant realtime:', err.message);
      }

      // ── Poll fallback: catch anything Realtime missed ───────────
      _pollTimer = setInterval(async () => {
        try {
          const cfg = getConfig(api);
          const supabase = getSupabase(cfg);

          // Get all profiles with valid notification targets
          const { data: activeProfiles } = await supabase
            .rpc("get_notification_targets", { p_since: "7 days" });

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
              if (_notifiedMatches.has(notifyKey)) continue;

              // Is this a new mutual match?
              if (match.device_id_a === deviceId) {
                const reverse = incomingMatches.find((m: any) => m.device_id_a === match.device_id_b);
                if (reverse) {
                  const { data: theirProfile } = await supabase.rpc("get_profile", { p_device_id: match.device_id_b });
                  const name = theirProfile?.display_name || "对方";
                  const emoji = theirProfile?.emoji || "👤";
                  const contact = reverse.contact_info_a ? `\n对方的联系方式：${reverse.contact_info_a}` : "";
                  notifyUser(
                    channel, userId,
                    `[Antenna] 🎉 双向匹配成功！${emoji} ${name} 也接受了你！${contact}\n\n用 antenna_check_matches 查看详情。`,
                    logger,
                  );
                  _notifiedMatches.add(notifyKey);
                  stopFollowUpCron(deviceId, match.device_id_b, logger);
                }
              } else if (match.device_id_b === deviceId) {
                // Someone new accepted me
                const { data: theirProfile } = await supabase.rpc("get_profile", { p_device_id: match.device_id_a });
                const name = theirProfile?.display_name || "有人";
                const emoji = theirProfile?.emoji || "👤";
                const iAccepted = myMatches.find((m: any) => m.device_id_b === match.device_id_a);
                if (iAccepted) {
                  const contact = match.contact_info_a ? `\n对方的联系方式：${match.contact_info_a}` : "";
                  notifyUser(
                    channel, userId,
                    `[Antenna] 🎉 双向匹配成功！${emoji} ${name} 也接受了你！${contact}\n\n用 antenna_check_matches 查看详情。`,
                    logger,
                  );
                  _notifiedMatches.add(notifyKey);
                  stopFollowUpCron(deviceId, match.device_id_a, logger);
                } else {
                  notifyUser(
                    channel, userId,
                    `[Antenna] 📩 ${emoji} ${name} 想认识你！看看 TA 的名片，决定要不要接受？\n\n用 antenna_check_matches 查看详情。`,
                    logger,
                  );
                  _notifiedMatches.add(notifyKey);
                }
              }
            }

            // Prune old entries from _notifiedMatches (keep last 24h)
            if (_notifiedMatches.size > 5000) {
              _notifiedMatches.clear();
            }
          }

          // ── Event approval polling (use notification targets, not _knownDeviceIds) ──
          for (const profile of activeProfiles) {
            const deviceId = profile.device_id;
            try {
              const { data: events } = await supabase.rpc("get_my_event_updates", { p_device_id: deviceId });
              if (!events?.length) continue;
              const parts = deviceId.split(":");
              if (parts.length < 2) continue;
              const channel = parts[0];
              const userId = parts.slice(1).join(":");
              for (const ev of events) {
                const key = `event:${deviceId}:${ev.event_id}:${ev.status}`;
                if (_notifiedMatches.has(key)) continue;
                if (ev.status === "active" && ev.role !== "creator" && ev.role !== "cohost" && ev.requires_approval) {
                  notifyUser(channel, userId,
                    `[Antenna] ✅ 你的申请已通过！欢迎加入「${ev.event_name}」`,
                    logger,
                  );
                  _notifiedMatches.add(key);
                } else if (ev.status === "rejected") {
                  notifyUser(channel, userId,
                    `[Antenna] ❌ 你的申请未通过「${ev.event_name}」`,
                    logger,
                  );
                  _notifiedMatches.add(key);
                }
              }
            } catch { /* silent */ }
          }

          // ── Event messages polling ──
          for (const profile of activeProfiles) {
            const deviceId = profile.device_id;
            try {
              const { data: msgs } = await supabase.rpc("get_my_event_messages", { p_device_id: deviceId });
              if (!msgs?.length) continue;
              const parts = deviceId.split(":");
              if (parts.length < 2) continue;
              const channel = parts[0];
              const userId = parts.slice(1).join(":");
              for (const msg of msgs) {
                const key = `evtmsg:${msg.event_id}:${msg.created_at}`;
                if (_notifiedMatches.has(key)) continue;
                const role = msg.sender_role === 'creator' ? '组织者' : '协办';
                notifyUser(channel, userId,
                  `[Antenna] 📢 来自「${msg.event_name}」${role} ${msg.sender_emoji || ''} ${msg.sender_name}: ${msg.message}`,
                  logger,
                );
                _notifiedMatches.add(key);
              }
            } catch { /* silent */ }
          }
        } catch (err: any) {
          logger.warn("Antenna: match poll error:", err.message);
        }
      }, 10 * 60 * 1000); // 10 minutes
    },
    stop: () => {
      if (_pollTimer) clearInterval(_pollTimer);
      if (_realtimeChannel) {
        try {
          const rtCfg = getConfig(api);
          const rtSupabase = getSupabase(rtCfg);
          rtSupabase.removeChannel(_realtimeChannel);
        } catch { /* best effort */ }
        _realtimeChannel = null;
      }
      logger.info("Antenna: match poller + realtime stopped");
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

        // --- Track chat context for notifications ---
        const senderId = ctx?.SenderId || ctx?.senderId;
        const ch = ctx?.Channel || ctx?.channel;
        const chatId = ctx?.ChatId || ctx?.chatId || ctx?.chat_id;
        if (senderId && ch && chatId) {
          const deviceId = `${ch}:${senderId}`;
          _channelContext.set(deviceId, chatId);
          _knownDeviceIds.add(deviceId);
          // Persist to DB
          try {
            const cfg = getConfig(api);
            const sb = getSupabase(cfg);
            sb.rpc("upsert_profile", { p_device_id: deviceId, p_last_chat_id: chatId }).then(() => {}).catch(() => {});
          } catch {}
        }

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
