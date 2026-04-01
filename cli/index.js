#!/usr/bin/env node

import { scan, getProfile, setProfile, accept, checkMatches, checkin } from "../core/index.js";

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
      const result = await scan({
        lat: +f.lat,
        lng: +f.lng,
        radius_m: +(f.radius || 500),
        device_id: f.id || null,
      });
      if (result.count === 0) return console.log("📡 No one nearby within " + result.radius_m + "m");
      console.log(`📡 ${result.count} people within ${result.radius_m}m:\n`);
      result.profiles.forEach((p) => {
        console.log(`  ${p.emoji} ${p.name}${p.distance_m != null ? ` (${Math.round(p.distance_m)}m)` : ""}`);
        if (p.line1) console.log(`    ${p.line1}`);
        if (p.line2) console.log(`    ${p.line2}`);
        if (p.line3) console.log(`    ${p.line3}`);
        console.log(`    id: ${p.device_id}\n`);
      });
      break;
    }

    case "profile": {
      if (!f.id) return console.error("Usage: antenna profile --id telegram:123 [--name Yi --emoji 🦦 --line1 '...' --line2 '...' --line3 '...']");
      if (f.name || f.line1 || f.line2 || f.line3) {
        const data = await setProfile({
          device_id: f.id,
          display_name: f.name,
          emoji: f.emoji || "👤",
          line1: f.line1,
          line2: f.line2,
          line3: f.line3,
        });
        console.log("✅ Profile saved");
        console.log(JSON.stringify(data, null, 2));
      } else {
        const data = await getProfile({ device_id: f.id });
        if (!data) return console.log("No profile yet. Create one with --name and --line1/2/3");
        console.log(`${data.emoji || "👤"} ${data.display_name || "Anonymous"}`);
        if (data.line1) console.log(`  ${data.line1}`);
        if (data.line2) console.log(`  ${data.line2}`);
        if (data.line3) console.log(`  ${data.line3}`);
      }
      break;
    }

    case "accept": {
      if (!f.id || !f.target) return console.error("Usage: antenna accept --id telegram:123 --target telegram:789 [--contact 'WeChat: yi']");
      const result = await accept({
        device_id: f.id,
        target_device_id: f.target,
        contact_info: f.contact,
      });
      console.log("✅ " + result.message);
      if (result.mutual && result.their_contact) console.log("📇 Their contact: " + result.their_contact);
      break;
    }

    case "checkin": {
      if (!f.id || !f.lat || !f.lng) return console.error("Usage: antenna checkin --id telegram:123 --lat 39.99 --lng 116.48 [--place '三里屯']");
      const result = await checkin({
        lat: +f.lat,
        lng: +f.lng,
        device_id: f.id,
      });
      console.log(result.checked_in ? "✅ " + result.message : "❌ " + result.message);
      break;
    }

    case "matches": {
      if (!f.id) return console.error("Usage: antenna matches --id telegram:123");
      const result = await checkMatches({ device_id: f.id });
      if (!result.mutual_matches.length && !result.incoming_accepts.length) {
        return console.log(result.message);
      }
      for (const m of result.mutual_matches) {
        console.log(`🎉 MUTUAL: ${m.emoji} ${m.name}`);
        if (m.their_contact) console.log(`   Their contact: ${m.their_contact}`);
        if (m.you_shared) console.log(`   You shared: ${m.you_shared}`);
        console.log();
      }
      for (const m of result.incoming_accepts) {
        console.log(`📩 WANTS TO MEET YOU: ${m.emoji} ${m.name}`);
        if (m.line1) console.log(`   ${m.line1}`);
        console.log(`   Accept: antenna accept --id ${f.id} --target ${m.device_id}`);
        console.log();
      }
      break;
    }

    default:
      console.log(`Antenna — nearby people discovery

Usage:
  antenna scan     --lat 39.99 --lng 116.48 [--radius 500] [--id telegram:123]
  antenna checkin  --id telegram:123 --lat 39.99 --lng 116.48 [--place '三里屯']
  antenna profile  --id telegram:123 [--name Yi --emoji 🦦 --line1 '...']
  antenna accept   --id telegram:123 --target telegram:789 [--contact 'WeChat: yi']
  antenna matches  --id telegram:123

Install:  npm install -g antenna-cli
Or:       npx antenna-cli scan --lat 39.99 --lng 116.48`);
  }
}

main().catch(e => console.error(e.message));
