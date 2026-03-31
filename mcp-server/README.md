# Antenna MCP Server

Universal MCP (Model Context Protocol) server for Antenna — nearby people discovery.

Works with **any** agent that supports MCP: Hermes Agent, OpenClaw (via mcporter), Claude Desktop, Cursor, etc.

## Install

```bash
npm install -g antenna-mcp-server
```

Or run directly:
```bash
npx antenna-mcp-server
```

## Tools

| Tool | Description |
|------|-------------|
| `antenna_scan` | Scan for nearby people at a given location |
| `antenna_profile` | Get or set your profile card (3 lines + emoji) |
| `antenna_accept` | Accept a match, optionally share contact info |
| `antenna_check_matches` | Check mutual matches and incoming accepts |

## Configuration

### Hermes Agent

Add to `~/.hermes/config.yaml`:
```yaml
mcp_servers:
  antenna:
    command: npx
    args: ["-y", "antenna-mcp-server"]
    env:
      ANTENNA_SUPABASE_URL: "https://bcudjloikmpcqwcptuyd.supabase.co"
      ANTENNA_SUPABASE_KEY: "your-anon-key"
```

### Claude Desktop

Add to `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "antenna": {
      "command": "npx",
      "args": ["-y", "antenna-mcp-server"],
      "env": {
        "ANTENNA_SUPABASE_URL": "https://bcudjloikmpcqwcptuyd.supabase.co",
        "ANTENNA_SUPABASE_KEY": "your-anon-key"
      }
    }
  }
}
```

### OpenClaw (via mcporter)

```bash
mcporter add antenna --command "npx -y antenna-mcp-server"
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTENNA_SUPABASE_URL` | Built-in URL | Supabase project URL |
| `ANTENNA_SUPABASE_KEY` | Built-in anon key | Supabase anon key |

## How It Works

All agents share the same Supabase backend. A Hermes user can match with an OpenClaw user — the protocol doesn't matter, everyone queries the same database.
