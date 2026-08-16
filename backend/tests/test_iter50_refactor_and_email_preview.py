"""
Iteration 50 tests:
- New endpoint: POST /api/settings/email/preview (white-label preview)
- Regressions after refactor: models.py + auth_utils.py extraction from server.py
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"

DEMO = {"email": "demo@surirent.sr", "password": "demo1234"}
ADMIN = {"email": "admin@vastgoed.sr", "password": "admin123"}


def _login(payload):
    r = requests.post(f"{API}/auth/login", json=payload, timeout=20)
    assert r.status_code == 200, f"login failed {r.status_code}: {r.text[:200]}"
    data = r.json()
    tok = data.get("token") or data.get("access_token")
    assert tok, f"no token in response: {data}"
    return tok


@pytest.fixture(scope="module")
def demo_token():
    return _login(DEMO)


@pytest.fixture(scope="module")
def admin_token():
    return _login(ADMIN)


# --------- Auth regressions (auth_utils extraction) ---------
class TestAuthRegression:
    def test_demo_login(self):
        tok = _login(DEMO)
        assert isinstance(tok, str) and len(tok) > 20

    def test_admin_login(self):
        tok = _login(ADMIN)
        assert isinstance(tok, str) and len(tok) > 20

    def test_auth_me(self, demo_token):
        r = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {demo_token}"}, timeout=15)
        assert r.status_code == 200, r.text[:200]
        me = r.json()
        assert me.get("email") == DEMO["email"]

    def test_register_new_user(self):
        uid = uuid.uuid4().hex[:8]
        payload = {
            "name": f"Tester {uid}",
            "email": f"tester_{uid}@example.com",
            "password": "Test1234!",
            "company_name": f"Test Co {uid}",
            "slug": f"testco-{uid}",
        }
        r = requests.post(f"{API}/auth/register", json=payload, timeout=25)
        # Accept 200 or 201
        assert r.status_code in (200, 201), f"{r.status_code}: {r.text[:300]}"
        data = r.json()
        tok = data.get("token") or data.get("access_token")
        assert tok, f"no token: {data}"


# --------- Models regressions ---------
class TestModelsRegression:
    def test_tenants_list(self, demo_token):
        r = requests.get(f"{API}/tenants", headers={"Authorization": f"Bearer {demo_token}"}, timeout=15)
        assert r.status_code == 200, r.text[:200]
        assert isinstance(r.json(), list)

    def test_apartments_list(self, demo_token):
        r = requests.get(f"{API}/apartments", headers={"Authorization": f"Bearer {demo_token}"}, timeout=15)
        assert r.status_code == 200, r.text[:200]
        assert isinstance(r.json(), list)


# --------- Kiosk (PinIn model + kiosk auth) ---------
class TestKiosk:
    def test_kiosk_pin_login(self):
        # PinIn model is used by /api/auth/kiosk-pin (branded PIN login).
        # Demo company slug is 'demo' (seeded). If not, try surirent.
        for slug in ("demo", "surirent", "demo-vastgoed"):
            r = requests.post(
                f"{API}/auth/kiosk-pin",
                json={"pin": "1234", "company_slug": slug},
                timeout=15,
            )
            if r.status_code == 200:
                data = r.json()
                assert data.get("token"), f"missing kiosk token: {data}"
                return
        # If none matched, at least verify the endpoint exists (not 404)
        assert r.status_code != 404, "kiosk-pin endpoint missing (PinIn import regression?)"
        assert r.status_code != 500, f"kiosk-pin 500: {r.text[:200]}"
        pytest.skip(f"No known slug matched PIN 1234; last status={r.status_code}")


# --------- New endpoint: email preview ---------
class TestEmailPreview:
    @pytest.mark.parametrize("kind", ["kwitantie", "factuur", "contract", "herinnering"])
    def test_preview_custom_brand(self, demo_token, kind):
        r = requests.post(
            f"{API}/settings/email/preview",
            json={"brand_name": "Acme Vastgoed", "brand_color": "#3B82F6", "kind": kind},
            headers={"Authorization": f"Bearer {demo_token}"},
            timeout=20,
        )
        assert r.status_code == 200, f"{kind}: {r.status_code} {r.text[:300]}"
        data = r.json()
        html = data.get("html", "")
        assert isinstance(html, str) and len(html) > 20, f"empty html for {kind}"
        assert "SuriRent" not in html, f"[{kind}] html still contains 'SuriRent'"
        assert "Acme Vastgoed" in html, f"[{kind}] html missing brand name"
        assert "#3B82F6" in html or "3B82F6" in html, f"[{kind}] html missing brand color"

    def test_preview_defaults_empty_body(self, demo_token):
        r = requests.post(
            f"{API}/settings/email/preview",
            json={},
            headers={"Authorization": f"Bearer {demo_token}"},
            timeout=20,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text[:300]}"
        html = r.json().get("html", "")
        assert isinstance(html, str) and len(html) > 20
        assert "SuriRent" not in html, "default preview must not leak SuriRent brand"


# --------- SMTP test regression ---------
class TestSmtpRegression:
    def test_smtp_test_not_500(self, demo_token):
        r = requests.post(
            f"{API}/settings/smtp/test",
            headers={"Authorization": f"Bearer {demo_token}"},
            json={},
            timeout=25,
        )
        assert r.status_code != 500, f"SMTP test returned 500: {r.text[:300]}"
        # Accept 200 (sent) or 400 (disabled/misconfigured)
        assert r.status_code in (200, 400), f"unexpected {r.status_code}: {r.text[:300]}"
        if r.status_code == 200:
            body = r.text
            assert "SuriRent" not in body, "SMTP test success body should not mention SuriRent"


# --------- Tenant email/message routes exist (no 500 due to import) ---------
class TestTenantEmailRoutesExist:
    def test_email_payment_route_no_500(self, demo_token):
        # Use a bogus id — should be 400/404, never 500
        r = requests.post(
            f"{API}/email/payment/nonexistent-id",
            headers={"Authorization": f"Bearer {demo_token}"},
            json={},
            timeout=15,
        )
        assert r.status_code != 500, f"import/route regression: {r.status_code} {r.text[:200]}"
        assert r.status_code in (400, 404, 422), f"unexpected {r.status_code}: {r.text[:200]}"

    def test_message_payment_route_no_500(self, demo_token):
        r = requests.post(
            f"{API}/message/payment/nonexistent-id",
            headers={"Authorization": f"Bearer {demo_token}"},
            json={},
            timeout=15,
        )
        assert r.status_code != 500, f"import/route regression: {r.status_code} {r.text[:200]}"
        assert r.status_code in (400, 404, 422), f"unexpected {r.status_code}: {r.text[:200]}"
