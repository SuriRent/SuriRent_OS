# Kiosk: contract direct signing + invoices extras (severity, credits, apply-credit, pdf, mail) — iteration 136
import os
import uuid
import base64
import io
import pytest
import requests
from PIL import Image
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
load_dotenv("/app/backend/.env")
BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
mdb = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
CREATED = {"apartments": [], "tenants": [], "payments": []}
S = {}


def sig_png() -> str:
    img = Image.new("RGBA", (300, 100), (255, 255, 255, 0))
    from PIL import ImageDraw
    ImageDraw.Draw(img).line([(10, 50), (290, 60)], fill=(0, 0, 0, 255), width=4)
    b = io.BytesIO()
    img.save(b, "PNG")
    return "data:image/png;base64," + base64.b64encode(b.getvalue()).decode()


@pytest.fixture(scope="module")
def admin():
    r = requests.post(f"{API}/auth/login", json={"email": "demo@surirent.sr", "password": "demo1234"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(scope="module")
def kiosk(admin):
    r = requests.post(f"{API}/auth/admin-to-kiosk", headers=admin, json={})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(scope="module")
def setup(admin, kiosk):
    locs = requests.get(f"{API}/locations", headers=admin).json()
    num = f"ZC{uuid.uuid4().hex[:4].upper()}"
    r = requests.post(f"{API}/apartments", headers=admin, json={
        "number": num, "rent_amount": 2000.0, "currency": "SRD", "location_id": locs[0]["id"]})
    assert r.status_code == 200, r.text
    apt = r.json()
    CREATED["apartments"].append(apt["id"])
    r = requests.post(f"{API}/kiosk/apartments/{apt['id']}/link-tenant", headers=kiosk, json={
        "new_tenant": {"name": "TEST_Contract Iter136", "email": "test_iter136@example.com"}})
    assert r.status_code == 200, r.text
    tid = r.json()["tenant_id"]
    CREATED["tenants"].append(tid)
    S.update(apt=apt, tid=tid, cid=apt.get("company_id") or mdb.apartments.find_one({"id": apt["id"]})["company_id"])
    return S


@pytest.fixture(scope="module", autouse=True)
def cleanup():
    yield
    tids = CREATED["tenants"]
    mdb.contracts.delete_many({"$or": [{"apartment_id": {"$in": CREATED["apartments"]}}, {"tenant_id": {"$in": tids}}]})
    mdb.invoices.delete_many({"tenant_id": {"$in": tids}})
    mdb.payments.delete_many({"tenant_id": {"$in": tids}})
    mdb.deposits.delete_many({"tenant_id": {"$in": tids}})
    mdb.tenants.delete_many({"id": {"$in": tids}})
    mdb.apartments.delete_many({"id": {"$in": CREATED["apartments"]}})


# --- Contract to sign / signing ---
class TestContractSign:
    def test_contract_to_sign_returns_unsigned(self, kiosk, setup):
        r = requests.get(f"{API}/kiosk/tenants/{setup['tid']}/contract-to-sign", headers=kiosk)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["contract"] and d["contract"]["sign_token"]
        assert d["apartment"]["number"] == setup["apt"]["number"]
        assert d["tenant"]["name"] == "TEST_Contract Iter136"
        assert d["contract"]["deposit_amount"] == 2000.0
        S["token"] = d["contract"]["sign_token"]
        S["contract_id"] = d["contract"]["id"]

    def test_contract_to_sign_auth_and_404(self, kiosk):
        assert requests.get(f"{API}/kiosk/tenants/x/contract-to-sign").status_code == 401
        assert requests.get(f"{API}/kiosk/tenants/nope-{uuid.uuid4()}/contract-to-sign", headers=kiosk).status_code == 404

    def test_public_info(self, setup):
        r = requests.get(f"{API}/contracts/sign/{S['token']}")
        assert r.status_code == 200
        assert r.json()["already_signed"] is False

    def test_invalid_signature_400(self, setup):
        for bad in ["data:image/jpeg;base64,AAAA", "hello", "data:image/png;base64," + "A" * 400_001]:
            r = requests.post(f"{API}/contracts/sign/{S['token']}", json={
                "signed_by": "TEST Name", "accept": True, "signature_png": bad, "signed_via": "kiosk"})
            assert r.status_code == 400, (bad[:30], r.status_code, r.text)
        c = mdb.contracts.find_one({"id": S["contract_id"]})
        assert not c.get("signed_at")

    def test_accept_false_400(self, setup):
        r = requests.post(f"{API}/contracts/sign/{S['token']}", json={"signed_by": "TEST Name", "accept": False, "signature_png": sig_png()})
        assert r.status_code == 400

    def test_sign_kiosk_and_twice_400(self, kiosk, setup):
        r = requests.post(f"{API}/contracts/sign/{S['token']}", json={
            "signed_by": "TEST_Contract Iter136", "accept": True, "signature_png": sig_png(), "signed_via": "kiosk"})
        assert r.status_code == 200, r.text
        c = mdb.contracts.find_one({"id": S["contract_id"]})
        assert c["status"] == "active" and c["signed_via"] == "kiosk"
        assert c["signature_png"].startswith("data:image/png;base64,")
        assert c["signed_at"]
        r2 = requests.post(f"{API}/contracts/sign/{S['token']}", json={
            "signed_by": "TEST_Contract Iter136", "accept": True, "signature_png": sig_png(), "signed_via": "kiosk"})
        assert r2.status_code == 400
        assert requests.get(f"{API}/contracts/sign/{S['token']}").json()["already_signed"] is True
        r3 = requests.get(f"{API}/kiosk/tenants/{setup['tid']}/contract-to-sign", headers=kiosk)
        assert r3.status_code == 200 and r3.json() == {"contract": None}

    def test_contract_pdf_after_sign(self, setup):
        r = requests.get(f"{API}/contracts/{S['contract_id']}/pdf")
        print("contract pdf status", r.status_code, r.headers.get("content-type"))
        assert r.status_code in (200, 401)


# --- Invoices extras ---
class TestInvoiceExtras:
    def test_create_invoice_and_credit(self, admin, setup):
        r = requests.post(f"{API}/invoices", headers=admin, json={"tenant_id": setup["tid"], "period_month": 1, "period_year": 2026})
        assert r.status_code == 200, r.text
        inv = r.json()
        S["inv"] = inv
        assert inv["amount"] == 2000.0
        pid = str(uuid.uuid4())
        mdb.payments.insert_one({"id": pid, "company_id": setup["cid"], "tenant_id": setup["tid"], "amount": 500.0,
                                 "currency": "SRD", "status": "approved", "category": "vooruitbetaling",
                                 "credit_remaining": 500.0, "method": "cash", "paid_at": "2026-01-01T00:00:00Z",
                                 "receipt_number": "TEST-R136"})
        CREATED["payments"].append(pid)

    def test_tenant_credits(self, admin, setup):
        # kiosk UI sends admin_token for non-/kiosk endpoints
        r = requests.get(f"{API}/tenants/credits", headers=admin)
        assert r.status_code == 200, r.text
        assert r.json().get(setup["tid"], {}).get("SRD") == 500.0

    @pytest.mark.parametrize("sev", ["all", "critical", "late", "ok"])
    def test_grouped_severity(self, sev, admin):
        r = requests.get(f"{API}/invoices/grouped", headers=admin, params={"tab": "all", "severity": sev, "limit": 500})
        assert r.status_code == 200, r.text
        d = r.json()
        assert "invoices" in d and "tenant_ids" in d
        S.setdefault("sev", {})[sev] = set(d["tenant_ids"])

    def test_severity_subsets(self):
        allt = S["sev"]["all"]
        for k in ("critical", "late", "ok"):
            assert S["sev"][k] <= allt, k
        print({k: len(v) for k, v in S["sev"].items()})

    def test_apply_credit(self, admin, setup):
        kiosk = admin
        r = requests.post(f"{API}/invoices/{S['inv']['id']}/apply-credit", headers=kiosk)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["applied"] == 500.0
        inv = mdb.invoices.find_one({"id": S["inv"]["id"]})
        assert float(inv["paid_amount"]) == 500.0
        cr = requests.get(f"{API}/tenants/credits", headers=kiosk).json()
        assert setup["tid"] not in cr or cr[setup["tid"]].get("SRD", 0) == 0
        # second apply → 0
        r2 = requests.post(f"{API}/invoices/{S['inv']['id']}/apply-credit", headers=kiosk)
        assert r2.status_code == 200 and r2.json()["applied"] == 0

    def test_invoice_pdf(self):
        r = requests.get(f"{API}/invoices/{S['inv']['id']}/pdf")
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("application/pdf")
        assert r.content[:4] == b"%PDF"

    def test_email_invoice_clear_error(self, admin):
        r = requests.post(f"{API}/email/invoice/{S['inv']['id']}", headers=admin, json={"to": "test_iter136@example.com"})
        print("email", r.status_code, r.text[:300])
        assert r.status_code in (200, 400, 502)
        if r.status_code != 200:
            assert r.json().get("detail")
