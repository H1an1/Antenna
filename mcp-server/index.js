#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

// ─── Config ──────────────────────────────────────────────────────────

const SUPABASE_URL =
  process.env.ANTENNA_SUPABASE_URL ||
  "https://bcudjloikmpcqwcptuyd.supabase.co";
const SUPABASE_KEY =
  process.env.ANTENNA_SUPABASE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJjdWRqbG9pa21wY3F3Y3B0dXlkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0MTg1NDgsImV4cCI6MjA4OTk5NDU0OH0.FaoC3QfpfHP1npNGjRchJAoAp2PdZtQe_WhP-t-GN1o";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── Helpers ─────────────────────────────────────────────────────────

function deriveDeviceId(senderId, channel) {
  return `${channel}:${senderId}`;
}

function fuzzyLocation(lat, lng) {
  return {
    lat: Math.round(lat * 1000) / 1000,
    lng: Math.round(lng * 1000) / 1000,
  };
}

// ─── MCP Server ──────────────────────────────────────────────────────

const server = new McpServer({
  name: "Antenna",
  version: "0.1.0",
  description:
    "Nearby people discovery — scan for people around you, set up your profile card, accept matches, and check match status.",
});

// ─── Tool: antenna_scan ──────────────────────────────────────────────

server.tool(
  "antenna_scan",
  "Scan for nearby people at a given location. Returns profile cards of people nearby. Use when the user shares their location or asks who's nearby.",
  {
    lat: z.number().describe("Latitude"),
    lng: z.number().describe("Longitude"),
    radius_m: z
      .number()
      .optional()
      .default(500)
      .describe("Search radius in meters (default: 500)"),
    sender_id: z.string().describe("The sender's user ID"),
    channel: z
      .string()
      .describe("The channel name (telegram, whatsapp, discord, etc.)"),
  },
  async ({ lat, lng, radius_m, sender_id, channel }) => {
    const deviceId = deriveDeviceId(sender_id, channel);
    const fuzzy = fuzzyLocation(lat, lng);

    // Upsert location
    await supabase.rpc("upsert_profile_location", {
      p_device_id: deviceId,
      p_lng: fuzzy.lng,
      p_lat: fuzzy.lat,
    });

    // Query nearby
    const { data, error } = await supabase.rpc("nearby_profiles", {
      p_lat: fuzzy.lat,
      p_lng: fuzzy.lng,
      p_radius_m: radius_m,
    });

    if (error) {
      return { content: [{ type: "text", text: JSON.stringify({ error: error.message }) }] };
    }

    const others = (data || []).filter((p) => p.device_id !== deviceId);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            count: others.length,
            radius_m,
            profiles: others.map((p) => ({
              device_id: p.device_id,
              name: p.display_name || "匿名",
              emoji: p.emoji || "👤",
              line1: p.line1,
              line2: p.line2,
              line3: p.line3,
              distance_m: p.distance_m,
            })),
          }),
        },
      ],
    };
  }
);

// ─── Tool: antenna_profile ───────────────────────────────────────────

server.tool(
  "antenna_profile",
  "Get or set the user's Antenna profile card. Use action='get' to read, action='set' to write.",
  {
    action: z.enum(["get", "set"]).describe("'get' to read profile, 'set' to write"),
    sender_id: z.string().describe("The sender's user ID"),
    channel: z.string().describe("Channel name"),
    display_name: z.string().optional().describe("Display name"),
    emoji: z.string().optional().describe("Emoji avatar"),
    line1: z.string().optional().describe("Card line 1"),
    line2: z.string().optional().describe("Card line 2"),
    line3: z.string().optional().describe("Card line 3"),
    visible: z.boolean().optional().default(true).describe("Profile visibility"),
  },
  async ({ action, sender_id, channel, display_name, emoji, line1, line2, line3, visible }) => {
    const deviceId = deriveDeviceId(sender_id, channel);

    if (action === "get") {
      const { data, error } = await supabase.rpc("get_profile", { p_device_id: deviceId });
      if (error || !data) {
        return { content: [{ type: "text", text: JSON.stringify({ profile: null, message: "还没有名片，帮你创建一个？" }) }] };
      }
      return { content: [{ type: "text", text: JSON.stringify({ profile: data }) }] };
    }

    // set
    const { data, error } = await supabase.rpc("upsert_profile", {
      p_device_id: deviceId,
      p_display_name: display_name || null,
      p_emoji: emoji || "👤",
      p_line1: line1 || null,
      p_line2: line2 || null,
      p_line3: line3 || null,
      p_visible: visible,
    });

    if (error) {
      return { content: [{ type: "text", text: JSON.stringify({ error: error.message }) }] };
    }
    return { content: [{ type: "text", text: JSON.stringify({ saved: true, profile: data }) }] };
  }
);

// ─── Tool: antenna_accept ────────────────────────────────────────────

server.tool(
  "antenna_accept",
  "Accept a match with another person. Optionally share contact info.",
  {
    sender_id: z.string().describe("The sender's user ID"),
    channel: z.string().describe("Channel name"),
    target_device_id: z.string().describe("Device ID of the person to accept"),
    contact_info: z.string().optional().describe("Contact info to share (WeChat, Telegram, phone, etc.)"),
  },
  async ({ sender_id, channel, target_device_id, contact_info }) => {
    const deviceId = deriveDeviceId(sender_id, channel);

    const { data, error } = await supabase.rpc("upsert_match", {
      p_device_id_a: deviceId,
      p_device_id_b: target_device_id,
      p_reason: "",
      p_score: 0,
      p_status: "accepted",
      p_contact_info: contact_info || null,
      p_expires_hours: 24,
    });

    if (error) {
      return { content: [{ type: "text", text: JSON.stringify({ error: error.message }) }] };
    }

    // Check if mutual
    const { data: reverse } = await supabase
      .from("matches")
      .select("status, contact_info_a")
      .eq("device_id_a", target_device_id)
      .eq("device_id_b", deviceId)
      .eq("status", "accepted")
      .single();

    const mutual = !!reverse;

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            accepted: true,
            mutual,
            their_contact: mutual ? reverse.contact_info_a || null : null,
            message: mutual
              ? "双向匹配成功！🎉"
              : "已接受。等对方也接受后，你们就可以交换联系方式了。",
          }),
        },
      ],
    };
  }
);

// ─── Tool: antenna_check_matches ─────────────────────────────────────

server.tool(
  "antenna_check_matches",
  "Check for mutual matches and incoming accepts. Use periodically or when the user asks about match status.",
  {
    sender_id: z.string().describe("The sender's user ID"),
    channel: z.string().describe("Channel name"),
  },
  async ({ sender_id, channel }) => {
    const deviceId = deriveDeviceId(sender_id, channel);

    const { data: allMatches } = await supabase.rpc("get_my_matches", { p_device_id: deviceId });

    if (!allMatches?.length) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ mutual_matches: [], incoming_accepts: [], message: "目前没有进行中的匹配。" }),
          },
        ],
      };
    }

    const myMatches = allMatches.filter((m) => m.device_id_a === deviceId);
    const incomingMatches = allMatches.filter((m) => m.device_id_b === deviceId);

    // Mutual matches
    const mutualMatches = [];
    for (const match of myMatches) {
      const reverse = incomingMatches.find((m) => m.device_id_a === match.device_id_b);
      if (reverse) {
        const { data: profile } = await supabase.rpc("get_profile", { p_device_id: match.device_id_b });
        mutualMatches.push({
          device_id: match.device_id_b,
          name: profile?.display_name || "匿名",
          emoji: profile?.emoji || "👤",
          line1: profile?.line1,
          line2: profile?.line2,
          line3: profile?.line3,
          their_contact: reverse.contact_info_a || null,
          you_shared: match.contact_info_a || null,
        });
      }
    }

    // Incoming accepts (they accepted me, I haven't accepted them)
    const incomingAccepts = [];
    for (const match of incomingMatches) {
      const iAccepted = myMatches.find((m) => m.device_id_b === match.device_id_a);
      if (!iAccepted) {
        const { data: profile } = await supabase.rpc("get_profile", { p_device_id: match.device_id_a });
        incomingAccepts.push({
          device_id: match.device_id_a,
          name: profile?.display_name || "匿名",
          emoji: profile?.emoji || "👤",
          line1: profile?.line1,
          line2: profile?.line2,
          line3: profile?.line3,
        });
      }
    }

    const messages = [];
    if (mutualMatches.length > 0) messages.push(`${mutualMatches.length} 个双向匹配！可以交换联系方式了`);
    if (incomingAccepts.length > 0) messages.push(`${incomingAccepts.length} 个人想认识你，等你回应`);
    if (messages.length === 0) messages.push("你接受了一些匹配，但对方还没有回应。耐心等等 ⏳");

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            mutual_matches: mutualMatches,
            incoming_accepts: incomingAccepts,
            message: messages.join("；"),
          }),
        },
      ],
    };
  }
);

// ─── Start ───────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
