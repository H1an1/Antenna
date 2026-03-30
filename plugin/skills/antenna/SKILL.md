---
name: antenna
description: "Nearby people discovery via Antenna. Use when a user shares location, asks who's nearby, wants to set up their profile card, or interacts with match results. Handles location-based social discovery through the antenna_scan, antenna_profile, antenna_accept, and antenna_check_matches tools."
metadata: { "openclaw": { "always": true } }
---

# Antenna — Nearby People Discovery

You have access to the Antenna plugin tools for location-based social discovery.

## When to use

- User shares a location (Telegram live location, WhatsApp pin, or tells you where they are)
- User asks "附近有谁" / "who's nearby" / "周围有什么人"
- User wants to set up or edit their profile card (名片)
- User accepts or skips a match
- User asks about match status or wants to exchange contact info

## Tools

### `antenna_scan`
Scan for nearby people. Use when you receive a location.
- `lat`, `lng`: coordinates (from `LocationLat`/`LocationLon` context, or geocoded from user input)
- `radius_m`: search radius (default 500m)
- `sender_id`: the user's id from message context
- `channel`: the channel name (telegram, whatsapp, discord, etc.)

### `antenna_profile`
View or update the user's name card.
- `action`: "get" or "set"
- `sender_id`, `channel`: from context
- For "set": `display_name`, `emoji`, `line1`, `line2`, `line3`, `visible`

The name card has:
- **emoji**: a single emoji that represents them
- **display_name**: how they want to be called
- **line1**: who they are / what they do
- **line2**: what they're into
- **line3**: what they're looking for right now

### `antenna_accept`
Accept a match after the user sees results. Can optionally include contact info to share.
- `sender_id`, `channel`, `target_device_id`
- `contact_info` (optional): e.g. "WeChat: yi_xxx" or "Telegram: @yi"

### `antenna_check_matches`
Check for mutual matches and contact info updates.
- `sender_id`, `channel`
- Returns mutual matches with any contact info the other person shared

## Behavior guidelines

### First-time user
If the user doesn't have a profile yet, guide them to create one BEFORE scanning:
1. Ask for a name, an emoji, and three short lines about themselves
2. Use `antenna_profile` action="set" to save it
3. Then proceed to scan

### Showing results
Present matches conversationally, not as a data dump:
- Lead with the emoji and name
- Show their three lines
- Include the match reason naturally
- Ask if they want to accept any match

Example:
> 📡 附近发现 3 个人：
>
> 🎸 **小林** — 吉他手，喜欢后摇和 shoegaze，在找人一起 jam
> → 你们都提到了音乐和后摇——可能聊得来
>
> 🏃 **Alex** — 跑步爱好者，每周三晚朝阳公园
> → 就在附近
>
> 想跟谁打个招呼？

### Accepting & contact exchange
When the user wants to accept a match:
1. Call `antenna_accept` with the target's device_id
2. Ask: "想分享你的联系方式吗？比如微信号、Telegram、手机号"
3. If user shares, call `antenna_accept` again with `contact_info`
4. If mutual match, tell the user the other person's contact info (if they shared)
5. If not mutual yet, tell the user to wait

### Checking match status
Use `antenna_check_matches` when:
- User asks "有人回复我吗" / "匹配状态怎么样"
- Periodically during conversation if the user has pending matches

### Location sources
- **Telegram/WhatsApp location**: context will have `LocationLat`, `LocationLon` — use directly
- **User says a place name**: geocode it first (use web_search or a geocoding service), then call antenna_scan
- **Live location**: note that it's real-time, tell the user you'll check for new people

### Privacy
- Never reveal exact coordinates to other users
- Never share someone's device_id with another user
- Only show the profile info (name, emoji, three lines)
- Contact info is only shared when the user explicitly agrees
- All matches expire in 24 hours

### 24-hour rule
Everything is ephemeral:
- Match results expire in 24h
- Contact info shared through matches expires with the match
- If neither side acts, the match disappears
- This is by design — "用完即走"
