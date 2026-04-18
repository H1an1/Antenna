import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DISCORD_TOKEN = Deno.env.get("DISCORD_BOT_TOKEN") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

async function sendDiscord(channelId: string, message: string) {
  const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${DISCORD_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content: message }),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error(`Discord send failed: ${res.status} ${err}`);
  }
  return res.ok;
}

async function sendTelegram(chatId: string, message: string) {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!token) return false;
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: "HTML" }),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error(`Telegram send failed: ${res.status} ${err}`);
  }
  return res.ok;
}

async function notify(deviceId: string, message: string) {
  const [platform, ...rest] = deviceId.split(":");
  const userId = rest.join(":");

  // Get last_chat_id from profile
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
  const { data: profile } = await sb.rpc("get_profile", { p_device_id: deviceId });
  const chatId = profile?.last_chat_id;

  switch (platform) {
    case "discord":
      if (chatId) return sendDiscord(chatId, message);
      break;
    case "telegram":
      // Telegram: chat_id is the user's chat ID (same as userId for DMs)
      return sendTelegram(chatId || userId, message);
    default:
      console.log(`Unsupported platform: ${platform}`);
  }
  return false;
}

serve(async (req) => {
  try {
    const payload = await req.json();
    const { type, record, old_record } = payload;

    // Handle event_participants changes
    const table = payload.table;
    if (table === "event_participants") {
      const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

      if (type === "INSERT" && record?.status === "pending") {
        // New pending participant → notify creator
        const { data: event } = await sb.rpc("get_event_by_id", { p_event_id: record.event_id });
        if (!event?.found || !event?.created_by) return new Response("ok");

        const { data: applicant } = await sb.rpc("get_profile", { p_device_id: record.device_id });
        const name = applicant?.display_name || "Someone";
        const emoji = applicant?.emoji || "👤";

        await notify(
          event.created_by,
          `📩 ${emoji} ${name} applied to join "${event.name}"\n\nUse antenna_event_scan to review and approve/reject.`
        );
      }

      if (type === "UPDATE" && old_record?.status === "pending" && record?.status === "active") {
        // Approved → notify participant
        const { data: event } = await sb.rpc("get_event_by_id", { p_event_id: record.event_id });
        const eventName = event?.name || "an event";

        await notify(
          record.device_id,
          `✅ Your application to "${eventName}" has been approved! You're in.\n\nUse antenna_event_scan to see who else is there.`
        );
      }

      if (type === "UPDATE" && old_record?.status === "pending" && record?.status === "rejected") {
        // Rejected → notify participant
        const { data: event } = await sb.rpc("get_event_by_id", { p_event_id: record.event_id });
        const eventName = event?.name || "an event";

        await notify(
          record.device_id,
          `❌ Your application to "${eventName}" was not approved.`
        );
      }
    }

    // Handle matches changes
    if (table === "matches" && type === "INSERT") {
      const targetDeviceId = record?.device_id_b;
      if (!targetDeviceId) return new Response("ok");

      const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
      const { data: from } = await sb.rpc("get_profile", { p_device_id: record.device_id_a });
      const name = from?.display_name || "Someone";
      const emoji = from?.emoji || "👤";

      // Check if mutual
      const { data: matches } = await sb.rpc("get_my_matches", { p_device_id: targetDeviceId });
      const myAccept = (matches || []).find(
        (m: any) => m.device_id_a === targetDeviceId && m.device_id_b === record.device_id_a
      );

      if (myAccept) {
        const contact = record.contact_info_a ? `\nTheir contact: ${record.contact_info_a}` : "";
        await notify(targetDeviceId, `🎉 Mutual match! ${emoji} ${name} accepted you too!${contact}`);
      } else {
        await notify(targetDeviceId, `📩 ${emoji} ${name} wants to meet you!\n\nUse antenna_check_matches to see their card and decide.`);
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("notify error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
