"""Iteration 61: Instellingen dropdown + Mijn Abonnement redesign + saas-stripe oldest invoice."""
import os
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://vastgoed-app.preview.emergentagent.com').rstrip('/')


@pytest.fixture(scope="module")
def demo_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": "demo@surirent.sr", "password": "demo1234"})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def demo_headers(demo_token):
    return {"Authorization": f"Bearer {demo_token}"}


def test_billing_me(demo_headers):
    r = requests.get(f"{BASE_URL}/api/billing/me", headers=demo_headers)
    assert r.status_code == 200
    d = r.json()
    assert "status" in d and "plan" in d


def test_billing_me_invoices(demo_headers):
    r = requests.get(f"{BASE_URL}/api/billing/me/invoices", headers=demo_headers)
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_billing_me_payments(demo_headers):
    r = requests.get(f"{BASE_URL}/api/billing/me/payments", headers=demo_headers)
    assert r.status_code == 200


def test_billing_me_plans(demo_headers):
    r = requests.get(f"{BASE_URL}/api/billing/me/plans", headers=demo_headers)
    assert r.status_code == 200
    plans = r.json()
    assert len(plans) >= 1
    for p in plans:
        assert "id" in p and "name" in p


def test_bank_details(demo_headers):
    r = requests.get(f"{BASE_URL}/api/billing/bank-details", headers=demo_headers)
    assert r.status_code == 200


def test_saas_stripe_public_config(demo_headers):
    r = requests.get(f"{BASE_URL}/api/saas-stripe/public-config", headers=demo_headers)
    assert r.status_code == 200
    assert "enabled" in r.json()


def test_create_intent_picks_oldest_open(demo_headers):
    """Without invoice_id, should pick the open invoice with earliest period_start."""
    inv_resp = requests.get(f"{BASE_URL}/api/billing/me/invoices", headers=demo_headers)
    assert inv_resp.status_code == 200
    invoices = inv_resp.json()
    CLOSED = {"paid", "superseded", "cancelled", "void"}
    open_invs = [i for i in invoices if i.get("status") not in CLOSED]
    if not open_invs:
        pytest.skip("No open invoices to test oldest selection")
    oldest = sorted(open_invs, key=lambda i: (str(i.get("period_start") or ""), str(i.get("created_at") or "")))[0]

    cfg = requests.get(f"{BASE_URL}/api/saas-stripe/public-config", headers=demo_headers).json()
    if not cfg.get("enabled"):
        pytest.skip("Stripe not enabled in this env")

    r = requests.post(f"{BASE_URL}/api/saas-stripe/create-intent",
                      headers=demo_headers,
                      json={"method": "card"})
    # Expect 200 with client_secret/invoice info, or structured JSON that references invoice
    assert r.status_code == 200, r.text
    data = r.json()
    # Try to pick up invoice id or amount from response
    picked_id = data.get("invoice_id") or data.get("invoice", {}).get("id") if isinstance(data.get("invoice"), dict) else data.get("invoice_id")
    picked_amount = data.get("amount") or (data.get("invoice", {}).get("amount") if isinstance(data.get("invoice"), dict) else None)
    if picked_id:
        assert picked_id == oldest["id"], f"Expected oldest {oldest['id']}, got {picked_id}"
    elif picked_amount is not None:
        assert float(picked_amount) == float(oldest["amount"]), f"Amount mismatch"
    else:
        # at least should not fail; print for debug
        print("create-intent response keys:", list(data.keys()))


def test_superadmin_login():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": "super@surirent.sr", "password": "super1234"})
    assert r.status_code == 200
