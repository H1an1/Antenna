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
    handle_pass,
    handle_discover,
    handle_event_create,
    handle_event_join,
    handle_event_scan,
    handle_event_end,
    handle_event_checkin,
    handle_event_upload_image,
    _sb,
    _device_id,
    _my_device_ids,
)
from .schemas import (
    SCAN_SCHEMA,
    PROFILE_SCHEMA,
    ACCEPT_SCHEMA,
    CHECKIN_SCHEMA,
    CHECK_MATCHES_SCHEMA,
    BIND_SCHEMA,
    PASS_SCHEMA,
    DISCOVER_SCHEMA,
    EVENT_CREATE_SCHEMA,
    EVENT_JOIN_SCHEMA,
    EVENT_SCAN_SCHEMA,
    EVENT_END_SCHEMA,
    EVENT_CHECKIN_SCHEMA,
    EVENT_UPLOAD_IMAGE_SCHEMA,
)
import re
import time

# Track last checked timestamp for location events
_last_event_check = 0
_EVENT_CHECK_INTERVAL = 30  # seconds

# Track last match check timestamp
_last_match_check = 0
_MATCH_CHECK_INTERVAL = 60  # seconds
_notified_match_keys: set = set()  # "deviceA→deviceB" already notified


def register(ctx):
    # ── Tools ─────────────────────────────────────────────────────
    ctx.register_tool("antenna_scan", SCAN_SCHEMA, handle_scan)
    ctx.register_tool("antenna_profile", PROFILE_SCHEMA, handle_profile)
    ctx.register_tool("antenna_accept", ACCEPT_SCHEMA, handle_accept)
    ctx.register_tool("antenna_checkin", CHECKIN_SCHEMA, handle_checkin)
    ctx.register_tool("antenna_check_matches", CHECK_MATCHES_SCHEMA, handle_check_matches)
    ctx.register_tool("antenna_bind", BIND_SCHEMA, handle_bind)
    ctx.register_tool("antenna_pass", PASS_SCHEMA, handle_pass)
    ctx.register_tool("antenna_discover", DISCOVER_SCHEMA, handle_discover)
    ctx.register_tool("antenna_event_create", EVENT_CREATE_SCHEMA, handle_event_create)
    ctx.register_tool("antenna_event_join", EVENT_JOIN_SCHEMA, handle_event_join)
    ctx.register_tool("antenna_event_scan", EVENT_SCAN_SCHEMA, handle_event_scan)
    ctx.register_tool("antenna_event_end", EVENT_END_SCHEMA, handle_event_end)
    ctx.register_tool("antenna_event_checkin", EVENT_CHECKIN_SCHEMA, handle_event_checkin)
    ctx.register_tool("antenna_event_upload_image", EVENT_UPLOAD_IMAGE_SCHEMA, handle_event_upload_image)

    # ── Hook: auto-detect location + check web GPS events ─────────
    def on_pre_llm(messages, **kwargs):
        """Check for location data in messages AND pending web GPS events AND new matches."""
        global _last_event_check, _last_match_check
        hints = []

        now = time.time()

        # 0. Check for new matches (every 60s)
        if now - _last_match_check > _MATCH_CHECK_INTERVAL and _my_device_ids:
            _last_match_check = now
            try:
                sb = _sb()
                for did in list(_my_device_ids):
                    resp = sb.rpc("get_my_matches", {"p_device_id": did}).execute()
                    all_matches = resp.data or []
                    if not all_matches:
                        continue

                    incoming = [m for m in all_matches if m.get("device_id_b") == did]
                    my = [m for m in all_matches if m.get("device_id_a") == did]

                    for m in incoming:
                        key = f"{m['device_id_a']}→{did}"
                        if key in _notified_match_keys:
                            continue
                        _notified_match_keys.add(key)

                        # Get their profile
                        prof_resp = sb.rpc("get_profile", {"p_device_id": m["device_id_a"]}).execute()
                        p = prof_resp.data or {}
                        name = p.get("display_name") or "有人"
                        emoji = p.get("emoji") or "👤"

                        # Check if mutual
                        i_accepted = any(
                            x.get("device_id_b") == m["device_id_a"] for x in my
                        )
                        if i_accepted:
                            contact = m.get("contact_info_a")
                            contact_msg = f"对方的联系方式：{contact}" if contact else "对方还没有分享联系方式。"
                            hints.append(
                                f"[Antenna] 🎉 双向匹配！{emoji} {name} 也接受了你！{contact_msg} "
                                f"请立即通知用户这个好消息！"
                            )
                        else:
                            hints.append(
                                f"[Antenna] 📩 {emoji} {name} 想认识你！"
                                f"请告诉用户有人想认识 TA，并建议用 antenna_check_matches 查看详情。"
                            )
            except Exception:
                pass

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
