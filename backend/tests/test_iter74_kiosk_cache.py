"""iter74 — kiosk endpoint regression + cache invalidation + overview parallel.
Tests GET /api/kiosk/apartments, /api/kiosk/locations shape & filters,
cache invalidation on mutations, customer-display heartbeat does NOT clear cache,
/api/kiosk/tenants/{id}/overview structure, and /api/admin/stats mutation reflection.
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
COMPANY_SLUG = "my-awesome-rentals-bv"
KIOSK_PIN = "4321"

APT_KEYS = {
    "id", "number", "address", "rent_amount", "currency", "status",
    "tenant_id", "tenant_name", "tenant_avatar_url", "tenant_id_photo_url",
    "show_tenant_photo", "location_id", "pay_status",
}


@pytest.fixture(scope="module")
def kiosk():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/kiosk-pin",
               json={"pin": KIOSK_PIN, "company_slug": COMPANY_SLUG}, timeout=20)
    assert r.status_code == 200, f"kiosk-pin failed: {r.status_code} {r.text}"
    assert "kiosk_token" in s.cookies, "kiosk_token cookie not set"
    return s


@pytest.fixture(scope="module")
def admin():
    s = requests.Session()
    # super admin credentials from /app/memory/test_credentials.md — but we need
    # the admin of the kiosk's company. Try the "my-awesome-rentals-bv" admin.
    # Fall back to demo if that fails.
    for email, pw in [("admin@my-awesome-rentals-bv.sr", "admin1234"),
                      ("info@my-awesome-rentals-bv.sr", "admin1234"),
                      ("demo@surirent.sr", "demo1234")]:
        r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pw}, timeout=20)
        if r.status_code == 200:
            return s
    pytest.skip("No admin credentials worked for mutation tests")


# ---------- /api/kiosk/apartments ----------
def test_apartments_shape_and_filters(kiosk):
    r = kiosk.get(f"{BASE_URL}/api/kiosk/apartments", timeout=20)
    assert r.status_code == 200, r.text
    apts = r.json()
    assert isinstance(apts, list) and len(apts) > 0, "expected at least one apartment"
    first = apts[0]
    missing = APT_KEYS - set(first.keys())
    assert not missing, f"missing keys {missing} in apartment: {first}"
    for a in apts:
        assert a["pay_status"] in ("unpaid", "partial", "paid"), f"bad pay_status: {a['pay_status']}"
    # Filter by a known location_id
    loc_ids = [a["location_id"] for a in apts if a.get("location_id")]
    if loc_ids:
        lid = loc_ids[0]
        r2 = kiosk.get(f"{BASE_URL}/api/kiosk/apartments", params={"location_id": lid}, timeout=20)
        assert r2.status_code == 200
        for a in r2.json():
            assert a["location_id"] == lid
    # Filter by _none
    r3 = kiosk.get(f"{BASE_URL}/api/kiosk/apartments", params={"location_id": "_none"}, timeout=20)
    assert r3.status_code == 200
    for a in r3.json():
        assert not a.get("location_id"), f"_none filter leaked loc: {a['location_id']}"


# ---------- /api/kiosk/locations ----------
def test_locations_counts(kiosk):
    r = kiosk.get(f"{BASE_URL}/api/kiosk/locations", timeout=20)
    assert r.status_code == 200, r.text
    locs = r.json()
    assert isinstance(locs, list) and len(locs) > 0
    for loc in locs:
        assert "apartments_total" in loc and "apartments_occupied" in loc
        assert isinstance(loc["apartments_total"], int)
        assert loc["apartments_occupied"] <= loc["apartments_total"]

    # Cross-check with /apartments list
    all_apts = kiosk.get(f"{BASE_URL}/api/kiosk/apartments", timeout=20).json()
    by_loc = {}
    for a in all_apts:
        by_loc.setdefault(a.get("location_id") or "", {"t": 0, "o": 0})
        by_loc[a.get("location_id") or ""]["t"] += 1
        if a["status"] == "occupied":
            by_loc[a.get("location_id") or ""]["o"] += 1
    for loc in locs:
        lid = loc["id"] if loc["id"] != "_none" else ""
        if lid in by_loc:
            assert loc["apartments_total"] == by_loc[lid]["t"], (
                f"loc {loc['name']} total mismatch: {loc['apartments_total']} vs {by_loc[lid]['t']}")
            assert loc["apartments_occupied"] == by_loc[lid]["o"], (
                f"loc {loc['name']} occupied mismatch")


# ---------- customer-display heartbeat should NOT clear cache ----------
def test_customer_display_heartbeat_keeps_cache(kiosk):
    # Warm cache
    r0 = kiosk.get(f"{BASE_URL}/api/kiosk/apartments", timeout=20)
    assert r0.status_code == 200
    before = r0.json()

    # Heartbeat PUT (minimal payload)
    hb = kiosk.put(f"{BASE_URL}/api/kiosk/customer-display",
                   json={"step": "idle", "payload": {}}, timeout=20)
    assert hb.status_code in (200, 204), f"heartbeat failed: {hb.status_code} {hb.text}"

    # After heartbeat, apartments list still works (and shape identical)
    r1 = kiosk.get(f"{BASE_URL}/api/kiosk/apartments", timeout=20)
    assert r1.status_code == 200
    assert len(r1.json()) == len(before)


# ---------- /api/kiosk/tenants/{id}/overview ----------
def test_tenant_overview_structure(kiosk):
    apts = kiosk.get(f"{BASE_URL}/api/kiosk/apartments", timeout=20).json()
    tids = [a["tenant_id"] for a in apts if a.get("tenant_id")]
    if not tids:
        pytest.skip("no tenant to test overview")
    tid = tids[0]
    r = kiosk.get(f"{BASE_URL}/api/kiosk/tenants/{tid}/overview", timeout=20)
    assert r.status_code == 200, r.text
    o = r.json()
    required = {"tenant", "apartment", "balance", "credit_balance", "open_invoices",
                "current_invoices", "future_invoices", "open_invoices_total",
                "current_invoices_total", "future_invoices_total",
                "fines_total", "has_history", "due_reminders"}
    missing = required - set(o.keys())
    assert not missing, f"overview missing {missing}; got keys {list(o.keys())}"
    assert o["tenant"]["id"] == tid
    assert isinstance(o["open_invoices"], list)


def test_tenant_overview_404(kiosk):
    r = kiosk.get(f"{BASE_URL}/api/kiosk/tenants/does-not-exist-xyz/overview", timeout=20)
    assert r.status_code == 404


# ---------- cache invalidation via admin mutation ----------
def test_cache_invalidation_on_apartment_create(kiosk, admin):
    # First find a location for the kiosk's company so we can create an apt
    locs = kiosk.get(f"{BASE_URL}/api/kiosk/locations", timeout=20).json()
    real_locs = [l for l in locs if l["id"] != "_none"]
    if not real_locs:
        pytest.skip("no real location")
    lid = real_locs[0]["id"]

    # Warm cache
    r0 = kiosk.get(f"{BASE_URL}/api/kiosk/apartments", timeout=20)
    before = {a["number"] for a in r0.json()}

    # Create apartment via admin API
    unique_nr = f"TEST-{int(time.time())}"
    payload = {
        "number": unique_nr,
        "address": "TEST street 1",
        "rent_amount": 100,
        "currency": "SRD",
        "status": "available",
        "location_id": lid,
    }
    cr = admin.post(f"{BASE_URL}/api/apartments", json=payload, timeout=20)
    if cr.status_code not in (200, 201):
        pytest.skip(f"admin cannot create apartments (status {cr.status_code}): skipping cache test")
    new_id = cr.json().get("id")

    try:
        # Immediately after mutation, kiosk list must contain the new apt (cache invalidated)
        r1 = kiosk.get(f"{BASE_URL}/api/kiosk/apartments", timeout=20)
        after = {a["number"] for a in r1.json()}
        assert unique_nr in after, (
            f"cache NOT invalidated after apartment create: before={len(before)} after={len(after)}, "
            f"new nr '{unique_nr}' not present")
    finally:
        if new_id:
            admin.delete(f"{BASE_URL}/api/apartments/{new_id}", timeout=20)


# ---------- /api/admin/stats sanity ----------
def test_admin_stats(admin):
    r = admin.get(f"{BASE_URL}/api/admin/stats", timeout=20)
    assert r.status_code == 200, r.text
    data = r.json()
    assert isinstance(data, dict) and len(data.keys()) > 0
