"""Antenna tool handlers — what runs when called.

Uses the Supabase REST API via supabase-py. Falls back to the built-in
shared backend if no env vars are set.
"""

import json
import math
import os
import time
import urllib.request

try:
    from supabase import create_client
except ImportError:
    create_client = None  # Will fail at runtime with helpful message

# ─── Config ───────────────────────────────────────────────────────────

BUILTIN_URL = "https://bcudjloikmpcqwcptuyd.supabase.co"
BUILTIN_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJjdWRqbG9pa21wY3F3Y3B0dXlkIiwi"
    "cm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0MTg1NDgsImV4cCI6MjA4OTk5NDU0OH0."
    "FaoC3QfpfHP1npNGjRchJAoAp2PdZtQe_WhP-t-GN1o"
)

_client = None
_client_url = None
_last_scan: dict[str, float] = {}
SCAN_DEBOUNCE_S = 30
_last_ref_map: dict[str, str] = {}  # ref → device_id from last scan
_my_device_ids: set[str] = set()  # track this user's device_ids for match checking


def _get_url():
    return os.environ.get("ANTENNA_SUPABASE_URL") or os.environ.get("ANTENNA_URL") or BUILTIN_URL


def _get_key():
    return os.environ.get("ANTENNA_SUPABASE_KEY") or os.environ.get("ANTENNA_KEY") or BUILTIN_KEY


def _sb():
    global _client, _client_url
    if create_client is None:
        raise RuntimeError(
            "supabase-py not installed. Run: pip install supabase"
        )
    url = _get_url()
    if _client is None or _client_url != url:
        _client = create_client(url, _get_key())
        _client_url = url
    return _client


def _device_id(sender_id: str, channel: str, chat_id: str = None) -> str:
    did = f"{channel}:{sender_id}"
    _my_device_ids.add(did)
    # Persist chat_id for notifications
    if chat_id:
        try:
            sb = _sb()
            sb.rpc("upsert_profile", {"p_device_id": did, "p_last_chat_id": chat_id}).execute()
        except Exception:
            pass
    return did


def _fuzzy(lat: float, lng: float) -> tuple[float, float]:
    return round(lat * 1000) / 1000, round(lng * 1000) / 1000


def _ok(data) -> str:
    return json.dumps(data, ensure_ascii=False)


# ─── Handlers ─────────────────────────────────────────────────────────

def handle_scan(params: dict) -> str:
    sb = _sb()
    did = _device_id(params["sender_id"], params["channel"], params.get("chat_id"))
    radius = params.get("radius_m", 500)

    # Rate limit
    now = time.time()
    if did in _last_scan and now - _last_scan[did] < SCAN_DEBOUNCE_S:
        return _ok({"profiles": [], "message": "刚刚才扫描过，稍等一会儿再试。", "rate_limited": True})
    _last_scan[did] = now

    lat = params.get("lat")
    lng = params.get("lng")

    # If no coordinates, read from profile (web GPS bind)
    if lat is None or lng is None:
        loc_resp = sb.rpc("get_profile_location", {"p_device_id": did}).execute()
        loc = loc_resp.data if loc_resp.data else {}
        if loc.get("found"):
            lat = loc["lat"]
            lng = loc["lng"]
        else:
            return _ok({"profiles": [], "message": "还没有位置信息。请先通过链接分享位置，或者发送位置消息。"})

    flat, flng = _fuzzy(lat, lng)

    # Query nearby
    resp = sb.rpc("nearby_profiles", {
        "p_lat": flat, "p_lng": flng, "p_radius_m": radius,
    }).execute()

    others = [p for p in (resp.data or []) if p.get("device_id") != did]

    if not others:
        return _ok({"profiles": [], "message": f"在 {radius}m 范围内没有发现其他人。"})

    # Build ref mapping — never expose device_id to agent/user
    global _last_ref_map
    _last_ref_map = {}
    profiles = []
    for i, p in enumerate(others):
        ref = str(i + 1)
        _last_ref_map[ref] = p.get("device_id")
        profiles.append({
            "ref": ref,
            "emoji": p.get("emoji") or "👤",
            "name": p.get("display_name") or "匿名",
            "line1": p.get("line1"),
            "line2": p.get("line2"),
            "line3": p.get("line3"),
            "distance_m": p.get("distance_m") or p.get("dist_meters"),
        })

    # Persist refs to DB so accept works after restart
    if did and _last_ref_map:
        try:
            sb.rpc("save_scan_refs", {"p_owner": did, "p_refs": _last_ref_map}).execute()
        except Exception:
            pass

    return _ok({
        "profiles": profiles,
        "count": len(others),
        "radius_m": radius,
        "instruction": "根据你对用户的了解，判断哪些人值得推荐，为每个推荐写一句个性化的匹配理由。使用 ref 编号（如 '1', '2')来引用人员，不要显示 device_id。",
    })


def handle_profile(params: dict) -> str:
    sb = _sb()
    did = _device_id(params["sender_id"], params["channel"], params.get("chat_id"))

    if params["action"] == "get":
        resp = sb.rpc("get_profile", {"p_device_id": did}).execute()
        if not resp.data:
            return _ok({"exists": False, "message": "你还没有名片。告诉我你的名字、emoji、三句话，我帮你创建。"})
        return _ok({"exists": True, "profile": resp.data})

    # set
    rpc_params = {
        "p_device_id": did,
        "p_display_name": params.get("display_name"),
        "p_emoji": params.get("emoji"),
        "p_line1": params.get("line1"),
        "p_line2": params.get("line2"),
        "p_line3": params.get("line3"),
        "p_visible": params.get("visible", True),
    }
    if params.get("matching_context") is not None:
        rpc_params["p_matching_context"] = params["matching_context"]
    resp = sb.rpc("upsert_profile", rpc_params).execute()

    if resp.data:
        return _ok({"updated": True, "profile": resp.data, "next_step": "IMPORTANT: Now call antenna_bind to generate a GPS link for the user. Do not skip this."})
    return _ok({"error": "upsert_profile failed"})


def handle_accept(params: dict) -> str:
    sb = _sb()
    did = _device_id(params["sender_id"], params["channel"], params.get("chat_id"))

    # Resolve ref to device_id
    ref = params.get("ref")
    target = params.get("target_device_id")
    if ref and ref in _last_ref_map:
        target = _last_ref_map[ref]
    if not target and ref:
        # DB fallback
        try:
            rr = sb.rpc("resolve_ref", {"p_owner": did, "p_ref": ref}).execute()
            if rr.data:
                target = rr.data
        except Exception:
            pass
    if not target:
        return _ok({"error": "No target. Use 'ref' from scan results or 'target_device_id'."})

    sb.rpc("upsert_match", {
        "p_device_id_a": did,
        "p_device_id_b": target,
        "p_status": "accepted",
        "p_contact_info": params.get("contact_info"),
    }).execute()

    # Check mutual
    resp = sb.rpc("get_my_matches", {"p_device_id": did}).execute()
    matches = resp.data or []
    reverse = next(
        (m for m in matches if m.get("device_id_a") == target and m.get("device_id_b") == did),
        None,
    )

    if reverse:
        contact = reverse.get("contact_info_a")
        msg = f"双方都接受了！对方分享的联系方式：{contact}" if contact else "双方都接受了！但对方还没有分享联系方式。"
        return _ok({"accepted": True, "mutual": True, "their_contact": contact, "message": msg})

    return _ok({
        "accepted": True,
        "mutual": False,
        "message": "已接受。等对方也接受后，你们就可以交换联系方式了。",
    })


def handle_checkin(params: dict) -> str:
    sb = _sb()
    did = _device_id(params["sender_id"], params["channel"], params.get("chat_id"))
    flat, flng = _fuzzy(params["lat"], params["lng"])

    # Check profile exists
    prof = sb.rpc("get_profile", {"p_device_id": did}).execute()
    if not prof.data:
        return _ok({"checked_in": False, "message": "你还没有名片，先创建一个吧。"})

    sb.rpc("upsert_profile_location", {
        "p_device_id": did, "p_lng": flng, "p_lat": flat,
    }).execute()

    place = f" ({params['place_name']})" if params.get("place_name") else ""
    return _ok({"checked_in": True, "message": f"已签到{place} 📍 现在附近的人扫描就能看到你了。"})


def handle_check_matches(params: dict) -> str:
    sb = _sb()
    did = _device_id(params["sender_id"], params["channel"], params.get("chat_id"))

    resp = sb.rpc("get_my_matches_with_profiles", {"p_device_id": did}).execute()
    data = resp.data or {}

    raw_mutual = data.get("mutual_matches") or []
    raw_incoming = data.get("incoming_accepts") or []

    if not raw_mutual and not raw_incoming:
        return _ok({"mutual_matches": [], "incoming_accepts": [], "message": "目前没有进行中的匹配。"})

    mutual = []
    for i, m in enumerate(raw_mutual):
        mutual.append({
            "ref": str(i + 1),
            "_device_id": m.get("target_id"),
            "name": m.get("name") or "匿名",
            "emoji": m.get("emoji") or "👤",
            "their_contact": m.get("their_contact"),
            "you_shared": m.get("you_shared"),
        })

    inc_only = []
    for i, m in enumerate(raw_incoming):
        inc_only.append({
            "ref": str(len(mutual) + i + 1),
            "_device_id": m.get("target_id"),
            "name": m.get("name") or "匿名",
            "emoji": m.get("emoji") or "👤",
            "line1": m.get("line1"),
            "line2": m.get("line2"),
            "line3": m.get("line3"),
        })

    msgs = []
    if mutual:
        msgs.append(f"{len(mutual)} 个双向匹配！可以交换联系方式了")
    if inc_only:
        msgs.append(f"{len(inc_only)} 个人想认识你，等你回应")
    if not msgs:
        msgs.append("你接受了一些匹配，但对方还没有回应。耐心等等 ⏳")

    # Persist refs so accept(ref) resolves correctly
    global _last_ref_map
    _last_ref_map = {}
    for m in mutual:
        _last_ref_map[m["ref"]] = m["_device_id"]
    for m in inc_only:
        _last_ref_map[m["ref"]] = m["_device_id"]
    if did and _last_ref_map:
        try:
            sb.rpc("save_scan_refs", {"p_owner": did, "p_refs": _last_ref_map}).execute()
        except Exception:
            pass

    return _ok({
        "mutual_matches": mutual,
        "incoming_accepts": inc_only,
        "message": "；".join(msgs),
    })


BASE_URL = "https://www.antenna.fyi"


def handle_pass(params: dict) -> str:
    sb = _sb()
    did = _device_id(params["sender_id"], params["channel"], params.get("chat_id"))

    ref = params.get("ref")
    target = params.get("target_device_id")
    if ref and ref in _last_ref_map:
        target = _last_ref_map[ref]
    if not target and ref:
        # Try resolve via RPC
        try:
            resp = sb.rpc("resolve_ref", {"p_owner": did, "p_ref": ref}).execute()
            if resp.data:
                target = resp.data
        except Exception:
            pass
    if not target:
        return _ok({"error": "No target. Use 'ref' from scan/discover results or 'target_device_id'."})

    sb.rpc("pass_user", {
        "p_device_id": did,
        "p_passed_device_id": target,
    }).execute()

    return _ok({"passed": True, "message": "已跳过，不会再推荐这个人了。"})


def handle_discover(params: dict) -> str:
    sb = _sb()
    did = _device_id(params["sender_id"], params["channel"], params.get("chat_id"))

    resp = sb.rpc("global_discover", {"p_device_id": did}).execute()
    results = resp.data or []

    if not results:
        return _ok({"count": 0, "message": "今天没有新的全球推荐了，明天再来看看。"})

    global _last_ref_map
    _last_ref_map = {}
    profiles = []

    # Get my profile for match reason
    my_prof = sb.rpc("get_profile", {"p_device_id": did}).execute()
    my_data = my_prof.data or {}
    my_lines = [my_data.get("line1", ""), my_data.get("line2", ""), my_data.get("line3", "")]

    ref_map = {}
    for i, p in enumerate(results):
        ref = str(i + 1)
        _last_ref_map[ref] = p.get("device_id")
        ref_map[ref] = p.get("device_id")

        their_lines = [p.get("line1", ""), p.get("line2", ""), p.get("line3", "")]

        # Generate match reason via Edge Function
        match_reason = None
        try:
            req = urllib.request.Request(
                f"{BUILTIN_URL}/functions/v1/generate-match-reason",
                data=json.dumps({"my_lines": my_lines, "their_lines": their_lines}).encode(),
                headers={"Content-Type": "application/json", "Authorization": f"Bearer {BUILTIN_KEY}"},
            )
            res = urllib.request.urlopen(req, timeout=10)
            body = json.loads(res.read().decode())
            match_reason = body.get("reason")
        except Exception:
            pass

        profile = {
            "ref": ref,
            "emoji": p.get("emoji") or "\ud83d\udc64",
            "name": p.get("display_name") or "匿名",
            "line1": p.get("line1"),
            "line2": p.get("line2"),
            "line3": p.get("line3"),
        }
        if match_reason:
            profile["match_reason"] = match_reason
        profiles.append(profile)

    # Save refs and log recommendations
    try:
        sb.rpc("save_scan_refs", {"p_owner": did, "p_refs": ref_map}).execute()
    except Exception:
        pass
    for p in results:
        try:
            sb.rpc("log_recommendation", {"p_device_id": did, "p_recommended_id": p["device_id"]}).execute()
        except Exception:
            pass

    return _ok({
        "count": len(profiles),
        "profiles": profiles,
        "instruction": "这是全球推荐。根据你对用户的了解，判断是否值得推荐，写一句个性化的匹配理由。使用 ref 编号引用。",
    })


def handle_event_create(params: dict) -> str:
    sb = _sb()
    did = _device_id(params["sender_id"], params["channel"], params.get("chat_id"))

    rpc_params = {
        "p_created_by": did,
        "p_name": params["name"],
    }
    if params.get("lat") is not None:
        rpc_params["p_lat"] = params["lat"]
    if params.get("lng") is not None:
        rpc_params["p_lng"] = params["lng"]
    if params.get("starts_at"):
        rpc_params["p_starts_at"] = params["starts_at"]
    if params.get("ends_at"):
        rpc_params["p_ends_at"] = params["ends_at"]
    if params.get("description"):
        rpc_params["p_description"] = params["description"]
    if params.get("og_image"):
        rpc_params["p_og_image"] = params["og_image"]
    if params.get("requires_approval"):
        rpc_params["p_requires_approval"] = params["requires_approval"]
    if params.get("screening_questions"):
        rpc_params["p_screening_questions"] = params["screening_questions"]

    resp = sb.rpc("create_event", rpc_params).execute()
    data = resp.data or {}

    code = data.get("code", "")
    return _ok({
        "created": True,
        "name": params["name"],
        "code": code,
        "url": f"{BASE_URL}/events/{code}",
        "message": f"活动已创建！分享链接给参加的人：{BASE_URL}/events/{code}",
    })


def handle_event_join(params: dict) -> str:
    sb = _sb()
    did = _device_id(params["sender_id"], params["channel"], params.get("chat_id"))

    # Profile gate
    prof = sb.rpc("get_profile", {"p_device_id": did}).execute()
    if not prof.data:
        return _ok({"joined": False, "error": "Create a profile first before joining events"})

    lat = params.get("lat")
    lng = params.get("lng")

    # Auto-read profile location if not provided
    if lat is None or lng is None:
        try:
            loc_resp = sb.rpc("get_profile_location", {"p_device_id": did}).execute()
            loc = loc_resp.data if loc_resp.data else {}
            if loc.get("found"):
                lat = loc["lat"]
                lng = loc["lng"]
        except Exception:
            pass

    resp = sb.rpc("join_event", {
        "p_device_id": did,
        "p_code": params["code"],
        "p_lat": lat,
        "p_lng": lng,
        "p_application_context": params.get("application_context"),
    }).execute()
    data = resp.data or {}

    if not data.get("joined"):
        return _ok({"joined": False, "error": data.get("error", "加入失败")})

    # Auto-checkin if event started and we have GPS
    if lat is not None and lng is not None:
        try:
            evt_resp = sb.rpc("get_event", {"p_code": params["code"]}).execute()
            evt = evt_resp.data or {}
            import datetime
            starts_at = evt.get("starts_at")
            if starts_at:
                # Parse ISO datetime
                sa = datetime.datetime.fromisoformat(starts_at.replace("Z", "+00:00"))
                now = datetime.datetime.now(datetime.timezone.utc)
                if sa <= now:
                    evt_lat = evt.get("lat")
                    evt_lng = evt.get("lng")
                    do_checkin = True
                    if evt_lat is not None and evt_lng is not None:
                        # Haversine distance
                        R = 6371000
                        d_lat = math.radians(evt_lat - lat)
                        d_lng = math.radians(evt_lng - lng)
                        a = math.sin(d_lat/2)**2 + math.cos(math.radians(lat))*math.cos(math.radians(evt_lat))*math.sin(d_lng/2)**2
                        dist = R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
                        if dist > 1000:
                            do_checkin = False
                            data["checked_in"] = False
                            data["checkin_reason"] = "too far"
                            data["distance_m"] = round(dist)
                    if do_checkin:
                        flat, flng = _fuzzy(lat, lng)
                        sb.rpc("event_checkin", {
                            "p_code": params["code"],
                            "p_device_id": did,
                            "p_lat": flat,
                            "p_lng": flng,
                        }).execute()
                        data["checked_in"] = True
                else:
                    data["checked_in"] = False
                    data["checkin_reason"] = "event not started yet"
        except Exception:
            data["checked_in"] = False
            data["checkin_reason"] = "checkin failed"

    return _ok(data)


def handle_event_scan(params: dict) -> str:
    sb = _sb()
    did = _device_id(params["sender_id"], params["channel"], params.get("chat_id"))

    resp = sb.rpc("event_participants_list", {
        "p_code": params["code"], "p_device_id": did,
    }).execute()
    results = resp.data or []

    others = [p for p in results if p.get("device_id") != did]

    if not others:
        return _ok({"count": 0, "profiles": [], "message": "活动里还没有其他人。"})

    global _last_ref_map
    _last_ref_map = {}
    checked_in_count = 0
    profiles = []
    for i, p in enumerate(others):
        ref = str(i + 1)
        _last_ref_map[ref] = p.get("device_id")
        if p.get("checked_in"):
            checked_in_count += 1
        profiles.append({
            "ref": ref,
            "emoji": p.get("emoji") or "👤",
            "name": p.get("display_name") or "匿名",
            "line1": p.get("line1"),
            "line2": p.get("line2"),
            "line3": p.get("line3"),
            "checked_in": bool(p.get("checked_in")),
            "role": p.get("role") or "participant",
            "status": p.get("status") or "active",
            "application_context": p.get("application_context"),
            "source": "event",
        })

    return _ok({
        "count": len(profiles),
        "checked_in_count": checked_in_count,
        "profiles": profiles,
        "instruction": "这些是活动参加者。根据你对用户的了解，推荐值得认识的人。使用 ref 编号引用。",
    })

def handle_bind(params: dict) -> str:
    sb = _sb()
    did = _device_id(params["sender_id"], params["channel"], params.get("chat_id"))
    purpose = params.get("purpose", "profile")
    event_code = params.get("event_code")

    resp = sb.rpc("create_bind_token", {
        "p_device_id": did,
        "p_purpose": purpose,
        "p_event_code": event_code,
    }).execute()
    if not resp.data:
        return _ok({"error": "Failed to create bind token"})

    token = resp.data.get("token")
    msg = (
        "发送这个链接给活动创建者，在活动地点打开即可设定活动位置。"
        if purpose == "event"
        else "发送这个链接给用户，在手机浏览器打开即可共享位置。"
    )
    return _ok({
        "token": token,
        "url": f"{BASE_URL}/locate?token={token}",
        "purpose": purpose,
        "message": msg,
    })


def handle_event_end(params: dict) -> str:
    sb = _sb()
    did = _device_id(params["sender_id"], params["channel"], params.get("chat_id"))

    resp = sb.rpc("end_event", {
        "p_code": params["code"],
        "p_device_id": did,
    }).execute()
    data = resp.data or {}

    if data.get("ended"):
        return _ok({"ended": True, "message": f"活动已结束。"})
    return _ok({"ended": False, "error": data.get("error", "结束活动失败")})


def handle_event_upload_image(params: dict) -> str:
    import base64 as b64mod
    sb = _sb()
    content_type = params.get("content_type") or "image/png"
    ext = content_type.split("/")[1] if "/" in content_type else "png"
    path = f"{params['event_code']}.{ext}"
    buf = b64mod.b64decode(params["image_base64"])
    resp = sb.storage.from_("event-images").upload(path, buf, {"content-type": content_type, "upsert": "true"})
    pub = sb.storage.from_("event-images").get_public_url(path)
    return _ok({"url": pub})


def handle_event_checkin(params: dict) -> str:
    sb = _sb()
    did = _device_id(params["sender_id"], params["channel"], params.get("chat_id"))

    lat = params.get("lat")
    lng = params.get("lng")
    if lat is not None and lng is not None:
        flat, flng = _fuzzy(lat, lng)
    else:
        flat, flng = None, None

    resp = sb.rpc("event_checkin", {
        "p_code": params["code"],
        "p_device_id": did,
        "p_lat": flat,
        "p_lng": flng,
    }).execute()
    return _ok(resp.data or {})


def handle_event_update(params: dict) -> str:
    sb = _sb()
    did = _device_id(params["sender_id"], params["channel"], params.get("chat_id"))
    rpc_params = {
        "p_code": params["code"], "p_device_id": did,
        "p_name": params.get("name"), "p_description": params.get("description"),
        "p_og_image": params.get("og_image"), "p_lat": params.get("lat"),
        "p_lng": params.get("lng"), "p_starts_at": params.get("starts_at"),
        "p_ends_at": params.get("ends_at"),
    }
    if params.get("requires_approval") is not None:
        rpc_params["p_requires_approval"] = params["requires_approval"]
    if params.get("screening_questions") is not None:
        rpc_params["p_screening_questions"] = params["screening_questions"]
    resp = sb.rpc("update_event", rpc_params).execute()
    return _ok(resp.data or {"error": "update failed"})


def handle_event_approve(params: dict) -> str:
    sb = _sb()
    did = _device_id(params["sender_id"], params["channel"], params.get("chat_id"))
    resp = sb.rpc("approve_participant", {
        "p_code": params["code"], "p_device_id": did, "p_target_ref": params["ref"],
    }).execute()
    return _ok(resp.data or {"error": "approve failed"})


def handle_event_reject(params: dict) -> str:
    sb = _sb()
    did = _device_id(params["sender_id"], params["channel"], params.get("chat_id"))
    resp = sb.rpc("reject_participant", {
        "p_code": params["code"], "p_device_id": did, "p_target_ref": params["ref"],
    }).execute()
    return _ok(resp.data or {"error": "reject failed"})


def handle_event_add_host(params: dict) -> str:
    sb = _sb()
    did = _device_id(params["sender_id"], params["channel"], params.get("chat_id"))
    resp = sb.rpc("add_cohost", {
        "p_code": params["code"], "p_device_id": did, "p_target_ref": params["ref"],
    }).execute()
    return _ok(resp.data or {"error": "add_cohost failed"})


def handle_event_message(params: dict) -> str:
    """Send a message to event participants. Only creator or co-host can send."""
    sb = _sb()
    did = _device_id(params["sender_id"], params["channel"], params.get("chat_id"))
    rpc_params = {
        "p_code": params["code"],
        "p_device_id": did,
        "p_message": params["message"],
    }
    if params.get("ref"):
        rpc_params["p_target_ref"] = params["ref"]
    resp = sb.rpc("send_event_message", rpc_params).execute()
    return _ok(resp.data or {"error": "send_event_message failed"})
