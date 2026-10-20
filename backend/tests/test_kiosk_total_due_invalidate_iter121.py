# Iter121: kiosk overview total_due/is_paid + cache/WS invalidation after admin payment
import asyncio
import json
import os
import time

import pytest
import requests
import websockets

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE}/api"
WS_URL = BASE.replace("https://", "wss://").replace("http://", "ws://") + "/api/kiosk/ws"
SLUG = "my-awesome-rentals-bv"


def _admin():
    r = requests.post(f"{API}/auth/login", json={"email": "demo@surirent.sr", "password": "demo1234"})
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _ensure_kiosk(ah):
    k = requests.post(f"{API}/auth/kiosk-pin", json={"pin": "4321", "company_slug": SLUG})
    if k.status_code != 200:
        emps = requests.get(f"{API}/employees", headers=ah).json()
        a = next(e for e in emps if e["name"] == "Anita Sewdas")
        p = {"name": a["name"], "role": a.get("role") or "", "app_role": "kiosk", "phone": a.get("phone") or "",
             "email": a.get("email") or "anita.iter121@demo.sr", "password": "anita1234", "pin": "4321",
             "monthly_salary": 0, "currency": "SRD", "active": True}
        requests.put(f"{API}/employees/{a['id']}", json=p, headers=ah)
        k = requests.post(f"{API}/auth/kiosk-pin", json={"pin": "4321", "company_slug": SLUG})
    assert k.status_code == 200, k.text
    j = k.json()
    return j.get("token") or j.get("access_token"), j


@pytest.fixture(scope="module")
def ctx():
    ah = _admin()
    kt, kj = _ensure_kiosk(ah)
    kh = {"Authorization": f"Bearer {kt}"}
    created = []
    yield {"ah": ah, "kh": kh, "kt": kt, "kj": kj, "created": created}
    for pid in created:
        requests.delete(f"{API}/payments/{pid}", params={"also_delete_invoices": "false"}, headers=ah)


def _tenants(kh):
    apts = requests.get(f"{API}/kiosk/apartments", headers=kh).json()
    return [a for a in apts if a.get("tenant_id")]


# total_due / is_paid on kiosk overview for every tenant
def test_kiosk_overview_total_due_is_paid(ctx):
    for a in _tenants(ctx["kh"]):
        r = requests.get(f"{API}/kiosk/tenants/{a['tenant_id']}/overview", headers=ctx["kh"])
        assert r.status_code == 200
        ov = r.json()
        exp = round(float(ov["open_invoices_total"]) + float(ov["current_invoices_total"]), 2)
        assert ov["total_due"] == exp, (a["number"], ov["total_due"], exp)
        assert ov["is_paid"] is (exp <= 0.005)
        assert isinstance(ov["is_paid"], bool)


# tenant-portal overview total_due/is_paid equals kiosk overview
def test_tenant_portal_overview_matches_kiosk(ctx):
    tens = _tenants(ctx["kh"])
    checked = 0
    for i, a in enumerate(tens[:3]):
        pin = f"739{1 + i}"
        r = requests.post(f"{API}/auth/tenant-set-pin", json={"tenant_id": a["tenant_id"], "pin": pin}, headers=ctx["ah"])
        if r.status_code != 200:
            continue
        kov = requests.get(f"{API}/kiosk/tenants/{a['tenant_id']}/overview", headers=ctx["kh"]).json()
        email = kov["tenant"].get("email")
        lr = requests.post(f"{API}/tenant-portal/login", json={"identifier": email, "pin": pin})
        if lr.status_code != 200:
            continue
        tt = lr.json().get("token") or lr.json().get("access_token")
        tov = requests.get(f"{API}/tenant-portal/overview", headers={"Authorization": f"Bearer {tt}"}).json()
        assert tov["total_due"] == kov["total_due"], (a["number"], tov["total_due"], kov["total_due"])
        assert tov["is_paid"] == kov["is_paid"]
        checked += 1
    assert checked >= 1


# admin payment -> kiosk apartments cache + overview fresh + WS overview_invalidate
@pytest.mark.asyncio
async def test_admin_payment_invalidates_kiosk(ctx):
    kh, ah = ctx["kh"], ctx["ah"]
    tens = _tenants(kh)
    target = None
    for a in tens:
        ov = requests.get(f"{API}/kiosk/tenants/{a['tenant_id']}/overview", headers=kh).json()
        if ov["total_due"] > 1000:
            target = (a, ov)
            # prefer a partial/unpaid with small due
            if a["pay_status"] == "partial":
                break
    assert target, "no tenant with open amount"
    a, ov0 = target
    tid = a["tenant_id"]
    # Warm 30s cache
    before = {x["tenant_id"]: x for x in _tenants(kh)}
    emp = ctx["kj"].get("employee") or {}
    async with websockets.connect(WS_URL, open_timeout=15) as ws:
        await ws.send(json.dumps({"role": "employee", "token": ctx["kt"], "name": emp.get("name") or "Anita Sewdas",
                                  "employee_id": emp.get("id") or "anita"}))
        await asyncio.sleep(1.0)
        amount = ov0["total_due"]  # pay full -> status must flip to paid
        cur = (ov0.get("apartment") or {}).get("currency") or "SRD"
        r = requests.post(f"{API}/payments", json={"tenant_id": tid, "amount": amount, "currency": cur,
                                                    "method": "contant", "category": "huur", "note": "TEST_iter121"},
                          headers=ah)
        assert r.status_code == 200, r.text
        ctx["created"].append(r.json()["id"])
        got = None
        end = time.time() + 8
        while time.time() < end:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=end - time.time())
            except asyncio.TimeoutError:
                break
            ev = json.loads(raw)
            if ev.get("type") == "overview_invalidate":
                got = ev
                break
        await ws.send(json.dumps({"type": "BYE"}))
    assert got is not None, "no overview_invalidate on employee WS"
    assert got["tenant_id"] == tid
    ov1 = requests.get(f"{API}/kiosk/tenants/{tid}/overview", headers=kh).json()
    assert ov1["total_due"] == 0.0, ov1["total_due"]
    assert ov1["is_paid"] is True
    after = {x["tenant_id"]: x for x in _tenants(kh)}
    print("pay_status", before[tid]["pay_status"], "->", after[tid]["pay_status"])
    assert after[tid]["pay_status"] == "paid"
