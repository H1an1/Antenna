---
name: antenna-events
description: "Antenna Event Mode — create events, manage participants, GPS check-in. Use when a user wants to create an event, join an event, check in, scan event participants, or manage event settings."
tools:
  - antenna_event_create
  - antenna_event_join
  - antenna_event_scan
  - antenna_event_end
  - antenna_event_checkin
  - antenna_event_upload_image
  - antenna_bind
---

# Antenna Event Mode

Create real-world events where everyone's AI agent handles the networking.

## Quick Start

1. **Create**: `antenna_event_create(name, description)` → get shareable link
2. **Share**: Send `antenna.fyi/events/CODE` to attendees
3. **Join**: Attendees' agents call `antenna_event_join(code)`
4. **Check in**: At the venue, `antenna_event_checkin(code)` — GPS verified ≤1km
5. **Discover**: `antenna_event_scan(code)` — no distance limit inside events

## Tools

### `antenna_event_create`
Create an event. Returns a shareable link (antenna.fyi/events/CODE).
- `name`: event name
- `sender_id`, `channel`: from context
- `lat`, `lng`: optional event location
- `starts_at`, `ends_at`: optional time range (default: now to +12h)
- `description`: optional event description
- `og_image`: optional OG image URL for social sharing preview

**GPS flow for events:** If the user doesn't provide coordinates, generate a bind link (`antenna_bind` with `purpose="event"` and `event_code`) and ask them to open it at the event location. The GPS will update the event's coordinates, NOT the user's profile.

### `antenna_event_join`
Join an event by code. Auto-checks in if event already started and user GPS is within 1km.
- `code`: from the event URL (antenna.fyi/events/CODE)
- `sender_id`, `channel`: from context
- **Requires profile** — user must have a profile before joining
- If event has started + user has GPS + within 1km → auto check-in

### `antenna_event_scan`
Scan people in an event. No distance limit — returns all participants.
- `code`: event code
- `sender_id`, `channel`: from context
- Returns profiles with `checked_in` status and `role` (creator/participant)
- Header shows "X joined, Y checked in"

### `antenna_event_end`
End an event. Only the creator can end it.
- `code`: event code
- `sender_id`, `channel`: from context

### `antenna_event_checkin`
Check in at an event — marks you as present at the event location.
- `code`: event code
- `sender_id`, `channel`: from context
- `lat`, `lng`: optional GPS (auto-reads profile location if not provided)
- GPS verified: must be within 1km of event location
- Event must have GPS set for check-in to work

### `antenna_event_upload_image`
Upload an image for an event OG preview. Returns a public URL.
- `image_base64`: base64-encoded image data
- `content_type`: MIME type (default image/png)
- `event_code`: event code

### `antenna_bind` (for events)
Generate a GPS link for setting event location.
- `purpose`: set to `"event"`
- `event_code`: the event code
- GPS from this link writes to the event, not the user's profile

## Agent Behavior

### When someone says "create an event"
1. Ask for event name (required) and description (optional)
2. Call `antenna_event_create`
3. If no GPS provided, call `antenna_bind(purpose="event", event_code=CODE)` and send the link
4. Share the event URL with the user

### When someone shares an event link
1. Extract the code from `antenna.fyi/events/CODE`
2. Call `antenna_event_join(code)` — this will auto-check in if applicable
3. If join fails with "Create a profile first", guide profile creation then retry

### When someone says "who's here" at an event
1. Call `antenna_event_scan(code)`
2. Analyze profiles against what you know about the user
3. Recommend who they should meet and why
4. Creator appears with organizer badge

