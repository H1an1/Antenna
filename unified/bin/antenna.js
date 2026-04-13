#!/usr/bin/env node

import {
  parseFlags,
  handleScan,
  handleProfile,
  handleAccept,
  handleCheckin,
  handleMatches,
  handleBind,
  handleSetup,
  handleStatus,
  handleInstallSkill,
  handleInstallPlugin,
  handleInstallHermesPlugin,
  printHelp,
} from "../lib/cli.js";

const [,, cmd, ...args] = process.argv;
const f = parseFlags(args);

async function main() {
  switch (cmd) {
    case "scan":
      return handleScan(f);
    case "profile":
      return handleProfile(f);
    case "accept":
      return handleAccept(f);
    case "checkin":
      return handleCheckin(f);
    case "matches":
      return handleMatches(f);
    case "bind":
      return handleBind(f);
    case "serve": {
      const { startMcpServer } = await import("../lib/mcp.js");
      return startMcpServer();
    }
    case "setup":
      return handleSetup(f);
    case "status":
      return handleStatus(f);
    case "install-skill":
      return handleInstallSkill();
    case "install-plugin":
      return handleInstallPlugin();
    case "install-hermes":
      return handleInstallHermesPlugin();
    case "help":
    default:
      return printHelp();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
