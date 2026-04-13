// antenna CLI command handlers

import { scan, getProfile, setProfile, accept, checkMatches, checkin, createBindToken } from "./core.js";
import { createInterface } from "readline";
import { existsSync, mkdirSync, copyFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";
import { execSync } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function parseFlags(args) {
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

export async function handleScan(f) {
  if (!f.lat || !f.lng) return console.error("Usage: antenna scan --lat 39.99 --lng 116.48 [--radius 500] (max 1000) [--id telegram:123]");
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
}

export async function handleProfile(f) {
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
}

export async function handleAccept(f) {
  if (!f.id || !f.target) return console.error("Usage: antenna accept --id telegram:123 --target telegram:789 [--contact 'WeChat: yi']");
  const result = await accept({
    device_id: f.id,
    target_device_id: f.target,
    contact_info: f.contact,
  });
  console.log("✅ " + result.message);
  if (result.mutual && result.their_contact) console.log("📇 Their contact: " + result.their_contact);
}

export async function handleCheckin(f) {
  if (!f.id || !f.lat || !f.lng) return console.error("Usage: antenna checkin --id telegram:123 --lat 39.99 --lng 116.48 [--place '三里屯']");
  const result = await checkin({
    lat: +f.lat,
    lng: +f.lng,
    device_id: f.id,
  });
  console.log(result.checked_in ? "✅ " + result.message : "❌ " + result.message);
}

export async function handleMatches(f) {
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
}

export async function handleBind(f) {
  if (!f.id) return console.error("Usage: antenna bind --id telegram:123");
  const result = await createBindToken({ device_id: f.id });
  console.log("\n🔗 GPS Binding Link:\n");
  console.log(`  ${result.url}\n`);
  console.log("Send this to the user. Opening it on their phone will share GPS with their agent.");
  console.log();
}

export async function handleSetup(f) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

  console.log("\n📡 Antenna Setup — 创建你的名片\n");

  const id = f.id || await ask("Your device ID (e.g. telegram:123): ");
  if (!id) { rl.close(); return console.error("Device ID is required."); }

  const name = await ask("Display name: ");
  const emoji = (await ask("Emoji (default 👤): ")) || "👤";
  const line1 = await ask("Line 1 — who you are / what you do: ");
  const line2 = await ask("Line 2 — what you're into: ");
  const line3 = await ask("Line 3 — what you're looking for: ");

  rl.close();

  const data = await setProfile({
    device_id: id,
    display_name: name || null,
    emoji,
    line1: line1 || null,
    line2: line2 || null,
    line3: line3 || null,
  });

  console.log("\n✅ Profile saved!\n");
  console.log(`  ${emoji} ${name || "Anonymous"}`);
  if (line1) console.log(`    ${line1}`);
  if (line2) console.log(`    ${line2}`);
  if (line3) console.log(`    ${line3}`);
  console.log();
}

export async function handleStatus(f) {
  const supabaseUrl = process.env.ANTENNA_SUPABASE_URL || process.env.ANTENNA_URL || "https://bcudjloikmpcqwcptuyd.supabase.co";
  console.log("📡 Antenna Status\n");
  console.log(`  Supabase URL: ${supabaseUrl}`);

  if (f.id) {
    const profile = await getProfile({ device_id: f.id });
    if (profile) {
      console.log(`  Profile: ✅ ${profile.emoji || "👤"} ${profile.display_name || "Anonymous"}`);
    } else {
      console.log("  Profile: ❌ Not created yet");
    }
    const matches = await checkMatches({ device_id: f.id });
    console.log(`  Mutual matches: ${matches.mutual_matches.length}`);
    console.log(`  Incoming accepts: ${matches.incoming_accepts.length}`);
  } else {
    console.log("  Profile: (pass --id to check)");
    console.log("  Matches: (pass --id to check)");
  }
  console.log();
}

export function handleInstallSkill() {
  const skillSrc = join(__dirname, "..", "skill", "SKILL.md");
  let installed = 0;

  // OpenClaw
  const openclawDir = join(homedir(), ".openclaw", "skills", "antenna");
  if (existsSync(join(homedir(), ".openclaw"))) {
    if (!existsSync(openclawDir)) mkdirSync(openclawDir, { recursive: true });
    copyFileSync(skillSrc, join(openclawDir, "SKILL.md"));
    console.log("✅ SKILL.md installed to ~/.openclaw/skills/antenna/");
    installed++;
  }

  // Hermes
  const hermesDir = join(homedir(), ".hermes", "skills", "antenna");
  if (existsSync(join(homedir(), ".hermes"))) {
    if (!existsSync(hermesDir)) mkdirSync(hermesDir, { recursive: true });
    copyFileSync(skillSrc, join(hermesDir, "SKILL.md"));
    console.log("✅ SKILL.md installed to ~/.hermes/skills/antenna/");
    installed++;
  }

  if (installed === 0) {
    // Neither found, default to OpenClaw path
    if (!existsSync(openclawDir)) mkdirSync(openclawDir, { recursive: true });
    copyFileSync(skillSrc, join(openclawDir, "SKILL.md"));
    console.log("✅ SKILL.md installed to ~/.openclaw/skills/antenna/");
    console.log("   (Neither ~/.openclaw nor ~/.hermes detected — defaulted to OpenClaw)");
  }

  console.log("   Restart your agent to pick it up.");
}

export function handleInstallPlugin() {
  const templateDir = join(__dirname, "plugin-template");
  const files = ["index.ts", "openclaw.plugin.json", "package.json"];

  for (const file of files) {
    const src = join(templateDir, file);
    const dest = join(process.cwd(), file);
    if (existsSync(dest)) {
      console.log(`⚠️  ${file} already exists, skipping.`);
    } else {
      copyFileSync(src, dest);
      console.log(`📄 Copied ${file}`);
    }
  }

  console.log("\n✅ OpenClaw Plugin template copied to current directory.");
  console.log("   Next steps:");
  console.log("   1. Run: npm install");
  console.log("   2. Run: openclaw plugins install .");
  console.log();
}

export function handleInstallHermesPlugin() {
  const templateDir = join(__dirname, "hermes-plugin");
  const hermesHome = join(homedir(), ".hermes");
  const pluginDir = join(hermesHome, "plugins", "antenna");
  const skillDir = join(hermesHome, "skills", "antenna");
  const skillSrc = join(__dirname, "..", "skill", "SKILL.md");
  const pluginFiles = ["plugin.yaml", "__init__.py", "schemas.py", "tools.py"];

  if (!existsSync(hermesHome)) {
    console.error("❌ ~/.hermes not found. Is Hermes Agent installed?");
    console.error("   Install: curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash");
    return;
  }

  // 1. Install Plugin
  if (!existsSync(pluginDir)) mkdirSync(pluginDir, { recursive: true });
  for (const file of pluginFiles) {
    const src = join(templateDir, file);
    const dest = join(pluginDir, file);
    if (existsSync(src)) {
      copyFileSync(src, dest);
      console.log(`📄 Plugin: ${file}`);
    }
  }

  // 2. Install Skill
  if (!existsSync(skillDir)) mkdirSync(skillDir, { recursive: true });
  copyFileSync(skillSrc, join(skillDir, "SKILL.md"));
  console.log("📄 Skill: SKILL.md");

  // 3. Auto-install supabase-py
  console.log("\n📦 Installing supabase-py...");
  const hermesAgent = join(hermesHome, "hermes-agent");
  try {
    if (existsSync(hermesAgent)) {
      execSync("uv pip install supabase", { cwd: hermesAgent, stdio: "inherit", timeout: 60_000 });
    } else {
      execSync("pip install supabase", { stdio: "inherit", timeout: 60_000 });
    }
    console.log("✅ supabase-py installed");
  } catch {
    console.log("⚠️  Could not auto-install supabase-py. Run manually:");
    console.log("   cd ~/.hermes/hermes-agent && uv pip install supabase");
  }

  console.log("\n✅ Antenna installed for Hermes! (Plugin + Skill + deps)");
  console.log("   Restart Hermes to activate.");
  console.log();
}

export function printHelp() {
  console.log(`📡 Antenna — nearby people discovery

Usage:
  antenna scan       --lat 39.99 --lng 116.48 [--radius 500] (max 1000) [--id telegram:123]
  antenna checkin    --id telegram:123 --lat 39.99 --lng 116.48
  antenna profile    --id telegram:123 [--name Yi --emoji 🦦 --line1 '...']
  antenna accept     --id telegram:123 --target telegram:789 [--contact 'WeChat: yi']
  antenna matches    --id telegram:123
  antenna bind       --id telegram:123
  antenna serve      Start MCP server (stdio transport)
  antenna setup      Interactive profile setup [--id telegram:123]
  antenna status     Show config & status [--id telegram:123]
  antenna install-skill    Install SKILL.md (detects OpenClaw + Hermes)
  antenna install-plugin   Copy OpenClaw plugin template to cwd
  antenna install-hermes   One-step Hermes setup (Plugin + Skill + deps)
  antenna help       Show this help

Environment:
  ANTENNA_SUPABASE_URL   Supabase project URL (optional, has default)
  ANTENNA_SUPABASE_KEY   Supabase anon key (optional, has default)

Install:  npm install -g antenna-fyi
Or:       npx antenna-fyi scan --lat 39.99 --lng 116.48`);
}
