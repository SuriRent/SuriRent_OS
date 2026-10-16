# Iter99: Kiosk-medewerker betalingen worden direct verwerkt (geen goedkeuringsstap).
import os, json, time, uuid, subprocess
from datetime import datetime, timezone
import pytest, requests
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/") or open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split()[0].rstrip("/")
SLUG = "my-awesome-rentals-bv"
CID = "demo-company-fixed-uuid-00000000000"
mdb = MongoClient("mongodb://localhost:27017")["vastgoed_kiosk"]
SIG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="


@pytest.fixture(scope="module")
def ctx():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": "demo@surirent.sr", "password": "demo1234"})
    assert r.status_code == 200
    tok = r.json()["token"]
    ah = {"Authorization": f"Bearer {tok}"}
    emps = requests.get(f"{BASE_URL}/api/employees", headers=ah).json()
    anita = next(e for e in emps if "Anita" in e.get("name", ""))
    requests.put(f"{BASE_URL}/api/employees/{anita['id']}", headers=ah,
                 json={"name": "Anita Sewdas", "app_role": "kiosk", "email": "", "monthly_salary": 0,
                       "currency": "SRD", "active": True, "pin": "4321"}).raise_for_status()
    kr = requests.post(f"{BASE_URL}/api/auth/kiosk-pin", json={"pin": "4321", "company_slug": SLUG})
    assert kr.status_code == 200, kr.text
    kt = kr.json()["token"]
    return {"ah": ah, "kh": {"Authorization": f"Bearer {kt}"}, "kc": {"kiosk_token": kt}, "anita": anita}


def _open_invoice():
    inv = mdb.invoices.find_one({"company_id": CID, "status": {"$nin": ["paid", "cancelled"]}, "currency": "SRD"},
                                {"_id": 0}, sort=[("period_year", 1), ("period_month", 1)])
    if not inv:
        pytest.skip("geen open factuur")
    return inv


class TestKioskEmployeePayment:
    def test_employee_payment_direct_approved(self, ctx):
        inv = _open_invoice()
        before = float(inv.get("paid_amount") or 0)
        sse_before = time.time()
        r = requests.post(f"{BASE_URL}/api/kiosk/payments",
                          params={"employee_id": ctx["anita"]["id"], "employee_pin": "4321"},
                          headers=ctx["kh"], cookies=ctx["kc"],
                          json={"tenant_id": inv["tenant_id"], "amount": 7, "currency": "SRD", "method": "contant",
                                "category": "huur", "invoice_ids": [inv["id"]], "note": "TEST_iter99"})
        assert r.status_code == 200, r.text
        p = r.json()
        print(json.dumps({k: p.get(k) for k in ("status", "kiosk_employee_name", "received_by", "approved_by", "invoice_id")}))
        assert p["status"] == "approved"
        assert p.get("kiosk_employee_name") == "Anita Sewdas"
        assert p.get("received_by") == "Anita Sewdas"
        assert p.get("approved_by") == "Anita Sewdas"
        time.sleep(1)
        after = float(mdb.invoices.find_one({"id": inv["id"]})["paid_amount"] or 0)
        assert round(after - before, 2) == 7.0
        # in normale lijst
        lst = requests.get(f"{BASE_URL}/api/payments", headers=ctx["ah"], params={"limit": 500}).json()
        assert any(x["id"] == p["id"] for x in lst)
        pend = requests.get(f"{BASE_URL}/api/payments", headers=ctx["ah"], params={"status": "pending_approval"}).json()
        assert not any(x["id"] == p["id"] for x in pend)
        # SSE notification kind
        evs = list(mdb.sse_events.find({"channel": f"admin:{CID}", "payload.data.payment_id": p["id"]}, {"_id": 0}))
        print("SSE events:", evs)
        assert evs, "geen SSE-notificatie gevonden"
        assert all(e["payload"]["data"]["kind"] == "payment" for e in evs)
        assert not any(e["payload"]["data"].get("action_token") for e in evs)
        assert not any(e["payload"]["data"].get("require_approval") for e in evs)
        ctx["pid"] = p["id"]

    def test_wrong_pin_401(self, ctx):
        inv = _open_invoice()
        r = requests.post(f"{BASE_URL}/api/kiosk/payments",
                          params={"employee_id": ctx["anita"]["id"], "employee_pin": "0000"},
                          headers=ctx["kh"], cookies=ctx["kc"],
                          json={"tenant_id": inv["tenant_id"], "amount": 1, "method": "contant"})
        assert r.status_code == 401

    def test_installment_pay_direct(self, ctx):
        plan = mdb.payment_plans.find_one({"company_id": CID, "status": "active"}, {"_id": 0})
        if not plan:
            pytest.skip("geen actief plan")
        inst = mdb.payment_plan_installments.find_one({"plan_id": plan["id"], "status": "pending"}, {"_id": 0},
                                                       sort=[("sequence", 1)])
        if not inst:
            pytest.skip("geen open termijn")
        r = requests.post(f"{BASE_URL}/api/kiosk/payment-plans/{plan['id']}/installments/{inst['sequence']}/pay",
                          headers=ctx["kh"], cookies=ctx["kc"],
                          json={"method": "contant", "amount": 5, "employee_id": ctx["anita"]["id"], "employee_pin": "4321"})
        assert r.status_code == 200, r.text
        out = r.json()
        pay = out.get("payment") or {}
        print("installment payment:", {k: pay.get(k) for k in ("status", "approved_by", "received_by", "kiosk_employee_name")})
        assert pay.get("status") == "approved"
        assert pay.get("approved_by") == "Anita Sewdas"
        i2 = mdb.payment_plan_installments.find_one({"plan_id": plan["id"], "sequence": inst["sequence"]})
        assert i2["status"] == "paid"
        evs = list(mdb.sse_events.find({"channel": f"admin:{CID}", "payload.data.payment_id": pay.get("id")}, {"_id": 0}))
        print("SSE inst:", [e["payload"]["data"].get("kind") for e in evs])
        assert evs and all(e["payload"]["data"]["kind"] == "payment" for e in evs)


class TestAdminApproveRejectRegression:
    def _insert_pending(self, inv, amount):
        pid = "TEST_" + str(uuid.uuid4())
        mdb.payments.insert_one({
            "id": pid, "company_id": CID, "tenant_id": inv["tenant_id"], "amount": amount, "currency": "SRD",
            "method": "bank", "category": "huur", "status": "pending_approval",
            "paid_at": datetime.now(timezone.utc).isoformat(), "receipt_number": "TEST-" + uuid.uuid4().hex[:8],
            "note": "TEST_iter99 tenant proof", "received_by": "Huurder",
        })
        return pid

    def test_approve(self, ctx):
        inv = _open_invoice()
        pid = self._insert_pending(inv, 3)
        r = requests.post(f"{BASE_URL}/api/payments/{pid}/approve", headers=ctx["ah"], json={"signature_data_url": SIG})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "approved"

    def test_reject(self, ctx):
        inv = _open_invoice()
        pid = self._insert_pending(inv, 2)
        r = requests.post(f"{BASE_URL}/api/payments/{pid}/reject", headers=ctx["ah"], json={"reason": "TEST"})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "rejected"
