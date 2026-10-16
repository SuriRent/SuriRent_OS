# Iteration 104: retest of PIN security fixes (collision 409, me no hash, admin cookie, throttle, no 429 for employees)
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
SLUG = "my-awesome-rentals-bv"
ADMIN_PIN = "8642"
EMP_PIN = "4321"


@pytest.fixture(scope="module")
def hdr():
    r = requests.post(f"{API}/auth/login", json={"email": "demo@surirent.sr", "password": "demo1234"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _anita_payload(anita, pin=EMP_PIN):
    return {"name": anita["name"], "role": anita.get("role") or "", "app_role": "kiosk",
            "phone": anita.get("phone") or "", "email": "anita@demo.sr", "password": "anita1234",
            "pin": pin, "monthly_salary": 0, "currency": "SRD", "active": True}


@pytest.fixture(scope="module")
def anita(hdr):
    emps = requests.get(f"{API}/employees", headers=hdr).json()
    a = next((e for e in emps if e["name"] == "Anita Sewdas"), None)
    assert a, "Anita Sewdas not found"
    r = requests.put(f"{API}/employees/{a['id']}", json=_anita_payload(a), headers=hdr)
    assert r.status_code == 200, r.text
    # ensure admin PIN is set
    r = requests.post(f"{API}/auth/personal-pin/setup", json={"pin": ADMIN_PIN}, headers=hdr)
    assert r.status_code == 200, r.text
    return a


# (b) PIN collision
class TestPinCollision:
    def test_admin_setup_rejects_employee_pin(self, hdr, anita):
        r = requests.post(f"{API}/auth/personal-pin/setup", json={"pin": EMP_PIN}, headers=hdr)
        assert r.status_code == 409, r.text
        # admin PIN still the old one
        k = requests.post(f"{API}/auth/kiosk-pin", json={"pin": ADMIN_PIN, "company_slug": SLUG})
        assert k.status_code == 200 and k.json()["admin_token"]

    def test_admin_setup_same_own_pin_ok(self, hdr, anita):
        r = requests.post(f"{API}/auth/personal-pin/setup", json={"pin": ADMIN_PIN}, headers=hdr)
        assert r.status_code == 200, r.text

    def test_employee_update_rejects_admin_pin(self, hdr, anita):
        r = requests.put(f"{API}/employees/{anita['id']}", json=_anita_payload(anita, ADMIN_PIN), headers=hdr)
        assert r.status_code == 409, r.text

    def test_employee_setpin_rejects_admin_pin(self, hdr, anita):
        r = requests.post(f"{API}/employees/{anita['id']}/kiosk-pin", json={"pin": ADMIN_PIN}, headers=hdr)
        assert r.status_code == 409, r.text

    def test_employee_create_rejects_admin_pin(self, hdr, anita):
        r = requests.post(f"{API}/employees", json={"name": "TEST_collide", "role": "", "app_role": "kiosk",
                                                    "pin": ADMIN_PIN, "monthly_salary": 0, "currency": "SRD",
                                                    "active": True}, headers=hdr)
        assert r.status_code == 409, r.text

    def test_employee_resave_own_pin_ok(self, hdr, anita):
        r = requests.put(f"{API}/employees/{anita['id']}", json=_anita_payload(anita), headers=hdr)
        assert r.status_code == 200, r.text
        r = requests.post(f"{API}/employees/{anita['id']}/kiosk-pin", json={"pin": EMP_PIN}, headers=hdr)
        assert r.status_code == 200, r.text

    def test_non_kiosk_employee_resave_own_pin(self, hdr, anita):
        # Employee with app_role boekhouder has users doc with personal_pin_hash = own PIN -> resave must not 409
        pin = "7" + str(uuid.uuid4().int % 1000).zfill(3)
        email = f"test_bk_{uuid.uuid4().hex[:6]}@example.com"
        body = {"name": "TEST_boekhouder", "role": "", "app_role": "boekhouder", "email": email,
                "password": "test1234", "pin": pin, "monthly_salary": 0, "currency": "SRD", "active": True}
        c = requests.post(f"{API}/employees", json=body, headers=hdr)
        if c.status_code == 409:
            pytest.skip("random pin collided")
        assert c.status_code == 200, c.text
        eid = c.json()["id"]
        try:
            u = requests.put(f"{API}/employees/{eid}", json=body, headers=hdr)
            assert u.status_code == 200, f"resave own PIN for boekhouder employee: {u.status_code} {u.text}"
        finally:
            requests.delete(f"{API}/employees/{eid}", headers=hdr)


# (d) /auth/me no hash, (e) admin cookie
class TestMeAndCookie:
    def test_me_no_pin_hash(self, hdr, anita):
        me = requests.get(f"{API}/auth/me", headers=hdr).json()
        assert "personal_pin_hash" not in me
        assert "password_hash" not in me

    def test_kiosk_pin_admin_sets_cookie(self, anita):
        s = requests.Session()
        r = s.post(f"{API}/auth/kiosk-pin", json={"pin": ADMIN_PIN, "company_slug": SLUG})
        assert r.status_code == 200, r.text
        sc = r.headers.get("set-cookie", "")
        assert "access_token=" in sc and "httponly" in sc.lower()
        me = s.get(f"{API}/auth/me")  # cookie only
        assert me.status_code == 200 and me.json()["email"] == "demo@surirent.sr"
        assert "personal_pin_hash" not in me.json()

    def test_employee_pin_gets_kiosk_not_admin(self, anita):
        r = requests.post(f"{API}/auth/kiosk-pin", json={"pin": EMP_PIN, "company_slug": SLUG})
        assert r.status_code == 200
        d = r.json()
        assert d["employee"]["id"] == anita["id"] and d["admin_token"] is None


# (a) repeated employee logins never 429 (frontend now calls kiosk-pin first)
class TestNoLockoutForEmployees:
    def test_15_employee_logins(self, anita):
        for i in range(15):
            r = requests.post(f"{API}/auth/kiosk-pin", json={"pin": EMP_PIN, "company_slug": SLUG})
            assert r.status_code == 200, f"attempt {i}: {r.status_code} {r.text}"
