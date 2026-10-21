# Iter117: KT-V520 remote print over WS for kasgeld / financial / payment jobs (url + data.lines in REMOTE_PRINT)
import asyncio, json, os
import pytest, requests, websockets

BASE = os.environ.get("REACT_APP_BACKEND_URL") or open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split()[0]
BASE = BASE.rstrip("/")
API = f"{BASE}/api"
WS = API.replace("https", "wss").replace("http", "ws") + "/kiosk/ws"


@pytest.fixture(scope="module")
def ctx():
    a = requests.post(f"{API}/auth/login", json={"email": "demo@surirent.sr", "password": "demo1234"})
    assert a.status_code == 200
    ah = {"Authorization": f"Bearer {a.json()['token']}"}
    k = requests.post(f"{API}/auth/kiosk-pin", json={"pin": "4321", "company_slug": "my-awesome-rentals-bv"})
    if k.status_code != 200:
        pytest.skip("kiosk PIN login failed")
    kh = {"Authorization": f"Bearer {k.json()['token']}"}
    r = requests.post(f"{API}/kiosk/printers/register", json={"name": "TEST KTP iter117 pytest"}, headers=kh)
    assert r.status_code == 200
    prn = r.json()
    assert isinstance(prn["device_token"], str) and prn["name"] == "TEST KTP iter117 pytest"
    e = requests.post(f"{API}/kiosk/kasgeld", json={"type": "out", "amount": 3, "description": "TEST_iter117 pytest"}, headers=kh)
    assert e.status_code == 200, e.text
    c = {"ah": ah, "kh": kh, "prn": prn, "entry": e.json()}
    yield c
    requests.delete(f"{API}/kasgeld/{c['entry']['id']}", headers=ah)
    requests.delete(f"{API}/settings/kiosk-printers/{prn['printer_id']}", headers=ah)


def test_offline_printer_409(ctx):
    r = requests.post(f"{API}/kiosk/kasgeld/{ctx['entry']['id']}/remote-print", json={"printer_id": ctx["prn"]["printer_id"]}, headers=ctx["kh"])
    assert r.status_code == 409
    assert "niet online" in r.json()["detail"]


async def _job(ctx, path):
    async with websockets.connect(WS) as ws:
        await ws.send(json.dumps({"type": "auth", "role": "printer", "device_token": ctx["prn"]["device_token"]}))
        ready = json.loads(await asyncio.wait_for(ws.recv(), 10))
        assert ready["type"] == "printer_ready"
        await asyncio.sleep(1.5)
        r = await asyncio.to_thread(requests.post, f"{API}{path}", json={"printer_id": ctx["prn"]["printer_id"]}, headers=ctx["kh"])
        assert r.status_code == 200, r.text
        job = r.json()["job_id"]
        while True:
            m = json.loads(await asyncio.wait_for(ws.recv(), 10))
            if m.get("type") == "REMOTE_PRINT":
                assert m["job_id"] == job
                return m


def test_kasgeld_remote_print_has_url_and_lines(ctx):
    eid = ctx["entry"]["id"]
    m = asyncio.run(_job(ctx, f"/kiosk/kasgeld/{eid}/remote-print"))
    assert m["kasgeld_id"] == eid
    assert m["url"] == f"/api/kiosk/kasgeld/{eid}/receipt.png"
    assert any("KASBON" in (l.get("text") or "") for l in m["data"]["lines"])


def test_kasgeld_receipt_png(ctx):
    r = requests.get(f"{API}/kiosk/kasgeld/{ctx['entry']['id']}/receipt.png", headers=ctx["kh"])
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"


def test_financial_remote_print_has_url_and_lines(ctx):
    tenants = requests.get(f"{API}/tenants", headers=ctx["ah"])
    if tenants.status_code != 200 or not tenants.json():
        pytest.skip("no kiosk tenants endpoint/data")
    tl = tenants.json() if isinstance(tenants.json(), list) else tenants.json().get("tenants", [])
    tid = tl[0]["id"]
    m = asyncio.run(_job(ctx, f"/kiosk/tenants/{tid}/financial-remote-print"))
    assert m["tenant_id"] == tid
    assert m["url"] == f"/api/kiosk/tenants/{tid}/financial-receipt.png"
    assert any("FINANCIEEL OVERZICHT" in (l.get("text") or "") for l in m["data"]["lines"])
