# Deposit (borg) mandatory first-step flow for new tenants (iteration 129)
import os
from datetime import datetime, timezone
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
NOW = datetime.now(timezone.utc)
STATE = {}


@pytest.fixture(scope="module")
def admin():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": "demo@surirent.sr", "password": "demo1234"})
    if r.status_code != 200:
        pytest.skip(f"login failed {r.status_code} {r.text[:200]}")
    tok = r.json().get("token") or r.json().get("access_token")
    if tok:
        s.headers["Authorization"] = f"Bearer {tok}"
    return s


@pytest.fixture(scope="module")
def kiosk(admin):
    r = admin.post(f"{BASE_URL}/api/auth/admin-to-kiosk", json={})
    assert r.status_code == 200, r.text
    tok = r.json().get("token") or r.json().get("kiosk_token")
    k = requests.Session()
    if tok:
        k.headers["Authorization"] = f"Bearer {tok}"
    else:
        k.cookies.update(admin.cookies)
    return k


@pytest.fixture(scope="module", autouse=True)
def cleanup(admin):
    yield
    for did in STATE.get("deposits", []):
        admin.delete(f"{BASE_URL}/api/deposits/{did}")
    for tid in STATE.get("tenants", []):
        invs = admin.get(f"{BASE_URL}/api/invoices").json()
        for inv in invs if isinstance(invs, list) else invs.get("items", []):
            if inv.get("tenant_id") == tid:
                admin.delete(f"{BASE_URL}/api/invoices/{inv['id']}")
        for c in admin.get(f"{BASE_URL}/api/contracts").json() or []:
            if isinstance(c, dict) and c.get("tenant_id") == tid:
                admin.delete(f"{BASE_URL}/api/contracts/{c['id']}")
        admin.delete(f"{BASE_URL}/api/tenants/{tid}")
    for aid in STATE.get("apts", []):
        admin.delete(f"{BASE_URL}/api/apartments/{aid}")


def _db_contract_active(tid):
    from pymongo import MongoClient
    from dotenv import dotenv_values
    env = dotenv_values("/app/backend/.env")
    db = MongoClient(env["MONGO_URL"])[env["DB_NAME"]]
    return [c.get("active") for c in db.contracts.find({"tenant_id": tid})]


def _mk_tenant(admin, num):
    r = admin.post(f"{BASE_URL}/api/apartments", json={"number": num, "rent_amount": 1000, "currency": "SRD"})
    assert r.status_code == 200, r.text
    aid = r.json()["id"]
    STATE.setdefault("apts", []).append(aid)
    r = admin.post(f"{BASE_URL}/api/tenants", json={"name": f"TEST Borg {num}", "phone": "5970000", "apartment_id": aid})
    assert r.status_code == 200, r.text
    t = r.json()
    STATE.setdefault("tenants", []).append(t["id"])
    return aid, t


class TestDepositFlow:
    def test_create_tenant_pending(self, admin):
        aid, t = _mk_tenant(admin, "TEST-BORG-API")
        STATE["tid"], STATE["aid"] = t["id"], aid
        assert t.get("deposit_required") is True
        assert t.get("deposit_status") == "pending"
        cs = [c for c in admin.get(f"{BASE_URL}/api/contracts").json() if c.get("tenant_id") == t["id"]]
        assert len(cs) == 1
        assert _db_contract_active(t["id"]) == [False]
        STATE["cid"] = cs[0]["id"]

    def test_generate_month_skips_pending(self, admin):
        r = admin.post(f"{BASE_URL}/api/invoices/generate-month", json={"period_month": NOW.month, "period_year": NOW.year})
        assert r.status_code == 200, r.text
        invs = admin.get(f"{BASE_URL}/api/invoices").json()
        assert not [i for i in invs if i.get("tenant_id") == STATE["tid"]]

    def test_kiosk_deposit_payment(self, kiosk, admin):
        r = kiosk.post(f"{BASE_URL}/api/kiosk/tenants/{STATE['tid']}/deposit-payment",
                       json={"amount": 1000, "currency": "SRD", "method": "cash"})
        assert r.status_code == 200, r.text
        d = r.json()
        dep = d["deposit"]
        STATE.setdefault("deposits", []).append(dep["id"])
        STATE["did"] = dep["id"]
        assert dep["status"] == "held"
        assert dep["receipt_no"].startswith(f"BB{NOW.year}-") and len(dep["receipt_no"]) == 11
        assert d["invoices_created"] >= 1
        t = [x for x in admin.get(f"{BASE_URL}/api/tenants").json() if x["id"] == STATE["tid"]][0]
        assert t.get("deposit_status") == "paid"
        cs = [c for c in admin.get(f"{BASE_URL}/api/contracts").json() if c.get("tenant_id") == STATE["tid"]]
        assert _db_contract_active(STATE["tid"]) == [True]
        invs = [i for i in admin.get(f"{BASE_URL}/api/invoices").json() if i.get("tenant_id") == STATE["tid"]]
        assert len(invs) == 1 and invs[0]["period_month"] == NOW.month

    def test_second_payment_400(self, kiosk):
        r = kiosk.post(f"{BASE_URL}/api/kiosk/tenants/{STATE['tid']}/deposit-payment",
                       json={"amount": 1000, "currency": "SRD", "method": "cash"})
        assert r.status_code == 400

    def test_zero_amount_400(self, kiosk, admin):
        _, t = _mk_tenant(admin, "TEST-BORG-API2")
        STATE["tid2"] = t["id"]
        r = kiosk.post(f"{BASE_URL}/api/kiosk/tenants/{t['id']}/deposit-payment", json={"amount": 0, "method": "cash"})
        assert r.status_code == 400

    def test_print_data_and_png(self, kiosk):
        r = kiosk.get(f"{BASE_URL}/api/kiosk/deposits/{STATE['did']}/print-data")
        assert r.status_code == 200, r.text
        texts = [l["text"] for l in r.json()["lines"]]
        assert "BORGBON" in texts
        r = kiosk.get(f"{BASE_URL}/api/kiosk/deposits/{STATE['did']}/receipt.png")
        assert r.status_code == 200 and r.headers["content-type"] == "image/png"

    def test_list_deposits_contains(self, admin):
        ds = admin.get(f"{BASE_URL}/api/deposits").json()
        m = [d for d in ds if d["id"] == STATE["did"]]
        assert m and m[0]["apartment_number"] == "TEST-BORG-API" and m[0]["method"] == "cash"

    def test_refund_partial(self, admin):
        ex = [i["invoice_id"] for i in admin.get(f"{BASE_URL}/api/deposits/{STATE['did']}/refund-preview").json()["arrears_items"]]
        r = admin.post(f"{BASE_URL}/api/deposits/{STATE['did']}/refund",
                       json={"damage_items": [{"description": "a", "amount": 100}, {"description": "b", "amount": 200}],
                             "exclude_invoice_ids": ex, "refund_note": "TEST"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] == "partial" and d["refund_amount"] == 700 and d["deduction"] == 300
        r = admin.post(f"{BASE_URL}/api/deposits/{STATE['did']}/refund", json={})
        assert r.status_code == 400

    def test_refund_full(self, kiosk, admin):
        r = kiosk.post(f"{BASE_URL}/api/kiosk/tenants/{STATE['tid2']}/deposit-payment",
                       json={"amount": 1000, "currency": "SRD", "method": "bank"})
        assert r.status_code == 200, r.text
        did = r.json()["deposit"]["id"]
        STATE["deposits"].append(did)
        ex = [i["invoice_id"] for i in admin.get(f"{BASE_URL}/api/deposits/{did}/refund-preview").json()["arrears_items"]]
        r = admin.post(f"{BASE_URL}/api/deposits/{did}/refund", json={"exclude_invoice_ids": ex})
        assert r.status_code == 200
        assert r.json()["status"] == "refunded" and r.json()["refund_amount"] == 1000
