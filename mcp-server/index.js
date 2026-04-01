#!/usr/bin/env node

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
  deriveDeviceId,
} from "../core/index.js";

const server = new McpServer({
  name: "Antenna",
  version: "0.1.0",
  description:
    "Nearby people discovery — scan for people around you, set up your profile card, accept matches, and check match status.",
});

function jsonResult(obj) {
  return { content: [{ type: "text", text: JSON.stringify(obj) }] };
}

// ─── antenna_scan ────────────────────────────────────────────────────

server.tool(
  "antenna_scan",
  "Scan for nearby people at a given location.",
  {
    lat: z.number().describe("Latitude"),
    lng: z.number().describe("Longitude"),
    radius_m: z.number().optional().default(500).describe("Search radius in meters"),
    sender_id: z.string().describe("The sender's user ID"),
    channel: z.string().describe("Channel name (telegram, whatsapp, discord, etc.)"),
  },
  async ({ lat, lng, radius_m, sender_id, channel }) => {
    try {
      const result = await scan({ lat, lng, radius_m, device_id: deriveDeviceId(sender_id, channel) });
      return jsonResult(result);
    } catch (e) {
      return jsonResult({ error: e.message });
    }
  }
);

// ─── antenna_profile ─────────────────────────────────────────────────

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

// ─── antenna_accept ──────────────────────────────────────────────────

server.tool(
  "antenna_accept",
  "Accept a match with another person.",
  {
    sender_id: z.string().describe("The sender's user ID"),
    channel: z.string().describe("Channel name"),
    target_device_id: z.string().describe("Device ID of the person to accept"),
    contact_info: z.string().optional().describe("Contact info to share"),
  },
  async ({ sender_id, channel, target_device_id, contact_info }) => {
    try {
      const result = await accept({ device_id: deriveDeviceId(sender_id, channel), target_device_id, contact_info });
      return jsonResult(result);
    } catch (e) {
      return jsonResult({ error: e.message });
    }
  }
);

// ─── antenna_checkin ─────────────────────────────────────────────────

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

// ─── antenna_check_matches ──────────────────────────────────────────

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

const transport = new StdioServerTransport();
await server.connect(transport);
