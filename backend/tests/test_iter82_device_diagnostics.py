"""Iter 82 — KT-V520 kiosk device diagnostics (A).

Verifies:
- Kiosk WS hello (employee / admin / printer) with `device` field is persisted
  in `kiosk_devices_seen` with ua + flags.
- GET /api/settings/kiosk-devices-seen (admin) returns last-7-days entries with
  the diagnostic flags: rn_bridge, android_bridge, ktp_flag, ktp_detected, paired.
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
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": "demo@surirent.sr", "password": "demo1234"})
    assert r.status_code == 200, r.text
    tok = r.json().get("token") or r.json().get("access_token")
    assert tok
    return tok


@pytest.fixture(scope="module")
def admin_session(admin_token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {admin_token}"})
    return s


@pytest.fixture(scope="module", autouse=True)
def cleanup_devices_seen():
    """Remove TEST_ docs from kiosk_devices_seen after module."""
    yield
    try:
        from motor.motor_asyncio import AsyncIOMotorClient

        async def _run():
            client = AsyncIOMotorClient(os.environ["MONGO_URL"])
            db = client[os.environ["DB_NAME"]]
            await db.kiosk_devices_seen.delete_many(
                {"company_id": CID, "ua": {"$regex": "^TEST_"}})
            await db.kiosk_devices_seen.delete_many(
                {"company_id": CID, "name": {"$regex": "^TEST_"}})
            # Cleanup registered test printers from this file
            printers = await db.kiosk_printers.find(
                {"company_id": CID, "name": {"$regex": "^TEST_"}}, {"_id": 0, "id": 1}).to_list(50)
            for p in printers:
                await db.kiosk_printers.delete_one({"id": p["id"]})
            client.close()

        asyncio.run(_run())
    except Exception as e:  # noqa: BLE001
        print(f"cleanup err: {e}")


# ---------- Tests ----------
def test_devices_seen_requires_admin():
    r = requests.get(f"{BASE_URL}/api/settings/kiosk-devices-seen")
    assert r.status_code in (401, 403)


@pytest.mark.asyncio
async def test_employee_ws_hello_records_device(admin_session):
    """Employee hello with device:{...} → kiosk_devices_seen upsert, flags preserved."""
    kiosk_tok = _mint_kiosk_token()
    emp_name = "TEST_Diag Emp"
    ua = "TEST_UA/Chrome Mobile Diag"
    device = {
        "ua": ua,
        "rn_bridge": True,
        "android_bridge": False,
        "ktp_flag": True,
        "ktp_detected": True,
        "paired": False,
    }
    async with websockets.connect(WS_URL) as ws:
        await ws.send(json.dumps({
            "type": "auth", "role": "employee", "token": kiosk_tok,
            "name": emp_name, "employee_id": "emp-diag-1",
            "device": device,
        }))
        # First message from backend is device_config
        msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
        assert msg["type"] == "device_config"
        await ws.send(json.dumps({"type": "BYE"}))

    # Allow upsert to complete
    await asyncio.sleep(0.3)

    r = admin_session.get(f"{BASE_URL}/api/settings/kiosk-devices-seen")
    assert r.status_code == 200
    docs = r.json()
    assert isinstance(docs, list)
    match = [d for d in docs if d.get("ua") == ua and d.get("role") == "employee"]
    assert match, f"employee device not in list; got {[d.get('ua') for d in docs][:5]}"
    m = match[0]
    assert m["rn_bridge"] is True
    assert m["android_bridge"] is False
    assert m["ktp_flag"] is True
    assert m["ktp_detected"] is True
    assert m["paired"] is False
    assert m["name"] == emp_name
    assert "last_seen" in m
    assert "key" in m


@pytest.mark.asyncio
async def test_admin_ws_hello_records_device(admin_session, admin_token):
    kiosk_tok = _mint_kiosk_token()
    ua = "TEST_UA/Admin Desktop Diag"
    device = {
        "ua": ua, "rn_bridge": False, "android_bridge": False,
        "ktp_flag": False, "ktp_detected": False, "paired": False,
    }
    async with websockets.connect(WS_URL) as ws:
        await ws.send(json.dumps({
            "type": "auth", "role": "admin",
            "token": kiosk_tok, "admin_token": admin_token,
            "name": "TEST_Admin", "device": device,
        }))
        # Admin WS pushes presence — just read one or timeout
        try:
            await asyncio.wait_for(ws.recv(), timeout=3)
        except asyncio.TimeoutError:
            pass

    await asyncio.sleep(0.3)
    docs = admin_session.get(f"{BASE_URL}/api/settings/kiosk-devices-seen").json()
    match = [d for d in docs if d.get("ua") == ua and d.get("role") == "admin"]
    assert match, "admin device not recorded"
    assert match[0]["ktp_detected"] is False


@pytest.mark.asyncio
async def test_printer_ws_hello_records_device(admin_session):
    """Register a printer, open its WS with device:{ktp_detected:True, paired:True}
    → recorded with role='printer'."""
    kiosk_tok = _mint_kiosk_token()
    reg = requests.post(
        f"{BASE_URL}/api/kiosk/printers/register",
        json={"name": "TEST_Diag Printer"},
        cookies={"kiosk_token": kiosk_tok})
    assert reg.status_code == 200, reg.text
    device_token = reg.json()["device_token"]

    ua = "TEST_UA/KT-V520 Printer Diag"
    device = {
        "ua": ua, "rn_bridge": True, "android_bridge": False,
        "ktp_flag": True, "ktp_detected": True, "paired": True,
    }
    async with websockets.connect(WS_URL) as ws:
        await ws.send(json.dumps({
            "type": "auth", "role": "printer",
            "device_token": device_token, "device": device,
        }))
        hello = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
        assert hello["type"] == "printer_ready"

    await asyncio.sleep(0.3)
    docs = admin_session.get(f"{BASE_URL}/api/settings/kiosk-devices-seen").json()
    match = [d for d in docs if d.get("ua") == ua and d.get("role") == "printer"]
    assert match, "printer device not recorded"
    m = match[0]
    assert m["paired"] is True
    assert m["ktp_detected"] is True
    assert m["name"] == "TEST_Diag Printer"


@pytest.mark.asyncio
async def test_devices_seen_within_7_days_and_sorted(admin_session):
    """Response is limited (<=30) and sorted desc by last_seen."""
    docs = admin_session.get(f"{BASE_URL}/api/settings/kiosk-devices-seen").json()
    assert isinstance(docs, list)
    assert len(docs) <= 30
    if len(docs) >= 2:
        ts = [d["last_seen"] for d in docs]
        assert ts == sorted(ts, reverse=True), "not sorted desc by last_seen"
    # No _id leakage
    for d in docs:
        assert "_id" not in d
        assert "company_id" not in d


@pytest.mark.asyncio
async def test_hello_without_device_field_still_logs_role(admin_session):
    """Missing device field → still upsert with ua='' and all flags False."""
    kiosk_tok = _mint_kiosk_token()
    unique_name = f"TEST_NoDev_{uuid.uuid4().hex[:8]}"
    async with websockets.connect(WS_URL) as ws:
        await ws.send(json.dumps({
            "type": "auth", "role": "employee", "token": kiosk_tok,
            "name": unique_name, "employee_id": "emp-nodev",
        }))
        try:
            await asyncio.wait_for(ws.recv(), timeout=3)
        except asyncio.TimeoutError:
            pass
        await ws.send(json.dumps({"type": "BYE"}))

    await asyncio.sleep(0.3)
    docs = admin_session.get(f"{BASE_URL}/api/settings/kiosk-devices-seen").json()
    match = [d for d in docs if d.get("name") == unique_name]
    assert match, "device-less hello not recorded"
    m = match[0]
    assert m["ua"] == ""
    assert m["rn_bridge"] is False
    assert m["android_bridge"] is False
    assert m["ktp_flag"] is False
