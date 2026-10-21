# Iter114: Kasgeld bon (receipt) — balance_after, print-data, receipt.png, remote-print (409/job + WS REMOTE_PRINT), 404 scope, 401
import asyncio
import json
import os
import uuid

import pytest
import requests
import websockets
from pymongo import MongoClient

BASE_URL = open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split()[0].rstrip("/")
API = f"{BASE_URL}/api"
WS = BASE_URL.replace("https", "wss") + "/api/kiosk/ws"


def _env(key):
    for ln in open("/app/backend/.env"):
        if ln.startswith(key + "="):
            return ln.split("=", 1)[1].strip().strip('"')


@pytest.fixture(scope="module")
def kh():
    r = requests.post(f"{API}/auth/kiosk-pin", json={"pin": "4321", "company_slug": "my-awesome-rentals-bv"})
    if r.status_code != 200:
        pytest.skip(f"kiosk login failed {r.status_code}")
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _emp_params():
    r = requests.post(f"{API}/auth/kiosk-pin", json={"pin": "4321", "company_slug": "my-awesome-rentals-bv"})
    return {"employee_id": r.json()["employee"]["id"], "employee_pin": "4321"}


@pytest.fixture(scope="module")
def ah():
    r = requests.post(f"{API}/auth/login", json={"email": "demo@surirent.sr", "password": "demo1234"})
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(scope="module")
def created(kh, ah):
    ids = []
    yield ids
    for i in ids:
        requests.delete(f"{API}/kasgeld/{i}", headers=ah)


def _create(kh, created, typ="out", amount=12.5, desc="TEST_iter114 bon schoonmaak middelen voor de kantoor ruimte"):
    r = requests.post(f"{API}/kiosk/kasgeld", headers=kh, params=_emp_params(),
                      json={"type": typ, "amount": amount, "currency": "SRD", "description": desc, "category": "schoonmaak"})
    assert r.status_code == 200, r.text
    d = r.json()
    created.append(d["id"])
    return d


# --- create returns + stores balance_after
def test_create_returns_balance_after(kh, created):
    bal_before = requests.get(f"{API}/kiosk/kasgeld/balance", headers=kh).json()["SRD"]
    d = _create(kh, created, "out", 12.5)
    assert isinstance(d.get("balance_after"), (int, float))
    assert round(d["balance_after"], 2) == round(bal_before - 12.5, 2)
    lst = requests.get(f"{API}/kiosk/kasgeld", headers=kh).json()
    row = next(x for x in lst if x["id"] == d["id"])
    assert round(row["balance_after"], 2) == round(d["balance_after"], 2)


# --- print-data lines content
def test_print_data_lines(kh, created):
    d = _create(kh, created, "in", 100)
    r = requests.get(f"{API}/kiosk/kasgeld/{d['id']}/print-data", headers=kh)
    assert r.status_code == 200
    data = r.json()
    texts = [ln["text"] for ln in data["lines"]]
    joined = "\n".join(texts)
    print(joined)
    assert "KASBON" in joined
    assert "INLEG" in joined
    assert "Anita" in joined
    assert "Kassaldo:" in joined
    assert "Schoonmaak" in joined
    assert "100,00" in joined
    assert "TEST_iter114" in joined
    assert all(len(t) <= data["cols"] for t in texts[1:]), [t for t in texts if len(t) > data["cols"]]


def test_print_data_opname(kh, created):
    d = created[0] if created else _create(kh, created)["id"]
    data = requests.get(f"{API}/kiosk/kasgeld/{d}/print-data", headers=kh).json()
    assert any("OPNAME" in ln["text"] for ln in data["lines"])


# --- receipt.png
def test_receipt_png(kh, created):
    d = created[-1]
    r = requests.get(f"{API}/kiosk/kasgeld/{d}/receipt.png", headers=kh)
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("image/png")
    assert r.content[:8] == b"\x89PNG\r\n\x1a\n"
    open("/tmp/iter114_receipt.png", "wb").write(r.content)


# --- auth
def test_unauth_401():
    fake = str(uuid.uuid4())
    for m, u in [("get", f"/kiosk/kasgeld/{fake}/print-data"), ("get", f"/kiosk/kasgeld/{fake}/receipt.png"),
                 ("post", f"/kiosk/kasgeld/{fake}/remote-print")]:
        r = getattr(requests, m)(f"{API}{u}", json={"printer_id": "x"} if m == "post" else None)
        assert r.status_code == 401, (u, r.status_code)


# --- 404 for unknown / other-company entry
def test_other_company_404(kh):
    mc = MongoClient(_env("MONGO_URL"))[_env("DB_NAME")]
    oid = "TEST_iter114_" + str(uuid.uuid4())
    mc.kasgeld.insert_one({"id": oid, "company_id": "TEST_other_company", "type": "in", "amount": 5, "currency": "SRD",
                           "description": "TEST_iter114 other", "created_at": "2026-01-01T00:00:00+00:00"})
    try:
        assert requests.get(f"{API}/kiosk/kasgeld/{oid}/print-data", headers=kh).status_code == 404
        assert requests.get(f"{API}/kiosk/kasgeld/{oid}/receipt.png", headers=kh).status_code == 404
        assert requests.get(f"{API}/kiosk/kasgeld/{uuid.uuid4()}/print-data", headers=kh).status_code == 404
    finally:
        mc.kasgeld.delete_one({"id": oid})


# --- remote-print offline 409
def test_remote_print_offline_409(kh, created):
    r = requests.post(f"{API}/kiosk/kasgeld/{created[-1]}/remote-print", headers=kh, json={"printer_id": "nope"})
    assert r.status_code == 409


# --- remote-print online -> job_id + WS REMOTE_PRINT with kasgeld_id + data.lines; 404 for other entry while online
def test_remote_print_online(kh, ah, created):
    reg = requests.post(f"{API}/kiosk/printers/register", json={"name": "TEST KTP iter114 pytest"}, headers=kh)
    assert reg.status_code == 200, reg.text
    prn = reg.json()
    pid = prn.get("id") or prn.get("printer_id") or prn.get("printer", {}).get("id")
    tok = prn.get("device_token") or prn.get("token")
    eid = created[-1]

    async def run():
        async with websockets.connect(WS, open_timeout=10) as ws:
            await ws.send(json.dumps({"type": "auth", "role": "printer", "device_token": tok, "device": {"ua": "pytest"}}))
            await asyncio.wait_for(ws.recv(), 10)
            await asyncio.sleep(1.5)
            online = requests.get(f"{API}/kiosk/printers/online", headers=kh).json()
            ids = [p["id"] for p in online]
            assert pid in ids, online
            r404 = requests.post(f"{API}/kiosk/kasgeld/{uuid.uuid4()}/remote-print", headers=kh, json={"printer_id": pid})
            assert r404.status_code == 404
            r = requests.post(f"{API}/kiosk/kasgeld/{eid}/remote-print", headers=kh, json={"printer_id": pid})
            assert r.status_code == 200, r.text
            job = r.json()["job_id"]
            end = asyncio.get_event_loop().time() + 10
            while asyncio.get_event_loop().time() < end:
                m = json.loads(await asyncio.wait_for(ws.recv(), 10))
                if m.get("type") == "REMOTE_PRINT":
                    assert m["job_id"] == job
                    assert m["kasgeld_id"] == eid
                    assert m["data"]["lines"] and m["data"]["printer"] == "kt-v520"
                    return True
            return False
    try:
        assert asyncio.run(run())
    finally:
        requests.delete(f"{API}/settings/kiosk-printers/{pid}", headers=ah)
