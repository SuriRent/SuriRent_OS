# Iter100: KT-V520 paper status via printer WebSocket (PRINTER_STATUS / PAPER_STATUS)
# Requires: python /app/test_reports/setup_iter85.py (writes /tmp/iter85_ctx.json)
import os, json, time, asyncio
import pytest
import requests
import websockets
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/") or open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split()[0].rstrip("/")
WS = BASE_URL.replace("https", "wss").replace("http", "ws") + "/api/kiosk/ws"
CTX = json.load(open("/tmp/iter85_ctx.json"))
db = MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))["vastgoed_kiosk"]
PID = CTX["printer_id"]


def online():
    r = requests.get(f"{BASE_URL}/api/kiosk/printers/online", cookies={"kiosk_token": CTX["kiosk_token"]})
    assert r.status_code == 200
    return r.json()


async def drain(ws, t=1.0, until=None):
    msgs = []
    end = time.time() + t
    while time.time() < end:
        try:
            m = json.loads(await asyncio.wait_for(ws.recv(), timeout=max(0.05, end - time.time())))
            msgs.append(m)
            if until and until(m):
                break
        except asyncio.TimeoutError:
            break
    return msgs


async def printer_conn():
    ws = await websockets.connect(WS, open_timeout=10)
    await ws.send(json.dumps({"type": "auth", "role": "printer", "device_token": CTX["device_token"], "device": {"ua": "TEST iter100"}}))
    first = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
    assert first["type"] == "printer_ready"
    return ws


async def send_status(ws, typ="PRINTER_STATUS", **kw):
    await ws.send(json.dumps({"type": typ, **kw}))
    await asyncio.sleep(1.0)


def paper_db():
    return db.kiosk_printers.find_one({"id": PID}, {"_id": 0, "paper": 1}).get("paper")


@pytest.fixture(autouse=True)
def reset_paper():
    db.kiosk_printers.update_one({"id": PID}, {"$unset": {"paper": ""}})
    yield


# Default paper = ok in /online
def test_online_default_ok():
    async def run():
        ws = await printer_conn()
        try:
            await asyncio.sleep(0.8)
            p = [x for x in online() if x["id"] == PID]
            assert p and p[0]["paper"] == "ok"
        finally:
            await ws.close()
    asyncio.run(run())


# Values + aliases + invalid ignored
@pytest.mark.parametrize("typ,payload,expected", [
    ("PRINTER_STATUS", {"paper": "low"}, "low"),
    ("PAPER_STATUS", {"paper": "empty"}, "empty"),
    ("PRINTER_STATUS", {"paper": "near_end"}, "low"),
    ("PRINTER_STATUS", {"paper": "out"}, "empty"),
    ("PRINTER_STATUS", {"paper": "no_paper"}, "empty"),
    ("PRINTER_STATUS", {"paper_status": "NEAR_END"}, "low"),
    ("PAPER_STATUS", {"status": "paper_out"}, "empty"),
])
def test_status_values(typ, payload, expected):
    async def run():
        ws = await printer_conn()
        try:
            await send_status(ws, typ, **payload)
            assert paper_db() == expected
            p = [x for x in online() if x["id"] == PID]
            assert p and p[0]["paper"] == expected
            await send_status(ws, "PRINTER_STATUS", paper="normal")
            assert paper_db() == "ok"
        finally:
            await ws.close()
    asyncio.run(run())


def test_invalid_ignored():
    async def run():
        ws = await printer_conn()
        try:
            await send_status(ws, paper="low")
            await send_status(ws, paper="bogus")
            await send_status(ws, paper=None)
            await send_status(ws, paper=123)
            assert paper_db() == "low"
            assert [x for x in online() if x["id"] == PID][0]["paper"] == "low"
        finally:
            await ws.close()
    asyncio.run(run())


# Admin WS presence includes printers[].paper
def test_admin_ws_presence_paper():
    async def run():
        pws = await printer_conn()
        aws = await websockets.connect(WS, open_timeout=10)
        try:
            await aws.send(json.dumps({"type": "auth", "role": "admin", "token": CTX["kiosk_token"], "admin_token": CTX["admin_token"]}))
            init = await drain(aws, 4, until=lambda m: m.get("type") == "presence")
            pres = [m for m in init if m.get("type") == "presence"]
            assert pres, init
            assert any(p["id"] == PID and p["paper"] == "ok" for p in pres[-1]["printers"])
            t0 = time.time()
            await pws.send(json.dumps({"type": "PRINTER_STATUS", "paper": "empty"}))
            got = await drain(aws, 6, until=lambda m: m.get("type") == "presence" and any(p["id"] == PID and p.get("paper") == "empty" for p in m.get("printers", [])))
            assert any(m.get("type") == "presence" and any(p["id"] == PID and p.get("paper") == "empty" for p in m.get("printers", [])) for m in got), got
            print("admin latency", time.time() - t0)
        finally:
            await aws.close(); await pws.close()
    asyncio.run(run())


# Employee WS gets 'printers' on connect and on paper change
def test_employee_ws_printers():
    async def run():
        pws = await printer_conn()
        ews = await websockets.connect(WS, open_timeout=10)
        try:
            await ews.send(json.dumps({"type": "auth", "role": "employee", "token": CTX["kiosk_token"],
                                       "name": "TEST Anita", "employee_id": "TEST_iter100"}))
            init = await drain(ews, 4, until=lambda m: m.get("type") == "printers")
            pr = [m for m in init if m.get("type") == "printers"]
            assert pr, init
            assert any(p["id"] == PID and p["paper"] == "ok" for p in pr[-1]["printers"])
            for val in ("low", "empty", "ok"):
                t0 = time.time()
                await pws.send(json.dumps({"type": "PRINTER_STATUS", "paper": val}))
                cond = lambda m: m.get("type") == "printers" and any(p["id"] == PID and p.get("paper") == val for p in m.get("printers", []))
                got = await drain(ews, 6, until=cond)
                assert any(cond(m) for m in got), (val, got)
                print("employee latency", val, round(time.time() - t0, 2))
            await ews.send(json.dumps({"type": "BYE"}))
        finally:
            await ews.close(); await pws.close()
    asyncio.run(run())
