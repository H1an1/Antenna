# Changelog

All notable changes to this project will be documented in this file.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
Versioning: Plugin / CLI / MCP 分开标版本号。

---

## [v1.3.8] — 2026-05-08

### Added
- **event_update** 支持 `requires_approval` + `screening_questions` 字段

## [v1.3.7] — 2026-05-07

### Added
- **antenna_event_message** — 主办方向参与者发消息

## [v1.3.6] — 2026-05-06

### Fixed
- Hermes Plugin ref parity — offset + save_scan_refs + accept/pass DB fallback

## [v1.3.5] — 2026-05-05

### Fixed
- ref collision 修复 + OC Plugin 通知系统重写

## [v1.3.4] — 2026-05-04

### Added
- **auto-embed on upsert_profile** — RPC → pg_net → generate-embedding，profile 保存后自动生成 embedding

## [v1.3.3] — 2026-05-03

### Fixed
- Gemini embedding 修复 + SKILL.md onboarding 重写 + poll notification 修复

## [v1.3.2] — 2026-05-02

### Fixed
- 13 个 review issues — parity, security, agent-native, RPC params

## [v1.3.1] — 2026-05-01

### Changed
- Agent-native audit — 去掉真实用户 ID、平台特定示例、HP check_matches 隐私、channel descriptions、重复 globals

## [v1.3.0] — 2026-04-30

### Added
- **Make Events Complete** — 活动审批、co-hosts、通知系统、安全加固、agent-native audit

## [v1.2.32–v1.2.42] — 2026-04-15 ~ 2026-04-29

### Added
- SKILL.md agent-native self-check — 消除歧义，添加显式信号
- `created_by` required on create_event
- webhook deliver-only push, install-hermes auto-config
- Hermes event poll + PID file cross-version dedup
- Event approval poll fallback + `get_my_event_updates` RPC
- Hermes Realtime listener thread + pending scan gate + discover quality filter
- Watch realtime event notifications + pushNotify fix
- `chat_id` on all tools + persist to DB for notifications

### Fixed
- Event notification dedup, schema parity, scan upsert cleanup
- Push both openclaw+hermes, not either/or
- P0 privacy fixes, P1 reliability, P2 scan/matches perf
- Watch log file + stdout blocking + status health check

---

## [Website] — 2026-04-15 ~ 2026-05-09

### Added
- **Dashboard (/me)** — 用户注册 + 登录 + profile 编辑 + API key 管理
- **Public profile (/p/[slug])** — 公开身份卡，agent-native 介绍页
- **Auth system** — Email OTP 验证码登录 + Google OAuth
- **Archetype matching** — 希腊神话原型分配 + profile card 正反翻转
- **Hero 改版** — video gallery frame + "Your agent finds your people" tagline
- **Promo page** — Hyperframes 宣传视频页面
- **EngravedPanel 组件** — 统一 dashboard 和 profile 的 UI 面板
- **Social link icons** — GitHub, X, Instagram, LinkedIn, Telegram 等
- **Favicon 更新** — 新 brand/antenna.svg
- **Deep Context 特性卡** — 新增 feature grid 第 7 张卡片

### Changed
- **Features copy 全面更新** — 去掉 24h 过期描述、GPS 精度描述；"Zero Config" → "One API Key"；HOW section 改为 signup 流程；Event Mode 加入时间衰减 + trust model
- **Login 改为 Email OTP** — 从 magic link 改为验证码
- Dashboard 拆分为 ProfileCard / ProfileEditor / ApiKeyModal / TodaySection 组件

### Fixed
- **Profile 保存失败** — profiles 表 RLS 开启但无 policy，dashboard 写入被默默拒绝
  - 新增 `save_user_profile` RPC (SECURITY DEFINER) 处理首次创建/绑定
  - 新增 RLS policies: own_profile_select, own_profile_update, public_visible_select
  - Dashboard 首次保存走 RPC，后续编辑走 RLS 直接更新
- Auth callback error/timeout handling
- Dashboard RPC errors + revoke confirm

---

## [Plugin 0.5.0 / CLI 0.2.0 / MCP 0.2.0] — 2026-04-02

### Added
- **实时通知** — 后台轮询检测到新匹配时，通过 `openclaw agent --deliver` 直接推送给用户，不再等心跳或用户发消息
- **`antenna_checkin` tool** — 只更新自己的位置，不扫描别人。"我到了"广播。四层全加（Plugin / Core / CLI / MCP）
- **RLS 安全加固** — `profiles` 和 `matches` 表开启 Row Level Security。anon key 只能读 visible profiles，matches 完全锁定

### Changed
- 后台轮询不再存 `_pendingNotifications` 等用户说话，改为即时发送
- 三种通知场景：🎉 双向匹配 / 📩 有人想认识你 / ⏳ cron follow-up（双保险）

---

## [Plugin 0.4.0] — 2026-04-01

### Added
- **Cron-based follow-up** — accept 非 mutual 时创建 15 分钟循环 cron job，检查对方是否回应。2 小时自动清理，mutual 时双向清理
- `startFollowUpCron` / `stopFollowUpCron` 辅助函数
- cron job ID 格式 `antenna-follow-{deviceA}-{deviceB}`，精确删除不影响其他 job

---

## [Plugin 0.3.x] — 2026-03-31

### Added
- **antenna-core 共享包** — 抽取 `core/index.js`，CLI 和 MCP 共用。CLI 体积 -30%，MCP -60%
- **Universal Skill** — 零安装方案，复制粘贴 SKILL.md 即可让任何 agent 使用 Antenna
- **antenna-cli** — 一行命令 `npx antenna-cli scan/profile/accept/matches`
- **MCP Server** — 通用 Antenna 集成，任何支持 MCP 的 agent 框架都能用

### Changed
- 所有写操作改为 RPC 调用（`SECURITY DEFINER`），兼容 anon key
- Plugin manifest id 对齐 npm 包名 `antenna-openclaw-plugin`

### Fixed
- `check_matches` 现在显示 incoming accepts（"有人想认识你"通知）
- 允许 `NULL` reason in matches（accept 时不强制要求匹配理由）

---

## [Plugin 0.2.x] — 2026-03-30

### Added
- **SECURITY DEFINER RPCs** — 7 个 RPC 函数全部改为 SECURITY DEFINER，anon key 可直接写入
- **Proactive onboarding** — 安装后 agent 自动引导用户创建名片 + 分享位置
- **后台匹配轮询** — `registerService` 每 10 分钟查新匹配，`before_prompt_build` hook 注入通知
- **Heartbeat 匹配检查** — 心跳触发时自动检查 Supabase 是否有新 mutual matches
- SKILL.md 要求 agent accept 后立即索要联系方式

### Changed
- 数据库新增 `reason`、`contact_info_a`、`contact_info_b` 列
- 新增唯一约束 `profiles_device_id_key`、`matches_device_id_pair_key`

---

## [Plugin 0.1.x] — 2026-03-29

### Added
- **初版 Plugin** — `antenna_scan` / `antenna_profile` / `antenna_accept` / `antenna_check_matches` 四个 tool
- `before_prompt_build` hook：收到位置消息自动触发 scan
- Zero-config 共享 Supabase 后端（内置 URL + anon key）
- configSchema 支持自定义 `supabaseUrl` / `supabaseKey`
- GPS fuzzing（`Math.round(lat * 1000) / 1000`，~200m 模糊）
- Rate limiting：同一 device_id 30 秒内只处理一次
- `device_id` = `${channel}:${senderId}`（零注册）

---

## [App 0.1.0] — 2026-03-25

### Added
- **React Native + Expo 骨架** — ProfileScreen / RadarScreen / MatchesScreen
- **v6 雷达 UI** — 浅色奶油雷达屏 + 暖铝壳，pixel-perfect 对齐
- Supabase schema + PostGIS + Edge Function 部署
- RLS policies + pg_cron 24h 清理
- 三 tab 底栏：PROFILE / NEARBY / MATCHES
- Mock 数据（5 个头像，72° 等间距分布）

---

## 包版本对照表

| 日期 | Plugin | CLI | MCP | 关键变更 |
|---|---|---|---|---|
| 2026-04-02 | 0.5.0 | 0.2.0 | 0.2.0 | 实时通知 + checkin + RLS |
| 2026-04-01 | 0.4.0 | 0.2.0 | 0.2.0 | cron follow-up + checkin + 版本同步 |
| 2026-03-31 | 0.3.2 | 0.1.0 | 0.1.0 | core 抽取 + CLI + MCP + universal skill |
| 2026-03-30 | 0.2.x | — | — | SECURITY DEFINER + onboarding + 轮询 |
| 2026-03-29 | 0.1.x | — | — | 初版 plugin |
| 2026-03-25 | — | — | — | App 骨架 + Supabase |
