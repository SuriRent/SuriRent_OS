"""Iter 64 — Company Stripe settings + kiosk Stripe payments (card/iDEAL).

Covers:
 - Removal of public vastgoed-app endpoints (landing/login/woningen) → 404/405
 - GET/PUT /api/company/stripe-config (admin only; kiosk/tenant forbidden)
 - POST /api/company/stripe-config/test connects
 - POST /api/kiosk/payments: method=creditcard without PI → 400; unpaid PI → 400;
   double-booking paid PI → 409
"""
import os
import time
import pytest
import requests
import stripe

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://vastgoed-app.preview.emergentagent.com").rstrip("/")
API = f"{BASE}/api"
STRIPE_SECRET = os.environ.get("STRIPE_SECRET_KEY") or ""


# ─── Fixtures ────────────────────────────────────────────────────────────────
@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={"email": "demo@surirent.sr", "password": "demo1234"})
    assert r.status_code == 200, r.text
    return r.json().get("access_token") or r.json().get("token")


@pytest.fixture(scope="session")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="session")
def kiosk_token():
    r = requests.post(f"{API}/auth/kiosk-pin", json={"pin": "4321", "company_slug": "my-awesome-rentals-bv"})
    assert r.status_code == 200, r.text
    data = r.json()
    return data.get("kiosk_token") or data.get("access_token") or data.get("token")


@pytest.fixture(scope="session")
def kiosk_headers(kiosk_token):
    return {"Authorization": f"Bearer {kiosk_token}"}


@pytest.fixture(scope="session")
def demo_tenant_id(kiosk_headers):
    # kiosk tenants are reachable via /kiosk/apartments → each has active tenant
    r = requests.get(f"{API}/kiosk/apartments", headers=kiosk_headers)
    assert r.status_code == 200, r.text
    arr = r.json() if isinstance(r.json(), list) else r.json().get("apartments", [])
    for a in arr:
        t = a.get("tenant") or {}
        tid = t.get("id") or a.get("tenant_id")
        if tid:
            return tid
    pytest.skip("no kiosk tenant available")


# ─── Public vastgoed-app endpoints removed ──────────────────────────────────
class TestPublicVastgoedAppRemoved:
    @pytest.mark.parametrize("path", [
        "/public/vastgoed-app/landing",
        "/public/vastgoed-app/login",
        "/public/vastgoed-app/woningen",
    ])
    def test_removed(self, path):
        r = requests.get(f"{API}{path}")
        assert r.status_code in (404, 405), f"{path} expected 404/405 got {r.status_code}"


# ─── Company stripe config (admin only) ──────────────────────────────────────
class TestCompanyStripeConfig:
    def test_requires_auth(self):
        r = requests.get(f"{API}/company/stripe-config")
        assert r.status_code in (401, 403)

    def test_kiosk_rejected(self, kiosk_headers):
        r = requests.get(f"{API}/company/stripe-config", headers=kiosk_headers)
        assert r.status_code in (401, 403)

    def test_get_admin_ok(self, admin_headers):
        r = requests.get(f"{API}/company/stripe-config", headers=admin_headers)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["mode"] in ("test", "live")
        assert "test" in d and "live" in d
        # secret must never be exposed in full
        assert "secret_key" not in d["test"]
        assert d["test"].get("secret_key_set") in (True, False)
        if d["test"].get("secret_key_set"):
            masked = d["test"].get("secret_key_masked", "")
            assert "..." in masked or "*" in masked or len(masked) < 40

    def test_put_live_without_keys_dutch_error(self, admin_headers):
        # Switch to live without providing live keys → Dutch error
        r = requests.put(f"{API}/company/stripe-config", headers=admin_headers,
                         json={"mode": "live", "card": True, "ideal": True})
        assert r.status_code == 400
        assert "live" in r.text.lower()

    def test_test_connection(self, admin_headers):
        r = requests.post(f"{API}/company/stripe-config/test", headers=admin_headers)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("ok") is True
        assert d.get("mode") == "test"

    def test_leave_in_test_mode_both_on(self, admin_headers):
        # Ensure final state as requested: TEST mode, both methods ON
        r = requests.put(f"{API}/company/stripe-config", headers=admin_headers,
                         json={"mode": "test", "card": True, "ideal": True})
        assert r.status_code == 200, r.text
        assert r.json().get("enabled") is True
        g = requests.get(f"{API}/company/stripe-config", headers=admin_headers).json()
        assert g["mode"] == "test" and g["card"] is True and g["ideal"] is True


# ─── Kiosk Stripe intent + payments ──────────────────────────────────────────
class TestKioskStripePayments:
    def test_kiosk_stripe_config(self, kiosk_headers):
        r = requests.get(f"{API}/kiosk/stripe/config", headers=kiosk_headers)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["enabled"] is True
        assert "card" in d["methods"] and "ideal" in d["methods"]
        assert d["mode"] == "test"

    def test_creditcard_without_pi_rejected(self, kiosk_headers, demo_tenant_id):
        r = requests.post(f"{API}/kiosk/payments", headers=kiosk_headers, json={
            "tenant_id": demo_tenant_id, "amount": 100, "currency": "SRD", "method": "creditcard",
        })
        assert r.status_code == 400
        assert "stripe" in r.text.lower()

    def test_unpaid_pi_rejected(self, kiosk_headers, demo_tenant_id):
        # Create intent but don't pay
        r = requests.post(f"{API}/kiosk/stripe/intent", headers=kiosk_headers, json={
            "tenant_id": demo_tenant_id, "amount": 100, "currency": "SRD", "method": "card",
        })
        assert r.status_code == 200, r.text
        pi_id = r.json()["payment_intent_id"]
        r2 = requests.post(f"{API}/kiosk/payments", headers=kiosk_headers, json={
            "tenant_id": demo_tenant_id, "amount": 100, "currency": "SRD",
            "method": "creditcard", "stripe_payment_intent_id": pi_id,
        })
        assert r2.status_code == 400
        assert "nog niet voltooid" in r2.text.lower() or "niet voltooid" in r2.text.lower()

    def test_paid_pi_books_then_double_books_409(self, kiosk_headers, demo_tenant_id):
        assert STRIPE_SECRET, "need STRIPE_SECRET_KEY to confirm PI"
        stripe.api_key = STRIPE_SECRET
        # 1) intent
        r = requests.post(f"{API}/kiosk/stripe/intent", headers=kiosk_headers, json={
            "tenant_id": demo_tenant_id, "amount": 50, "currency": "SRD", "method": "card",
        })
        assert r.status_code == 200, r.text
        intent = r.json()
        pi_id = intent["payment_intent_id"]
        client_secret = intent["client_secret"]
        # 2) confirm with pm_card_visa
        confirmed = stripe.PaymentIntent.confirm(
            pi_id, payment_method="pm_card_visa", return_url="https://example.com/return",
        )
        # Wait briefly if async
        for _ in range(10):
            if confirmed.status == "succeeded":
                break
            time.sleep(0.5)
            confirmed = stripe.PaymentIntent.retrieve(pi_id)
        assert confirmed.status == "succeeded", f"PI status={confirmed.status}"
        # 3) book
        amount = intent.get("amount") or 50
        r1 = requests.post(f"{API}/kiosk/payments", headers=kiosk_headers, json={
            "tenant_id": demo_tenant_id, "amount": 50, "currency": "SRD",
            "method": "creditcard", "stripe_payment_intent_id": pi_id,
        })
        assert r1.status_code in (200, 201), r1.text
        pay = r1.json()
        assert pay.get("status") == "approved"
        assert pay.get("method") == "creditcard"
        # 4) double-book → 409
        r2 = requests.post(f"{API}/kiosk/payments", headers=kiosk_headers, json={
            "tenant_id": demo_tenant_id, "amount": 50, "currency": "SRD",
            "method": "creditcard", "stripe_payment_intent_id": pi_id,
        })
        assert r2.status_code == 409
        assert "al geboekt" in r2.text.lower()
