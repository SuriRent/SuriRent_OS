import os, sys, json, requests
from datetime import datetime, timezone
B = "https://vastgoed-app.preview.emergentagent.com/api"
s = requests.Session()
r = s.post(f"{B}/auth/login", json={"email": "demo@surirent.sr", "password": "demo1234"})
tok = r.json().get("token") or r.json().get("access_token")
s.headers["Authorization"] = f"Bearer {tok}"
if sys.argv[1:] == ["cleanup"]:
    st = json.load(open("/tmp/iter130.json"))
    for d in s.get(f"{B}/deposits").json():
        if d["tenant_id"] == st["tid"]:
            print("del dep", s.delete(f"{B}/deposits/{d['id']}").status_code)
    invs = s.get(f"{B}/invoices").json()
    for inv in invs if isinstance(invs, list) else invs.get("items", []):
        if inv.get("tenant_id") == st["tid"]:
            s.delete(f"{B}/invoices/{inv['id']}")
    for c in s.get(f"{B}/contracts").json() or []:
        if isinstance(c, dict) and c.get("tenant_id") == st["tid"]:
            s.delete(f"{B}/contracts/{c['id']}")
    print(s.delete(f"{B}/tenants/{st['tid']}").status_code, s.delete(f"{B}/apartments/{st['aid']}").status_code)
    sys.exit()
a = s.post(f"{B}/apartments", json={"number": "TEST-REF-UI", "rent_amount": 2500, "currency": "SRD"}).json()
t = s.post(f"{B}/tenants", json={"name": "TEST Jan Pieterse", "phone": "5970002", "apartment_id": a["id"]}).json()
now = datetime.now(timezone.utc)
m, y = (now.month - 1, now.year) if now.month > 1 else (12, now.year - 1)
print(s.post(f"{B}/invoices", json={"tenant_id": t["id"], "period_month": m, "period_year": y}).status_code)
json.dump({"aid": a["id"], "tid": t["id"]}, open("/tmp/iter130.json", "w"))
print(a["id"], t["id"])
