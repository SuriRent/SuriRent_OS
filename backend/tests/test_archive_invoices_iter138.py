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


def _orphans(s):
    r = s.get(f"{B}/api/payments", params={"status": "all", "limit": 5000})
    return {p["id"] for p in r.json() if p.get("tenant_id") == "" and p.get("tenant_name") == "Verwijderde huurder"}


def _cleanup_new_orphans(s):
    for pid in _orphans(s) - STATE.get("orphans_before", set()):
        s.delete(f"{B}/api/payments/{pid}")


class TestArchiveFlow:
    def test_01_setup_and_moveout(self, s):
        STATE["orphans_before"] = _orphans(s)
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
        STATE["arch_periods"] = [(i.get("period_month"), i.get("period_year")) for i in invs]

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
        assert not set(p.get("invoice_ids") or []) & set(STATE["arch_ids"])
        assert not {a.get("invoice_id") for a in (p.get("allocations") or [])} & set(STATE["arch_ids"])
        # archived invoices untouched
        arch = s.get(f"{B}/api/tenants/{STATE['t']}/archived-invoices")
        if arch.status_code == 200:
            for i in arch.json():
                if i["id"] in STATE["arch_ids"]:
                    assert i["status"] in ("archived", "paid")
        raw = s.get(f"{B}/api/invoices").json()
        for i in raw:
            if i["id"] in STATE["arch_ids"]:
                pytest.fail(f"archived invoice resurfaced: {i['id']} {i['status']}")

    def test_07_kiosk_overview_reactivated_excludes_archived(self, s):
        kt = s.post(f"{B}/api/auth/admin-to-kiosk").json().get("token")
        r = requests.get(f"{B}/api/kiosk/tenants/{STATE['t']}/overview", headers={"Authorization": f"Bearer {kt}"})
        if r.status_code != 200:
            pytest.skip(f"kiosk overview {r.status_code}")
        txt = r.text
        leaked = [i for i in STATE["arch_ids"] if i in txt]
        assert not leaked, f"archived invoices leaked in kiosk overview: {leaked}"
        body = r.json()
        print("kiosk overview total_due", body.get("total_due"), "fines", body.get("fines_total"),
              "open", len(body.get("open_invoices") or []), "cur", len(body.get("current_invoices") or []))
        assert float(body.get("fines_total") or 0) == 0
        assert not body.get("open_invoices")

    def test_08_tenant_portal_overview_excludes_archived(self, s):
        r = requests.post(f"{B}/api/tenant-portal/setup-pin", json={"tenant_id": STATE["t"], "pin": "8138"})
        if r.status_code != 200:
            pytest.skip(f"setup-pin {r.status_code} {r.text[:120]}")
        tk = r.json()["token"]
        o = requests.get(f"{B}/api/tenant-portal/overview", headers={"Authorization": f"Bearer {tk}"})
        assert o.status_code == 200, o.text
        b = o.json()
        print("portal:", b.get("total_due"), b.get("fines_total"), b.get("due_periods"))
        assert float(b.get("fines_total") or 0) == 0
        # current month may legitimately have a NEW invoice (created by the reactivated payment)
        now = datetime.now(timezone.utc)
        arch_periods = [x for x in (STATE.get("arch_periods") or []) if x != (now.month, now.year)]
        assert not [d for d in b.get("due_periods") or [] if (d["month"], d["year"]) in arch_periods], b


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
        assert all(p.get("tenant_name") == "Verwijderde huurder" for p in kept), [p.get("tenant_name") for p in kept]
        assert s.get(f"{B}/api/payments").status_code == 200
        STATE["kept"] = kept

    def test_13b_payments_paged_kept(self, s):
        kept = STATE["kept"]
        pa = kept[0]["paid_at"]
        d = datetime.fromisoformat(pa.replace("Z", "+00:00"))
        start = datetime(d.year, d.month, 1, tzinfo=timezone.utc)
        end = datetime(d.year + (d.month // 12), d.month % 12 + 1, 1, tzinfo=timezone.utc)
        params = {"start": start.isoformat(), "end": end.isoformat(),
                  "today_start": datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).isoformat(),
                  "limit": 100}
        items, off = [], 0
        while True:
            r = s.get(f"{B}/api/payments/paged", params={**params, "offset": off})
            assert r.status_code == 200, r.text
            b = r.json()
            items += b["items"]
            if not b["has_more"]:
                break
            off += 100
        ids = {p["id"] for p in items}
        for k in kept:
            if k["paid_at"] >= params["start"] and k["paid_at"] < params["end"]:
                assert k["id"] in ids, "kept payment missing in paged list"
        mine = [p for p in items if p["id"] in {k["id"] for k in kept}]
        assert all(p.get("tenant_name") == "Verwijderde huurder" for p in mine)
        summ = b["summary"]
        assert summ["monthCount"] == b["total"] == len(items), summ
        assert abs(summ["monthSum"] - round(sum(float(p["amount"]) for p in items), 2)) < 0.01
        # monthCount consistent with raw DB count in range
        allp = s.get(f"{B}/api/payments", params={"status": "all", "limit": 5000}).json()
        inrange = [p for p in allp if p.get("status") != "pending_approval" and params["start"] <= (p.get("paid_at") or "") < params["end"]]
        print("paged", summ, "list-inrange", len(inrange))
        assert len(inrange) == summ["monthCount"]

    def test_15_cleanup(self, s):
        for p in STATE.get("kept") or []:
            s.delete(f"{B}/api/payments/{p['id']}")
        tid = STATE.get("t")
        for p in s.get(f"{B}/api/payments", params={"status": "all"}).json():
            if p.get("tenant_id") == tid:
                s.delete(f"{B}/api/payments/{p['id']}")
        if tid:
            s.post(f"{B}/api/tenants/{tid}/move-out", json={"move_out_date": datetime.now(timezone.utc).date().isoformat(), "damage_items": [], "exclude_invoice_ids": []})
            s.delete(f"{B}/api/tenants/{tid}/permanent")
        _cleanup_new_orphans(s)
        for a in (STATE.get("a"), STATE.get("a2")):
            if a:
                s.delete(f"{B}/api/apartments/{a}")
        if STATE.get("bk_emp"):
            s.delete(f"{B}/api/employees/{STATE['bk_emp']}")

    def test_14_second_delete_404(self, s):
        assert s.delete(f"{B}/api/tenants/{STATE['t2']}/permanent").status_code == 404


class TestRegressionActive:
    """Active tenant: FIFO allocates to oldest open invoice; overdue lists OK."""

    def test_20_fifo_oldest(self, s):
        a, t = _setup(s, "TEST-ARC-3", "TEST Archief 3")
        STATE.update(a3=a, t3=t)
        invs = sorted([i for i in s.get(f"{B}/api/invoices").json() if i.get("tenant_id") == t],
                      key=lambda i: (i["period_year"], i["period_month"]))
        print([(i["period_month"], i["status"], i.get("paid_amount")) for i in invs])
        open_invs = [i for i in invs if i["status"] != "paid"]
        assert open_invs
        oldest = open_invs[0]
        r = s.post(f"{B}/api/payments", json={"tenant_id": t, "amount": 500, "currency": "SRD",
                                              "method": "contant", "category": "huur"})
        assert r.status_code == 200, r.text
        p = r.json()
        print("fifo payment", p.get("invoice_id"), p.get("allocations"))
        targets = {p.get("invoice_id")} | {x.get("invoice_id") for x in p.get("allocations") or []}
        assert oldest["id"] in targets
        inv = [i for i in s.get(f"{B}/api/invoices").json() if i["id"] == oldest["id"]][0]
        assert float(inv["paid_amount"]) == float(oldest.get("paid_amount") or 0) + 500

    def test_21_overdue_lists(self, s):
        t = STATE["t3"]
        r = s.get(f"{B}/api/invoices/grouped", params={"tab": "open", "tenant_id": t, "limit": 100})
        assert r.status_code == 200
        assert t in r.json()["tenant_ids"] or any(i.get("tenant_id") == t for i in r.json()["invoices"])
        st = s.get(f"{B}/api/admin/stats")
        assert st.status_code == 200, st.text
        kt = s.post(f"{B}/api/auth/admin-to-kiosk").json().get("token")
        o = requests.get(f"{B}/api/kiosk/tenants/{t}/overview", headers={"Authorization": f"Bearer {kt}"})
        assert o.status_code == 200
        b = o.json()
        print("active kiosk", b.get("total_due"), len(b.get("open_invoices") or []), len(b.get("current_invoices") or []))
        assert float(b.get("total_due") or 0) > 0
        assert (b.get("open_invoices") or b.get("current_invoices"))

    def test_29_cleanup(self, s):
        t = STATE.get("t3")
        if t:
            for p in s.get(f"{B}/api/payments", params={"status": "all"}).json():
                if p.get("tenant_id") == t:
                    s.delete(f"{B}/api/payments/{p['id']}")
            s.post(f"{B}/api/tenants/{t}/move-out", json={"move_out_date": datetime.now(timezone.utc).date().isoformat(), "damage_items": [], "exclude_invoice_ids": []})
            s.delete(f"{B}/api/tenants/{t}/permanent")
        _cleanup_new_orphans(s)
        if STATE.get("a3"):
            s.delete(f"{B}/api/apartments/{STATE['a3']}")
