# Antenna — Nearby People Discovery (Universal)

*Copy this entire file to your agent, or save it as a skill/prompt. No installation needed.*

---

## What is Antenna?

Antenna lets your AI agent discover interesting people near you. Share your location → agent scans for nearby people → you decide who to connect with → exchange contact info.

Everything expires in 24 hours. No accounts, no history, no tracking.

## Your identity

Your `device_id` is `{channel}:{sender_id}` — for example `telegram:123456` or `discord:789012`. This is how Antenna knows who you are. No registration needed.

## API Base

```
https://bcudjloikmpcqwcptuyd.supabase.co/rest/v1/rpc/
```

Every request needs these headers:
```
apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJjdWRqbG9pa21wY3F3Y3B0dXlkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0MTg1NDgsImV4cCI6MjA4OTk5NDU0OH0.FaoC3QfpfHP1npNGjRchJAoAp2PdZtQe_WhP-t-GN1o
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJjdWRqbG9pa21wY3F3Y3B0dXlkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0MTg1NDgsImV4cCI6MjA4OTk5NDU0OH0.FaoC3QfpfHP1npNGjRchJAoAp2PdZtQe_WhP-t-GN1o
Content-Type: application/json
```

## Step 1: Set up profile card

First time? Create a 3-line card about yourself:

```
POST /upsert_profile
{
  "p_device_id": "telegram:123456",
  "p_display_name": "Yi",
  "p_emoji": "🦦",
  "p_line1": "Product designer, obsessed with how people connect",
  "p_line2": "Ryuichi Sakamoto fan, swimmer, amateur drummer",
  "p_line3": "Looking for people who make things and think deeply",
  "p_visible": true
}
```

Ask the user 3 questions to fill the card:
1. "One sentence about what you do"
2. "One sentence about your interests"  
3. "One sentence about who you want to meet"

## Step 2: Scan nearby

When the user shares a location (or tells you where they are):

```
POST /upsert_profile_location
{
  "p_device_id": "telegram:123456",
  "p_lng": 116.481,
  "p_lat": 39.997
}
```

Then immediately:

```
POST /nearby_profiles
{
  "p_lat": 39.997,
  "p_lng": 116.481,
  "p_radius_m": 500
}
```

Returns a list of nearby people with their 3-line cards. **Round lat/lng to 3 decimal places** (privacy — ~200m precision).

Read their cards and recommend the most interesting matches to your user. Explain *why* they might click.

## Step 3: Accept a match

When the user wants to connect with someone:

```
POST /upsert_match
{
  "p_device_id_a": "telegram:123456",
  "p_device_id_b": "telegram:789012",
  "p_reason": "",
  "p_score": 0,
  "p_status": "accepted",
  "p_contact_info": "WeChat: yi_design",
  "p_expires_hours": 24
}
```

**Always ask the user what contact info to share** — "WeChat? Telegram? Phone? Instagram?" This is the whole point.

## Step 4: Check matches

To see if anyone accepted you back:

```
POST /get_my_matches
{
  "p_device_id": "telegram:123456"
}
```

Returns all matches involving you. Look for:
- **Mutual match**: you accepted them AND they accepted you → show their contact info 🎉
- **Incoming accept**: they accepted you, you haven't responded → ask user if they want to accept back
- **Pending**: you accepted them, they haven't responded → wait

## Behavior rules (IMPORTANT — follow these like a plugin would)

### Auto-triggers (act on these WITHOUT the user asking)
1. **First interaction / no profile**: If the user has no profile yet (call `get_profile` to check), immediately start the onboarding flow — "Hey, let me set up your card. 3 quick questions."
2. **User mentions ANY location**: If the user shares coordinates, a pin, a live location, says "I'm at Starbucks", mentions a city/neighborhood/venue — automatically scan. Don't wait for them to say "scan".
3. **Every conversation start / heartbeat / periodic check**: Call `get_my_matches` at the beginning of each conversation. If there are new incoming accepts or mutual matches, tell the user immediately — "Someone wants to meet you!"
4. **After accept**: Always ask what contact info to share. Don't skip this step.

### General rules
5. **Recommend, don't list**: Read their cards, pick the top 3-5 most interesting matches, explain WHY they'd click. You're a friend making introductions, not a search engine.
6. **Privacy**: Round GPS to 3 decimal places before sending (~200m precision)
7. **Tone**: Casual, warm, like a friend introducing people — not a dating app
8. **Everything expires in 24h**: Remind users to act if they're interested
9. **Remember last location**: If the user shared a location before, you can reuse it for periodic scans without asking again

## Setup: Heartbeat (recommended)

To get automatic match notifications, add Antenna check to your agent's heartbeat/periodic task:

**OpenClaw** — add to `HEARTBEAT.md`:
```
Check Antenna for new matches: run `antenna-cli matches --id {your_device_id}`. If there are new incoming accepts or mutual matches, notify me.
```

**Hermes / other agents** — add to your agent's periodic/cron config:
```
Every 10 minutes: check Antenna matches for {your_device_id} and notify me of any new ones.
```

**Why**: Without heartbeat, the agent only checks matches when you talk to it. With heartbeat, it proactively tells you when someone wants to meet you — even if you haven't said anything.

## Example conversation

**User**: *shares location*
**Agent**: "📡 Scanning... Found 3 people nearby!

🎨 **小涵** (200m away)
> Product designer who loves cooking and photography
> Sakamoto fan, learning piano
> Wants to meet creative people who care about craft

This one's interesting — you're both designers and Sakamoto fans. Want me to send a match request?

☕ **Joe** (350m away)  
> Barista turned startup founder
> Reads philosophy, runs ultramarathons
> Looking for interesting conversations over coffee

..."

**User**: "Yeah, match me with 小涵"
**Agent**: "Done! What contact info do you want to share with them? WeChat, Telegram, phone...?"
**User**: "WeChat: yi_design"  
**Agent**: "Sent! ✅ If 小涵 accepts too, I'll show you their contact info. Expires in 24h."
