# Iter121: make Kevin balance.balance>0 while total_due==0 (shift created_at back), or restore with arg "restore"
import sys, json, requests
from pymongo import MongoClient
env = dict(l.split("=", 1) for l in open("/app/backend/.env").read().splitlines() if "=" in l)
db = MongoClient(env["MONGO_URL"].strip('"'))[env["DB_NAME"].strip('"')]
TID = "4972affc-1436-4f60-965c-3b1a0f98e4c3"
BASE = open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split()[0].rstrip("/")
if len(sys.argv) > 1 and sys.argv[1] == "restore":
    orig = json.load(open("/tmp/iter121_kevin.json"))["created_at"]
    db.tenants.update_one({"id": TID}, {"$set": {"created_at": orig}})
    print("restored", orig)
    sys.exit()
t = db.tenants.find_one({"id": TID}, {"_id": 0, "created_at": 1})
json.dump({"created_at": t["created_at"]}, open("/tmp/iter121_kevin.json", "w"))
db.tenants.update_one({"id": TID}, {"$set": {"created_at": "2026-07-01T00:00:00+00:00"}})
ctx = json.load(open("/tmp/iter121_ctx.json"))
print("pin", requests.post(f"{BASE}/api/auth/tenant-set-pin", json={"tenant_id": TID, "pin": "7395"},
                           headers={"Authorization": "Bearer " + ctx["admin_token"]}).status_code)
lr = requests.post(f"{BASE}/api/tenant-portal/login", json={"identifier": "kevin@demo.sr", "pin": "7395"})
tt = lr.json().get("token")
ov = requests.get(f"{BASE}/api/tenant-portal/overview", headers={"Authorization": f"Bearer {tt}"}).json()
print("orig created_at", t["created_at"], "balance", ov["balance"]["balance"], "total_due", ov["total_due"], "is_paid", ov["is_paid"])
