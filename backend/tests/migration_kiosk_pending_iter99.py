# Iter99: startup-migratie _auto_approve_pending_kiosk_payments (run: python ... insert | check)
import sys, uuid, json
from datetime import datetime, timezone
from pymongo import MongoClient

db = MongoClient("mongodb://localhost:27017")["vastgoed_kiosk"]
CID = "demo-company-fixed-uuid-00000000000"

if sys.argv[1] == "insert":
    inv = db.invoices.find_one({"company_id": CID, "status": {"$nin": ["paid", "cancelled"]}, "currency": "SRD"},
                               {"_id": 0}, sort=[("period_year", 1), ("period_month", 1)])
    anita = db.employees.find_one({"company_id": CID, "name": {"$regex": "Anita"}}, {"_id": 0})
    now = datetime.now(timezone.utc).isoformat()
    k = "TEST_MIG_K_" + uuid.uuid4().hex[:8]
    t = "TEST_MIG_T_" + uuid.uuid4().hex[:8]
    base = {"company_id": CID, "tenant_id": inv["tenant_id"], "currency": "SRD", "category": "huur",
            "status": "pending_approval", "paid_at": now, "note": "TEST_iter99 migration"}
    db.payments.insert_one({**base, "id": k, "amount": 11, "method": "contant", "receipt_number": "TEST-" + k[-8:],
                            "kiosk_employee_id": anita["id"], "kiosk_employee_name": anita["name"],
                            "received_by": anita["name"], "period_month": inv["period_month"], "period_year": inv["period_year"]})
    db.payments.insert_one({**base, "id": t, "amount": 13, "method": "bank", "receipt_number": "TEST-" + t[-8:],
                            "received_by": "Huurder"})
    json.dump({"k": k, "t": t, "inv": inv["id"], "paid_before": float(inv.get("paid_amount") or 0)},
              open("/tmp/mig99.json", "w"))
    print("inserted", k, t, "inv", inv["id"], inv.get("paid_amount"))
else:
    c = json.load(open("/tmp/mig99.json"))
    k = db.payments.find_one({"id": c["k"]}, {"_id": 0})
    t = db.payments.find_one({"id": c["t"]}, {"_id": 0})
    inv = db.invoices.find_one({"id": c["inv"]}, {"_id": 0})
    print("kiosk:", k["status"], k.get("approved_by"), k.get("invoice_id"), k.get("approved_by_user_id"))
    print("tenant:", t["status"])
    print("invoice paid delta:", float(inv.get("paid_amount") or 0) - c["paid_before"])
    ok = k["status"] == "approved" and k.get("approved_by") == k.get("kiosk_employee_name") \
        and t["status"] == "pending_approval" and round(float(inv.get("paid_amount") or 0) - c["paid_before"], 2) == 11
    print("RESULT", "PASS" if ok else "FAIL")
    db.payments.delete_one({"id": c["t"]})
