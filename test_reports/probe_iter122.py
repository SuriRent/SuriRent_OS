# Probe: partial payment on fresh invoice (paid_amount unset) -> double counting via overflow
import os, uuid, json, sys
os.environ.setdefault("REACT_APP_BACKEND_URL", "https://vastgoed-app.preview.emergentagent.com")
sys.path.insert(0, "/app/backend/tests")
import requests
import test_paid_threshold_nocache_iter122 as T

ah = T._admin()
cid = T.mdb.companies.find_one({"slug": T.SLUG})["id"]
tag = "TEST_iter122_probe"
apt, ten = str(uuid.uuid4()), str(uuid.uuid4())
T.mdb.apartments.insert_one({"id": apt, "company_id": cid, "number": tag, "rent_amount": 1000.0, "currency": "SRD",
                             "status": "occupied", "tenant_id": ten})
T.mdb.tenants.insert_one({"id": ten, "company_id": cid, "name": tag, "apartment_id": apt})
c = {"ah": ah, "ten": ten, "invs": [], "pays": []}
try:
    a = T._mk_invoice(c, 7)
    b = T._mk_invoice(c, 8)
    # FIFO (no invoice_ids, no period): 960 should only go to oldest invoice
    r = requests.post(f"{T.API}/payments", json={"tenant_id": ten, "amount": 960, "currency": "SRD", "method": "contant",
                                                 "category": "huur", "note": "TEST_iter122"}, headers=ah)
    print(r.status_code)
    pid = r.json()["id"]
    p = T.mdb.payments.find_one({"id": pid}, {"_id": 0, "allocations": 1, "credit_remaining": 1})
    print("PAY", json.dumps(p))
    for iid in (a, b):
        i = T._inv(iid); print(i["period_month"], i["status"], i.get("paid_amount"))
    # explicit invoice_ids path
    cc = T._mk_invoice(c, 9)
    pid2 = T._pay(c, 500, cc)
    p = T.mdb.payments.find_one({"id": pid2}, {"_id": 0, "allocations": 1, "credit_remaining": 1})
    print("PAY2", json.dumps(p), T._inv(cc)["status"], T._inv(cc).get("paid_amount"))
finally:
    T.mdb.payments.delete_many({"tenant_id": ten}); T.mdb.invoices.delete_many({"tenant_id": ten})
    T.mdb.tenants.delete_one({"id": ten}); T.mdb.apartments.delete_one({"id": apt})
