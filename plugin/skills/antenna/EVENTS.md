---
name: antenna-events
description: "Event management for Antenna. Use when a user wants to create, join, scan, or manage events. Handles event creation, participant management, check-in, approval workflows, and event messaging."
metadata: { "openclaw": { "always": false } }
---

# Antenna Events

Event tools for location-based social discovery. Events let organizers gather people, manage participants, and facilitate connections.

**Requires:** The core Antenna skill (antenna_scan, antenna_profile, etc.) must also be available. Events build on top of the core profile and matching system.

## Event Tools

### `antenna_event_create`
Create an event. Returns a shareable link (antenna.fyi/events/CODE).
- `name`: event name (required)
- `sender_id`, `channel`: from context (required)
- `chat_id`: REQUIRED for notifications
- `starts_at`, `ends_at`: ISO time strings (required - no default, must be provided)
- `lat`, `lng`: optional event location (needed for GPS check-in)
- `description`: optional event description
- `og_image`: optional OG image URL for social sharing preview
- `requires_approval`: boolean, default false. If true, participants need organizer approval.
- `screening_questions`: string array. Questions for applicants.

**When the user mentions "审批" / "approval" / "筛选" / "报名表"**, set `requires_approval: true` and ask what questions they want to screen with.

**GPS flow for events:** If the user doesn't provide coordinates, generate a bind link (`antenna_bind`) and ask them to open it at the event location. Once GPS comes in, use those coordinates for the event's `lat`/`lng` — do NOT treat this as the user's personal location. The bind link GPS for event creation goes to the event, not the user's profile. Only use `antenna_checkin` when the user wants to update their own location.

### `antenna_event_end`
End an event. Only the creator can end it.
- `code`: event code
- `sender_id`, `channel`: from context
- `chat_id`: REQUIRED for notifications

### `antenna_event_join`
Join an event by code. Auto-checks in if event has started and you're within 1km.
- `code`: from the event URL (antenna.fyi/events/CODE)
- `sender_id`, `channel`: from context
- `chat_id`: REQUIRED for notifications
- `lat`, `lng`: optional GPS coordinates (for auto-checkin)
- **Requires a profile** — users without a profile will be told to create one first.

### `antenna_event_scan`
Scan people in an event. No distance limit — returns all participants.
- `code`: event code
- `sender_id`, `channel`: from context
- `chat_id`: REQUIRED for notifications
- Returns profiles with `source: "event"` tag

### `antenna_event_checkin`
Check in at an event — marks you as present at the event location. Optionally updates GPS.
- `code`: event code
- `sender_id`, `channel`: from context
- `chat_id`: REQUIRED for notifications
- `lat`, `lng`: optional GPS coordinates
- **Event must have started** (`starts_at <= now`). Cannot check in before start time.
- **Must be within 1km** of event location.
- **Must have `status: active`** (approved participants only, not pending).
- **Check-in is automatic on join.** Only call this manually if the user explicitly asks to check in. Do not prompt the user about check-in.

### `antenna_event_upload_image`
Upload an image for an event OG preview. Returns a public URL.
- `image_base64`: base64-encoded image data
- `content_type`: MIME type (default image/png)
- `event_code`: event code

### `antenna_event_update`
Update event info. Only creator or co-host can update.
- `code`: event code
- `sender_id`, `channel`: from context
- `chat_id`: REQUIRED for notifications
- `name`, `description`, `og_image`, `lat`, `lng`, `starts_at`, `ends_at`: all optional for update (only provided fields change, others stay as-is)
- `requires_approval`: optional boolean — enable/disable approval requirement
- `screening_questions`: optional string array — update screening questions

### `antenna_event_approve`
Approve a pending participant. Only creator or co-host.
- `code`: event code
- `sender_id`, `channel`: from context
- `chat_id`: REQUIRED for notifications
- `ref`: participant ref number from scan

### `antenna_event_reject`
Reject a pending participant. Only creator or co-host.
- `code`: event code
- `sender_id`, `channel`: from context
- `chat_id`: REQUIRED for notifications
- `ref`: participant ref number from scan

### `antenna_event_add_host`
Add a co-host to the event. Only creator can add.
- `code`: event code
- `sender_id`, `channel`: from context
- `chat_id`: REQUIRED for notifications
- `ref`: participant ref number to promote to co-host

### `antenna_event_message`
Send a message to event participants. Only creator or co-host can send.
- `code`: event code
- `sender_id`, `channel`: from context
- `chat_id`: REQUIRED for notifications
- `message`: the message text
- `ref`: optional — ref number of specific participant. Omit to broadcast to all active participants.
- Use when the host needs to notify participants about logistics, changes, or requests (e.g. "please share your WeChat in your profile").
- One-way: participants receive the message but cannot reply through this channel.

---

## Event Behavior Guide

> This section is the single source of truth for event behavior. Tool descriptions above define parameters; this section defines agent behavior.

### Creating an event
Collect info through conversation (ask one by one, don't dump all at once):
1. **Event name** (required) — "活动叫什么名字?"
2. **Description** — "简单描述一下这个活动?"
3. **Time** (required) — "什么时候开始?大概多长?" (convert to `starts_at` / `ends_at` ISO strings. **Must provide both — no defaults.**)
4. **Location** — "活动在哪里?" If user gives an address, geocode it. If vague, generate a bind link after creation.
5. **Approval** — "需要审批参与者吗?" If yes:
6. **Screening questions** — "你想问报名者什么问题?" Collect as a list.

Then call `antenna_event_create` with all collected info.
If no GPS, call `antenna_bind(purpose="event", event_code=CODE)` and send the link.
Share the event URL with the user.

### Joining an event
1. Extract the code from `antenna.fyi/events/CODE`
2. Call `antenna_event_join(code)` — this checks everything:
   - If no profile → "Create a profile first"
   - If event requires approval and no `application_context` provided → returns `needs_screening: true` + `screening_questions`
   - If screening questions returned: **ask the user each question**, collect answers, then call `antenna_event_join(code, application_context="answers")` again
   - If `status: pending` → "waiting for organizer approval"
   - If `status: active` → user is in! Auto check-in if event started + GPS within 1km.
   - **Do NOT ask the user about check-in.** Check-in is automatic — if the response has `checked_in: true`, just confirm they're in. If `checked_in: false`, ignore it silently. Users don't need to know about or manage check-in.

### Scanning an event
1. Call `antenna_event_scan(code)`
2. Hosts see pending participants with `application_context` (screening answers)
3. Recommend who to meet based on user's interests
4. Creator/co-host appears with organizer badge

### Approving/rejecting participants
Only creator or co-host can approve/reject:
- `antenna_event_approve(code, ref)` → participant becomes active
- `antenna_event_reject(code, ref)` → participant is rejected
- Notifications are sent automatically to the applicant

### Key differences from regular scan
- `antenna_scan` = nearby discovery, read-only, does NOT write location
- `antenna_event_scan` = event participants, no distance limit
- `antenna_checkin` = update YOUR location (not event-related)
- `antenna_event_checkin` = mark presence at an EVENT (GPS verified, event must have started)

### GPS for events
**Event GPS** — the event's location ("where is the event")
- Set via `antenna_bind(purpose="event")` or `antenna_event_create(lat, lng)`
- Precise coordinates (NOT blurred)
- Used for: check-in distance verification (≤1km), `nearby_events` discovery (5km)
- Does not expire — event location is fixed

**Auto-checkin on join:** When a user joins an event that has already started, the system automatically attempts check-in if GPS is available and within 1km. No user action needed.
