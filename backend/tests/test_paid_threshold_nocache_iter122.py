# Iter122: invoice 'paid' only at 100% (not 95%) + no server-side caching for admin/kiosk lists
import os
import time
import uuid

import pytest
import requests
from pymongo import MongoClient

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE}/api"
SLUG = "my-awesome-rentals-bv"


def _env(key):
    for line in open("/app/backend/.env"):
        if line.startswith(key + "="):
            return line.split("=", 1)[1].strip().strip('"')
    raise KeyError(key)


mdb = MongoClient(_env("MONGO_URL"))[_env("DB_NAME")]


def _admin():
    r = requests.post(f"{API}/auth/login", json={"email": "demo@surirent.sr", "password": "demo1234"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _kiosk(ah):
    k = requests.post(f"{API}/auth/kiosk-pin", json={"pin": "4321", "company_slug": SLUG})
    if k.status_code != 200:
        emps = requests.get(f"{API}/employees", headers=ah).json()
        a = next(e for e in emps if e["name"] == "Anita Sewdas")
        p = {"name": a["name"], "role": a.get("role") or "", "app_role": "kiosk", "phone": a.get("phone") or "",
             "email": a.get("email") or "anita.iter122@demo.sr", "password": "anita1234", "pin": "4321",
             "monthly_salary": 0, "currency": "SRD", "active": True}
        requests.put(f"{API}/employees/{a['id']}", json=p, headers=ah)
        k = requests.post(f"{API}/auth/kiosk-pin", json={"pin": "4321", "company_slug": SLUG})
    assert k.status_code == 200, k.text
    j = k.json()
    return {"Authorization": f"Bearer {j.get('token') or j.get('access_token')}"}


@pytest.fixture(scope="module")
def ctx():
    ah = _admin()
    kh = _kiosk(ah)
    cid = mdb.companies.find_one({"slug": SLUG}, {"_id": 0, "id": 1})["id"]
    tag = "TEST_iter122_" + uuid.uuid4().hex[:6]
    # Seed apartment + tenant directly (bypasses plan limits)
    apt_id, ten_id = str(uuid.uuid4()), str(uuid.uuid4())
    now = "2026-01-01T00:00:00+00:00"
    mdb.apartments.insert_one({"id": apt_id, "company_id": cid, "number": tag, "address": "", "rent_amount": 1000.0,
                               "currency": "SRD", "status": "occupied", "tenant_id": ten_id, "location_id": None,
                               "description": "", "photo_url": "", "show_tenant_photo": False, "created_at": now})
    mdb.tenants.insert_one({"id": ten_id, "company_id": cid, "name": tag, "phone": "", "email": "",
                            "apartment_id": apt_id, "created_at": now})
    c = {"ah": ah, "kh": kh, "cid": cid, "tag": tag, "apt": apt_id, "ten": ten_id, "pays": [], "invs": []}
    yield c
    for pid in c["pays"]:
        requests.delete(f"{API}/payments/{pid}", params={"also_delete_invoices": "false"}, headers=ah)
    mdb.payments.delete_many({"tenant_id": ten_id})
    mdb.invoices.delete_many({"tenant_id": ten_id})
    mdb.invoices.delete_many({"invoice_number": {"$regex": "^TEST_iter122"}})
    mdb.tenants.delete_many({"name": {"$regex": "^TEST_iter122"}})
    mdb.apartments.delete_many({"number": {"$regex": "^TEST_iter122"}})
    mdb.locations.delete_many({"name": {"$regex": "^TEST_iter122"}})


def _reset(c):
    # isolate tests: drop this test tenant's invoices/payments from prior tests
    mdb.payments.delete_many({"tenant_id": c["ten"]})
    mdb.invoices.delete_many({"tenant_id": c["ten"]})
    c["pays"].clear()


def _mk_invoice(c, month, year=2020, init_paid=True):
    r = requests.post(f"{API}/invoices", json={"tenant_id": c["ten"], "period_month": month, "period_year": year},
                      headers=c["ah"])
    assert r.status_code == 200, r.text
    c["invs"].append(r.json()["id"])
    assert r.json()["amount"] == 1000.0
    if init_paid:
        # Work around double-count bug (see test_partial_payment_on_fresh_invoice_no_double_count)
        mdb.invoices.update_one({"id": r.json()["id"]}, {"$set": {"paid_amount": 0.0}})
    return r.json()["id"]


def _inv(iid):
    return mdb.invoices.find_one({"id": iid}, {"_id": 0})


def _pay(c, amount, inv_id, kiosk=False):
    body = {"tenant_id": c["ten"], "amount": amount, "currency": "SRD", "method": "contant", "category": "huur",
            "note": "TEST_iter122", "invoice_ids": [inv_id]}
    url = f"{API}/kiosk/payments" if kiosk else f"{API}/payments"
    r = requests.post(url, json=body, headers=c["kh"] if kiosk else c["ah"])
    assert r.status_code == 200, r.text
    c["pays"].append(r.json()["id"])
    return r.json()["id"]


def _apt_status(c):
    apts = requests.get(f"{API}/kiosk/apartments", headers=c["kh"]).json()
    a = next((x for x in apts if x["id"] == c["apt"]), None)
    return a and a.get("pay_status")


def _del_pay(c, pid):
    r = requests.delete(f"{API}/payments/{pid}", params={"also_delete_invoices": "false"}, headers=c["ah"])
    assert r.status_code == 200, r.text
    c["pays"].remove(pid)
    return r.json()


# Admin payment 96% -> partial, remainder -> paid; delete reverts
def test_admin_96pct_partial_then_paid_and_delete_revert(ctx):
    iid = _mk_invoice(ctx, 1)
    assert _apt_status(ctx) == "unpaid"
    p1 = _pay(ctx, 960, iid)
    inv = _inv(iid)
    assert inv["status"] == "partial", inv
    assert round(inv["paid_amount"], 2) == 960.0
    assert _apt_status(ctx) == "partial"
    # admin /invoices list shows partial immediately
    li = next(i for i in requests.get(f"{API}/invoices", headers=ctx["ah"]).json() if i["id"] == iid)
    assert li["status"] == "partial"
    # 99.99% still partial
    p_small = _pay(ctx, 39.99, iid)
    assert _inv(iid)["status"] == "partial"
    assert _apt_status(ctx) == "partial"
    p2 = _pay(ctx, 0.01, iid)
    inv = _inv(iid)
    assert inv["status"] == "paid", inv
    assert round(inv["paid_amount"], 2) == 1000.0
    assert _apt_status(ctx) == "paid"
    # delete remainder payments -> back to partial
    _del_pay(ctx, p2)
    _del_pay(ctx, p_small)
    inv = _inv(iid)
    assert inv["status"] == "partial", inv
    assert round(inv["paid_amount"], 2) == 960.0
    assert _apt_status(ctx) == "partial"
    _del_pay(ctx, p1)
    inv = _inv(iid)
    assert inv["status"] == "open", inv
    assert round(inv["paid_amount"], 2) == 0.0
    assert _apt_status(ctx) == "unpaid"


# Kiosk payment 96% -> partial, remainder -> paid
def test_kiosk_96pct_partial_then_paid(ctx):
    _reset(ctx)
    iid = _mk_invoice(ctx, 2)
    p1 = _pay(ctx, 960, iid, kiosk=True)
    inv = _inv(iid)
    assert inv["status"] == "partial", inv
    assert round(inv["paid_amount"], 2) == 960.0
    assert _apt_status(ctx) == "partial"
    p2 = _pay(ctx, 40, iid, kiosk=True)
    assert _inv(iid)["status"] == "paid"
    _del_pay(ctx, p2)
    _del_pay(ctx, p1)
    assert _inv(iid)["status"] == "open"


# Reassign: 96% payment moves from inv A to inv B -> A open, B partial; full payment move
def test_reassign_invoice_threshold(ctx):
    _reset(ctx)
    a = _mk_invoice(ctx, 3)
    b = _mk_invoice(ctx, 4)
    p = _pay(ctx, 960, a)
    assert _inv(a)["status"] == "partial"
    r = requests.post(f"{API}/payments/{p}/reassign-invoice", json={"invoice_id": b}, headers=ctx["ah"])
    assert r.status_code == 200, r.text
    assert _inv(a)["status"] == "open" and round(_inv(a)["paid_amount"], 2) == 0
    assert _inv(b)["status"] == "partial" and round(_inv(b)["paid_amount"], 2) == 960.0
    # top up b to 1000 -> paid, then reassign 40 payment back to a -> b partial, a partial
    p40 = _pay(ctx, 40, b)
    assert _inv(b)["status"] == "paid"
    r = requests.post(f"{API}/payments/{p40}/reassign-invoice", json={"invoice_id": a}, headers=ctx["ah"])
    assert r.status_code == 200, r.text
    assert _inv(b)["status"] == "partial", _inv(b)
    assert _inv(a)["status"] == "partial", _inv(a)
    _del_pay(ctx, p40)
    _del_pay(ctx, p)
    assert _inv(a)["status"] == "open" and _inv(b)["status"] == "open"


# Direct-Mongo changes (bypassing middleware) appear immediately: proves no in-memory caches
def test_no_cache_direct_db_changes(ctx):
    ah, kh, cid, tag = ctx["ah"], ctx["kh"], ctx["cid"], ctx["tag"]
    # warm all endpoints twice
    for _ in range(2):
        s0 = requests.get(f"{API}/admin/stats", headers=ah).json()
        i0 = requests.get(f"{API}/invoices", headers=ah).json()
        g0 = requests.get(f"{API}/invoices/grouped", headers=ah).json()
        t0 = requests.get(f"{API}/tenants/paged", params={"limit": 25}, headers=ah).json()
        l0 = requests.get(f"{API}/kiosk/locations", headers=kh).json()
        a0 = requests.get(f"{API}/kiosk/apartments", headers=kh).json()
    t_start = time.time()
    # direct inserts
    loc_id, apt2, ten2, inv2 = (str(uuid.uuid4()) for _ in range(4))
    mdb.locations.insert_one({"id": loc_id, "company_id": cid, "name": tag + "_loc", "address": "", "photo_url": "",
                              "created_at": "2026-01-01T00:00:00+00:00"})
    mdb.apartments.insert_one({"id": apt2, "company_id": cid, "number": tag + "_B", "address": "", "rent_amount": 500.0,
                               "currency": "SRD", "status": "occupied", "tenant_id": ten2, "location_id": loc_id,
                               "description": "", "photo_url": "", "created_at": "2026-01-01T00:00:00+00:00"})
    mdb.tenants.insert_one({"id": ten2, "company_id": cid, "name": tag + "_T2", "phone": "", "email": "",
                            "apartment_id": apt2, "created_at": "2026-01-01T00:00:00+00:00"})
    mdb.invoices.insert_one({"id": inv2, "company_id": cid, "invoice_number": tag + "_INV", "tenant_id": ten2,
                             "apartment_id": apt2, "amount": 500.0, "currency": "SRD", "period_month": 1,
                             "period_year": 2020, "status": "open", "paid_amount": 0,
                             "due_date": "2020-01-10", "invoice_date": "2020-01-01", "created_at": "2099-01-01T00:00:00+00:00"})
    s1 = requests.get(f"{API}/admin/stats", headers=ah).json()
    i1 = requests.get(f"{API}/invoices", headers=ah).json()
    g1 = requests.get(f"{API}/invoices/grouped", params={"tenant_id": ten2}, headers=ah).json()
    t1 = requests.get(f"{API}/tenants/paged", params={"id": ten2}, headers=ah).json()
    l1 = requests.get(f"{API}/kiosk/locations", headers=kh).json()
    a1 = requests.get(f"{API}/kiosk/apartments", headers=kh).json()
    elapsed = time.time() - t_start
    print("elapsed", elapsed)
    assert s1["tenants_total"] == s0["tenants_total"] + 1, (s0["tenants_total"], s1["tenants_total"])
    assert s1["apartments_total"] == s0["apartments_total"] + 1
    assert any(i["id"] == inv2 for i in i1), "invoice inserted in mongo not in /invoices"
    assert inv2 not in {i["id"] for i in i0}
    assert ten2 in str(g1), "grouped invoices stale"
    assert ten2 in str(t1), "tenants/paged stale"
    assert any(x["id"] == loc_id for x in l1), "kiosk/locations stale"
    assert any(x["id"] == apt2 and x["pay_status"] == "unpaid" for x in a1), "kiosk/apartments stale"
    # direct DB edit of invoice -> 96% paid -> partial, immediately
    mdb.invoices.update_one({"id": inv2}, {"$set": {"paid_amount": 480.0, "status": "partial"}})
    a2 = requests.get(f"{API}/kiosk/apartments", headers=kh).json()
    assert next(x for x in a2 if x["id"] == apt2)["pay_status"] == "partial"
    i2 = next(i for i in requests.get(f"{API}/invoices", headers=ah).json() if i["id"] == inv2)
    assert i2["status"] == "partial"
    # stale-status 96% paid with status open -> still partial (not paid) in kiosk list
    mdb.invoices.update_one({"id": inv2}, {"$set": {"paid_amount": 480.0, "status": "open"}})
    a3 = requests.get(f"{API}/kiosk/apartments", headers=kh).json()
    assert next(x for x in a3 if x["id"] == apt2)["pay_status"] == "partial"
    # direct apartment edit (rename) visible immediately
    mdb.apartments.update_one({"id": apt2}, {"$set": {"number": tag + "_B_renamed"}})
    a4 = requests.get(f"{API}/kiosk/apartments", headers=kh).json()
    assert next(x for x in a4 if x["id"] == apt2)["number"] == tag + "_B_renamed"
    # direct delete visible immediately
    s_before = requests.get(f"{API}/admin/stats", headers=ah).json()
    mdb.tenants.delete_one({"id": ten2})
    mdb.locations.delete_one({"id": loc_id})
    mdb.invoices.delete_one({"id": inv2})
    s5 = requests.get(f"{API}/admin/stats", headers=ah).json()
    l5 = requests.get(f"{API}/kiosk/locations", headers=kh).json()
    i5 = requests.get(f"{API}/invoices", headers=ah).json()
    assert s5["tenants_total"] == s_before["tenants_total"] - 1
    assert not any(x["id"] == loc_id for x in l5)
    assert not any(i["id"] == inv2 for i in i5)
    mdb.apartments.delete_one({"id": apt2})


# Payment via API -> stats/invoices reflect on the very next request
def test_api_mutation_visible_next_request(ctx):
    _reset(ctx)
    ah = ctx["ah"]
    iid = _mk_invoice(ctx, 5)
    s0 = requests.get(f"{API}/admin/stats", headers=ah).json()
    requests.get(f"{API}/invoices", headers=ah)
    p = _pay(ctx, 960, iid)
    li = next(i for i in requests.get(f"{API}/invoices", headers=ah).json() if i["id"] == iid)
    assert li["status"] == "partial" and round(float(li.get("paid_amount") or 0), 2) == 960.0
    s1 = requests.get(f"{API}/admin/stats", headers=ah).json()
    assert s1["invoice_status"] != s0["invoice_status"] or s1["recent_activity"] != s0["recent_activity"]
    _del_pay(ctx, p)
    li = next(i for i in requests.get(f"{API}/invoices", headers=ah).json() if i["id"] == iid)
    assert li["status"] == "open"
    s2 = requests.get(f"{API}/admin/stats", headers=ah).json()
    assert s2["invoice_status"] == s0["invoice_status"]


# BUG: partial payment (>50%) on invoice without paid_amount field double-counts via overflow
def test_partial_payment_on_fresh_invoice_no_double_count(ctx):
    _reset(ctx)
    a = _mk_invoice(ctx, 7, init_paid=False)
    b = _mk_invoice(ctx, 8, init_paid=False)
    r = requests.post(f"{API}/payments", json={"tenant_id": ctx["ten"], "amount": 960, "currency": "SRD",
                                               "method": "contant", "category": "huur", "note": "TEST_iter122"},
                      headers=ctx["ah"])
    assert r.status_code == 200
    ctx["pays"].append(r.json()["id"])
    pa, pb = _inv(a).get("paid_amount") or 0, _inv(b).get("paid_amount") or 0
    assert round(pa + pb, 2) == 960.0, f"960 payment credited {pa}+{pb}"
