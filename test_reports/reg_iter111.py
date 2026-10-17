# Iter111: register two fake KT-V520 printers (A = "self" for real-KTP scenario, B = other)
import json, requests
BASE = open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split()[0].rstrip("/")
c = json.load(open("/tmp/iter111_ctx.json"))
out = {}
for k, n in (("A", "TEST KTP iter111 A"), ("B", "TEST KTP iter111 B")):
    r = requests.post(f"{BASE}/api/kiosk/printers/register", json={"name": n}, headers={"Authorization": f"Bearer {c['kiosk_token']}"})
    print(r.status_code, r.text[:300]); out[k] = r.json()
json.dump(out, open("/tmp/iter111_printer.json", "w"))
