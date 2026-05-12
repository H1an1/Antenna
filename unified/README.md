# 📡 Antenna

Nearby people discovery — find interesting people around you.

## Install

```bash
npm install -g antenna-fyi
```

## CLI Usage

```bash
# Find people by intent (agent-facing search)
antenna find --id <platform>:<user_id> --query "想找一个懂 consumer social 增长的人"
antenna find-people --id <platform>:<user_id> --query "find someone building AI hardware" --limit 3

# Create your profile card
antenna setup --id <platform>:<user_id>

# Scan for nearby people
antenna scan --lat 39.99 --lng 116.48 --radius 500 --id <platform>:<user_id>

# Check in at a location
antenna checkin --id <platform>:<user_id> --lat 39.99 --lng 116.48

# View/edit your profile
antenna profile --id <platform>:<user_id>
antenna config --key <ant_xxx>
antenna profile --id <platform>:<user_id> --name Yi --line1 'Product Designer'

Profile writes require the user's Antenna API key from antenna.fyi/me. The CLI verifies the key and writes to the dashboard-linked `user:<uuid>` profile; agents should not create profiles from `channel:sender_id`.

# Accept a match
antenna accept --id <platform>:<user_id> --target <ref_or_id> --contact 'WeChat: yi'

# Check match status
antenna matches --id <platform>:<user_id>

# Show status
antenna status --id <platform>:<user_id>
```

## MCP Server

Start the MCP server for AI agent integration:

```bash
antenna serve
```

This starts a stdio-based MCP server with tools:
- `antenna_scan` — Scan for nearby people
- `antenna_profile` — Get/set profile card
- `antenna_checkin` — Check in at a location
- `antenna_accept` — Accept a match
- `antenna_check_matches` — Check match status
- `antenna_find_people` — Find 1-3 people from a free-form user intent. Use when the user says "I want to meet/find someone who..."; returns refs and safe profile fields, not contact info or raw device IDs.

## Hermes Agent Integration

### Option 1: MCP Server (recommended)

Add to `~/.hermes/config.yaml`:

```yaml
mcp_servers:
  antenna:
    command: "antenna"
    args: ["serve"]
```

Hermes will auto-discover `mcp_antenna_scan`, `mcp_antenna_profile`, etc.

### Option 2: One-step install (Plugin + Skill + deps)

```bash
antenna install-hermes
```

Done. Restart Hermes.

## OpenClaw Integration

### Install Skill (recommended)

```bash
antenna install-skill
```

Copies the SKILL.md to `~/.openclaw/skills/antenna/` so your agent knows how to use Antenna.

### Install Plugin (advanced)

```bash
mkdir my-antenna-plugin && cd my-antenna-plugin
antenna install-plugin
npm install
openclaw plugins install .
```

The plugin adds automatic location-triggered scanning, match polling, and real-time notifications.

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `ANTENNA_SUPABASE_URL` | Supabase project URL | Built-in |
| `ANTENNA_SUPABASE_KEY` | Supabase anon key | Built-in |

## How It Works

1. **Create a profile card** — emoji, name, 3 lines about you
2. **Find by intent** — users can say "I want someone who understands X"; agents call `antenna_find_people` / `antenna find`
3. **Scan nearby** — find people within radius at your location
4. **Accept matches** — if both sides accept, exchange contact info
5. **Everything expires in 24h** — ephemeral by design

## License

MIT
