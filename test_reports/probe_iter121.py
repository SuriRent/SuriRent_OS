# Iter121 probe: kiosk PIN, tenants with total_due vs balance.balance
import json, requests
BASE = open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split()[0].rstrip("/")
API = f"{BASE}/api"
r = requests.post(f"{API}/auth/login", json={"email": "demo@surirent.sr", "password": "demo1234"})
tok = r.json()["token"]; hdr = {"Authorization": f"Bearer {tok}"}
print("admin", r.status_code, r.json().get("user", {}).get("company_id"))
k = requests.post(f"{API}/auth/kiosk-pin", json={"pin": "4321", "company_slug": "my-awesome-rentals-bv"})
print("kiosk", k.status_code)
if k.status_code != 200:
    emps = requests.get(f"{API}/employees", headers=hdr).json()
    a = next((e for e in emps if e["name"] == "Anita Sewdas"), None)
    p = {"name": a["name"], "role": a.get("role") or "", "app_role": "kiosk", "phone": a.get("phone") or "",
         "email": a.get("email") or "anita.iter121@demo.sr", "password": "anita1234", "pin": "4321", "monthly_salary": 0, "currency": "SRD", "active": True}
    rr = requests.put(f"{API}/employees/{a['id']}", json=p, headers=hdr); print("put", rr.status_code, rr.text[:200], a.get("email"))
    k = requests.post(f"{API}/auth/kiosk-pin", json={"pin": "4321", "company_slug": "my-awesome-rentals-bv"})
    print("kiosk2", k.status_code)
kt = k.json().get("token") or k.json().get("access_token")
kh = {"Authorization": f"Bearer {kt}"}
apts = requests.get(f"{API}/kiosk/apartments", headers=kh).json()
print("apts", len(apts))
rows = []
for a in apts:
    if not a.get("tenant_id"):
        continue
    ov = requests.get(f"{API}/kiosk/tenants/{a['tenant_id']}/overview", headers=kh).json()
    rows.append((a["number"], a["tenant_id"], a["tenant_name"], a["pay_status"], ov.get("total_due"),
                 ov.get("open_invoices_total"), ov.get("current_invoices_total"), ov.get("future_invoices_total"),
                 ov.get("is_paid"), (ov.get("balance") or {}).get("balance"), ov["tenant"].get("email")))
for r_ in rows:
    print(r_)
json.dump({"admin_token": tok, "kiosk_token": kt}, open("/tmp/iter121_ctx.json", "w"))
