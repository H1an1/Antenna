# Antenna — 项目规范

## 版本管理
- **x.y.0** — 正式发版（测试完、功能完整、Yi 确认后才发 npm）
- **x.y.z** — bug fix / 小修补
- 新功能先改代码 + 本地测试，**不自动发 npm**
- 跟 Yi 说"改好了测一下"，Yi OK 了再 bump 版本发布

## 当前版本
- `antenna-fyi` — 1.2.32
- `antenna-openclaw-plugin` — 1.2.32

## Repos
- `H1an1/Antenna` — 主 repo（public，开源）
- `H1an1/Antenna-fyi` — 网站 repo
- Push 用 `fridayyi` GitHub 账号（`gh auth switch --user fridayyi`）

## Supabase
- URL: `https://bcudjloikmpcqwcptuyd.supabase.co`
- Region: Northeast Asia (Tokyo)
- Management API: `POST https://api.supabase.com/v1/projects/bcudjloikmpcqwcptuyd/database/query`
- Auth: `Bearer sbp_0ace5a1e3b9c819a5e94b557af9cd2c4795439c0`

## 代码路径
- `projects/antenna/unified/` — npm 包源码
- `projects/antenna/plugin/` — OpenClaw Plugin
- `projects/antenna-website/` — 网站（Next.js, Vercel）

## 产品规则
- Antenna 是 AI Native 产品，没有 agent 的人不是目标用户
- 网页只做 GPS 采集 + 活动引导，不做 profile 创建 / 看人 / accept
- 所有交互通过 agent
- 名片三句话不应包含联系方式——联系方式只在 mutual match 后交换
- 隐私：GPS 模糊 ~150m，24h 过期，不收集邮箱/手机号/照片
- 搜索上限 1km（后端硬限制）
- 全球推荐每天 1 次（后端限制），用户 opt-in（onboarding 时问）
- device_id 不暴露给用户（返回 ref 编号）
- SKILL.md 是 agent 的行为指南，但不可靠——关键限制必须在后端

## 团队
- **Yi** — 产品方向、UI、最终决策
- **Han1** — 开发、后端、npm 发布
- **Friday** — 产品建议、代码 review、设计

## 版本路线
- v1.0 — 稳定化（数据透明、清脏数据）✅
- v1.1 — match_reason + pass ✅
- v1.2 — 活动模式 + matching_context + ref bug fix ✅
  - 活动内无距离限制
  - scan 叠加不替代（活动 + 附近，标记 source）
  - 活动结束后 profile 留全局（增长飞轮）
  - matching_context: agent 生成的丰富 context，不展示给别人，只用于 embedding
  - onboarding 流程：先 context → 再三句话
- v1.3 — 预约 scan
- v1.4 — 匹配质量提升
