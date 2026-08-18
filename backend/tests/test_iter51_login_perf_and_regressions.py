"""
Iteration 51 backend tests:
- Login POST /api/auth/login now wraps bcrypt in asyncio.to_thread → verify 200/401.
- Regression: /api/tenants, /api/apartments, /api/contracts return 200 arrays.
- Regression: PDF endpoints /api/payments/{id}/pdf and /api/contracts/{id}/pdf return 200.
- Regression: POST /api/auth/google/callback with invalid session_id returns 401 (not 500).
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL must be set"

DEMO_EMAIL = "demo@surirent.sr"
DEMO_PASS = "demo1234"


@pytest.fixture(scope="module")
def demo_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": DEMO_EMAIL, "password": DEMO_PASS},
                      timeout=30)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    data = r.json()
    assert "token" in data and isinstance(data["token"], str)
    assert data["user"]["email"] == DEMO_EMAIL
    return data["token"]


@pytest.fixture(scope="module")
def auth_headers(demo_token):
    return {"Authorization": f"Bearer {demo_token}"}


# ---- Login endpoint ----
class TestLogin:
    def test_login_success_returns_200_and_token(self):
        t0 = time.time()
        r = requests.post(f"{BASE_URL}/api/auth/login",
                          json={"email": DEMO_EMAIL, "password": DEMO_PASS},
                          timeout=30)
        elapsed = time.time() - t0
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["token"]
        assert j["user"]["email"] == DEMO_EMAIL
        print(f"login latency={elapsed:.2f}s")

    def test_login_wrong_password_returns_401(self):
        r = requests.post(f"{BASE_URL}/api/auth/login",
                          json={"email": DEMO_EMAIL, "password": "wrongpass"},
                          timeout=30)
        assert r.status_code == 401
        assert "Onjuiste inloggegevens" in r.text

    def test_login_unknown_email_returns_401(self):
        r = requests.post(f"{BASE_URL}/api/auth/login",
                          json={"email": "nope-xyz@example.com", "password": "whatever"},
                          timeout=30)
        assert r.status_code == 401


# ---- List endpoints regression ----
class TestListEndpoints:
    def test_tenants_list_200_array(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/tenants", headers=auth_headers, timeout=30)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_apartments_list_200_array(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/apartments", headers=auth_headers, timeout=30)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_contracts_list_200_array(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/contracts", headers=auth_headers, timeout=30)
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# ---- PDF endpoints regression ----
class TestPdfEndpoints:
    def test_contract_pdf(self, auth_headers):
        contracts = requests.get(f"{BASE_URL}/api/contracts", headers=auth_headers, timeout=30).json()
        if not contracts:
            pytest.skip("No contracts available for PDF regression")
        cid = contracts[0]["id"]
        r = requests.get(f"{BASE_URL}/api/contracts/{cid}/pdf", headers=auth_headers, timeout=60)
        assert r.status_code == 200, r.text[:400]
        assert r.headers.get("content-type", "").startswith("application/pdf")
        assert r.content[:4] == b"%PDF"

    def test_payment_pdf(self, auth_headers):
        # Get a payment id
        pays = requests.get(f"{BASE_URL}/api/payments", headers=auth_headers, timeout=30)
        if pays.status_code != 200 or not pays.json():
            pytest.skip("No payments available for PDF regression")
        pid = pays.json()[0]["id"]
        r = requests.get(f"{BASE_URL}/api/payments/{pid}/pdf", headers=auth_headers, timeout=60)
        assert r.status_code == 200, r.text[:400]
        assert r.content[:4] == b"%PDF"


# ---- Google OAuth callback regression ----
class TestGoogleCallback:
    def test_invalid_session_id_returns_401_not_500(self):
        r = requests.post(f"{BASE_URL}/api/auth/google/callback",
                          json={"session_id": "definitely-not-valid-xyz"},
                          timeout=30)
        assert r.status_code == 401, f"Expected 401, got {r.status_code}: {r.text[:300]}"
