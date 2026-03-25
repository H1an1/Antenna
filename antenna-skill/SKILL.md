# Antenna Skill — Agent-Mediated Social Discovery

> 让你的 agent 感知附近有趣的人，帮你判断值不值得认识。

## 触发条件

用户安装此 skill 后，agent 在 heartbeat 中自动扫描附近的人。

**触发词：** "附近有谁"、"周围有什么人"、"antenna"、"nearby"
**自动触发：** heartbeat 每 10 分钟查一次（如果用户位置有更新）

## 前置条件

- Supabase 项目 URL + Service Role Key（配置在环境变量）
- 用户的 device_id（App 安装时生成，配置在 skill config）
- 用户 GPS 已在 App 端上报

## 配置

skill 配置文件 `antenna.json`：
```json
{
  "supabase_url": "https://xxx.supabase.co",
  "supabase_service_key": "eyJ...",
  "device_id": "user-device-id",
  "scan_radius_m": 500,
  "scan_interval_min": 10,
  "min_score_to_notify": 0.6,
  "quiet_hours": [23, 8]
}
```

## Agent 工作流

### 1. 扫描附近的人

```bash
# 调 Supabase RPC 查附近的人
curl -s "${SUPABASE_URL}/rest/v1/rpc/nearby_profiles" \
  -H "apikey: ${SUPABASE_SERVICE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"p_lat": USER_LAT, "p_lng": USER_LNG, "p_radius_m": 500}'
```

返回格式：
```json
[
  {
    "device_id": "abc123",
    "display_name": "Marcus",
    "emoji": "🔧",
    "line1": "Protocol engineer building agent-to-agent communication",
    "line2": "Working on decentralized identity for AI agents",
    "line3": "Interested in MPC, ZK proofs, and autonomous systems",
    "last_seen_at": "2026-03-25T22:00:00Z"
  }
]
```

### 2. Agent 判断匹配

Agent 在自己的上下文中判断（不调外部 LLM）。Agent 已有用户的 SOUL.md、记忆、偏好。

**Prompt 模板（注入 agent 上下文）：**

```
你附近 {radius}m 内有以下人。基于你对 {user_name} 的了解（兴趣、项目、社交偏好），
判断每个人是否值得认识。

{nearby_profiles_formatted}

对每个人输出：
- match: true/false
- score: 0.0-1.0（匹配程度）
- reason: 一句话中文，像朋友推荐一样自然（例："他也在折腾 agent 通信，你们肯定有得聊"）

只推荐真正相关的人。宁可不推也不要乱推。
```

### 3. 写入匹配结果

```bash
curl -s "${SUPABASE_URL}/rest/v1/matches" \
  -H "apikey: ${SUPABASE_SERVICE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=minimal" \
  -d '{
    "device_id_a": "MY_DEVICE_ID",
    "device_id_b": "THEIR_DEVICE_ID",
    "reason": "他也在折腾 agent 通信，你们肯定有得聊",
    "score": 0.85,
    "status": "pending",
    "expires_at": "2026-03-26T22:30:00Z"
  }'
```

### 4. 通知用户

Agent 通过已配置的渠道发消息（不走 FCM/APNs）：

```
📡 附近发现有趣的人：

🔧 Marcus（~200m）
"Protocol engineer building agent-to-agent communication"
→ 他也在折腾 agent 通信，你们肯定有得聊

要打个招呼吗？回复 "connect Marcus" 或在 App 里操作
```

### 5. 用户响应

用户回复 "connect Marcus" → agent 更新 match status：
```bash
curl -s "${SUPABASE_URL}/rest/v1/matches?id=eq.MATCH_ID" \
  -X PATCH \
  -H "apikey: ${SUPABASE_SERVICE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"status": "accepted"}'
```

对方 agent 下次扫描时发现有人 accept → 通知对方。

## 脚本

### `scripts/scan-nearby.sh`

供 agent 调用的扫描脚本：

```bash
#!/bin/bash
# Usage: scan-nearby.sh <lat> <lng> [radius_m]
SUPABASE_URL="${ANTENNA_SUPABASE_URL}"
SUPABASE_KEY="${ANTENNA_SUPABASE_SERVICE_KEY}"
LAT="${1:?lat required}"
LNG="${2:?lng required}"
RADIUS="${3:-500}"

curl -s "${SUPABASE_URL}/rest/v1/rpc/nearby_profiles" \
  -H "apikey: ${SUPABASE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"p_lat\": ${LAT}, \"p_lng\": ${LNG}, \"p_radius_m\": ${RADIUS}}"
```

### `scripts/write-match.sh`

```bash
#!/bin/bash
# Usage: write-match.sh <my_device_id> <their_device_id> <reason> <score>
SUPABASE_URL="${ANTENNA_SUPABASE_URL}"
SUPABASE_KEY="${ANTENNA_SUPABASE_SERVICE_KEY}"
EXPIRES=$(date -u -v+24H +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u -d "+24 hours" +"%Y-%m-%dT%H:%M:%SZ")

curl -s "${SUPABASE_URL}/rest/v1/matches" \
  -H "apikey: ${SUPABASE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d "{
    \"device_id_a\": \"${1}\",
    \"device_id_b\": \"${2}\",
    \"reason\": \"${3}\",
    \"score\": ${4},
    \"status\": \"pending\",
    \"expires_at\": \"${EXPIRES}\"
  }"
```

## Heartbeat 集成

在 agent 的 HEARTBEAT.md 中添加：

```markdown
### Antenna 扫描
- 读 GPS 位置（OwnTracks 或 App 上报）
- 如果位置有更新且在活跃时段，调 scan-nearby.sh
- 有新的附近的人 → 判断匹配 → 通知用户
- 检查是否有人 accept 了我的 match → 通知用户
```

## 隐私

- Agent 只读到对方的名片（3 句话），不读精确 GPS
- 匹配理由由 agent 生成，不经过任何第三方
- 24h 后 match 数据自动清除
- 用户可随时关闭 Visible 开关

## V0.2 计划

- agent-to-agent 通信（你的 agent 跟对方的 agent 先聊）
- Supabase Realtime 监听替代轮询
- 活动模式（更短过期、更密集扫描）
