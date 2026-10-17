# Iter110: register a fake KT-V520 printer and print device_token
import json, requests
BASE = open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split()[0].rstrip("/")
c = json.load(open("/tmp/iter110_ctx.json"))
r = requests.post(f"{BASE}/api/kiosk/printers/register", json={"name": "TEST KTP iter110"}, headers={"Authorization": f"Bearer {c['kiosk_token']}"})
print(r.status_code, r.text[:300]); json.dump(r.json(), open("/tmp/iter110_printer.json", "w"))
