"""Iteration 59: SaaS Stripe custom checkout tests."""
import os
import time
import hmac
import json
import hashlib
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://vastgoed-app.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

SUPER = {"email": "super@surirent.sr", "password": "super1234"}
DEMO = {"email": "demo@surirent.sr", "password": "demo1234"}

OPEN_INVOICES = [
    "900d94b3-a9c9-40cc-9b94-70cdb57827a8",
    "bc048668-2e8d-4cb6-980f-6b0545121e04",
    "64478e51-2604-4253-84b9-59827862854a",
    "c13126c7-e10b-45af-8118-f16f59286998",
]
PAID_INVOICE = "414c9e05-dbe0-40f4-b167-ab23c2bc2b3d"

WEBHOOK_SECRET = "whsec_hFPR36QUaX16qZDydd7Tvnn4KrV1zrzO"


def _login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=15)
    assert r.status_code == 200, r.text
    return r.json().get("access_token") or r.json().get("token")


@pytest.fixture(scope="module")
def super_token():
    return _login(SUPER)


@pytest.fixture(scope="module")
def demo_token():
    return _login(DEMO)


def auth(tok):
    return {"Authorization": f"Bearer {tok}"}


# ─── create-intent ──────────────────────────────────────────────────────────
class TestCreateIntent:
    def test_create_intent_superadmin(self, super_token):
        r = requests.post(f"{API}/saas-stripe/create-intent",
                          json={"invoice_id": OPEN_INVOICES[0]},
                          headers=auth(super_token), timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("client_secret", "").startswith("pi_")
        assert j.get("payment_intent_id", "").startswith("pi_")
        assert isinstance(j.get("amount_eur_cents"), int)
        assert j["amount_eur_cents"] >= 50
        assert j.get("publishable_key", "").startswith("pk_")

    def test_create_intent_unknown_invoice(self, super_token):
        r = requests.post(f"{API}/saas-stripe/create-intent",
                          json={"invoice_id": "does-not-exist-xyz"},
                          headers=auth(super_token), timeout=15)
        assert r.status_code == 404

    def test_create_intent_already_paid(self, super_token):
        r = requests.post(f"{API}/saas-stripe/create-intent",
                          json={"invoice_id": PAID_INVOICE},
                          headers=auth(super_token), timeout=15)
        assert r.status_code == 400

    def test_create_intent_non_superadmin(self, demo_token):
        r = requests.post(f"{API}/saas-stripe/create-intent",
                          json={"invoice_id": OPEN_INVOICES[0]},
                          headers=auth(demo_token), timeout=15)
        assert r.status_code in (401, 403)

    def test_create_intent_unauthenticated(self):
        r = requests.post(f"{API}/saas-stripe/create-intent",
                          json={"invoice_id": OPEN_INVOICES[0]}, timeout=15)
        assert r.status_code in (401, 403)


# ─── intent-status ──────────────────────────────────────────────────────────
class TestIntentStatus:
    def test_intent_status_pending(self, super_token):
        c = requests.post(f"{API}/saas-stripe/create-intent",
                          json={"invoice_id": OPEN_INVOICES[1]},
                          headers=auth(super_token), timeout=30).json()
        pi = c["payment_intent_id"]
        r = requests.get(f"{API}/saas-stripe/intent-status/{pi}", timeout=15)
        assert r.status_code == 200
        j = r.json()
        assert j["payment_intent_id"] == pi
        assert j["status"] in ("pending", "requires_payment_method", "requires_confirmation")

    def test_intent_status_unknown(self):
        r = requests.get(f"{API}/saas-stripe/intent-status/pi_unknown_xxx", timeout=15)
        assert r.status_code == 404


# ─── webhook ────────────────────────────────────────────────────────────────
def _sign(payload_bytes: bytes, secret: str, ts: int | None = None) -> str:
    ts = ts or int(time.time())
    signed = f"{ts}.{payload_bytes.decode()}".encode()
    v1 = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    return f"t={ts},v1={v1}"


class TestWebhook:
    def test_webhook_bad_signature(self):
        r = requests.post(f"{API}/saas-stripe/webhook",
                          data=b'{"object":"event","type":"ping"}',
                          headers={"stripe-signature": "t=1,v1=bad", "Content-Type": "application/json"},
                          timeout=15)
        assert r.status_code == 400

    def test_webhook_missing_signature(self):
        r = requests.post(f"{API}/saas-stripe/webhook",
                          data=b'{"object":"event","type":"ping"}', timeout=15)
        assert r.status_code == 400

    def test_webhook_signed_payment_intent_succeeded(self, super_token):
        # Create intent for third open invoice
        c = requests.post(f"{API}/saas-stripe/create-intent",
                          json={"invoice_id": OPEN_INVOICES[2]},
                          headers=auth(super_token), timeout=30).json()
        pi_id = c["payment_intent_id"]
        payload = json.dumps({
            "id": "evt_test_webhook",
            "object": "event",
            "type": "payment_intent.succeeded",
            "data": {"object": {"id": pi_id, "object": "payment_intent", "status": "succeeded"}},
        }).encode()
        sig = _sign(payload, WEBHOOK_SECRET)
        r = requests.post(f"{API}/saas-stripe/webhook", data=payload,
                          headers={"stripe-signature": sig, "Content-Type": "application/json"},
                          timeout=15)
        assert r.status_code == 200, r.text
        # Verify status flipped
        s = requests.get(f"{API}/saas-stripe/intent-status/{pi_id}", timeout=15).json()
        assert s["status"] == "paid"

    def test_webhook_signed_payment_failed(self, super_token):
        c = requests.post(f"{API}/saas-stripe/create-intent",
                          json={"invoice_id": OPEN_INVOICES[3]},
                          headers=auth(super_token), timeout=30).json()
        pi_id = c["payment_intent_id"]
        payload = json.dumps({
            "id": "evt_test_fail",
            "object": "event",
            "type": "payment_intent.payment_failed",
            "data": {"object": {"id": pi_id, "object": "payment_intent",
                                "last_payment_error": {"message": "card_declined"}}},
        }).encode()
        sig = _sign(payload, WEBHOOK_SECRET)
        r = requests.post(f"{API}/saas-stripe/webhook", data=payload,
                          headers={"stripe-signature": sig, "Content-Type": "application/json"},
                          timeout=15)
        assert r.status_code == 200


# ─── client-payment-status ──────────────────────────────────────────────────
class TestClientPaymentStatus:
    def test_requires_superadmin(self, demo_token):
        r = requests.get(f"{API}/superadmin/client-payment-status",
                         headers=auth(demo_token), timeout=15)
        assert r.status_code in (401, 403)

    def test_superadmin_list(self, super_token):
        r = requests.get(f"{API}/superadmin/client-payment-status",
                         headers=auth(super_token), timeout=30)
        assert r.status_code == 200
        rows = r.json()
        assert isinstance(rows, list)
        if rows:
            row = rows[0]
            assert "company_id" in row
            assert "name" in row
            assert "billing_status" in row
        # After our webhook payment, at least one company should have method 'stripe'
        methods = [r.get("last_payment", {}).get("method") for r in rows if r.get("last_payment")]
        assert "stripe" in methods, f"Expected stripe method in {methods}"
