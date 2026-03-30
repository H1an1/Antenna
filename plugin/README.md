# Antenna — OpenClaw Plugin

Agent-mediated nearby people discovery. Your agent helps you find and connect with people around you.

## How it works

1. Share your location in Telegram or WhatsApp (or tell your agent where you are)
2. Agent scans for nearby people via Supabase + PostGIS
3. Agent shows you matches with reasons why you might click
4. Accept a match → if mutual, agents facilitate introductions
5. Everything expires in 24 hours

## Install

```bash
# From the plugin directory
openclaw plugins install -l ./plugin

# Or copy to extensions
cp -r ./plugin ~/.openclaw/extensions/antenna
```

## Configure

Add to `~/.openclaw/openclaw.json`:

```json5
{
  plugins: {
    entries: {
      antenna: {
        enabled: true,
        config: {
          supabaseUrl: "https://your-project.supabase.co",
          supabaseKey: "your-service-role-key",  // NOT the anon key
          defaultRadiusM: 500,
          matchExpiryHours: 24,
          maxMatches: 5,
          autoScanOnLocation: true
        }
      }
    }
  }
}
```

Then restart the gateway:

```bash
openclaw gateway restart
```

## Supabase setup

Run the migrations in order:

```bash
cd supabase
supabase db push
```

Or manually apply:
1. `migrations/20260325060000_upgrade_schema.sql` — PostGIS + profiles + nearby_profiles()
2. `migrations/20260325140000_rls_and_cron.sql` — RLS + auto-cleanup
3. `migrations/20260330200000_plugin_constraints.sql` — unique constraints for upsert

## Architecture

```
Plugin (index.ts)
├── antenna_scan tool      — query nearby people
├── antenna_profile tool   — view/update name card
├── antenna_accept tool    — accept a match
└── before_prompt_build    — auto-inject scan hint on location messages

Skill (SKILL.md)
└── teaches agent how to present results, guide profile setup, handle matches

Supabase
├── profiles table         — name cards + GPS (PostGIS geography)
├── matches table          — match results (24h expiry)
├── nearby_profiles()      — PostGIS spatial query
└── pg_cron cleanup        — hourly expired match cleanup
```

## Supported platforms

Location auto-detection (OpenClaw parses the coordinates):
- ✅ Telegram (live + static)
- ✅ WhatsApp (live + static)
- ✅ Matrix (static)

Manual location (user tells agent where they are):
- ✅ Any platform (Discord, Slack, Signal, iMessage, etc.)
