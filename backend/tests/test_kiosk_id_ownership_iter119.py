# Iter119: KIOSK-ID ownership (kiosk_id_owners), per-company unbound list, 409 on foreign link,
# race-safe first claim, app-first REMOTE_PRINT delivery (service fallback with top-level fields) + backend logging.
import asyncio, json, os, time, uuid, subprocess
import bcrypt, jwt, pytest, requests, websockets
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
BASE = (os.environ.get("REACT_APP_BACKEND_URL") or open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split()[0]).rstrip("/")
API = f"{BASE}/api"
WS = API.replace("https", "wss").replace("http", "ws") + "/kiosk/ws"
CID_A = "demo-company-fixed-uuid-00000000000"
CID_B = "9fb04645-2424-4cac-9c32-e536073c53f7"  # 'Test Co 7ea4bb52'
B_EMAIL = f"test_iter119_b_{uuid.uuid4().hex[:6]}@example.com"
KA1 = f"kiosk-a1-{uuid.uuid4().hex[:8]}"
LOG = "/var/log/supervisor/backend.err.log"


def _db(fn):
    async def run():
        db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
        return await fn(db)
    return asyncio.run(run())


def _kiosk_tok(cid):
    return jwt.encode({"sub": "kiosk", "type": "kiosk", "company_id": cid}, os.environ["JWT_SECRET"], algorithm="HS256")


@pytest.fixture(scope="module")
def ctx():
    a = requests.post(f"{API}/auth/login", json={"email": "demo@surirent.sr", "password": "demo1234"})
    assert a.status_code == 200
    ah = {"Authorization": f"Bearer {a.json()['token']}"}
    k = requests.post(f"{API}/auth/kiosk-pin", json={"pin": "4321", "company_slug": "my-awesome-rentals-bv"})
    if k.status_code != 200:
        pytest.skip("kiosk PIN login failed")
    kh = {"Authorization": f"Bearer {k.json()['token']}"}
    # Company B admin (temporary)
    pw = bcrypt.hashpw(b"test1234", bcrypt.gensalt()).decode()
    _db(lambda db: db.users.insert_one({"id": str(uuid.uuid4()), "email": B_EMAIL, "name": "TEST B", "role": "admin",
                                        "company_id": CID_B, "password_hash": pw, "created_at": "2026-01-01T00:00:00+00:00"}))
    b = requests.post(f"{API}/auth/login", json={"email": B_EMAIL, "password": "test1234"})
    assert b.status_code == 200, b.text
    bh = {"Authorization": f"Bearer {b.json()['token']}"}
    prn_a = requests.post(f"{API}/kiosk/printers/register", json={"name": "TEST KTP iter119 A"}, headers=kh).json()
    pid_b = f"TEST-{uuid.uuid4()}"
    _db(lambda db: db.kiosk_printers.insert_one({"id": pid_b, "company_id": CID_B, "name": "TEST KTP iter119 B", "token_hash": "x",
                                                  "created_at": "2026", "last_seen": 0, "revoked": False, "kiosk_ids": []}))
    e = requests.post(f"{API}/kiosk/kasgeld", json={"type": "out", "amount": 1, "description": "TEST_iter119"}, headers=kh)
    assert e.status_code == 200, e.text
    c = {"ah": ah, "bh": bh, "kh": kh, "ktok": k.json()["token"], "atok": a.json()["token"], "prn_a": prn_a, "pid_b": pid_b,
         "entry": e.json(), "kids": [KA1], "extra_printers": []}
    yield c
    requests.delete(f"{API}/kasgeld/{c['entry']['id']}", headers=ah)
    requests.delete(f"{API}/settings/kiosk-printers/{prn_a['printer_id']}", headers=ah)

    async def clean(db):
        await db.users.delete_one({"email": B_EMAIL})
        await db.kiosk_printers.delete_many({"id": {"$in": [pid_b, *c["extra_printers"]]}})
        await db.kiosk_id_owners.delete_many({"kiosk_id": {"$in": c["kids"]}})
        await db.kiosk_unbound_devices.delete_many({"kiosk_id": {"$in": c["kids"]}})
    _db(clean)


async def _svc_closed(kid):
    async with websockets.connect(f"{WS}?device={kid}") as ws:
        await ws.send("ping")
        try:
            while True:
                await asyncio.wait_for(ws.recv(), 8)
        except websockets.ConnectionClosed as e:
            return e.rcvd.code if e.rcvd else None


def _unbound(h):
    r = requests.get(f"{API}/settings/kiosk-unbound-devices", headers=h)
    assert r.status_code == 200
    return [d["kiosk_id"] for d in r.json()]


def _owner(kid):
    o = _db(lambda db: db.kiosk_id_owners.find_one({"kiosk_id": kid}, {"_id": 0}))
    return (o or {}).get("company_id")


# 1. Unknown device: 4401, stored as unbound, no owner, invisible to both companies
def test_unknown_device_not_visible_to_anyone(ctx):
    assert asyncio.run(_svc_closed(KA1)) == 4401
    assert _db(lambda db: db.kiosk_unbound_devices.find_one({"kiosk_id": KA1})) is not None
    assert _owner(KA1) is None
    assert KA1 not in _unbound(ctx["bh"])
    assert KA1 not in _unbound(ctx["ah"])


# 2. Company A kiosk WS hello with kiosk_id claims ownership
def test_company_a_kiosk_hello_claims(ctx):
    async def run():
        async with websockets.connect(WS) as ws:
            await ws.send(json.dumps({"type": "auth", "role": "employee", "token": ctx["ktok"], "name": "TEST_iter119", "kiosk_id": KA1}))
            m = json.loads(await asyncio.wait_for(ws.recv(), 10))
            assert m["type"] in ("device_config", "printers")
            await ws.send(json.dumps({"type": "BYE"}))
    asyncio.run(run())
    assert _owner(KA1) == CID_A
    assert asyncio.run(_svc_closed(KA1)) == 4401  # service reconnect attempt
    assert KA1 in _unbound(ctx["ah"])
    assert KA1 not in _unbound(ctx["bh"])


# 3. Company B kiosk hello with A's kiosk_id does not steal ownership
def test_company_b_hello_cannot_steal(ctx):
    async def run():
        async with websockets.connect(WS) as ws:
            await ws.send(json.dumps({"type": "auth", "role": "employee", "token": _kiosk_tok(CID_B), "name": "TEST_iter119B", "kiosk_id": KA1}))
            await asyncio.wait_for(ws.recv(), 10)
            await ws.send(json.dumps({"type": "BYE"}))
    asyncio.run(run())
    assert _owner(KA1) == CID_A
    assert KA1 not in _unbound(ctx["bh"])


# 4. B link -> 409; A link -> ok; service reconnect -> printer_ready
def test_b_link_409_then_a_link_ok(ctx):
    r = requests.post(f"{API}/settings/kiosk-printers/{ctx['pid_b']}/link-device", json={"kiosk_id": KA1}, headers=ctx["bh"])
    assert r.status_code == 409, r.text
    assert "ander bedrijf" in r.json().get("detail", "")
    r = requests.post(f"{API}/settings/kiosk-printers/{ctx['prn_a']['printer_id']}/link-device", json={"kiosk_id": KA1}, headers=ctx["ah"])
    assert r.status_code == 200 and r.json()["ok"] is True
    assert KA1 not in _unbound(ctx["ah"])

    async def run():
        async with websockets.connect(f"{WS}?device={KA1}") as ws:
            await ws.send("ping")
            m = json.loads(await asyncio.wait_for(ws.recv(), 10))
            assert m["type"] == "printer_ready" and m["name"] == "TEST KTP iter119 A"
    asyncio.run(run())


# 5. Fallback: ID in another company's kiosk_printers.kiosk_ids (active or revoked) -> owned by them
@pytest.mark.parametrize("revoked", [False, True])
def test_previously_linked_fallback_owner(ctx, revoked):
    kid = f"kiosk-fb-{uuid.uuid4().hex[:8]}"
    ctx["kids"].append(kid)
    pid = f"TEST-{uuid.uuid4()}"
    ctx["extra_printers"].append(pid)
    _db(lambda db: db.kiosk_printers.insert_one({"id": pid, "company_id": CID_B, "name": "TEST fb", "token_hash": "x", "created_at": "2025",
                                                  "last_seen": 0, "revoked": revoked, "kiosk_ids": [kid]}))
    r = requests.post(f"{API}/settings/kiosk-printers/{ctx['prn_a']['printer_id']}/link-device", json={"kiosk_id": kid}, headers=ctx["ah"])
    assert r.status_code == 409, r.text
    other = _db(lambda db: db.kiosk_printers.find_one({"id": pid}, {"_id": 0}))
    assert kid in other["kiosk_ids"]
    assert _owner(kid) == CID_B


# 6. Race: simultaneous link-device from A and B on unclaimed ID -> only one owner
def test_race_simultaneous_claims(ctx):
    from concurrent.futures import ThreadPoolExecutor
    for _ in range(3):
        kid = f"kiosk-race-{uuid.uuid4().hex[:8]}"
        ctx["kids"].append(kid)
        jobs = [(ctx["prn_a"]["printer_id"], ctx["ah"]), (ctx["pid_b"], ctx["bh"])] * 3
        with ThreadPoolExecutor(6) as ex:
            res = list(ex.map(lambda j: requests.post(f"{API}/settings/kiosk-printers/{j[0]}/link-device", json={"kiosk_id": kid}, headers=j[1]).status_code, jobs))
        a_ok = [s for (s, j) in zip(res, jobs) if j[1] is ctx["ah"] and s == 200]
        b_ok = [s for (s, j) in zip(res, jobs) if j[1] is ctx["bh"] and s == 200]
        assert bool(a_ok) != bool(b_ok), res
        assert all(s in (200, 409) for s in res), res
        n = _db(lambda db: db.kiosk_id_owners.count_documents({"kiosk_id": kid}))
        assert n == 1
        owner = _owner(kid)
        assert owner == (CID_A if a_ok else CID_B)
        holders = _db(lambda db: db.kiosk_printers.find({"kiosk_ids": kid}, {"_id": 0, "company_id": 1}).to_list(10))
        assert {h["company_id"] for h in holders} == {owner}


async def _drain(ws, secs):
    got = []
    try:
        while True:
            got.append(json.loads(await asyncio.wait_for(ws.recv(), secs)))
    except (asyncio.TimeoutError, websockets.ConnectionClosed):
        pass
    return got


def _log_tail():
    return subprocess.run(["tail", "-n", "400", LOG], capture_output=True, text=True).stdout


# 7. Delivery: both connected -> app only (via=app)
def test_delivery_service_first(ctx):
    path = f"{API}/kiosk/kasgeld/{ctx['entry']['id']}/remote-print"
    body = {"printer_id": ctx["prn_a"]["printer_id"]}

    async def run():
        async with websockets.connect(f"{WS}?device={KA1}") as svc:
            await svc.send("ping")
            assert json.loads(await asyncio.wait_for(svc.recv(), 10))["type"] == "printer_ready"
            async with websockets.connect(WS) as tok:
                await tok.send(json.dumps({"type": "auth", "role": "printer", "device_token": ctx["prn_a"]["device_token"]}))
                assert json.loads(await asyncio.wait_for(tok.recv(), 10))["type"] == "printer_ready"
                await asyncio.sleep(1)
                r = await asyncio.to_thread(requests.post, path, json=body, headers=ctx["kh"])
                assert r.status_code == 200, r.text
                job = r.json()["job_id"]
                s_msgs, t_msgs = await asyncio.gather(_drain(svc, 4), _drain(tok, 4))
                assert [m["job_id"] for m in s_msgs if m.get("type") == "REMOTE_PRINT"] == [job]
                assert not [m for m in t_msgs if m.get("type") == "REMOTE_PRINT"], t_msgs
                return job
    job = asyncio.run(run())
    time.sleep(1)
    assert f"REMOTE_PRINT job={job}" in _log_tail() and "via=service" in [l for l in _log_tail().splitlines() if job in l][0]


# 8. Delivery: only service connected -> service gets REMOTE_PRINT with top-level fields; DONE relays to employee kiosk
def test_delivery_service_fallback_and_done_relay(ctx):
    path = f"{API}/kiosk/kasgeld/{ctx['entry']['id']}/remote-print"
    body = {"printer_id": ctx["prn_a"]["printer_id"]}

    async def run():
        async with websockets.connect(WS) as emp:
            await emp.send(json.dumps({"type": "auth", "role": "employee", "token": ctx["ktok"], "name": "TEST_iter119"}))
            async with websockets.connect(f"{WS}?device={KA1}") as svc:
                await svc.send("ping")
                assert json.loads(await asyncio.wait_for(svc.recv(), 10))["type"] == "printer_ready"
                await asyncio.sleep(1)
                await _drain(emp, 1)
                r = await asyncio.to_thread(requests.post, path, json=body, headers=ctx["kh"])
                assert r.status_code == 200, r.text
                job = r.json()["job_id"]
                msgs = [m for m in await _drain(svc, 4) if m.get("type") == "REMOTE_PRINT"]
                assert len(msgs) == 1
                m = msgs[0]
                assert m["job_id"] == job and m["printer"] == "kt-v520" and m["remote"] is True
                assert isinstance(m["lines"], list) and m["lines"]
                assert m["template"] == "lines" and m["receipt_type"] == "kasgeld"
                assert m["data"]["lines"] == m["lines"]
                await svc.send(json.dumps({"type": "REMOTE_PRINT_DONE", "job_id": job, "ok": True}))
                got = [x for x in await _drain(emp, 4) if x.get("type") == "REMOTE_PRINT_DONE"]
                assert got and got[0]["job_id"] == job and got[0]["ok"] is True and got[0]["printer"] == "TEST KTP iter119 A"
                await emp.send(json.dumps({"type": "BYE"}))
                return job
    job = asyncio.run(run())
    time.sleep(1)
    tail = _log_tail()
    assert any(job in l and "via=service" in l for l in tail.splitlines())
    assert any(f"[ktp] service {ctx['prn_a']['printer_id']} ->" in l and "REMOTE_PRINT_DONE" in l for l in tail.splitlines())
