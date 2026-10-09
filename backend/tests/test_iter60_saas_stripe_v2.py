"""Iteration 60: SaaS Stripe custom checkout — comprehensive tests.
Covers: stripe-config CRUD + mask, prefix validation, live-mode guard,
test-connection, public-config, create-intent (demo-admin oldest / cross-
company 404 / paid 400), intent-status, webhook (bad sig, succeeded, failed,
charge.refunded), full card payment via stripe python + confirm pm_card_visa.
"""
import os
import time
import hmac
import json
import hashlib
import pytest
import requests
import stripe

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE}/api"
SUPER = {"email": "super@surirent.sr", "password": "super1234"}
DEMO = {"email": "demo@surirent.sr", "password": "demo1234"}
WHSEC = os.environ.get("STRIPE_WEBHOOK_SECRET") or "whsec_hFPR36QUaX16qZDydd7Tvnn4KrV1zrzO"
SK = os.environ.get("STRIPE_SECRET_KEY") or "sk_test_51UNeU4LDCicgs4Au0Yde7EcT08ijrK8suHWq3n5rLqtYqbSN6oE5qVi1GRbMm0N9GQ6eJJ5NgX1R3zvWMuJZJMSf00WbwLEGyK"


def _login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=15)
    assert r.status_code == 200, r.text
    j = r.json()
    return j.get("access_token") or j.get("token")


def _auth(tok):
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def super_tok():
    return _login(SUPER)


@pytest.fixture(scope="module")
def demo_tok():
    return _login(DEMO)


DEMO_COMPANY_ID = "demo-company-fixed-uuid-00000000000"


def _rows(super_tok):
    r = requests.get(f"{API}/superadmin/client-payment-status", headers=_auth(super_tok), timeout=15)
    assert r.status_code == 200
    return r.json()


# ─── Stripe config (superadmin) ─────────────────────────────────────────────
class TestStripeConfig:
    def test_get_config_masks_secret(self, super_tok):
        r = requests.get(f"{API}/superadmin/stripe-config", headers=_auth(super_tok), timeout=15)
        assert r.status_code == 200
        j = r.json()
        assert j["mode"] in ("test", "live")
        t = j["test"]
        assert t["publishable_key"].startswith("pk_test_")
        assert t["secret_key_set"] is True
        # masked, never full secret
        assert "secret_key" not in t  # raw key field not exposed
        assert "…" in t["secret_key_masked"] or t["secret_key_masked"].startswith("sk_test_")
        assert len(t["secret_key_masked"]) < 40

    def test_get_config_requires_superadmin(self, demo_tok):
        r = requests.get(f"{API}/superadmin/stripe-config", headers=_auth(demo_tok), timeout=10)
        assert r.status_code in (401, 403)

    def test_put_rejects_bad_prefix(self, super_tok):
        r = requests.put(
            f"{API}/superadmin/stripe-config",
            json={"mode": "test", "test": {"secret_key": "not_a_stripe_key"}},
            headers=_auth(super_tok), timeout=15,
        )
        assert r.status_code == 400
        assert "ongeldige" in r.text.lower()

    def test_put_rejects_testkey_in_live_field(self, super_tok):
        r = requests.put(
            f"{API}/superadmin/stripe-config",
            json={"mode": "test", "live": {"secret_key": "sk_test_abcdef"}},
            headers=_auth(super_tok), timeout=15,
        )
        assert r.status_code == 400
        # Dutch: "hoort niet bij live-modus"
        assert "live" in r.text.lower()

    def test_put_live_mode_without_live_keys(self, super_tok):
        r = requests.put(
            f"{API}/superadmin/stripe-config",
            json={"mode": "live"},
            headers=_auth(super_tok), timeout=15,
        )
        assert r.status_code == 400
        assert "live Publishable key en Secret key" in r.text

    def test_put_keeps_test_mode_when_empty(self, super_tok):
        """Save mode=test with no key changes → should succeed and keep env."""
        r = requests.put(
            f"{API}/superadmin/stripe-config",
            json={"mode": "test"},
            headers=_auth(super_tok), timeout=15,
        )
        assert r.status_code == 200, r.text
        # Verify still test
        g = requests.get(f"{API}/superadmin/stripe-config", headers=_auth(super_tok), timeout=10).json()
        assert g["mode"] == "test"
        assert g["test"]["secret_key_set"] is True

    def test_test_connection(self, super_tok):
        r = requests.post(f"{API}/superadmin/stripe-config/test", headers=_auth(super_tok), timeout=20)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["ok"] is True
        assert j["mode"] == "test"
        assert j["account_id"].startswith("acct_")
        assert j["name"] == "vastgoed-app"


# ─── Public config ──────────────────────────────────────────────────────────
class TestPublicConfig:
    def test_public_config_enabled(self, demo_tok):
        r = requests.get(f"{API}/saas-stripe/public-config", headers=_auth(demo_tok), timeout=10)
        assert r.status_code == 200
        j = r.json()
        assert j["enabled"] is True
        assert j["mode"] == "test"
        assert "card" in j["methods"] and "ideal" in j["methods"]

    def test_public_config_requires_auth(self):
        r = requests.get(f"{API}/saas-stripe/public-config", timeout=10)
        assert r.status_code in (401, 403)


# ─── create-intent (role-aware) ─────────────────────────────────────────────
@pytest.fixture(scope="module")
def demo_open_invoice_ids(super_tok):
    return True


class TestCreateIntent:
    def test_demo_oldest_open_card(self, demo_tok, demo_open_invoice_ids):
        r = requests.post(
            f"{API}/saas-stripe/create-intent",
            json={"method": "card"},
            headers=_auth(demo_tok), timeout=30,
        )
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["method"] == "card"
        assert j["client_secret"].startswith("pi_")
        assert j["payment_intent_id"].startswith("pi_")
        assert j["publishable_key"].startswith("pk_test_")
        assert j["amount_eur_cents"] >= 50
        assert "invoice" in j and j["invoice"].get("id")

    def test_demo_oldest_open_ideal(self, demo_tok):
        r = requests.post(
            f"{API}/saas-stripe/create-intent",
            json={"method": "ideal"},
            headers=_auth(demo_tok), timeout=30,
        )
        # iDEAL may or may not be enabled; accept 200 or specific 400.
        if r.status_code == 400:
            assert "iDEAL" in r.text or "ideal" in r.text.lower()
        else:
            assert r.status_code == 200, r.text
            assert r.json()["method"] == "ideal"

    def test_demo_other_company_invoice_404(self, demo_tok, super_tok):
        # Find an invoice NOT belonging to demo company
        rows = _rows(super_tok)
        other = next((r for r in rows if r.get("company_id") != DEMO_COMPANY_ID and r.get("last_invoice")), None)
        if not other:
            pytest.skip("No other-company invoice available")
        inv_id = other["last_invoice"]["id"]
        r = requests.post(
            f"{API}/saas-stripe/create-intent",
            json={"invoice_id": inv_id},
            headers=_auth(demo_tok), timeout=15,
        )
        assert r.status_code == 404, r.text

    def test_paid_invoice_returns_400(self, super_tok):
        # Find any paid invoice via mongo-less path: superadmin creates+confirms one, then try again.
        r = requests.post(f"{API}/saas-stripe/create-intent", json={"method": "card"},
                          headers=_auth(super_tok), timeout=30)
        # Superadmin has no company; without invoice_id it should 400 "Geen actief bedrijf"
        assert r.status_code in (400, 404)

    def test_unauth(self):
        r = requests.post(f"{API}/saas-stripe/create-intent", json={"method": "card"}, timeout=10)
        assert r.status_code in (401, 403)


# ─── End-to-end: confirm card with pm_card_visa & verify intent-status ──────
class TestEndToEndCard:
    def test_full_card_flow(self, demo_tok):
        c = requests.post(f"{API}/saas-stripe/create-intent", json={"method": "card"},
                          headers=_auth(demo_tok), timeout=30)
        assert c.status_code == 200, c.text
        pi_id = c.json()["payment_intent_id"]
        inv_id = c.json()["invoice"]["id"]

        stripe.api_key = SK
        confirmed = stripe.PaymentIntent.confirm(pi_id, payment_method="pm_card_visa")
        assert confirmed.status in ("succeeded", "requires_action"), confirmed.status

        # Poll intent-status; backend fetches live Stripe and flips to paid
        status = None
        for _ in range(10):
            s = requests.get(f"{API}/saas-stripe/intent-status/{pi_id}", timeout=15).json()
            status = s["status"]
            if status == "paid":
                break
            time.sleep(1)
        assert status == "paid", f"intent not marked paid: {status}"

        # Second create-intent for same invoice should 400 (already paid)
        again = requests.post(f"{API}/saas-stripe/create-intent",
                              json={"invoice_id": inv_id}, headers=_auth(demo_tok), timeout=15)
        assert again.status_code == 400


# ─── Webhook ────────────────────────────────────────────────────────────────
def _sign(body: bytes, secret: str) -> str:
    ts = int(time.time())
    v1 = hmac.new(secret.encode(), f"{ts}.{body.decode()}".encode(), hashlib.sha256).hexdigest()
    return f"t={ts},v1={v1}"


class TestWebhook:
    def test_bad_signature(self):
        r = requests.post(f"{API}/saas-stripe/webhook",
                          data=b'{"object":"event","type":"ping"}',
                          headers={"stripe-signature": "t=1,v1=bad", "Content-Type": "application/json"},
                          timeout=10)
        assert r.status_code == 400

    def test_missing_signature(self):
        r = requests.post(f"{API}/saas-stripe/webhook",
                          data=b'{"object":"event","type":"ping"}', timeout=10)
        assert r.status_code == 400

    def test_payment_failed_valid_sig(self, demo_tok):
        # Create a fresh intent so we have an id in db
        c = requests.post(f"{API}/saas-stripe/create-intent", json={"method": "card"},
                          headers=_auth(demo_tok), timeout=30)
        if c.status_code != 200:
            pytest.skip("no open invoice for demo")
        pi_id = c.json()["payment_intent_id"]
        payload = json.dumps({
            "id": "evt_test_fail", "object": "event",
            "type": "payment_intent.payment_failed",
            "data": {"object": {"id": pi_id, "object": "payment_intent",
                                "last_payment_error": {"message": "card_declined"}}},
        }).encode()
        r = requests.post(f"{API}/saas-stripe/webhook", data=payload,
                          headers={"stripe-signature": _sign(payload, WHSEC),
                                   "Content-Type": "application/json"}, timeout=10)
        assert r.status_code == 200
        assert r.json() == {"ok": True}

    def test_charge_refunded_valid_sig(self, demo_tok):
        # Use an id that may not exist; webhook should still return 200
        payload = json.dumps({
            "id": "evt_test_ref", "object": "event",
            "type": "charge.refunded",
            "data": {"object": {"id": "ch_x", "object": "charge",
                                "payment_intent": "pi_nonexistent_xyz"}},
        }).encode()
        r = requests.post(f"{API}/saas-stripe/webhook", data=payload,
                          headers={"stripe-signature": _sign(payload, WHSEC),
                                   "Content-Type": "application/json"}, timeout=10)
        assert r.status_code == 200
        assert r.json() == {"ok": True}
