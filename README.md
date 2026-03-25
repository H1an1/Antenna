# 🦐 Antenna — Agent-Mediated Social Discovery

## 一句话
Agent 帮你感知附近有趣的人。

## 核心概念
- 人不好意思搭讪，agent 做中间人没有社交压力
- Agent 知道主人的兴趣和状态，匹配质量远高于"附近的人"
- 省去破冰环节——"你的 agent 觉得你们应该认识"

## 产品形态
原生 App（iOS/Android），React Native + Expo

### App 做三件事：
1. **名片编辑** — 用户写几句话描述自己
2. **GPS 采集** — 本地转 geohash 后上报（不传精确坐标）
3. **附近发现** — 展示附近匹配的人 + agent 写的推荐理由

### 不做的事：
- ❌ 登录/注册（设备 ID 绑定）
- ❌ 聊天功能（用户自己有十个聊天 app）
- ❌ 完整社交平台（我们是传感器 + 名片夹）
- ❌ Match 历史永久保留（24h 过期，agent 记忆不在 App 里）
- ❌ 好友列表

### 24h 过期规则
- App 里的 match 卡片：24h 后消失
- Agent-to-agent 对话记录：24h 后清除
- 推送通知：24h 没行动就没了
- **唯一持久的**：你的名片 + agent 侧的记忆（不在 App 里显示）

### 设计方向
- **风格**：暖色铝壳 + 浅色奶油雷达屏（航海仪器感 × 温暖）
- **雷达页**：真实雷达圆盘，头像按距离散落，点击展开详情卡
- **名片页**：LN.1/2/3 标签 + Visible 开关 + Edit
- **色调**：星光色铝壳 + 奶油屏幕 + 橙色 accent + JetBrains Mono
- **设计文件**：`design/minimal/radar-v6.html`（最终版）

## 架构
- **App** = GPS 传感器 + 名片夹 + 通知管道
- **后端** = Supabase（Auth-free, PostGIS, Edge Functions）
- **智能层** = OpenClaw agent 通过 API 读取名片 + 判断匹配
- **隐私** = 精确 GPS 不上传，geohash 模糊匹配（~200m）

## API
开放 REST API 供 OpenClaw agent 调用：
- `GET /nearby/:deviceId` — 获取附近的人的名片
- `POST /profile/:deviceId` — 更新名片
- `GET /matches/:deviceId` — 获取 agent 匹配结果
- 推送通知通过 FCM/APNs

## V0.1 目标（5 天）
- [ ] Expo 项目骨架
- [ ] GPS 采集 + geohash 转换 + 上报
- [ ] 名片编辑页
- [ ] 附近发现页
- [ ] Supabase 后端（PostGIS + 名片存储）
- [ ] agent 匹配 API
- [ ] 推送通知
- [ ] TestFlight / APK 分发

## 时间线
| 日期 | 目标 |
|------|------|
| 周一晚 | 项目骨架 + GPS 采集 + geohash |
| 周二 | 名片页 + 附近发现页 + Supabase |
| 周三 | agent 匹配逻辑 + 推送 |
| 周四 | 联调 + bug fix |
| 周五 | TestFlight 分发 + 内测 |

## 团队
- **Yi** — 产品设计 / UI/UX
- **Han1** — 开发（Claude Code）/ 增长策略
- **Friday** — 产品逻辑 review / 砍需求 / 节奏把控

## 冷启动
- 场景钉子：线下活动（AI 闹等）
- 第一批用户：OpenClaw 社区 + AI 闹参与者 + Yi 社交圈
- 目标：50 个北京用户
- 先海外服务器 + TestFlight，不等备案

---

*2026-03-24 创建*
