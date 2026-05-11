---
name: antenna
description: "AI-native social discovery via Antenna. Use when a user wants to meet interesting people - through nearby scan, global recommendations, profile links, or events. Handles profile management, matching, and contact exchange."
metadata: { "openclaw": { "always": true } }
---

# Antenna - AI-Native Social Discovery

Antenna 帮你的用户发现值得认识的人。不只是"附近的人"--profile link、全球推荐、活动,都是发现路径。

**核心流程:发现 → 判断 → accept → 交换联系方式。**

发现可以来自任何渠道:
- 📡 **附近扫描** - `antenna_scan`,基于 GPS 的周边发现
- 🌍 **全球推荐** - `antenna_discover`,每天 1 个最匹配的人
- 🔗 **Profile 链接** - 用户收到 `antenna.fyi/p/xxx` 链接,agent 读取后直接 accept
- 🎪 **活动** - `antenna_event_scan`,同一个活动里的人

**Accept 不需要先 scan。** 只要你知道对方的 `ref`、`profile_slug` 或 `device_id`,就可以直接 accept。

## How to call Antenna

- 如果有 Antenna plugin tools(antenna_scan, antenna_profile 等),直接用。
- 如果没有,用 CLI:`antenna <command> [flags]`。
- **所有 tool 必须传 `chat_id`**--Antenna 用它发通知。

## Onboarding - 装上后主动引导

Plugin 安装后,agent **主动**开始引导,不要等用户问。

**前置条件:** 用户需要先在 antenna.fyi 注册账号,从 Dashboard 获取 API key。如果没注册,引导去 antenna.fyi。

### 流程

**第一步:拿到 API key → 配置**
> "嘿,你装了 Antenna--它能帮你发现有意思的人。先确认一下,你在 antenna.fyi 注册过了吗?拿到 API key 了吗?"

用户给了 API key 后,调 `antenna config --key <key>` 验证。这会返回 `user_id` 和 `device_id`。

**⚠️ 之后所有操作必须用 API key 验证返回的 device_id(格式 `user:xxx`)。不要自己拼 `channel:sender_id`。** 这样 agent 创建的 profile 才能在 dashboard 上显示。

**第二步:聊天收集 → 生成名片 → 确认**

跟用户聊几句,了解他们是谁、做什么、想认识什么人。然后 agent 自己生成:
- more_information(~200 字,给 agent 匹配用的私密上下文,不展示给别人)
- 从中提炼 personal_description/looking_for/conversation_style + display_name
- 提取 interest_tags（最多 5 个，如 "AI agents", "music", "design"）

展示预览给用户确认:
> 你的名片:
> Yi
> · Product Designer,做 AI 搜索体验
> · 对 AI agent、音乐、游泳感兴趣
> · 想认识做 AI 产品和独立创作的人
>
> 这样可以吗?要改哪里告诉我。

确认后用 config 里的 device_id 调 `antenna_profile(action="set")` 保存。**不要跳过确认。**

**⚠️ sender_id 用 config 里的 device_id,不要用 channel:sender_id。**

**第三步:立刻推荐 2-3 个人**

名片存好后,**立刻**调 `antenna_initial_recommendations` 获取首次推荐:
> "名片存好了!我先帮你看看有谁跟你特别像--"

这是一次性的首次推荐(不消耗每日 discover 额度)。如果返回空,说明还没有足够的用户--跳过这步。

**第四步:发公开链接给用户**

Profile 存好后,返回里会有 `public_url`(如 `antenna.fyi/p/yi`)。**必须发给用户:**
> "这是你的公开名片链接:[public_url]
> 你可以把它发给别人,对方的 agent 看到链接就能直接 accept 你。"

**第五步:调 antenna_bind 获取 GPS 链接**

**强制。** 名片存好后**必须立刻**调用 `antenna_bind` 生成链接并发给用户:
> "点这个链接,在手机浏览器打开,允许定位就行:[链接]"

GPS 不是 Antenna 的唯一入口,但它开启了附近发现的能力。

**第五步:设置定时任务**

设一个每小时检查匹配的 cron:
```
openclaw cron add --every 1h --message "Check antenna matches: call antenna_check_matches. If there are new mutual matches or incoming accepts, tell the user. If nothing new, reply HEARTBEAT_OK."
```

**第六步:问要不要全球推荐**
> "要我每天帮你找一个全球最像你的人吗?"

### Linking to antenna.fyi account

如果用户之前通过 agent 创建过 profile(没有网站账号),现在注册了 antenna.fyi:
1. 让用户从 antenna.fyi/me 复制 API key
2. 调 `antenna_link_account(api_key = "ant_xxx")`
3. 确认:"关联成功!你现在可以在 dashboard 上看到完整的 profile 和匹配记录了。"

这把 agent 创建的 profile(带全部历史)关联到网站账号。

## When to use

- **首次安装后**:主动 onboarding
- 用户分享位置 → `antenna_scan`
- 用户问"附近有谁" → `antenna_scan`
- 用户收到 profile 链接(`antenna.fyi/p/xxx`)→ 读取 profile → 判断 → `antenna_accept`
- 用户想编辑名片 → `antenna_profile`
- 用户说 accept / skip → `antenna_accept` / `antenna_pass`
- 用户问匹配状态 → `antenna_check_matches`

## Discovery Paths

### 1. 附近扫描(antenna_scan)
基于 GPS 发现 1km 内的人。需要位置信息。
- 如果没有 GPS,先调 `antenna_bind` 或让用户发位置
- 返回 raw profile cards,**agent 判断谁值得推荐**

### 2. 全球推荐(antenna_discover)
每天 1 个全球最匹配的人,不需要 GPS。
- 用在日常 cron 里,或用户主动要求

### 3. Profile 链接
用户收到 `antenna.fyi/p/xxx` 链接时:
1. 用 `web_fetch` 读取页面--页面里有 `<script id="antenna-profile-data">` JSON,包含完整 profile
2. 读取 more_information、interest_tags、个人描述等
3. 结合你对用户的了解,判断是否推荐
4. 如果用户想 accept → 调 `antenna_accept(profile_slug="xxx")`

**不需要先 scan。** Profile 链接是独立的发现路径。

### 4. 活动(Events)
同一个活动里的人。详见 EVENTS.md。

## Tools

### `antenna_scan`
扫描附近的人和活动。**只读--不会更新你的位置。**
- `lat`, `lng`:坐标(可选,没有的话用已绑定的 GPS)
- `radius_m`:搜索半径(默认 500m,最大 1000m)
- `sender_id`, `channel`, `chat_id`:必填
- 返回 `profiles`(附近的人)+ `nearby_events`(5km 内的活动)
- 每个 profile 包含 `ref`(用于 accept)、`profile_slug`(公开链接)、`more_information`(匹配上下文)

**GPS 时效:** 如果 `last_seen_at` 超过 2 小时,提示用户更新位置。

### `antenna_profile`
查看或更新用户名片。
- `action`:"get" 或 "set"
- `sender_id`, `channel`, `chat_id`
- "set" 时传:`display_name`, `personal_description`, `looking_for`, `conversation_style`, `visible`, `matching_context`

名片内容:
- **display_name**:显示名称
- **personal_description**:个人描述(谁 / 做什么)
- **looking_for**:想认识的人
- **conversation_style**:想要的交流方式
- **matching_context**(more_information,不展示给别人):agent 基于对用户的了解生成的详细描述,~200 字。**这是匹配的核心数据源。** personal_description/looking_for/conversation_style 从它提炼出来,不是反过来。

### `antenna_accept`
接受一个匹配。**不需要先 scan**--任何发现路径都可以触发 accept。
- `sender_id`, `channel`, `chat_id`:必填
- 三种方式指定对方(任选一种):
  - `ref`:来自 scan/discover 结果的编号
  - `profile_slug`:来自 profile 链接(如 `antenna.fyi/p/yi` → `profile_slug="yi"`)
  - `target_device_id`:内部 ID(尽量用 ref 或 slug)
- `contact_info`(可选):分享联系方式

### `antenna_pass`
跳过一个人,不再推荐。
- `sender_id`, `channel`, `chat_id`
- `ref` 或 `target_device_id`

### `antenna_check_matches`
检查匹配状态。
- `sender_id`, `channel`, `chat_id`
- 返回 mutual matches + incoming accepts + 联系方式

### `antenna_bind`
生成 GPS 绑定链接。
- `sender_id`, `channel`, `chat_id`
- `purpose`:`'profile'`(默认,更新用户位置)或 `'event'`(设活动位置)
- `event_code`:purpose=event 时必填
- 返回 URL,用户在手机打开后自动共享位置
- **Onboarding 后必须调用。** 不要等用户问。

### `antenna_link_account`
关联 agent profile 到 antenna.fyi 网站账号。
- `sender_id`, `channel`, `chat_id`:必填
- `user_id`:用户的 antenna.fyi 账号 UUID(从 dashboard 获取)
- 把已有的 agent profile(带全部历史)绑定到网站账号
- 如果用户先在网站注册了(产生空 profile),空 profile 自动删除
- 一次性操作

### `antenna_discover`
全球推荐--每天 1 个最匹配的人。
- `sender_id`, `channel`, `chat_id`
- 不需要 GPS
- 如果所有人都推荐过了,返回"等新人加入"

### `antenna_initial_recommendations`
首次推荐--注册后立刻看到 2-3 个最匹配的人。
- `sender_id`, `channel`, `chat_id`: from context
- One-time only - second call returns empty
- Does NOT consume daily discover quota
- Use in onboarding step 3, right after profile save

### `antenna_checkin`
签到--更新你的位置。
- `lat`, `lng`:必填
- `sender_id`, `channel`, `chat_id`
- `place_name`:可选
- 用于"我在 XX"场景

## GPS Logic

**Profile GPS** - 用户的位置
- 通过 `antenna_bind(purpose="profile")` 或 `antenna_checkin` 更新
- 位置不原始存储
- 2 小时后概念上过期,agent 应提示刷新

**Event GPS** - 活动的位置
- 通过 `antenna_bind(purpose="event")` 或 `antenna_event_create(lat, lng)` 设置
- 精确坐标(不模糊)
- 不过期

## Behavior Guidelines

### 名片创建原则
- **不要让用户填表。** 跟用户聊天,你来生成。
- **每次只问一个问题。**
- **用户说的原话尽量保留。** 帮缩短但让用户确认。
- **不要在名片里写联系方式。** 联系方式在 accept 时分享。
- **personal_description 必填。**
- **确认后才存。**

### Showing results - 你来判断

scan 和 discover 返回的是 raw profile cards,**没有打分**。你需要:
1. 读每个人的名片 + more_information
2. 结合你对用户的全部了解判断谁值得推荐
3. 为每个推荐的人写一句**个性化的理由**
4. **不要推荐所有人。** 质量 > 数量。

**全球推荐 fallback:** 如果 scan 结果有 `global: true`,说明附近没人。告诉用户"附近暂时没人,但全球有这个人跟你很像"。

### Profile 链接场景

用户收到或提到 `antenna.fyi/p/xxx` 时:
1. 抓取页面,读 `#antenna-profile-data` JSON
2. 展示对方 profile + 你的判断
3. 用户想 accept → `antenna_accept(profile_slug="xxx")`
4. 用户想 skip → `antenna_pass` 或直接不操作

**这跟 scan 是完全平级的发现路径。**

### Accepting & contact exchange
accept 可以从任何路径触发:
1. 调 `antenna_accept`(用 ref、profile_slug 或 device_id)
2. **立刻问**:"想分享什么联系方式给对方?"
3. 用户给了 → 再调一次 `antenna_accept` 带 `contact_info`
4. 用户不想 → "先 accept 着,以后想分享再说"
5. 如果 mutual match → 展示对方联系方式
6. 如果还没 mutual → "已发出,等对方回应"

**不要跳过第 2 步。**

### Privacy
- **永远不要显示 device_id**--这是内部标识符
- 只展示名字 + 三句话 + 你写的匹配理由
- 不要泄露对方的平台或用户名
- 联系方式只在用户明确同意时分享
- GPS 不原始存储

### Time Decay - 可见性衰减
- Event 后 0-7 天:全部参与者互相可见
- 7-30 天:只有互相 scan 过 / 有共同活动的人可见
- 30 天后:需要新事件激活

### Heartbeat - 自动查匹配
Plugin 后台每 10 分钟查一次新匹配。看到 `[Antenna] 🎉` 时:
1. 调 `antenna_check_matches`
2. 告诉用户 + 展示对方名片
3. 展示联系方式(如果有)

## Events

详见 EVENTS.md。包括：`antenna_event_create`, `antenna_event_join`, `antenna_event_scan`, `antenna_event_end`, `antenna_event_checkin`, `antenna_event_upload_image`, `antenna_event_update`, `antenna_event_approve`, `antenna_event_reject`, `antenna_event_add_host`, `antenna_event_message`。

## Drift Bottle (漂流瓶)

写一段话，丢进海里。随机一个陌生人会捡起它。完全匿名、随机、好玩。

### 规则
- 每条消息最多 500 字
- 一次只能捡一个瓶子，回复后才能捡下一个
- 完全匿名：永远不暴露谁丢的、谁捡的
- 漂流瓶 7 天后过期

### Tools

#### `antenna_drift_throw`
丢一个漂流瓶。
- `sender_id`, `channel`
- `message`：瓶中的内容（最多 500 字）
- 返回 bottle_id 和确认

#### `antenna_drift_pick`
捡一个漂流瓶。
- `sender_id`, `channel`
- 返回瓶中消息（匿名）+ bottle_id
- 如果海上没瓶了，说没有
- 如果还有没回复的瓶子，提示先回复

#### `antenna_drift_reply`
回复一个捡起的漂流瓶。
- `sender_id`, `channel`
- `bottle_id`：要回复的瓶子 ID
- `reply`：回复内容（最多 500 字）
- 回复会匿名漂回给丢瓶子的人

#### `antenna_drift_check`
检查漂流瓶状态。
- `sender_id`, `channel`
- 返回：你丢的瓶子有没有新回复 + 你捡的瓶子有没有待回复

#### `antenna_drift_my_bottles`
查看你丢过的所有瓶子。
- `sender_id`, `channel`
- 返回每个瓶子的状态：🌊 漂流中 / 👀 被捡起 / 💬 已回复

### 什么时候推荐漂流瓶
- 用户无聊、想找人聊天
- 用户想写点什么但不知道发给谁
- 用户想要随机的、意外的连接
- 用户想匿名表达
- 附近没人的时候，作为替代发现方式

### 隐私
- **永远不暴露** 谁丢的瓶子
- **永远不暴露** 谁捡的瓶子
- 只展示：消息内容、是否有回复、回复内容
- device_id 永远不展示给用户

## Data Transparency

Antenna 只跟 Supabase (bcudjloikmpcqwcptuyd.supabase.co) 通信。

**发送的数据:** GPS(不原始存储)、名片文本、匹配状态、你选择分享的联系方式、Profile embedding。
**不发送的数据:** 你跟 agent 的对话、文件、浏览记录。

Source code: https://github.com/H1an1/Antenna
