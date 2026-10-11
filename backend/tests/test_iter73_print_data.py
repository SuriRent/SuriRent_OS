"""Iter73 — backend tests for GET /api/kiosk/payments/{id}/print-data."""
import os
import requests
import pytest

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://vastgoed-app.preview.emergentagent.com").rstrip("/")
SLUG = "my-awesome-rentals-bv"
PIN = "4321"

REQUIRED_KEYS = {
    "bedrijfsnaam", "adres", "telefoon", "kwitantie", "datum", "naam",
    "appartement", "vestiging", "omschrijving", "bedrag", "openstaand",
    "methode", "opmerking",
}


@pytest.fixture(scope="module")
def kiosk_session():
    s = requests.Session()
    r = s.post(f"{BASE}/api/auth/kiosk-pin",
               json={"pin": PIN, "company_slug": SLUG}, timeout=20)
    assert r.status_code == 200, r.text
    tok = r.json().get("access_token")
    if tok:
        s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


@pytest.fixture(scope="module")
def latest_payment_id(kiosk_session):
    # Try to pick any apartment with a tenant and read their payments
    apts = kiosk_session.get(f"{BASE}/api/kiosk/apartments", timeout=20).json()
    for a in apts:
        tid = a.get("tenant_id")
        if not tid:
            continue
        pays = kiosk_session.get(f"{BASE}/api/kiosk/tenants/{tid}/payments", timeout=20).json()
        if pays:
            return pays[0]["id"]
    pytest.skip("No existing payment to test against")


def test_print_data_requires_kiosk_session(latest_payment_id):
    r = requests.get(f"{BASE}/api/kiosk/payments/{latest_payment_id}/print-data", timeout=20)
    assert r.status_code == 401


def test_print_data_404_for_unknown(kiosk_session):
    r = kiosk_session.get(f"{BASE}/api/kiosk/payments/nonexistent-xxxx/print-data", timeout=20)
    assert r.status_code == 404


def test_print_data_returns_all_13_keys(kiosk_session, latest_payment_id):
    r = kiosk_session.get(f"{BASE}/api/kiosk/payments/{latest_payment_id}/print-data", timeout=20)
    assert r.status_code == 200, r.text
    data = r.json()
    missing = REQUIRED_KEYS - set(data.keys())
    assert not missing, f"Missing keys: {missing}; got {list(data.keys())}"
    # Types / content shape
    assert isinstance(data["kwitantie"], str) and data["kwitantie"]
    assert isinstance(data["datum"], str) and len(data["datum"]) >= 10
    # datum format DD-MM-YYYY HH:MM
    import re
    assert re.match(r"^\d{2}-\d{2}-\d{4} \d{2}:\d{2}$", data["datum"]), data["datum"]
    assert data["bedrag"].startswith("SRD "), data["bedrag"]
    assert data["openstaand"].startswith("SRD "), data["openstaand"]
    assert isinstance(data["bedrijfsnaam"], str)
    assert isinstance(data["naam"], str)
    assert isinstance(data["appartement"], str)
    assert isinstance(data["methode"], str)
    # opmerking may be empty string
    assert "opmerking" in data
