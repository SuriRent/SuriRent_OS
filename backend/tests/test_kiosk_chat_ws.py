"""Iter86 — Kiosk-chat WebSocket flows: isolation, today-only, read-receipts, admin notification."""
import asyncio
import json
import os
import time
import uuid

import pytest
import requests
import websockets

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://vastgoed-app.preview.emergentagent.com").rstrip("/")
WS_URL = BASE.replace("http", "ws") + "/api/kiosk/ws"
SLUG = "my-awesome-rentals-bv"


@pytest.fixture(scope="module")
def ctx():
    with open("/tmp/iter85_ctx.json") as f:
        return json.load(f)


async def _recv_until(ws, kind, emp_key=None, timeout=5.0):
    end = time.time() + timeout
    while time.time() < end:
        try:
            raw = await asyncio.wait_for(ws.recv(), timeout=end - time.time())
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
    # consume device_config
    await _drain(ws, 0.3)
    return ws


async def _open_admin(admin_token, kiosk_token):
    ws = await websockets.connect(WS_URL)
    await ws.send(json.dumps({"type": "auth", "role": "admin", "token": kiosk_token,
                              "admin_token": admin_token}))
    await _drain(ws, 0.3)
    return ws


# ---------- Chat isolation + echo ----------
@pytest.mark.asyncio
async def test_chat_employee_send_isolated(ctx):
    emp1 = await _open_employee(ctx["kiosk_token"], "Anita Sewdas", "emp-anita-1")
    emp2 = await _open_employee(ctx["kiosk_token"], "Bob Test", "emp-bob-2")
    admin = await _open_admin(ctx["admin_token"], ctx["kiosk_token"])
    try:
        cid = f"iter86-{uuid.uuid4().hex[:8]}"
        text = f"HELLO-ANITA-{cid}"
        await emp1.send(json.dumps({"type": "chat_send", "text": text, "client_id": cid}))

        # emp1 should receive echo
        got1 = await _recv_until(emp1, "chat", emp_key="emp-anita-1", timeout=5)
        assert got1 is not None, "emp1 did not receive its own chat echo"
        assert got1["message"]["text"] == text
        assert got1["message"]["sender"] == "employee"
        assert got1["message"]["client_id"] == cid

        # admin should receive the chat for emp-anita-1
        got_adm = await _recv_until(admin, "chat", emp_key="emp-anita-1", timeout=5)
        assert got_adm is not None, "admin did not receive employee chat"
        assert got_adm["message"]["text"] == text
        assert got_adm["emp_key"] == "emp-anita-1"

        # emp2 should NOT receive it
        other = await _drain(emp2, 1.0)
        assert not any(m.get("type") == "chat" for m in other), f"emp2 wrongly received chat: {other}"
    finally:
        await emp1.close(); await emp2.close(); await admin.close()


@pytest.mark.asyncio
async def test_chat_admin_reply_isolated(ctx):
    emp1 = await _open_employee(ctx["kiosk_token"], "Anita Sewdas", "emp-anita-A")
    emp2 = await _open_employee(ctx["kiosk_token"], "Bob Test", "emp-bob-B")
    admin = await _open_admin(ctx["admin_token"], ctx["kiosk_token"])
    try:
        cid = f"iter86-adm-{uuid.uuid4().hex[:8]}"
        text = f"ADMIN-TO-ANITA-{cid}"
        await admin.send(json.dumps({"type": "chat_send", "emp_key": "emp-anita-A",
                                     "emp_name": "Anita Sewdas", "text": text, "client_id": cid}))

        # emp1 receives
        got1 = await _recv_until(emp1, "chat", emp_key="emp-anita-A", timeout=5)
        assert got1 and got1["message"]["text"] == text
        assert got1["message"]["sender"] == "admin"
        assert got1["message"]["read_by_admin"] is True

        # admin also receives own echo (for threads sync)
        got_adm = await _recv_until(admin, "chat", emp_key="emp-anita-A", timeout=5)
        assert got_adm and got_adm["message"]["text"] == text

        # emp2 should NOT
        other = await _drain(emp2, 1.0)
        assert not any(m.get("type") == "chat" for m in other), f"emp2 wrongly got admin msg: {other}"
    finally:
        await emp1.close(); await emp2.close(); await admin.close()


# ---------- Threads list + history ----------
@pytest.mark.asyncio
async def test_chat_threads_and_history(ctx):
    emp = await _open_employee(ctx["kiosk_token"], "Anita Sewdas", "emp-threads-X")
    admin = await _open_admin(ctx["admin_token"], ctx["kiosk_token"])
    try:
        text = f"THREAD-TEST-{uuid.uuid4().hex[:6]}"
        await emp.send(json.dumps({"type": "chat_send", "text": text, "client_id": "c-thread-1"}))
        await _recv_until(admin, "chat", emp_key="emp-threads-X", timeout=5)

        await admin.send(json.dumps({"type": "chat_threads"}))
        thr = await _recv_until(admin, "chat_threads", timeout=5)
        assert thr is not None
        row = next((t for t in thr["threads"] if t["emp_key"] == "emp-threads-X"), None)
        assert row is not None, f"thread missing for emp-threads-X in {thr}"
        assert row["unread"] >= 1
        assert row["last_text"] == text

        await admin.send(json.dumps({"type": "chat_history", "emp_key": "emp-threads-X"}))
        hist = await _recv_until(admin, "chat_history", emp_key="emp-threads-X", timeout=5)
        assert hist and any(m["text"] == text for m in hist["messages"])
    finally:
        await emp.close(); await admin.close()


# ---------- Read receipts ----------
@pytest.mark.asyncio
async def test_chat_read_receipt_broadcast(ctx):
    emp = await _open_employee(ctx["kiosk_token"], "Anita Sewdas", "emp-read-Y")
    admin = await _open_admin(ctx["admin_token"], ctx["kiosk_token"])
    try:
        await emp.send(json.dumps({"type": "chat_send", "text": "please read me", "client_id": "cr-1"}))
        await _recv_until(admin, "chat", emp_key="emp-read-Y", timeout=5)

        # Admin marks read → broadcast chat_read; employee should see it
        await admin.send(json.dumps({"type": "chat_read", "emp_key": "emp-read-Y"}))
        got = await _recv_until(emp, "chat_read", emp_key="emp-read-Y", timeout=5)
        assert got is not None, "employee did not receive chat_read"
        assert got["reader"] == "admin"
    finally:
        await emp.close(); await admin.close()


# ---------- Admin SSE notification ----------
@pytest.mark.asyncio
async def test_admin_notification_sse_on_employee_message(ctx):
    """Employee chat message should trigger SSE 'notification' with title 'Kiosk-chat · {name}'."""
    import aiohttp
    marker = f"NOTIF-{uuid.uuid4().hex[:6]}"
    found = {"ok": False, "title": None, "body": None}

    async def _consume_sse():
        timeout = aiohttp.ClientTimeout(total=15)
        async with aiohttp.ClientSession(timeout=timeout) as sess:
            headers = {"Authorization": f"Bearer {ctx['admin_token']}"}
            async with sess.get(f"{BASE}/api/admin/events", headers=headers) as resp:
                async for raw in resp.content:
                    line = raw.decode("utf-8", errors="ignore").strip()
                    if not line.startswith("data:"):
                        continue
                    try:
                        payload = json.loads(line[5:].strip())
                    except Exception:
                        continue
                    if payload.get("type") == "notification" and marker in (payload.get("body") or ""):
                        found["ok"] = True
                        found["title"] = payload.get("title")
                        found["body"] = payload.get("body")
                        return

    sse_task = asyncio.create_task(_consume_sse())
    await asyncio.sleep(1.5)  # ensure SSE subscribed before send

    emp = await _open_employee(ctx["kiosk_token"], "Anita Sewdas", "emp-notif-N")
    try:
        await emp.send(json.dumps({"type": "chat_send", "text": marker, "client_id": "nf-1"}))
        try:
            await asyncio.wait_for(sse_task, timeout=10)
        except asyncio.TimeoutError:
            sse_task.cancel()
    finally:
        await emp.close()

    assert found["ok"], "SSE notification for Kiosk-chat not received"
    assert "Kiosk-chat" in (found["title"] or ""), f"Unexpected title: {found['title']}"
