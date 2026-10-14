"""Iter91: Kiosk WebSocket after chat removal.

Verifies:
- Employee WS: auth, device_config on connect, ping keeps alive, PRINT_RECEIPT logs,
  legacy chat_send/chat_history silently ignored (no close).
- Admin WS: device_config + presence; presence_changed on employee connect/BYE;
  arbitrary / non-JSON messages don't crash the socket.
- Remote print flow still works (printer role + REST trigger -> REMOTE_PRINT_DONE).
- kiosk_chat collection no longer exists.
"""
import asyncio
import json
import os
import time
import pytest
import websockets
from pymongo import MongoClient

BASE_HTTP = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
BASE_WS = BASE_HTTP.replace("https://", "wss://").replace("http://", "ws://")
WS_URL = f"{BASE_WS}/api/kiosk/ws"

with open("/tmp/iter85_ctx.json") as _f:
    CTX = json.load(_f)

ADMIN_TOKEN = CTX["admin_token"]
KIOSK_TOKEN = CTX["kiosk_token"]
PAYMENT_ID = CTX["payment_id"]
PRINTER_TOKEN = CTX["device_token"]
PRINTER_ID = CTX["printer_id"]
EMP_NAME = CTX["employee"]["name"]
EMP_ID = CTX["employee"]["id"]


async def _recv_until(ws, pred, timeout=5.0, collect=False):
    end = time.time() + timeout
    collected = []
    while time.time() < end:
        try:
            raw = await asyncio.wait_for(ws.recv(), timeout=end - time.time())
        except asyncio.TimeoutError:
            break
        try:
            ev = json.loads(raw)
        except Exception:
            continue
        collected.append(ev)
        if pred(ev):
            return (collected, ev) if collect else ev
    return (collected, None) if collect else None


@pytest.mark.asyncio
async def test_kiosk_chat_collection_dropped():
    c = MongoClient("mongodb://localhost:27017")
    names = c["vastgoed_kiosk"].list_collection_names()
    assert "kiosk_chat" not in names


@pytest.mark.asyncio
async def test_employee_ws_connect_and_device_config():
    async with websockets.connect(WS_URL, open_timeout=10) as ws:
        await ws.send(json.dumps({"role": "employee", "token": KIOSK_TOKEN, "name": EMP_NAME,
                                  "employee_id": EMP_ID}))
        ev = await _recv_until(ws, lambda e: e.get("type") == "device_config", timeout=5)
        assert ev is not None, "expected device_config on connect"
        # ping keeps alive
        await ws.send(json.dumps({"type": "ping"}))
        await asyncio.sleep(0.3)
        # legacy chat messages must be silently ignored (no close)
        await ws.send(json.dumps({"type": "chat_send", "text": "hoi"}))
        await ws.send(json.dumps({"type": "chat_history"}))
        await asyncio.sleep(0.5)
        # still connected: send BYE
        await ws.send(json.dumps({"type": "BYE"}))


@pytest.mark.asyncio
async def test_admin_ws_presence_and_ignores_garbage():
    async with websockets.connect(WS_URL, open_timeout=10) as admin:
        await admin.send(json.dumps({"role": "admin", "token": KIOSK_TOKEN, "admin_token": ADMIN_TOKEN}))
        got = await _recv_until(admin, lambda e: e.get("type") == "device_config", timeout=5)
        assert got is not None
        pres = await _recv_until(admin, lambda e: e.get("type") == "presence", timeout=5)
        assert pres is not None
        assert "employees" in pres and "printers" in pres

        # Garbage messages should not close the admin socket
        await admin.send(json.dumps({"type": "chat_threads"}))
        await admin.send("not-json-plain-text")
        await asyncio.sleep(0.5)

        # Connect an employee -> admin should see presence_changed -> presence update
        async with websockets.connect(WS_URL, open_timeout=10) as emp:
            await emp.send(json.dumps({"role": "employee", "token": KIOSK_TOKEN, "name": EMP_NAME,
                                       "employee_id": EMP_ID}))
            upd = await _recv_until(admin, lambda e: e.get("type") == "presence" and e.get("active"), timeout=5)
            assert upd is not None, "admin did not receive presence update on emp connect"
            await emp.send(json.dumps({"type": "BYE"}))

        # admin should still be alive and get presence update after BYE
        upd2 = await _recv_until(admin, lambda e: e.get("type") == "presence", timeout=5)
        assert upd2 is not None


@pytest.mark.asyncio
async def test_employee_print_receipt_reaches_admin_and_log():
    # Clean prior log row for this payment
    MongoClient("mongodb://localhost:27017")["vastgoed_kiosk"].kiosk_print_log.delete_many(
        {"payment_id": PAYMENT_ID}
    )
    async with websockets.connect(WS_URL, open_timeout=10) as admin:
        await admin.send(json.dumps({"role": "admin", "token": KIOSK_TOKEN, "admin_token": ADMIN_TOKEN}))
        await _recv_until(admin, lambda e: e.get("type") == "presence", timeout=5)

        async with websockets.connect(WS_URL, open_timeout=10) as emp:
            await emp.send(json.dumps({"role": "employee", "token": KIOSK_TOKEN,
                                       "name": EMP_NAME, "employee_id": EMP_ID}))
            await _recv_until(emp, lambda e: e.get("type") == "device_config", timeout=5)
            await emp.send(json.dumps({"type": "PRINT_RECEIPT", "payment_id": PAYMENT_ID}))
            got = await _recv_until(admin, lambda e: e.get("type") == "PRINT_RECEIPT"
                                    and e.get("payment_id") == PAYMENT_ID, timeout=5)
            assert got is not None, "admin did not receive PRINT_RECEIPT"
            await emp.send(json.dumps({"type": "BYE"}))

    log = MongoClient("mongodb://localhost:27017")["vastgoed_kiosk"].kiosk_print_log.find_one(
        {"payment_id": PAYMENT_ID}
    )
    assert log is not None, "print log row not created"
    assert log.get("printed_at")


@pytest.mark.asyncio
async def test_remote_print_flow():
    import requests
    # Printer connects
    async with websockets.connect(WS_URL, open_timeout=10) as printer:
        await printer.send(json.dumps({"role": "printer", "device_token": PRINTER_TOKEN}))
        # printer may receive initial device_config; no assert — just drain briefly
        await asyncio.sleep(0.3)

        async with websockets.connect(WS_URL, open_timeout=10) as admin:
            await admin.send(json.dumps({"role": "admin", "token": KIOSK_TOKEN, "admin_token": ADMIN_TOKEN}))
            await _recv_until(admin, lambda e: e.get("type") == "presence", timeout=5)

            # Trigger remote print via REST
            r = requests.post(
                f"{BASE_HTTP}/api/kiosk/print-log/by-payment/{PAYMENT_ID}/remote-print",
                json={"printer_id": PRINTER_ID},
                cookies={"kiosk_token": KIOSK_TOKEN},
                timeout=10,
            )
            assert r.status_code in (200, 201), f"remote-print REST failed: {r.status_code} {r.text}"
            job_id_rest = r.json().get("job_id")

            # Printer must receive REMOTE_PRINT
            rp = await _recv_until(printer, lambda e: e.get("type") == "REMOTE_PRINT"
                                   and e.get("target") == PRINTER_ID, timeout=6)
            assert rp is not None, "printer did not receive REMOTE_PRINT"
            job_id = rp.get("job_id")

            # Simulate printer completing
            await printer.send(json.dumps({"type": "REMOTE_PRINT_DONE", "job_id": job_id,
                                           "payment_id": PAYMENT_ID, "ok": True}))

            done = await _recv_until(admin, lambda e: e.get("type") == "REMOTE_PRINT_DONE"
                                     and e.get("payment_id") == PAYMENT_ID, timeout=6)
            assert done is not None, "admin did not receive REMOTE_PRINT_DONE"
