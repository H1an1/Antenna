# 📡 Antenna — Agent-Mediated Social Discovery

> Agent 帮你感知附近有趣的人。

人不好意思搭讪，让 agent 做中间人。Agent 知道你的兴趣和状态，匹配质量远高于"附近的人"。

---

## 安装（OpenClaw Plugin）

```bash
openclaw plugins install antenna-openclaw-plugin
openclaw gateway restart
```

**两步，零配置。** 装完后在 Telegram / WhatsApp 里给你的 agent 发一个位置，就能看到附近的人。

[![npm](https://img.shields.io/npm/v/antenna-openclaw-plugin)](https://www.npmjs.com/package/antenna-openclaw-plugin)

---

## 怎么用

### 1. 创建名片
第一次使用时，agent 会引导你填写：

| 字段 | 说明 | 例子 |
|------|------|------|
| **emoji** | 代表你的 emoji | 🦐 |
| **name** | 显示名 | Yi |
| **line1** | 你是谁 | Product Designer，做 AI 搜索 |
| **line2** | 你喜欢什么 | 坂本龙一、游泳、做饭 |
| **line3** | 你想找什么 | 找人聊产品设计 |

### 2. 发位置
在 Telegram / WhatsApp 里发一个位置给你的 agent。Agent 自动扫描附近的人。

### 3. 查看匹配
Agent 告诉你附近有谁，展示他们的名片和匹配理由：

> 📡 附近发现 2 个人：
>
> 🎸 **小林** — 吉他手，喜欢后摇和 shoegaze，找人一起 jam
> → 你们都提到了音乐——可能聊得来
>
> 🏃 **Alex** — 跑步爱好者，每周三晚朝阳公园
> → 就在附近

### 4. 建联
说"想认识小林"→ agent 帮你标记接受 → 如果小林也接受 → 双方 agent 帮你们交换联系方式（微信/Telegram/手机号，你自己选）。

所有匹配 **24 小时后自动过期**，用完即走。

---

## 核心概念

- **Agent 做中间人**：没有社交压力，省去破冰环节
- **三句话名片**：轻量但有辨识度
- **24h 过期**：match 卡片、联系方式、所有记录 24h 后消失
- **零登录**：设备 ID 绑定，无注册/登录
- **隐私保护**：GPS 坐标模糊化到 ~150m 精度再存储

## 支持的平台

| 平台 | 位置自动检测 | 手动输入 |
|------|:---:|:---:|
| Telegram | ✅ | ✅ |
| WhatsApp | ✅ | ✅ |
| Matrix | ✅ | ✅ |
| Discord / 其他 | — | ✅（告诉 agent 你在哪） |

## 架构

```
用户发位置 → OpenClaw Agent → Antenna Plugin → Supabase（PostGIS）
                                    ↓
                              查 500m 内的人
                                    ↓
                              对比名片，算匹配分
                                    ↓
                              Agent 告诉用户结果
```

- **后端**：Supabase（共享实例，零配置）
- **空间查询**：PostGIS ST_DWithin
- **安全**：RLS + SECURITY DEFINER RPCs + anon key

## 配置（可选）

默认零配置。如果你想用自己的 Supabase 实例，在 `openclaw.json` 里加：

```json
{
  "plugins": {
    "entries": {
      "antenna": {
        "config": {
          "supabaseUrl": "https://your-project.supabase.co",
          "supabaseKey": "your-anon-key",
          "defaultRadiusM": 500,
          "maxMatches": 5,
          "matchExpiryHours": 24
        }
      }
    }
  }
}
```

## 开发

```bash
cd plugin
npm install
# 本地测试...
npm version patch
npm publish
```

## 团队

- **Yi** — 产品设计
- **Han1** — 开发
- **Friday** — 产品逻辑 review

---

*2026-03-24 创建 · 2026-03-30 Plugin v0.1.0 发布*
