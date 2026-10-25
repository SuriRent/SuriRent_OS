# Iter138: move-out archives all tenant invoices, archive endpoint, permanent delete, reactivation.
import os
import pytest
import requests
from datetime import datetime, timezone

B = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")


def _login(email, pw):
    s = requests.Session()
    r = s.post(f"{B}/api/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    s.headers["Authorization"] = f"Bearer {r.json()['token']}"
    return s


@pytest.fixture(scope="module")
def s():
    return _login("demo@surirent.sr", "demo1234")


def _prev(n):
    now = datetime.now(timezone.utc)
    m, y = now.month - n, now.year
    while m < 1:
        m += 12
        y -= 1
    return m, y


def _setup(s, num, name):
    a = s.post(f"{B}/api/apartments", json={"number": num, "rent_amount": 2000, "currency": "SRD"}).json()["id"]
    t = s.post(f"{B}/api/tenants", json={"name": name, "phone": "5971" + num[-1] + "00", "apartment_id": a}).json()["id"]
    d = s.post(f"{B}/api/deposits", json={"tenant_id": t, "amount": 1000, "currency": "SRD"})
    assert d.status_code in (200, 201), d.text
    for n in (2, 1):
        m, y = _prev(n)
        r = s.post(f"{B}/api/invoices", json={"tenant_id": t, "period_month": m, "period_year": y})
        assert r.status_code in (200, 201), r.text
    return a, t


def _tenant_invoice_ids(s, tid):
    return [i["id"] for i in s.get(f"{B}/api/invoices").json() if i.get("tenant_id") == tid]


def _grouped_has(s, tid):
    found = {}
    for tab in ("open", "paid", "all"):
        r = s.get(f"{B}/api/invoices/grouped", params={"tab": tab, "tenant_id": tid, "limit": 100})
        assert r.status_code == 200, r.text
        body = r.json()
        found[tab] = tid in body["tenant_ids"] or any(i.get("tenant_id") == tid for i in body["invoices"])
    return found


STATE = {}


class TestArchiveFlow:
    def test_01_setup_and_moveout(self, s):
        a, t = _setup(s, "TEST-ARC-1", "TEST Archief 1")
        STATE.update(a=a, t=t)
        ids = _tenant_invoice_ids(s, t)
        assert len(ids) >= 2
        STATE["inv_before"] = ids
        r = s.post(f"{B}/api/tenants/{t}/move-out", json={"move_out_date": datetime.now(timezone.utc).date().isoformat(),
                                                          "damage_items": [], "exclude_invoice_ids": []})
        assert r.status_code == 200, r.text
        assert r.json()["settled_invoices"] == 1000

    def test_02_not_in_general_lists(self, s):
        assert _tenant_invoice_ids(s, STATE["t"]) == []
        found = _grouped_has(s, STATE["t"])
        assert not any(found.values()), found

    def test_03_archived_invoices_endpoint(self, s):
        r = s.get(f"{B}/api/tenants/{STATE['t']}/archived-invoices")
        assert r.status_code == 200
        invs = r.json()
        print(invs)
        assert {i["id"] for i in invs} >= set(STATE["inv_before"]) - set()  # future invoices may be deleted
        assert all(i["status"] in ("archived", "paid") for i in invs)
        partial = [i for i in invs if float(i.get("paid_amount") or 0) == 1000]
        assert partial and partial[0]["status"] == "archived" and partial[0]["status_before_archive"] == "partial"
        STATE["arch_ids"] = [i["id"] for i in invs]

    def test_04_archived_invoices_active_tenant_404(self, s):
        tl = [t for t in s.get(f"{B}/api/tenants").json() if t.get("status") != "archived"]
        if not tl:
            pytest.skip("no active tenant")
        assert s.get(f"{B}/api/tenants/{tl[0]['id']}/archived-invoices").status_code == 404
        assert s.delete(f"{B}/api/tenants/{tl[0]['id']}/permanent").status_code == 404

    def test_05_reactivate_keeps_archived(self, s):
        r = s.post(f"{B}/api/tenants/{STATE['t']}/reactivate", json={})
        assert r.status_code == 200, r.text
        assert _tenant_invoice_ids(s, STATE["t"]) == []
        assert not any(_grouped_has(s, STATE["t"]).values())

    def test_06_reactivated_payment_not_allocated_to_archived(self, s):
        # New payment for reactivated tenant must not be booked on archived invoices.
        r = s.post(f"{B}/api/payments", json={"tenant_id": STATE["t"], "amount": 500, "currency": "SRD",
                                              "method": "contant", "category": "huur"})
        assert r.status_code == 200, r.text
        p = r.json()
        STATE["pay_react"] = p["id"]
        print("payment invoice_id:", p.get("invoice_id"), "archived ids:", STATE["arch_ids"])
        assert p.get("invoice_id") not in STATE["arch_ids"], "payment allocated to archived invoice"

    def test_07_kiosk_overview_reactivated_excludes_archived(self, s):
        kt = s.post(f"{B}/api/auth/admin-to-kiosk").json().get("token")
        r = requests.get(f"{B}/api/kiosk/tenants/{STATE['t']}/overview", headers={"Authorization": f"Bearer {kt}"})
        if r.status_code != 200:
            pytest.skip(f"kiosk overview {r.status_code}")
        txt = r.text
        leaked = [i for i in STATE["arch_ids"] if i in txt]
        assert not leaked, f"archived invoices leaked in kiosk overview: {leaked}"


class TestPermanentDelete:
    def test_10_setup_moveout(self, s):
        a, t = _setup(s, "TEST-ARC-2", "TEST Archief 2")
        STATE.update(a2=a, t2=t)
        r = s.post(f"{B}/api/tenants/{t}/move-out", json={"move_out_date": datetime.now(timezone.utc).date().isoformat(),
                                                          "damage_items": [], "exclude_invoice_ids": []})
        assert r.status_code == 200, r.text

    def test_11_boekhouder_403(self, s):
        r = s.post(f"{B}/api/employees", json={"email": "test_bk_iter138@demo.sr", "password": "Test12345!",
                                               "name": "TEST BK", "app_role": "boekhouder", "pin": "8137"})
        print("create bk", r.status_code, r.text[:200])
        if r.status_code != 200:
            pytest.skip("cannot create boekhouder")
        STATE["bk_emp"] = r.json()["id"]
        bk = _login("test_bk_iter138@demo.sr", "Test12345!")
        assert bk.delete(f"{B}/api/tenants/{STATE['t2']}/permanent").status_code == 403

    def test_12_delete_permanent(self, s):
        t = STATE["t2"]
        pays = [p for p in s.get(f"{B}/api/payments", params={"status": "all"}).json() if p.get("tenant_id") == t]
        assert pays
        STATE["pay_ids"] = [p["id"] for p in pays]
        r = s.delete(f"{B}/api/tenants/{t}/permanent")
        assert r.status_code == 200 and r.json()["ok"] is True
        assert t not in [x["id"] for x in s.get(f"{B}/api/tenants").json()]
        assert s.get(f"{B}/api/tenants/{t}/archived-invoices").status_code == 404
        assert not [d for d in s.get(f"{B}/api/deposits").json() if d.get("tenant_id") == t]
        assert not [c for c in s.get(f"{B}/api/contracts").json() if c.get("tenant_id") == t]
        assert t not in [x["id"] for x in s.get(f"{B}/api/tenants/archived").json()]

    def test_13_payments_kept(self, s):
        r = s.get(f"{B}/api/payments", params={"status": "all", "limit": 2000})
        assert r.status_code == 200, r.text
        kept = [p for p in r.json() if p["id"] in STATE["pay_ids"]]
        assert len(kept) == len(STATE["pay_ids"]), "payments missing after tenant delete"
        assert all(p["tenant_id"] == "" for p in kept)
        assert s.get(f"{B}/api/payments").status_code == 200

    def test_15_cleanup(self, s):
        tid = STATE.get("t")
        for p in s.get(f"{B}/api/payments", params={"status": "all"}).json():
            if p.get("tenant_id") == tid:
                s.delete(f"{B}/api/payments/{p['id']}")
        if tid:
            s.post(f"{B}/api/tenants/{tid}/move-out", json={"move_out_date": datetime.now(timezone.utc).date().isoformat(), "damage_items": [], "exclude_invoice_ids": []})
            s.delete(f"{B}/api/tenants/{tid}/permanent")
        for a in (STATE.get("a"), STATE.get("a2")):
            if a:
                s.delete(f"{B}/api/apartments/{a}")
        if STATE.get("bk_emp"):
            s.delete(f"{B}/api/employees/{STATE['bk_emp']}")

    def test_14_second_delete_404(self, s):
        assert s.delete(f"{B}/api/tenants/{STATE['t2']}/permanent").status_code == 404
