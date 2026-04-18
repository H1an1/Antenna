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
- `requires_approval`: boolean, default false. If true, participants must be approved by the organizer before they become visible.
- `screening_questions`: string array. Questions to ask applicants. Agent should collect answers via conversation and submit as `application_context` when joining.

**When the user says anything about "审批" / "approval" / "筛选" / "报名表"**, set `requires_approval: true` and ask what screening questions they want.

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
Collect the following info through conversation (ask one by one, don't dump all at once):
1. **Event name** (required) — "活动叫什么名字？"
2. **Description** — "简单描述一下这个活动？"
3. **Time** — "什么时候开始？大概多长？" (convert to starts_at / ends_at ISO strings)
4. **Location** — "活动在哪里？" If user gives an address, geocode it. If vague, generate a bind link after creation.
5. **Approval** — "需要审批参与者吗？" If yes:
6. **Screening questions** — "你想问报名者什么问题？" Collect as a list.

Then call `antenna_event_create` with all collected info.
If no GPS, call `antenna_bind(purpose="event", event_code=CODE)` and send the link.
Share the event URL with the user.

### When someone shares an event link
1. Extract the code from `antenna.fyi/events/CODE`
2. Call `antenna_event_join(code)` — this checks everything:
   - If no profile → "Create a profile first"
   - If event requires approval and no `application_context` provided → returns `needs_screening: true` + `screening_questions` array
   - If screening questions returned: **ask the user each question**, collect answers, then call `antenna_event_join(code, application_context="collected answers")` again
   - If join succeeds with `status: pending` → tell user "waiting for organizer approval"
   - If join succeeds with `status: active` → user is in!
3. Auto check-in happens automatically if event has started + GPS within 1km

### When someone says "who's here" at an event
1. Call `antenna_event_scan(code)`
2. Analyze profiles against what you know about the user
3. Recommend who they should meet and why
4. Creator appears with organizer badge

