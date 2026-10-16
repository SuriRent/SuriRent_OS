# Iteration 103: Single PIN screen — kiosk-pin recognizes admin personal PIN + employee kiosk PIN
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
SLUG = "my-awesome-rentals-bv"
ADMIN_PIN = "8642"
EMP_PIN = "4321"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={"email": "demo@surirent.sr", "password": "demo1234"})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def hdr(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="module")
def kiosk_employee(hdr):
    emps = requests.get(f"{API}/employees", headers=hdr).json()
    anita = next((e for e in emps if e["name"] == "Anita Sewdas"), emps[0])
    payload = {"name": anita["name"], "role": anita.get("role") or "", "app_role": "kiosk",
               "phone": anita.get("phone") or "", "email": "anita@demo.sr", "password": "anita1234",
               "pin": EMP_PIN, "monthly_salary": 0, "currency": "SRD", "active": True}
    r = requests.put(f"{API}/employees/{anita['id']}", json=payload, headers=hdr)
    assert r.status_code == 200, r.text
    return anita


# Admin personal PIN setup
class TestPersonalPinSetup:
    def test_setup_admin_pin(self, hdr):
        r = requests.post(f"{API}/auth/personal-pin/setup", json={"pin": ADMIN_PIN}, headers=hdr)
        assert r.status_code == 200, r.text
        assert r.json()["ok"] is True
        s = requests.get(f"{API}/auth/personal-pin/status", headers=hdr)
        assert s.json()["has_pin"] is True

    def test_setup_rejects_non4digit(self, hdr):
        r = requests.post(f"{API}/auth/personal-pin/setup", json={"pin": "12a"}, headers=hdr)
        assert r.status_code == 400


# kiosk-pin with admin personal PIN -> admin token
class TestKioskPinAdmin:
    def test_admin_pin_returns_admin_token(self, hdr):
        requests.post(f"{API}/auth/personal-pin/setup", json={"pin": ADMIN_PIN}, headers=hdr)
        r = requests.post(f"{API}/auth/kiosk-pin", json={"pin": ADMIN_PIN, "company_slug": SLUG})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["employee"] is None
        assert d["token"] is None
        assert isinstance(d["admin_token"], str) and d["admin_token"]
        assert d["admin_user"]["email"] == "demo@surirent.sr"
        assert d["company"]["slug"] == SLUG
        me = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {d['admin_token']}"})
        assert me.status_code == 200
        assert me.json().get("email") == "demo@surirent.sr"

    def test_admin_pin_scoped_to_company(self, hdr):
        # Other slug must not match demo admin's PIN
        r = requests.post(f"{API}/auth/kiosk-pin", json={"pin": ADMIN_PIN, "company_slug": "nonexistent-xyz"})
        assert r.status_code == 400


# kiosk-pin with employee kiosk PIN -> kiosk token + employee
class TestKioskPinEmployee:
    def test_employee_pin(self, kiosk_employee):
        r = requests.post(f"{API}/auth/kiosk-pin", json={"pin": EMP_PIN, "company_slug": SLUG})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["employee"]["id"] == kiosk_employee["id"]
        assert d["employee"]["pin"] == EMP_PIN
        assert d["admin_token"] is None
        assert isinstance(d["token"], str) and d["token"]

    def test_wrong_pin_401(self):
        r = requests.post(f"{API}/auth/kiosk-pin", json={"pin": "0007", "company_slug": SLUG})
        assert r.status_code == 401

    def test_personal_pin_login_employee_pin_with_admin_email_401(self, kiosk_employee):
        # Frontend fallback path: personal-pin/login(admin email, employee pin) must 401
        r = requests.post(f"{API}/auth/personal-pin/login", json={"email": "demo@surirent.sr", "pin": EMP_PIN})
        assert r.status_code == 401

    def test_personal_pin_login_admin(self, hdr):
        requests.post(f"{API}/auth/personal-pin/setup", json={"pin": ADMIN_PIN}, headers=hdr)
        r = requests.post(f"{API}/auth/personal-pin/login", json={"email": "demo@surirent.sr", "pin": ADMIN_PIN})
        assert r.status_code == 200
        assert r.json()["user"]["email"] == "demo@surirent.sr"
