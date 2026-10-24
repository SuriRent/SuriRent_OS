# Tenant exit (uitgang) flow - iteration 131: move-out preview/settle, archive, reactivate, portal login block
import os
from datetime import datetime, timezone
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
NOW = datetime.now(timezone.utc)
TODAY = NOW.date().isoformat()
S = {"apts": [], "tenants": [], "deps": []}


def _period(delta):
    m, y = NOW.month + delta, NOW.year
    while m <= 0:
        m += 12
        y -= 1
    while m > 12:
        m -= 12
        y += 1
    return m, y


@pytest.fixture(scope="module")
def admin():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": "demo@surirent.sr", "password": "demo1234"})
    if r.status_code != 200:
        pytest.skip(f"login failed {r.status_code}")
    tok = r.json().get("token") or r.json().get("access_token")
    if tok:
        s.headers["Authorization"] = f"Bearer {tok}"
    return s


@pytest.fixture(scope="module", autouse=True)
def cleanup(admin):
    yield
    invs = admin.get(f"{BASE_URL}/api/invoices").json()
    invs = invs if isinstance(invs, list) else invs.get("items", [])
    pays = admin.get(f"{BASE_URL}/api/payments").json()
    for tid in S["tenants"]:
        for p in pays if isinstance(pays, list) else []:
            if p.get("tenant_id") == tid:
                admin.delete(f"{BASE_URL}/api/payments/{p['id']}")
        for inv in invs:
            if inv.get("tenant_id") == tid:
                admin.delete(f"{BASE_URL}/api/invoices/{inv['id']}")
        for c in admin.get(f"{BASE_URL}/api/contracts").json() or []:
            if isinstance(c, dict) and c.get("tenant_id") == tid:
                admin.delete(f"{BASE_URL}/api/contracts/{c['id']}")
    for d in admin.get(f"{BASE_URL}/api/deposits").json() or []:
        if d.get("tenant_id") in S["tenants"]:
            admin.delete(f"{BASE_URL}/api/deposits/{d['id']}")
    for tid in S["tenants"]:
        admin.delete(f"{BASE_URL}/api/tenants/{tid}")
    for aid in S["apts"]:
        admin.delete(f"{BASE_URL}/api/apartments/{aid}")


def _mk(admin, num, rent, email=None):
    r = admin.post(f"{BASE_URL}/api/apartments", json={"number": num, "rent_amount": rent, "currency": "SRD"})
    assert r.status_code == 200, r.text
    aid = r.json()["id"]
    S["apts"].append(aid)
    body = {"name": f"TEST MoveOut {num}", "phone": "5970002", "apartment_id": aid}
    if email:
        body["email"] = email
    r = admin.post(f"{BASE_URL}/api/tenants", json=body)
    assert r.status_code == 200, r.text
    tid = r.json()["id"]
    S["tenants"].append(tid)
    return aid, tid


def _invoices(admin, tid):
    invs = admin.get(f"{BASE_URL}/api/invoices").json()
    invs = invs if isinstance(invs, list) else invs.get("items", [])
    return [i for i in invs if i.get("tenant_id") == tid]


def _apt(admin, aid):
    return next(a for a in admin.get(f"{BASE_URL}/api/apartments").json() if a["id"] == aid)


class TestMoveOutDebt:
    """Borg insufficient -> oldest invoices settled via borgverrekening, debt remains"""

    def test_setup(self, admin):
        aid, tid = _mk(admin, "TEST-MO-1", 2500, email="test_mo1@example.com")
        S["a1"], S["t1"] = aid, tid
        r = admin.post(f"{BASE_URL}/api/deposits", json={"tenant_id": tid, "amount": 3000, "currency": "SRD"})
        assert r.status_code == 200, r.text
        for delta in (-2, -1, 1):
            m, y = _period(delta)
            admin.post(f"{BASE_URL}/api/invoices", json={"tenant_id": tid, "period_month": m, "period_year": y})
        r = admin.post(f"{BASE_URL}/api/auth/tenant-set-pin", json={"tenant_id": tid, "pin": "8642"})
        assert r.status_code in (200, 409), r.text
        S["pin_ok"] = r.status_code == 200
        # login works before archive
        r = requests.post(f"{BASE_URL}/api/tenant-portal/login", json={"identifier": "test_mo1@example.com", "pin": "8642"})
        S["pre_login"] = r.status_code

    def test_preview(self, admin):
        r = admin.get(f"{BASE_URL}/api/tenants/{S['t1']}/move-out-preview", params={"move_out_date": TODAY})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["deposit_amount"] == 3000 and d["currency"] == "SRD" and d["deposit_id"]
        assert d["future_invoices_removed"] >= 1
        assert len(d["arrears_items"]) >= 2
        assert all(i["amount"] == 2500 for i in d["arrears_items"])
        S["arrears"] = round(sum(i["amount"] for i in d["arrears_items"]), 2)
        S["n_arrears"] = len(d["arrears_items"])

    def test_preview_invalid_date(self, admin):
        r = admin.get(f"{BASE_URL}/api/tenants/{S['t1']}/move-out-preview", params={"move_out_date": "bad"})
        assert r.status_code == 400

    def test_preview_404(self, admin):
        r = admin.get(f"{BASE_URL}/api/tenants/nope/move-out-preview", params={"move_out_date": TODAY})
        assert r.status_code == 404

    def test_move_out(self, admin):
        body = {"move_out_date": TODAY, "damage_items": [{"description": "Kapotte deur", "amount": 1000}],
                "exclude_invoice_ids": [], "refund_note": "TEST uitgang"}
        r = admin.post(f"{BASE_URL}/api/tenants/{S['t1']}/move-out", json=body)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["settled_invoices"] == 3000
        dep = d["deposit"]
        assert dep["amount_due"] == round(S["arrears"] + 1000 - 3000, 2)
        assert dep["refund_amount"] == 0 and dep["status"] == "partial"
        assert dep["move_out"] is True

    def test_second_move_out_400(self, admin):
        r = admin.post(f"{BASE_URL}/api/tenants/{S['t1']}/move-out", json={"move_out_date": TODAY})
        assert r.status_code == 400

    def test_invoices_settled_and_future_deleted(self, admin):
        invs = _invoices(admin, S["t1"])
        fm, fy = _period(1)
        assert not any(i["period_month"] == fm and i["period_year"] == fy for i in invs), "future invoice not deleted"
        invs.sort(key=lambda i: (i["period_year"], i["period_month"]))
        oldest = invs[0]
        assert oldest["status"] == "paid", oldest
        second = invs[1]
        assert second["status"] != "paid" and round(float(second.get("paid_amount") or 0), 2) == 500

    def test_borgverrekening_payment(self, admin):
        pays = [p for p in admin.get(f"{BASE_URL}/api/payments").json() if p.get("tenant_id") == S["t1"]]
        assert any(p.get("method") == "borgverrekening" and p["amount"] == 3000 for p in pays), pays

    def test_apartment_vacant(self, admin):
        a = _apt(admin, S["a1"])
        assert a["status"] == "vacant" and not a.get("tenant_id")

    def test_not_in_active_list(self, admin):
        assert all(t["id"] != S["t1"] for t in admin.get(f"{BASE_URL}/api/tenants").json())
        pg = admin.get(f"{BASE_URL}/api/tenants/paged", params={"q": "TEST MoveOut TEST-MO-1"}).json()
        items = pg.get("items", []) if isinstance(pg, dict) else pg
        assert all(t["id"] != S["t1"] for t in items)

    def test_in_archived_list(self, admin):
        arc = admin.get(f"{BASE_URL}/api/tenants/archived").json()
        t = next(x for x in arc if x["id"] == S["t1"])
        assert t["status"] == "archived" and t["move_out_date"] == TODAY
        assert t["archived_apartment_id"] == S["a1"] and t["archived_apartment_number"] == "TEST-MO-1"
        assert t["outstanding_after_move_out"] == round(S["arrears"] + 1000 - 3000, 2)
        assert "pin_hash" not in t

    def test_archived_portal_login_blocked(self, admin):
        if not S.get("pin_ok") or S.get("pre_login") != 200:
            pytest.skip(f"pin setup/login pre-condition failed {S.get('pre_login')}")
        r = requests.post(f"{BASE_URL}/api/tenant-portal/login", json={"identifier": "test_mo1@example.com", "pin": "8642"})
        assert r.status_code == 401
        r = requests.post(f"{BASE_URL}/api/tenant-portal/pin-login", json={"pin": "8642", "company_slug": "demo"})
        assert r.status_code in (400, 401)

    def test_archived_setup_pin_blocked(self, admin):
        # archived tenant WITHOUT a pin should not be able to self-setup a PIN and receive a token
        aid, tid = _mk(admin, "TEST-MO-4", 500)
        r = admin.post(f"{BASE_URL}/api/tenants/{tid}/move-out", json={"move_out_date": TODAY})
        assert r.status_code == 200
        r = requests.post(f"{BASE_URL}/api/tenant-portal/setup-pin", json={"tenant_id": tid, "pin": "1357"})
        assert r.status_code != 200, f"archived tenant got portal token via setup-pin: {r.status_code}"


class TestMoveOutRefund:
    """Borg sufficient + exclude invoice -> refund back"""

    def test_refund(self, admin):
        aid, tid = _mk(admin, "TEST-MO-2", 1000)
        S["a2"], S["t2"] = aid, tid
        admin.post(f"{BASE_URL}/api/deposits", json={"tenant_id": tid, "amount": 5000, "currency": "SRD"})
        m, y = _period(-1)
        admin.post(f"{BASE_URL}/api/invoices", json={"tenant_id": tid, "period_month": m, "period_year": y})
        p = admin.get(f"{BASE_URL}/api/tenants/{tid}/move-out-preview", params={"move_out_date": TODAY}).json()
        items = p["arrears_items"]
        assert len(items) >= 1
        excl = items[0]["invoice_id"]
        rest = round(sum(i["amount"] for i in items[1:]), 2)
        r = admin.post(f"{BASE_URL}/api/tenants/{tid}/move-out",
                       json={"move_out_date": TODAY, "exclude_invoice_ids": [excl],
                             "damage_items": [{"description": "Raam", "amount": 300}]})
        assert r.status_code == 200, r.text
        dep = r.json()["deposit"]
        assert dep["amount_due"] == 0
        assert dep["refund_amount"] == round(5000 - 300 - rest, 2)
        inv = next(i for i in _invoices(admin, tid) if i["id"] == excl)
        assert inv["status"] != "paid"
        arc = next(x for x in admin.get(f"{BASE_URL}/api/tenants/archived").json() if x["id"] == tid)
        assert arc["outstanding_after_move_out"] == 0


class TestReactivate:
    def test_reactivate_orig_free(self, admin):
        r = admin.post(f"{BASE_URL}/api/tenants/{S['t2']}/reactivate", json={})
        assert r.status_code == 200, r.text
        t = r.json()
        assert t["apartment_id"] == S["a2"]
        assert t.get("status") == "active"
        assert _apt(admin, S["a2"])["status"] == "occupied"
        assert any(x["id"] == S["t2"] for x in admin.get(f"{BASE_URL}/api/tenants").json())
        assert all(x["id"] != S["t2"] for x in admin.get(f"{BASE_URL}/api/tenants/archived").json())

    def test_reactivate_not_archived_404(self, admin):
        r = admin.post(f"{BASE_URL}/api/tenants/{S['t2']}/reactivate", json={})
        assert r.status_code == 404

    def test_reactivate_orig_taken_409(self, admin):
        # occupy t1's old apartment with another tenant
        r = admin.post(f"{BASE_URL}/api/tenants", json={"name": "TEST MoveOut occupant", "phone": "5970003", "apartment_id": S["a1"]})
        assert r.status_code == 200
        S["tenants"].append(r.json()["id"])
        r = admin.post(f"{BASE_URL}/api/tenants/{S['t1']}/reactivate", json={})
        assert r.status_code == 409

    def test_reactivate_without_apartment(self, admin):
        # UI option "— Zonder appartement —" sends apartment_id null
        r = admin.post(f"{BASE_URL}/api/tenants/{S['t1']}/reactivate", json={"apartment_id": None})
        assert r.status_code == 200, f"reactivate without apartment failed: {r.status_code} {r.text}"
        assert r.json()["apartment_id"] is None
