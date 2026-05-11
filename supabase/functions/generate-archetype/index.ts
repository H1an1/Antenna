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

const ARCHETYPE_LIST = Object.entries(ARCHETYPES)
  .map(([name, desc]) => `- ${name}: ${desc.en}`)
  .join("\n");

serve(async (req) => {
  try {
    const { archetype, profile_text } = await req.json();
    if (!profile_text) {
      return new Response(JSON.stringify({ archetype: null, reason: null, reasonZh: null }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ archetype: null, reason: null, reasonZh: null, error: "No API key" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // If archetype is provided, just generate reason for it
    // If not provided, LLM picks the best archetype AND generates reason
    const chosenArchetype = archetype || null;

    let prompt: string;

    if (chosenArchetype) {
      const archetypeInfo = ARCHETYPES[chosenArchetype as keyof typeof ARCHETYPES];
      if (!archetypeInfo) {
        return new Response(JSON.stringify({ archetype: null, reason: null, reasonZh: null, error: "Unknown archetype" }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      prompt = `You are assigning a Greek myth archetype to a real person based on their profile.

Archetype: ${chosenArchetype} (${archetypeInfo.en})
Profile: "${profile_text}"

Write TWO personalized descriptions — one in English, one in Chinese (简体中文).

Rules:
- Each description must be ONE sentence, under 25 words
- Reference SPECIFIC details from their profile (job, interests, projects)
- Connect those details to WHY this archetype fits them
- Poetic but grounded — not generic, not cheesy

Output format (JSON only, no markdown):
{"archetype": "${chosenArchetype}", "reason": "English description", "reasonZh": "中文描述"}`;
    } else {
      prompt = `You are assigning a Greek myth archetype to a real person. Pick the BEST fitting archetype from this list:

${ARCHETYPE_LIST}

Profile: "${profile_text}"

Instructions:
1. Read the profile carefully — their work, interests, personality, what they're looking for
2. Pick the ONE archetype that fits BEST. Think about their core energy, not surface keywords.
3. Write TWO personalized descriptions — one in English, one in Chinese (简体中文)

Rules:
- Each description must be ONE sentence, under 25 words
- Reference SPECIFIC details from their profile
- Connect those details to WHY this archetype fits them
- Poetic but grounded — not generic, not cheesy
- The description should feel like it was written for THIS person only

Output format (JSON only, no markdown):
{"archetype": "ArchetypeName", "reason": "English description", "reasonZh": "中文描述"}`;
    }

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
      return new Response(JSON.stringify({ archetype: null, reason: null, reasonZh: null }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "{}";

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    }

    return new Response(JSON.stringify({
      archetype: parsed.archetype || chosenArchetype || null,
      reason: parsed.reason || null,
      reasonZh: parsed.reasonZh || null,
    }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ archetype: null, reason: null, reasonZh: null, error: e.message }), {
      headers: { "Content-Type": "application/json" },
    });
  }
});
