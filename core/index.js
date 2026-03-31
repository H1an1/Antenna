// antenna-core — shared logic for CLI, MCP, and Plugin
// All three import this instead of duplicating Supabase calls.

import { createClient } from "@supabase/supabase-js";

const DEFAULT_URL = "https://bcudjloikmpcqwcptuyd.supabase.co";
const DEFAULT_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJjdWRqbG9pa21wY3F3Y3B0dXlkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0MTg1NDgsImV4cCI6MjA4OTk5NDU0OH0.FaoC3QfpfHP1npNGjRchJAoAp2PdZtQe_WhP-t-GN1o";

let _client = null;
let _url = null;

export function getClient(url, key) {
  const u = url || process.env.ANTENNA_SUPABASE_URL || process.env.ANTENNA_URL || DEFAULT_URL;
  const k = key || process.env.ANTENNA_SUPABASE_KEY || process.env.ANTENNA_KEY || DEFAULT_KEY;
  if (!_client || _url !== u) {
    _client = createClient(u, k);
    _url = u;
  }
  return _client;
}

export function deriveDeviceId(senderId, channel) {
  return `${channel}:${senderId}`;
}

export function fuzzyCoord(lat, lng) {
  return {
    lat: Math.round(lat * 1000) / 1000,
    lng: Math.round(lng * 1000) / 1000,
  };
}

// ─── scan ────────────────────────────────────────────────────────────

export async function scan({ lat, lng, radius_m = 500, device_id, supabaseUrl, supabaseKey }) {
  const sb = getClient(supabaseUrl, supabaseKey);
  const fuzzy = fuzzyCoord(lat, lng);

  if (device_id) {
    await sb.rpc("upsert_profile_location", {
      p_device_id: device_id,
      p_lng: fuzzy.lng,
      p_lat: fuzzy.lat,
    });
  }

  const { data, error } = await sb.rpc("nearby_profiles", {
    p_lat: fuzzy.lat,
    p_lng: fuzzy.lng,
    p_radius_m: radius_m,
  });

  if (error) throw new Error(error.message);

  const others = device_id
    ? (data || []).filter((p) => p.device_id !== device_id)
    : data || [];

  return {
    count: others.length,
    radius_m,
    profiles: others.map((p) => ({
      device_id: p.device_id,
      name: p.display_name || "匿名",
      emoji: p.emoji || "👤",
      line1: p.line1,
      line2: p.line2,
      line3: p.line3,
      distance_m: p.distance_m ?? p.dist_meters ?? null,
    })),
  };
}

// ─── getProfile ──────────────────────────────────────────────────────

export async function getProfile({ device_id, supabaseUrl, supabaseKey }) {
  const sb = getClient(supabaseUrl, supabaseKey);
  const { data, error } = await sb.rpc("get_profile", { p_device_id: device_id });
  if (error) throw new Error(error.message);
  return data || null;
}

// ─── setProfile ──────────────────────────────────────────────────────

export async function setProfile({
  device_id,
  display_name,
  emoji = "👤",
  line1,
  line2,
  line3,
  visible = true,
  supabaseUrl,
  supabaseKey,
}) {
  const sb = getClient(supabaseUrl, supabaseKey);
  const { data, error } = await sb.rpc("upsert_profile", {
    p_device_id: device_id,
    p_display_name: display_name || null,
    p_emoji: emoji,
    p_line1: line1 || null,
    p_line2: line2 || null,
    p_line3: line3 || null,
    p_visible: visible,
  });
  if (error) throw new Error(error.message);
  return data;
}

// ─── accept ──────────────────────────────────────────────────────────

export async function accept({
  device_id,
  target_device_id,
  contact_info,
  supabaseUrl,
  supabaseKey,
}) {
  const sb = getClient(supabaseUrl, supabaseKey);

  const { error } = await sb.rpc("upsert_match", {
    p_device_id_a: device_id,
    p_device_id_b: target_device_id,
    p_reason: "",
    p_score: 0,
    p_status: "accepted",
    p_contact_info: contact_info || null,
    p_expires_hours: 24,
  });
  if (error) throw new Error(error.message);

  // Check mutual
  const { data: reverse } = await sb
    .from("matches")
    .select("status, contact_info_a")
    .eq("device_id_a", target_device_id)
    .eq("device_id_b", device_id)
    .eq("status", "accepted")
    .single();

  const mutual = !!reverse;

  return {
    accepted: true,
    mutual,
    their_contact: mutual ? reverse?.contact_info_a || null : null,
    message: mutual
      ? "双向匹配成功！🎉"
      : "已接受。等对方也接受后，你们就可以交换联系方式了。",
  };
}

// ─── checkMatches ────────────────────────────────────────────────────

export async function checkMatches({ device_id, supabaseUrl, supabaseKey }) {
  const sb = getClient(supabaseUrl, supabaseKey);

  const { data: allMatches, error } = await sb.rpc("get_my_matches", { p_device_id: device_id });
  if (error) throw new Error(error.message);

  if (!allMatches?.length) {
    return {
      mutual_matches: [],
      incoming_accepts: [],
      message: "目前没有进行中的匹配。",
    };
  }

  const myMatches = allMatches.filter((m) => m.device_id_a === device_id);
  const incomingMatches = allMatches.filter((m) => m.device_id_b === device_id);

  // Mutual
  const mutualMatches = [];
  for (const match of myMatches) {
    const reverse = incomingMatches.find((m) => m.device_id_a === match.device_id_b);
    if (reverse) {
      const profile = await getProfile({ device_id: match.device_id_b, supabaseUrl, supabaseKey });
      mutualMatches.push({
        device_id: match.device_id_b,
        name: profile?.display_name || "匿名",
        emoji: profile?.emoji || "👤",
        line1: profile?.line1,
        line2: profile?.line2,
        line3: profile?.line3,
        their_contact: reverse.contact_info_a || null,
        you_shared: match.contact_info_a || null,
      });
    }
  }

  // Incoming only
  const incomingAccepts = [];
  for (const match of incomingMatches) {
    const iAccepted = myMatches.find((m) => m.device_id_b === match.device_id_a);
    if (!iAccepted) {
      const profile = await getProfile({ device_id: match.device_id_a, supabaseUrl, supabaseKey });
      incomingAccepts.push({
        device_id: match.device_id_a,
        name: profile?.display_name || "匿名",
        emoji: profile?.emoji || "👤",
        line1: profile?.line1,
        line2: profile?.line2,
        line3: profile?.line3,
      });
    }
  }

  const messages = [];
  if (mutualMatches.length > 0) messages.push(`${mutualMatches.length} 个双向匹配！可以交换联系方式了`);
  if (incomingAccepts.length > 0) messages.push(`${incomingAccepts.length} 个人想认识你，等你回应`);
  if (messages.length === 0) messages.push("你接受了一些匹配，但对方还没有回应。耐心等等 ⏳");

  return {
    mutual_matches: mutualMatches,
    incoming_accepts: incomingAccepts,
    message: messages.join("；"),
  };
}
