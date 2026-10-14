"""Iter 83 — Kiosk installment-pay returns `payment` + online-printers endpoint.

Covers the 2 backend bugs/features from this iteration:

1. POST /api/kiosk/payment-plans/{plan_id}/installments/{seq}/pay now returns
   a top-level `payment` object (enriched, with id + receipt_number) so the
   frontend can preview the receipt even in plan_only flows.
   Then GET /api/payments/{id}/print.html?preview=1&format=thermal returns 200
   HTML (no "Kwitantie niet gevonden").

2. GET /api/kiosk/printers/online under a kiosk session lists online printers
   (simulated by a WS `printer` role with a device_token obtained from
   POST /api/kiosk/printers/register).
"""
import asyncio
import json
import os
import sys
import uuid

import pytest
import requests
import websockets
from dotenv import load_dotenv

sys.path.insert(0, "/app/backend")
load_dotenv("/app/backend/.env")

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"
WS_URL = BASE_URL.replace("http", "ws") + "/api/kiosk/ws"

ADMIN_EMAIL = "demo@surirent.sr"
ADMIN_PASSWORD = "demo1234"


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{API}/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def me(admin_headers):
    r = requests.get(f"{API}/auth/me", headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def cid(me):
    return me.get("company_id")


@pytest.fixture(scope="module")
def kiosk_token(cid):
    import server
    return server.create_token({"sub": "kiosk", "type": "kiosk", "company_id": cid}, 60)


@pytest.fixture(scope="module")
def kiosk_headers(kiosk_token):
    return {"Authorization": f"Bearer {kiosk_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def tenant_id(admin_headers):
    r = requests.get(f"{API}/tenants", headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    tenants = r.json()
    assert tenants, "no tenants in demo company"
    return tenants[0]["id"]


@pytest.fixture(scope="module")
def plan(admin_headers, tenant_id):
    """Create a 3-installment plan via admin."""
    payload = {
        "tenant_id": tenant_id,
        "invoice_ids": [],
        "total_amount": 90.0,
        "currency": "SRD",
        "num_installments": 3,
        "start_date": "2026-02-01",
        "frequency": "monthly",
        "notes": "TEST_iter83 plan",
    }
    r = requests.post(f"{API}/payment-plans", headers=admin_headers, json=payload, timeout=15)
    assert r.status_code == 200, r.text
    p = r.json()
    yield p
    # cleanup: cancel the plan
    try:
        requests.post(f"{API}/payment-plans/{p['id']}/cancel", headers=admin_headers, timeout=10)
    except Exception:
        pass


# ---------- Tests: installment pay returns payment + receipt renders ----------
class TestInstallmentPayReturnsPayment:
    def test_pay_installment_returns_payment_with_id(self, kiosk_headers, plan, admin_headers):
        plan_id = plan["id"]
        r = requests.post(
            f"{API}/kiosk/payment-plans/{plan_id}/installments/1/pay",
            headers=kiosk_headers,
            json={"method": "contant", "note": "TEST_iter83 pay (approved, no emp)"},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert "payment" in d, f"missing `payment` in response: keys={list(d.keys())}"
        pay = d["payment"]
        assert pay.get("id"), f"payment.id missing: {pay}"
        assert pay.get("receipt_number"), f"payment.receipt_number missing: {pay}"
        # payment should be APPROVED (no employee_id supplied → status=approved)
        assert pay.get("status") in ("approved", "paid"), pay.get("status")

        # verify receipt-preview endpoint returns 200 HTML
        pay_id = pay["id"]
        rp = requests.get(
            f"{API}/payments/{pay_id}/print.html",
            params={"preview": 1, "format": "thermal"},
            headers=admin_headers,  # endpoint requires auth; admin works
            timeout=15,
        )
        assert rp.status_code == 200, f"print.html status={rp.status_code} body={rp.text[:200]}"
        body = rp.text
        assert "Kwitantie niet gevonden" not in body
        assert pay.get("receipt_number") in body or "Kwitantie" in body or "<html" in body.lower()

        # cleanup: void/cancel the payment is optional (approved status is fine);
        # the module teardown cancels the plan.


# ---------- Tests: online printers endpoint ----------
class TestKioskPrintersOnline:
    def test_online_endpoint_requires_kiosk(self):
        r = requests.get(f"{API}/kiosk/printers/online")
        assert r.status_code in (401, 403)

    def test_online_endpoint_returns_registered_printer_after_ws(self, kiosk_headers, admin_headers):
        # 1) register a printer under the kiosk session
        reg = requests.post(f"{API}/kiosk/printers/register", headers=kiosk_headers,
                            json={"name": "TEST_iter83 KT-V520"}, timeout=15)
        assert reg.status_code == 200, reg.text
        regj = reg.json()
        printer_id = regj["printer_id"]
        device_token = regj["device_token"]

        try:
            # 2) Not yet connected → offline (not in list)
            r = requests.get(f"{API}/kiosk/printers/online", headers=kiosk_headers, timeout=15)
            assert r.status_code == 200, r.text
            assert not any(p["id"] == printer_id for p in r.json()), \
                "printer should not be online before WS connect"

            # 3) Open WS as printer and send hello
            async def _ws_connect_and_list():
                async with websockets.connect(WS_URL, open_timeout=10) as ws:
                    await ws.send(json.dumps({
                        "role": "printer",
                        "device_token": device_token,
                        "device": {"ua": "TEST_iter83 printer", "ktp_detected": True},
                    }))
                    # wait for printer_ready
                    msg = await asyncio.wait_for(ws.recv(), timeout=10)
                    j = json.loads(msg)
                    assert j.get("type") == "printer_ready", j
                    # keep connection open & query the API
                    r2 = requests.get(f"{API}/kiosk/printers/online",
                                      headers=kiosk_headers, timeout=15)
                    assert r2.status_code == 200, r2.text
                    online = r2.json()
                    assert any(p["id"] == printer_id for p in online), \
                        f"printer not online: {online}"
                    match = next(p for p in online if p["id"] == printer_id)
                    assert match["name"] == "TEST_iter83 KT-V520"

            asyncio.get_event_loop().run_until_complete(_ws_connect_and_list()) \
                if sys.version_info < (3, 10) else asyncio.run(_ws_connect_and_list())
        finally:
            # cleanup: admin DELETE
            try:
                requests.delete(f"{API}/settings/kiosk-printers/{printer_id}",
                                headers=admin_headers, timeout=10)
            except Exception:
                pass
