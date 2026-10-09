"""Iter 65 — Kiosk payment: NO QR code; card and iDEAL go directly to payment page.

Backend verifies the contract behind the UI change in KioskStripePanel:
 - POST /api/kiosk/stripe/intent {method:'card'}  → redirect_url is None
     (frontend will render the Stripe PaymentElement form instead of QR)
 - POST /api/kiosk/stripe/intent {method:'ideal', origin:...} → redirect_url
     is a non-empty https URL on stripe.com (frontend opens the bank page
     in a new tab, no QR shown).

Regression: all 13 tests in test_iter64_company_stripe_kiosk.py still pass.
"""
import os
import pytest
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://vastgoed-app.preview.emergentagent.com").rstrip("/")
API = f"{BASE}/api"


@pytest.fixture(scope="module")
def kiosk_headers():
    r = requests.post(f"{API}/auth/kiosk-pin", json={"pin": "4321", "company_slug": "my-awesome-rentals-bv"})
    assert r.status_code == 200, r.text
    tok = r.json().get("kiosk_token") or r.json().get("token")
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def tenant_id(kiosk_headers):
    r = requests.get(f"{API}/kiosk/apartments", headers=kiosk_headers)
    assert r.status_code == 200, r.text
    arr = r.json() if isinstance(r.json(), list) else r.json().get("apartments", [])
    for a in arr:
        t = a.get("tenant") or {}
        tid = t.get("id") or a.get("tenant_id")
        if tid:
            return tid
    pytest.skip("no tenant")


class TestKioskNoQR:
    def test_card_intent_no_redirect(self, kiosk_headers, tenant_id):
        r = requests.post(f"{API}/kiosk/stripe/intent", headers=kiosk_headers, json={
            "tenant_id": tenant_id, "amount": 25, "currency": "SRD",
            "method": "card", "origin": "https://vastgoed-app.preview.emergentagent.com",
        })
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("redirect_url") in (None, ""), f"card must NOT return redirect_url (QR removed), got: {d.get('redirect_url')}"
        assert d.get("client_secret"), "card flow needs client_secret for PaymentElement"
        assert d.get("publishable_key", "").startswith("pk_test_")
        assert d.get("method") == "card"

    def test_ideal_intent_returns_redirect_url(self, kiosk_headers, tenant_id):
        r = requests.post(f"{API}/kiosk/stripe/intent", headers=kiosk_headers, json={
            "tenant_id": tenant_id, "amount": 25, "currency": "SRD",
            "method": "ideal", "origin": "https://vastgoed-app.preview.emergentagent.com",
        })
        assert r.status_code == 200, r.text
        d = r.json()
        ru = d.get("redirect_url")
        assert ru and isinstance(ru, str), "iDEAL must return non-null redirect_url"
        assert ru.startswith("https://"), ru
        assert "stripe.com" in ru, f"iDEAL redirect should go to stripe.com, got: {ru}"
        assert d.get("method") == "ideal"

    def test_ideal_without_origin_still_ok_or_graceful(self, kiosk_headers, tenant_id):
        # When origin is omitted, backend skips the auto-confirm and would return redirect_url=None.
        # This path is less common from the kiosk UI (frontend always sends origin), but must not 500.
        r = requests.post(f"{API}/kiosk/stripe/intent", headers=kiosk_headers, json={
            "tenant_id": tenant_id, "amount": 10, "currency": "SRD", "method": "ideal",
        })
        assert r.status_code in (200, 400), r.text
