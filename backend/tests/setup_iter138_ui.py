# UI setup iter138: tenant A (archived via API move-out, 2 open invoices + borg 1000) and tenant B (active, for UI move-out).
import os, json
from datetime import datetime, timezone
import requests
B = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
s = requests.Session()
s.headers["Authorization"] = "Bearer " + s.post(f"{B}/api/auth/login", json={"email": "demo@surirent.sr", "password": "demo1234"}).json()["token"]
now = datetime.now(timezone.utc)
def prev(n):
    m, y = now.month - n, now.year
    while m < 1: m += 12; y -= 1
    return m, y
out = {}
for key, num in (("A", "TEST-ARC-UA"), ("B", "TEST-ARC-UB")):
    a = s.post(f"{B}/api/apartments", json={"number": num, "rent_amount": 2000, "currency": "SRD"}).json()["id"]
    t = s.post(f"{B}/api/tenants", json={"name": f"TEST Archief UI {key}", "phone": "59713" + key, "apartment_id": a}).json()["id"]
    s.post(f"{B}/api/deposits", json={"tenant_id": t, "amount": 1000, "currency": "SRD"})
    for n in (2, 1):
        m, y = prev(n)
        s.post(f"{B}/api/invoices", json={"tenant_id": t, "period_month": m, "period_year": y})
    out[key] = {"t": t, "a": a, "invs": [i["id"] for i in s.get(f"{B}/api/invoices").json() if i["tenant_id"] == t]}
r = s.post(f"{B}/api/tenants/{out['A']['t']}/move-out", json={"move_out_date": now.date().isoformat(), "damage_items": [], "exclude_invoice_ids": []})
print("moveout A", r.status_code)
json.dump(out, open("/tmp/iter138.json", "w")); print(json.dumps(out))
