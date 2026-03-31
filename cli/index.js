#!/usr/bin/env node

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.ANTENNA_URL || "https://bcudjloikmpcqwcptuyd.supabase.co";
const SUPABASE_KEY = process.env.ANTENNA_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJjdWRqbG9pa21wY3F3Y3B0dXlkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0MTg1NDgsImV4cCI6MjA4OTk5NDU0OH0.FaoC3QfpfHP1npNGjRchJAoAp2PdZtQe_WhP-t-GN1o";

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const [,, cmd, ...args] = process.argv;

function parseFlags(args) {
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      flags[key] = args[i + 1] || true;
      i++;
    }
  }
  return flags;
}

async function main() {
  const f = parseFlags(args);

  switch (cmd) {
    case "scan": {
      if (!f.lat || !f.lng) return console.error("Usage: antenna scan --lat 39.99 --lng 116.48 [--radius 500] [--id telegram:123]");
      const lat = Math.round(+f.lat * 1000) / 1000;
      const lng = Math.round(+f.lng * 1000) / 1000;
      const radius = +(f.radius || 500);
      if (f.id) {
        await sb.rpc("upsert_profile_location", { p_device_id: f.id, p_lng: lng, p_lat: lat });
      }
      const { data, error } = await sb.rpc("nearby_profiles", { p_lat: lat, p_lng: lng, p_radius_m: radius });
      if (error) return console.error("Error:", error.message);
      const others = f.id ? (data || []).filter(p => p.device_id !== f.id) : (data || []);
      if (others.length === 0) return console.log("📡 No one nearby within " + radius + "m");
      console.log(`📡 ${others.length} people within ${radius}m:\n`);
      others.forEach((p, i) => {
        const dist = p.distance_m ?? p.dist_meters;
        console.log(`  ${p.emoji || "👤"} ${p.display_name || "Anonymous"}${dist != null ? ` (${Math.round(dist)}m)` : ""}`);
        if (p.line1) console.log(`    ${p.line1}`);
        if (p.line2) console.log(`    ${p.line2}`);
        if (p.line3) console.log(`    ${p.line3}`);
        console.log(`    id: ${p.device_id}`);
        console.log();
      });
      break;
    }

    case "profile": {
      if (!f.id) return console.error("Usage: antenna profile --id telegram:123 [--name Yi --emoji 🦦 --line1 '...' --line2 '...' --line3 '...']");
      if (f.name || f.line1 || f.line2 || f.line3) {
        const { data, error } = await sb.rpc("upsert_profile", {
          p_device_id: f.id,
          p_display_name: f.name || null,
          p_emoji: f.emoji || "👤",
          p_line1: f.line1 || null,
          p_line2: f.line2 || null,
          p_line3: f.line3 || null,
          p_visible: true,
        });
        if (error) return console.error("Error:", error.message);
        console.log("✅ Profile saved");
        console.log(JSON.stringify(data, null, 2));
      } else {
        const { data, error } = await sb.rpc("get_profile", { p_device_id: f.id });
        if (error || !data) return console.log("No profile yet. Create one with --name and --line1/2/3");
        console.log(`${data.emoji || "👤"} ${data.display_name || "Anonymous"}`);
        if (data.line1) console.log(`  ${data.line1}`);
        if (data.line2) console.log(`  ${data.line2}`);
        if (data.line3) console.log(`  ${data.line3}`);
      }
      break;
    }

    case "accept": {
      if (!f.id || !f.target) return console.error("Usage: antenna accept --id telegram:123 --target telegram:789 [--contact 'WeChat: yi']");
      const { error } = await sb.rpc("upsert_match", {
        p_device_id_a: f.id,
        p_device_id_b: f.target,
        p_reason: "",
        p_score: 0,
        p_status: "accepted",
        p_contact_info: f.contact || null,
        p_expires_hours: 24,
      });
      if (error) return console.error("Error:", error.message);
      console.log("✅ Accepted" + (f.contact ? ` (shared: ${f.contact})` : ""));
      break;
    }

    case "matches": {
      if (!f.id) return console.error("Usage: antenna matches --id telegram:123");
      const { data, error } = await sb.rpc("get_my_matches", { p_device_id: f.id });
      if (error) return console.error("Error:", error.message);
      if (!data?.length) return console.log("No matches yet.");
      const my = data.filter(m => m.device_id_a === f.id);
      const incoming = data.filter(m => m.device_id_b === f.id);
      // mutual
      for (const m of my) {
        const rev = incoming.find(r => r.device_id_a === m.device_id_b);
        if (rev) {
          const { data: p } = await sb.rpc("get_profile", { p_device_id: m.device_id_b });
          console.log(`🎉 MUTUAL: ${p?.emoji || "👤"} ${p?.display_name || "Anonymous"}`);
          if (rev.contact_info_a) console.log(`   Their contact: ${rev.contact_info_a}`);
          if (m.contact_info_a) console.log(`   You shared: ${m.contact_info_a}`);
          console.log();
        }
      }
      // incoming only
      for (const m of incoming) {
        const iAccepted = my.find(r => r.device_id_b === m.device_id_a);
        if (!iAccepted) {
          const { data: p } = await sb.rpc("get_profile", { p_device_id: m.device_id_a });
          console.log(`📩 WANTS TO MEET YOU: ${p?.emoji || "👤"} ${p?.display_name || "Anonymous"}`);
          if (p?.line1) console.log(`   ${p.line1}`);
          console.log(`   Accept: antenna accept --id ${f.id} --target ${m.device_id_a}`);
          console.log();
        }
      }
      break;
    }

    default:
      console.log(`Antenna — nearby people discovery

Usage:
  antenna scan     --lat 39.99 --lng 116.48 [--radius 500] [--id telegram:123]
  antenna profile  --id telegram:123 [--name Yi --emoji 🦦 --line1 '...']
  antenna accept   --id telegram:123 --target telegram:789 [--contact 'WeChat: yi']
  antenna matches  --id telegram:123

Install:  npm install -g antenna-cli
Or:       npx antenna-cli scan --lat 39.99 --lng 116.48`);
  }
}

main().catch(e => console.error(e.message));
