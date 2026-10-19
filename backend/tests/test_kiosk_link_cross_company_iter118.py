# Iter118: link-device cross-company isolation (404 for other company printer) + hijack of another company's bound kiosk_id
import os, uuid, asyncio
import pytest, requests
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
BASE = (os.environ.get("REACT_APP_BACKEND_URL") or open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split()[0]).rstrip("/")
API = f"{BASE}/api"


def _db(fn):
    async def run():
        db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
        return await fn(db)
    return asyncio.run(run())


@pytest.fixture(scope="module")
def ctx():
    a = requests.post(f"{API}/auth/login", json={"email": "demo@surirent.sr", "password": "demo1234"})
    ah = {"Authorization": f"Bearer {a.json()['token']}"}
    k = requests.post(f"{API}/auth/kiosk-pin", json={"pin": "4321", "company_slug": "my-awesome-rentals-bv"})
    if k.status_code != 200:
        pytest.skip("kiosk PIN failed")
    kh = {"Authorization": f"Bearer {k.json()['token']}"}
    own = requests.post(f"{API}/kiosk/printers/register", json={"name": "TEST KTP iter118 x"}, headers=kh).json()
    other_id, kid = f"TEST-{uuid.uuid4()}", f"kiosk-otherco{uuid.uuid4().hex[:6]}"
    _db(lambda db: db.kiosk_printers.insert_one({"id": other_id, "company_id": "TEST-other-company", "name": "TEST other",
                                                  "token_hash": "x", "created_at": "2026", "last_seen": 0, "revoked": False,
                                                  "kiosk_ids": [kid]}))
    yield {"ah": ah, "own": own["printer_id"], "other": other_id, "kid": kid}
    requests.delete(f"{API}/settings/kiosk-printers/{own['printer_id']}", headers=ah)
    _db(lambda db: db.kiosk_printers.delete_one({"id": other_id}))
    _db(lambda db: db.kiosk_id_owners.delete_one({"kiosk_id": kid}))


def test_link_other_company_printer_404(ctx):
    r = requests.post(f"{API}/settings/kiosk-printers/{ctx['other']}/link-device", json={"kiosk_id": "kiosk-abc123"}, headers=ctx["ah"])
    assert r.status_code == 404


def test_cannot_steal_other_company_kiosk_id(ctx):
    r = requests.post(f"{API}/settings/kiosk-printers/{ctx['own']}/link-device", json={"kiosk_id": ctx["kid"]}, headers=ctx["ah"])
    assert r.status_code == 409, r.text  # iter119: owned by other company via fallback
    other = _db(lambda db: db.kiosk_printers.find_one({"id": ctx["other"]}, {"_id": 0, "kiosk_ids": 1}))
    # Security expectation: a company admin must not be able to unbind another company's device
    assert ctx["kid"] in (other.get("kiosk_ids") or []), f"HIJACK: status {r.status_code}, other company's kiosk_id was pulled"
