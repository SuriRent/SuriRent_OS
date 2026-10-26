# Iter140: archived debt settlement (kiosk settle-debt), borgverrekening in kasgeld feed (excluded from balance),
# cash borg refund kasgeld 'out', regression kiosk payment counted in kasgeld.
import os
import pytest
import requests
from datetime import datetime, timezone

B = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
STATE = {}


def _prev(n):
    now = datetime.now(timezone.utc)
    m, y = now.month - n, now.year
    while m < 1:
        m += 12
        y -= 1
    return m, y


@pytest.fixture(scope="module")
def s():
    x = requests.Session()
    r = x.post(f"{B}/api/auth/login", json={"email": "demo@surirent.sr", "password": "demo1234"})
    assert r.status_code == 200, r.text
    x.headers["Authorization"] = f"Bearer {r.json()['token']}"
    yield x
    # cleanup
    for t in STATE.get("tenants", []):
        if x.delete(f"{B}/api/tenants/{t}/permanent").status_code != 200:
            x.delete(f"{B}/api/tenants/{t}")
    pays = x.get(f"{B}/api/payments", params={"status": "all", "limit": 5000}).json()
    for p in pays:
        if p.get("id") in STATE.get("pay_ids", set()) or (p.get("tenant_id") == "" and p.get("id") not in STATE.get("orph_before", set())):
            x.delete(f"{B}/api/payments/{p['id']}")
    for kid in STATE.get("kasgeld_ids", []):
        x.delete(f"{B}/api/kasgeld/{kid}")
    for a in STATE.get("apts", []):
        x.delete(f"{B}/api/apartments/{a}")


@pytest.fixture(scope="module")
def k(s):
    kt = s.post(f"{B}/api/auth/admin-to-kiosk").json().get("token")
    assert kt
    x = requests.Session()
    x.headers["Authorization"] = f"Bearer {kt}"
    return x


def _setup(s, num, name, months=(2, 1)):
    a = s.post(f"{B}/api/apartments", json={"number": num, "rent_amount": 2000, "currency": "SRD"}).json()["id"]
    STATE.setdefault("apts", []).append(a)
    t = s.post(f"{B}/api/tenants", json={"name": name, "phone": "5978" + num[-1] + "11", "apartment_id": a}).json()["id"]
    STATE.setdefault("tenants", []).append(t)
    d = s.post(f"{B}/api/deposits", json={"tenant_id": t, "amount": 1000, "currency": "SRD"})
    assert d.status_code in (200, 201), d.text
    for n in months:
        m, y = _prev(n)
        r = s.post(f"{B}/api/invoices", json={"tenant_id": t, "period_month": m, "period_year": y})
        assert r.status_code in (200, 201), r.text
    return a, t


def _bal(s, k):
    return s.get(f"{B}/api/kasgeld/balance").json()["SRD"], k.get(f"{B}/api/kiosk/kasgeld/balance").json()["SRD"]


class TestSettleDebt:
    def test_01_moveout_with_damage(self, s, k):
        STATE["orph_before"] = {p["id"] for p in s.get(f"{B}/api/payments", params={"status": "all", "limit": 5000}).json() if p.get("tenant_id") == ""}
        a, t = _setup(s, "TEST-SD-1", "TEST Settle 1")
        STATE.update(a=a, t=t)
        STATE["bal0"] = _bal(s, k)
        today = datetime.now(timezone.utc).date().isoformat()
        pv = s.get(f"{B}/api/tenants/{t}/move-out-preview", params={"move_out_date": today}).json()
        arrears = round(sum(i["amount"] for i in pv["arrears_items"]), 2)
        STATE["due"] = arrears + 500 - 1000
        print("preview arrears", arrears, "expected due", STATE["due"])
        r = s.post(f"{B}/api/tenants/{t}/move-out", json={
            "move_out_date": datetime.now(timezone.utc).date().isoformat(),
            "damage_items": [{"description": "Muur", "amount": 500}], "exclude_invoice_ids": []})
        assert r.status_code == 200, r.text
        assert r.json()["settled_invoices"] == 1000
        arch = [x for x in s.get(f"{B}/api/tenants/archived").json() if x["id"] == t][0]
        print("outstanding:", arch.get("outstanding_after_move_out"))
        assert arch["outstanding_after_move_out"] == STATE["due"]

    def test_02_borgverrekening_in_feeds(self, s, k):
        m1, y1 = _prev(2)
        for name, feed in (("admin", s.get(f"{B}/api/kasgeld").json()), ("kiosk", k.get(f"{B}/api/kiosk/kasgeld").json())):
            rows = [x for x in feed if x.get("method") == "borgverrekening" and "TEST-SD-1" in (x.get("description") or "")]
            assert rows, f"{name}: no borgverrekening row"
            r = rows[0]
            print(name, r["description"], r["created_by_name"])
            assert r["type"] == "out" and r["excluded_from_balance"] is True
            assert r["amount"] == 1000
            assert "Borgverrekening" in r["description"]
            assert r["created_by_name"] not in ("Onbekend", "", None)
            STATE["borg_pay_id"] = r["payment_id"]

    def test_03_balance_unchanged_by_borgverrekening(self, s, k):
        b_admin, b_kiosk = _bal(s, k)
        print("before", STATE["bal0"], "after", (b_admin, b_kiosk))
        assert b_admin == STATE["bal0"][0], "admin balance changed"
        assert b_kiosk == STATE["bal0"][1], "kiosk balance changed by borgverrekening"

    def test_04_settle_debt(self, s, k):
        b0 = _bal(s, k)
        r = k.post(f"{B}/api/kiosk/tenants/{STATE['t']}/settle-debt", json={"method": "contant", "operator_name": "TEST Op"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["amount"] == STATE["due"] and d["receipt_number"]
        STATE.setdefault("pay_ids", set()).add(d["payment_id"])
        STATE["settle_pid"] = d["payment_id"]
        arch = [x for x in s.get(f"{B}/api/tenants/archived").json() if x["id"] == STATE["t"]][0]
        assert arch["outstanding_after_move_out"] == 0
        b1 = _bal(s, k)
        assert round(b1[0] - b0[0], 2) == STATE["due"]
        assert round(b1[1] - b0[1], 2) == STATE["due"]
        feed = k.get(f"{B}/api/kiosk/kasgeld").json()
        row = [x for x in feed if x.get("payment_id") == d["payment_id"]]
        assert row and row[0]["type"] == "in" and not row[0]["excluded_from_balance"]
        print("settle row:", row[0]["description"], row[0]["created_by_name"])

    def test_05_archived_invoices_paid(self, s):
        invs = s.get(f"{B}/api/tenants/{STATE['t']}/archived-invoices").json()
        print(invs)
        assert invs and all(i["status"] == "paid" for i in invs)
        ids = {i["id"] for i in invs}
        assert not ids & {i["id"] for i in s.get(f"{B}/api/invoices").json()}

    def test_06_second_settle_rejected(self, k):
        r = k.post(f"{B}/api/kiosk/tenants/{STATE['t']}/settle-debt", json={"method": "pin"})
        assert r.status_code in (400, 409), r.text

    def test_07_invalid_method_and_404(self, k):
        assert k.post(f"{B}/api/kiosk/tenants/{STATE['t']}/settle-debt", json={"method": "bitcoin"}).status_code == 422
        assert k.post(f"{B}/api/kiosk/tenants/nonexistent/settle-debt", json={"method": "pin"}).status_code == 404

    def test_08_settle_requires_kiosk_auth(self):
        r = requests.post(f"{B}/api/kiosk/tenants/{STATE['t']}/settle-debt", json={"method": "contant"})
        assert r.status_code in (401, 403)


class TestRefundCash:
    def test_10_borg_gt_arrears_refund(self, s, k):
        a, t = _setup(s, "TEST-SD-2", "TEST Refund 2", months=())
        # auto-created current-month invoice 2000, pay 1600 FIFO → arrears 400
        p = s.post(f"{B}/api/payments", json={"tenant_id": t, "amount": 1600, "currency": "SRD", "method": "contant",
                                              "category": "huur"})
        assert p.status_code == 200, p.text
        STATE.setdefault("pay_ids", set()).add(p.json()["id"])
        b0 = _bal(s, k)
        r = s.post(f"{B}/api/tenants/{t}/move-out", json={"move_out_date": datetime.now(timezone.utc).date().isoformat(),
                                                          "damage_items": [], "exclude_invoice_ids": []})
        assert r.status_code == 200, r.text
        dep = r.json()["deposit"]
        print("deposit:", {kk: dep.get(kk) for kk in ("refund_amount", "deduction", "amount_due")})
        assert r.json()["settled_invoices"] == 400
        assert dep["refund_amount"] == 600
        feed = s.get(f"{B}/api/kasgeld").json()
        rows = [x for x in feed if x.get("source") == "kasgeld" and x.get("description") == "Borg terugbetaald aan TEST Refund 2"]
        assert rows and rows[0]["type"] == "out" and rows[0]["amount"] == 600
        assert rows[0]["created_by_name"] not in ("Onbekend", None, "")
        STATE.setdefault("kasgeld_ids", []).append(rows[0]["id"])
        b1 = _bal(s, k)
        print("bal", b0, b1)
        assert round(b0[0] - b1[0], 2) == 600
        assert round(b0[1] - b1[1], 2) == 600, "kiosk balance should drop 600 (borgverrekening 400 must be excluded)"
        kfeed = k.get(f"{B}/api/kiosk/kasgeld").json()
        assert any(x.get("description") == "Borg terugbetaald aan TEST Refund 2" for x in kfeed)


class TestRegressionKioskPayment:
    def test_20_kiosk_payment_counted(self, s, k):
        a, t = _setup(s, "TEST-SD-3", "TEST Regr 3", months=(1,))
        b0 = _bal(s, k)
        r = k.post(f"{B}/api/kiosk/payments", json={"tenant_id": t, "amount": 250, "currency": "SRD",
                                                    "method": "contant", "category": "huur"})
        assert r.status_code == 200, r.text
        pid = r.json()["id"]
        STATE.setdefault("pay_ids", set()).add(pid)
        b1 = _bal(s, k)
        assert round(b1[0] - b0[0], 2) == 250 and round(b1[1] - b0[1], 2) == 250
        row = [x for x in k.get(f"{B}/api/kiosk/kasgeld").json() if x.get("payment_id") == pid]
        assert row and row[0]["type"] == "in" and row[0]["excluded_from_balance"] is False
