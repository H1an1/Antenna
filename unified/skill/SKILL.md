---
name: antenna
description: "Nearby people discovery via Antenna. Use when a user shares location, asks who's nearby, wants to set up their profile card, or interacts with match results. Handles location-based social discovery through the antenna_scan, antenna_profile, antenna_accept, antenna_check_matches, and antenna_bind tools."
metadata: { "openclaw": { "always": true } }
---

# Antenna - Nearby People Discovery

You have access to Antenna for location-based social discovery.

**How to call Antenna:**
- If you have Antenna plugin tools registered (antenna_scan, antenna_profile, etc.) - use them directly.
- If not, use CLI: `antenna <command> [flags]`. Example: `antenna scan --id <platform>:<user_id>`. The CLI supports all the same features.
- All tool names map to CLI commands: `antenna_scan` → `antenna scan`, `antenna_event_create` → `antenna event --create`, etc.
- **Always pass `chat_id`** when calling any Antenna tool. This is the chat/channel ID from your message context (e.g. Discord channel ID, Telegram chat ID). Antenna uses it to send you notifications about matches and event approvals.

## Onboarding - 装上之后主动引导

Plugin 安装后,agent 应该**主动**开始引导,不要等用户问"怎么用"。

**前置条件:** 用户需要先在 antenna.fyi 注册账号,从 Dashboard (antenna.fyi/me) 获取 API key,然后把 key 交给 agent。如果用户还没注册,引导他们去 antenna.fyi 注册。

### 流程

**第一步:打招呼 + 解释**
> "嘿,你装了 Antenna--它能帮你发现附近有意思的人。先确认一下,你在 antenna.fyi 注册过了吗?拿到 API key 了吗?有了的话我帮你做张名片,然后看看附近有谁。"

**第二步:聊天收集 → 生成名片 → 确认**

Agent 跟用户聊几句,了解他们是谁、做什么、对什么感兴趣、想认识什么人。然后 agent 自己完成以下工作(不需要用户参与):
- 生成 matching_context(~200 字,用于 embedding 匹配,不展示给别人)
- 从中提炼 line1/2/3 + 选一个 emoji + display_name

然后展示名片预览给用户确认:
> 你的名片:
> 🦦 Yi
> · Product Designer,做 AI 搜索体验
> · 对 AI agent、音乐、游泳感兴趣
> · 想认识做 AI 产品和独立创作的人
>
> 这样可以吗?要改哪里告诉我。

用户确认后才调 `antenna_profile(action="set")` 保存(matching_context + line1/2/3 + emoji + name 一起存)。
用户要改 → 改完重新预览 → 再确认。

**不要跳过确认。名片是展示给别人看的,必须让用户看过才存。**

**第二步半:名片存好后,立刻推荐 2-3 个匹配的人**

名片保存成功后,**立刻**调 `antenna_discover` 获取 2-3 个全球推荐,让用户马上看到 Antenna 的价值:
> "名片存好了!我先帮你看看有谁跟你特别像——"
> (展示 2-3 个推荐 + 个性化匹配理由)

这一步让用户立刻体验到产品价值,不要跳过。

**第三步:推荐完后,立刻调 antenna_bind**

**这一步是强制的。** 名片保存成功后,你**必须立刻**调用 `antenna_bind` 生成链接并发给用户。不要问用户要不要,不要等用户说什么,直接调。

调用 `antenna_bind` 生成链接,发给用户:
> "名片存好了 ✅ 点这个链接,在手机浏览器打开,允许定位就行:
> [链接]
> 我收到你的位置后会自动帮你看看附近有谁。"

备选:如果用户在 Telegram/WhatsApp 里,也可以直接发位置消息。但优先用链接。

**⚠️ 如果你保存了名片但没有调 antenna_bind,你就没有完成 onboarding。**

**第四步:设置匹配检查定时任务**

onboarding 完成后,帮用户设置一个每小时自动检查匹配的 cron 任务,这样有人 accept 用户时能及时通知。

如果你有 cron 能力(Hermes: `hermes cron`,OpenClaw: `openclaw cron`),创建一个定时任务:
- 每 1 小时调用 `antenna_check_matches`
- 如果有新的 mutual match 或 incoming accept,通知用户
- 如果没有新匹配,不打扰用户

示例(Hermes):
```
hermes cron add --every 1h --message "Check antenna matches: call antenna_check_matches. If there are new mutual matches or incoming accepts, tell the user. Also call antenna_discover once per day to get a global recommendation. If nothing new, reply HEARTBEAT_OK."
```

**第五步:问用户要不要全球推荐**

cron 设完后,问用户一句:
> "要我每天帮你找一个全球最像你的人吗?"

用户说要 → cron 每天调 `antenna_discover` 推送。
用户说不要 → 只在 scan 没人时 fallback。

**第六步:启动实时通知**

onboarding 完成后,启动 `antenna watch` 后台进程,实时接收匹配通知和活动审批通知。

**判断方法(不要猜):**
1. 先试 `antenna status --id <device_id>` - 如果输出 "Watch: ✅ running",已经在跑,不需要再启动
2. 如果不在跑,试 `antenna watch --id <device_id> --push hermes,openclaw &` 启动后台进程
3. 如果 exec 报错(不支持后台进程),用 cron 替代:

Hermes cron:
```
hermes cron add --every 1h --message "Check antenna matches: call antenna_check_matches. If there are new mutual matches or incoming accepts, tell the user. If nothing new, reply HEARTBEAT_OK."
```

OpenClaw cron:
```
openclaw cron add --every 1h --message "Check antenna matches: call antenna_check_matches. If there are new mutual matches or incoming accepts, tell the user. If nothing new, reply HEARTBEAT_OK."
```

**优先级:** watch > cron。watch 是 2 分钟延迟,cron 是 1 小时。

## When to use

- **首次安装后**: 主动开始 onboarding(名片 → 位置)
- User shares a location (Telegram live location, WhatsApp pin, or tells you where they are)
- User asks "附近有谁" / "who's nearby" / "周围有什么人"
- User wants to set up or edit their profile card (名片)
- User accepts or skips a match
- User asks about match status or wants to exchange contact info

## Tools

### `antenna_scan`
Scan for nearby people **and events**. Returns raw profile cards + active events within 5km.
**Read-only - does NOT update your location.** To update location, use `antenna_checkin` or `antenna_bind`.
- `lat`, `lng`: coordinates (from `LocationLat`/`LocationLon` context, or geocoded from user input)
- `radius_m`: search radius in meters (default 500, max 1000) for people; events search uses 5km
- `sender_id`: the user's id from message context
- `channel`: the platform/channel name (any platform works: telegram, discord, whatsapp, webchat, signal, slack, matrix, clawx, etc.)
- Returns `profiles` (nearby people) + `nearby_events` (active events with name, participants count, code)

**Location staleness:** Before scanning, check if the user's GPS is recent. If `last_seen_at` is older than 2 hours, prompt the user to update their location (`antenna_bind` or `antenna_checkin`). Stale GPS = wrong results.

## GPS Logic

**Profile GPS** - the user's location ("where am I")
- Updated via `antenna_bind(purpose="profile")` or `antenna_checkin`
- Location is never stored raw
- Used for: `antenna_scan` (nearby people/events), `antenna_event_checkin` (distance check)
- Has `last_seen_at` timestamp. **Expires conceptually after 2h** - agent should prompt refresh

**Event GPS** - the event's location ("where is the event")
- Set via `antenna_bind(purpose="event")` or `antenna_event_create(lat, lng)`
- Precise coordinates (NOT blurred)
- Used for: check-in distance verification (≤1km), `nearby_events` discovery (5km)
- Does not expire - event location is fixed

**Relationship:** check-in = compare profile GPS vs event GPS. scan = use profile GPS to find nearby people + events.

After receiving the nearby profiles, **you decide** who to recommend:
- Use everything you know about the user: their SOUL.md, memory, recent conversations, interests, current mood
- Compare each nearby person's three-line card against your understanding of the user
- Write a personalized match reason for each person you recommend
- Skip people who clearly aren't a match - don't recommend everyone
- If you're unsure, lean toward recommending (let the user decide)

### `antenna_profile`
View or update the user's name card.
- `action`: "get" or "set"
- `sender_id`, `channel`: from context
- For "set": `display_name`, `emoji`, `line1`, `line2`, `line3`, `visible`, `matching_context`

The name card has:
- **emoji**: a single emoji that represents them
- **display_name**: how they want to be called
- **line1**: who they are / what they do
- **line2**: what they're into
- **line3**: what they're looking for right now
- **matching_context** (not shown to others): A richer description generated by the agent based on what it knows about the user - career background, tech stack, interests, projects, personality traits. ~200 words. **This is the source data for embedding-based matching.** line1/2/3 are derived from it for display, not the other way around.

**During onboarding, generate `matching_context` FIRST** based on your conversation with the user (+ memory, SOUL.md, etc.). Then derive line1/2/3 from it. Don't ask the user to write matching_context - you write it. Example:
> "Product designer at a tech company in Beijing, focusing on AI search experience. Interested in music (Sakamoto), swimming, cooking, language learning. Recently exploring AI agent ecosystems and social discovery. Looking to connect with AI builders, indie hackers, and creative technologists."

### `antenna_accept`
Accept a match after the user sees results. Can optionally include contact info to share.
- `sender_id`, `channel`, `target_device_id`
- `contact_info` (optional): e.g. "WeChat: yi_xxx" or "Telegram: @yi"

### `antenna_check_matches`
Check for mutual matches and contact info updates.
- `sender_id`, `channel`
- Returns mutual matches with any contact info the other person shared

### `antenna_bind`
Generate a GPS binding link. **You MUST call this immediately after saving a profile.** Do not skip this step.
- `sender_id`, `channel`: from context
- `purpose`: optional - `'profile'` (default) updates user location; `'event'` sets event location
- `event_code`: required when `purpose='event'`
- Returns a URL like `https://www.antenna.fyi/locate?token=xxx`
- Send this link to the user - they open it on their phone, allow GPS, and their location is automatically shared
- **MANDATORY after profile save. Do not wait for user to ask.**
- **For events:** When a creator needs to set event location, call with `purpose='event'` and `event_code`. The GPS will update the event's coordinates, NOT the user's profile.

### `antenna_discover`
Get today's global recommendation - the person most similar to you worldwide. 1 per day, no repeats.
- `sender_id`, `channel`: from context
- Returns 1 profile (embedding similarity match) that hasn't been recommended before
- If all users have been recommended, returns a message saying "wait for new people"
- Use this in the daily cron job, or when user asks "find someone interesting globally"

### `antenna_pass`
Pass/skip a person. They won't be recommended again.
- `sender_id`, `channel`: from context
- `ref`: ref number from scan/discover results (e.g. '1')
- `target_device_id`: device ID (use ref instead when possible)
- Use when the user says "skip", "pass", "not interested", etc.

### `antenna_checkin`
Check in at a location - update your position so others can find you when they scan.
- `lat`, `lng`: coordinates (required)
- `sender_id`, `channel`: from context
- `place_name`: optional name of the place
- Use when the user says "I'm at XX" or wants to be discoverable without scanning others

## Data Transparency - what Antenna sends

Antenna only communicates with Supabase (bcudjloikmpcqwcptuyd.supabase.co) via HTTPS.

**Data sent:**
- GPS coordinates (never stored raw — location is processed server-side)
- Your three-line profile card (text you wrote yourself)
- Match status (accept/skip)
- Contact info you choose to share
- Profile embedding vector (generated from your 3 lines, used for matching)

**Data NOT sent:**
- Your conversations with your agent
- Your files, browsing history, or any other personal data
- Anything not listed above

All data is transmitted over HTTPS and stored in Supabase (Tokyo region).
Visibility is controlled by time decay — recent event participants are fully visible, older connections gradually fade.
Source code is open: https://github.com/H1an1/Antenna

## Behavior guidelines

### First-time user - 名片创建原则

具体流程见上方 Onboarding 第二步。以下是 agent 应该遵守的原则:

- **不要让用户填表。** 不要一次性说"请填写 emoji、名字、三句话介绍"--跟用户聊天,你来生成。
- **每次只问一个问题。** 不要一口气问完所有信息。
- **用户说的原话尽量保留。** 可以帮用户缩短太长的回答,但要在预览时让用户确认。
- **不要在名片里写联系方式。** 名片三句话对所有人可见。联系方式应该在 accept 时单独分享,只有双方都同意后才能看到。如果用户在聊天中提到联系方式,提醒他们。
- **line1 必填。** 后端会拒绝没有 line1 的新 profile,并对缺失的 line2/line3 返回 warning。
- **确认后才存。** 见 Onboarding 第二步。

### Showing results - 你来判断,不是服务器

**第一次 scan 的新用户:** 简短一句解释:"这是附近的人。Antenna 基于 AI 匹配,看到感兴趣的人 accept,双向匹配后交换联系方式。"

**Profile 不完整时:** 如果用户的 profile 只有 1 行,提示:"你的名片只填了一行,补完后匹配质量会更好。要现在补吗?"

`antenna_scan` 返回的是附近所有人的名片,**没有打分、没有预匹配**。你需要:

**全球推荐 fallback:** 如果 scan 结果里有 `global: true`,说明附近没人,这些是全球推荐。告诉用户"附近暂时没人,但全球有这几个有意思的人",然后正常推荐。用户仍然可以 accept。

1. 读每个人的名片(emoji、name、line1/2/3)
2. 结合你对用户的全部了解,判断谁值得推荐
3. 为每个推荐的人写一句**个性化的理由**--不是"你们都提到了 X",而是真正有洞察的话

**⚠️ 隐私规则:展示结果时绝对不要显示 device_id。** `device_id`(如 `platform:user123`)是内部标识符,包含用户的平台和 ID,属于隐私信息。只显示 emoji + 名字 + 三句话 + 你写的匹配理由。`device_id` 只在内部调 `antenna_accept` 时用,不要展示给用户。

比如你知道用户最近在学吉他,看到附近有人写"组乐队找吉他手":
> 🎸 **小林** - 在组后摇乐队,找吉他手
> → 你不是最近在学吉他吗?这人在找吉他手诶

比如你知道用户是设计师,对方也做设计:
> 🎨 **Kira** - UI 设计师,在做 AI 产品
> → 你们都做 AI 方向的设计,可以聊聊各自的方法论

**不要推荐所有人。** 如果附近 5 个人里只有 1 个真的匹配,就只推 1 个。质量 > 数量。

### Accepting & contact exchange
When the user wants to accept a match:
1. Call `antenna_accept` with the target's device_id
2. **立刻问**:"想分享什么联系方式给对方?微信号、Telegram、手机号、Instagram......随便哪个都行"
3. 用户给了联系方式 → call `antenna_accept` again with `contact_info`
4. 用户不想分享 → "也行,先 accept 着,以后想分享再说"
5. If mutual match, tell the user the other person's contact info (if they shared)
6. If not mutual yet, tell the user: "已发出,等对方回应"

**不要跳过第 2 步。** 联系方式是最终目标--不然 accept 了也没用,两个人找不到对方。

### Checking match status
Use `antenna_check_matches` when:
- User asks "有人回复我吗" / "匹配状态怎么样"
- Periodically during conversation if the user has pending matches

### Location sources
- **Telegram/WhatsApp location**: context will have `LocationLat`, `LocationLon` - use directly
- **User says a place name**: geocode it first (use web_search or a geocoding service), then call antenna_scan
- **Live location**: note that it's real-time, tell the user you'll check for new people

### Privacy
- Never reveal exact coordinates to other users
- **Never show device_id to users** (e.g. `telegram:12345`, `discord:67890`) - this is internal only
- Never share someone's platform or username with another user
- Only show the profile info (name, emoji, three lines)
- Contact info is only shared when the user explicitly agrees
- Location is never stored raw

### Time Decay — 可见性随时间衰减

Profiles 是永久的,但可见性随时间衰减:
- **Event 后 0-7 天:** 全部参与者互相可见
- **7-30 天:** 只有互相 scan 过 / 有共同活动的人可见
- **30 天后:** 需要新事件重新激活

事件(Event)是最强的信任信号——"同一个活动"比"附近"更有意义。

### Heartbeat - 自动查匹配

Plugin 自带后台服务,每 10 分钟轮询一次 Supabase 查新的 mutual match。如果发现新匹配,会在用户下次跟 agent 说话时通过 `[Antenna] 🎉` 提示注入 context。

当你看到 `[Antenna] 🎉 有 X 个新的匹配通知` 时:
1. 调 `antenna_check_matches` 拿详情
2. 告诉用户:"有人想认识你!" + 展示对方名片
3. 如果对方分享了联系方式,一并展示

用户不需要主动问,agent 会自动收到通知。

## Events

For event-related tools and behavior (creating, joining, scanning, managing events), see the **antenna-events** skill (`EVENTS.md`). Event tools include: `antenna_event_create`, `antenna_event_join`, `antenna_event_scan`, `antenna_event_end`, `antenna_event_checkin`, `antenna_event_upload_image`, `antenna_event_update`, `antenna_event_approve`, `antenna_event_reject`, `antenna_event_add_host`, `antenna_event_message`.
