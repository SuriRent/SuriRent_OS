# UI setup for iteration 131 move-out test: creates apt + tenant + deposit + past invoice (prints ids)
import os, sys, json
from datetime import datetime, timezone
import requests

B = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
s = requests.Session()
tok = s.post(f"{B}/api/auth/login", json={"email": "demo@surirent.sr", "password": "demo1234"}).json()["token"]
s.headers["Authorization"] = f"Bearer {tok}"
if len(sys.argv) > 1 and sys.argv[1] == "cleanup":
    ids = json.load(open("/tmp/iter131_ui.json"))
    tids = ids["tenants"]
    for p in s.get(f"{B}/api/payments").json():
        if p.get("tenant_id") in tids:
            s.delete(f"{B}/api/payments/{p['id']}")
    for i in s.get(f"{B}/api/invoices").json():
        if i.get("tenant_id") in tids:
            s.delete(f"{B}/api/invoices/{i['id']}")
    for c in s.get(f"{B}/api/contracts").json():
        if c.get("tenant_id") in tids:
            s.delete(f"{B}/api/contracts/{c['id']}")
    for d in s.get(f"{B}/api/deposits").json():
        if d.get("tenant_id") in tids:
            s.delete(f"{B}/api/deposits/{d['id']}")
    for t in tids:
        s.delete(f"{B}/api/tenants/{t}")
    for a in ids["apts"]:
        s.delete(f"{B}/api/apartments/{a}")
    print("cleaned")
    sys.exit(0)
now = datetime.now(timezone.utc)
m, y = (now.month - 1, now.year) if now.month > 1 else (12, now.year - 1)
a = s.post(f"{B}/api/apartments", json={"number": "TEST-UI-MO", "rent_amount": 2500, "currency": "SRD"}).json()["id"]
a2 = s.post(f"{B}/api/apartments", json={"number": "TEST-UI-MO2", "rent_amount": 800, "currency": "SRD"}).json()["id"]
t = s.post(f"{B}/api/tenants", json={"name": "TEST UI Uitgang", "phone": "5970009", "apartment_id": a}).json()["id"]
t2 = s.post(f"{B}/api/tenants", json={"name": "TEST UI Terug", "phone": "5970010", "apartment_id": a2}).json()["id"]
s.post(f"{B}/api/deposits", json={"tenant_id": t, "amount": 2000, "currency": "SRD"})
s.post(f"{B}/api/deposits", json={"tenant_id": t2, "amount": 9000, "currency": "SRD"})
s.post(f"{B}/api/invoices", json={"tenant_id": t, "period_month": m, "period_year": y})
json.dump({"tenants": [t, t2], "apts": [a, a2]}, open("/tmp/iter131_ui.json", "w"))
print(json.dumps({"t": t, "t2": t2, "a": a, "a2": a2}))
