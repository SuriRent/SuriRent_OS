"""Tests for hardened /api/kiosk/tenants/{tenant_id}/payments endpoint.

Verifies:
- 200 for valid tenants w/ session cookie
- 404 (not 500) for unknown tenant
- 401 when no cookie
- Response never contains company_logo_bytes
- Adjacent kiosk endpoints (overview, notes, receipts) still work
- kiosk-pin login returns admin_token + kiosk token
"""
import os
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL") or open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split("\n")[0].strip()
BASE_URL = BASE_URL.rstrip("/")

PIN = "4321"
COMPANY_SLUG = "my-awesome-rentals-bv"

REAL_TENANTS = [
    "f80a9545-1727-4522-baa3-671dac39c580",  # Jan Pieterse
    "8d594d77-d884-41f9-bd61-daec0c721435",  # Marlies
    "25ad7216-2c18-40d7-a790-e9848388f831",  # Roy
]
UNKNOWN_TENANT = "2d286e69-fb17-4eae-89d6-90e07c017354"


@pytest.fixture(scope="module")
def kiosk_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/kiosk-pin", json={"pin": PIN, "company_slug": COMPANY_SLUG}, timeout=30)
    assert r.status_code == 200, f"kiosk-pin login failed: {r.status_code} {r.text[:300]}"
    body = r.json()
    assert "admin_token" in body, f"admin_token missing: {body}"
    # kiosk token may be in cookie or body
    assert ("kiosk_token" in body) or any("kiosk" in c.lower() for c in s.cookies.keys()), f"kiosk token missing from body/cookies: {body} cookies={s.cookies.get_dict()}"
    return s, body


# ---- kiosk PIN login ----
def test_kiosk_pin_login(kiosk_session):
    s, body = kiosk_session
    assert body.get("admin_token")


# ---- payments endpoint: valid tenants ----
@pytest.mark.parametrize("tenant_id", REAL_TENANTS)
def test_payments_valid_tenant_returns_200(kiosk_session, tenant_id):
    s, _ = kiosk_session
    r = s.get(f"{BASE_URL}/api/kiosk/tenants/{tenant_id}/payments", timeout=30)
    assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text[:400]}"
    data = r.json()
    assert isinstance(data, (list, dict)), f"Response not list/dict: {type(data)}"
    # Verify no company_logo_bytes in any payment
    items = data if isinstance(data, list) else data.get("payments", [])
    for item in items:
        assert "company_logo_bytes" not in item, f"company_logo_bytes leaked in response for {tenant_id}"


# ---- payments endpoint: unknown tenant ----
def test_payments_unknown_tenant_returns_404_not_500(kiosk_session):
    s, _ = kiosk_session
    r = s.get(f"{BASE_URL}/api/kiosk/tenants/{UNKNOWN_TENANT}/payments", timeout=30)
    # Must NOT be 500. Ideal is 404. Endpoint hardening may return 200 + [] but requirement says 404.
    assert r.status_code != 500, f"HTTP 500 on unknown tenant: {r.text[:400]}"
    assert r.status_code == 404, f"Expected 404 for unknown tenant, got {r.status_code}: {r.text[:400]}"


# ---- payments endpoint: unauthenticated ----
def test_payments_unauth_returns_401():
    r = requests.get(f"{BASE_URL}/api/kiosk/tenants/{REAL_TENANTS[0]}/payments", timeout=30)
    assert r.status_code == 401, f"Expected 401 without session, got {r.status_code}: {r.text[:300]}"


# ---- adjacent endpoints regression ----
@pytest.mark.parametrize("tenant_id", REAL_TENANTS)
def test_overview_still_200(kiosk_session, tenant_id):
    s, _ = kiosk_session
    r = s.get(f"{BASE_URL}/api/kiosk/tenants/{tenant_id}/overview", timeout=30)
    assert r.status_code == 200, f"overview {tenant_id}: {r.status_code} {r.text[:300]}"


@pytest.mark.parametrize("tenant_id", REAL_TENANTS)
def test_notes_still_200(kiosk_session, tenant_id):
    s, _ = kiosk_session
    r = s.get(f"{BASE_URL}/api/kiosk/tenants/{tenant_id}/notes", timeout=30)
    assert r.status_code == 200, f"notes {tenant_id}: {r.status_code} {r.text[:300]}"


# ---- receipt endpoint ----
def test_receipt_for_real_payment(kiosk_session):
    s, _ = kiosk_session
    # find a payment id from first tenant with payments
    payment_id = None
    for t in REAL_TENANTS:
        r = s.get(f"{BASE_URL}/api/kiosk/tenants/{t}/payments", timeout=30)
        if r.status_code == 200:
            items = r.json() if isinstance(r.json(), list) else r.json().get("payments", [])
            if items:
                payment_id = items[0].get("id") or items[0].get("payment_id") or items[0].get("_id")
                if payment_id:
                    break
    if not payment_id:
        pytest.skip("No real payments available to test receipt endpoint")
    r = s.get(f"{BASE_URL}/api/kiosk/receipts/{payment_id}", timeout=30)
    assert r.status_code == 200, f"receipt {payment_id}: {r.status_code} {r.text[:300]}"
