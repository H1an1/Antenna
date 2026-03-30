import { createClient, SupabaseClient } from "@supabase/supabase-js";

// ─── Types ───────────────────────────────────────────────────────────

interface AntennaConfig {
  supabaseUrl: string;
  supabaseKey: string;
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

// Cached Supabase client (singleton per config)
let _supabaseClient: SupabaseClient | null = null;
let _supabaseUrl: string | null = null;

// Rate limiting: track last scan time per device_id
const _lastScanTime = new Map<string, number>();
const SCAN_DEBOUNCE_MS = 30_000; // 30 seconds

function getConfig(api: any): AntennaConfig {
  const cfg = api.config?.plugins?.entries?.antenna?.config;
  if (!cfg?.supabaseUrl || !cfg?.supabaseKey) {
    throw new Error(
      "Antenna plugin not configured. Set plugins.entries.antenna.config.supabaseUrl and supabaseKey in openclaw.json"
    );
  }
  return cfg;
}

function getSupabase(cfg: AntennaConfig): SupabaseClient {
  // Reuse client if URL hasn't changed
  if (_supabaseClient && _supabaseUrl === cfg.supabaseUrl) {
    return _supabaseClient;
  }
  _supabaseClient = createClient(cfg.supabaseUrl, cfg.supabaseKey);
  _supabaseUrl = cfg.supabaseUrl;
  return _supabaseClient;
}

function isRateLimited(deviceId: string): boolean {
  const now = Date.now();
  const last = _lastScanTime.get(deviceId);
  if (last && now - last < SCAN_DEBOUNCE_MS) {
    return true;
  }
  _lastScanTime.set(deviceId, now);
  // Clean up old entries periodically
  if (_lastScanTime.size > 1000) {
    for (const [k, v] of _lastScanTime) {
      if (now - v > SCAN_DEBOUNCE_MS * 2) _lastScanTime.delete(k);
    }
  }
  return false;
}

/**
 * Extract keywords from profile lines.
 * TODO: Replace with LLM-based matching for better Chinese support.
 * Current approach: split on punctuation/whitespace, keep tokens > 1 char.
 * Works OK for English and simple Chinese phrases, but can't handle
 * semantic similarity (e.g. "跑步" vs "慢跑").
 */
function extractWords(profile: Partial<Profile>): string[] {
  const text = [profile.line1, profile.line2, profile.line3]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return text
    .split(/[\s,，。.!！?？、;；:：]+/)
    .filter((w) => w.length > 1);
}

/**
 * Generate a stable device_id from senderId + channel.
 * This maps a chat user to a unique Antenna identity.
 */
function deriveDeviceId(senderId: string, channel: string): string {
  return `${channel}:${senderId}`;
}

// ─── Plugin ──────────────────────────────────────────────────────────

export default function register(api: any) {
  const logger = api.logger;

  // ═══════════════════════════════════════════════════════════════════
  // Tool: antenna_scan — scan nearby people from a location
  // ═══════════════════════════════════════════════════════════════════
  api.registerTool({
    name: "antenna_scan",
    description:
      "Scan for nearby people at a given location. Returns matched profiles with reasons. Use when the user shares their location or asks 'who is nearby'.",
    parameters: {
      type: "object",
      properties: {
        lat: { type: "number", description: "Latitude" },
        lng: { type: "number", description: "Longitude" },
        radius_m: {
          type: "number",
          description: "Search radius in meters (default: 500)",
        },
        sender_id: {
          type: "string",
          description: "The sender's user ID (from message context)",
        },
        channel: {
          type: "string",
          description: "The channel name (telegram, whatsapp, etc.)",
        },
      },
      required: ["lat", "lng", "sender_id", "channel"],
    },
    handler: async (params: {
      lat: number;
      lng: number;
      radius_m?: number;
      sender_id: string;
      channel: string;
    }) => {
      const cfg = getConfig(api);
      const supabase = getSupabase(cfg);
      const deviceId = deriveDeviceId(params.sender_id, params.channel);
      const radius = params.radius_m ?? cfg.defaultRadiusM ?? 500;
      const maxMatches = cfg.maxMatches ?? 5;

      // Rate limit: skip if scanned less than 30s ago
      if (isRateLimited(deviceId)) {
        return {
          matches: [],
          message: "刚刚才扫描过，稍等一会儿再试。",
          rate_limited: true,
        };
      }

      // Update my location using PostGIS function
      await supabase.rpc("upsert_profile_location", {
        p_device_id: deviceId,
        p_lng: params.lng,
        p_lat: params.lat,
      }).then(async (res) => {
        // Fallback: if RPC doesn't exist, use raw upsert with WKT
        if (res.error) {
          await supabase
            .from("profiles")
            .upsert(
              {
                device_id: deviceId,
                last_seen_at: new Date().toISOString(),
                visible: true,
              },
              { onConflict: "device_id" }
            );
          // Update location separately with raw SQL via postgrest
          await supabase.rpc("update_location", {
            p_device_id: deviceId,
            p_lng: params.lng,
            p_lat: params.lat,
          }).catch(() => {
            // If this also fails, log but continue — location won't be updated
            logger.warn("Antenna: failed to update location for", deviceId);
          });
        }
      });

      // Query nearby
      const { data: nearby, error } = await supabase.rpc("nearby_profiles", {
        p_lat: params.lat,
        p_lng: params.lng,
        p_radius_m: radius,
      });

      if (error) {
        return { error: error.message };
      }

      const others = (nearby ?? []).filter(
        (p: Profile) => p.device_id !== deviceId
      );

      if (others.length === 0) {
        return {
          matches: [],
          message: `在 ${radius}m 范围内没有发现其他人。试试扩大范围？`,
        };
      }

      // Get my profile for matching
      const { data: myProfile } = await supabase
        .from("profiles")
        .select("*")
        .eq("device_id", deviceId)
        .single();

      // Score matches
      const myWords = myProfile ? extractWords(myProfile) : [];
      const scored: MatchResult[] = others.map((p: Profile) => {
        const theirWords = extractWords(p);
        const overlap = myWords.filter((w: string) => theirWords.includes(w));
        const score =
          myWords.length > 0
            ? Math.min(overlap.length / myWords.length, 1)
            : 0;
        const reason =
          overlap.length > 0
            ? `你们都提到了 ${overlap.slice(0, 3).join("、")}——可能聊得来`
            : `${p.display_name || p.emoji || "TA"} 就在附近`;
        return {
          device_id: p.device_id,
          display_name: p.display_name,
          emoji: p.emoji,
          line1: p.line1,
          line2: p.line2,
          line3: p.line3,
          score,
          reason,
        };
      });

      scored.sort((a, b) => b.score - a.score);
      const topMatches = scored.slice(0, maxMatches);

      // Store matches
      const expiryHours = cfg.matchExpiryHours ?? 24;
      const matchRows = topMatches.map((m) => ({
        device_id_a: deviceId,
        device_id_b: m.device_id,
        reason: m.reason,
        score: m.score,
        status: "pending",
        expires_at: new Date(
          Date.now() + expiryHours * 60 * 60 * 1000
        ).toISOString(),
      }));

      if (matchRows.length > 0) {
        await supabase.from("matches").upsert(matchRows, {
          onConflict: "device_id_a,device_id_b",
        });
      }

      return {
        matches: topMatches.map((m) => ({
          emoji: m.emoji || "👤",
          name: m.display_name || "匿名",
          line1: m.line1,
          line2: m.line2,
          line3: m.line3,
          score: m.score,
          reason: m.reason,
        })),
        total_nearby: others.length,
        radius_m: radius,
      };
    },
  });

  // ═══════════════════════════════════════════════════════════════════
  // Tool: antenna_profile — view or update my profile (name card)
  // ═══════════════════════════════════════════════════════════════════
  api.registerTool({
    name: "antenna_profile",
    description:
      "View or update the user's Antenna profile (name card). The profile has a display name, emoji, and three lines describing who they are.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["get", "set"],
          description: "'get' to view profile, 'set' to update it",
        },
        sender_id: { type: "string", description: "The sender's user ID" },
        channel: { type: "string", description: "The channel name" },
        display_name: { type: "string", description: "Display name" },
        emoji: { type: "string", description: "Profile emoji" },
        line1: {
          type: "string",
          description: "First line (who you are / what you do)",
        },
        line2: {
          type: "string",
          description: "Second line (what you're into)",
        },
        line3: {
          type: "string",
          description: "Third line (what you're looking for)",
        },
        visible: {
          type: "boolean",
          description: "Whether to be visible to others",
        },
      },
      required: ["action", "sender_id", "channel"],
    },
    handler: async (params: {
      action: string;
      sender_id: string;
      channel: string;
      display_name?: string;
      emoji?: string;
      line1?: string;
      line2?: string;
      line3?: string;
      visible?: boolean;
    }) => {
      const cfg = getConfig(api);
      const supabase = getSupabase(cfg);
      const deviceId = deriveDeviceId(params.sender_id, params.channel);

      if (params.action === "get") {
        const { data, error } = await supabase
          .from("profiles")
          .select("*")
          .eq("device_id", deviceId)
          .single();

        if (error || !data) {
          return {
            exists: false,
            message:
              "你还没有名片。告诉我你的名字、一个 emoji、和三句话介绍自己，我帮你创建。",
          };
        }

        return {
          exists: true,
          profile: {
            display_name: data.display_name,
            emoji: data.emoji,
            line1: data.line1,
            line2: data.line2,
            line3: data.line3,
            visible: data.visible,
          },
        };
      }

      // action === 'set'
      const updates: Record<string, any> = {
        device_id: deviceId,
        last_seen_at: new Date().toISOString(),
      };
      if (params.display_name !== undefined)
        updates.display_name = params.display_name;
      if (params.emoji !== undefined) updates.emoji = params.emoji;
      if (params.line1 !== undefined) updates.line1 = params.line1;
      if (params.line2 !== undefined) updates.line2 = params.line2;
      if (params.line3 !== undefined) updates.line3 = params.line3;
      if (params.visible !== undefined) updates.visible = params.visible;

      const { data, error } = await supabase
        .from("profiles")
        .upsert(updates, { onConflict: "device_id" })
        .select()
        .single();

      if (error) {
        return { error: error.message };
      }

      return {
        updated: true,
        profile: {
          display_name: data.display_name,
          emoji: data.emoji,
          line1: data.line1,
          line2: data.line2,
          line3: data.line3,
          visible: data.visible,
        },
      };
    },
  });

  // ═══════════════════════════════════════════════════════════════════
  // Tool: antenna_accept — accept a match (send greeting)
  // ═══════════════════════════════════════════════════════════════════
  api.registerTool({
    name: "antenna_accept",
    description:
      "Accept a match — marks the match as accepted. If both sides accept, the agent should facilitate introductions.",
    parameters: {
      type: "object",
      properties: {
        sender_id: { type: "string" },
        channel: { type: "string" },
        target_device_id: {
          type: "string",
          description: "The device_id of the person to accept",
        },
      },
      required: ["sender_id", "channel", "target_device_id"],
    },
    handler: async (params: {
      sender_id: string;
      channel: string;
      target_device_id: string;
    }) => {
      const cfg = getConfig(api);
      const supabase = getSupabase(cfg);
      const deviceId = deriveDeviceId(params.sender_id, params.channel);

      // Update match status
      const { error } = await supabase
        .from("matches")
        .update({ status: "accepted" })
        .eq("device_id_a", deviceId)
        .eq("device_id_b", params.target_device_id)
        .gt("expires_at", new Date().toISOString());

      if (error) {
        return { error: error.message };
      }

      // Check if mutual
      const { data: reverse } = await supabase
        .from("matches")
        .select("status")
        .eq("device_id_a", params.target_device_id)
        .eq("device_id_b", deviceId)
        .eq("status", "accepted")
        .single();

      return {
        accepted: true,
        mutual: !!reverse,
        message: reverse
          ? "双方都接受了！你们可以打个招呼了 👋"
          : "已接受。等对方也接受后，你们就可以认识了。",
      };
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
        if (cfg.autoScanOnLocation === false) return {};

        // Check if the inbound message has location context
        const lat = ctx?.LocationLat;
        const lon = ctx?.LocationLon;
        if (lat == null || lon == null) return {};

        // Inject a hint so the agent knows to use antenna_scan
        const isLive = ctx?.LocationIsLive ?? false;
        const locationName = ctx?.LocationName ?? "";
        const hint = isLive
          ? `\n\n[Antenna] 📡 收到实时位置 (${lat.toFixed(4)}, ${lon.toFixed(4)})${locationName ? ` — ${locationName}` : ""}。请使用 antenna_scan 工具查看附近有谁。参数：lat=${lat}, lng=${lon}, sender_id 和 channel 从消息上下文获取。`
          : `\n\n[Antenna] 📍 收到位置 (${lat.toFixed(4)}, ${lon.toFixed(4)})${locationName ? ` — ${locationName}` : ""}。请使用 antenna_scan 工具查看附近有谁。参数：lat=${lat}, lng=${lon}, sender_id 和 channel 从消息上下文获取。`;

        return {
          prependContext: hint,
        };
      } catch {
        // Plugin not configured — silently skip
        return {};
      }
    },
    { priority: 5 }
  );

  logger.info("Antenna plugin loaded 📡");
}
