# Iter109 setup: restore Anita kiosk PIN 4321, ensure admin PIN, dump kiosk token + payment/print-log context
import json, requests
BASE = open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split()[0].rstrip("/")
API = f"{BASE}/api"
r = requests.post(f"{API}/auth/login", json={"email": "demo@surirent.sr", "password": "demo1234"})
print("admin login", r.status_code)
tok = r.json()["token"]; hdr = {"Authorization": f"Bearer {tok}"}
emps = requests.get(f"{API}/employees", headers=hdr).json()
a = next((e for e in emps if e["name"] == "Anita Sewdas"), None)
print("anita", bool(a))
if a:
    p = {"name": a["name"], "role": a.get("role") or "", "app_role": "kiosk", "phone": a.get("phone") or "",
         "email": "anita.iter111b@demo.sr", "password": "anita1234", "pin": "4321", "monthly_salary": 0, "currency": "SRD", "active": True}
    rr = requests.put(f"{API}/employees/{a['id']}", json=p, headers=hdr); print("put", rr.status_code, rr.text[:300])
print("admin pin", requests.post(f"{API}/auth/personal-pin/setup", json={"pin": "8642"}, headers=hdr).status_code)
k = requests.post(f"{API}/auth/kiosk-pin", json={"pin": "4321", "company_slug": "my-awesome-rentals-bv"})
print("kiosk", k.status_code, list(k.json().keys()))
kt = k.json().get("token") or k.json().get("access_token")
kh = {"Authorization": f"Bearer {kt}"}
print("online", requests.get(f"{API}/kiosk/printers/online", headers=kh).text[:300])
print("emps today", requests.get(f"{API}/kiosk/print-log/employees", params={"since": "2026-01-01T00:00:00Z"}, headers=kh).text[:300])
json.dump({"admin_token": tok, "kiosk_token": kt}, open("/tmp/iter111_ctx.json", "w"))
