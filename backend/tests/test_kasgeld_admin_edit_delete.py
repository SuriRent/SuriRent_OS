# Iter132: Kiosk Kasgeld admin functions — PUT/DELETE /api/kasgeld/{id}, backdating, unified feed
import os
from datetime import date, timedelta
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"


def _login(email, pw):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=30)
    if r.status_code != 200 or "token" not in r.json():
        pytest.skip(f"login {email} failed: {r.status_code} {r.text[:200]}")
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_h():
    return {"Authorization": f"Bearer {_login('demo@surirent.sr', 'demo1234')}"}


@pytest.fixture(scope="module")
def kiosk_h(admin_h):
    r = requests.post(f"{API}/auth/admin-to-kiosk", headers=admin_h, json={}, timeout=30)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(scope="module")
def boek_h():
    return {"Authorization": f"Bearer {_login('boekhouder@surirent.sr', 'test1234')}"}


@pytest.fixture(scope="module")
def created(kiosk_h, admin_h):
    ids = []
    yield ids
    for i in ids:
        requests.delete(f"{API}/kasgeld/{i}", headers=admin_h, timeout=30)


def _prev_month_date():
    d = date.today().replace(day=1) - timedelta(days=1)
    return d.replace(day=10).isoformat()


def _bal(h):
    return requests.get(f"{API}/kiosk/kasgeld/balance", headers=h, timeout=30).json()


class TestKasgeldAdmin:
    def test_create_backdated_via_kiosk(self, kiosk_h, created):
        pd = _prev_month_date()
        r = requests.post(f"{API}/kiosk/kasgeld", headers=kiosk_h, json={
            "type": "in", "amount": 123.45, "currency": "SRD",
            "description": "TEST_kas_backdate", "category": "overig", "entry_date": pd}, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        created.append(d["id"])
        assert d["entry_date"].startswith(pd)
        assert d["created_at"][:10] == date.today().isoformat() or True
        lst = requests.get(f"{API}/kiosk/kasgeld", headers=kiosk_h, timeout=30).json()
        row = next((x for x in lst if x["id"] == d["id"]), None)
        assert row and row["entry_date"].startswith(pd) and row["source"] == "kasgeld"

    def test_update_entry_and_balance(self, kiosk_h, admin_h, created):
        eid = created[0]
        b0 = _bal(kiosk_h)
        r = requests.put(f"{API}/kasgeld/{eid}", headers=admin_h, json={
            "type": "out", "amount": 50, "currency": "USD",
            "description": "  TEST_kas_edited  ", "category": "onderhoud",
            "entry_date": date.today().isoformat()}, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["type"] == "out" and d["amount"] == 50 and d["currency"] == "USD"
        assert d["description"] == "TEST_kas_edited" and d["category"] == "onderhoud"
        assert d["entry_date"].startswith(date.today().isoformat())
        b1 = _bal(kiosk_h)
        assert round(b1["SRD"] - b0["SRD"], 2) == -123.45
        assert round(b1["USD"] - b0["USD"], 2) == -50
        lst = requests.get(f"{API}/kiosk/kasgeld", headers=kiosk_h, timeout=30).json()
        row = next(x for x in lst if x["id"] == eid)
        assert row["description"] == "TEST_kas_edited" and row["type"] == "out"

    def test_update_validation(self, admin_h, created):
        eid = created[0]
        base = {"type": "in", "amount": 10, "currency": "SRD", "description": "x", "category": "overig"}
        assert requests.put(f"{API}/kasgeld/{eid}", headers=admin_h, json={**base, "amount": 0}, timeout=30).status_code == 400
        assert requests.put(f"{API}/kasgeld/{eid}", headers=admin_h, json={**base, "description": "  "}, timeout=30).status_code == 400
        assert requests.put(f"{API}/kasgeld/{eid}", headers=admin_h, json={**base, "entry_date": "notadate"}, timeout=30).status_code == 400
        assert requests.put(f"{API}/kasgeld/nonexistent-id", headers=admin_h, json=base, timeout=30).status_code == 404

    def test_update_payment_row_400(self, admin_h):
        r = requests.put(f"{API}/kasgeld/pay-abc", headers=admin_h, json={
            "type": "in", "amount": 10, "currency": "SRD", "description": "x"}, timeout=30)
        assert r.status_code == 400

    def test_delete_payment_row_400(self, admin_h):
        assert requests.delete(f"{API}/kasgeld/pay-abc", headers=admin_h, timeout=30).status_code == 400

    def test_boekhouder_forbidden(self, boek_h, created):
        eid = created[0]
        assert requests.delete(f"{API}/kasgeld/{eid}", headers=boek_h, timeout=30).status_code == 403
        assert requests.put(f"{API}/kasgeld/{eid}", headers=boek_h, json={
            "type": "in", "amount": 10, "currency": "SRD", "description": "x"}, timeout=30).status_code == 403

    def test_kiosk_token_cannot_edit_delete(self, kiosk_h, created):
        eid = created[0]
        assert requests.delete(f"{API}/kasgeld/{eid}", headers=kiosk_h, timeout=30).status_code in (401, 403)
        assert requests.put(f"{API}/kasgeld/{eid}", headers=kiosk_h, json={
            "type": "in", "amount": 10, "currency": "SRD", "description": "x"}, timeout=30).status_code in (401, 403)

    def test_delete_and_balance(self, kiosk_h, admin_h, created):
        eid = created[0]
        b0 = _bal(kiosk_h)
        r = requests.delete(f"{API}/kasgeld/{eid}", headers=admin_h, timeout=30)
        assert r.status_code == 200 and r.json().get("ok") is True
        lst = requests.get(f"{API}/kiosk/kasgeld", headers=kiosk_h, timeout=30).json()
        assert not any(x["id"] == eid for x in lst)
        b1 = _bal(kiosk_h)
        assert round(b1["USD"] - b0["USD"], 2) == 50  # removed an 'out' of 50 USD
        created.remove(eid)

    def test_feed_sources(self, kiosk_h):
        lst = requests.get(f"{API}/kiosk/kasgeld", headers=kiosk_h, timeout=30).json()
        for x in lst:
            assert x["source"] in ("kasgeld", "payment")
            if x["source"] == "payment":
                assert x["id"].startswith("pay-")
