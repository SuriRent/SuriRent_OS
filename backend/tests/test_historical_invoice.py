"""Regression tests voor POST /api/invoices/historical.

Doel: bij onboarding kunnen beheerders een historische factuur met vrij
bedrag/datum/omschrijving invoeren die als openstaand saldo meetelt.
"""
import os
import requests
import pytest

BASE = os.environ.get("REACT_APP_BACKEND_URL_OVERRIDE") or "https://vastgoed-app.preview.emergentagent.com"
LOGIN_EMAIL = "demo@surirent.sr"
LOGIN_PASSWORD = "demo1234"


@pytest.fixture(scope="module")
def auth_headers():
    r = requests.post(f"{BASE}/api/auth/login",
                      json={"email": LOGIN_EMAIL, "password": LOGIN_PASSWORD}, timeout=30)
    assert r.status_code == 200, r.text
    tok = r.json().get("access_token") or r.json().get("token")
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def tenant_id(auth_headers):
    r = requests.get(f"{BASE}/api/tenants", headers=auth_headers, timeout=10)
    assert r.status_code == 200
    tenants = r.json()
    assert tenants, "geen tenants in demo — seed eerst een huurder"
    return tenants[0]["id"]


def test_create_historical_invoice_appears_in_list(auth_headers, tenant_id):
    r = requests.post(
        f"{BASE}/api/invoices/historical",
        headers=auth_headers,
        json={
            "tenant_id": tenant_id,
            "amount": 2500.00,
            "date": "2023-03-10",
            "description": "Achterstand pytest",
            "currency": "SRD",
        },
        timeout=10,
    )
    assert r.status_code == 200, r.text
    inv = r.json()
    assert inv["is_historical"] is True
    assert inv["description"] == "Achterstand pytest"
    assert inv["amount"] == 2500.0
    assert inv["remaining_amount"] == 2500.0
    assert inv["period_month"] == 3
    assert inv["period_year"] == 2023
    assert inv["invoice_number"].startswith("H2023-")
    invoice_id = inv["id"]
    try:
        # Verify it shows up in the invoice list
        r2 = requests.get(f"{BASE}/api/invoices", headers=auth_headers, timeout=10)
        assert r2.status_code == 200
        ids = [i["id"] for i in r2.json()]
        assert invoice_id in ids
    finally:
        requests.delete(f"{BASE}/api/invoices/{invoice_id}", headers=auth_headers, timeout=10)


def test_reject_future_date(auth_headers, tenant_id):
    r = requests.post(
        f"{BASE}/api/invoices/historical",
        headers=auth_headers,
        json={"tenant_id": tenant_id, "amount": 100, "date": "2099-01-01", "description": "x"},
        timeout=10,
    )
    assert r.status_code == 400
    assert "toekomst" in r.json()["detail"].lower()


def test_reject_zero_amount(auth_headers, tenant_id):
    r = requests.post(
        f"{BASE}/api/invoices/historical",
        headers=auth_headers,
        json={"tenant_id": tenant_id, "amount": 0, "date": "2024-01-01", "description": "x"},
        timeout=10,
    )
    assert r.status_code == 422


def test_reject_invalid_date(auth_headers, tenant_id):
    r = requests.post(
        f"{BASE}/api/invoices/historical",
        headers=auth_headers,
        json={"tenant_id": tenant_id, "amount": 100, "date": "not-a-date", "description": "x"},
        timeout=10,
    )
    assert r.status_code == 400
    assert "ongeldig" in r.json()["detail"].lower()


def test_multiple_historical_per_period_allowed(auth_headers, tenant_id):
    """De duplicate-check per (tenant, period) mag niet gelden voor historische."""
    payload = {
        "tenant_id": tenant_id,
        "amount": 500,
        "date": "2023-01-15",
        "description": "regel 1",
    }
    r1 = requests.post(f"{BASE}/api/invoices/historical", headers=auth_headers, json=payload, timeout=10)
    r2 = requests.post(f"{BASE}/api/invoices/historical", headers=auth_headers,
                       json={**payload, "description": "regel 2"}, timeout=10)
    assert r1.status_code == 200 and r2.status_code == 200
    id1, id2 = r1.json()["id"], r2.json()["id"]
    try:
        assert id1 != id2
    finally:
        requests.delete(f"{BASE}/api/invoices/{id1}", headers=auth_headers, timeout=10)
        requests.delete(f"{BASE}/api/invoices/{id2}", headers=auth_headers, timeout=10)
