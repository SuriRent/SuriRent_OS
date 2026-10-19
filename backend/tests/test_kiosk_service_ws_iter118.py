# Iter118: APK background service WS (?device=KIOSK-ID, no auth msg, plain 'ping'), unbound devices, link-device,
# exclusive REMOTE_PRINT delivery to service conn, register with kiosk_id, normal auth flows unaffected.
import asyncio, json, os, time, uuid
import pytest, requests, websockets

BASE = os.environ.get("REACT_APP_BACKEND_URL") or open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split()[0]
BASE = BASE.rstrip("/")
API = f"{BASE}/api"
WS = API.replace("https", "wss").replace("http", "ws") + "/kiosk/ws"
KID = f"kiosk-test{uuid.uuid4().hex[:8]}"
KID2 = f"kiosk-test{uuid.uuid4().hex[:8]}"


@pytest.fixture(scope="module")
def ctx():
    a = requests.post(f"{API}/auth/login", json={"email": "demo@surirent.sr", "password": "demo1234"})
    assert a.status_code == 200
    ah = {"Authorization": f"Bearer {a.json()['token']}"}
    k = requests.post(f"{API}/auth/kiosk-pin", json={"pin": "4321", "company_slug": "my-awesome-rentals-bv"})
    if k.status_code != 200:
        pytest.skip("kiosk PIN login failed")
    kh = {"Authorization": f"Bearer {k.json()['token']}"}
    r = requests.post(f"{API}/kiosk/printers/register", json={"name": "TEST KTP iter118 svc"}, headers=kh)
    assert r.status_code == 200
    prn = r.json()
    e = requests.post(f"{API}/kiosk/kasgeld", json={"type": "out", "amount": 2, "description": "TEST_iter118"}, headers=kh)
    assert e.status_code == 200, e.text
    c = {"ah": ah, "kh": kh, "ktok": k.json()["token"], "atok": a.json()["token"], "prn": prn, "entry": e.json(), "extra": []}
    yield c
    requests.delete(f"{API}/kasgeld/{c['entry']['id']}", headers=ah)
    for pid in [prn["printer_id"], *c["extra"]]:
        requests.delete(f"{API}/settings/kiosk-printers/{pid}", headers=ah)
    # iter119: clean ownership/unbound docs of test ids
    from motor.motor_asyncio import AsyncIOMotorClient
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")

    async def clean():
        db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
        await db.kiosk_id_owners.delete_many({"kiosk_id": {"$regex": "^kiosk-test"}})
        await db.kiosk_unbound_devices.delete_many({"kiosk_id": {"$regex": "^kiosk-test"}})
    asyncio.run(clean())


async def _unknown_closed(kid):
    async with websockets.connect(f"{WS}?device={kid}") as ws:
        await ws.send("ping")
        t0 = time.time()
        with pytest.raises(websockets.ConnectionClosed) as ei:
            while True:
                await asyncio.wait_for(ws.recv(), 8)
        return ei.value.rcvd.code if ei.value.rcvd else None, time.time() - t0


# Unknown kiosk id -> 4401; listed as unbound only after own-company claim (iter119 ownership)
def test_unknown_device_closed_4401_and_listed(ctx):
    code, dt = asyncio.run(_unknown_closed(KID))
    assert code == 4401
    assert dt < 6
    r = requests.get(f"{API}/settings/kiosk-unbound-devices", headers=ctx["ah"])
    assert r.status_code == 200
    assert not any(d["kiosk_id"] == KID for d in r.json()), "unclaimed ID must not be listed"

    async def claim():
        async with websockets.connect(WS) as ws:
            await ws.send(json.dumps({"type": "auth", "role": "employee", "token": ctx["ktok"], "name": "TEST_iter118", "kiosk_id": KID}))
            await asyncio.wait_for(ws.recv(), 10)
            await ws.send(json.dumps({"type": "BYE"}))
    asyncio.run(claim())
    r = requests.get(f"{API}/settings/kiosk-unbound-devices", headers=ctx["ah"])
    assert any(d["kiosk_id"] == KID and d.get("last_seen") for d in r.json())


def test_unknown_device_no_frame_closed(ctx):
    async def run():
        async with websockets.connect(f"{WS}?device={KID}") as ws:
            with pytest.raises(websockets.ConnectionClosed) as ei:
                await asyncio.wait_for(ws.recv(), 8)
            return ei.value.rcvd.code
    assert asyncio.run(run()) == 4401


def test_unbound_requires_admin(ctx):
    assert requests.get(f"{API}/settings/kiosk-unbound-devices").status_code in (401, 403)
    assert requests.get(f"{API}/settings/kiosk-unbound-devices", headers=ctx["kh"]).status_code in (401, 403)


def test_link_device_404_unknown_printer(ctx):
    r = requests.post(f"{API}/settings/kiosk-printers/{uuid.uuid4()}/link-device", json={"kiosk_id": KID}, headers=ctx["ah"])
    assert r.status_code == 404


def test_link_device_validation(ctx):
    r = requests.post(f"{API}/settings/kiosk-printers/{ctx['prn']['printer_id']}/link-device", json={"kiosk_id": "a"}, headers=ctx["ah"])
    assert r.status_code == 422


def test_link_device_binds_and_removes_unbound(ctx):
    r = requests.post(f"{API}/settings/kiosk-printers/{ctx['prn']['printer_id']}/link-device", json={"kiosk_id": KID}, headers=ctx["ah"])
    assert r.status_code == 200 and r.json()["ok"] is True
    lst = requests.get(f"{API}/settings/kiosk-printers", headers=ctx["ah"]).json()
    me = next(p for p in lst if p["id"] == ctx["prn"]["printer_id"])
    assert KID in me["kiosk_ids"]
    ub = requests.get(f"{API}/settings/kiosk-unbound-devices", headers=ctx["ah"]).json()
    assert not any(d["kiosk_id"] == KID for d in ub)


def _online(ctx):
    on = requests.get(f"{API}/kiosk/printers/online", headers=ctx["kh"]).json()
    return any(p["id"] == ctx["prn"]["printer_id"] for p in on)


def test_linked_service_ready_online_then_offline(ctx):
    async def run():
        async with websockets.connect(f"{WS}?device={KID}") as ws:
            await ws.send("ping")
            m = json.loads(await asyncio.wait_for(ws.recv(), 10))
            assert m["type"] == "printer_ready" and m["name"] == "TEST KTP iter118 svc"
            await asyncio.sleep(5)  # past 4s hello timeout -> must stay open
            await ws.send("ping")
            await ws.send(json.dumps({"type": "ping"}))
            await asyncio.sleep(1)
            assert await asyncio.to_thread(_online, ctx)
            lst = (await asyncio.to_thread(requests.get, f"{API}/settings/kiosk-printers", headers=ctx["ah"])).json()
            me = next(p for p in lst if p["id"] == ctx["prn"]["printer_id"])
            assert me["online"] is True and KID in me["kiosk_ids"]
    asyncio.run(run())
    time.sleep(1.5)
    assert not _online(ctx)


def test_linked_service_no_frame_stays_open(ctx):
    async def run():
        async with websockets.connect(f"{WS}?device={KID}") as ws:
            m = json.loads(await asyncio.wait_for(ws.recv(), 10))
            assert m["type"] == "printer_ready"
            await asyncio.sleep(2)
            await ws.send("ping")
            await asyncio.sleep(0.5)
            assert ws.state.name == "OPEN"
    asyncio.run(run())


async def _drain(ws, secs):
    got = []
    try:
        while True:
            got.append(json.loads(await asyncio.wait_for(ws.recv(), secs)))
    except (asyncio.TimeoutError, websockets.ConnectionClosed):
        pass
    return got


# Exclusive delivery (iter119: app-first): token conn has priority; service only when app not connected
def test_exclusive_delivery_service_then_token(ctx):
    path = f"{API}/kiosk/kasgeld/{ctx['entry']['id']}/remote-print"
    body = {"printer_id": ctx["prn"]["printer_id"]}

    async def run():
        async with websockets.connect(WS) as tok_ws:
            await tok_ws.send(json.dumps({"type": "auth", "role": "printer", "device_token": ctx["prn"]["device_token"]}))
            assert json.loads(await asyncio.wait_for(tok_ws.recv(), 10))["type"] == "printer_ready"
            async with websockets.connect(f"{WS}?device={KID}") as svc:
                await svc.send("ping")
                assert json.loads(await asyncio.wait_for(svc.recv(), 10))["type"] == "printer_ready"
                await asyncio.sleep(1)
                r = await asyncio.to_thread(requests.post, path, json=body, headers=ctx["kh"])
                assert r.status_code == 200, r.text
                job = r.json()["job_id"]
                s_msgs, t_msgs = await asyncio.gather(_drain(svc, 4), _drain(tok_ws, 4))
                assert [m["job_id"] for m in t_msgs if m.get("type") == "REMOTE_PRINT"] == [job]
                assert not [m for m in s_msgs if m.get("type") == "REMOTE_PRINT"], s_msgs
            await asyncio.sleep(1.5)
            assert await asyncio.to_thread(_online, ctx), "printer should stay online via token conn"
            r = await asyncio.to_thread(requests.post, path, json=body, headers=ctx["kh"])
            assert r.status_code == 200, r.text
            job2 = r.json()["job_id"]
            t2 = await _drain(tok_ws, 4)
            assert [m["job_id"] for m in t2 if m.get("type") == "REMOTE_PRINT"] == [job2]
    asyncio.run(run())


# Token printer-mode with ?device= + auth msg binds kiosk_id
def test_token_auth_with_device_param_binds(ctx):
    async def run():
        async with websockets.connect(f"{WS}?device={KID2}") as ws:
            await ws.send(json.dumps({"type": "auth", "role": "printer", "device_token": ctx["prn"]["device_token"]}))
            assert json.loads(await asyncio.wait_for(ws.recv(), 10))["type"] == "printer_ready"
    asyncio.run(run())
    lst = requests.get(f"{API}/settings/kiosk-printers", headers=ctx["ah"]).json()
    me = next(p for p in lst if p["id"] == ctx["prn"]["printer_id"])
    assert KID2 in me["kiosk_ids"] and KID in me["kiosk_ids"]


def test_register_with_kiosk_id_moves_binding(ctx):
    r = requests.post(f"{API}/kiosk/printers/register", json={"name": "TEST KTP iter118 reg", "kiosk_id": KID2}, headers=ctx["kh"])
    assert r.status_code == 200
    pid = r.json()["printer_id"]
    ctx["extra"].append(pid)
    lst = requests.get(f"{API}/settings/kiosk-printers", headers=ctx["ah"]).json()
    new = next(p for p in lst if p["id"] == pid)
    old = next(p for p in lst if p["id"] == ctx["prn"]["printer_id"])
    assert new["kiosk_ids"] == [KID2]
    assert KID2 not in old["kiosk_ids"]


def test_employee_ws_auth_unaffected(ctx):
    async def run():
        async with websockets.connect(WS) as ws:
            await ws.send(json.dumps({"type": "auth", "role": "employee", "token": ctx["ktok"], "name": "TEST_iter118"}))
            m = json.loads(await asyncio.wait_for(ws.recv(), 10))
            assert m["type"] in ("device_config", "printers")
            await ws.send(json.dumps({"type": "BYE"}))
    asyncio.run(run())


def test_admin_ws_auth_unaffected(ctx):
    async def run():
        async with websockets.connect(WS) as ws:
            await ws.send(json.dumps({"type": "auth", "role": "admin", "token": ctx["ktok"], "admin_token": ctx["atok"]}))
            types = {json.loads(await asyncio.wait_for(ws.recv(), 10))["type"] for _ in range(2)}
            assert "device_config" in types and "presence" in types
    asyncio.run(run())


def test_bad_printer_token_4401(ctx):
    async def run():
        async with websockets.connect(WS) as ws:
            await ws.send(json.dumps({"type": "auth", "role": "printer", "device_token": "x" * 40}))
            with pytest.raises(websockets.ConnectionClosed) as ei:
                await asyncio.wait_for(ws.recv(), 8)
            return ei.value.rcvd.code
    assert asyncio.run(run()) == 4401


def test_revoked_printer_link_404_and_service_rejected(ctx):
    r = requests.post(f"{API}/kiosk/printers/register", json={"name": "TEST KTP iter118 rev"}, headers=ctx["kh"])
    pid = r.json()["printer_id"]
    ctx["extra"].append(pid)
    kid3 = f"kiosk-test{uuid.uuid4().hex[:8]}"
    assert requests.post(f"{API}/settings/kiosk-printers/{pid}/link-device", json={"kiosk_id": kid3}, headers=ctx["ah"]).status_code == 200
    assert requests.delete(f"{API}/settings/kiosk-printers/{pid}", headers=ctx["ah"]).status_code == 200
    assert requests.post(f"{API}/settings/kiosk-printers/{pid}/link-device", json={"kiosk_id": kid3}, headers=ctx["ah"]).status_code == 404
    code, _ = asyncio.run(_unknown_closed(kid3))
    assert code == 4401
