"""Antenna — Hermes Agent Plugin

Nearby people discovery. Registers 6 tools and a pre_llm_call hook
that auto-detects location data (from messages + web GPS events).

Drop this directory into ~/.hermes/plugins/antenna/
"""

from .tools import (
    handle_scan,
    handle_profile,
    handle_accept,
    handle_checkin,
    handle_check_matches,
    handle_bind,
    _sb,
    _device_id,
    SCAN_SCHEMA,
    PROFILE_SCHEMA,
    ACCEPT_SCHEMA,
    CHECKIN_SCHEMA,
    CHECK_MATCHES_SCHEMA,
    BIND_SCHEMA,
)
import re
import time

# Track last checked timestamp for location events
_last_event_check = 0
_EVENT_CHECK_INTERVAL = 30  # seconds


def register(ctx):
    # ── Tools ─────────────────────────────────────────────────────
    ctx.register_tool("antenna_scan", SCAN_SCHEMA, handle_scan)
    ctx.register_tool("antenna_profile", PROFILE_SCHEMA, handle_profile)
    ctx.register_tool("antenna_accept", ACCEPT_SCHEMA, handle_accept)
    ctx.register_tool("antenna_checkin", CHECKIN_SCHEMA, handle_checkin)
    ctx.register_tool("antenna_check_matches", CHECK_MATCHES_SCHEMA, handle_check_matches)
    ctx.register_tool("antenna_bind", BIND_SCHEMA, handle_bind)

    # ── Hook: auto-detect location + check web GPS events ─────────
    def on_pre_llm(messages, **kwargs):
        """Check for location data in messages AND pending web GPS events."""
        global _last_event_check
        hints = []

        # 1. Check location_events table (web GPS updates)
        now = time.time()
        if now - _last_event_check > _EVENT_CHECK_INTERVAL:
            _last_event_check = now
            try:
                sb = _sb()
                resp = (
                    sb.from_("location_events")
                    .select("device_id, lat, lng")
                    .gt("created_at", "now() - interval '2 minutes'")
                    .order("created_at", desc=True)
                    .limit(5)
                    .execute()
                )
                if resp.data:
                    for evt in resp.data:
                        hints.append(
                            f"[Antenna] 📡 用户 {evt['device_id']} 通过网页分享了位置 "
                            f"({evt['lat']}, {evt['lng']})。"
                            f"请使用 antenna_scan 查看附近有谁。"
                        )
            except Exception:
                pass

        # 2. Check message content for coordinates
        if messages:
            last_msg = messages[-1] if isinstance(messages[-1], dict) else {}
            content = last_msg.get("content", "")
            if isinstance(content, str):
                loc_match = re.search(
                    r"[Ll]ocation.*?(-?\d+\.?\d*)[,\s]+(-?\d+\.?\d*)", content
                )
                if not loc_match:
                    loc_match = re.search(
                        r"(-?\d{1,3}\.\d{3,})[,\s]+(-?\d{1,3}\.\d{3,})", content
                    )
                if loc_match:
                    lat, lng = loc_match.group(1), loc_match.group(2)
                    hints.append(
                        f"[Antenna] 📍 检测到位置 ({lat}, {lng})。"
                        f"请使用 antenna_scan 查看附近有谁。"
                    )

        if hints:
            return {"context": "\n".join(hints)}
        return None

    ctx.register_hook("pre_llm_call", on_pre_llm)

    print("[Antenna] Plugin loaded 📡")
