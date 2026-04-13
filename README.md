# 📡 Antenna

AI-powered social discovery. Your agent finds interesting people within 1km.

**Website:** [antenna.fyi](https://www.antenna.fyi)
**npm:** [antenna-fyi](https://www.npmjs.com/package/antenna-fyi)

## Install

```bash
# Hermes / any agent
npm install -g antenna-fyi

# OpenClaw
openclaw plugins install antenna-openclaw-plugin --dangerously-force-unsafe-install
```

## Structure

```
unified/          # npm package — CLI + MCP server + Hermes Plugin + Skill
plugin/           # OpenClaw Plugin (TypeScript)
core/             # Shared core logic (legacy, now embedded in unified/)
cli/              # CLI (legacy, now embedded in unified/)
mcp-server/       # MCP server (legacy, now embedded in unified/)
supabase/         # Database migrations
```

## How it works

1. Install → your agent gets Antenna built in
2. Agent helps you write a 3-line profile card
3. Share GPS via [antenna.fyi/locate](https://www.antenna.fyi/locate)
4. Agent scans 1km, recommends who's worth meeting
5. Both accept → swap contacts → meet IRL
6. Everything disappears in 24 hours

## Privacy

- GPS blurred to ~150m
- No registration, no photos, no analytics
- All data auto-deletes after 24h
- Search radius capped at 1km server-side
- Open source

## License

MIT
