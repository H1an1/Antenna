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
        },
        "required": ["sender_id", "channel"],
    },
}

BIND_SCHEMA = {
    "name": "antenna_bind",
    "description": (
        "Generate a GPS binding link. Send this URL to the user so they can "
        "share their phone's location via the web browser."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "sender_id": {"type": "string"},
            "channel": {"type": "string"},
        },
        "required": ["sender_id", "channel"],
    },
}
