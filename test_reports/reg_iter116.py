# Iter113: register one fake KT-V520 printer + list tenants with dues
import json, requests, sys
NAME = sys.argv[1] if len(sys.argv) > 1 else "A"
BASE = open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split()[0].rstrip("/")
c = json.load(open("/tmp/iter116_ctx.json"))
r = requests.post(f"{BASE}/api/kiosk/printers/register", json={"name": f"TEST KTP iter116 {NAME}"}, headers={"Authorization": f"Bearer {c['kiosk_token']}"})
print(r.status_code, r.text[:300])
json.dump(r.json(), open(f"/tmp/iter116_printer_{NAME}.json", "w"))
