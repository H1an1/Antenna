"""Antenna tool handlers — what runs when called.

Uses the Supabase REST API via supabase-py. Falls back to the built-in
shared backend if no env vars are set.
"""

import json
import math
import os
import time
import urllib.parse

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


def _device_id(sender_id: str, channel: str) -> str:
    return f"{channel}:{sender_id}"


def _fuzzy(lat: float, lng: float) -> tuple[float, float]:
    return round(lat * 1000) / 1000, round(lng * 1000) / 1000


def _ok(data) -> str:
    return json.dumps(data, ensure_ascii=False)


# ─── Handlers ─────────────────────────────────────────────────────────

def handle_scan(params: dict) -> str:
    sb = _sb()
    did = _device_id(params["sender_id"], params["channel"])
    radius = params.get("radius_m", 500)

    # Rate limit
    now = time.time()
    if did in _last_scan and now - _last_scan[did] < SCAN_DEBOUNCE_S:
        return _ok({"nearby": [], "message": "刚刚才扫描过，稍等一会儿再试。", "rate_limited": True})
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
            return _ok({"nearby": [], "message": "还没有位置信息。请先通过链接分享位置，或者发送位置消息。"})

    flat, flng = _fuzzy(lat, lng)

    # Update own location
    sb.rpc("upsert_profile_location", {
        "p_device_id": did, "p_lng": flng, "p_lat": flat,
    }).execute()

    # Query nearby
    resp = sb.rpc("nearby_profiles", {
        "p_lat": flat, "p_lng": flng, "p_radius_m": radius,
    }).execute()

    others = [p for p in (resp.data or []) if p.get("device_id") != did]

    if not others:
        return _ok({"nearby": [], "message": f"在 {radius}m 范围内没有发现其他人。"})

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
        })

    return _ok({
        "nearby": profiles,
        "total": len(others),
        "radius_m": radius,
        "instruction": "根据你对用户的了解，判断哪些人值得推荐，为每个推荐写一句个性化的匹配理由。使用 ref 编号（如 '1', '2')来引用人员，不要显示 device_id。",
    })


def handle_profile(params: dict) -> str:
    sb = _sb()
    did = _device_id(params["sender_id"], params["channel"])

    if params["action"] == "get":
        resp = sb.rpc("get_profile", {"p_device_id": did}).execute()
        if not resp.data:
            return _ok({"exists": False, "message": "你还没有名片。告诉我你的名字、emoji、三句话，我帮你创建。"})
        return _ok({"exists": True, "profile": resp.data})

    # set
    resp = sb.rpc("upsert_profile", {
        "p_device_id": did,
        "p_display_name": params.get("display_name"),
        "p_emoji": params.get("emoji"),
        "p_line1": params.get("line1"),
        "p_line2": params.get("line2"),
        "p_line3": params.get("line3"),
        "p_visible": params.get("visible", True),
    }).execute()

    if resp.data:
        return _ok({"updated": True, "profile": resp.data, "next_step": "IMPORTANT: Now call antenna_bind to generate a GPS link for the user. Do not skip this."})
    return _ok({"error": "upsert_profile failed"})


def handle_accept(params: dict) -> str:
    sb = _sb()
    did = _device_id(params["sender_id"], params["channel"])

    # Resolve ref to device_id
    ref = params.get("ref")
    target = params.get("target_device_id")
    if ref and ref in _last_ref_map:
        target = _last_ref_map[ref]
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
    did = _device_id(params["sender_id"], params["channel"])
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
    did = _device_id(params["sender_id"], params["channel"])

    resp = sb.rpc("get_my_matches", {"p_device_id": did}).execute()
    all_matches = resp.data or []

    if not all_matches:
        return _ok({"mutual_matches": [], "incoming_accepts": [], "message": "目前没有进行中的匹配。"})

    my = [m for m in all_matches if m.get("device_id_a") == did]
    incoming = [m for m in all_matches if m.get("device_id_b") == did]

    # Mutual
    mutual = []
    for m in my:
        rev = next((i for i in incoming if i.get("device_id_a") == m.get("device_id_b")), None)
        if rev:
            prof = sb.rpc("get_profile", {"p_device_id": m["device_id_b"]}).execute()
            p = prof.data or {}
            mutual.append({
                "device_id": m["device_id_b"],
                "name": p.get("display_name") or "匿名",
                "emoji": p.get("emoji") or "👤",
                "their_contact": rev.get("contact_info_a"),
                "you_shared": m.get("contact_info_a"),
            })

    # Incoming only
    inc_only = []
    for m in incoming:
        already = next((x for x in my if x.get("device_id_b") == m.get("device_id_a")), None)
        if not already:
            prof = sb.rpc("get_profile", {"p_device_id": m["device_id_a"]}).execute()
            p = prof.data or {}
            inc_only.append({
                "device_id": m["device_id_a"],
                "name": p.get("display_name") or "匿名",
                "emoji": p.get("emoji") or "👤",
                "line1": p.get("line1"),
            })

    msgs = []
    if mutual:
        msgs.append(f"{len(mutual)} 个双向匹配！可以交换联系方式了")
    if inc_only:
        msgs.append(f"{len(inc_only)} 个人想认识你，等你回应")
    if not msgs:
        msgs.append("你接受了一些匹配，但对方还没有回应。耐心等等 ⏳")

    return _ok({
        "mutual_matches": mutual,
        "incoming_accepts": inc_only,
        "message": "；".join(msgs),
    })


BASE_URL = "https://www.antenna.fyi"


def handle_bind(params: dict) -> str:
    sb = _sb()
    did = _device_id(params["sender_id"], params["channel"])

    resp = sb.rpc("create_bind_token", {"p_device_id": did}).execute()
    if not resp.data:
        return _ok({"error": "Failed to create bind token"})

    token = resp.data.get("token")
    return _ok({
        "token": token,
        "url": f"{BASE_URL}/locate?token={token}",
        "message": "发送这个链接给用户，在手机浏览器打开即可共享位置。",
    })


# ─── IP locate ─────────────────────────────────────────────────────

import re as _re

_IPv4_RE = _re.compile(r"^\d{1,3}(\.\d{1,3}){3}$")
_IPv6_RE = _re.compile(r"^[0-9a-fA-F]{0,4}(:[0-9a-fA-F]{0,4}){2,7}$")


def handle_ip_locate(params: dict) -> str:
    import urllib.request
    import json as _json

    ip = params.get("ip", "").strip()
    if not ip or (not _IPv4_RE.match(ip) and not _IPv6_RE.match(ip)):
        return _ok({"located": False, "message": "IP 定位失败：无效的 IP 地址"})

    try:
        url = f"http://ip-api.com/json/{urllib.parse.quote(ip)}?fields=status,message,lat,lon,city,country"
        with urllib.request.urlopen(url, timeout=10) as resp:
            data = _json.loads(resp.read().decode())

        if data.get("status") != "success":
            return _ok({"located": False, "message": f"IP 定位失败：{data.get('message', '未知错误')}"})

        flat, flng = _fuzzy(data["lat"], data["lon"])

        # Optionally update profile location
        did = _device_id(params["sender_id"], params["channel"])
        sb = _sb()
        sb.rpc("upsert_profile_location", {
            "p_device_id": did, "p_lng": flng, "p_lat": flat,
        }).execute()

        location = ", ".join(filter(None, [data.get("city"), data.get("country")])) or "未知位置"
        return _ok({
            "located": True,
            "lat": flat,
            "lng": flng,
            "city": data.get("city"),
            "country": data.get("country"),
            "accuracy_km": 50,
            "message": f"IP 定位成功：{location}（精度约 50km）。你可以用这些坐标调用 antenna_scan 或 antenna_checkin。",
        })
    except Exception as e:
        return _ok({"located": False, "message": f"IP 定位失败：{e}"})
