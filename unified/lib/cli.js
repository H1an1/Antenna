// antenna CLI command handlers

import { scan, getProfile, setProfile, accept, checkMatches, checkin, createBindToken, discover, createEvent, endEvent, eventCheckin, joinEvent, eventScan, pass as passUser, uploadEventImage, updateEvent, approveParticipant, rejectParticipant, addCohost, getClient } from "./core.js";
import { createInterface } from "readline";
import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, unlinkSync, renameSync } from "fs";
import path from "path";
import os from "os";
import { join, dirname, extname } from "path";
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
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    }
  }
  return flags;
}

export async function handleScan(f) {
  if (!f.lat && !f.lng && !f.id) return console.error("Usage: antenna scan --lat 39.99 --lng 116.48 [--radius 500] (max 1000) [--id <platform>:<user_id>]\n  Or just: antenna scan --id <platform>:<user_id> (uses saved location from GPS bind)");
  const result = await scan({
    lat: f.lat ? +f.lat : undefined,
    lng: f.lng ? +f.lng : undefined,
    radius_m: +(f.radius || 500),
    device_id: f.id || null,
  });
  if (result.count === 0) return console.log(result.message || "📡 No one nearby");
  if (result.global) {
    console.log(`🌍 Global discover (nearby was empty):\n`);
  } else {
    console.log(`📡 ${result.count} people within ${result.radius_m}m:\n`);
  }
  result.profiles.forEach((p) => {
    console.log(`  ${p.emoji} ${p.name}${p.distance_m != null ? ` (${Math.round(p.distance_m)}m)` : ""}`);
    if (p.line1) console.log(`    ${p.line1}`);
    if (p.line2) console.log(`    ${p.line2}`);
    if (p.line3) console.log(`    ${p.line3}`);
    console.log(`    ref: ${p.ref}\n`);
  });

  // Show nearby events
  if (result.nearby_events?.length) {
    console.log(`🎉 Nearby events:\n`);
    result.nearby_events.forEach((e) => {
      console.log(`  ${e.name} — ${e.participants} people`);
      if (e.description) console.log(`    ${e.description}`);
      console.log(`    Join: antenna event --join --code ${e.code}\n`);
    });
  }
}

export async function handleProfile(f) {
  if (!f.id) return console.error("Usage: antenna profile --id <platform>:<user_id> [--name Yi --emoji 🦦 --line1 '...' --line2 '...' --line3 '...']");
  if (f.name || f.line1 || f.line2 || f.line3 || f.visible !== undefined || f.hide !== undefined) {
    const visible = f.hide ? false : (f.visible !== undefined ? f.visible === 'true' || f.visible === true : undefined);
    const data = await setProfile({
      device_id: f.id,
      display_name: f.name,
      emoji: f.emoji || "👤",
      line1: f.line1,
      line2: f.line2,
      line3: f.line3,
      ...(visible !== undefined && { visible }),
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
  if (!f.id || (!f.target && !f.ref)) return console.error("Usage: antenna accept --id <platform>:<user_id> --ref 1 [--contact 'WeChat: yi']\n       antenna accept --id <platform>:<user_id> --target <ref_or_device_id> [--contact 'WeChat: yi']");
  const result = await accept({
    device_id: f.id,
    target_device_id: f.target || null,
    ref: f.ref || null,
    contact_info: f.contact,
  });
  console.log("✅ " + result.message);
  if (result.mutual && result.their_contact) console.log("📇 Their contact: " + result.their_contact);
}

export async function handleCheckin(f) {
  if (!f.id || !f.lat || !f.lng) return console.error("Usage: antenna checkin --id <platform>:<user_id> --lat 39.99 --lng 116.48 [--place '三里屯']");
  const result = await checkin({
    lat: +f.lat,
    lng: +f.lng,
    device_id: f.id,
  });
  console.log(result.checked_in ? "✅ " + result.message : "❌ " + result.message);
}

export async function handleMatches(f) {
  if (!f.id) return console.error("Usage: antenna matches --id <platform>:<user_id>");
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
    console.log(`   Accept: antenna accept --id ${f.id} --ref ${m.ref}`);
    console.log();
  }
}

export async function handleDiscover(f) {
  if (!f.id) return console.error("Usage: antenna discover --id <platform>:<user_id>");
  const result = await discover({ device_id: f.id });
  if (result.count === 0) return console.log(result.message || "🌍 No global recommendation available right now.");
  console.log(`🌍 Global discover:\n`);
  result.profiles.forEach((p) => {
    console.log(`  ${p.emoji} ${p.name}`);
    if (p.line1) console.log(`    ${p.line1}`);
    if (p.line2) console.log(`    ${p.line2}`);
    if (p.line3) console.log(`    ${p.line3}`);
    if (p.match_reason) console.log(`    → ${p.match_reason}`);
    console.log(`    ref: ${p.ref}\n`);
  });
}

export async function handleEvent(f) {
  const sub = f._?.[0] || Object.keys(f).find(k => ["create", "join", "scan", "end", "checkin", "upload-image"].includes(k));

  if (f['upload-image']) {
    if (!f.code || !f.file) return console.error("Usage: antenna event --upload-image --code abc123 --file /path/to/image.png");
    const fileBuf = readFileSync(f.file);
    const image_data = fileBuf.toString("base64");
    const ext = extname(f.file).slice(1) || "png";
    const mimeMap = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
    const content_type = mimeMap[ext] || "image/png";
    const url = await uploadEventImage({ image_data, content_type, event_code: f.code });
    console.log(`\n✅ Image uploaded!\n`);
    console.log(`  URL: ${url}\n`);
    return;
  }

  if (f.end) {
    if (!f.code || !f.id) return console.error("Usage: antenna event --end --code abc123 --id <platform>:<user_id>");
    const result = await endEvent({ code: f.code, device_id: f.id });
    if (result.ended) {
      console.log(`\n✅ Event ended.\n`);
    } else {
      console.log(`\n❌ ${result.error || 'Failed to end event'}\n`);
    }
    return;
  }

  if (f.checkin) {
    if (!f.code || !f.id) return console.error("Usage: antenna event --checkin --code abc123 --id <platform>:<user_id> [--lat 34.05 --lng -118.24]");
    const result = await eventCheckin({ code: f.code, device_id: f.id, lat: f.lat ? +f.lat : undefined, lng: f.lng ? +f.lng : undefined });
    console.log(`\n✅ Checked in to event.\n`);
    return;
  }

  if (f.create || (!f.join && !f.scan && !f.end && !f.update && !f.approve && !f.reject && !f['add-host'] && f.name)) {
    if (!f.name) return console.error("Usage: antenna event --create --name 'AI Meetup' --id <platform>:<user_id> --starts-at '2026-04-19T14:00' --ends-at '2026-04-19T18:00' [--lat 34.05 --lng -118.25] [--desc 'description'] [--og-image 'url'] [--requires-approval] [--screening-questions 'Q1|Q2']");
    if (!f.id) return console.error("❌ --id is required (e.g. --id <platform>:<user_id>). Creator identity needed to manage the event.");
    if (!f['starts-at'] || !f['ends-at']) return console.error("❌ --starts-at and --ends-at are required. Example: --starts-at '2026-04-19T14:00' --ends-at '2026-04-19T18:00'");
    const result = await createEvent({ name: f.name, device_id: f.id, lat: f.lat ? +f.lat : undefined, lng: f.lng ? +f.lng : undefined, starts_at: f['starts-at'], ends_at: f['ends-at'], description: f.desc || undefined, og_image: f['og-image'] || undefined, requires_approval: f['requires-approval'] === true || f['requires-approval'] === 'true' || undefined, screening_questions: f['screening-questions'] ? f['screening-questions'].split('|') : undefined });
    console.log(`\n🎉 Event created!\n`);
    console.log(`  Name: ${result.name}`);
    console.log(`  Code: ${result.code}`);
    console.log(`  URL:  ${result.url}`);
    console.log(`  Ends: ${result.ends_at}\n`);
    return;
  }

  if (f.join) {
    if (!f.code || !f.id) return console.error("Usage: antenna event --join --code abc123 --id <platform>:<user_id>");
    const result = await joinEvent({ code: f.code, device_id: f.id, lat: f.lat ? +f.lat : undefined, lng: f.lng ? +f.lng : undefined, application_context: f['application-context'] || undefined });
    if (result.joined) {
      if (result.status === 'pending') {
        console.log(`\n🟡 申请已提交，等待主办方审批\n`);
      } else {
        console.log(`\n✅ Joined "${result.event}"\n`);
        if (result.checked_in) console.log(`  自动签到 ✅\n`);
      }
    } else if (result.needs_screening) {
      console.log(`\n📝 这个活动需要审批。请回答以下问题：`);
      (result.screening_questions || []).forEach((q, i) => console.log(`  ${i + 1}. ${q}`));
      console.log(`\n回答后用 --application-context '你的回答' 重新 join\n`);
    } else {
      console.log(`\n❌ ${result.error || result.message}\n`);
    }
    return;
  }

  if (f.scan) {
    if (!f.code) return console.error("Usage: antenna event --scan --code abc123 [--id <platform>:<user_id>]");
    const result = await eventScan({ code: f.code, device_id: f.id || null });
    if (result.count === 0) return console.log("\n🏟️ No participants yet.\n");
    console.log(`\n🏟️ ${result.count} joined, ${result.checked_in_count || 0} checked in:\n`);
    result.profiles.forEach((p) => {
      const badge = p.checked_in ? " ✅" : "";
      const creatorTag = p.role === "creator" ? " [主办]" : "";
      const statusTag = p.status === "pending" ? " 🟡待审批" : "";
      console.log(`  ${p.emoji} ${p.name}${creatorTag}${badge}${statusTag}`);
      if (p.line1) console.log(`    ${p.line1}`);
      if (p.application_context) console.log(`    📝 ${p.application_context}`);
      console.log(`    ref: ${p.ref}\n`);
    });
    return;
  }

  if (f.approve) {
    if (!f.code || !f.id || !f.ref) return console.error("Usage: antenna event --approve --code abc123 --id <platform>:<user_id> --ref 1");
    const result = await approveParticipant({ code: f.code, device_id: f.id, ref: f.ref });
    if (result.approved) {
      console.log("\n✅ Participant approved\n");
    } else {
      console.log(`\n❌ ${result.error}\n`);
    }
    return;
  }

  if (f.reject) {
    if (!f.code || !f.id || !f.ref) return console.error("Usage: antenna event --reject --code abc123 --id <platform>:<user_id> --ref 1");
    const result = await rejectParticipant({ code: f.code, device_id: f.id, ref: f.ref });
    if (result.rejected) {
      console.log("\n✅ Participant rejected\n");
    } else {
      console.log(`\n❌ ${result.error}\n`);
    }
    return;
  }

  if (f.update) {
    if (!f.code || !f.id) return console.error("Usage: antenna event --update --code abc123 --id <platform>:<user_id> [--name 'New Name'] [--desc 'New desc']");
    const result = await updateEvent({ code: f.code, device_id: f.id, name: f.name, description: f.desc, og_image: f['og-image'], lat: f.lat ? +f.lat : undefined, lng: f.lng ? +f.lng : undefined, starts_at: f['starts-at'], ends_at: f['ends-at'] });
    if (result.updated) {
      console.log("\n✅ Event updated\n");
    } else {
      console.log(`\n❌ ${result.error}\n`);
    }
    return;
  }

  if (f['add-host']) {
    if (!f.code || !f.id || !f.ref) return console.error("Usage: antenna event --add-host --code abc123 --id <platform>:<user_id> --ref 1");
    const result = await addCohost({ code: f.code, device_id: f.id, ref: f.ref });
    if (result.added) {
      console.log("\n✅ Co-host added\n");
    } else {
      console.log(`\n❌ ${result.error}\n`);
    }
    return;
  }

  console.log(`Usage:
  antenna event --create --name 'AI Meetup' --starts-at '...' --ends-at '...' [--id <platform>:<user_id>] [--lat 34.05 --lng -118.25] [--desc 'description'] [--og-image 'url'] [--requires-approval] [--screening-questions 'Q1|Q2']
  antenna event --join --code abc123 --id <platform>:<user_id>
  antenna event --scan --code abc123 [--id <platform>:<user_id>]
  antenna event --checkin --code abc123 --id <platform>:<user_id> [--lat 34.05 --lng -118.24]
  antenna event --end --code abc123 --id <platform>:<user_id>
  antenna event --upload-image --code abc123 --file /path/to/image.png`);
}

export async function handleBind(f) {
  if (!f.id) return console.error("Usage: antenna bind --id <platform>:<user_id>");
  const result = await createBindToken({ device_id: f.id });
  console.log("\n🔗 GPS Binding Link:\n");
  console.log(`  ${result.url}\n`);
  console.log("Send this to the user. Opening it on their phone will share GPS with their agent.");
  console.log();
}

export async function handlePass(f) {
  if (!f.id) return console.error("Usage: antenna pass --id <platform>:<user_id> --target <ref_or_device_id>");
  if (!f.target && !f.ref) return console.error("Usage: antenna pass --id <platform>:<user_id> --target <ref_or_device_id> (or --ref 1)");
  const result = await passUser({
    device_id: f.id,
    target_device_id: f.target,
    ref: f.ref,
  });
  console.log("✅ " + (result.message || "Passed."));
}

export async function handleSetup(f) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

  console.log("\n📡 Antenna Setup — 创建你的名片\n");

  const id = f.id || await ask("Your device ID (e.g. discord:12345, hermes:myname): ");
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
  console.log("\n📡 Antenna Status\n");
  console.log(`  Supabase URL: ${supabaseUrl}`);

  // Check watch process
  const pidFile = path.join(os.homedir(), '.antenna', 'watch.pid');
  try {
    if (existsSync(pidFile)) {
      const content = readFileSync(pidFile, 'utf8').trim();
      const [pidStr, watchId] = content.split(':');
      const pid = parseInt(pidStr);
      try { process.kill(pid, 0); console.log(`  Watch: ✅ running (PID ${pid}${watchId ? ', id=' + watchId : ''})`); }
      catch { console.log('  Watch: ❌ stale PID file (process dead)'); }
    } else {
      console.log('  Watch: ❌ not running');
    }
  } catch { console.log('  Watch: ❌ not running'); }

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

  // 4. Auto-configure webhook for deliver-only push notifications
  try {
    // Check if hermes CLI supports --deliver-only
    const helpText = execSync('hermes webhook subscribe --help', { stdio: 'pipe', timeout: 5000 }).toString();
    if (helpText.includes('--deliver-only')) {
      // Check if antenna-notify already exists
      const existing = execSync('hermes webhook list --json', { stdio: 'pipe', timeout: 5000 }).toString();
      const hooks = JSON.parse(existing);
      if (!hooks.find(h => h.name === 'antenna-notify')) {
        execSync('hermes webhook subscribe antenna-notify --prompt "{message}" --deliver telegram --deliver-only --description "Antenna push notifications"', { stdio: 'pipe', timeout: 10000 });
        console.log("\n🔔 Webhook: antenna-notify (deliver-only → telegram)");
      } else {
        console.log("\n🔔 Webhook: antenna-notify already configured");
      }
    }
  } catch {
    // Webhook not available (older Hermes or gateway not running), skip silently
  }

  console.log("\n✅ Antenna installed for Hermes! (Plugin + Skill + deps)");
  console.log("   Restart Hermes to activate.");
  console.log();
}

export async function handleWatch(f) {
  const id = f.id;
  if (!id) {
    console.error("❌ --id required (e.g. --id <platform>:<user_id>)");
    process.exit(1);
  }

  // Write PID file for health check
  const pidDir = path.join(os.homedir(), '.antenna');
  const pidFile = path.join(pidDir, 'watch.pid');

  // Check for existing watch process (store PID:deviceId for cross-version dedup)
  if (existsSync(pidFile)) {
    try {
      const content = readFileSync(pidFile, 'utf8').trim();
      const [pidStr] = content.split(':');
      const existingPid = parseInt(pidStr);
      process.kill(existingPid, 0); // throws if not running
      console.error(`❌ Watch already running (PID ${existingPid}). Kill it first or remove ${pidFile}`);
      process.exit(1);
    } catch (e) {
      if (e.code !== 'ESRCH') { /* process exists */ throw e; }
      // Process not running, stale PID file — continue
    }
  }

  try {
    if (!existsSync(pidDir)) mkdirSync(pidDir, { recursive: true });
    writeFileSync(pidFile, `${process.pid}:${id}`);
  } catch {}
  process.on('exit', () => { try { unlinkSync(pidFile); } catch {} });
  process.on('SIGINT', () => { try { unlinkSync(pidFile); } catch {} process.exit(0); });
  process.on('SIGTERM', () => { try { unlinkSync(pidFile); } catch {} process.exit(0); });

  const sb = getClient();

  // Persist notified set to disk
  const notifiedFile = path.join(pidDir, 'notified.json');

  function loadNotified() {
    try {
      const data = JSON.parse(readFileSync(notifiedFile, 'utf8'));
      const now = Date.now();
      const TTL = 48 * 60 * 60 * 1000;
      const set = new Set();
      for (const [key, ts] of Object.entries(data)) {
        if (now - ts < TTL) set.add(key);
      }
      return set;
    } catch { return new Set(); }
  }

  function saveNotified(set) {
    const now = Date.now();
    const obj = {};
    for (const key of set) obj[key] = now;
    const tmp = notifiedFile + '.tmp';
    writeFileSync(tmp, JSON.stringify(obj));
    renameSync(tmp, notifiedFile);
  }

  const notified = loadNotified();

  // Detect local agent frameworks for push notifications
  // Push to ALL available frameworks, not just one
  const pushMethods = new Set();
  if (f.push) {
    // Support both --push hermes,openclaw and --push hermes --push openclaw
    const raw = Array.isArray(f.push) ? f.push : [f.push];
    raw.forEach(v => v.split(",").forEach(m => pushMethods.add(m.trim())));
  } else {
    try {
      execSync("which openclaw", { stdio: "pipe" });
      try {
        execSync("openclaw gateway health", { stdio: "pipe", timeout: 5000 });
        pushMethods.add("openclaw");
      } catch { /* gateway not running */ }
    } catch { /* openclaw not installed */ }
    try {
      execSync("which hermes", { stdio: "pipe" });
      try {
        execSync("hermes gateway status", { stdio: "pipe", timeout: 5000 });
        pushMethods.add("hermes");
      } catch { /* hermes gateway not running */ }
    } catch { /* hermes not installed */ }
  }

  // Force stdout blocking mode for non-TTY environments (Hermes exec)
  try { if (process.stdout._handle) process.stdout._handle.setBlocking(true); } catch {}

  // Log to file as fallback
  const logDir = path.join(os.homedir(), '.antenna');
  const logFile = path.join(logDir, 'watch.log');
  try { if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true }); } catch {}
  const logStream = await import('fs').then(fs => fs.createWriteStream(logFile, { flags: 'a' }));
  const _log = (msg = "") => {
    const line = `[${new Date().toISOString()}] ${msg}`;
    console.log(msg);
    try { logStream.write(line + '\n'); } catch {}
  };

  _log(`📡 Watching for new matches for ${id}...`);
  if (pushMethods.size > 0) {
    _log(`   🔗 Push targets: ${[...pushMethods].join(", ")}`);
  } else {
    _log(`   ℹ️  No agent framework detected — notifications will print here.`);
  }
  _log(`   Press Ctrl+C to stop.\n`);

  // Keep process alive (prevent exit when backgrounded)
  process.stdin.resume();

  // Push notification helper
  async function pushNotify(message) {
    _log(message); // always print to terminal

    // Push to ALL available frameworks
    if (pushMethods.has("openclaw")) {
      try {
        const profile = await getProfile({ device_id: id });
        const chatId = profile?.last_chat_id;
        const parts = id.split(":");
        const chan = parts[0];
        if (chatId) {
          execSync(
            `openclaw message send --channel ${chan} --target ${chatId} -m ${JSON.stringify(message)}`,
            { timeout: 30_000, stdio: "pipe" }
          );
        } else {
          execSync(
            `openclaw agent --message ${JSON.stringify(message)} --deliver --agent main --to ${id}`,
            { timeout: 30_000, stdio: "pipe" }
          );
        }
      } catch (err) { /* terminal output is the fallback */ }
    }
    if (pushMethods.has("hermes")) {
      // Try webhook deliver-only first (instant, zero LLM cost), fallback to cron
      let hermesPushed = false;
      try {
        const webhookInfo = execSync('hermes webhook list --json', { timeout: 10_000, stdio: 'pipe' }).toString();
        const hooks = JSON.parse(webhookInfo);
        const antennaHook = hooks.find(h => h.name === 'antenna-notify' && h.deliver_only);
        if (antennaHook) {
          const url = antennaHook.url || 'http://localhost:8644/webhooks/antenna-notify';
          const secret = antennaHook.secret;
          const body = JSON.stringify({ message });
          const curlCmd = secret
            ? `curl -s -X POST ${JSON.stringify(url)} -H 'Content-Type: application/json' -H 'X-Webhook-Signature: sha256='$(echo -n ${JSON.stringify(body)} | openssl dgst -sha256 -hmac ${JSON.stringify(secret)} | cut -d' ' -f2) -d ${JSON.stringify(body)}`
            : `curl -s -X POST ${JSON.stringify(url)} -H 'Content-Type: application/json' -d ${JSON.stringify(body)}`;
          execSync(curlCmd, { timeout: 10_000, stdio: 'pipe' });
          hermesPushed = true;
        }
      } catch { /* webhook not available */ }
      if (!hermesPushed) {
        try {
          execSync(
            `hermes cron create "1m" ${JSON.stringify("[SYSTEM] Forward the following notification to the user exactly as-is. Do not analyze, reply, or add anything.\n\n" + message)} --name "Antenna" --deliver telegram --repeat 1`,
            { timeout: 30_000, stdio: "pipe" }
          );
        } catch (err) { /* terminal output is the fallback */ }
      }
    }
  }

  // Initial check
  const initial = await checkMatches({ device_id: id });
  if (initial.mutual_matches?.length) {
    _log(`🎉 You have ${initial.mutual_matches.length} mutual match(es)!`);
    for (const m of initial.mutual_matches) {
      const key = `mutual:${m._device_id}`;
      notified.add(key);
      _log(`   ${m.emoji || "👤"} ${m.name}${m.their_contact ? " — contact: " + m.their_contact : ""}`);
    }
    saveNotified(notified);
    _log("");
  }
  if (initial.incoming_accepts?.length) {
    _log(`📩 ${initial.incoming_accepts.length} person(s) want to meet you!`);
    for (const m of initial.incoming_accepts) {
      const key = `incoming:${m._device_id}`;
      notified.add(key);
      _log(`   ${m.emoji || "👤"} ${m.name} — ${m.line1 || ""}`);
    }
    saveNotified(notified);
    _log("");
  }

  // Seed notified set with current event states (don't push, just record)
  try {
    const { data: evts } = await sb.rpc("get_my_event_updates", { p_device_id: id });
    for (const ev of (evts || [])) {
      notified.add(`event:${ev.event_id}:${ev.status}`);
    }
    saveNotified(notified);
  } catch { /* silent */ }

  // Subscribe to realtime changes on matches table
  const channel = sb
    .channel("antenna-cli-watch")
    .on("postgres_changes",
      { event: "INSERT", schema: "public", table: "matches" },
      async (payload) => {
        try {
          const row = payload.new;
          if (!row) return;

          // Someone accepted me
          if (row.device_id_b === id) {
            const key = `incoming:${row.device_id_a}`;
            if (notified.has(key)) return;
            notified.add(key);

            const profile = await getProfile({ device_id: row.device_id_a });
            const name = profile?.display_name || "Someone";
            const emoji = profile?.emoji || "👤";

            // Check if mutual
            const matches = await checkMatches({ device_id: id });
            const isMutual = matches.mutual_matches?.some(m => m._device_id === row.device_id_a);

            if (isMutual) {
              const mutualKey = `mutual:${row.device_id_a}`;
              notified.add(mutualKey);
              saveNotified(notified);
              const contact = row.contact_info_a;
              pushNotify(`🎉 MUTUAL MATCH! ${emoji} ${name} also accepted you!${contact ? " Contact: " + contact : ""}`);
            } else {
              notified.add(key);
              saveNotified(notified);
              pushNotify(`📩 ${emoji} ${name} wants to meet you! Use 'antenna matches --id ${id}' to respond.`);
            }
          }

          // I accepted someone and they also accepted me
          if (row.device_id_a === id) {
            const matches = await checkMatches({ device_id: id });
            const mutual = matches.mutual_matches?.find(m => m._device_id === row.device_id_b);
            if (mutual) {
              const mutualKey = `mutual:${row.device_id_b}`;
              if (!notified.has(mutualKey)) {
                notified.add(mutualKey);
                saveNotified(notified);
                pushNotify(`🎉 MUTUAL MATCH! ${mutual.emoji || "👤"} ${mutual.name}!${mutual.their_contact ? " Contact: " + mutual.their_contact : ""}`);
              }
            }
          }
        } catch (err) {
          // silent
        }
      }
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        retryCount = 0;
        _log("✅ Connected — listening for matches in real-time.");
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        retryCount++;
        if (retryCount < MAX_FAST_RETRIES) {
          const delay = Math.min(1000 * Math.pow(2, retryCount), 60000);
          _log(`⚠️  Connection issue (${status}), retry #${retryCount} in ${Math.round(delay/1000)}s...`);
          setTimeout(() => { try { channel.subscribe(); } catch {} }, delay);
        } else if (retryCount === MAX_FAST_RETRIES) {
          _log(`⚠️  Connection unstable after ${MAX_FAST_RETRIES} retries. Switching to ${COOLDOWN_MS/1000}s cooldown. Polling fallback still active.`);
          setTimeout(() => { try { channel.subscribe(); } catch {} }, COOLDOWN_MS);
        } else {
          setTimeout(() => { try { channel.subscribe(); } catch {} }, COOLDOWN_MS);
        }
      }
    });

  // Reconnection state for matches channel
  let retryCount = 0;
  const MAX_FAST_RETRIES = 20;
  const COOLDOWN_MS = 5 * 60 * 1000; // 5 min

  // Subscribe to event_participants changes (approval notifications)
  sb
    .channel("antenna-cli-watch-events")
    .on("postgres_changes",
      { event: "INSERT", schema: "public", table: "event_participants" },
      async (payload) => {
        try {
          const row = payload.new;
          if (!row || row.status !== "pending") return;
          // Someone applied to my event — check if I'm the creator
          const event = await sb.rpc("get_event_by_id", { p_event_id: row.event_id }).then(r => r.data);
          if (!event?.found || event.created_by !== id) return;
          const applicant = await getProfile({ device_id: row.device_id });
          const name = applicant?.display_name || "Someone";
          const emoji = applicant?.emoji || "👤";
          pushNotify(`📩 ${emoji} ${name} applied to join \"${event.name}\"! Run: antenna event --scan --code ${event.code} --id ${id}`);
        } catch {}
      }
    )
    .on("postgres_changes",
      { event: "UPDATE", schema: "public", table: "event_participants" },
      async (payload) => {
        try {
          const row = payload.new;
          const old = payload.old;
          if (!row || !old) return;
          // My application was approved/rejected
          if (row.device_id !== id) return;
          if (old.status === "pending" && row.status === "active") {
            const event = await sb.rpc("get_event_by_id", { p_event_id: row.event_id }).then(r => r.data);
            pushNotify(`✅ Your application to \"${event?.name || 'an event'}\" was approved! You're in.`);
          } else if (old.status === "pending" && row.status === "rejected") {
            const event = await sb.rpc("get_event_by_id", { p_event_id: row.event_id }).then(r => r.data);
            pushNotify(`❌ Your application to \"${event?.name || 'an event'}\" was not approved.`);
          }
        } catch {}
      }
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        _log("✅ Connected — listening for event notifications.");
      }
    });

  // Keep alive — also poll every 2 minutes as fallback
  // (Realtime may not work without SELECT policies)
  const pollInterval = setInterval(async () => {
    try {
      const result = await checkMatches({ device_id: id });
      for (const m of (result.mutual_matches || [])) {
        const key = `mutual:${m._device_id}`;
        if (!notified.has(key)) {
          notified.add(key);
          saveNotified(notified);
          pushNotify(`🎉 MUTUAL MATCH! ${m.emoji || "👤"} ${m.name}!${m.their_contact ? " Contact: " + m.their_contact : ""}`);
        }
      }
      for (const m of (result.incoming_accepts || [])) {
        const key = `incoming:${m._device_id}`;
        if (!notified.has(key)) {
          notified.add(key);
          saveNotified(notified);
          pushNotify(`📩 ${m.emoji || "👤"} ${m.name} wants to meet you!`);
        }
      }
    } catch { /* silent */ }

    // Poll event status changes (approval/rejection)
    try {
      const { data: events } = await sb.rpc("get_my_event_updates", { p_device_id: id });
      for (const ev of (events || [])) {
        const key = `event:${ev.event_id}:${ev.status}`;
        if (!notified.has(key)) {
          notified.add(key);
          saveNotified(notified);
          if (ev.status === "active" && ev.role !== "creator" && ev.role !== "cohost" && ev.requires_approval) {
            pushNotify(`✅ Your application to "${ev.event_name}" was approved! You're in.`);
          } else if (ev.status === "rejected") {
            pushNotify(`❌ Your application to "${ev.event_name}" was not approved.`);
          }
        }
      }
    } catch { /* silent */ }
  }, 2 * 60 * 1000);

  // Handle Ctrl+C
  process.on("SIGINT", () => {
    console.log("\n👋 Stopped watching.");
    clearInterval(pollInterval);
    sb.removeChannel(channel);
    process.exit(0);
  });
}

export function printHelp() {
  console.log(`📡 Antenna — nearby people discovery

Usage:
  antenna scan       --lat 39.99 --lng 116.48 [--radius 500] (max 1000) [--id <platform>:<user_id>]
  antenna checkin    --id <platform>:<user_id> --lat 39.99 --lng 116.48
  antenna profile    --id <platform>:<user_id> [--name Yi --emoji 🦦 --line1 '...']
  antenna accept     --id <platform>:<user_id> --target <ref_or_device_id> [--contact 'WeChat: yi']
  antenna pass       --id <platform>:<user_id> --target <ref_or_device_id> (or --ref 1)
  antenna matches    --id <platform>:<user_id>
  antenna discover   --id <platform>:<user_id>
  antenna event      --create --name 'AI Meetup' --starts-at '...' --ends-at '...' [--lat 34.05 --lng -118.25] [--desc '...'] [--og-image 'url'] [--requires-approval] [--screening-questions 'Q1|Q2'] | --join --code abc123 | --scan --code abc123 | --end --code abc123 --id <platform>:<user_id> | --upload-image --code abc123 --file /path/to/image.png | --update --code abc123 --name 'New Name' | --approve --code abc123 --ref 1 | --reject --code abc123 --ref 1 | --add-host --code abc123 --ref 1
  antenna watch       --id <platform>:<user_id> [--push hermes|openclaw|terminal]  Watch for new matches in real-time (Ctrl+C to stop)
  antenna bind       --id <platform>:<user_id>
  antenna serve      Start MCP server (stdio transport)
  antenna setup      Interactive profile setup [--id <platform>:<user_id>]
  antenna status     Show config & status [--id <platform>:<user_id>]
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
