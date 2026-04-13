// antenna MCP server — started via `antenna serve`

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  scan,
  getProfile,
  setProfile,
  accept,
  checkMatches,
  checkin,
  createBindToken,
  deriveDeviceId,
} from "./core.js";

export async function startMcpServer() {
  const server = new McpServer({
    name: "Antenna",
    version: "0.9.2",
    description:
      "Nearby people discovery — scan for people around you, set up your profile card, accept matches, and check match status.",
  });

  function jsonResult(obj) {
    return { content: [{ type: "text", text: JSON.stringify(obj) }] };
  }

  // Store last scan ref map for resolving refs in accept
  let _lastRefMap = {};

  // ─── antenna_scan ──────────────────────────────────────────────────

  server.tool(
    "antenna_scan",
    "Scan for nearby people. Returns profiles with 'ref' numbers (1, 2, 3...) for privacy. Use these ref numbers when calling antenna_accept.",
    {
      lat: z.number().optional().describe("Latitude (optional if location was shared via web)"),
      lng: z.number().optional().describe("Longitude (optional if location was shared via web)"),
      radius_m: z.number().optional().default(500).describe("Search radius in meters (default 500, max 1000)"),
      sender_id: z.string().describe("The sender's user ID"),
      channel: z.string().describe("Channel name"),
    },
    async ({ lat, lng, radius_m, sender_id, channel }) => {
      try {
        const result = await scan({ lat, lng, radius_m, device_id: deriveDeviceId(sender_id, channel) });
        _lastRefMap = result._ref_map || {};
        const { _ref_map, ...clean } = result;
        return jsonResult(clean);
      } catch (e) {
        return jsonResult({ error: e.message });
      }
    }
  );

  // ─── antenna_profile ───────────────────────────────────────────────

  server.tool(
    "antenna_profile",
    "Get or set the user's Antenna profile card.",
    {
      action: z.enum(["get", "set"]).describe("'get' to read, 'set' to write"),
      sender_id: z.string().describe("The sender's user ID"),
      channel: z.string().describe("Channel name"),
      display_name: z.string().optional(),
      emoji: z.string().optional(),
      line1: z.string().optional(),
      line2: z.string().optional(),
      line3: z.string().optional(),
      visible: z.boolean().optional().default(true),
    },
    async ({ action, sender_id, channel, display_name, emoji, line1, line2, line3, visible }) => {
      const deviceId = deriveDeviceId(sender_id, channel);
      try {
        if (action === "get") {
          const data = await getProfile({ device_id: deviceId });
          return jsonResult(data ? { profile: data } : { profile: null, message: "还没有名片，帮你创建一个？" });
        }
        const data = await setProfile({ device_id: deviceId, display_name, emoji, line1, line2, line3, visible });
        return jsonResult({ saved: true, profile: data });
      } catch (e) {
        return jsonResult({ error: e.message });
      }
    }
  );

  // ─── antenna_accept ────────────────────────────────────────────────

  server.tool(
    "antenna_accept",
    "Accept a match. Use 'ref' from scan results (e.g. '1', '2') OR target_device_id directly.",
    {
      sender_id: z.string().describe("The sender's user ID"),
      channel: z.string().describe("Channel name"),
      ref: z.string().optional().describe("Ref number from scan results (e.g. '1')"),
      target_device_id: z.string().optional().describe("Device ID (use ref instead when possible)"),
      contact_info: z.string().optional().describe("Contact info to share"),
    },
    async ({ sender_id, channel, ref, target_device_id, contact_info }) => {
      try {
        let targetId = target_device_id;
        if (ref && _lastRefMap[ref]) {
          targetId = _lastRefMap[ref];
        }
        if (!targetId) {
          return jsonResult({ error: "No target specified. Use 'ref' from scan results or 'target_device_id'." });
        }
        const result = await accept({ device_id: deriveDeviceId(sender_id, channel), target_device_id: targetId, contact_info });
        return jsonResult(result);
      } catch (e) {
        return jsonResult({ error: e.message });
      }
    }
  );

  // ─── antenna_checkin ───────────────────────────────────────────────

  server.tool(
    "antenna_checkin",
    "Check in at a location — update your position so others can find you.",
    {
      lat: z.number().describe("Latitude"),
      lng: z.number().describe("Longitude"),
      sender_id: z.string().describe("The sender's user ID"),
      channel: z.string().describe("Channel name"),
      place_name: z.string().optional().describe("Name of the place"),
    },
    async ({ lat, lng, sender_id, channel, place_name }) => {
      try {
        const result = await checkin({ lat, lng, device_id: deriveDeviceId(sender_id, channel) });
        if (result.checked_in && place_name) {
          result.message = `已签到 (${place_name}) 📍 现在附近的人扫描就能看到你了。`;
        }
        return jsonResult(result);
      } catch (e) {
        return jsonResult({ error: e.message });
      }
    }
  );

  // ─── antenna_check_matches ─────────────────────────────────────────

  server.tool(
    "antenna_check_matches",
    "Check for mutual matches and incoming accepts.",
    {
      sender_id: z.string().describe("The sender's user ID"),
      channel: z.string().describe("Channel name"),
    },
    async ({ sender_id, channel }) => {
      try {
        const result = await checkMatches({ device_id: deriveDeviceId(sender_id, channel) });
        return jsonResult(result);
      } catch (e) {
        return jsonResult({ error: e.message });
      }
    }
  );

  // ─── antenna_bind ──────────────────────────────────────────────────

  server.tool(
    "antenna_bind",
    "Generate a GPS binding link. Send this to the user so they can share their phone's location via the web.",
    {
      sender_id: z.string().describe("The sender's user ID"),
      channel: z.string().describe("Channel name"),
    },
    async ({ sender_id, channel }) => {
      try {
        const result = await createBindToken({ device_id: deriveDeviceId(sender_id, channel) });
        return jsonResult(result);
      } catch (e) {
        return jsonResult({ error: e.message });
      }
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
