# Setup/cleanup for iteration 136 UI tests: usage python setup_iter136.py [setup|cleanup|credit]
import os, sys, json, uuid, requests
from pymongo import MongoClient
from dotenv import load_dotenv
load_dotenv("/app/frontend/.env"); load_dotenv("/app/backend/.env")
API = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") + "/api"
mdb = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
OUT = "/tmp/iter136.json"


def login():
    r = requests.post(f"{API}/auth/login", json={"email": "demo@surirent.sr", "password": "demo1234"})
    tok = r.json()["token"]
    h = {"Authorization": f"Bearer {tok}"}
    k = requests.post(f"{API}/auth/admin-to-kiosk", headers=h, json={}).json()
    return tok, h, k


def setup():
    tok, h, k = login()
    kh = {"Authorization": f"Bearer {k['token']}"}
    locs = requests.get(f"{API}/locations", headers=h).json()
    loc = locs[0]
    out = {"admin_token": tok, "kiosk_token": k["token"], "company": k.get("company"), "location_id": loc["id"], "apts": [], "tenants": []}
    # tenant with invoice + credit
    a = requests.post(f"{API}/apartments", headers=h, json={"number": "ZINV" + uuid.uuid4().hex[:3].upper(), "rent_amount": 1500.0, "currency": "SRD", "location_id": loc["id"]}).json()
    out["apts"].append(a["id"])
    tid = requests.post(f"{API}/kiosk/apartments/{a['id']}/link-tenant", headers=kh, json={"new_tenant": {"name": "TEST_Krediet Huurder", "email": "test_credit136@example.com"}}).json()["tenant_id"]
    out["tenants"].append(tid)
    mdb.contracts.delete_many({"tenant_id": tid})
    inv = requests.post(f"{API}/invoices", headers=h, json={"tenant_id": tid, "period_month": 1, "period_year": 2026}).json()
    cid = mdb.apartments.find_one({"id": a["id"]})["company_id"]
    mdb.payments.insert_one({"id": str(uuid.uuid4()), "company_id": cid, "tenant_id": tid, "amount": 400.0, "currency": "SRD",
                             "status": "approved", "category": "vooruitbetaling", "credit_remaining": 400.0, "method": "cash",
                             "paid_at": "2026-01-01T00:00:00Z", "receipt_number": "TEST-R136"})
    out.update(credit_tid=tid, credit_inv=inv["id"], credit_apt=a["number"])
    # vacant apartments for contract flow
    for i in range(3):
        v = requests.post(f"{API}/apartments", headers=h, json={"number": f"ZV{i}{uuid.uuid4().hex[:2].upper()}", "rent_amount": 1800.0, "currency": "SRD", "location_id": loc["id"]}).json()
        out["apts"].append(v["id"]); out.setdefault("vacant", []).append(v["number"])
    json.dump(out, open(OUT, "w"))
    print(json.dumps({k2: v2 for k2, v2 in out.items() if "token" not in k2}, indent=1))


def cleanup():
    out = json.load(open(OUT))
    tids = set(out["tenants"])
    for aid in out["apts"]:
        a = mdb.apartments.find_one({"id": aid})
        if a and a.get("tenant_id"):
            tids.add(a["tenant_id"])
    tids |= {t["id"] for t in mdb.tenants.find({"name": {"$regex": "^TEST_"}}, {"id": 1})}
    tids = list(tids)
    print(mdb.contracts.delete_many({"$or": [{"apartment_id": {"$in": out["apts"]}}, {"tenant_id": {"$in": tids}}]}).deleted_count,
          mdb.invoices.delete_many({"tenant_id": {"$in": tids}}).deleted_count,
          mdb.payments.delete_many({"tenant_id": {"$in": tids}}).deleted_count,
          mdb.deposits.delete_many({"tenant_id": {"$in": tids}}).deleted_count,
          mdb.tenants.delete_many({"id": {"$in": tids}}).deleted_count,
          mdb.apartments.delete_many({"id": {"$in": out["apts"]}}).deleted_count)


if __name__ == "__main__":
    {"setup": setup, "cleanup": cleanup}[sys.argv[1]]()
