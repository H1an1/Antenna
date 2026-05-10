# Antenna — 项目规范

## 版本管理
- **x.y.0** — 正式发版（测试完、功能完整、Yi 确认后才发 npm）
- **x.y.z** — bug fix / 小修补
- 新功能先改代码 + 本地测试，**不自动发 npm**
- 跟 Yi 说"改好了测一下"，Yi OK 了再 bump 版本发布

## 当前版本
- `antenna-fyi — 1.3.22
- `antenna-openclaw-plugin — 1.3.22

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
- 用户注册拿 API key，agent 通过 API 写入 profile 信息
- Dashboard 做身份卡编辑 + API key 管理 + 匹配结果展示
- 名片三句话不应包含联系方式——联系方式只在 mutual match 后交换
- 隐私：Location 不原始存储，不收集邮箱/手机号/照片
- Profile 永久保留，通过时间衰减控制可见性（7天/30天/需新事件激活）
- 活动 = 信任筛选器，比“恰好在附近”更强
- 全球推荐每天 1 次（后端限制），用户 opt-in
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
- v1.3 — 预约 scan + 活动完整功能（审批/co-hosts/通知/安全加固） ✅
- v1.4 — 从“附近发现”到“活动驱动的信任网络”

### v1.4 模块明细

#### 模块一：活动管线漏斗优化 (P0)
- [ ] 报名时 agent 应已创建好 profile（通过 API），空 profile 不出现在 scan 结果里
- [ ] 活动前 24h agent 自动提醒补全 profile
- [ ] 每步转化率埋点（报名→填 profile→到场→scan→match→联系）

#### 模块二：时间衰减 + 可见性规则 (P0)
- [ ] 活动后 0-7 天：全部参与者互相可见
- [ ] 7-30 天：只有互相 scan 过 / 有共同活动的人可见
- [ ] 30 天后：需要新事件重新激活
- [ ] visibility_score 字段 + 衰减计算逻辑
- [ ] scan/match 行为重置衰减计时器
- [ ] 后端 query 基于 visibility 过滤

#### 模块三：安装后即时推荐 (P0)
- [ ] 新用户安装后立即推荐2-3个匹配的人
- [ ] 基于 embedding + matching_context 的初始推荐

#### 模块四：主动推荐（替代被动 scan） (P1)
- [ ] 每天 1-2 个“你可能想认识的人”推荐
- [ ] 推荐基于 matching_context + 共同活动 + tag 重合
- [ ] 用户选择推送时间

#### 模块五：Profile Link 打通 (P1)
- [ ] /p/[slug] 已有，但需要能从 agent 端 accept/pass
- [ ] 线下递名片场景：发个 link 就完成连接

#### 模块六：Dashboard 实时更新 (P1)
- [ ] 发送匹配后 dashboard 实时更新（Supabase Realtime）
- [ ] matches / event tasks 列表实时显示

#### 模块七：漂流瓶（轻社交 + 日常曝光） (P2)
- [ ] 每天可扣3个、捡 3 个
- [ ] 每个瓶子 = 一段话 + profile card
- [ ] 制造 daily habit

### v1.5 规划
- 活动主办方 dashboard（漏斗数据 + 转化率可视化）
- 活动后 7 天复盘数据
