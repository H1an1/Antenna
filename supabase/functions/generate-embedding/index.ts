import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GEMINI_EMBED_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent";
const GEMINI_FLASH_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

serve(async (req) => {
  try {
    const { text, device_id } = await req.json();
    if (!text) {
      return new Response(JSON.stringify({ embedding: null }), { headers: { "Content-Type": "application/json" } });
    }

    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ embedding: null, error: "No API key" }), { headers: { "Content-Type": "application/json" } });
    }

    // 1. Generate embedding
    const embedRes = await fetch(`${GEMINI_EMBED_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: { parts: [{ text }] },
        taskType: "SEMANTIC_SIMILARITY",
        outputDimensionality: 768,
      }),
    });

    if (!embedRes.ok) {
      return new Response(JSON.stringify({ embedding: null }), { headers: { "Content-Type": "application/json" } });
    }

    const embedData = await embedRes.json();
    const embedding = embedData?.embedding?.values || null;

    // 2. Generate quality score via Gemini Flash (thinking disabled for speed + token budget)
    let quality_score: number | null = null;
    try {
      const scoreRes = await fetch(`${GEMINI_FLASH_URL}?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `Rate this profile for social matching quality (0.0 to 1.0). Good = clear description of who they are, what they do, interests. Bad = vague, test text, empty. Profile: "${text}". Reply ONLY a number.`
            }]
          }],
          generationConfig: { temperature: 0, maxOutputTokens: 100, thinkingConfig: { thinkingBudget: 0 } },
        }),
      });

      if (scoreRes.ok) {
        const scoreData = await scoreRes.json();
        const scoreText = scoreData?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        const parsed = parseFloat(scoreText || "");
        if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
          quality_score = Math.round(parsed * 100) / 100;
        }
      } else {
        quality_score = -1;
      }
    } catch {
      quality_score = null;
    }

    // 3. Write back to DB if device_id provided
    if (device_id && (embedding || (quality_score !== null && quality_score >= 0))) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const sb = createClient(supabaseUrl, supabaseKey);
      
      const updateData: Record<string, unknown> = {};
      if (embedding) updateData.embedding = `[${embedding.join(",")}]`;
      if (quality_score !== null && quality_score >= 0) updateData.quality_score = quality_score;
      if (Object.keys(updateData).length > 0) {
        await sb.from("profiles").update(updateData).eq("device_id", device_id);
      }
    }

    return new Response(
      JSON.stringify({ embedding, quality_score }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(
      JSON.stringify({ embedding: null, error: msg }),
      { headers: { "Content-Type": "application/json" } }
    );
  }
});
