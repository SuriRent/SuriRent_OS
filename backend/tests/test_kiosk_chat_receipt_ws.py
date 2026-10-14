"""Iter87 — Kiosk-chat receipt (bon) via chat: admin sends receipt_payment_id,
employee + admin receive chat with 'receipt' payload; invalid payment id → receipt null;
empty text + invalid id → nothing sent; chat_threads last_text = 'Bon verstuurd' when receipt-only.
"""
import asyncio
import json
import os
import time
import uuid

import pytest
import websockets

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://vastgoed-app.preview.emergentagent.com").rstrip("/")
WS_URL = BASE.replace("http", "ws") + "/api/kiosk/ws"


@pytest.fixture(scope="module")
def ctx():
    with open("/tmp/iter85_ctx.json") as f:
        return json.load(f)


async def _recv_until(ws, kind, emp_key=None, timeout=5.0):
    end = time.time() + timeout
    while time.time() < end:
        try:
            raw = await asyncio.wait_for(ws.recv(), timeout=max(0.01, end - time.time()))
        except asyncio.TimeoutError:
            return None
        msg = json.loads(raw)
        if msg.get("type") == kind and (emp_key is None or msg.get("emp_key") == emp_key):
            return msg
    return None


async def _drain(ws, duration=0.3):
    end = time.time() + duration
    out = []
    while time.time() < end:
        try:
            raw = await asyncio.wait_for(ws.recv(), timeout=max(0.01, end - time.time()))
            out.append(json.loads(raw))
        except asyncio.TimeoutError:
            break
    return out


async def _open_employee(kiosk_token, name, emp_id):
    ws = await websockets.connect(WS_URL)
    await ws.send(json.dumps({"type": "auth", "role": "employee", "token": kiosk_token,
                              "name": name, "employee_id": emp_id}))
    await _drain(ws, 0.3)
    return ws


async def _open_admin(admin_token, kiosk_token):
    ws = await websockets.connect(WS_URL)
    await ws.send(json.dumps({"type": "auth", "role": "admin", "token": kiosk_token,
                              "admin_token": admin_token}))
    await _drain(ws, 0.3)
    return ws


# ---------- Admin sends receipt via chat ----------
@pytest.mark.asyncio
async def test_admin_sends_receipt_in_chat(ctx):
    emp_key = f"emp-receipt-{uuid.uuid4().hex[:6]}"
    emp = await _open_employee(ctx["kiosk_token"], "Anita Sewdas", emp_key)
    admin = await _open_admin(ctx["admin_token"], ctx["kiosk_token"])
    try:
        cid = f"iter87-{uuid.uuid4().hex[:8]}"
        pid = ctx["payment_id"]
        # Admin sends receipt-only message (empty text + receipt_payment_id)
        await admin.send(json.dumps({"type": "chat_send", "emp_key": emp_key,
                                     "emp_name": "Anita Sewdas", "text": "",
                                     "client_id": cid, "receipt_payment_id": pid}))

        # Employee should receive the chat with receipt payload
        got_emp = await _recv_until(emp, "chat", emp_key=emp_key, timeout=6)
        assert got_emp is not None, "employee did not receive receipt chat"
        m = got_emp["message"]
        assert m["sender"] == "admin"
        assert m["text"] == ""
        assert m["receipt"] is not None, f"receipt missing in employee message: {m}"
        r = m["receipt"]
        assert r["payment_id"] == pid
        assert r["receipt_number"] == ctx["receipt_number"]
        assert r["amount"] == 1234
        assert r["currency"] == "SRD"
        # Note: _chat_receipt resolves tenant_name only from tenants collection via tenant_id,
        # ignoring payment.tenant_name field. Seed payment has no tenant_id so it falls back to 'Huurder'.
        assert r["tenant_name"], "tenant_name should be non-empty"
        assert r.get("paid_at")

        # Admin should also receive own echo
        got_adm = await _recv_until(admin, "chat", emp_key=emp_key, timeout=5)
        assert got_adm and got_adm["message"]["receipt"]["payment_id"] == pid

        # chat_threads last_text should be 'Bon verstuurd' for receipt-only message
        await admin.send(json.dumps({"type": "chat_threads"}))
        thr = await _recv_until(admin, "chat_threads", timeout=5)
        assert thr is not None
        row = next((t for t in thr["threads"] if t["emp_key"] == emp_key), None)
        assert row is not None, f"thread missing for {emp_key}"
        assert row["last_text"] == "Bon verstuurd", f"expected 'Bon verstuurd' got {row['last_text']!r}"
    finally:
        await emp.close(); await admin.close()


# ---------- Invalid payment id → receipt is None (text still gets sent) ----------
@pytest.mark.asyncio
async def test_invalid_payment_id_yields_null_receipt(ctx):
    emp_key = f"emp-badpid-{uuid.uuid4().hex[:6]}"
    emp = await _open_employee(ctx["kiosk_token"], "Anita Sewdas", emp_key)
    admin = await _open_admin(ctx["admin_token"], ctx["kiosk_token"])
    try:
        text = f"with-bad-pid-{uuid.uuid4().hex[:6]}"
        await admin.send(json.dumps({"type": "chat_send", "emp_key": emp_key,
                                     "emp_name": "Anita Sewdas", "text": text,
                                     "client_id": "cbad-1",
                                     "receipt_payment_id": "does-not-exist-xyz"}))
        got = await _recv_until(emp, "chat", emp_key=emp_key, timeout=5)
        assert got is not None, "employee missed chat with bad pid"
        assert got["message"]["text"] == text
        assert got["message"]["receipt"] is None, f"receipt should be null, got {got['message']['receipt']}"
    finally:
        await emp.close(); await admin.close()


# ---------- Empty text + invalid payment id → nothing is sent ----------
@pytest.mark.asyncio
async def test_empty_text_and_invalid_pid_sends_nothing(ctx):
    emp_key = f"emp-nothing-{uuid.uuid4().hex[:6]}"
    emp = await _open_employee(ctx["kiosk_token"], "Anita Sewdas", emp_key)
    admin = await _open_admin(ctx["admin_token"], ctx["kiosk_token"])
    try:
        await admin.send(json.dumps({"type": "chat_send", "emp_key": emp_key,
                                     "emp_name": "Anita Sewdas", "text": "",
                                     "client_id": "cnone-1",
                                     "receipt_payment_id": "does-not-exist-abc"}))
        # Nothing should arrive to employee or admin
        emp_evts = await _drain(emp, 1.5)
        adm_evts = await _drain(admin, 0.3)
        assert not any(e.get("type") == "chat" for e in emp_evts), f"employee got unexpected chat: {emp_evts}"
        assert not any(e.get("type") == "chat" for e in adm_evts), f"admin got unexpected chat: {adm_evts}"
    finally:
        await emp.close(); await admin.close()


# ---------- Empty text + no payment id → nothing is sent ----------
@pytest.mark.asyncio
async def test_empty_text_no_pid_sends_nothing(ctx):
    emp_key = f"emp-nothing2-{uuid.uuid4().hex[:6]}"
    emp = await _open_employee(ctx["kiosk_token"], "Anita Sewdas", emp_key)
    admin = await _open_admin(ctx["admin_token"], ctx["kiosk_token"])
    try:
        await admin.send(json.dumps({"type": "chat_send", "emp_key": emp_key,
                                     "emp_name": "Anita Sewdas", "text": "",
                                     "client_id": "cnone-2"}))
        emp_evts = await _drain(emp, 1.5)
        assert not any(e.get("type") == "chat" for e in emp_evts), f"employee got unexpected chat: {emp_evts}"
    finally:
        await emp.close(); await admin.close()
