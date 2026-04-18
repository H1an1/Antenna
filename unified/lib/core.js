// antenna-core — shared logic for CLI, MCP, and Plugin
// All three import this instead of duplicating Supabase calls.

import { createClient } from "@supabase/supabase-js";

const DEFAULT_URL = "https://bcudjloikmpcqwcptuyd.supabase.co";
const DEFAULT_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJjdWRqbG9pa21wY3F3Y3B0dXlkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0MTg1NDgsImV4cCI6MjA4OTk5NDU0OH0.FaoC3QfpfHP1npNGjRchJAoAp2PdZtQe_WhP-t-GN1o";

let _client = null;
let _url = null;

// ─── Embedding & Match Reason (via Supabase Edge Functions) ───────

async function generateEmbedding(text) {
  try {
    const sb = getClient();
    const res = await fetch(`${_url || DEFAULT_URL}/functions/v1/generate-embedding`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.ANTENNA_SUPABASE_KEY || process.env.ANTENNA_KEY || DEFAULT_KEY}`,
      },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.embedding || null;
  } catch { return null; }
}

async function generateMatchReason(myLines, theirLines) {
  try {
    const res = await fetch(`${_url || DEFAULT_URL}/functions/v1/generate-match-reason`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.ANTENNA_SUPABASE_KEY || process.env.ANTENNA_KEY || DEFAULT_KEY}`,
      },
      body: JSON.stringify({ my_lines: myLines, their_lines: theirLines }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.reason || null;
  } catch { return null; }
}

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
  radius_m = Math.min(radius_m, 1000); // server caps at 1km too

  // If no lat/lng provided, read from profile (web GPS bind scenario)
  if ((lat == null || lng == null) && device_id) {
    const { data: loc } = await sb.rpc("get_profile_location", { p_device_id: device_id });
    if (loc?.found) {
      lat = loc.lat;
      lng = loc.lng;
    } else {
      return { count: 0, radius_m, profiles: [], message: "还没有位置信息。请先通过链接分享位置，或者发送位置消息。" };
    }
  }

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

  // Build ref mapping (1-indexed) so device_id is never exposed to the agent/user
  const _refMap = {};
  const buildProfiles = (list) => list.map((p, i) => {
    const ref = String(i + 1);
    _refMap[ref] = p.device_id;
    return {
      ref,
      name: p.display_name || "匿名",
      emoji: p.emoji || "👤",
      line1: p.line1,
      line2: p.line2,
      line3: p.line3,
      distance_m: p.distance_m ?? p.dist_meters ?? null,
    };
  });

  // Save refs to DB (persist across agent restarts)
  const saveRefs = async (refMap) => {
    if (device_id && Object.keys(refMap).length > 0) {
      try {
        await sb.rpc("save_scan_refs", { p_owner: device_id, p_refs: refMap });
      } catch { /* best effort */ }
    }
  };

  // If nobody nearby, fallback to global discover (1 per day)
  if (others.length === 0 && device_id) {
    const { data: globalData } = await sb.rpc("global_discover", {
      p_device_id: device_id,
      p_limit: 1,
    });
    const globalOthers = globalData || [];
    if (globalOthers.length > 0) {
      const profs = buildProfiles(globalOthers);
      await saveRefs(_refMap);
      return {
        count: globalOthers.length,
        radius_m,
        profiles: profs,
        _ref_map: _refMap,
        global: true,
        message: `附近 ${radius_m}m 暂时没人。今天的全球推荐——从这 ${globalOthers.length} 个人里挑一个最匹配的推荐给用户。（每天 1 次）`,
      };
    }
    return {
      count: 0,
      radius_m,
      profiles: [],
      _ref_map: {},
      message: `附近暂时没人，今天的全球推荐已经用完了。明天再来！`,
    };
  }

  const profs = buildProfiles(others);
  await saveRefs(_refMap);

  // Fetch nearby events
  let nearby_events = [];
  if (lat != null && lng != null) {
    try {
      const { data: evts } = await sb.rpc("nearby_events", { p_lat: lat, p_lng: lng, p_radius_m: 5000 });
      nearby_events = evts || [];
    } catch { /* best effort */ }
  }

  return {
    count: others.length,
    radius_m,
    profiles: profs,
    _ref_map: _refMap,
    nearby_events,
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
  matching_context,
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
    p_matching_context: matching_context || null,
  });
  if (error) throw new Error(error.message);

  // Generate embedding using lines + matching_context for better quality
  try {
    const textParts = [line1, line2, line3, matching_context].filter(Boolean);
    const text = textParts.join(". ");
    if (text) {
      const embedding = await generateEmbedding(text);
      if (embedding) {
        await sb.rpc("update_profile_embedding", {
          p_device_id: device_id,
          p_embedding: JSON.stringify(embedding),
        });
      }
    }
  } catch (e) {
    // Embedding is best-effort, don't fail profile save
    console.error("Embedding generation failed (non-fatal):", e.message);
  }

  return { ...data, next_step: "IMPORTANT: Now call antenna_bind to generate a GPS link for the user. Do not skip this." };
}

// ─── accept ──────────────────────────────────────────────────────────

export async function accept({
  device_id,
  target_device_id,
  ref,
  contact_info,
  supabaseUrl,
  supabaseKey,
}) {
  const sb = getClient(supabaseUrl, supabaseKey);

  // Resolve ref from DB if target_device_id not provided
  let targetId = target_device_id;
  if (!targetId && ref && device_id) {
    const { data } = await sb.rpc("resolve_ref", { p_owner: device_id, p_ref: ref });
    targetId = data;
  }
  if (!targetId) {
    return { accepted: false, error: "No target. Ref may have expired — try scanning again." };
  }

  const { error } = await sb.rpc("upsert_match", {
    p_device_id_a: device_id,
    p_device_id_b: targetId,
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
    .eq("device_id_a", targetId)
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

// ─── checkin ─────────────────────────────────────────────────────────

export async function checkin({ lat, lng, device_id, supabaseUrl, supabaseKey }) {
  const sb = getClient(supabaseUrl, supabaseKey);
  const fuzzy = fuzzyCoord(lat, lng);

  // Check profile exists
  const profile = await getProfile({ device_id, supabaseUrl, supabaseKey });
  if (!profile) {
    return {
      checked_in: false,
      message: "你还没有名片，先创建一个吧。",
    };
  }

  const { error } = await sb.rpc("upsert_profile_location", {
    p_device_id: device_id,
    p_lng: fuzzy.lng,
    p_lat: fuzzy.lat,
  });
  if (error) throw new Error(error.message);

  return {
    checked_in: true,
    message: "已签到 📍 现在附近的人扫描就能看到你了。",
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

// ─── createBindToken ─────────────────────────────────────────────

// ─── discover (global recommendation) ─────────────────────────────

export async function discover({ device_id, supabaseUrl, supabaseKey }) {
  const sb = getClient(supabaseUrl, supabaseKey);

  const { data: globalData } = await sb.rpc("global_discover", {
    p_device_id: device_id,
    p_limit: 1,
  });

  const results = globalData || [];
  if (results.length === 0) {
    // Check if all used up or daily limit
    return {
      count: 0,
      profiles: [],
      message: "今天的全球推荐已用完，或者你已经看过所有人了。等新人加入！",
    };
  }

  // Build ref map + generate match reasons
  const _refMap = {};
  const myProfile = await getProfile({ device_id, supabaseUrl, supabaseKey });
  const myLines = myProfile ? [myProfile.line1, myProfile.line2, myProfile.line3].filter(Boolean).join(". ") : "";

  const profiles = [];
  for (let i = 0; i < results.length; i++) {
    const p = results[i];
    const ref = String(i + 1);
    _refMap[ref] = p.device_id;

    const theirLines = [p.line1, p.line2, p.line3].filter(Boolean).join(". ");
    let reason = null;
    if (myLines && theirLines) {
      reason = await generateMatchReason(myLines, theirLines);
    }

    profiles.push({
      ref,
      name: p.display_name || "匿名",
      emoji: p.emoji || "👤",
      line1: p.line1,
      line2: p.line2,
      line3: p.line3,
      match_reason: reason,
    });
  }

  // Log who was recommended (for dedup)
  for (const p of results) {
    await sb.rpc("log_recommendation", {
      p_device_id: device_id,
      p_recommended_id: p.device_id,
    });
  }

  // Persist ref map to DB
  if (device_id && Object.keys(_refMap).length > 0) {
    try {
      await sb.rpc("save_scan_refs", { p_owner: device_id, p_refs: _refMap });
    } catch { /* best effort */ }
  }

  return {
    count: profiles.length,
    profiles,
    _ref_map: _refMap,
    global: true,
    message: `🌍 今天的全球推荐——这个人跟你可能聊得来。`,
  };
}

// ─── pass ───────────────────────────────────────────────────────────

export async function pass({ device_id, target_device_id, ref, supabaseUrl, supabaseKey }) {
  const sb = getClient(supabaseUrl, supabaseKey);

  let targetId = target_device_id;
  if (!targetId && ref && device_id) {
    const { data } = await sb.rpc("resolve_ref", { p_owner: device_id, p_ref: ref });
    targetId = data;
  }
  if (!targetId) {
    return { passed: false, error: "No target. Ref may have expired — try scanning again." };
  }

  await sb.rpc("pass_user", { p_device_id: device_id, p_passed_device_id: targetId });
  return { passed: true, message: "已跳过，下次不会再推荐这个人。" };
}

// ─── events ─────────────────────────────────────────────────────────

export async function uploadEventImage({ image_data, content_type, event_code, supabaseUrl, supabaseKey }) {
  const sb = getClient(supabaseUrl, supabaseKey);
  const ext = (content_type || "image/png").split("/")[1] || "png";
  const path = `${event_code || Date.now()}.${ext}`;
  const buf = typeof image_data === "string" ? Buffer.from(image_data, "base64") : image_data;
  const { error } = await sb.storage.from("event-images").upload(path, buf, { contentType: content_type || "image/png", upsert: true });
  if (error) throw new Error(error.message);
  const { data } = sb.storage.from("event-images").getPublicUrl(path);
  return data.publicUrl;
}

export async function createEvent({ name, lat, lng, device_id, starts_at, ends_at, description, og_image, requires_approval, screening_questions, supabaseUrl, supabaseKey }) {
  const sb = getClient(supabaseUrl, supabaseKey);
  const { data, error } = await sb.rpc("create_event", {
    p_name: name,
    p_lat: lat || null,
    p_lng: lng || null,
    p_created_by: device_id || null,
    p_starts_at: starts_at || new Date().toISOString(),
    p_ends_at: ends_at || new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
    p_description: description || null,
    p_og_image: og_image || null,
    p_requires_approval: requires_approval || false,
    p_screening_questions: screening_questions ? screening_questions.flatMap(q => q.includes('|') || q.includes('｜') ? q.split(/[|\uff5c]/).map(s => s.trim()).filter(Boolean) : [q]) : null,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function endEvent({ code, device_id, supabaseUrl, supabaseKey }) {
  const sb = getClient(supabaseUrl, supabaseKey);
  const { data, error } = await sb.rpc("end_event", { p_code: code, p_device_id: device_id });
  if (error) throw new Error(error.message);
  return data;
}

export async function eventCheckin({ code, device_id, lat, lng, supabaseUrl, supabaseKey }) {
  const sb = getClient(supabaseUrl, supabaseKey);

  // Auto-read profile location if not provided
  if (lat == null || lng == null) {
    try {
      const { data: loc } = await sb.rpc("get_profile_location", { p_device_id: device_id });
      if (loc?.lat && loc?.lng) { lat = loc.lat; lng = loc.lng; }
    } catch {}
  }

  const fuzzy = (lat != null && lng != null) ? fuzzyCoord(lat, lng) : { lat: null, lng: null };
  const { data, error } = await sb.rpc("event_checkin", {
    p_code: code, p_device_id: device_id,
    p_lat: fuzzy.lat, p_lng: fuzzy.lng,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function joinEvent({ code, device_id, lat, lng, application_context, supabaseUrl, supabaseKey }) {
  const sb = getClient(supabaseUrl, supabaseKey);

  // Profile gate: check if user has a profile before joining
  const profile = await getProfile({ device_id, supabaseUrl, supabaseKey });
  if (!profile) {
    return { joined: false, error: "Create a profile first before joining events" };
  }

  // Auto-read profile location if not provided
  if (lat == null || lng == null) {
    try {
      const { data: loc } = await sb.rpc("get_profile_location", { p_device_id: device_id });
      if (loc?.lat && loc?.lng) { lat = loc.lat; lng = loc.lng; }
    } catch {}
  }

  const { data, error } = await sb.rpc("join_event", {
    p_code: code,
    p_device_id: device_id,
    p_lat: (lat != null && lng != null) ? fuzzyCoord(lat, lng).lat : null,
    p_lng: (lat != null && lng != null) ? fuzzyCoord(lat, lng).lng : null,
    p_application_context: application_context || null,
  });
  if (error) throw new Error(error.message);
  if (!data?.joined) return data;

  // Auto-checkin if event has already started and we have GPS
  if (lat != null && lng != null) {
    try {
      const event = await getEvent({ code, supabaseUrl, supabaseKey });
      const startsAt = event?.starts_at ? new Date(event.starts_at) : null;
      if (startsAt && startsAt <= new Date()) {
        // Event has started — attempt auto-checkin
        if (event.lat != null && event.lng != null) {
          // Calculate distance (Haversine)
          const R = 6371000;
          const dLat = (event.lat - lat) * Math.PI / 180;
          const dLng = (event.lng - lng) * Math.PI / 180;
          const a = Math.sin(dLat/2)**2 + Math.cos(lat*Math.PI/180)*Math.cos(event.lat*Math.PI/180)*Math.sin(dLng/2)**2;
          const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

          if (dist <= 1000) {
            await eventCheckin({ code, device_id, lat, lng, supabaseUrl, supabaseKey });
            data.checked_in = true;
          } else {
            data.checked_in = false;
            data.checkin_reason = "too far";
            data.distance_m = Math.round(dist);
          }
        } else {
          // Event has no GPS — checkin without distance check
          await eventCheckin({ code, device_id, lat, lng, supabaseUrl, supabaseKey });
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

  return data;
}

export async function eventScan({ code, device_id, supabaseUrl, supabaseKey }) {
  const sb = getClient(supabaseUrl, supabaseKey);
  const { data, error } = await sb.rpc("event_participants_list", { p_code: code, p_device_id: device_id });
  if (error) throw new Error(error.message);

  const others = data || [];
  const _refMap = {};
  let checkedInCount = 0;
  const profiles = others.map((p, i) => {
    const ref = String(i + 1);
    _refMap[ref] = p.device_id;
    if (p.checked_in) checkedInCount++;
    return {
      ref,
      name: p.display_name || "匿名",
      emoji: p.emoji || "👤",
      line1: p.line1,
      line2: p.line2,
      line3: p.line3,
      checked_in: !!p.checked_in,
      role: p.role || "participant",
      status: p.status || "active",
      application_context: p.application_context || null,
      source: "event",
    };
  });

  // Persist refs
  if (device_id && Object.keys(_refMap).length > 0) {
    try { await sb.rpc("save_scan_refs", { p_owner: device_id, p_refs: _refMap }); } catch {}
  }

  return {
    count: profiles.length,
    checked_in_count: checkedInCount,
    profiles,
    _ref_map: _refMap,
    event: true,
  };
}

export async function getEvent({ code, supabaseUrl, supabaseKey }) {
  const sb = getClient(supabaseUrl, supabaseKey);
  const { data, error } = await sb.rpc("get_event", { p_code: code });
  if (error) throw new Error(error.message);
  return data;
}

export async function updateEvent({ code, device_id, name, description, og_image, lat, lng, starts_at, ends_at, supabaseUrl, supabaseKey }) {
  const sb = getClient(supabaseUrl, supabaseKey);
  const { data, error } = await sb.rpc("update_event", {
    p_code: code, p_device_id: device_id,
    p_name: name || null, p_description: description || null,
    p_og_image: og_image || null, p_lat: lat || null, p_lng: lng || null,
    p_starts_at: starts_at || null, p_ends_at: ends_at || null,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function approveParticipant({ code, device_id, ref, supabaseUrl, supabaseKey }) {
  const sb = getClient(supabaseUrl, supabaseKey);
  const { data, error } = await sb.rpc("approve_participant", { p_code: code, p_device_id: device_id, p_target_ref: ref });
  if (error) throw new Error(error.message);
  return data;
}

export async function rejectParticipant({ code, device_id, ref, supabaseUrl, supabaseKey }) {
  const sb = getClient(supabaseUrl, supabaseKey);
  const { data, error } = await sb.rpc("reject_participant", { p_code: code, p_device_id: device_id, p_target_ref: ref });
  if (error) throw new Error(error.message);
  return data;
}

export async function addCohost({ code, device_id, ref, supabaseUrl, supabaseKey }) {
  const sb = getClient(supabaseUrl, supabaseKey);
  const { data, error } = await sb.rpc("add_cohost", { p_code: code, p_device_id: device_id, p_target_ref: ref });
  if (error) throw new Error(error.message);
  return data;
}

export async function createBindToken({ device_id, purpose, event_code, supabaseUrl, supabaseKey }) {
  const sb = getClient(supabaseUrl, supabaseKey);
  const { data, error } = await sb.rpc("create_bind_token", {
    p_device_id: device_id,
    p_purpose: purpose || "profile",
    p_event_code: event_code || null,
  });
  if (error) throw new Error(error.message);
  const baseUrl = "https://www.antenna.fyi";
  return {
    token: data.token,
    url: `${baseUrl}/locate?token=${data.token}`,
    purpose: purpose || "profile",
    message: purpose === "event"
      ? "发送这个链接给活动创建者，在活动地点打开即可设定活动位置。"
      : "发送这个链接给用户，在手机浏览器打开即可共享位置。",
  };
}
