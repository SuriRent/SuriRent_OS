# Iter140 UI helper: setup (archived tenant with debt) / cleanup. Usage: python ui_iter140_setup.py setup|cleanup
import os, sys, json, requests
from datetime import datetime, timezone
B = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
F = "/tmp/iter140_ui.json"
s = requests.Session()
r = s.post(f"{B}/api/auth/login", json={"email": "demo@surirent.sr", "password": "demo1234"})
s.headers["Authorization"] = f"Bearer {r.json()['token']}"
if sys.argv[1] == "setup":
    a = s.post(f"{B}/api/apartments", json={"number": "TEST-UI-9", "rent_amount": 2000, "currency": "SRD"}).json()["id"]
    t = s.post(f"{B}/api/tenants", json={"name": "TEST UI Schuld", "phone": "597812999", "apartment_id": a}).json()["id"]
    s.post(f"{B}/api/deposits", json={"tenant_id": t, "amount": 1000, "currency": "SRD"})
    r = s.post(f"{B}/api/tenants/{t}/move-out", json={"move_out_date": datetime.now(timezone.utc).date().isoformat(),
                                                      "damage_items": [{"description": "Deur", "amount": 500}], "exclude_invoice_ids": []})
    print(r.status_code, r.json().get("deposit", {}).get("amount_due"))
    json.dump({"a": a, "t": t}, open(F, "w"))
    print(json.dumps({"a": a, "t": t}))
else:
    d = json.load(open(F))
    pays = [p for p in s.get(f"{B}/api/payments", params={"status": "all", "limit": 5000}).json() if p.get("tenant_id") == d["t"]]
    print(s.delete(f"{B}/api/tenants/{d['t']}/permanent").status_code)
    for p in pays:
        print("pay", s.delete(f"{B}/api/payments/{p['id']}").status_code)
    print(s.delete(f"{B}/api/apartments/{d['a']}").status_code)
