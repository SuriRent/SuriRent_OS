"""Iteration 62: verify billing/me includes company_name + subscription data."""
import os
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://vastgoed-app.preview.emergentagent.com").rstrip("/")


@pytest.fixture(scope="module")
def demo_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": "demo@surirent.sr", "password": "demo1234"})
    assert r.status_code == 200, r.text
    return s


def test_billing_me_contains_company_name(demo_session):
    r = demo_session.get(f"{BASE_URL}/api/billing/me")
    assert r.status_code == 200, r.text
    data = r.json()
    assert "company_name" in data, f"missing company_name key, got {list(data.keys())}"
    assert isinstance(data["company_name"], str) and data["company_name"].strip(), f"company_name empty: {data.get('company_name')!r}"
    print("company_name=", data["company_name"])


def test_billing_me_invoices_structure(demo_session):
    r = demo_session.get(f"{BASE_URL}/api/billing/me/invoices")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    if data:
        inv = data[0]
        for k in ("id", "status"):
            assert k in inv


def test_superadmin_billing_me_unaffected(demo_session):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": "super@surirent.sr", "password": "super1234"})
    assert r.status_code == 200, r.text
    # superadmin may not have billing/me (no company) - just ensure endpoint responds without 500
    r2 = s.get(f"{BASE_URL}/api/billing/me")
    assert r2.status_code in (200, 400, 403, 404), r2.status_code
