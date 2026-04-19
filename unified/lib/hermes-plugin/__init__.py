"""Antenna — Hermes Agent Plugin

Nearby people discovery. Registers tools, a pre_llm_call hook,
and a background Realtime listener for push notifications.

Drop this directory into ~/.hermes/plugins/antenna/
"""

import json
import os
import re
import threading
import time
from pathlib import Path

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
    handle_event_update,
    handle_event_approve,
    handle_event_reject,
    handle_event_add_host,
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
    EVENT_UPDATE_SCHEMA,
    EVENT_APPROVE_SCHEMA,
    EVENT_REJECT_SCHEMA,
    EVENT_ADD_HOST_SCHEMA,
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
    ctx.register_tool("antenna_event_update", EVENT_UPDATE_SCHEMA, handle_event_update)
    ctx.register_tool("antenna_event_approve", EVENT_APPROVE_SCHEMA, handle_event_approve)
    ctx.register_tool("antenna_event_reject", EVENT_REJECT_SCHEMA, handle_event_reject)
    ctx.register_tool("antenna_event_add_host", EVENT_ADD_HOST_SCHEMA, handle_event_add_host)

    # ── Hook: auto-detect location + check web GPS events ─────────
    def on_pre_llm(messages, **kwargs):
        """Check for location data in messages AND pending web GPS events AND new matches."""
        global _last_event_check, _last_match_check
        hints = []

        now = time.time()

        # -1. Read pending notifications from Realtime listener
        _nf = Path.home() / ".antenna" / "pending_notifications.json"
        try:
            if _nf.exists():
                pending = json.loads(_nf.read_text())
                if pending:
                    for n in pending:
                        hints.append(f"[Antenna] {n['message']}")
                    _nf.write_text("[]")
        except Exception:
            pass

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

        # 0b. Check event approval status (every 60s)
        if now - _last_match_check > _MATCH_CHECK_INTERVAL and _my_device_ids:
            try:
                sb = _sb()
                for did in list(_my_device_ids):
                    resp = sb.rpc("get_my_event_updates", {"p_device_id": did}).execute()
                    events = resp.data or []
                    for ev in events:
                        key = f"event:{ev.get('event_id')}:{ev.get('status')}"
                        if key in _notified_match_keys:
                            continue
                        _notified_match_keys.add(key)
                        status = ev.get("status")
                        role = ev.get("role")
                        name = ev.get("event_name", "活动")
                        if status == "active" and role not in ("creator", "cohost"):
                            hints.append(
                                f"[Antenna] ✅ 你的申请已通过！欢迎加入「{name}」"
                                f"请立即通知用户这个好消息！"
                            )
                        elif status == "rejected":
                            hints.append(
                                f"[Antenna] ❌ 你的申请未通过「{name}」"
                            )
            except Exception:
                pass
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

    # ── Background Realtime listener for push notifications ──────
    _notif_dir = Path.home() / ".antenna"
    _notif_file = _notif_dir / "pending_notifications.json"

    def _append_notification(msg: str):
        """Thread-safe append to pending notifications file."""
        try:
            _notif_dir.mkdir(parents=True, exist_ok=True)
            notifications = []
            if _notif_file.exists():
                try:
                    notifications = json.loads(_notif_file.read_text())
                except Exception:
                    notifications = []
            notifications.append({"message": msg, "timestamp": time.time()})
            # Keep max 50
            notifications = notifications[-50:]
            _notif_file.write_text(json.dumps(notifications, ensure_ascii=False))
        except Exception:
            pass

    def _realtime_listener():
        """Background thread: listen to Supabase Realtime for matches + event participants."""
        try:
            sb = _sb()
            # Listen to matches INSERT
            sb.channel("hermes-antenna-matches").on(
                "postgres_changes",
                {"event": "INSERT", "schema": "public", "table": "matches"},
                lambda payload: _handle_match_change(payload),
            ).subscribe()

            # Listen to event_participants INSERT + UPDATE
            sb.channel("hermes-antenna-events").on(
                "postgres_changes",
                {"event": "*", "schema": "public", "table": "event_participants"},
                lambda payload: _handle_event_change(payload),
            ).subscribe()

            # Keep thread alive
            while True:
                time.sleep(60)
        except Exception as e:
            print(f"[Antenna] Realtime listener failed: {e}")

    def _handle_match_change(payload):
        try:
            row = payload.get("new") or payload.get("record", {})
            target = row.get("device_id_b")
            if not target or target not in _my_device_ids:
                return
            key = f"{row.get('device_id_a')}→{target}"
            if key in _notified_match_keys:
                return
            _notified_match_keys.add(key)
            sb = _sb()
            prof = sb.rpc("get_profile", {"p_device_id": row.get("device_id_a")}).execute()
            p = prof.data or {}
            name = p.get("display_name") or "有人"
            emoji = p.get("emoji") or "👤"
            _append_notification(f"📩 {emoji} {name} 想认识你！用 antenna_check_matches 查看详情。")
        except Exception:
            pass

    def _handle_event_change(payload):
        try:
            event_type = payload.get("type") or payload.get("eventType", "")
            row = payload.get("new") or payload.get("record", {})
            old = payload.get("old") or payload.get("old_record", {})

            if event_type == "INSERT" and row.get("status") == "pending":
                # Someone applied — notify creator
                event_id = row.get("event_id")
                applicant_id = row.get("device_id")
                if not event_id:
                    return
                sb = _sb()
                evt = sb.rpc("get_event_by_id", {"p_event_id": event_id}).execute()
                event = evt.data or {}
                if not event.get("found") or event.get("created_by") not in _my_device_ids:
                    return
                prof = sb.rpc("get_profile", {"p_device_id": applicant_id}).execute()
                p = prof.data or {}
                name = p.get("display_name") or "某人"
                emoji = p.get("emoji") or "👤"
                _append_notification(f"📩 {emoji} {name} 申请加入你的活动「{event.get('name')}」！用 antenna_event_scan 查看并审批。")

            elif event_type == "UPDATE":
                device_id = row.get("device_id")
                if device_id not in _my_device_ids:
                    return
                old_status = old.get("status")
                new_status = row.get("status")
                if old_status == "pending" and new_status == "active":
                    sb = _sb()
                    evt = sb.rpc("get_event_by_id", {"p_event_id": row.get("event_id")}).execute()
                    event = evt.data or {}
                    _append_notification(f"✅ 你的申请已通过！欢迎加入「{event.get('name', '活动')}」")
                elif old_status == "pending" and new_status == "rejected":
                    sb = _sb()
                    evt = sb.rpc("get_event_by_id", {"p_event_id": row.get("event_id")}).execute()
                    event = evt.data or {}
                    _append_notification(f"❌ 你的申请未通过「{event.get('name', '活动')}」")
        except Exception:
            pass

    # Start background listener thread
    try:
        t = threading.Thread(target=_realtime_listener, daemon=True, name="antenna-realtime")
        t.start()
        print("[Antenna] Realtime listener started 📡")
    except Exception as e:
        print(f"[Antenna] Failed to start Realtime listener: {e}")

    print("[Antenna] Plugin loaded 📡")
