import { createClient, SupabaseClient } from "@supabase/supabase-js";

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

// Cached Supabase client (singleton per config)
let _supabaseClient: SupabaseClient | null = null;
let _supabaseUrl: string | null = null;

// Rate limiting: track last scan time per device_id
const _lastScanTime = new Map<string, number>();
const SCAN_DEBOUNCE_MS = 30_000; // 30 seconds

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
  if (_supabaseClient && _supabaseUrl === url) {
    return _supabaseClient;
  }
  _supabaseClient = createClient(url, cfg.supabaseKey!);
  _supabaseUrl = url;
  return _supabaseClient;
}

function isRateLimited(deviceId: string): boolean {
  const now = Date.now();
  const last = _lastScanTime.get(deviceId);
  if (last && now - last < SCAN_DEBOUNCE_MS) {
    return true;
  }
  _lastScanTime.set(deviceId, now);
  if (_lastScanTime.size > 1000) {
    for (const [k, v] of _lastScanTime) {
      if (now - v > SCAN_DEBOUNCE_MS * 2) _lastScanTime.delete(k);
    }
  }
  return false;
}

/**
 * Snap coordinates to ~150m precision (geohash-like rounding).
 * lat: round to 3 decimal places (~111m)
 * lng: round to 3 decimal places (~85-111m depending on latitude)
 */
function fuzzyCoords(lat: number, lng: number): { lat: number; lng: number } {
  return {
    lat: Math.round(lat * 1000) / 1000,
    lng: Math.round(lng * 1000) / 1000,
  };
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

      // Fuzzy coordinates for privacy (~150m precision)
      const fuzzy = fuzzyCoords(params.lat, params.lng);

      // Update my location using PostGIS RPC
      const { error: upsertErr } = await supabase.rpc(
        "upsert_profile_location",
        {
          p_device_id: deviceId,
          p_lng: fuzzy.lng,
          p_lat: fuzzy.lat,
        }
      );

      if (upsertErr) {
        logger.warn("Antenna: upsert_profile_location failed:", upsertErr.message);
        // Fallback: upsert without location
        await supabase.from("profiles").upsert(
          {
            device_id: deviceId,
            last_seen_at: new Date().toISOString(),
            visible: true,
          },
          { onConflict: "device_id" }
        );
      }

      // Query nearby (use original coords for better accuracy in query)
      const { data: nearby, error } = await supabase.rpc("nearby_profiles", {
        p_lat: fuzzy.lat,
        p_lng: fuzzy.lng,
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

      // Get my profile for matching via RPC
      const { data: myProfile } = await supabase.rpc("get_profile", {
        p_device_id: deviceId,
      });

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

      // Store matches via RPC (SECURITY DEFINER, works with anon key)
      for (const m of topMatches) {
        await supabase.rpc("upsert_match", {
          p_device_id_a: deviceId,
          p_device_id_b: m.device_id,
          p_reason: m.reason,
          p_score: m.score,
          p_status: "pending",
          p_expires_hours: expiryHours,
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
        const { data, error } = await supabase.rpc("get_profile", {
          p_device_id: deviceId,
        });

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

      // action === 'set' — use RPC for write (SECURITY DEFINER)
      const { data, error } = await supabase.rpc("upsert_profile", {
        p_device_id: deviceId,
        p_display_name: params.display_name ?? null,
        p_emoji: params.emoji ?? null,
        p_line1: params.line1 ?? null,
        p_line2: params.line2 ?? null,
        p_line3: params.line3 ?? null,
        p_visible: params.visible ?? true,
      });

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
  // Tool: antenna_accept — accept a match and optionally share contact
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
        target_device_id: {
          type: "string",
          description: "The device_id of the person to accept",
        },
        contact_info: {
          type: "string",
          description:
            "Optional contact info to share (e.g. 'WeChat: yi_xxx' or 'Telegram: @yi')",
        },
      },
      required: ["sender_id", "channel", "target_device_id"],
    },
    handler: async (params: {
      sender_id: string;
      channel: string;
      target_device_id: string;
      contact_info?: string;
    }) => {
      const cfg = getConfig(api);
      const supabase = getSupabase(cfg);
      const deviceId = deriveDeviceId(params.sender_id, params.channel);

      // Update match status + optional contact info via RPC
      const { error } = await supabase.rpc("upsert_match", {
        p_device_id_a: deviceId,
        p_device_id_b: params.target_device_id,
        p_status: "accepted",
        p_contact_info: params.contact_info ?? null,
      });

      if (error) {
        return { error: error.message };
      }

      // Check if mutual match via RPC
      const { data: myMatches } = await supabase.rpc("get_my_matches", {
        p_device_id: deviceId,
      });

      const reverse = (myMatches || []).find(
        (m: any) => m.device_id_a === params.target_device_id && m.device_id_b === deviceId
      );

      if (reverse) {
        // Mutual match! Return the other person's contact info if they shared it
        return {
          accepted: true,
          mutual: true,
          their_contact: reverse.contact_info_a || null,
          message: reverse.contact_info_a
            ? `双方都接受了！对方分享的联系方式：${reverse.contact_info_a}`
            : "双方都接受了！但对方还没有分享联系方式，等 TA 分享后会通知你。",
        };
      }

      return {
        accepted: true,
        mutual: false,
        message: "已接受。等对方也接受后，你们就可以交换联系方式了。",
      };
    },
  });

  // ═══════════════════════════════════════════════════════════════════
  // Tool: antenna_check_matches — check for mutual matches / new contact info
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
    handler: async (params: { sender_id: string; channel: string }) => {
      const cfg = getConfig(api);
      const supabase = getSupabase(cfg);
      const deviceId = deriveDeviceId(params.sender_id, params.channel);

      // Find my accepted matches via RPC
      const { data: allMatches } = await supabase.rpc("get_my_matches", {
        p_device_id: deviceId,
      });

      const myMatches = (allMatches || []).filter(
        (m: any) => m.device_id_a === deviceId
      );

      if (myMatches.length === 0) {
        return { mutual_matches: [], message: "目前没有进行中的匹配。" };
      }

      // Check which ones are mutual
      const mutualMatches = [];
      for (const match of myMatches) {
        const reverse = (allMatches || []).find(
          (m: any) => m.device_id_a === match.device_id_b && m.device_id_b === deviceId
        );

        if (reverse) {
          // Get their profile via RPC
          const { data: profile } = await supabase.rpc("get_profile", {
            p_device_id: match.device_id_b,
          });

          mutualMatches.push({
            name: profile?.display_name || "匿名",
            emoji: profile?.emoji || "👤",
            their_contact: reverse.contact_info_a || null,
            you_shared: match.contact_info_a || null,
          });
        }
      }

      if (mutualMatches.length === 0) {
        return {
          mutual_matches: [],
          message: "你接受了一些匹配，但对方还没有回应。耐心等等 ⏳",
        };
      }

      return { mutual_matches: mutualMatches };
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
