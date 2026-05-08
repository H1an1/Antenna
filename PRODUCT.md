# Antenna - 产品文档

> Agent 帮你感知附近有趣的人。

## 一、产品定位

**不是社交 App,是社交传感器。**

人不好意思搭讪,agent 没有社交压力。App 只做三件事:采集 GPS、编辑名片、显示匹配结果。所有智能判断在用户自己的 OpenClaw agent 端完成。

### 核心差异
| 传统社交 App | Antenna |
|---|---|
| 平台算法匹配 | 你的 agent 帮你判断 |
| 注册/登录/完善资料 | 网站注册 + API key + 三句话名片 |
| 永久好友列表 | Time decay — 可见性随时间衰减,事件重新激活 |
| App 内聊天 | 不做——你有十个聊天 App |
| 平台拥有数据 | agent 拥有记忆,App 只存名片 |

### 不做的事
- ✔️ 登录注册系统 — 已完成 (antenna.fyi 网站注册 + Dashboard)
- ❌ 聊天功能
- ❌ 好友列表
- ❌ 算法推荐

**可见性模型:** 不再是 24h 过期,而是 time decay:
- Event 后 0-7 天: 全部参与者互相可见
- 7-30 天: 只有互相 scan 过/有共同活动的人可见
- 30 天后: 需要新事件重新激活

---

## 二、架构

```
┌─────────────┐
│   App        │  GPS 传感器 + 名片夹 + 结果展示
└──────┬───────┘
       │ GPS + 名片
       ▼
┌──────────────┐
│  Supabase     │  PostGIS 空间查询 + 名片存储 + matches 表
└──────┬───────┘
       │ nearby_profiles() 
       ▼
┌──────────────┐
│  OpenClaw     │  你的 agent 读名片 → 判断匹配 → 写回 match → 通知你
│  Agent        │  （通过 Telegram/Discord/iMessage，不走 FCM）
└──────────────┘

┌──────────────┐
│  Web Dashboard │  antenna.fyi/me — 注册、API key 管理、名片编辑、查看匹配
└──────────────┘

┌──────────────┐
│  Public Pages  │  antenna.fyi/p/[slug] — 公开身份卡
└──────────────┘
```

**关键决策(2026-03-25):**
- 匹配判断不用 Edge Function + 外部 LLM,直接让 agent 在自己的上下文里判断
- 推送通知不走 FCM/APNs,agent 通过已有聊天渠道通知用户
- Supabase 只做数据存储 + 空间查询,不做智能

---

## 三、已完成 ✅

### App 前端(Expo + TypeScript + React Navigation)
- [x] **RadarScreen** - SVG 雷达圆盘 + 扫描线动画 + 范围选择器(200m/500m/1km/2km)
- [x] **PersonPin** - 头像按距离散落在雷达上
- [x] **PersonCard** - 点击头像弹出详情卡(名片 + 匹配理由 + Skip/Connect)
- [x] **ProfileScreen** - 三行名片编辑(Who I Am / What I'm Building / What Interests Me)+ Visible 开关
- [x] **Tab Bar** - Radar / Profile 两个 tab
- [x] **Theme** - 暖色铝壳 + 奶油雷达屏 + 橙色 accent + JetBrains Mono

### 后端(Supabase)
- [x] **Schema** - PostGIS 空间索引 + profiles 表 + matches 表
- [x] **24h 过期字段** — schema 里有 `expires_at` → 已迁移到 time decay 模型
- [x] **nearby_profiles()** - PostGIS 空间查询函数
- [x] **名片 CRUD** - 创建/读取/更新
- [x] **match-nearby Edge Function** - 关键词匹配 V0.1(过渡方案)

### 服务层
- [x] **GPS 采集** - `expo-location` 前台定位 + geohash 编码
- [x] **位置上传** - 定时上报到 Supabase
- [x] **设备 ID** - `expo-crypto` 生成唯一标识
- [x] **匹配触发** - 刷新附近时自动调匹配
- [x] **ProfileScreen 数据加载** - 打开时从 Supabase 读已有名片

### 设计
- [x] **6 轮设计迭代**(v1→v6),从暗色仪器 → 暖色铝壳 + 奶油屏
- [x] **Radar / Profile / Matches 三页完整设计稿**
- [x] **设计文件在** `design/minimal/` 目录

### 基建
- [x] **GitHub repo** - `H1an1/Antenna`(private)
- [x] **Supabase 项目已建** + migrations 版本管理
- [x] **Expo 项目可跑** - `npx expo start` web/iOS/Android

---

## 四、未完成 ❌

### P0 — 上 TestFlight 前必须做
- [x] **agent 匹配逻辑升级** — Edge Function 关键词匹配 → agent 直接判断（砍掉中间层） ✅
- [x] **RLS 策略** — Supabase Row Level Security ✅
- [ ] **真机 GPS 测试** — 扫码跑一遍完整流程
- [x] **App icon + Splash screen** ✅
- [ ] **TestFlight 打包**（iOS）+ APK（Android）
- [ ] **EAS Build 配置** — Expo Application Services

### P1 — 内测阶段
- [x] **OpenClaw antenna skill** — 正式 skill，agent 自动扫描附近 + 判断 + 通知 ✅
- [ ] **Connect Agent 入口** — 设置页填 OpenClaw Gateway URL / 扫码配对
- [x] **emoji 选择器** — 名片头像选 emoji ✅
- [ ] **联调 bug fix** — GPS 权限流程、Edge Function 调试
- ~~[ ] **24h 自动清理** — pg_cron 定时删过期数据~~ → 已改为 time decay 模型,不再硬删

### P2 — V0.2
- [ ] **agent-to-agent 通信** — 你的 agent 跟对方的 agent 打招呼
- [ ] **Supabase Realtime 监听** — 替代 heartbeat 轮询
- [x] **活动模式** — 线下活动特殊场景 ✅ (Events 已实现)
- [ ] **隐私增强** — geohash 模糊化、名片加密

### 新增已完成
- [x] **网站注册系统** — antenna.fyi 注册 + API key 管理
- [x] **Web Dashboard** — antenna.fyi/me 名片编辑、匹配查看
- [x] **Public profile pages** — antenna.fyi/p/[slug]
- [x] **Time decay 可见性模型** — 替代 24h 过期
- [x] **Instant recommendations** — 注册后立刻推荐 2-3 人
- [x] **Events 系统** — 创建/加入/扫描/审核

---

## 五、团队

| 角色 | 谁 | 职责 |
|---|---|---|
| 产品设计 | Yi | UI/UX 决策、方向把控 |
| 开发 | Han1(Claude Code) | 前端 + 后端 + 部署 |
| 产品 Review | Friday | 砍需求、节奏、文档 |

---

## 六、冷启动计划

- **场景钉子:** 线下活动(AI 闹、黑客马拉松)
- **第一批用户:** OpenClaw 社区 + AI 闹参与者 + Yi 社交圈
- **目标:** 50 个北京用户
- **策略:** 先海外服务器 + TestFlight,不等 ICP 备案

---

## 七、时间线

| 日期 | 状态 |
|---|---|
| 03-23 周日 | ✅ 项目启动、设计探索 6 轮 |
| 03-24 周二 | ✅ Expo 骨架 + Supabase + GPS + 名片 + 匹配 |
| 03-25 周三 | ✅ 代码推 GitHub、确认架构(agent 判断 > Edge Function)、产品文档 |
| 03-26 周四 | 🎯 RLS + 真机测试 + App icon |
| 03-27 周五 | 🎯 联调 + EAS Build |
| 03-28 周六 | 🎯 TestFlight + 开始拉人 |

---

*创建:2026-03-25 | 维护:Friday*
