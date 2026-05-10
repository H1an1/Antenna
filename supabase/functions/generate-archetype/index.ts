import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

const ARCHETYPES = {
  Prometheus: { en: "Prometheus — the frontier builder who carries fire", zh: "普罗米修斯——前沿的建造者，盗火者" },
  Athena: { en: "Athena — the strategic creator with wisdom", zh: "雅典娜——以智慧建造的策略创造者" },
  Hermes: { en: "Hermes — the connector who carries the signal", zh: "赫尔墨斯——传递信号的连接者" },
  Apollo: { en: "Apollo — the curator of signal and taste", zh: "阿波罗——品味与信号的策展人" },
  Artemis: { en: "Artemis — the independent scout", zh: "阿尔忒弥斯——独立的探索者" },
  Aphrodite: { en: "Aphrodite — the social magnet", zh: "阿佛洛狄忒——社交磁场" },
  Dionysus: { en: "Dionysus — the community catalyst", zh: "狄俄尼索斯——社区催化剂" },
  Hades: { en: "Hades — quiet power beneath the surface", zh: "哈迪斯——表面之下的安静力量" },
  Persephone: { en: "Persephone — the bridge between worlds", zh: "珀耳塞福涅——世界之间的桥梁" },
  Odysseus: { en: "Odysseus — the strategic navigator", zh: "奥德修斯——策略导航者" },
};

serve(async (req) => {
  try {
    const { archetype, profile_text, language } = await req.json();
    if (!archetype || !profile_text) {
      return new Response(JSON.stringify({ reason: null, reasonZh: null }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ reason: null, reasonZh: null, error: "No API key" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const archetypeInfo = ARCHETYPES[archetype as keyof typeof ARCHETYPES];
    if (!archetypeInfo) {
      return new Response(JSON.stringify({ reason: null, reasonZh: null, error: "Unknown archetype" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const prompt = `You are assigning a Greek myth archetype to a real person based on their profile.

Archetype: ${archetype} (${archetypeInfo.en})
Profile: "${profile_text}"

Write TWO personalized descriptions — one in English, one in Chinese (简体中文).

Rules:
- Each description must be ONE sentence, under 25 words
- Reference SPECIFIC details from their profile (job, interests, projects)
- Connect those details to WHY this archetype fits them
- Poetic but grounded — not generic, not cheesy
- The description should feel like it was written for THIS person, not any ${archetype}

Examples of GOOD descriptions:
- "Designing AI search at Microsoft while building social tools on the side — Prometheus carries fire from the lab to the street."
- "把 AI 搜索体验带到微软，同时构建社交发现工具——普罗米修斯从实验室盗火，点亮街头。"

Examples of BAD descriptions (too generic):
- "A builder bringing new tools to the world."
- "前沿的建造者，把新工具带到世界。"

Output format (JSON only, no markdown):
{"reason": "English description", "reasonZh": "中文描述"}`;

    const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 300,
          temperature: 0.8,
          thinkingConfig: { thinkingBudget: 0 },
          responseMimeType: "application/json",
        },
      }),
    });

    if (!res.ok) {
      return new Response(JSON.stringify({ reason: null, reasonZh: null }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "{}";
    
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Try to extract JSON from markdown code block
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    }

    return new Response(JSON.stringify({
      reason: parsed.reason || null,
      reasonZh: parsed.reasonZh || null,
    }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ reason: null, reasonZh: null, error: e.message }), {
      headers: { "Content-Type": "application/json" },
    });
  }
});
