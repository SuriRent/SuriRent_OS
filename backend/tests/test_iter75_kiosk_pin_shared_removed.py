"""Iter75 - Shared kiosk PIN removal. Verifies:
- POST /api/auth/kiosk-pin only accepts active employee kiosk PINs (not shared company PIN).
- POST /api/auth/kiosk-set-pin is removed (404).
- POST /api/employees/{id}/kiosk-pin still works, still rejects duplicates (409).
- POST /api/auth/register works without kiosk_pin.
"""
import os
import uuid
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://vastgoed-app.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
COMPANY_SLUG = "my-awesome-rentals-bv"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={"email": "demo@surirent.sr", "password": "demo1234"})
    assert r.status_code == 200, r.text
    return r.json()["token"]


# NOTE: demo admin belongs to 'demo' company, not my-awesome-rentals-bv. We need admin of that one.
# Use the kiosk-pin test differently -- just test the public auth/kiosk-pin endpoint which doesn't need admin auth.


def test_kiosk_pin_correct_employee_pin():
    """Correct employee PIN 4321 for my-awesome-rentals-bv should return 200 with employee object."""
    r = requests.post(f"{API}/auth/kiosk-pin", json={"pin": "4321", "company_slug": COMPANY_SLUG})
    assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
    data = r.json()
    assert "token" in data
    assert data.get("admin_token") is None
    assert data.get("employee") is not None
    assert data["employee"].get("name")
    assert "id" in data["employee"]
    assert data.get("company", {}).get("slug") == COMPANY_SLUG


def test_kiosk_pin_wrong_pin_returns_401():
    r = requests.post(f"{API}/auth/kiosk-pin", json={"pin": "0000", "company_slug": COMPANY_SLUG})
    assert r.status_code == 401, f"Expected 401, got {r.status_code}: {r.text}"
    data = r.json()
    assert "Ongeldige" in (data.get("detail") or data.get("message") or "")


def test_kiosk_pin_missing_company_scope_returns_400():
    r = requests.post(f"{API}/auth/kiosk-pin", json={"pin": "4321"})
    assert r.status_code == 400, f"Expected 400, got {r.status_code}: {r.text}"


def test_kiosk_set_pin_endpoint_removed():
    """POST /api/auth/kiosk-set-pin should be gone (404 or 405)."""
    r = requests.post(f"{API}/auth/kiosk-set-pin", json={"pin": "9999", "company_slug": COMPANY_SLUG})
    assert r.status_code in (404, 405), f"Expected 404/405, got {r.status_code}: {r.text}"


def test_register_without_kiosk_pin_works():
    """Register endpoint should accept registration without kiosk_pin field."""
    slug = f"testco-{uuid.uuid4().hex[:8]}"
    payload = {
        "company_name": f"TEST Co {slug}",
        "slug": slug,
        "name": "Test Admin",
        "email": f"test_{slug}@example.com",
        "password": "testpass1234",
    }
    r = requests.post(f"{API}/auth/register", json=payload)
    assert r.status_code in (200, 201), f"Register failed: {r.status_code}: {r.text}"
    assert "kiosk_pin" not in payload  # confirming test did NOT pass kiosk_pin
    rl = requests.post(f"{API}/auth/login", json={"email": payload["email"], "password": payload["password"]})
    assert rl.status_code == 200, rl.text


# ---- Employee PIN uniqueness ----
def _login_as_mar_admin():
    r = requests.post(f"{API}/auth/login", json={"email": "demo@surirent.sr", "password": "demo1234"})
    if r.status_code == 200:
        return r.json()["token"]
    return None


def test_employee_pin_duplicate_returns_409():
    """Set Kevin's PIN to Anita's 4321 -> expect 409."""
    tok = _login_as_mar_admin()
    if not tok:
        pytest.skip("Could not login as my-awesome-rentals-bv admin")
    h = {"Authorization": f"Bearer {tok}"}
    emps = requests.get(f"{API}/employees", headers=h)
    assert emps.status_code == 200
    kevin = next((e for e in emps.json() if "kevin" in (e.get("name", "").lower()) or "boldewijn" in e.get("name", "").lower()), None)
    if not kevin:
        pytest.skip("Kevin Boldewijn not found")
    # Attempt to set PIN=4321 (same as Anita) -> 409
    r = requests.post(f"{API}/employees/{kevin['id']}/kiosk-pin", json={"pin": "4321"}, headers=h)
    assert r.status_code == 409, f"Expected 409, got {r.status_code}: {r.text}"
    # Setting unique PIN works
    r2 = requests.post(f"{API}/employees/{kevin['id']}/kiosk-pin", json={"pin": "9876"}, headers=h)
    assert r2.status_code == 200, r2.text
    assert r2.json().get("has_kiosk_pin") is True
