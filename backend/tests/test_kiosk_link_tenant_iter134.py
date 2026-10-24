# Kiosk: vacant apartments + link tenant (existing/new) — iteration 134
import os
import uuid
import pytest
import requests
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
load_dotenv("/app/backend/.env")
BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
CID = "demo-company-fixed-uuid-00000000000"

mdb = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]

CREATED = {"apartments": [], "tenants": []}


def _admin_token():
    r = requests.post(f"{API}/auth/login", json={"email": "demo@surirent.sr", "password": "demo1234"})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin():
    return {"Authorization": f"Bearer {_admin_token()}"}


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


def _mk_apt(admin, location_id, num=None):
    num = num or f"ZT{uuid.uuid4().hex[:4].upper()}"
    r = requests.post(f"{API}/apartments", headers=admin, json={
        "number": num, "rent_amount": 1234.0, "currency": "SRD", "location_id": location_id})
    assert r.status_code == 200, r.text
    a = r.json()
    CREATED["apartments"].append(a["id"])
    return a


def _mk_tenant_unassigned(name):
    tid = str(uuid.uuid4())
    mdb.tenants.insert_one({"id": tid, "company_id": CID, "name": name, "phone": "+597 8889999",
                            "email": "", "id_number": "TESTID1", "apartment_id": None,
                            "created_at": "2026-01-01T00:00:00Z"})
    CREATED["tenants"].append(tid)
    return tid


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
    mdb.tenants.delete_many({"id": {"$in": tids}})
    mdb.apartments.delete_many({"id": {"$in": CREATED["apartments"]}})


class TestKioskVacant:
    def test_vacant_apartment_listed_and_counted(self, admin, kiosk_emp, location_id):
        a = _mk_apt(admin, location_id)
        r = requests.get(f"{API}/kiosk/apartments", headers=kiosk_emp)
        assert r.status_code == 200
        found = [x for x in r.json() if x["id"] == a["id"]]
        assert found and found[0]["status"] == "vacant" and not found[0]["tenant_id"]
        locs = requests.get(f"{API}/kiosk/locations", headers=kiosk_emp).json()
        loc = next(l for l in locs if l["id"] == location_id)
        total = mdb.apartments.count_documents({"company_id": CID, "location_id": location_id})
        assert loc["apartments_total"] == total

    def test_unassigned_tenants_list(self, kiosk_emp):
        tid = _mk_tenant_unassigned("TEST_Unassigned Alpha")
        arch = _mk_tenant_unassigned("TEST_Archived Beta")
        mdb.tenants.update_one({"id": arch}, {"$set": {"status": "archived"}})
        r = requests.get(f"{API}/kiosk/tenants/unassigned", headers=kiosk_emp)
        assert r.status_code == 200
        ids = [t["id"] for t in r.json()]
        assert tid in ids and arch not in ids
        assert all("_id" not in t for t in r.json())
        # none returned should have apartment
        for t in r.json():
            d = mdb.tenants.find_one({"id": t["id"]})
            assert not d.get("apartment_id")

    def test_unassigned_requires_kiosk(self):
        assert requests.get(f"{API}/kiosk/tenants/unassigned").status_code == 401


class TestKioskLink:
    def test_link_new_tenant_employee(self, admin, kiosk_emp, location_id):
        a = _mk_apt(admin, location_id)
        r = requests.post(f"{API}/kiosk/apartments/{a['id']}/link-tenant", headers=kiosk_emp,
                          json={"new_tenant": {"name": "TEST_Nieuw Huurder", "phone": "+597 7123456",
                                               "email": "TEST_NEW@x.sr", "id_number": "FB123"}})
        assert r.status_code == 200, r.text
        tid = r.json()["tenant_id"]
        CREATED["tenants"].append(tid)
        t = mdb.tenants.find_one({"id": tid}, {"_id": 0})
        assert t["name"] == "TEST_Nieuw Huurder" and t["apartment_id"] == a["id"]
        assert t["email"] == "test_new@x.sr" and t["phone_digits"] == "5977123456"
        assert t["deposit_status"] == "pending" and t["deposit_required"] is True
        apts = requests.get(f"{API}/kiosk/apartments", headers=kiosk_emp).json()
        x = next(z for z in apts if z["id"] == a["id"])
        assert x["status"] == "occupied" and x["tenant_name"] == "TEST_Nieuw Huurder"
        assert x["tenant_deposit_pending"] is True
        c = mdb.contracts.find_one({"tenant_id": tid, "apartment_id": a["id"]})
        assert c and c["status"] == "draft" and c["deposit_amount"] == 1234.0
        ov = requests.get(f"{API}/kiosk/tenants/{tid}/overview", headers=kiosk_emp)
        assert ov.status_code == 200, ov.text

    def test_link_existing_tenant_admin_kiosk(self, admin, kiosk_admin, location_id):
        a = _mk_apt(admin, location_id)
        tid = _mk_tenant_unassigned("TEST_Existing Gamma")
        r = requests.post(f"{API}/kiosk/apartments/{a['id']}/link-tenant", headers=kiosk_admin, json={"tenant_id": tid})
        assert r.status_code == 200, r.text
        assert r.json()["tenant_id"] == tid
        t = mdb.tenants.find_one({"id": tid})
        assert t["apartment_id"] == a["id"] and t["deposit_status"] == "pending"
        ap = mdb.apartments.find_one({"id": a["id"]})
        assert ap["tenant_id"] == tid and ap["status"] == "occupied"
        assert mdb.contracts.count_documents({"tenant_id": tid, "apartment_id": a["id"], "status": "draft"}) == 1
        # no longer in unassigned list
        ids = [x["id"] for x in requests.get(f"{API}/kiosk/tenants/unassigned", headers=kiosk_admin).json()]
        assert tid not in ids

    def test_occupied_apartment_409(self, admin, kiosk_emp, location_id):
        a = _mk_apt(admin, location_id)
        r1 = requests.post(f"{API}/kiosk/apartments/{a['id']}/link-tenant", headers=kiosk_emp,
                           json={"new_tenant": {"name": "TEST_First"}})
        assert r1.status_code == 200
        CREATED["tenants"].append(r1.json()["tenant_id"])
        tid = _mk_tenant_unassigned("TEST_Second")
        r2 = requests.post(f"{API}/kiosk/apartments/{a['id']}/link-tenant", headers=kiosk_emp, json={"tenant_id": tid})
        assert r2.status_code == 409
        r3 = requests.post(f"{API}/kiosk/apartments/{a['id']}/link-tenant", headers=kiosk_emp,
                           json={"new_tenant": {"name": "TEST_Third"}})
        assert r3.status_code == 409
        assert mdb.tenants.count_documents({"name": "TEST_Third", "company_id": CID}) == 0
        assert not mdb.tenants.find_one({"id": tid}).get("apartment_id")

    def test_tenant_with_apartment_409(self, admin, kiosk_emp, location_id):
        a1 = _mk_apt(admin, location_id)
        a2 = _mk_apt(admin, location_id)
        r = requests.post(f"{API}/kiosk/apartments/{a1['id']}/link-tenant", headers=kiosk_emp,
                          json={"new_tenant": {"name": "TEST_Busy"}})
        tid = r.json()["tenant_id"]
        CREATED["tenants"].append(tid)
        r2 = requests.post(f"{API}/kiosk/apartments/{a2['id']}/link-tenant", headers=kiosk_emp, json={"tenant_id": tid})
        assert r2.status_code == 409
        assert mdb.apartments.find_one({"id": a2["id"]})["status"] == "vacant"

    def test_missing_both_400_and_empty_name_400(self, admin, kiosk_emp, location_id):
        a = _mk_apt(admin, location_id)
        assert requests.post(f"{API}/kiosk/apartments/{a['id']}/link-tenant", headers=kiosk_emp, json={}).status_code == 400
        assert requests.post(f"{API}/kiosk/apartments/{a['id']}/link-tenant", headers=kiosk_emp,
                             json={"new_tenant": {"name": "   "}}).status_code == 400

    def test_archived_tenant_404_and_unknown_apt_404(self, admin, kiosk_emp, location_id):
        a = _mk_apt(admin, location_id)
        tid = _mk_tenant_unassigned("TEST_Arch2")
        mdb.tenants.update_one({"id": tid}, {"$set": {"status": "archived"}})
        assert requests.post(f"{API}/kiosk/apartments/{a['id']}/link-tenant", headers=kiosk_emp,
                             json={"tenant_id": tid}).status_code == 404
        assert requests.post(f"{API}/kiosk/apartments/nope-{uuid.uuid4()}/link-tenant", headers=kiosk_emp,
                             json={"new_tenant": {"name": "TEST_X"}}).status_code == 404

    def test_link_requires_kiosk_session(self, admin, location_id):
        a = _mk_apt(admin, location_id)
        assert requests.post(f"{API}/kiosk/apartments/{a['id']}/link-tenant",
                             json={"new_tenant": {"name": "TEST_NoAuth"}}).status_code == 401


class TestAdminRegression:
    def test_admin_create_tenant_with_apartment(self, admin, location_id):
        a = _mk_apt(admin, location_id)
        r = requests.post(f"{API}/tenants", headers=admin, json={"name": "TEST_Admin Tenant", "apartment_id": a["id"],
                                                                 "phone": "+597 1112222"})
        assert r.status_code == 200, r.text
        tid = r.json()["id"]
        CREATED["tenants"].append(tid)
        ap = mdb.apartments.find_one({"id": a["id"]})
        assert ap["status"] == "occupied" and ap["tenant_id"] == tid
        c = mdb.contracts.find_one({"tenant_id": tid, "apartment_id": a["id"]})
        assert c and c["status"] == "draft" and c.get("auto_created_from_tenant") is True
