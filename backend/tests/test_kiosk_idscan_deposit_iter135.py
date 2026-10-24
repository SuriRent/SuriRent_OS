# Kiosk: ID-scan on link-tenant + attach ID photo + immediate deposit — iteration 135
import io
import os
import uuid
import pytest
import requests
from PIL import Image, ImageDraw, ImageFont
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
load_dotenv("/app/backend/.env")
BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
CID = "demo-company-fixed-uuid-00000000000"
mdb = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
CREATED = {"apartments": [], "tenants": [], "assets": []}


def make_id_png() -> bytes:
    img = Image.new("RGB", (900, 560), (225, 235, 245))
    d = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 36)
        small = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 28)
    except Exception:
        font = small = ImageFont.load_default()
    d.rectangle([0, 0, 900, 80], fill=(0, 100, 60))
    d.text((30, 20), "REPUBLIEK SURINAME - IDENTITEITSKAART", fill="white", font=small)
    d.rectangle([30, 120, 250, 400], fill=(180, 180, 180))
    d.text((290, 140), "Naam: Jan Testpersoon", fill="black", font=font)
    d.text((290, 220), "ID-nr: FZ123456", fill="black", font=font)
    d.text((290, 300), "Geboortedatum: 01-02-1990", fill="black", font=font)
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


@pytest.fixture(scope="module")
def admin():
    r = requests.post(f"{API}/auth/login", json={"email": "demo@surirent.sr", "password": "demo1234"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(scope="module")
def kiosk_emp():
    r = requests.post(f"{API}/auth/personal-pin/login", json={"email": "kiosk.medewerker@surirent.sr", "pin": "5566"})
    if r.status_code != 200 or not r.json().get("token"):
        pytest.skip(f"kiosk employee login failed {r.status_code} {r.text[:200]}")
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(scope="module")
def kiosk_admin(admin):
    r = requests.post(f"{API}/auth/admin-to-kiosk", headers=admin, json={})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(scope="module")
def location_id(admin):
    locs = requests.get(f"{API}/locations", headers=admin).json()
    assert locs
    return locs[0]["id"]


def _mk_apt(admin, location_id):
    num = f"ZS{uuid.uuid4().hex[:4].upper()}"
    r = requests.post(f"{API}/apartments", headers=admin, json={
        "number": num, "rent_amount": 2500.0, "currency": "SRD", "location_id": location_id})
    assert r.status_code == 200, r.text
    CREATED["apartments"].append(r.json()["id"])
    return r.json()


@pytest.fixture(scope="module", autouse=True)
def cleanup():
    yield
    for aid in CREATED["apartments"]:
        a = mdb.apartments.find_one({"id": aid})
        if a and a.get("tenant_id"):
            CREATED["tenants"].append(a["tenant_id"])
    tids = list(set(CREATED["tenants"]))
    mdb.contracts.delete_many({"$or": [{"apartment_id": {"$in": CREATED["apartments"]}}, {"tenant_id": {"$in": tids}}]})
    mdb.invoices.delete_many({"tenant_id": {"$in": tids}})
    mdb.deposits.delete_many({"tenant_id": {"$in": tids}})
    mdb.tenants.delete_many({"id": {"$in": tids}})
    mdb.apartments.delete_many({"id": {"$in": CREATED["apartments"]}})
    mdb.landing_assets.delete_many({"id": {"$in": CREATED["assets"]}})


SCAN = {}


class TestIdScan:
    def test_id_scan_requires_auth(self):
        r = requests.post(f"{API}/kiosk/id-scan", files={"file": ("id.png", make_id_png(), "image/png")})
        assert r.status_code == 401

    def test_id_scan_ocr(self, kiosk_emp):
        r = requests.post(f"{API}/kiosk/id-scan", headers=kiosk_emp,
                          files={"file": ("id.png", make_id_png(), "image/png")},
                          data={"user_key": "link-tenant"}, timeout=90)
        assert r.status_code == 200, r.text
        d = r.json()
        print("SCAN RESULT:", d.get("scan"))
        assert d["asset_id"] and d["id_photo_url"] == f"/api/landing/asset/{d['asset_id']}"
        CREATED["assets"].append(d["asset_id"])
        sc = d["scan"]
        assert "jan" in (sc.get("name") or "").lower()
        assert (sc.get("id_number") or "").upper().replace(" ", "") == "FZ123456"
        assert sc.get("birth_date") == "1990-02-01"
        SCAN.update(d)
        a = requests.get(f"{BASE_URL}{d['id_photo_url']}")
        assert a.status_code == 200 and a.headers["content-type"].startswith("image/")


class TestLinkWithScanAndDeposit:
    def test_link_new_with_scan_attach_and_deposit(self, admin, kiosk_emp, location_id):
        if not SCAN:
            pytest.skip("scan failed")
        apt = _mk_apt(admin, location_id)
        sc = SCAN["scan"]
        r = requests.post(f"{API}/kiosk/apartments/{apt['id']}/link-tenant", headers=kiosk_emp, json={
            "new_tenant": {"name": "TEST_" + (sc.get("name") or "Scan"), "id_number": sc.get("id_number") or "",
                           "birth_date": sc.get("birth_date") or ""}})
        assert r.status_code == 200, r.text
        d = r.json()
        CREATED["tenants"].append(d["tenant_id"])
        assert d["apartment_number"] == apt["number"]
        assert d["rent_amount"] == 2500.0 and d["currency"] == "SRD"
        assert d["tenant_name"].startswith("TEST_")
        # attach
        r2 = requests.post(f"{API}/kiosk/tenants/{d['tenant_id']}/attach-id-photo", headers=kiosk_emp,
                           json={"asset_id": SCAN["asset_id"]}, timeout=60)
        assert r2.status_code == 200, r2.text
        assert r2.json()["id_photo_url"] == SCAN["id_photo_url"]
        # admin view
        ts = requests.get(f"{API}/tenants", headers=admin).json()
        t = next(x for x in ts if x["id"] == d["tenant_id"])
        assert t.get("id_photo_url") == SCAN["id_photo_url"]
        assert t.get("birth_date") == "1990-02-01"
        assert t.get("deposit_status") == "pending"
        # deposit
        r3 = requests.post(f"{API}/kiosk/tenants/{d['tenant_id']}/deposit-payment", headers=kiosk_emp,
                           json={"amount": d["rent_amount"], "currency": "SRD", "method": "cash"})
        assert r3.status_code == 200, r3.text
        assert r3.json()["deposit"]["amount"] == 2500.0
        tdoc = mdb.tenants.find_one({"id": d["tenant_id"]})
        assert tdoc["deposit_status"] == "paid"
        lst = requests.get(f"{API}/kiosk/apartments", headers=kiosk_emp).json()
        k = next(x for x in lst if x["id"] == apt["id"])
        assert not k.get("tenant_deposit_pending")
        # double payment blocked
        r4 = requests.post(f"{API}/kiosk/tenants/{d['tenant_id']}/deposit-payment", headers=kiosk_emp,
                           json={"amount": 2500, "currency": "SRD", "method": "cash"})
        assert r4.status_code == 400

    def test_link_existing_returns_deposit_fields(self, admin, kiosk_admin, location_id):
        apt = _mk_apt(admin, location_id)
        tid = str(uuid.uuid4())
        mdb.tenants.insert_one({"id": tid, "company_id": CID, "name": "TEST_Existing Iter135", "apartment_id": None,
                                "created_at": "2026-01-01T00:00:00Z"})
        CREATED["tenants"].append(tid)
        r = requests.post(f"{API}/kiosk/apartments/{apt['id']}/link-tenant", headers=kiosk_admin, json={"tenant_id": tid})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["tenant_name"] == "TEST_Existing Iter135"
        assert d["apartment_number"] == apt["number"] and d["rent_amount"] == 2500.0

    def test_attach_invalid_asset_404(self, kiosk_emp):
        tid = CREATED["tenants"][0] if CREATED["tenants"] else "x"
        r = requests.post(f"{API}/kiosk/tenants/{tid}/attach-id-photo", headers=kiosk_emp, json={"asset_id": "nope"})
        assert r.status_code == 404

    def test_attach_requires_auth(self):
        r = requests.post(f"{API}/kiosk/tenants/x/attach-id-photo", json={"asset_id": "nope"})
        assert r.status_code == 401
