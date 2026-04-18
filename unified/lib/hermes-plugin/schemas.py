"""Antenna tool schemas — what the LLM sees."""

SCAN_SCHEMA = {
    "name": "antenna_scan",
    "description": (
        "Scan for nearby people. If lat/lng are omitted, uses the location "
        "from the user's web GPS binding (antenna.fyi/locate)."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "lat": {"type": "number", "description": "Latitude (optional if location was shared via web)"},
            "lng": {"type": "number", "description": "Longitude (optional if location was shared via web)"},
            "radius_m": {
                "type": "number",
                "description": "Search radius in meters (default 500, max 1000)",
            },
            "sender_id": {
                "type": "string",
                "description": "The sender's user ID (from message context)",
            },
            "channel": {
                "type": "string",
                "description": "Platform name (telegram, discord, etc.)",
            },
        },
        "required": ["sender_id", "channel"],
    },
}

PROFILE_SCHEMA = {
    "name": "antenna_profile",
    "description": (
        "View or update the user's Antenna profile (name card). "
        "The profile has a display name, emoji, and three lines."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["get", "set"],
                "description": "'get' to view, 'set' to update",
            },
            "sender_id": {"type": "string"},
            "channel": {"type": "string"},
            "chat_id": {"type": "string", "description": "REQUIRED for notifications. Pass chat/channel ID from message context."},
            "display_name": {"type": "string", "description": "Display name"},
            "emoji": {"type": "string", "description": "Profile emoji"},
            "line1": {"type": "string", "description": "Who you are / what you do"},
            "line2": {"type": "string", "description": "What you're into"},
            "line3": {"type": "string", "description": "What you're looking for"},
            "visible": {"type": "boolean", "description": "Visible to others"},
        },
        "required": ["action", "sender_id", "channel"],
    },
}

ACCEPT_SCHEMA = {
    "name": "antenna_accept",
    "description": (
        "Accept a match. Use 'ref' from scan results (e.g. '1', '2') or target_device_id. "
        "Optionally share contact info."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "sender_id": {"type": "string"},
            "channel": {"type": "string"},
            "chat_id": {"type": "string", "description": "REQUIRED for notifications. Pass chat/channel ID from message context."},
            "ref": {
                "type": "string",
                "description": "Ref number from scan results (e.g. '1')",
            },
            "target_device_id": {
                "type": "string",
                "description": "Device ID (use ref instead when possible)",
            },
            "contact_info": {
                "type": "string",
                "description": "Contact info to share (e.g. 'WeChat: yi')",
            },
        },
        "required": ["sender_id", "channel"],
    },
}

CHECKIN_SCHEMA = {
    "name": "antenna_checkin",
    "description": (
        "Check in at a location — update your position so others can find you."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "lat": {"type": "number", "description": "Latitude"},
            "lng": {"type": "number", "description": "Longitude"},
            "sender_id": {"type": "string"},
            "channel": {"type": "string"},
            "chat_id": {"type": "string", "description": "REQUIRED for notifications. Pass chat/channel ID from message context."},
            "place_name": {
                "type": "string",
                "description": "Name of the place (optional)",
            },
        },
        "required": ["lat", "lng", "sender_id", "channel"],
    },
}

CHECK_MATCHES_SCHEMA = {
    "name": "antenna_check_matches",
    "description": (
        "Check for mutual matches and incoming accepts."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "sender_id": {"type": "string"},
            "channel": {"type": "string"},
            "chat_id": {"type": "string", "description": "REQUIRED for notifications. Pass chat/channel ID from message context."},
        },
        "required": ["sender_id", "channel"],
    },
}

BIND_SCHEMA = {
    "name": "antenna_bind",
    "description": (
        "Generate a GPS binding link. Use purpose='event' + event_code when setting an event's location."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "sender_id": {"type": "string"},
            "channel": {"type": "string"},
            "chat_id": {"type": "string", "description": "REQUIRED for notifications. Pass chat/channel ID from message context."},
            "purpose": {"type": "string", "description": "'profile' (default) or 'event'"},
            "event_code": {"type": "string", "description": "Event code (when purpose=event)"},
        },
        "required": ["sender_id", "channel"],
    },
}

PASS_SCHEMA = {
    "name": "antenna_pass",
    "description": "Pass/skip a person. They won't be recommended again.",
    "parameters": {
        "type": "object",
        "properties": {
            "sender_id": {"type": "string", "description": "The sender's user ID"},
            "channel": {"type": "string", "description": "Platform name"},
            "ref": {
                "type": "string",
                "description": "Ref number from scan/discover results (e.g. '1')",
            },
            "target_device_id": {
                "type": "string",
                "description": "Device ID (use ref instead when possible)",
            },
        },
        "required": ["sender_id", "channel"],
    },
}

DISCOVER_SCHEMA = {
    "name": "antenna_discover",
    "description": (
        "Get today's global recommendation — the person most similar to you "
        "worldwide. 1 per day, no repeats."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "sender_id": {"type": "string", "description": "The sender's user ID"},
            "channel": {"type": "string", "description": "Platform name"},
        },
        "required": ["sender_id", "channel"],
    },
}

EVENT_CREATE_SCHEMA = {
    "name": "antenna_event_create",
    "description": (
        "Create an event. Returns a shareable link (antenna.fyi/events/CODE) "
        "for participants to join. Optionally include a description and OG image URL."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "name": {"type": "string", "description": "Event name"},
            "sender_id": {"type": "string", "description": "The sender's user ID"},
            "channel": {"type": "string", "description": "Platform name"},
            "lat": {"type": "number", "description": "Event latitude"},
            "lng": {"type": "number", "description": "Event longitude"},
            "starts_at": {"type": "string", "description": "Start time ISO"},
            "ends_at": {"type": "string", "description": "End time ISO"},
            "description": {"type": "string", "description": "Event description"},
            "og_image": {"type": "string", "description": "OG image URL for social sharing"},
            "requires_approval": {"type": "boolean", "description": "Require host approval to join (default false)"},
            "screening_questions": {"type": "array", "items": {"type": "string"}, "description": "Screening questions for applicants"},
        },
        "required": ["name", "sender_id", "channel"],
    },
}

EVENT_JOIN_SCHEMA = {
    "name": "antenna_event_join",
    "description": "Join an event by its code from the event URL. Auto-checks in if event has started and you're within 1km.",
    "parameters": {
        "type": "object",
        "properties": {
            "code": {"type": "string", "description": "Event code"},
            "sender_id": {"type": "string", "description": "The sender's user ID"},
            "channel": {"type": "string", "description": "Platform name"},
            "lat": {"type": "number", "description": "Latitude (optional, for auto-checkin)"},
            "lng": {"type": "number", "description": "Longitude (optional, for auto-checkin)"},
            "application_context": {"type": "string", "description": "Application context from screening conversation"},
        },
        "required": ["code", "sender_id", "channel"],
    },
}

EVENT_SCAN_SCHEMA = {
    "name": "antenna_event_scan",
    "description": "Scan people in an event. No distance limit.",
    "parameters": {
        "type": "object",
        "properties": {
            "code": {"type": "string", "description": "Event code"},
            "sender_id": {"type": "string", "description": "The sender's user ID"},
            "channel": {"type": "string", "description": "Platform name"},
        },
        "required": ["code", "sender_id", "channel"],
    },
}

EVENT_END_SCHEMA = {
    "name": "antenna_event_end",
    "description": "End an event. Only the creator can end it.",
    "parameters": {
        "type": "object",
        "properties": {
            "code": {"type": "string", "description": "Event code"},
            "sender_id": {"type": "string", "description": "The sender's user ID"},
            "channel": {"type": "string", "description": "Platform name"},
        },
        "required": ["code", "sender_id", "channel"],
    },
}

EVENT_UPLOAD_IMAGE_SCHEMA = {
    "name": "antenna_event_upload_image",
    "description": "Upload an image for an event OG preview. Returns a public URL.",
    "parameters": {
        "type": "object",
        "properties": {
            "image_base64": {"type": "string", "description": "Base64-encoded image data"},
            "content_type": {"type": "string", "description": "MIME type (default image/png)"},
            "event_code": {"type": "string", "description": "Event code"},
        },
        "required": ["image_base64", "event_code"],
    },
}

EVENT_CHECKIN_SCHEMA = {
    "name": "antenna_event_checkin",
    "description": "Check in at an event \u2014 marks you as present at the event location. Optionally updates GPS.",
    "parameters": {
        "type": "object",
        "properties": {
            "code": {"type": "string", "description": "Event code"},
            "sender_id": {"type": "string", "description": "The sender's user ID"},
            "channel": {"type": "string", "description": "Platform name"},
            "lat": {"type": "number", "description": "Latitude (optional)"},
            "lng": {"type": "number", "description": "Longitude (optional)"},
        },
        "required": ["code", "sender_id", "channel"],
    },
}

EVENT_UPDATE_SCHEMA = {
    "name": "antenna_event_update",
    "description": "Update event info. Only creator or co-host can update.",
    "parameters": {
        "type": "object",
        "properties": {
            "code": {"type": "string"},
            "sender_id": {"type": "string"},
            "channel": {"type": "string"},
            "chat_id": {"type": "string", "description": "REQUIRED for notifications. Pass chat/channel ID from message context."},
            "name": {"type": "string"},
            "description": {"type": "string"},
            "og_image": {"type": "string"},
            "lat": {"type": "number"},
            "lng": {"type": "number"},
            "starts_at": {"type": "string"},
            "ends_at": {"type": "string"},
        },
        "required": ["code", "sender_id", "channel"],
    },
}

EVENT_APPROVE_SCHEMA = {
    "name": "antenna_event_approve",
    "description": "Approve a pending participant. Only creator or co-host.",
    "parameters": {
        "type": "object",
        "properties": {
            "code": {"type": "string"},
            "sender_id": {"type": "string"},
            "channel": {"type": "string"},
            "chat_id": {"type": "string", "description": "REQUIRED for notifications. Pass chat/channel ID from message context."},
            "ref": {"type": "string"},
        },
        "required": ["code", "sender_id", "channel", "ref"],
    },
}

EVENT_REJECT_SCHEMA = {
    "name": "antenna_event_reject",
    "description": "Reject a pending participant. Only creator or co-host.",
    "parameters": {
        "type": "object",
        "properties": {
            "code": {"type": "string"},
            "sender_id": {"type": "string"},
            "channel": {"type": "string"},
            "chat_id": {"type": "string", "description": "REQUIRED for notifications. Pass chat/channel ID from message context."},
            "ref": {"type": "string"},
        },
        "required": ["code", "sender_id", "channel", "ref"],
    },
}

EVENT_ADD_HOST_SCHEMA = {
    "name": "antenna_event_add_host",
    "description": "Add a co-host to the event. Only creator can add.",
    "parameters": {
        "type": "object",
        "properties": {
            "code": {"type": "string"},
            "sender_id": {"type": "string"},
            "channel": {"type": "string"},
            "chat_id": {"type": "string", "description": "REQUIRED for notifications. Pass chat/channel ID from message context."},
            "ref": {"type": "string"},
        },
        "required": ["code", "sender_id", "channel", "ref"],
    },
}
