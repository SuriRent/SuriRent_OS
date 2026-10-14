"""Setup for iter85 frontend test: reseed Anita, kiosk-pin login, insert today's test payment, register KT-V520 printer."""
import os, requests, json, time, uuid
from datetime import datetime, timezone
from pymongo import MongoClient

BASE = "https://vastgoed-app.preview.emergentagent.com"
SLUG = "my-awesome-rentals-bv"
COMPANY_ID = "demo-company-fixed-uuid-00000000000"
import requests as _rq
_sess_ = _rq.Session()
_rl = _sess_.post("https://vastgoed-app.preview.emergentagent.com/api/auth/login", json={"email": "demo@surirent.sr", "password": "demo1234"})
_tok_ = _rl.json()["token"]
_emps = _sess_.get("https://vastgoed-app.preview.emergentagent.com/api/employees",
                   headers={"Authorization": f"Bearer {_tok_}"}).json()
ANITA_ID = next(e["id"] for e in _emps if "Anita" in e.get("name",""))
print("Resolved ANITA_ID:", ANITA_ID)

s = requests.Session()
r = s.post(f"{BASE}/api/auth/login", json={"email": "demo@surirent.sr", "password": "demo1234"})
r.raise_for_status()
admin_token = r.json()["token"]
print("admin login ok")

# reseed Anita
pr = s.put(f"{BASE}/api/employees/{ANITA_ID}",
           headers={"Authorization": f"Bearer {admin_token}"},
           json={"name": "Anita Sewdas", "app_role": "kiosk", "email": "", "monthly_salary": 0,
                 "currency": "SRD", "active": True, "pin": "4321"})
print("reseed Anita:", pr.status_code, pr.text[:120])

# kiosk-pin login
kr = requests.post(f"{BASE}/api/auth/kiosk-pin", json={"pin": "4321", "company_slug": SLUG})
kr.raise_for_status()
kd = kr.json()
kiosk_token = kd["token"]
print("kiosk login ok, emp:", kd.get("employee", {}).get("name"))

# insert a test payment for Anita today
c = MongoClient("mongodb://localhost:27017")
db = c["vastgoed_kiosk"]
pid = "TEST_" + str(uuid.uuid4())
rn = "TEST-" + uuid.uuid4().hex[:8].upper()
now_iso = datetime.now(timezone.utc).isoformat()
db.payments.insert_one({
    "id": pid, "company_id": COMPANY_ID, "tenant_name": "TEST Huurder Iter85",
    "receipt_number": rn, "amount": 1234, "currency": "SRD",
    "status": "approved", "method": "cash", "created_at": time.time(),
    "paid_at": now_iso,
    "kiosk_employee_id": ANITA_ID, "kiosk_employee_name": "Anita Sewdas",
})
print("inserted payment:", pid, rn)

# register printer with kiosk token
rp = requests.post(f"{BASE}/api/kiosk/printers/register",
                   json={"name": "TEST_Iter85 KT-V520"},
                   cookies={"kiosk_token": kiosk_token})
rp.raise_for_status()
pr_data = rp.json()
print("registered printer:", pr_data)

out = {
    "admin_token": admin_token,
    "kiosk_token": kiosk_token,
    "company": kd.get("company", {}),
    "employee": kd.get("employee", {}),
    "payment_id": pid,
    "receipt_number": rn,
    "printer_id": pr_data["printer_id"],
    "device_token": pr_data["device_token"],
    "printer_name": pr_data["name"],
}
with open("/tmp/iter85_ctx.json", "w") as f:
    json.dump(out, f)
print("CTX WRITTEN")
