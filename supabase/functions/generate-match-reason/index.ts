import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

serve(async (req) => {
  try {
    const { my_lines, their_lines } = await req.json();
    if (!my_lines || !their_lines) {
      return new Response(JSON.stringify({ reason: null }), { headers: { "Content-Type": "application/json" } });
    }

    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ reason: null, error: "No API key" }), { headers: { "Content-Type": "application/json" } });
    }

    const prompt = `You are matching two people. Person A: "${my_lines}". Person B: "${their_lines}". Write ONE short sentence (under 20 words) in the SAME LANGUAGE as the profiles explaining why they might click. Be specific, not generic. No fluff.`;

    const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 200, temperature: 0.7, thinkingConfig: { thinkingBudget: 0 } },
      }),
    });

    if (!res.ok) {
      return new Response(JSON.stringify({ reason: null }), { headers: { "Content-Type": "application/json" } });
    }

    const data = await res.json();
    const reason = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;

    return new Response(JSON.stringify({ reason }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ reason: null, error: e.message }), { headers: { "Content-Type": "application/json" } });
  }
});
