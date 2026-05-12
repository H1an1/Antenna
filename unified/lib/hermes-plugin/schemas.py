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
                "description": "Platform name (any platform: telegram, discord, webchat, signal, slack, etc.)",
            },
            "chat_id": {
                "type": "string",
                "description": "REQUIRED for notifications. Pass chat/channel ID from message context.",
            },
        },
        "required": ["sender_id", "channel", "chat_id"],
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
            "matching_context": {"type": "string", "description": "Free-form context for AI matching (interests, goals, etc.)"},
            "api_key": {"type": "string", "description": "Required for action='set': user's Antenna API key from antenna.fyi/me. Profile writes use the dashboard-linked user:<uuid> profile."},
        },
        "required": ["action", "sender_id", "channel", "chat_id"],
    },
}

ACCEPT_SCHEMA = {
    "name": "antenna_accept",
    "description": (
        "Accept a match. Use 'ref' from scan results (e.g. '1', '2'), target_device_id, "
        "or profile_slug (from a public profile link like antenna.fyi/p/SLUG). "
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
                "description": "Device ID (use ref or profile_slug instead when possible)",
            },
            "profile_slug": {
                "type": "string",
                "description": "Profile slug from a public profile link (e.g. 'yi' from antenna.fyi/p/yi). Resolves to device_id automatically.",
            },
            "contact_info": {
                "type": "string",
                "description": "Contact info to share (e.g. 'WeChat: yi')",
            },
            "api_key": {
                "type": "string",
                "description": "User's Antenna API key from antenna.fyi/me. When provided, accept is written as the dashboard-linked profile, not a temporary sender/channel device.",
            },
        },
        "required": ["sender_id", "channel", "chat_id"],
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
        "required": ["lat", "lng", "sender_id", "channel", "chat_id"],
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
        "required": ["sender_id", "channel", "chat_id"],
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
        "required": ["sender_id", "channel", "chat_id"],
    },
}

PASS_SCHEMA = {
    "name": "antenna_pass",
    "description": "Pass/skip a person. They won't be recommended again.",
    "parameters": {
        "type": "object",
        "properties": {
            "sender_id": {"type": "string", "description": "The sender's user ID"},
            "channel": {"type": "string", "description": "Platform name (any platform works)"},
            "chat_id": {"type": "string", "description": "REQUIRED for notifications. Pass chat/channel ID from message context."},
            "ref": {
                "type": "string",
                "description": "Ref number from scan/discover results (e.g. '1')",
            },
            "target_device_id": {
                "type": "string",
                "description": "Device ID (use ref instead when possible)",
            },
        },
        "required": ["sender_id", "channel", "chat_id"],
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
            "channel": {"type": "string", "description": "Platform name (any platform works)"},
            "chat_id": {"type": "string", "description": "REQUIRED for notifications. Pass chat/channel ID from message context."},
        },
        "required": ["sender_id", "channel", "chat_id"],
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
            "channel": {"type": "string", "description": "Platform name (any platform works)"},
            "lat": {"type": "number", "description": "Event latitude"},
            "lng": {"type": "number", "description": "Event longitude"},
            "starts_at": {"type": "string", "description": "Start time ISO (required)"},
            "ends_at": {"type": "string", "description": "End time ISO (required)"},
            "description": {"type": "string", "description": "Event description"},
            "og_image": {"type": "string", "description": "OG image URL for social sharing"},
            "requires_approval": {"type": "boolean", "description": "Require host approval to join (default false)"},
            "screening_questions": {"type": "array", "items": {"type": "string"}, "description": "Screening questions for applicants"},
            "chat_id": {"type": "string", "description": "REQUIRED for notifications. Pass chat/channel ID from message context."},
        },
        "required": ["name", "sender_id", "channel", "starts_at", "ends_at", "chat_id"],
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
            "channel": {"type": "string", "description": "Platform name (any platform works)"},
            "lat": {"type": "number", "description": "Latitude (optional, for auto-checkin)"},
            "lng": {"type": "number", "description": "Longitude (optional, for auto-checkin)"},
            "application_context": {"type": "string", "description": "Application context from screening conversation"},
            "chat_id": {"type": "string", "description": "REQUIRED for notifications. Pass chat/channel ID from message context."},
        },
        "required": ["code", "sender_id", "channel", "chat_id"],
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
            "channel": {"type": "string", "description": "Platform name (any platform works)"},
            "chat_id": {"type": "string", "description": "REQUIRED for notifications. Pass chat/channel ID from message context."},
        },
        "required": ["code", "sender_id", "channel", "chat_id"],
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
            "channel": {"type": "string", "description": "Platform name (any platform works)"},
            "chat_id": {"type": "string", "description": "REQUIRED for notifications. Pass chat/channel ID from message context."},
        },
        "required": ["code", "sender_id", "channel", "chat_id"],
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
            "channel": {"type": "string", "description": "Platform name (any platform works)"},
            "lat": {"type": "number", "description": "Latitude (optional)"},
            "lng": {"type": "number", "description": "Longitude (optional)"},
            "chat_id": {"type": "string", "description": "REQUIRED for notifications. Pass chat/channel ID from message context."},
        },
        "required": ["code", "sender_id", "channel", "chat_id"],
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
            "requires_approval": {"type": "boolean", "description": "Require host approval to join"},
            "screening_questions": {"type": "array", "items": {"type": "string"}, "description": "Screening questions for applicants"},
        },
        "required": ["code", "sender_id", "channel", "chat_id"],
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
        "required": ["code", "sender_id", "channel", "ref", "chat_id"],
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
        "required": ["code", "sender_id", "channel", "ref", "chat_id"],
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
        "required": ["code", "sender_id", "channel", "ref", "chat_id"],
    },
}

EVENT_MESSAGE_SCHEMA = {
    "name": "antenna_event_message",
    "description": "Send a message to event participants. Only creator or co-host can send. Omit ref to broadcast to all.",
    "parameters": {
        "type": "object",
        "properties": {
            "code": {"type": "string", "description": "Event code"},
            "sender_id": {"type": "string"},
            "channel": {"type": "string"},
            "chat_id": {"type": "string", "description": "REQUIRED for notifications. Pass chat/channel ID from message context."},
            "message": {"type": "string", "description": "Message to send to participants"},
            "ref": {"type": "string", "description": "Ref number of specific participant (omit for broadcast)"},
        },
        "required": ["code", "sender_id", "channel", "message", "chat_id"],
    },
}

LINK_ACCOUNT_SCHEMA = {
    "name": "antenna_link_account",
    "description": (
        "Link your Antenna agent profile to your antenna.fyi website account. "
        "The user needs to provide their user_id from the dashboard (antenna.fyi/me). "
        "After linking, the dashboard will show the same profile and match history."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "sender_id": {"type": "string", "description": "The sender's user ID"},
            "channel": {"type": "string", "description": "Platform name"},
            "chat_id": {"type": "string", "description": "REQUIRED. Pass the chat/channel ID from message context."},
            "api_key": {"type": "string", "description": "The user's Antenna API key (ant_xxx) from antenna.fyi/me"},
        },
        "required": ["sender_id", "channel", "chat_id", "api_key"],
    },
}

INITIAL_RECOMMENDATIONS_SCHEMA = {
    "name": "antenna_initial_recommendations",
    "description": (
        "Get initial recommendations for a new user \u2014 2-3 people most similar to them. "
        "One-time only, does NOT consume daily discover quota. "
        "Use right after profile creation in onboarding."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "sender_id": {"type": "string", "description": "The sender's user ID"},
            "channel": {"type": "string", "description": "Platform name (any platform works)"},
            "chat_id": {"type": "string", "description": "REQUIRED for notifications. Pass chat/channel ID from message context."},
        },
        "required": ["sender_id", "channel", "chat_id"],
    },
}

FIND_PEOPLE_SCHEMA = {
    "name": "antenna_find_people",
    "description": (
        "Find 1-3 people by a free-form intent, e.g. "
        "'想找一个懂 consumer social 增长的人'. Returns privacy-safe refs; "
        "use ref with antenna_accept if the user wants an intro."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Free-form user intent describing the kind of person to find"},
            "sender_id": {"type": "string", "description": "The sender's user ID"},
            "channel": {"type": "string", "description": "Platform name (any platform works)"},
            "chat_id": {"type": "string", "description": "REQUIRED for notifications. Pass chat/channel ID from message context."},
            "limit": {"type": "number", "description": "Maximum profiles to return, 1-3"},
        },
        "required": ["query", "sender_id", "channel", "chat_id"],
    },
}
