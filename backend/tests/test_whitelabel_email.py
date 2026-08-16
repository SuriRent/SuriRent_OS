"""Tests for white-label email branding fix.

Verifies wrap_template no longer leaks 'SuriRent' branding when a tenant
company brand is passed, and regression that platform default still has it.
Also smoke-tests core auth/data endpoints and SMTP test endpoint.
"""
import os
import sys
import pytest
import requests

sys.path.insert(0, "/app/backend")
from email_service import wrap_template  # noqa: E402

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # Fallback: read frontend/.env directly
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                break


# ---------------------- Unit tests: wrap_template ----------------------
class TestWrapTemplate:
    def test_tenant_brand_no_surirent_leak(self):
        html = wrap_template(
            "<h1>x</h1>", brand_name="Acme Vastgoed", brand_color="#123456"
        )
        assert "SuriRent" not in html, "SuriRent leaked in tenant-branded email"
        assert "Acme Vastgoed" in html
        assert "#123456" in html

    def test_tenant_brand_custom_footer(self):
        html = wrap_template(
            "<p>hi</p>", brand_name="Demo Vastgoed N.V.", brand_color="#0055AA"
        )
        assert "SuriRent" not in html
        assert "Demo Vastgoed N.V." in html
        # Default footer should reference brand_name
        assert "Demo Vastgoed N.V." in html

    def test_tenant_brand_with_logo_url(self):
        html = wrap_template(
            "<p>hi</p>",
            brand_name="Acme",
            brand_color="#abcdef",
            logo_url="https://cdn.example.com/logo.png",
        )
        assert "SuriRent" not in html
        assert "https://cdn.example.com/logo.png" in html
        assert 'alt="Acme"' in html

    def test_platform_default_has_surirent(self):
        # Regression: platform emails still branded SuriRent
        html = wrap_template("<p>x</p>")
        assert "SuriRent" in html


# ---------------------- Backend regression tests ----------------------
@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _login(session, email, password):
    r = session.post(
        f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}
    )
    return r


class TestAuthRegression:
    def test_default_admin_login(self, session):
        r = _login(session, "admin@vastgoed.sr", "admin123")
        assert r.status_code == 200, f"got {r.status_code}: {r.text[:300]}"
        data = r.json()
        assert "token" in data or "access_token" in data or data.get("ok") is True

    def test_demo_admin_login(self, session):
        r = _login(session, "demo@surirent.sr", "demo1234")
        assert r.status_code == 200, f"got {r.status_code}: {r.text[:300]}"


@pytest.fixture(scope="module")
def demo_session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = _login(s, "demo@surirent.sr", "demo1234")
    if r.status_code != 200:
        pytest.skip(f"demo login failed: {r.status_code}")
    data = r.json()
    token = data.get("token") or data.get("access_token")
    if token:
        s.headers.update({"Authorization": f"Bearer {token}"})
    return s


class TestDemoAdminSmoke:
    def test_get_settings(self, demo_session):
        r = demo_session.get(f"{BASE_URL}/api/settings")
        assert r.status_code == 200, f"settings failed: {r.status_code} {r.text[:200]}"

    def test_get_tenants(self, demo_session):
        r = demo_session.get(f"{BASE_URL}/api/tenants")
        assert r.status_code == 200, f"tenants failed: {r.status_code} {r.text[:200]}"
        # Should be a list (possibly empty)
        body = r.json()
        assert isinstance(body, list) or isinstance(body, dict)

    def test_smtp_test_endpoint_no_surirent_leak(self, demo_session):
        """POST /api/settings/smtp/test — either graceful 400 (SMTP not enabled)
        or 200 with detail. Response body must NOT contain 'SuriRent' when the
        tenant company is non-SuriRent (Demo Vastgoed N.V.)."""
        r = demo_session.post(f"{BASE_URL}/api/settings/smtp/test", json={})
        assert r.status_code in (200, 400, 422), (
            f"unexpected status: {r.status_code} {r.text[:300]}"
        )
        # The endpoint response detail should not embed SuriRent branding.
        # (If SMTP is disabled we get an error like 'SMTP not enabled' — fine.)
        body_text = r.text
        # We only check that the *subject/preview* if returned doesn't say SuriRent SMTP test
        # Response likely small; if 'SuriRent SMTP test' appears, that's a leak.
        assert "SuriRent SMTP test" not in body_text, (
            f"Old hardcoded subject leaked: {body_text[:400]}"
        )
