// antenna MCP server — started via `antenna serve`

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  scan,
  getProfile,
  setProfile,
  accept,
  pass,
  checkMatches,
  checkin,
  createBindToken,
  discover,
  createEvent,
  endEvent,
  eventCheckin,
  joinEvent,
  eventScan,
  uploadEventImage,
  updateEvent,
  approveParticipant,
  rejectParticipant,
  addCohost,
  sendEventMessage,
  deriveDeviceId,
  PROFILE_FIELDS,
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

  // Track known device_ids and last notified matches for piggyback notifications
  const _knownDeviceIds = new Set();
  const _notifiedMatches = new Set();

  // Piggyback match check: append pending notifications to any tool response
  async function withMatchNotifications(deviceId, result) {
    _knownDeviceIds.add(deviceId);
    try {
      const matches = await checkMatches({ device_id: deviceId });
      const notifications = [];

      for (const m of (matches.mutual_matches || [])) {
        const key = `mutual:${m.device_id}`;
        if (!_notifiedMatches.has(key)) {
          _notifiedMatches.add(key);
          notifications.push(`🎉 双向匹配！${m.emoji || "👤"} ${m.name} 也接受了你！${m.their_contact ? "联系方式：" + m.their_contact : ""}`);
        }
      }
      for (const m of (matches.incoming_accepts || [])) {
        const key = `incoming:${m.device_id}`;
        if (!_notifiedMatches.has(key)) {
          _notifiedMatches.add(key);
          notifications.push(`📩 ${m.emoji || "👤"} ${m.name} 想认识你！用 antenna_check_matches 查看详情。`);
        }
      }

      if (notifications.length > 0) {
        result._pending_notifications = notifications;
      }
    } catch { /* silent */ }
    return result;
  }

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
        const deviceId = deriveDeviceId(sender_id, channel);
        const result = await scan({ lat, lng, radius_m, device_id: deviceId });
        _lastRefMap = result._ref_map || {};
        const { _ref_map, ...clean } = result;
        return jsonResult(await withMatchNotifications(deviceId, clean));
      } catch (e) {
        return jsonResult({ error: e.message });
      }
    }
  );

  // ─── antenna_profile ───────────────────────────────────────────────

  server.tool(
    "antenna_profile",
    "Get or set the user's Antenna profile card. The profile has a display name and three descriptions: personal description, looking for, and conversation style.",
    {
      action: z.enum(["get", "set"]).describe("'get' to read, 'set' to write"),
      sender_id: z.string().describe("The sender's user ID"),
      channel: z.string().describe("Channel name"),
      display_name: z.string().optional().describe("Display name"),
      emoji: z.string().optional().describe("Profile emoji (stored but not displayed on card)"),
      line1: z.string().optional().describe("Personal description — who you are and what you do (max 220 chars)"),
      line2: z.string().optional().describe("Looking for — the kind of people you want to meet (max 140 chars)"),
      line3: z.string().optional().describe("Conversation style — the type of conversations you want (max 160 chars)"),
      matching_context: z.string().optional().describe("Agent-generated rich context for embedding-based matching (not shown to others, max 1000 chars). Generate this FIRST, then derive the three descriptions from it."),
      interest_tags: z.array(z.string()).optional().describe("Interest/topic tags shown on the card (up to 8)"),
      city: z.string().optional().describe("Country or region (e.g. 'United States', 'Beijing')"),
      links: z.array(z.string()).optional().describe("Social links shown on the card footer (up to 3)"),
      is_active: z.boolean().optional().describe("Whether the profile is active or quiet"),
      visible: z.boolean().optional().default(true),
    },
    async ({ action, sender_id, channel, display_name, emoji, line1, line2, line3, matching_context, interest_tags, city, links, is_active, visible }) => {
      const deviceId = deriveDeviceId(sender_id, channel);
      try {
        if (action === "get") {
          const data = await getProfile({ device_id: deviceId });
          const result = data
            ? { profile: data, fields: PROFILE_FIELDS }
            : { profile: null, message: "还没有名片。跟用户聊聊他们是谁、做什么、想认识什么人，然后帮他们创建。", fields: PROFILE_FIELDS };
          return jsonResult(await withMatchNotifications(deviceId, result));
        }
        const data = await setProfile({ device_id: deviceId, display_name, emoji, line1, line2, line3, matching_context, interest_tags, city, links, is_active, visible });
        return jsonResult(await withMatchNotifications(deviceId, { saved: true, profile: data }));
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
        const deviceId = deriveDeviceId(sender_id, channel);
        const result = await accept({ device_id: deviceId, target_device_id, ref, contact_info });
        return jsonResult(await withMatchNotifications(deviceId, result));
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
        const deviceId = deriveDeviceId(sender_id, channel);
        const result = await checkin({ lat, lng, device_id: deviceId });
        if (result.checked_in && place_name) {
          result.message = `已签到 (${place_name}) 📍 现在附近的人扫描就能看到你了。`;
        }
        return jsonResult(await withMatchNotifications(deviceId, result));
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
        const deviceId = deriveDeviceId(sender_id, channel);
        const result = await checkMatches({ device_id: deviceId });
        // Mark all as notified since user explicitly checked
        for (const m of (result.mutual_matches || [])) _notifiedMatches.add(`mutual:${m.device_id}`);
        for (const m of (result.incoming_accepts || [])) _notifiedMatches.add(`incoming:${m.device_id}`);
        return jsonResult(result);
      } catch (e) {
        return jsonResult({ error: e.message });
      }
    }
  );

  // ─── antenna_bind ──────────────────────────────────────────────────

  server.tool(
    "antenna_bind",
    "Generate a GPS binding link. Send this to the user so they can share their phone's location via the web. Use purpose='event' + event_code when creating a link for setting an event's location.",
    {
      sender_id: z.string().describe("The sender's user ID"),
      channel: z.string().describe("Channel name"),
      purpose: z.string().optional().describe("'profile' (default) or 'event'"),
      event_code: z.string().optional().describe("Event code (required when purpose=event)"),
    },
    async ({ sender_id, channel, purpose, event_code }) => {
      try {
        const result = await createBindToken({ device_id: deriveDeviceId(sender_id, channel), purpose, event_code });
        return jsonResult(result);
      } catch (e) {
        return jsonResult({ error: e.message });
      }
    }
  );

  // ─── antenna_discover ────────────────────────────────────────

  server.tool(
    "antenna_discover",
    "Get today's global recommendation — the person most similar to you worldwide. 1 per day, no repeats.",
    {
      sender_id: z.string().describe("The sender's user ID"),
      channel: z.string().describe("Channel name"),
    },
    async ({ sender_id, channel }) => {
      try {
        const result = await discover({ device_id: deriveDeviceId(sender_id, channel) });
        if (result._ref_map) {
          _lastRefMap = result._ref_map;
          const { _ref_map, ...clean } = result;
          return jsonResult(clean);
        }
        return jsonResult(result);
      } catch (e) {
        return jsonResult({ error: e.message });
      }
    }
  );

  // ─── antenna_pass ────────────────────────────────────────────

  server.tool(
    "antenna_pass",
    "Pass/skip a person. They won't be recommended again.",
    {
      sender_id: z.string().describe("The sender's user ID"),
      channel: z.string().describe("Channel name"),
      ref: z.string().optional().describe("Ref number from scan/discover results"),
      target_device_id: z.string().optional().describe("Device ID (use ref instead)"),
    },
    async ({ sender_id, channel, ref, target_device_id }) => {
      try {
        const result = await pass({ device_id: deriveDeviceId(sender_id, channel), target_device_id, ref });
        return jsonResult(result);
      } catch (e) {
        return jsonResult({ error: e.message });
      }
    }
  );

  // ─── antenna_event_create ──────────────────────────────────

  server.tool(
    "antenna_event_create",
    "Create an event. Returns a shareable link (antenna.fyi/events/CODE) for participants to join.",
    {
      name: z.string().describe("Event name"),
      sender_id: z.string().describe("Creator's user ID"),
      channel: z.string().describe("Channel name"),
      lat: z.number().optional().describe("Event latitude"),
      lng: z.number().optional().describe("Event longitude"),
      starts_at: z.string().describe("Start time ISO string (required)"),
      ends_at: z.string().describe("End time ISO string (required)"),
      description: z.string().optional().describe("Event description"),
      og_image: z.string().optional().describe("OG image URL for social sharing"),
      requires_approval: z.boolean().optional().describe("Require host approval to join (default false)"),
      screening_questions: z.array(z.string()).optional().describe("Screening questions for applicants"),
    },
    async ({ name, sender_id, channel, lat, lng, starts_at, ends_at, description, og_image, requires_approval, screening_questions }) => {
      try {
        const result = await createEvent({ name, lat, lng, device_id: deriveDeviceId(sender_id, channel), starts_at, ends_at, description, og_image, requires_approval, screening_questions });
        return jsonResult(result);
      } catch (e) { return jsonResult({ error: e.message }); }
    }
  );

  // ─── antenna_event_upload_image ──────────────────────────────

  server.tool(
    "antenna_event_upload_image",
    "Upload an image for an event. Returns a public URL to use as og_image.",
    {
      image_base64: z.string().describe("Base64-encoded image data"),
      content_type: z.string().optional().describe("MIME type (default image/png)"),
      event_code: z.string().describe("Event code to associate the image with"),
    },
    async ({ image_base64, content_type, event_code }) => {
      try {
        const url = await uploadEventImage({ image_data: image_base64, content_type, event_code });
        return jsonResult({ url });
      } catch (e) { return jsonResult({ error: e.message }); }
    }
  );

  // ─── antenna_event_end ───────────────────────────────────────

  server.tool(
    "antenna_event_end",
    "End an event. Only the creator can end it.",
    {
      code: z.string().describe("Event code"),
      sender_id: z.string().describe("The sender's user ID"),
      channel: z.string().describe("Channel name"),
    },
    async ({ code, sender_id, channel }) => {
      try {
        const result = await endEvent({ code, device_id: deriveDeviceId(sender_id, channel) });
        return jsonResult(result);
      } catch (e) { return jsonResult({ error: e.message }); }
    }
  );

  // ─── antenna_event_join ────────────────────────────────────

  server.tool(
    "antenna_event_join",
    "Join an event by its code. The code is from the event URL (antenna.fyi/events/CODE). Auto-checks in if the event has already started and you're within 1km.",
    {
      code: z.string().describe("Event code"),
      sender_id: z.string().describe("The sender's user ID"),
      channel: z.string().describe("Channel name"),
      lat: z.number().optional().describe("Latitude (optional, for auto-checkin)"),
      lng: z.number().optional().describe("Longitude (optional, for auto-checkin)"),
      application_context: z.string().optional().describe("Application context from screening conversation"),
    },
    async ({ code, sender_id, channel, lat, lng, application_context }) => {
      try {
        const result = await joinEvent({ code, device_id: deriveDeviceId(sender_id, channel), lat, lng, application_context });
        return jsonResult(result);
      } catch (e) { return jsonResult({ error: e.message }); }
    }
  );

  // ─── antenna_event_checkin ─────────────────────────────────

  server.tool(
    "antenna_event_checkin",
    "Check in at an event — marks you as present at the event location. Optionally updates GPS.",
    {
      code: z.string().describe("Event code"),
      sender_id: z.string().describe("The sender's user ID"),
      channel: z.string().describe("Channel name"),
      lat: z.number().optional().describe("Latitude (optional)"),
      lng: z.number().optional().describe("Longitude (optional)"),
    },
    async ({ code, sender_id, channel, lat, lng }) => {
      try {
        const result = await eventCheckin({ code, device_id: deriveDeviceId(sender_id, channel), lat, lng });
        return jsonResult(result);
      } catch (e) { return jsonResult({ error: e.message }); }
    }
  );

  // ─── antenna_event_scan ────────────────────────────────────

  server.tool(
    "antenna_event_scan",
    "Scan people in an event. No distance limit — returns all event participants.",
    {
      code: z.string().describe("Event code"),
      sender_id: z.string().describe("The sender's user ID"),
      channel: z.string().describe("Channel name"),
    },
    async ({ code, sender_id, channel }) => {
      try {
        const result = await eventScan({ code, device_id: deriveDeviceId(sender_id, channel) });
        if (result._ref_map) {
          _lastRefMap = { ..._lastRefMap, ...result._ref_map };
          const { _ref_map, ...clean } = result;
          return jsonResult(clean);
        }
        return jsonResult(result);
      } catch (e) { return jsonResult({ error: e.message }); }
    }
  );

  // ─── antenna_event_update ──────────────────────────────────

  server.tool(
    "antenna_event_update",
    "Update event info. Only the creator or co-host can update.",
    {
      code: z.string().describe("Event code"),
      sender_id: z.string().describe("The sender's user ID"),
      channel: z.string().describe("Channel name"),
      name: z.string().optional().describe("New event name"),
      description: z.string().optional().describe("New event description"),
      og_image: z.string().optional().describe("New OG image URL"),
      lat: z.number().optional().describe("New event latitude"),
      lng: z.number().optional().describe("New event longitude"),
      starts_at: z.string().optional().describe("New start time ISO"),
      ends_at: z.string().optional().describe("New end time ISO"),
      requires_approval: z.boolean().optional().describe("Require host approval to join"),
      screening_questions: z.array(z.string()).optional().describe("Screening questions for applicants"),
    },
    async ({ code, sender_id, channel, name, description, og_image, lat, lng, starts_at, ends_at, requires_approval, screening_questions }) => {
      try {
        const result = await updateEvent({ code, device_id: deriveDeviceId(sender_id, channel), name, description, og_image, lat, lng, starts_at, ends_at, requires_approval, screening_questions });
        return jsonResult(result);
      } catch (e) { return jsonResult({ error: e.message }); }
    }
  );

  // ─── antenna_event_approve ─────────────────────────────────

  server.tool(
    "antenna_event_approve",
    "Approve a pending participant. Only the creator or co-host can approve.",
    {
      code: z.string().describe("Event code"),
      sender_id: z.string().describe("The sender's user ID"),
      channel: z.string().describe("Channel name"),
      ref: z.string().describe("Ref number of the participant to approve"),
    },
    async ({ code, sender_id, channel, ref }) => {
      try {
        const result = await approveParticipant({ code, device_id: deriveDeviceId(sender_id, channel), ref });
        return jsonResult(result);
      } catch (e) { return jsonResult({ error: e.message }); }
    }
  );

  // ─── antenna_event_reject ──────────────────────────────────

  server.tool(
    "antenna_event_reject",
    "Reject a pending participant. Only the creator or co-host can reject.",
    {
      code: z.string().describe("Event code"),
      sender_id: z.string().describe("The sender's user ID"),
      channel: z.string().describe("Channel name"),
      ref: z.string().describe("Ref number of the participant to reject"),
    },
    async ({ code, sender_id, channel, ref }) => {
      try {
        const result = await rejectParticipant({ code, device_id: deriveDeviceId(sender_id, channel), ref });
        return jsonResult(result);
      } catch (e) { return jsonResult({ error: e.message }); }
    }
  );

  // ─── antenna_event_add_host ────────────────────────────────

  server.tool(
    "antenna_event_add_host",
    "Add a co-host to an event. Only the creator can add co-hosts.",
    {
      code: z.string().describe("Event code"),
      sender_id: z.string().describe("The sender's user ID"),
      channel: z.string().describe("Channel name"),
      ref: z.string().describe("Ref number of the participant to make co-host"),
    },
    async ({ code, sender_id, channel, ref }) => {
      try {
        const result = await addCohost({ code, device_id: deriveDeviceId(sender_id, channel), ref });
        return jsonResult(result);
      } catch (e) { return jsonResult({ error: e.message }); }
    }
  );

  // ─── antenna_event_message ────────────────────────────────

  server.tool(
    "antenna_event_message",
    "Send a message to event participants. Only creator or co-host can send. Omit ref to broadcast to all.",
    {
      code: z.string().describe("Event code"),
      sender_id: z.string().describe("The sender's user ID"),
      channel: z.string().describe("Channel name"),
      chat_id: z.string().describe("REQUIRED for notifications"),
      message: z.string().describe("Message to send"),
      ref: z.string().optional().describe("Ref number of specific participant (omit for broadcast)"),
    },
    async ({ code, sender_id, channel, chat_id, message, ref }) => {
      try {
        const result = await sendEventMessage({ code, device_id: deriveDeviceId(sender_id, channel), message, target_ref: ref });
        return jsonResult(result);
      } catch (e) { return jsonResult({ error: e.message }); }
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
