# Iter113: register one fake KT-V520 printer + list tenants with dues
import json, requests
BASE = open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split()[0].rstrip("/")
c = json.load(open("/tmp/iter113_ctx.json"))
r = requests.post(f"{BASE}/api/kiosk/printers/register", json={"name": "TEST KTP iter113"}, headers={"Authorization": f"Bearer {c['kiosk_token']}"})
print(r.status_code, r.text[:300])
json.dump(r.json(), open("/tmp/iter113_printer.json", "w"))
ah = {"Authorization": f"Bearer {c['admin_token']}"}
for t in requests.get(f"{BASE}/api/tenants", headers=ah).json():
    print(t.get("name"), t.get("apartment_id"), t.get("outstanding") or t.get("balance") or t.get("total_due"))
