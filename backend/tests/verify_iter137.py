# Verifies DB state after borg-refund move-out (iteration 137): usage `python verify_iter137.py full|short|reg`
import os, sys, json, requests
B = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
s = requests.Session()
s.headers["Authorization"] = "Bearer " + s.post(f"{B}/api/auth/login", json={"email": "demo@surirent.sr", "password": "demo1234"}).json()["token"]
ids = json.load(open("/tmp/iter137.json"))
k = sys.argv[1]
t, a = ids[k]["t"], ids[k]["a"]
active = [x["id"] for x in s.get(f"{B}/api/tenants").json()]
arch = {x["id"]: x for x in s.get(f"{B}/api/tenants/archived").json()}
print("in active list:", t in active)
at = arch.get(t)
print("archived:", bool(at), at and {kk: at.get(kk) for kk in ["status", "move_out_date", "archived_apartment_number", "outstanding_after_move_out", "apartment_id"]})
apt = next((x for x in s.get(f"{B}/api/apartments").json() if x["id"] == a), None)
print("apartment:", apt and {kk: apt.get(kk) for kk in ["number", "status", "tenant_id"]})
for i in s.get(f"{B}/api/invoices").json():
    if i.get("tenant_id") == t:
        print("invoice", i.get("period_month"), i.get("period_year"), i.get("amount"), i.get("status"), "paid", i.get("paid_amount"))
for p in s.get(f"{B}/api/payments").json():
    if p.get("tenant_id") == t:
        print("payment", p.get("amount"), p.get("method"), p.get("status"))
for d in s.get(f"{B}/api/deposits").json():
    if d.get("tenant_id") == t:
        print("deposit", {kk: d.get(kk) for kk in ["status", "amount", "refund_amount", "amount_due", "deduction_arrears", "deduction_damage", "apartment_number"]})
