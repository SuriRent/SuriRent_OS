# Iter120: strict per-company isolation of REMOTE_PRINT over real wss/https.
# Company A = demo (my-awesome-rentals-bv), Company B = 'Test Co 7ea4bb52' with temp admin + signed kiosk JWT.
import asyncio, json, os, uuid
import bcrypt, jwt, pytest, requests, websockets
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
BASE = (os.environ.get("REACT_APP_BACKEND_URL") or open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split()[0]).rstrip("/")
API = f"{BASE}/api"
WS = API.replace("https", "wss").replace("http", "ws") + "/kiosk/ws"
CID_A = "demo-company-fixed-uuid-00000000000"
CID_B = "9fb04645-2424-4cac-9c32-e536073c53f7"
TAG = uuid.uuid4().hex[:6]
B_EMAIL = f"test_iter120_b_{TAG}@example.com"
KID_A = f"kiosk-i120a-{TAG}"
KID_B = f"kiosk-i120b-{TAG}"
KID_X = f"kiosk-i120x-{TAG}"   # inconsistent legacy: printer row B, owner A
KID_UA = f"kiosk-i120ua-{TAG}"  # unbound owned by A
KID_UB = f"kiosk-i120ub-{TAG}"  # unbound owned by B
ALL_KIDS = [KID_A, KID_B, KID_X, KID_UA, KID_UB]


def _db(fn):
    async def run():
        db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
        return await fn(db)
    return asyncio.run(run())


def _ktok(cid):
    return jwt.encode({"sub": "kiosk", "type": "kiosk", "company_id": cid}, os.environ["JWT_SECRET"], algorithm="HS256")


def H(tok):
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def ctx():
    a = requests.post(f"{API}/auth/login", json={"email": "demo@surirent.sr", "password": "demo1234"})
    assert a.status_code == 200, a.text
    pw = bcrypt.hashpw(b"test1234", bcrypt.gensalt()).decode()
    _db(lambda db: db.users.insert_one({"id": str(uuid.uuid4()), "email": B_EMAIL, "name": "TEST B", "role": "admin",
                                        "company_id": CID_B, "password_hash": pw, "created_at": "2026-01-01T00:00:00+00:00"}))
    b = requests.post(f"{API}/auth/login", json={"email": B_EMAIL, "password": "test1234"})
    assert b.status_code == 200, b.text
    ka, kb = _ktok(CID_A), _ktok(CID_B)
    pa = requests.post(f"{API}/kiosk/printers/register", json={"name": f"TEST i120 A {TAG}", "kiosk_id": KID_A}, headers=H(ka)).json()
    pb = requests.post(f"{API}/kiosk/printers/register", json={"name": f"TEST i120 B {TAG}", "kiosk_id": KID_B}, headers=H(kb)).json()
    pid_x = f"TEST-i120x-{uuid.uuid4()}"
    tb, payb = f"TEST-i120-tb-{TAG}", f"TEST-i120-payb-{TAG}"

    async def seed(db):
        await db.kiosk_printers.insert_one({"id": pid_x, "company_id": CID_B, "name": f"TEST i120 X {TAG}", "token_hash": "x",
                                            "created_at": "2026", "last_seen": 0, "revoked": False, "kiosk_ids": [KID_X]})
        await db.kiosk_id_owners.insert_one({"kiosk_id": KID_X, "company_id": CID_A, "since": "2026"})
        await db.tenants.insert_one({"id": tb, "company_id": CID_B, "name": "TEST i120 tenant B", "status": "active",
                                     "created_at": "2026-01-01T00:00:00+00:00"})
        await db.payments.insert_one({"id": payb, "company_id": CID_B, "tenant_id": tb, "amount": 10.0, "currency": "SRD",
                                      "category": "huur", "paid_at": "2026-01-05T10:00:00+00:00",
                                      "created_at": "2026-01-05T10:00:00+00:00", "method": "cash"})
        pa_ = await db.payments.find_one({"company_id": CID_A}, {"_id": 0, "id": 1})
        ta_ = await db.tenants.find_one({"company_id": CID_A}, {"_id": 0, "id": 1})
        return pa_["id"], ta_["id"]
    pay_a, ten_a = _db(seed)
    ea = requests.post(f"{API}/kiosk/kasgeld", json={"type": "out", "amount": 1, "description": "TEST_iter120 A"}, headers=H(ka))
    eb = requests.post(f"{API}/kiosk/kasgeld", json={"type": "out", "amount": 1, "description": "TEST_iter120 B"}, headers=H(kb))
    assert ea.status_code == 200 and eb.status_code == 200, (ea.text, eb.text)
    c = {"ah": H(a.json()["token"]), "bh": H(b.json()["token"]), "ka": ka, "kb": kb, "pa": pa, "pb": pb, "pid_x": pid_x,
         "pay_a": pay_a, "ten_a": ten_a, "pay_b": payb, "ten_b": tb, "kas_a": ea.json()["id"], "kas_b": eb.json()["id"]}
    yield c

    async def clean(db):
        await db.users.delete_one({"email": B_EMAIL})
        await db.kiosk_printers.delete_many({"id": {"$in": [pa["printer_id"], pb["printer_id"], pid_x]}})
        await db.kiosk_id_owners.delete_many({"kiosk_id": {"$in": ALL_KIDS}})
        await db.kiosk_unbound_devices.delete_many({"kiosk_id": {"$in": ALL_KIDS}})
        await db.kasgeld.delete_many({"id": {"$in": [c["kas_a"], c["kas_b"]]}})
        await db.payments.delete_one({"id": payb})
        await db.tenants.delete_one({"id": tb})
        await db.kiosk_print_log.delete_many({"payment_id": {"$in": [payb, pay_a]}, "admin_printed_at": {"$exists": True}, "emp_key": {"$exists": False}})
        await db.kiosk_devices_seen.delete_many({"name": {"$regex": f"i120"}})
        await db.kiosk_presence.delete_many({"name": {"$regex": "i120"}})
    _db(clean)


class Listener:
    """Open printer conns, collect REMOTE_PRINT messages."""
    def __init__(self):
        self.got = {}
        self.socks = {}
        self.tasks = []

    async def open_token(self, name, tok):
        ws = await websockets.connect(WS)
        await ws.send(json.dumps({"type": "auth", "role": "printer", "device_token": tok}))
        m = json.loads(await asyncio.wait_for(ws.recv(), 10))
        assert m["type"] == "printer_ready", m
        self._start(name, ws)

    async def open_service(self, name, kid):
        ws = await websockets.connect(f"{WS}?device={kid}")
        await ws.send("ping")
        m = json.loads(await asyncio.wait_for(ws.recv(), 10))
        assert m["type"] == "printer_ready", m
        self._start(name, ws)

    def _start(self, name, ws):
        self.got[name] = []
        self.socks[name] = ws

        async def loop():
            try:
                async for raw in ws:
                    try:
                        m = json.loads(raw)
                    except Exception:
                        continue
                    if m.get("type") == "REMOTE_PRINT":
                        self.got[name].append(m)
            except Exception:
                pass
        self.tasks.append(asyncio.create_task(loop()))

    async def close(self, name):
        await self.socks[name].close()
        await asyncio.sleep(1.0)

    async def close_all(self):
        for ws in self.socks.values():
            try:
                await ws.close()
            except Exception:
                pass
        for t in self.tasks:
            t.cancel()


def _post(path, h, pid):
    return requests.post(f"{API}{path}", json={"printer_id": pid}, headers=h, timeout=20)


# 1. B kiosk -> A payment/kasgeld/tenant with A printer -> 404; B own items with A printer -> 409. A conns receive nothing.
def test_b_cannot_print_on_a(ctx):
    async def run():
        L = Listener()
        try:
            await L.open_token("a_tok", ctx["pa"]["device_token"])
            await L.open_service("a_svc", KID_A)
            await asyncio.sleep(1)
            pa, kb = ctx["pa"]["printer_id"], H(ctx["kb"])
            res = {}
            res["pay_foreign"] = _post(f"/kiosk/print-log/by-payment/{ctx['pay_a']}/remote-print", kb, pa).status_code
            res["kas_foreign"] = _post(f"/kiosk/kasgeld/{ctx['kas_a']}/remote-print", kb, pa).status_code
            res["ten_foreign"] = _post(f"/kiosk/tenants/{ctx['ten_a']}/financial-remote-print", kb, pa).status_code
            r_pay = _post(f"/kiosk/print-log/by-payment/{ctx['pay_b']}/remote-print", kb, pa)
            r_kas = _post(f"/kiosk/kasgeld/{ctx['kas_b']}/remote-print", kb, pa)
            r_ten = _post(f"/kiosk/tenants/{ctx['ten_b']}/financial-remote-print", kb, pa)
            res["pay_own"], res["kas_own"], res["ten_own"] = r_pay.status_code, r_kas.status_code, r_ten.status_code
            await asyncio.sleep(3)
            return res, {k: len(v) for k, v in L.got.items()}, (r_pay.text, r_kas.text, r_ten.text)
        finally:
            await L.close_all()
    res, got, texts = asyncio.run(run())
    print(res, got, texts)
    assert res["pay_foreign"] == 404 and res["kas_foreign"] == 404 and res["ten_foreign"] == 404, res
    assert res["pay_own"] == 409 and res["kas_own"] == 409 and res["ten_own"] == 409, (res, texts)
    assert got == {"a_tok": 0, "a_svc": 0}, got


# 2. A -> A printer: service-first; company_id == A; B conns receive nothing. Then service gone -> token gets it.
def test_a_print_only_to_a_service_first(ctx):
    async def run():
        L = Listener()
        try:
            await L.open_token("a_tok", ctx["pa"]["device_token"])
            await L.open_service("a_svc", KID_A)
            await L.open_token("b_tok", ctx["pb"]["device_token"])
            await L.open_service("b_svc", KID_B)
            await asyncio.sleep(1)
            pa, ka = ctx["pa"]["printer_id"], H(ctx["ka"])
            codes = [_post(f"/kiosk/kasgeld/{ctx['kas_a']}/remote-print", ka, pa).status_code,
                     _post(f"/kiosk/print-log/by-payment/{ctx['pay_a']}/remote-print", ka, pa).status_code,
                     _post(f"/kiosk/tenants/{ctx['ten_a']}/financial-remote-print", ka, pa).status_code]
            await asyncio.sleep(3)
            snap1 = {k: list(v) for k, v in L.got.items()}
            await L.close("a_svc")
            c2 = _post(f"/kiosk/kasgeld/{ctx['kas_a']}/remote-print", ka, pa).status_code
            await asyncio.sleep(3)
            snap2 = {k: list(v) for k, v in L.got.items()}
            return codes, c2, snap1, snap2
        finally:
            await L.close_all()
    codes, c2, s1, s2 = asyncio.run(run())
    print(codes, c2, {k: len(v) for k, v in s1.items()}, {k: len(v) for k, v in s2.items()})
    assert codes == [200, 200, 200], codes
    assert len(s1["a_svc"]) == 3 and len(s1["a_tok"]) == 0, s1
    assert all(m["company_id"] == CID_A and m["target"] == ctx["pa"]["printer_id"] for m in s1["a_svc"])
    assert len(s1["b_tok"]) == 0 and len(s1["b_svc"]) == 0
    assert c2 == 200
    assert len(s2["a_tok"]) == 1 and s2["a_tok"][0]["company_id"] == CID_A
    assert len(s2["b_tok"]) == 0 and len(s2["b_svc"]) == 0


# 3. B -> B printer: only B's conns get it, A nothing
def test_b_print_only_to_b(ctx):
    async def run():
        L = Listener()
        try:
            await L.open_token("a_tok", ctx["pa"]["device_token"])
            await L.open_service("a_svc", KID_A)
            await L.open_token("b_tok", ctx["pb"]["device_token"])
            await asyncio.sleep(1)
            c = _post(f"/kiosk/kasgeld/{ctx['kas_b']}/remote-print", H(ctx["kb"]), ctx["pb"]["printer_id"]).status_code
            # A tries B printer -> 409
            c_ab = _post(f"/kiosk/kasgeld/{ctx['kas_a']}/remote-print", H(ctx["ka"]), ctx["pb"]["printer_id"]).status_code
            await asyncio.sleep(3)
            return c, c_ab, {k: list(v) for k, v in L.got.items()}
        finally:
            await L.close_all()
    c, c_ab, got = asyncio.run(run())
    assert c == 200 and c_ab == 409, (c, c_ab)
    assert len(got["b_tok"]) == 1 and got["b_tok"][0]["company_id"] == CID_B
    assert len(got["a_tok"]) == 0 and len(got["a_svc"]) == 0, got


# 4. Inconsistent legacy data: printer row B with kiosk_id owned by A -> service rejected 4401
def test_inconsistent_owner_rejected(ctx):
    async def run():
        async with websockets.connect(f"{WS}?device={KID_X}") as ws:
            await ws.send("ping")
            try:
                while True:
                    m = await asyncio.wait_for(ws.recv(), 8)
                    if "printer_ready" in str(m):
                        return "ready"
            except websockets.ConnectionClosed as e:
                return e.rcvd.code if e.rcvd else None
    assert asyncio.run(run()) == 4401
    # owner not changed
    o = _db(lambda db: db.kiosk_id_owners.find_one({"kiosk_id": KID_X}, {"_id": 0}))
    assert o["company_id"] == CID_A


# 5. Settings endpoints: no cross-company leakage
def test_settings_isolation(ctx):
    async def run():
        for tok, kid in ((ctx["ka"], KID_UA), (ctx["kb"], KID_UB)):
            async with websockets.connect(WS) as ws:
                await ws.send(json.dumps({"type": "auth", "role": "employee", "token": tok, "name": "TEST_i120", "kiosk_id": kid,
                                          "device": {"ua": f"TEST-UA-i120-{kid}"}}))
                await asyncio.wait_for(ws.recv(), 10)
                await ws.send(json.dumps({"type": "BYE"}))
            async with websockets.connect(f"{WS}?device={kid}") as ws:
                await ws.send("ping")
                try:
                    await asyncio.wait_for(ws.recv(), 8)
                except websockets.ConnectionClosed:
                    pass
    asyncio.run(run())
    g = lambda p, h: requests.get(f"{API}/settings/{p}", headers=h).json()
    ua, ub = [d["kiosk_id"] for d in g("kiosk-unbound-devices", ctx["ah"])], [d["kiosk_id"] for d in g("kiosk-unbound-devices", ctx["bh"])]
    assert KID_UA in ua and KID_UB not in ua, ua
    assert KID_UB in ub and KID_UA not in ub, ub
    pa_list, pb_list = g("kiosk-printers", ctx["ah"]), g("kiosk-printers", ctx["bh"])
    ids_a, ids_b = {p["id"] for p in pa_list}, {p["id"] for p in pb_list}
    kids_a = {k for p in pa_list for k in p["kiosk_ids"]}
    kids_b = {k for p in pb_list for k in p["kiosk_ids"]}
    assert ctx["pa"]["printer_id"] in ids_a and ctx["pb"]["printer_id"] not in ids_a and ctx["pid_x"] not in ids_a
    assert ctx["pb"]["printer_id"] in ids_b and ctx["pa"]["printer_id"] not in ids_b
    assert KID_A in kids_a and KID_B not in kids_a and KID_X not in kids_a
    assert KID_B in kids_b and KID_A not in kids_b
    assert not ids_a & ids_b and not kids_a & kids_b
    sa, sb = g("kiosk-devices-seen", ctx["ah"]), g("kiosk-devices-seen", ctx["bh"])
    ua_s, ub_s = {d.get("ua") for d in sa}, {d.get("ua") for d in sb}
    assert f"TEST-UA-i120-{KID_UA}" in ua_s and f"TEST-UA-i120-{KID_UB}" not in ua_s
    assert f"TEST-UA-i120-{KID_UB}" in ub_s and f"TEST-UA-i120-{KID_UA}" not in ub_s
    na, nb = {d.get("name") for d in sa}, {d.get("name") for d in sb}
    assert f"TEST i120 B {TAG}" not in na and f"TEST i120 A {TAG}" not in nb
    assert all("company_id" not in d for d in sa + sb)
