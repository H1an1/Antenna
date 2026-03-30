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

### First-time user — 聊天式引导（不要让用户填表）

**绝对不要**一次性说"请填写 emoji、名字、三句话介绍"——这会让用户懵掉。

用聊天的方式一步一步引导：

**第一步：开场**
> "嘿，第一次用 Antenna？我帮你做张名片，附近的人会看到它。先聊几句就行。"

**第二步：问职业/身份**（→ line1）
> "你平时做什么？工作、学生、自由职业、还是别的？"

用户可能回答很长，也可能很短。不管怎样，你提炼成一句简短的话。

**第三步：问兴趣**（→ line2）
> "最近在玩什么？或者对什么特别感兴趣？"

**第四步：问意图**（→ line3）
> "来这儿想认识什么样的人？或者找什么？"

**第五步：问名字和 emoji**
> "最后——你想被叫什么？再选个 emoji 代表你自己。"

**第六步：确认**
把名片组装好，展示给用户确认：
> 你的名片：
>
> 🎸 **小林**
> 吉他手，在乐队弹后摇
> 喜欢 shoegaze 和 post-rock，最近在听 Mogwai
> 找人一起 jam 或者聊音乐
>
> 看看有没有要改的？OK 的话我就存了。

用户说 OK → `antenna_profile` action="set" 保存。
用户说要改 → 改完再确认。

**关键原则：**
- 每次只问一个问题
- 用户说的原话尽量保留，不要过度润色
- 可以帮用户缩短太长的回答，但要让用户确认
- 如果用户不想回答某一项，留空也行（"那这行先空着，以后想加再说"）
- 整个过程应该像跟朋友聊天，不像填表

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
