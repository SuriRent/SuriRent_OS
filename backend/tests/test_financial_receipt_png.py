# Iter106: kiosk financial receipt PNG (58mm bon) attached to Spraak share
import os
import io
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for ln in f:
            if ln.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = ln.split("=", 1)[1].strip().rstrip("/")
SLUG = "my-awesome-rentals-bv"


def _reseed_anita():
    s = requests.Session()
    tok = s.post(f"{BASE_URL}/api/auth/login", json={"email": "demo@surirent.sr", "password": "demo1234"}).json()["token"]
    h = {"Authorization": f"Bearer {tok}"}
    emps = s.get(f"{BASE_URL}/api/employees", headers=h).json()
    anita = next((e for e in emps if "Anita" in e.get("name", "")), None)
    if not anita:
        pytest.skip("Anita not found")
    s.put(f"{BASE_URL}/api/employees/{anita['id']}", headers=h,
          json={"name": "Anita Sewdas", "app_role": "kiosk", "role": "Receptie", "email": "",
                "monthly_salary": 0, "currency": "SRD", "active": True, "pin": "4321"})


@pytest.fixture(scope="module")
def kiosk_token():
    r = requests.post(f"{BASE_URL}/api/auth/kiosk-pin", json={"pin": "4321", "company_slug": SLUG})
    if r.status_code != 200:
        _reseed_anita()
        r = requests.post(f"{BASE_URL}/api/auth/kiosk-pin", json={"pin": "4321", "company_slug": SLUG})
    if r.status_code != 200:
        pytest.skip(f"kiosk login failed {r.status_code} {r.text}")
    return r.json()["token"]


@pytest.fixture(scope="module")
def H(kiosk_token):
    return {"Authorization": f"Bearer {kiosk_token}"}


@pytest.fixture(scope="module")
def tenant_with_balance(H):
    r = requests.get(f"{BASE_URL}/api/kiosk/apartments", headers=H)
    assert r.status_code == 200, r.text
    data = r.json()
    apts = data if isinstance(data, list) else data.get("apartments", [])
    tids = [a["tenant_id"] for a in apts if a.get("tenant_id") and a.get("pay_status") != "paid"]
    best = None
    for tid in tids[:40]:
        t = {"id": tid}
        ov = requests.get(f"{BASE_URL}/api/kiosk/tenants/{tid}/overview", headers=H)
        if ov.status_code != 200:
            continue
        o = ov.json()
        if (o.get("open_invoices") and o.get("current_invoices")):
            return t["id"], o
        if best is None and (o.get("open_invoices") or o.get("current_invoices")):
            best = (t["id"], o)
    if best:
        return best
    pytest.skip("No tenant with open balance")


class TestFinancialReceiptPng:
    def test_requires_kiosk_session(self, tenant_with_balance):
        tid, _ = tenant_with_balance
        r = requests.get(f"{BASE_URL}/api/kiosk/tenants/{tid}/financial-receipt.png")
        assert r.status_code == 401, r.status_code

    def test_invalid_tenant_404(self, H):
        r = requests.get(f"{BASE_URL}/api/kiosk/tenants/nonexistent-xyz/financial-receipt.png", headers=H)
        assert r.status_code == 404, r.status_code

    def test_png_ok(self, H, tenant_with_balance):
        tid, ov = tenant_with_balance
        r = requests.get(f"{BASE_URL}/api/kiosk/tenants/{tid}/financial-receipt.png", headers=H)
        assert r.status_code == 200, r.text[:200]
        assert r.headers["content-type"].startswith("image/png")
        assert r.content[:8] == b"\x89PNG\r\n\x1a\n"
        from PIL import Image
        img = Image.open(io.BytesIO(r.content))
        w, h = img.size
        print("size", w, h, "open", len(ov.get("open_invoices") or []), "cur", len(ov.get("current_invoices") or []))
        assert 300 < w < 700
        # header ~19 lines min + one per invoice
        n = len(ov.get("open_invoices") or []) + len(ov.get("current_invoices") or [])
        assert h >= 35 * (14 + n)
        with open("/app/test_reports/iter106_receipt.png", "wb") as f:
            f.write(r.content)
        with open("/app/test_reports/iter106_overview.json", "w") as f:
            import json
            json.dump({k: ov.get(k) for k in ("open_invoices", "current_invoices", "open_invoices_total",
                                              "current_invoices_total", "credit_balance", "balance")}, f, indent=1, default=str)
