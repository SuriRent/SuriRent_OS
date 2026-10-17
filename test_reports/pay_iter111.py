# Iter110: create 2 SRD 10 cash kiosk payments (Anita) so Bonnen van vandaag has rows
import json, requests
BASE = open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split()[0].rstrip("/")
c = json.load(open("/tmp/iter111_ctx.json"))
ah = {"Authorization": f"Bearer {c['admin_token']}"}; kh = {"Authorization": f"Bearer {c['kiosk_token']}"}
ts = requests.get(f"{BASE}/api/tenants", headers=ah).json()
t = next(x for x in ts if "Roy" in x.get("name", "")) 
emp = next(e for e in requests.get(f"{BASE}/api/employees", headers=ah).json() if e["name"] == "Anita Sewdas")
for i in range(2):
    r = requests.post(f"{BASE}/api/kiosk/payments", params={"employee_id": emp["id"], "employee_pin": "4321"}, headers=kh,
                      json={"tenant_id": t["id"], "apartment_id": t.get("apartment_id"), "amount": 10, "method": "contant", "note": "TEST iter111"})
    print(r.status_code, r.text[:200])
