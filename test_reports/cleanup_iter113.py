# Iter110 cleanup: revoke test/auto-registered kiosk printers
import json, requests
BASE = open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split()[0].rstrip("/")
c = json.load(open("/tmp/iter113_ctx.json")); h = {"Authorization": f"Bearer {c['admin_token']}"}
ps = requests.get(f"{BASE}/api/settings/kiosk-printers", headers=h).json()
print(ps)
for p in (ps if isinstance(ps, list) else ps.get("printers", [])):
    print(p.get("name"), requests.delete(f"{BASE}/api/settings/kiosk-printers/{p['id']}", headers=h).status_code)
