import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseKey);

interface Profile {
  device_id: string;
  display_name: string | null;
  line1: string | null;
  line2: string | null;
  line3: string | null;
  emoji: string | null;
}

Deno.serve(async (req) => {
  try {
    const { device_id, lat, lng, radius_m = 500 } = await req.json();

    if (!device_id || !lat || !lng) {
      return new Response(
        JSON.stringify({ error: "device_id, lat, lng required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // 1. Get the requesting user's profile
    const { data: myProfile } = await supabase
      .from("profiles")
      .select("*")
      .eq("device_id", device_id)
      .single();

    if (!myProfile) {
      return new Response(
        JSON.stringify({ error: "Profile not found. Create one first." }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    // 2. Get nearby profiles via PostGIS
    const { data: nearby } = await supabase.rpc("nearby_profiles", {
      p_lat: lat,
      p_lng: lng,
      p_radius_m: radius_m,
    });

    // Filter out self
    const others = (nearby ?? []).filter(
      (p: Profile) => p.device_id !== device_id
    );

    if (others.length === 0) {
      return new Response(
        JSON.stringify({ matches: [] }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // 3. Check existing unexpired matches
    const { data: existingMatches } = await supabase
      .from("matches")
      .select("device_id_b")
      .eq("device_id_a", device_id)
      .gt("expires_at", new Date().toISOString());

    const alreadyMatched = new Set(
      (existingMatches ?? []).map((m: { device_id_b: string }) => m.device_id_b)
    );

    const newPeople = others.filter(
      (p: Profile) => !alreadyMatched.has(p.device_id)
    );

    if (newPeople.length === 0) {
      return new Response(
        JSON.stringify({ matches: [] }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // 4. Simple keyword matching (V0.1 — no LLM yet)
    //    Score based on overlapping words in line1+line2+line3
    const myWords = extractWords(myProfile);
    const scored = newPeople.map((p: Profile) => {
      const theirWords = extractWords(p);
      const overlap = myWords.filter((w: string) => theirWords.includes(w));
      const score = overlap.length / Math.max(myWords.length, 1);
      const reason = overlap.length > 0
        ? `你们都提到了 ${overlap.slice(0, 3).join("、")}——可能聊得来`
        : `${p.display_name || "TA"} 就在附近，打个招呼？`;
      return { profile: p, score: Math.min(score, 1), reason };
    });

    // Sort by score, take top 5
    scored.sort((a: { score: number }, b: { score: number }) => b.score - a.score);
    const topMatches = scored.slice(0, 5);

    // 5. Insert matches
    const matchRows = topMatches.map((m: { profile: Profile; score: number; reason: string }) => ({
      device_id_a: device_id,
      device_id_b: m.profile.device_id,
      reason: m.reason,
      score: m.score,
      status: "pending",
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    }));

    if (matchRows.length > 0) {
      await supabase.from("matches").insert(matchRows);
    }

    return new Response(
      JSON.stringify({ matches: topMatches.map((m: { profile: Profile; score: number; reason: string }) => ({
        device_id: m.profile.device_id,
        display_name: m.profile.display_name,
        emoji: m.profile.emoji,
        score: m.score,
        reason: m.reason,
      })) }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

function extractWords(profile: Profile): string[] {
  const text = [profile.line1, profile.line2, profile.line3]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  // Split on spaces and Chinese characters
  return text
    .split(/[\s,，。.!！?？、;；:：]+/)
    .filter((w) => w.length > 1);
}
