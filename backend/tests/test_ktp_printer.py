"""Backend tests for KT-V520 remote-print feature.

Tests:
- POST /api/kiosk/printers/register -> {printer_id, name, device_token}
- GET/PATCH/DELETE /api/settings/kiosk-printers(/{id}) as admin
- WS /api/kiosk/ws printer role -> printer_ready; invalid/revoked token -> close 4401
- WS admin presence contains printers[] online
- POST /api/kiosk/print-log/by-payment/{pid}/remote-print offline -> 409
- Full flow: printer online + admin triggers remote-print + printer replies DONE,
  verifies admin WS receives REMOTE_PRINT_DONE and db kiosk_print_log.admin_printed_at set.
"""
import asyncio
import json
import os
import sys
import time
import uuid

import pytest
import requests
import websockets
from dotenv import load_dotenv

sys.path.insert(0, "/app/backend")
load_dotenv("/app/backend/.env")

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
WS_URL = BASE_URL.replace("http", "ws") + "/api/kiosk/ws"
CID = "demo-company-fixed-uuid-00000000000"


def _mint_kiosk_token():
    import server
    return server.create_token({"sub": "kiosk", "type": "kiosk", "company_id": CID}, 60)


@pytest.fixture(scope="module")
def kiosk_token():
    return _mint_kiosk_token()


@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": "demo@surirent.sr", "password": "demo1234"})
    assert r.status_code == 200, r.text
    tok = r.json().get("token") or r.json().get("access_token")
    assert tok
    s.headers.update({"Authorization": f"Bearer {tok}"})
    s.admin_token = tok
    return s


@pytest.fixture(scope="module")
def admin_token(admin_session):
    return admin_session.admin_token


# --- Cleanup ---
@pytest.fixture(scope="module", autouse=True)
def cleanup_printers(admin_session):
    yield
    try:
        r = admin_session.get(f"{BASE_URL}/api/settings/kiosk-printers")
        for p in r.json():
            if "TEST_" in p["name"] or p["name"].startswith("KT-V520 #"):
                admin_session.delete(f"{BASE_URL}/api/settings/kiosk-printers/{p['id']}")
    except Exception as e:  # noqa: BLE001
        print(f"cleanup err: {e}")


# --- 1. Register printer ---
def test_register_printer_requires_kiosk_session():
    r = requests.post(f"{BASE_URL}/api/kiosk/printers/register", json={})
    assert r.status_code in (401, 403)


def test_register_printer_with_kiosk_token(kiosk_token):
    r = requests.post(f"{BASE_URL}/api/kiosk/printers/register",
                      json={"name": "TEST_Toestel A"},
                      cookies={"kiosk_token": kiosk_token})
    assert r.status_code == 200, r.text
    data = r.json()
    assert "printer_id" in data
    assert data["name"] == "TEST_Toestel A"
    assert isinstance(data["device_token"], str)
    assert len(data["device_token"]) >= 20


# --- 2. Settings endpoints ---
def test_kiosk_printers_list_rename_delete(admin_session, kiosk_token):
    # Create one
    r = requests.post(f"{BASE_URL}/api/kiosk/printers/register",
                      json={"name": "TEST_Rename Me"},
                      cookies={"kiosk_token": kiosk_token})
    pid = r.json()["printer_id"]

    # GET list
    lst = admin_session.get(f"{BASE_URL}/api/settings/kiosk-printers").json()
    assert any(p["id"] == pid and p["name"] == "TEST_Rename Me" for p in lst)
    assert all("online" in p for p in lst)

    # PATCH rename
    r2 = admin_session.patch(f"{BASE_URL}/api/settings/kiosk-printers/{pid}", json={"name": "TEST_Renamed"})
    assert r2.status_code == 200
    lst2 = admin_session.get(f"{BASE_URL}/api/settings/kiosk-printers").json()
    assert any(p["id"] == pid and p["name"] == "TEST_Renamed" for p in lst2)

    # Rename empty -> 400
    r3 = admin_session.patch(f"{BASE_URL}/api/settings/kiosk-printers/{pid}", json={"name": "  "})
    assert r3.status_code == 400

    # DELETE
    r4 = admin_session.delete(f"{BASE_URL}/api/settings/kiosk-printers/{pid}")
    assert r4.status_code == 200
    lst3 = admin_session.get(f"{BASE_URL}/api/settings/kiosk-printers").json()
    assert not any(p["id"] == pid for p in lst3)

    # Not found
    r5 = admin_session.delete(f"{BASE_URL}/api/settings/kiosk-printers/does-not-exist")
    assert r5.status_code == 404


# --- 3. WS printer invalid token -> 4401 ---
@pytest.mark.asyncio
async def test_printer_ws_invalid_token_closes_4401():
    async with websockets.connect(WS_URL) as ws:
        await ws.send(json.dumps({"type": "auth", "role": "printer", "device_token": "x" * 40}))
        try:
            await ws.recv()
        except websockets.ConnectionClosed as e:
            assert e.code == 4401
            return
        pytest.fail("Expected close")


# --- 4. Full flow: register -> printer WS ready -> presence -> remote-print 409 then OK -> DONE ---
async def _mint_admin_access():
    """Need admin access_token in-process; using login endpoint."""
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": "demo@surirent.sr", "password": "demo1234"})
    return r.json().get("token") or r.json().get("access_token")


async def _create_payment():
    """Create a kiosk payment in Mongo directly (test harness)."""
    import os as _os
    from motor.motor_asyncio import AsyncIOMotorClient
    client = AsyncIOMotorClient(_os.environ["MONGO_URL"])
    db = client[_os.environ["DB_NAME"]]
    pid = "TEST_" + str(uuid.uuid4())
    rn = "TEST-" + uuid.uuid4().hex[:8]
    await db.payments.insert_one({
        "id": pid, "company_id": CID, "tenant_name": "TEST Tenant",
        "receipt_number": rn, "amount": 100, "currency": "SRD",
        "status": "approved", "method": "cash", "created_at": time.time(),
        "kiosk_employee_id": "test-emp", "kiosk_employee_name": "Test Kiosker",
    })
    yield pid, db
    await db.payments.delete_one({"id": pid})
    await db.kiosk_print_log.delete_many({"company_id": CID, "payment_id": pid})
    client.close()


@pytest.mark.asyncio
async def test_full_remote_print_flow(kiosk_token, admin_token):
    # 1) Register printer
    reg = requests.post(f"{BASE_URL}/api/kiosk/printers/register",
                        json={"name": "TEST_Flow Printer"},
                        cookies={"kiosk_token": kiosk_token})
    assert reg.status_code == 200
    device_token = reg.json()["device_token"]
    printer_id = reg.json()["printer_id"]

    # Create a payment doc for testing
    gen = _create_payment()
    payment_id, db = await gen.__anext__()

    # 2) Offline remote-print -> 409
    offline = requests.post(
        f"{BASE_URL}/api/kiosk/print-log/by-payment/{payment_id}/remote-print",
        json={"printer_id": printer_id}, cookies={"kiosk_token": kiosk_token})
    assert offline.status_code == 409, offline.text

    # 3) Open printer WS
    async with websockets.connect(WS_URL) as printer_ws:
        await printer_ws.send(json.dumps({"type": "auth", "role": "printer", "device_token": device_token}))
        hello = json.loads(await asyncio.wait_for(printer_ws.recv(), timeout=5))
        assert hello["type"] == "printer_ready"
        assert hello["name"] == "TEST_Flow Printer"

        # 4) Open admin WS, expect presence with printer online
        async with websockets.connect(WS_URL) as admin_ws:
            await admin_ws.send(json.dumps({"type": "auth", "role": "admin", "token": kiosk_token, "admin_token": admin_token}))
            # Collect presence
            found_printer = False
            for _ in range(10):
                raw = await asyncio.wait_for(admin_ws.recv(), timeout=5)
                m = json.loads(raw)
                if m.get("type") == "presence" and any(p["id"] == printer_id for p in m.get("printers", [])):
                    found_printer = True
                    break
            assert found_printer, "printer not visible in admin presence"

            # 5) Trigger remote-print
            r = requests.post(
                f"{BASE_URL}/api/kiosk/print-log/by-payment/{payment_id}/remote-print",
                json={"printer_id": printer_id}, cookies={"kiosk_token": kiosk_token})
            assert r.status_code == 200, r.text
            job_id = r.json()["job_id"]

            # 6) Printer should receive REMOTE_PRINT
            rp = json.loads(await asyncio.wait_for(printer_ws.recv(), timeout=5))
            assert rp["type"] == "REMOTE_PRINT"
            assert rp["job_id"] == job_id
            assert rp["payment_id"] == payment_id
            assert "data" in rp

            # 7) Printer replies DONE
            await printer_ws.send(json.dumps({
                "type": "REMOTE_PRINT_DONE", "job_id": job_id, "payment_id": payment_id, "ok": True}))

            # 8) Admin WS should receive REMOTE_PRINT_DONE with printer name
            got_done = None
            for _ in range(10):
                raw = await asyncio.wait_for(admin_ws.recv(), timeout=5)
                m = json.loads(raw)
                if m.get("type") == "REMOTE_PRINT_DONE" and m.get("job_id") == job_id:
                    got_done = m
                    break
            assert got_done, "Admin never got REMOTE_PRINT_DONE"
            assert got_done["ok"] is True
            assert got_done["printer"] == "TEST_Flow Printer"

            # 9) Verify db kiosk_print_log.admin_printed_at set
            await asyncio.sleep(0.3)
            log = await db.kiosk_print_log.find_one({"company_id": CID, "payment_id": payment_id})
            assert log is not None
            assert log.get("admin_printed_at")

    # 10) Revoke printer -> next WS auth should close 4401
    import requests as _r
    sess = _r.Session()
    sess.headers.update({"Authorization": f"Bearer {admin_token}"})
    sess.delete(f"{BASE_URL}/api/settings/kiosk-printers/{printer_id}")

    async with websockets.connect(WS_URL) as ws2:
        await ws2.send(json.dumps({"type": "auth", "role": "printer", "device_token": device_token}))
        try:
            await asyncio.wait_for(ws2.recv(), timeout=3)
            pytest.fail("Expected close after revoke")
        except websockets.ConnectionClosed as e:
            assert e.code == 4401

    # Cleanup payment
    try:
        await gen.__anext__()
    except StopAsyncIteration:
        pass
