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

async function generateArchetypeReason(archetype, profileText) {
  try {
    const res = await fetch(`${_url || DEFAULT_URL}/functions/v1/generate-archetype`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.ANTENNA_SUPABASE_KEY || process.env.ANTENNA_KEY || DEFAULT_KEY}`,
      },
      body: JSON.stringify({ archetype, profile_text: profileText }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data || null;
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
      return { count: 0, radius_m, profiles: [], message: "还没有位置信息。请先用 'antenna checkin' 分享位置，或通过链接分享位置。" };
    }
  }

  const fuzzy = fuzzyCoord(lat, lng);

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
      personal_description: p.line1,
      looking_for: p.line2,
      conversation_style: p.line3,
      more_information: p.matching_context || null,
      profile_slug: p.profile_slug || null,
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
      // Log global fallback scan
      try { await sb.rpc("log_scan", { p_device_id: device_id, p_lat: lat ?? null, p_lng: lng ?? null, p_radius_m: radius_m, p_results_count: globalOthers.length, p_global_fallback: true }); } catch {}
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
      message: `附近暂时没人，今天的全球推荐也用完了。明天再来！提示：Antenna 每天有 1 次全球推荐（antenna_discover），下次可以试试。`,
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

  // Log scan event (analytics, best-effort)
  try {
    await sb.rpc("log_scan", {
      p_device_id: device_id, p_lat: lat ?? null, p_lng: lng ?? null,
      p_radius_m: radius_m, p_results_count: others.length, p_global_fallback: false,
    });
  } catch { /* silent */ }

  return {
    count: others.length,
    radius_m,
    profiles: profs,
    _ref_map: _refMap,
    nearby_events,
  };
}

// ─── Profile field metadata (self-describing API) ───────────────────

export const PROFILE_FIELDS = {
  display_name: { label: "显示名称", description: "How you want to be called" },
  personal_description: { label: "个人描述", description: "Who you are and what you do", maxLength: 220, required: true },
  looking_for: { label: "想认识的人", description: "The kind of people you want to meet", maxLength: 140 },
  conversation_style: { label: "想要的交流方式", description: "The type of conversations you want", maxLength: 160 },
  more_information: { label: "更多信息", description: "Agent-generated rich context for better matching (not shown to others)", maxLength: 1000 },
  interest_tags: { label: "兴趣标签", description: "Interest/topic tags shown on the card (up to 8)", maxItems: 8 },
  city: { label: "国家/地区", description: "Country or region" },
  links: { label: "社交链接", description: "Social links shown on the card footer (up to 3)", maxItems: 3 },
  is_active: { label: "状态", description: "Whether the profile is active or quiet" },
};

// ─── getProfile ──────────────────────────────────────────────────────

export async function getProfile({ device_id, supabaseUrl, supabaseKey }) {
  const sb = getClient(supabaseUrl, supabaseKey);
  const { data, error } = await sb.rpc("get_profile", { p_device_id: device_id });
  if (error) throw new Error(error.message);
  if (!data) return null;

  // Unpack matching_context JSON into top-level fields for easier agent consumption
  if (data.matching_context) {
    try {
      const ctx = JSON.parse(data.matching_context);
      data.interest_tags = ctx.interestTags || [];
      data.city = ctx.city || null;
      data.links = ctx.links || [];
      data.is_active = typeof ctx.isActive === "boolean" ? ctx.isActive : true;
      data.archetype_override = ctx.archetypeOverride || null;
      data.context = ctx.context || null;
    } catch {}
  }

  // Add semantic field aliases
  data.personal_description = data.line1 || null;
  data.looking_for = data.line2 || null;
  data.conversation_style = data.line3 || null;

  return data;
}

// ─── setProfile ──────────────────────────────────────────────────────

export async function setProfile({
  device_id,
  display_name,
  line1,
  line2,
  line3,
  matching_context,
  contact_info,
  visible = true,
  interest_tags,
  city,
  links,
  profile_slug,
  is_active,
  archetype_override,
  supabaseUrl,
  supabaseKey,
}) {
  const sb = getClient(supabaseUrl, supabaseKey);

  // Pack structured fields into matching_context JSON
  let contextJson = matching_context;
  if (matching_context || interest_tags || city || links || is_active !== undefined || archetype_override !== undefined) {
    // Read existing context from DB to merge
    let existing = {};
    try {
      const current = await getProfile({ device_id, supabaseUrl, supabaseKey });
      if (current?.matching_context) {
        try { existing = JSON.parse(current.matching_context); } catch { existing = {}; }
      }
    } catch {}

    // If matching_context is a plain string (not JSON), treat it as the "context" field
    if (matching_context) {
      try {
        const parsed = JSON.parse(matching_context);
        Object.assign(existing, parsed);
      } catch {
        existing.context = matching_context;
      }
    }
    if (interest_tags) existing.interestTags = interest_tags;
    if (city) existing.city = city;
    if (links) existing.links = links;
    if (is_active !== undefined) existing.isActive = is_active;
    if (archetype_override !== undefined) existing.archetypeOverride = archetype_override;
    existing.version = existing.version || 1;
    contextJson = JSON.stringify(existing);
  }

  const { data, error } = await sb.rpc("upsert_profile", {
    p_device_id: device_id,
    p_display_name: display_name || null,
    p_emoji: null,
    p_line1: line1 || null,
    p_line2: line2 || null,
    p_line3: line3 || null,
    p_visible: visible,
    p_matching_context: contextJson || null,
    p_contact_info: contact_info || null,
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

  // Read back profile to get slug for public page link
  let publicUrl = null;
  let bindUrl = null;
  let archetypeResult = null;
  let profileSlug = null;
  try {
    const profile = await getProfile({ device_id, supabaseUrl, supabaseKey });
    profileSlug = profile?.profile_slug || null;
    if (!profileSlug && display_name) {
      const slug = display_name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").substring(0, 30);
      if (slug) {
        const { error: slugError } = await sb.from("profiles").update({ profile_slug: slug }).eq("device_id", device_id);
        if (slugError) throw new Error(slugError.message);
        profileSlug = slug;
      }
    }
    if (profileSlug) {
      publicUrl = `https://www.antenna.fyi/p/${profileSlug}`;
    }
  } catch {}

  // Generate personalized archetype description via LLM
  try {
    const profileText = [line1, line2, line3, matching_context].filter(Boolean).join(". ");
    if (profileText) {
      // Simple keyword-based archetype detection (same logic as frontend)
      const corpus = profileText.toLowerCase();
      const archetypeKeywords = {
        Prometheus: ["ai", "agent", "llm", "founder", "startup", "build", "developer", "hacker", "tools", "\u667a\u80fd\u4f53", "\u521b\u4e1a", "\u5f00\u53d1"],
        Athena: ["product", "strategy", "research", "design", "craft", "pm", "ux", "\u4ea7\u54c1", "\u8bbe\u8ba1", "\u7814\u7a76"],
        Hermes: ["network", "connect", "community", "social", "bridge", "\u793e\u4ea4", "\u8fde\u63a5", "\u793e\u533a"],
        Apollo: ["music", "media", "content", "creator", "writing", "taste", "\u97f3\u4e50", "\u5185\u5bb9", "\u521b\u4f5c"],
        Artemis: ["independent", "explore", "freelance", "health", "outdoor", "\u72ec\u7acb", "\u63a2\u7d22"],
        Aphrodite: ["beauty", "brand", "fashion", "relationship", "\u7f8e", "\u54c1\u724c", "\u65f6\u5c1a"],
        Dionysus: ["event", "culture", "party", "art", "festival", "\u6d3b\u52a8", "\u6587\u5316", "\u827a\u672f"],
        Hades: ["finance", "invest", "infrastructure", "backend", "security", "\u6295\u8d44", "\u91d1\u878d", "\u67b6\u6784"],
        Persephone: ["transform", "cross", "research", "academic", "bridge", "\u8de8\u754c", "\u7814\u7a76", "\u5b66\u672f"],
        Odysseus: ["founder", "journey", "resilience", "travel", "startup", "\u521b\u4e1a", "\u65c5\u884c"],
      };
      let bestArchetype = "Prometheus";
      let bestScore = 0;
      for (const [role, keywords] of Object.entries(archetypeKeywords)) {
        const score = keywords.reduce((s, kw) => s + (corpus.includes(kw) ? 1 : 0), 0);
        if (score > bestScore) { bestScore = score; bestArchetype = role; }
      }
      archetypeResult = await generateArchetypeReason(bestArchetype, profileText);
      if (archetypeResult?.reason) {
        archetypeResult.archetype = bestArchetype;
        // Write archetype back to matching_context so dashboard can display it
        try {
          const profile = await getProfile({ device_id, supabaseUrl, supabaseKey });
          let ctx = {};
          try { ctx = JSON.parse(profile?.matching_context || "{}"); } catch {}
          ctx.archetypeOverride = { name: bestArchetype, reason: archetypeResult.reason, reasonZh: archetypeResult.reasonZh };
          await sb.rpc("upsert_profile", {
            p_device_id: device_id,
            p_matching_context: JSON.stringify(ctx),
            p_visible: profile?.visible ?? true,
          });
        } catch {}
      }
    }
  } catch (e) {
    console.error("Archetype generation failed (non-fatal):", e.message);
  }

  // Auto-generate GPS bind link
  try {
    const bind = await createBindToken({ device_id, supabaseUrl, supabaseKey });
    bindUrl = bind.url;
  } catch {}

  return {
    ...data,
    profile_slug: profileSlug || data?.profile_slug || null,
    public_url: publicUrl,
    gps_bind_url: bindUrl,
    archetype: archetypeResult || null,
    next_step: "Send the public_url and gps_bind_url to the user. The GPS link should be opened on their phone to share location.",
  };
}

// ─── accept ──────────────────────────────────────────────────────────

export async function accept({
  device_id,
  target_device_id,
  ref,
  profile_slug,
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
  // Resolve profile_slug to device_id
  if (!targetId && profile_slug) {
    const { data: slugProfile } = await sb.rpc("get_profile_by_slug", { p_slug: profile_slug });
    const resolved = Array.isArray(slugProfile) ? slugProfile[0] : slugProfile;
    if (resolved?.device_id) {
      targetId = resolved.device_id;
    }
  }
  if (!targetId) {
    return { accepted: false, error: "No target. Provide ref, target_device_id, or profile_slug." };
  }

  const { error } = await sb.rpc("upsert_match", {
    p_device_id_a: device_id,
    p_device_id_b: targetId,
    p_reason: "",
    p_score: 0,
    p_status: "accepted",
    p_contact_info: contact_info || null,
    p_expires_hours: 168,
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

  // Single RPC with JOINed profiles — no N+1
  const { data, error } = await sb.rpc("get_my_matches_with_profiles", { p_device_id: device_id });
  if (error) throw new Error(error.message);

  const raw = data || { mutual_matches: [], incoming_accepts: [] };

  // Add refs and rename target_id to _device_id (internal only)
  const mutualMatches = (raw.mutual_matches || []).map((m, i) => ({
    ref: String(i + 1),
    _device_id: m.target_id,
    name: m.name || "匿名",
    personal_description: m.line1,
    looking_for: m.line2,
    conversation_style: m.line3,
    their_contact: m.their_contact || null,
    you_shared: m.you_shared || null,
  }));

  const incomingOffset = mutualMatches.length;
  const incomingAccepts = (raw.incoming_accepts || []).map((m, i) => ({
    ref: String(incomingOffset + i + 1),
    _device_id: m.target_id,
    name: m.name || "匿名",
    personal_description: m.line1,
    looking_for: m.line2,
    conversation_style: m.line3,
  }));

  const messages = [];
  if (mutualMatches.length > 0) messages.push(`${mutualMatches.length} 个双向匹配！可以交换联系方式了`);
  if (incomingAccepts.length > 0) messages.push(`${incomingAccepts.length} 个人想认识你，等你回应`);
  if (messages.length === 0 && mutualMatches.length === 0 && incomingAccepts.length === 0) {
    messages.push("目前没有进行中的匹配。");
  } else if (messages.length === 0) {
    messages.push("你接受了一些匹配，但对方还没有回应。耐心等等 ⏳");
  }

    // Persist ref map so accept(ref) resolves correctly
  const _refMap = {};
  for (const m of mutualMatches) _refMap[m.ref] = m._device_id;
  for (const m of incomingAccepts) _refMap[m.ref] = m._device_id;
  if (device_id && Object.keys(_refMap).length > 0) {
    try { await sb.rpc("save_scan_refs", { p_owner: device_id, p_refs: _refMap }); } catch { /* best effort */ }
  }

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
      personal_description: p.line1,
      looking_for: p.line2,
      conversation_style: p.line3,
      more_information: p.matching_context || null,
      profile_slug: p.profile_slug || null,
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

// ─── initialRecommendations (one-time first-use) ──────────────────────

export async function initialRecommendations({ device_id, supabaseUrl, supabaseKey }) {
  const sb = getClient(supabaseUrl, supabaseKey);

  const { data: results, error } = await sb.rpc("initial_recommendations", {
    p_device_id: device_id,
    p_limit: 3,
  });

  if (error) throw new Error(error.message);

  if (!results || results.length === 0) {
    return {
      count: 0,
      profiles: [],
      initial: true,
      message: "暂时没有推荐，等有更多人加入！",
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
      personal_description: p.line1,
      looking_for: p.line2,
      conversation_style: p.line3,
      more_information: p.matching_context || null,
      profile_slug: p.profile_slug || null,
      match_reason: reason,
    });
  }

  // Log who was recommended (for dedup in daily discover)
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
    initial: true,
    message: "这是你的首次推荐——基于你的名片，这几个人跟你最匹配。",
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
    p_lat: lat ?? null,
    p_lng: lng ?? null,
    p_created_by: device_id || null,
    p_starts_at: starts_at || null,
    p_ends_at: ends_at || null,
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
      personal_description: p.line1,
      looking_for: p.line2,
      conversation_style: p.line3,
      more_information: p.matching_context || null,
      profile_slug: p.profile_slug || null,
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

export async function updateEvent({ code, device_id, name, description, og_image, lat, lng, starts_at, ends_at, requires_approval, screening_questions, supabaseUrl, supabaseKey }) {
  const sb = getClient(supabaseUrl, supabaseKey);
  const { data, error } = await sb.rpc("update_event", {
    p_code: code, p_device_id: device_id,
    p_name: name || null, p_description: description || null,
    p_og_image: og_image || null, p_lat: lat ?? null, p_lng: lng ?? null,
    p_starts_at: starts_at || null, p_ends_at: ends_at || null,
    ...(requires_approval != null ? { p_requires_approval: requires_approval } : {}),
    ...(screening_questions != null ? { p_screening_questions: screening_questions } : {}),
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

// ─── sendEventMessage (host → participants) ─────────────────────────

export async function sendEventMessage({ code, device_id, message, target_ref, supabaseUrl, supabaseKey }) {
  const sb = getClient(supabaseUrl, supabaseKey);
  const params = {
    p_code: code,
    p_device_id: device_id,
    p_message: message,
  };
  if (target_ref) params.p_target_ref = target_ref;
  const { data, error } = await sb.rpc("send_event_message", params);
  if (error) throw new Error(error.message);
  return data;
}

// ─── getMyEventMessages ──────────────────────────────────────────────

export async function getMyEventMessages({ device_id, supabaseUrl, supabaseKey }) {
  const sb = getClient(supabaseUrl, supabaseKey);
  const { data, error } = await sb.rpc("get_my_event_messages", { p_device_id: device_id });
  if (error) throw new Error(error.message);
  return {
    messages: data || [],
    count: (data || []).length,
  };
}

// ─── verifyApiKey ────────────────────────────────────────────────────

export async function verifyApiKey({ key, supabaseUrl, supabaseKey }) {
  const sb = getClient(supabaseUrl, supabaseKey);
  const { data, error } = await sb.rpc("verify_api_key", { p_key: key });
  if (error) throw new Error(error.message);
  return data;
}

// ─── linkAccount (bind device_id to website account via API key) ─────

export async function linkAccount({ device_id, api_key, supabaseUrl, supabaseKey }) {
  const sb = getClient(supabaseUrl, supabaseKey);
  const { data, error } = await sb.rpc("bind_user_id", {
    p_device_id: device_id,
    p_api_key: api_key,
  });
  if (error) throw new Error(error.message);
  if (data?.error) return data;
  return {
    ...data,
    message: "账号已关联！现在你可以在 antenna.fyi/me 看到你的完整 profile 和匹配记录了。",
  };
}

// ─── Drift Bottle (漂流瓶) ──────────────────────────────────────────

export async function throwDriftBottle({ device_id, message }) {
  const sb = getClient();
  const { data, error } = await sb.rpc("throw_drift_bottle", { p_device_id: device_id, p_message: message });
  if (error) return { error: error.message };
  return data;
}

export async function pickDriftBottle({ device_id }) {
  const sb = getClient();
  const { data, error } = await sb.rpc("pick_drift_bottle", { p_device_id: device_id });
  if (error) return { error: error.message };
  return data;
}

export async function replyDriftBottle({ bottle_id, device_id, reply }) {
  const sb = getClient();
  const { data, error } = await sb.rpc("reply_drift_bottle", { p_bottle_id: bottle_id, p_device_id: device_id, p_reply: reply });
  if (error) return { error: error.message };
  return data;
}

export async function checkDriftBottles({ device_id }) {
  const sb = getClient();
  const { data, error } = await sb.rpc("check_drift_bottles", { p_device_id: device_id });
  if (error) return { error: error.message };
  return data;
}

export async function getMyBottles({ device_id }) {
  const sb = getClient();
  const { data, error } = await sb.rpc("get_my_bottles", { p_device_id: device_id });
  if (error) return { error: error.message };
  return data;
}
