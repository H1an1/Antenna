import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent";

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

    const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: { parts: [{ text }] },
        taskType: "SEMANTIC_SIMILARITY",
        outputDimensionality: 768,
      }),
    });

    if (!res.ok) {
      return new Response(JSON.stringify({ embedding: null }), { headers: { "Content-Type": "application/json" } });
    }

    const data = await res.json();
    const embedding = data?.embedding?.values || null;

    // If device_id provided, write embedding back to profiles
    if (embedding && device_id) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const sb = createClient(supabaseUrl, supabaseKey);
      const vecStr = `[${embedding.join(",")}]`;
      await sb.from("profiles").update({ embedding: vecStr }).eq("device_id", device_id);
    }

    return new Response(JSON.stringify({ embedding }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ embedding: null, error: e.message }), { headers: { "Content-Type": "application/json" } });
  }
});
