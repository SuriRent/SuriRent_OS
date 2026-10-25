# Cleanup for iter138: removes TEST Archief tenants, TEST-ARC apartments and TEST BK employee (by name prefix).
import os
from datetime import datetime, timezone
import requests

B = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
s = requests.Session()
s.headers["Authorization"] = "Bearer " + s.post(f"{B}/api/auth/login", json={"email": "demo@surirent.sr", "password": "demo1234"}).json()["token"]
today = datetime.now(timezone.utc).date().isoformat()
tenants = s.get(f"{B}/api/tenants").json() + s.get(f"{B}/api/tenants/archived").json()
for t in tenants:
    if (t.get("name") or "").startswith("TEST Archief"):
        if t.get("status") != "archived":
            s.post(f"{B}/api/tenants/{t['id']}/move-out", json={"move_out_date": today, "damage_items": [], "exclude_invoice_ids": []})
        print("del tenant", t["name"], s.delete(f"{B}/api/tenants/{t['id']}/permanent").status_code)
for a in s.get(f"{B}/api/apartments").json():
    if (a.get("number") or "").startswith("TEST-ARC"):
        print("del apt", a["number"], s.delete(f"{B}/api/apartments/{a['id']}").status_code)
for e in s.get(f"{B}/api/employees").json():
    if e.get("name") == "TEST BK":
        print("del emp", s.delete(f"{B}/api/employees/{e['id']}").status_code)
