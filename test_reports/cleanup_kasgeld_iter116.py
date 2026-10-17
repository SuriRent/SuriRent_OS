# Iter114 cleanup: delete TEST_iter116 kasgeld entries (admin API) + revoke TEST printers
import json, requests
BASE = open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split()[0].rstrip("/")
c = json.load(open("/tmp/iter116_ctx.json")); h = {"Authorization": f"Bearer {c['admin_token']}"}
kh = {"Authorization": f"Bearer {c['kiosk_token']}"}
for e in requests.get(f"{BASE}/api/kiosk/kasgeld", headers=kh).json():
    if str(e.get("description", "")).startswith("TEST_iter116"):
        print("del", e["description"], requests.delete(f"{BASE}/api/kasgeld/{e['id']}", headers=h).status_code)
ps = requests.get(f"{BASE}/api/settings/kiosk-printers", headers=h).json()
for p in (ps if isinstance(ps, list) else ps.get("printers", [])):
    if "TEST" in (p.get("name") or ""):
        print("revoke", p.get("name"), requests.delete(f"{BASE}/api/settings/kiosk-printers/{p['id']}", headers=h).status_code)
