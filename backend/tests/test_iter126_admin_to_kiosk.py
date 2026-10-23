# Iteration 126: admin-to-kiosk login flow (admin/boekhouder/superadmin) + company ownership check
import os
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')


def login(email, pw):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def boek():
    return login("boekhouder@surirent.sr", "test1234")


@pytest.fixture(scope="module")
def demo():
    return login("demo@surirent.sr", "demo1234")


@pytest.fixture(scope="module")
def sup():
    return login("super@surirent.sr", "super1234")


def h(t):
    return {"Authorization": f"Bearer {t['token']}"}


def test_boekhouder_admin_to_kiosk_ok(boek):
    r = requests.post(f"{BASE_URL}/api/auth/admin-to-kiosk", json={}, headers=h(boek))
    assert r.status_code == 200, r.text
    d = r.json()
    assert isinstance(d.get("token"), str) and d["token"]
    assert d.get("company", {}).get("slug") == "my-awesome-rentals-bv"


def test_demo_admin_to_kiosk_ok(demo):
    r = requests.post(f"{BASE_URL}/api/auth/admin-to-kiosk", json={}, headers=h(demo))
    assert r.status_code == 200, r.text
    assert r.json().get("token")


def _other_company_id(sup, own_cid):
    cs = requests.get(f"{BASE_URL}/api/companies", headers=h(sup)).json()
    for c in cs:
        if c["id"] != own_cid:
            return c["id"]
    pytest.skip("no other company")


# NOTE: demo@surirent.sr and boekhouder belong to the SAME company (demo-company-fixed-uuid, slug my-awesome-rentals-bv)
def test_boekhouder_other_company_403(boek, sup):
    own = requests.post(f"{BASE_URL}/api/auth/admin-to-kiosk", json={}, headers=h(boek)).json()["company"]["id"]
    other = _other_company_id(sup, own)
    r = requests.post(f"{BASE_URL}/api/auth/admin-to-kiosk", json={"company_id": other}, headers=h(boek))
    assert r.status_code == 403, r.text


def test_demo_other_company_403(demo, sup):
    own = requests.post(f"{BASE_URL}/api/auth/admin-to-kiosk", json={}, headers=h(demo)).json()["company"]["id"]
    other = _other_company_id(sup, own)
    r = requests.post(f"{BASE_URL}/api/auth/admin-to-kiosk", json={"company_id": other}, headers=h(demo))
    assert r.status_code == 403, r.text


def test_superadmin_any_company_ok(sup, boek):
    boek_cid = requests.post(f"{BASE_URL}/api/auth/admin-to-kiosk", json={}, headers=h(boek)).json()["company"]["id"]
    r = requests.post(f"{BASE_URL}/api/auth/admin-to-kiosk", json={"company_id": boek_cid}, headers=h(sup))
    assert r.status_code == 200, r.text


def test_unauth_401():
    r = requests.post(f"{BASE_URL}/api/auth/admin-to-kiosk", json={})
    assert r.status_code in (401, 403)


def test_kiosk_employee_pin_cannot_admin_to_kiosk():
    r = requests.post(f"{BASE_URL}/api/auth/personal-pin/login", json={"email": "kiosk.medewerker@surirent.sr", "pin": "5566"})
    assert r.status_code == 200, r.text
    t = r.json().get("token")
    r2 = requests.post(f"{BASE_URL}/api/auth/admin-to-kiosk", json={}, headers={"Authorization": f"Bearer {t}"})
    assert r2.status_code in (401, 403)


def test_nonexistent_company_404(boek):
    r = requests.post(f"{BASE_URL}/api/auth/admin-to-kiosk", json={"company_id": "nope-xyz"}, headers=h(boek))
    assert r.status_code == 404
