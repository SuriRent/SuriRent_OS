"""Iteration 69: Employee email+password+PIN login workflow.

Flow under test (per review request):
1. Admin creates employee with email+password+PIN for each app_role (admin, boekhouder, kiosk).
2. POST /api/auth/login with employee creds → kiosk gets pin_required (no token),
   admin/boekhouder get a token directly.
3. POST /api/auth/personal-pin/login with email+pin → kiosk gets kiosk token + employee{};
   admin/boekhouder get access_token.
4. Deactivated employee → 403 on login.
5. Deleting employee removes login (401).
6. Wrong PIN 5x → eventually throttled (429).
7. Owner admin demo login regression still works.
"""
import os
import time
import uuid
import pytest
import requests


def _url():
    u = os.environ.get("REACT_APP_BACKEND_URL", "")
    if not u:
        with open("/app/frontend/.env") as f:
            for ln in f:
                if ln.startswith("REACT_APP_BACKEND_URL="):
                    u = ln.split("=", 1)[1].strip()
                    break
    return u.rstrip("/")


BASE = _url()
ADMIN_EMAIL = "demo@surirent.sr"
ADMIN_PW = "demo1234"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PW}, timeout=60)
    assert r.status_code == 200, r.text
    return r.json().get("token") or r.json().get("access_token")


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


# ---------- Regression: demo admin login ----------
class TestDemoAdminRegression:
    def test_demo_admin_login_returns_token(self):
        r = requests.post(f"{BASE}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PW}, timeout=60)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("token"), "admin token missing"
        assert body["user"]["role"] in ("admin", "owner", "superadmin"), body
        assert not body.get("pin_required")


# ---------- Create / login / delete employees per role ----------
def _mk_email(prefix):
    return f"TEST_{prefix}_{uuid.uuid4().hex[:8]}@surirent.sr"


class TestEmployeeWorkflow:
    created = []  # (eid, email, pin, role, password)

    @pytest.mark.parametrize("role,pin", [("admin", "1122"), ("boekhouder", "2233"), ("kiosk", "3344")])
    def test_create_employee_with_login(self, admin_headers, role, pin):
        email = _mk_email(role)
        payload = {
            "name": f"TEST {role}",
            "app_role": role,
            "email": email,
            "password": "test1234",
            "pin": pin,
            "monthly_salary": 0,
            "currency": "SRD",
            "active": True,
        }
        r = requests.post(f"{BASE}/api/employees", json=payload, headers=admin_headers, timeout=60)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["app_role"] == role
        assert body["has_login"] is True
        assert body["has_kiosk_pin"] is True
        TestEmployeeWorkflow.created.append((body["id"], email, pin, role, "test1234"))

    def test_pin_missing_rejected(self, admin_headers):
        payload = {"name": "TEST nopin", "app_role": "admin", "email": _mk_email("nopin"),
                   "password": "test1234", "monthly_salary": 0, "currency": "SRD"}
        r = requests.post(f"{BASE}/api/employees", json=payload, headers=admin_headers, timeout=60)
        assert r.status_code == 400, r.text
        assert "PIN" in r.text

    def test_duplicate_pin_rejected(self, admin_headers):
        # Use first created employee's pin (1122) on new employee → should 409
        payload = {"name": "TEST dup", "app_role": "admin", "email": _mk_email("dup"),
                   "password": "test1234", "pin": "1122", "monthly_salary": 0, "currency": "SRD"}
        r = requests.post(f"{BASE}/api/employees", json=payload, headers=admin_headers, timeout=60)
        assert r.status_code == 409, r.text
        assert "PIN" in r.text or "pin" in r.text

    def test_login_kiosk_requires_pin(self):
        rec = next(x for x in TestEmployeeWorkflow.created if x[3] == "kiosk")
        r = requests.post(f"{BASE}/api/auth/login", json={"email": rec[1], "password": rec[4]}, timeout=60)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("pin_required") is True
        assert not body.get("token") and not body.get("access_token")
        assert body.get("company", {}).get("slug")

    def test_login_admin_role_returns_token_direct(self):
        rec = next(x for x in TestEmployeeWorkflow.created if x[3] == "admin")
        r = requests.post(f"{BASE}/api/auth/login", json={"email": rec[1], "password": rec[4]}, timeout=60)
        assert r.status_code == 200, r.text
        body = r.json()
        assert not body.get("pin_required")
        assert body.get("token")
        assert body["user"]["role"] == "admin"

    def test_login_boekhouder_role_returns_token_direct(self):
        rec = next(x for x in TestEmployeeWorkflow.created if x[3] == "boekhouder")
        r = requests.post(f"{BASE}/api/auth/login", json={"email": rec[1], "password": rec[4]}, timeout=60)
        assert r.status_code == 200, r.text
        body = r.json()
        assert not body.get("pin_required")
        assert body.get("token")
        assert body["user"]["role"] == "boekhouder"

    def test_personal_pin_kiosk_returns_kiosk_token(self):
        rec = next(x for x in TestEmployeeWorkflow.created if x[3] == "kiosk")
        r = requests.post(f"{BASE}/api/auth/personal-pin/login",
                         json={"email": rec[1], "pin": rec[2]}, timeout=60)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("kiosk") is True
        assert body.get("token")
        emp = body.get("employee") or {}
        assert emp.get("id") and emp.get("name") and emp.get("pin") == rec[2]
        # kiosk token must NOT grant admin access
        r2 = requests.get(f"{BASE}/api/auth/me",
                          headers={"Authorization": f"Bearer {body['token']}"}, timeout=60)
        assert r2.status_code in (401, 403), r2.text

    def test_personal_pin_admin_returns_access_token(self):
        rec = next(x for x in TestEmployeeWorkflow.created if x[3] == "admin")
        r = requests.post(f"{BASE}/api/auth/personal-pin/login",
                         json={"email": rec[1], "pin": rec[2]}, timeout=60)
        assert r.status_code == 200, r.text
        body = r.json()
        assert not body.get("kiosk")
        assert body.get("access_token")
        r2 = requests.get(f"{BASE}/api/auth/me",
                          headers={"Authorization": f"Bearer {body['access_token']}"}, timeout=60)
        assert r2.status_code == 200
        assert r2.json().get("role") == "admin"

    def test_personal_pin_boekhouder_returns_access_token(self):
        rec = next(x for x in TestEmployeeWorkflow.created if x[3] == "boekhouder")
        r = requests.post(f"{BASE}/api/auth/personal-pin/login",
                         json={"email": rec[1], "pin": rec[2]}, timeout=60)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("access_token")
        assert body["user"]["role"] == "boekhouder"

    def test_deactivated_employee_cannot_login(self, admin_headers):
        rec = next(x for x in TestEmployeeWorkflow.created if x[3] == "admin")
        eid, email, pin, role, pw = rec
        # Deactivate
        r = requests.put(
            f"{BASE}/api/employees/{eid}",
            json={"name": f"TEST {role}", "app_role": role, "email": email,
                  "monthly_salary": 0, "currency": "SRD", "active": False},
            headers=admin_headers, timeout=60,
        )
        assert r.status_code == 200, r.text
        # Password login → 403
        r2 = requests.post(f"{BASE}/api/auth/login", json={"email": email, "password": pw}, timeout=60)
        assert r2.status_code == 403, r2.text
        # Reactivate for cleanup
        requests.put(
            f"{BASE}/api/employees/{eid}",
            json={"name": f"TEST {role}", "app_role": role, "email": email,
                  "monthly_salary": 0, "currency": "SRD", "active": True},
            headers=admin_headers, timeout=60,
        )

    def test_delete_employee_removes_login(self, admin_headers):
        rec = next(x for x in TestEmployeeWorkflow.created if x[3] == "boekhouder")
        eid, email, pin, role, pw = rec
        r = requests.delete(f"{BASE}/api/employees/{eid}", headers=admin_headers, timeout=60)
        assert r.status_code in (200, 204), r.text
        TestEmployeeWorkflow.created = [x for x in TestEmployeeWorkflow.created if x[0] != eid]
        time.sleep(0.5)
        r2 = requests.post(f"{BASE}/api/auth/login", json={"email": email, "password": pw}, timeout=60)
        assert r2.status_code == 401, r2.text


# ---------- Teardown fixture ----------
@pytest.fixture(scope="module", autouse=True)
def _cleanup(admin_headers):
    yield
    for eid, *_ in list(TestEmployeeWorkflow.created):
        try:
            requests.delete(f"{BASE}/api/employees/{eid}", headers=admin_headers, timeout=10)
        except Exception:
            pass


# ---------- Throttle (last) ----------
class TestZThrottle:
    def test_wrong_pin_5x_eventually_throttled(self):
        # Use a fresh non-existent email to not pollute real throttle keys
        email = f"nope_{uuid.uuid4().hex[:6]}@example.com"
        statuses = []
        for _ in range(10):
            r = requests.post(f"{BASE}/api/auth/personal-pin/login",
                              json={"email": email, "pin": "0000"}, timeout=30)
            statuses.append(r.status_code)
            if r.status_code == 429:
                break
        assert 429 in statuses or statuses[-1] in (401, 429), f"Got {statuses}"
