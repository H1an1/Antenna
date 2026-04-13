// postinstall — auto-detect agent platforms and install

import { existsSync, mkdirSync, copyFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";
import { execSync } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const home = homedir();
let installed = [];

console.log("\n📡 Antenna — Nearby People Discovery\n");

// ── Hermes ────────────────────────────────────────────────────────
const hermesHome = join(home, ".hermes");
if (existsSync(hermesHome)) {
  try {
    // Plugin
    const pluginDir = join(hermesHome, "plugins", "antenna");
    const templateDir = join(__dirname, "lib", "hermes-plugin");
    if (!existsSync(pluginDir)) mkdirSync(pluginDir, { recursive: true });
    for (const f of ["plugin.yaml", "__init__.py", "schemas.py", "tools.py"]) {
      const src = join(templateDir, f);
      if (existsSync(src)) copyFileSync(src, join(pluginDir, f));
    }

    // Skill
    const skillDir = join(hermesHome, "skills", "antenna");
    if (!existsSync(skillDir)) mkdirSync(skillDir, { recursive: true });
    copyFileSync(join(__dirname, "skill", "SKILL.md"), join(skillDir, "SKILL.md"));

    // Deps
    const hermesAgent = join(hermesHome, "hermes-agent");
    if (existsSync(hermesAgent)) {
      try {
        execSync("uv pip install supabase", { cwd: hermesAgent, stdio: "ignore", timeout: 60_000 });
      } catch {
        try {
          execSync("pip install supabase", { stdio: "ignore", timeout: 60_000 });
        } catch { /* user can install manually */ }
      }
    }

    installed.push("Hermes (Plugin + Skill + deps)");
  } catch (e) {
    console.log(`  ⚠️  Hermes detected but setup failed: ${e.message}`);
  }
}

// ── OpenClaw ──────────────────────────────────────────────────────
const openclawHome = join(home, ".openclaw");
if (existsSync(openclawHome)) {
  try {
    const skillDir = join(openclawHome, "skills", "antenna");
    if (!existsSync(skillDir)) mkdirSync(skillDir, { recursive: true });
    copyFileSync(join(__dirname, "skill", "SKILL.md"), join(skillDir, "SKILL.md"));
    installed.push("OpenClaw (Skill)");
  } catch (e) {
    console.log(`  ⚠️  OpenClaw detected but setup failed: ${e.message}`);
  }
}

// ── Result ────────────────────────────────────────────────────────
if (installed.length > 0) {
  console.log("  ✅ Auto-configured for: " + installed.join(", "));
  console.log("     Restart your agent to activate.\n");
} else {
  console.log("  No agent platform detected (~/.hermes or ~/.openclaw).");
  console.log("  You can still use the CLI: antenna help\n");
}

console.log("  Quick start:");
console.log("    antenna setup              Create your card");
console.log("    antenna scan --lat … --lng …   Find people");
console.log("    antenna serve              Start MCP server");
console.log("    antenna help               Full usage\n");
