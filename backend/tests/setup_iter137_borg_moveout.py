# UI setup for iteration 137: borg refund via Borg page -> move-out (archive + vacant + settle). `cleanup` arg removes data.
import os, sys, json
from datetime import datetime, timezone
import requests

B = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
s = requests.Session()
tok = s.post(f"{B}/api/auth/login", json={"email": "demo@surirent.sr", "password": "demo1234"}).json()["token"]
s.headers["Authorization"] = f"Bearer {tok}"
F = "/tmp/iter137.json"
if len(sys.argv) > 1 and sys.argv[1] == "cleanup":
    ids = json.load(open(F))
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
        print("del tenant", s.delete(f"{B}/api/tenants/{t}").status_code)
    for a in ids["apts"]:
        print("del apt", s.delete(f"{B}/api/apartments/{a}").status_code)
    print("cleaned")
    sys.exit(0)
now = datetime.now(timezone.utc)
def prev(n):
    m, y = now.month - n, now.year
    while m < 1:
        m += 12; y -= 1
    return m, y
out = {"tenants": [], "apts": []}
for key, num, borg, ninv in [("full", "TEST-BORG-A", 3000, 1), ("short", "TEST-BORG-B", 1000, 2), ("reg", "TEST-BORG-C", 3000, 1)]:
    a = s.post(f"{B}/api/apartments", json={"number": num, "rent_amount": 3000, "currency": "SRD"}).json()["id"]
    t = s.post(f"{B}/api/tenants", json={"name": f"TEST Borg {key}", "phone": "59700" + str(len(out['tenants'])), "apartment_id": a}).json()["id"]
    d = s.post(f"{B}/api/deposits", json={"tenant_id": t, "amount": borg, "currency": "SRD"}).json()
    invs = []
    for n in range(1, ninv + 1):
        m, y = prev(n)
        r = s.post(f"{B}/api/invoices", json={"tenant_id": t, "period_month": m, "period_year": y})
        invs.append(r.json().get("id"))
    out["tenants"].append(t); out["apts"].append(a)
    out[key] = {"t": t, "a": a, "dep": d.get("id"), "invs": invs}
json.dump(out, open(F, "w"))
print(json.dumps(out))
