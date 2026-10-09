"""Iteration 63: multi-invoice selection + autopay (save-card) tests.

Covers:
- POST /saas-stripe/create-intent with {all_open: True} and {invoice_ids: [...]}
- Cross-company invoice_ids → 404
- GET /billing/me/autopay structure
- PUT /billing/me/autopay enable without card → 400 Dutch
- Superadmin create subscription invoice: with autopay enabled → autopay_result 'paid' and invoice becomes paid
- With autopay disabled → autopay_result 'skipped' and invoice stays open
"""
import os
import time
import pytest
import requests
import stripe

# Allow autopay E2E setup to run even if demo had no saved card to start.
# This test performs a real Stripe test-mode charge with pm_card_visa + save-card,
# then verifies autopay auto-charges a new invoice.


BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE}/api"
SUPER = {"email": "super@surirent.sr", "password": "super1234"}
DEMO = {"email": "demo@surirent.sr", "password": "demo1234"}
DEMO_COMPANY_ID = "demo-company-fixed-uuid-00000000000"
SK = os.environ.get("STRIPE_SECRET_KEY") or ""


def _login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=60)
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


# ─── GET autopay structure ────────────────────────────────────────────────
class TestAutopayGet:
    def test_get_autopay_structure(self, demo_tok):
        r = requests.get(f"{API}/billing/me/autopay", headers=_auth(demo_tok), timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        for k in ("enabled", "has_card"):
            assert k in j
        assert isinstance(j["enabled"], bool)
        assert isinstance(j["has_card"], bool)
        if j["has_card"]:
            assert j.get("card") is not None
            for k in ("brand", "last4", "exp_month", "exp_year"):
                assert k in j["card"]
        print(f"autopay state: enabled={j['enabled']} has_card={j['has_card']} card={j.get('card')}")


# ─── create-intent all_open / invoice_ids / cross-company ─────────────────
class TestCreateIntentMulti:
    def test_all_open_returns_invoices_array(self, demo_tok):
        r = requests.post(f"{API}/saas-stripe/create-intent",
                          json={"all_open": True, "method": "card"},
                          headers=_auth(demo_tok), timeout=30)
        if r.status_code == 404:
            pytest.skip("No open invoices for demo company")
        assert r.status_code == 200, r.text
        j = r.json()
        assert isinstance(j.get("invoices"), list) and len(j["invoices"]) >= 1
        assert "total_amount" in j and j["total_amount"] > 0
        assert "can_save_card" in j
        assert j["can_save_card"] is True  # demo = company admin, card method
        # total matches sum of invoice amounts
        s = sum(float(i["amount"]) for i in j["invoices"])
        assert abs(s - j["total_amount"]) < 0.01
        print(f"all_open: {len(j['invoices'])} invoices total={j['total_amount']}")

    def test_invoice_ids_selection(self, demo_tok):
        inv_list = requests.get(f"{API}/billing/me/invoices", headers=_auth(demo_tok), timeout=15).json()
        open_ids = [i["id"] for i in inv_list if i.get("status") not in ("paid", "superseded", "cancelled", "void")]
        if not open_ids:
            pytest.skip("No open invoices")
        r = requests.post(f"{API}/saas-stripe/create-intent",
                          json={"invoice_ids": open_ids[:1], "method": "card"},
                          headers=_auth(demo_tok), timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        assert len(j["invoices"]) == 1
        assert j["invoices"][0]["id"] == open_ids[0]

    def test_cross_company_invoice_ids_404(self, demo_tok, super_tok):
        rows = requests.get(f"{API}/superadmin/client-payment-status",
                            headers=_auth(super_tok), timeout=15).json()
        other = next((r for r in rows if r.get("company_id") != DEMO_COMPANY_ID and r.get("last_invoice")), None)
        if not other:
            pytest.skip("No other-company invoice available")
        other_id = other["last_invoice"]["id"]
        r = requests.post(f"{API}/saas-stripe/create-intent",
                          json={"invoice_ids": [other_id], "method": "card"},
                          headers=_auth(demo_tok), timeout=15)
        # company_id filter forces 404 since the id doesn't belong to demo
        assert r.status_code == 404, r.text


# ─── Autopay PUT without card → 400 Dutch ─────────────────────────────────
class TestAutopayToggleRequiresCard:
    def test_enable_autopay_without_card_fails(self, super_tok):
        """Use a company guaranteed to not have autopay by using super context after creating
        a fresh test: skip if too complex. Instead: temporarily remove demo autopay? That
        would break other tests. Use a safer check: GET first, if demo has card we can't
        test this cleanly without disrupting state."""
        # Alternative: try with demo. If demo has card, this test skips.
        s = requests.Session()
        s.post(f"{API}/auth/login", json=DEMO)
        ap = s.get(f"{API}/billing/me/autopay").json()
        if ap.get("has_card"):
            pytest.skip("Demo already has saved card — cannot test no-card error path without disrupting state")
        r = s.put(f"{API}/billing/me/autopay", json={"enabled": True})
        assert r.status_code == 400
        body = r.text.lower()
        assert "kaart" in body or "card" in body


# ─── E2E: pay+save card then autopay a new invoice ────────────────────────
class TestAutopayE2E:
    def test_e2e_save_card_then_autopay_new_invoice(self, super_tok, demo_tok):
        """Create PI → toggle save-card ON → stripe.confirm(pm_card_visa) →
        poll paid → autopay now has_card → create new invoice → auto-charged."""
        if not SK:
            pytest.skip("No STRIPE_SECRET_KEY")

        ap0 = requests.get(f"{API}/billing/me/autopay", headers=_auth(demo_tok), timeout=15).json()

        # If no card is saved, go through the save-card flow using existing open invoice.
        if not ap0.get("has_card"):
            # Find an existing open invoice (don't create — autopay may be disabled, that's fine)
            invs = requests.get(f"{API}/billing/me/invoices", headers=_auth(demo_tok), timeout=15).json()
            open_invs = [i for i in invs if i.get("status") not in ("paid", "superseded", "cancelled", "void")]
            if not open_invs:
                # Create one via superadmin — autopay is disabled so it stays open
                r = requests.post(f"{API}/superadmin/subscription-invoices",
                                  json={"company_id": DEMO_COMPANY_ID, "amount": 500, "currency": "SRD",
                                        "note": "TEST_setup_iter63"},
                                  headers=_auth(super_tok), timeout=30)
                assert r.status_code == 200, r.text
            # Create intent
            ci = requests.post(f"{API}/saas-stripe/create-intent",
                               json={"method": "card"}, headers=_auth(demo_tok), timeout=30)
            assert ci.status_code == 200, ci.text
            cij = ci.json()
            pi_id = cij["payment_intent_id"]
            # Toggle save-card ON
            sv = requests.post(f"{API}/saas-stripe/intent-save-card",
                               json={"payment_intent_id": pi_id, "save": True},
                               headers=_auth(demo_tok), timeout=15)
            assert sv.status_code == 200, sv.text
            # Confirm with Stripe pm_card_visa
            stripe.api_key = SK
            confirmed = stripe.PaymentIntent.confirm(pi_id, payment_method="pm_card_visa")
            assert confirmed.status in ("succeeded", "requires_action"), confirmed.status
            # Poll backend intent-status
            for _ in range(20):
                s = requests.get(f"{API}/saas-stripe/intent-status/{pi_id}", timeout=15).json()
                if s["status"] == "paid":
                    break
                time.sleep(1)
            assert s["status"] == "paid", f"intent not paid: {s}"

        # Confirm autopay now has card
        ap1 = requests.get(f"{API}/billing/me/autopay", headers=_auth(demo_tok), timeout=15).json()
        assert ap1["has_card"], f"card not saved: {ap1}"
        assert ap1["card"]["last4"] == "4242", ap1
        assert ap1["card"]["brand"] in ("visa", "Visa"), ap1
        print(f"autopay set up: {ap1}")

        # Ensure autopay is enabled
        s = requests.Session(); s.post(f"{API}/auth/login", json=DEMO)
        if not ap1.get("enabled"):
            e = s.put(f"{API}/billing/me/autopay", json={"enabled": True})
            assert e.status_code == 200, e.text

        # Now create a new invoice via superadmin — should auto-charge
        r = requests.post(f"{API}/superadmin/subscription-invoices",
                          json={"company_id": DEMO_COMPANY_ID, "amount": 1000, "currency": "SRD",
                                "note": "TEST_autopay_charge_iter63"},
                          headers=_auth(super_tok), timeout=60)
        assert r.status_code == 200, r.text
        inv = r.json()
        assert inv.get("autopay_result") == "paid", f"expected paid, got {inv.get('autopay_result')} inv={inv}"
        # Verify persisted
        time.sleep(1)
        allinv = requests.get(f"{API}/billing/me/invoices", headers=_auth(demo_tok), timeout=15).json()
        m = next((i for i in allinv if i["id"] == inv["id"]), None)
        assert m is not None and m["status"] == "paid", f"invoice not paid: {m}"
        pays = requests.get(f"{API}/billing/me/payments", headers=_auth(demo_tok), timeout=15).json()
        pay = next((p for p in pays if p.get("invoice_id") == inv["id"]), None)
        assert pay is not None
        assert "Automatisch afgeschreven" in (pay.get("note") or ""), pay

    def test_autopay_skipped_when_disabled(self, super_tok, demo_tok):
        ap = requests.get(f"{API}/billing/me/autopay", headers=_auth(demo_tok), timeout=15).json()
        if not ap.get("has_card"):
            pytest.skip("No card — skip disabled-path test")
        s = requests.Session(); s.post(f"{API}/auth/login", json=DEMO)
        was_enabled = ap.get("enabled")
        d = s.put(f"{API}/billing/me/autopay", json={"enabled": False})
        assert d.status_code == 200, d.text
        try:
            r = requests.post(f"{API}/superadmin/subscription-invoices",
                              json={"company_id": DEMO_COMPANY_ID, "amount": 1234, "currency": "SRD",
                                    "note": "TEST_autopay_disabled_iter63"},
                              headers=_auth(super_tok), timeout=30)
            assert r.status_code == 200, r.text
            inv = r.json()
            assert inv["autopay_result"] == "skipped", f"expected skipped, got {inv['autopay_result']}"
            invs = s.get(f"{API}/billing/me/invoices").json()
            m = next((i for i in invs if i["id"] == inv["id"]), None)
            assert m is not None and m["status"] != "paid", f"invoice unexpectedly paid: {m}"
        finally:
            if was_enabled:
                s.put(f"{API}/billing/me/autopay", json={"enabled": True})


class _Unused:
    def _old_test_create_invoice_with_autopay_enabled(self, super_tok, demo_tok):
        """If demo has autopay enabled + card, new superadmin invoice should auto-charge."""
        ap = requests.get(f"{API}/billing/me/autopay", headers=_auth(demo_tok), timeout=10).json()
        if not (ap.get("enabled") and ap.get("has_card")):
            pytest.skip("Autopay not configured on demo — cannot test paid-path")
        r = requests.post(f"{API}/superadmin/subscription-invoices",
                          json={"company_id": DEMO_COMPANY_ID, "amount": 1000, "currency": "SRD",
                                "note": "TEST_autopay_iter63"},
                          headers=_auth(super_tok), timeout=60)
        assert r.status_code == 200, r.text
        inv = r.json()
        assert "autopay_result" in inv
        print(f"autopay_result={inv['autopay_result']} status={inv.get('status')}")
        assert inv["autopay_result"] == "paid", f"expected paid, got {inv['autopay_result']}"
        # Fetch invoice to confirm it was marked paid
        time.sleep(1)
        all_inv = requests.get(f"{API}/billing/me/invoices", headers=_auth(demo_tok), timeout=15).json()
        matched = next((i for i in all_inv if i["id"] == inv["id"]), None)
        assert matched is not None
        assert matched["status"] == "paid", f"invoice not paid: {matched['status']}"
        # And a subscription_payment exists with Dutch note
        pays = requests.get(f"{API}/billing/me/payments", headers=_auth(demo_tok), timeout=15).json()
        pay = next((p for p in pays if p.get("invoice_id") == inv["id"]), None)
        assert pay is not None
        assert "Automatisch afgeschreven" in (pay.get("note") or "")

    def test_create_invoice_with_autopay_disabled_stays_open(self, super_tok, demo_tok):
        """Disable autopay (PUT enabled=false), create invoice → stays open, result=skipped. Then re-enable."""
        s = requests.Session()
        s.post(f"{API}/auth/login", json=DEMO)
        ap_before = s.get(f"{API}/billing/me/autopay").json()
        was_enabled = ap_before.get("enabled")
        if not ap_before.get("has_card"):
            pytest.skip("No card saved — pointless test")
        # Disable
        d = s.put(f"{API}/billing/me/autopay", json={"enabled": False})
        assert d.status_code == 200, d.text
        try:
            r = requests.post(f"{API}/superadmin/subscription-invoices",
                              json={"company_id": DEMO_COMPANY_ID, "amount": 1234, "currency": "SRD",
                                    "note": "TEST_autopay_disabled_iter63"},
                              headers=_auth(super_tok), timeout=30)
            assert r.status_code == 200, r.text
            inv = r.json()
            assert inv["autopay_result"] == "skipped", f"expected skipped, got {inv['autopay_result']}"
            # Verify still open
            invs = s.get(f"{API}/billing/me/invoices").json()
            m = next((i for i in invs if i["id"] == inv["id"]), None)
            assert m is not None
            assert m["status"] != "paid", f"invoice unexpectedly paid: {m['status']}"
        finally:
            # Restore
            if was_enabled:
                s.put(f"{API}/billing/me/autopay", json={"enabled": True})
