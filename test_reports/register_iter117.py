# Iter117: register a real-mode test KT-V520 printer via kiosk token; store device token for context A
import json, requests
BASE = open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split()[0].rstrip("/")
c = json.load(open("/tmp/iter117_ctx.json"))
kh = {"Authorization": f"Bearer {c['kiosk_token']}"}
r = requests.post(f"{BASE}/api/kiosk/printers/register", json={"name": "TEST KTP iter117 REAL"}, headers=kh)
print("register", r.status_code, {k: v for k, v in r.json().items() if k != "device_token"})
c.update(r.json())
json.dump(c, open("/tmp/iter117_ctx.json", "w"))
print("DEVICE_TOKEN", r.json()["device_token"])
