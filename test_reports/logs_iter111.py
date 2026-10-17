# Iter110: list today's print logs per employee
import json, requests
BASE = open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split()[0].rstrip("/")
c = json.load(open("/tmp/iter111_ctx.json")); h = {"Authorization": f"Bearer {c['kiosk_token']}"}
since = "2026-10-17T00:00:00Z"
emps = requests.get(f"{BASE}/api/kiosk/print-log/employees", params={"since": since}, headers=h).json()
for e in emps:
    l = requests.get(f"{BASE}/api/kiosk/print-log", params={"since": since, "employee": e["key"]}, headers=h).json()
    print(e, len(l) if isinstance(l, list) else l)
