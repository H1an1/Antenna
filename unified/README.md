# 📡 Antenna

Nearby people discovery — find interesting people around you.

## Install

```bash
npm install -g antenna-fyi
```

## CLI Usage

```bash
# Create your profile card
antenna setup --id telegram:123

# Scan for nearby people
antenna scan --lat 39.99 --lng 116.48 --radius 500 --id telegram:123

# Check in at a location
antenna checkin --id telegram:123 --lat 39.99 --lng 116.48

# View/edit your profile
antenna profile --id telegram:123
antenna profile --id telegram:123 --name Yi --emoji 🦦 --line1 'Product Designer'

# Accept a match
antenna accept --id telegram:123 --target telegram:789 --contact 'WeChat: yi'

# Check match status
antenna matches --id telegram:123

# Show status
antenna status --id telegram:123
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
2. **Scan nearby** — find people within radius at your location
3. **Accept matches** — if both sides accept, exchange contact info
4. **Everything expires in 24h** — ephemeral by design

## License

MIT
