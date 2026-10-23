# Deposit refund settlement (borg afrekening: damage items + arrears -> amount_due / refund) - iteration 130
import os
from datetime import datetime, timezone
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
NOW = datetime.now(timezone.utc)
S = {}


@pytest.fixture(scope="module")
def admin():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": "demo@surirent.sr", "password": "demo1234"})
    if r.status_code != 200:
        pytest.skip(f"login failed {r.status_code}")
    tok = r.json().get("token") or r.json().get("access_token")
    if tok:
        s.headers["Authorization"] = f"Bearer {tok}"
    return s


@pytest.fixture(scope="module")
def kiosk(admin):
    r = admin.post(f"{BASE_URL}/api/auth/admin-to-kiosk", json={})
    assert r.status_code == 200, r.text
    tok = r.json().get("token") or r.json().get("kiosk_token")
    k = requests.Session()
    if tok:
        k.headers["Authorization"] = f"Bearer {tok}"
    else:
        k.cookies.update(admin.cookies)
    return k


@pytest.fixture(scope="module", autouse=True)
def cleanup(admin):
    yield
    for did in S.get("deps", []):
        admin.delete(f"{BASE_URL}/api/deposits/{did}")
    for tid in S.get("tenants", []):
        invs = admin.get(f"{BASE_URL}/api/invoices").json()
        for inv in invs if isinstance(invs, list) else invs.get("items", []):
            if inv.get("tenant_id") == tid:
                admin.delete(f"{BASE_URL}/api/invoices/{inv['id']}")
        for c in admin.get(f"{BASE_URL}/api/contracts").json() or []:
            if isinstance(c, dict) and c.get("tenant_id") == tid:
                admin.delete(f"{BASE_URL}/api/contracts/{c['id']}")
        admin.delete(f"{BASE_URL}/api/tenants/{tid}")
    for aid in S.get("apts", []):
        admin.delete(f"{BASE_URL}/api/apartments/{aid}")


def _mk(admin, num, rent):
    r = admin.post(f"{BASE_URL}/api/apartments", json={"number": num, "rent_amount": rent, "currency": "SRD"})
    assert r.status_code == 200, r.text
    aid = r.json()["id"]
    S.setdefault("apts", []).append(aid)
    r = admin.post(f"{BASE_URL}/api/tenants", json={"name": f"TEST Refund {num}", "phone": "5970001", "apartment_id": aid})
    assert r.status_code == 200, r.text
    tid = r.json()["id"]
    S.setdefault("tenants", []).append(tid)
    return aid, tid


def _past_period(back):
    m, y = NOW.month - back, NOW.year
    while m <= 0:
        m += 12
        y -= 1
    return m, y


class TestRefundSettlement:
    def test_setup_deposit_with_arrears(self, admin):
        aid, tid = _mk(admin, "TEST-REF-1", 2500)
        S["tid"] = tid
        r = admin.post(f"{BASE_URL}/api/deposits", json={"tenant_id": tid, "amount": 6000, "currency": "SRD"})
        assert r.status_code == 200, r.text
        S["did"] = r.json()["id"]
        S.setdefault("deps", []).append(S["did"])
        for back in (1, 2):
            m, y = _past_period(back)
            admin.post(f"{BASE_URL}/api/invoices", json={"tenant_id": tid, "period_month": m, "period_year": y})

    def test_refund_preview_lists_arrears(self, admin):
        r = admin.get(f"{BASE_URL}/api/deposits/{S['did']}/refund-preview")
        assert r.status_code == 200, r.text
        d = r.json()
        assert len(d["arrears_items"]) >= 2
        for i in d["arrears_items"]:
            assert i["label"].startswith("Huur ") and i["amount"] == 2500
        S["arrears"] = d["arrears_total"]
        assert d["arrears_total"] == round(2500 * len(d["arrears_items"]), 2)

    def test_preview_404(self, admin):
        assert admin.get(f"{BASE_URL}/api/deposits/nonexistent/refund-preview").status_code == 404

    def test_refund_amount_due(self, admin):
        body = {"damage_items": [{"description": "Kapotte deur", "amount": 4000},
                                 {"description": "Muur schilderen", "amount": 3000},
                                 {"description": "leeg", "amount": 0}], "refund_note": "TEST note"}
        r = admin.post(f"{BASE_URL}/api/deposits/{S['did']}/refund", json=body)
        assert r.status_code == 200, r.text
        d = r.json()
        expected_due = round(7000 + S["arrears"] - 6000, 2)
        assert d["status"] == "partial"
        assert d["amount_due"] == expected_due
        assert d["refund_amount"] == 0
        assert d["deduction"] == 7000 + S["arrears"]
        assert len(d["damage_items"]) == 2  # zero amount filtered
        assert len(d["arrears_items"]) >= 2

    def test_persisted_in_list(self, admin):
        lst = admin.get(f"{BASE_URL}/api/deposits").json()
        d = next(x for x in lst if x["id"] == S["did"])
        assert d["status"] == "partial" and d["amount_due"] > 0

    def test_second_refund_400(self, admin):
        r = admin.post(f"{BASE_URL}/api/deposits/{S['did']}/refund", json={"damage_items": []})
        assert r.status_code == 400

    def test_print_data_refund(self, kiosk):
        r = kiosk.get(f"{BASE_URL}/api/kiosk/deposits/{S['did']}/print-data")
        assert r.status_code == 200, r.text
        d = r.json()
        texts = [l["text"] for l in d["lines"]]
        joined = "\n".join(texts)
        assert d["receipt_type"] == "deposit_refund"
        assert "BORGAFREKENING" in texts
        assert "SCHADE" in texts and "HUURACHTERSTAND" in texts
        assert "TE BETALEN:" in joined
        assert "Kapotte deur" in joined
        print(joined)

    def test_receipt_png(self, kiosk):
        r = kiosk.get(f"{BASE_URL}/api/kiosk/deposits/{S['did']}/receipt.png")
        assert r.status_code == 200 and r.headers["content-type"] == "image/png"
        assert r.content[:4] == b"\x89PNG"

    def test_refund_back_to_tenant(self, admin, kiosk):
        aid, tid = _mk(admin, "TEST-REF-2", 1000)
        r = admin.post(f"{BASE_URL}/api/deposits", json={"tenant_id": tid, "amount": 5000, "currency": "SRD"})
        did = r.json()["id"]
        S["deps"].append(did)
        arrears = admin.get(f"{BASE_URL}/api/deposits/{did}/refund-preview").json()["arrears_total"]
        r = admin.post(f"{BASE_URL}/api/deposits/{did}/refund",
                       json={"damage_items": [{"description": "Raam", "amount": 500}]})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["amount_due"] == 0
        assert d["refund_amount"] == round(5000 - 500 - arrears, 2)
        texts = "\n".join(l["text"] for l in kiosk.get(f"{BASE_URL}/api/kiosk/deposits/{did}/print-data").json()["lines"])
        assert "TERUG AAN HUURDER:" in texts and "TE BETALEN" not in texts

    def test_negative_damage_ignored(self, admin):
        aid, tid = _mk(admin, "TEST-REF-3", 1000)
        did = admin.post(f"{BASE_URL}/api/deposits", json={"tenant_id": tid, "amount": 1000, "currency": "SRD"}).json()["id"]
        S["deps"].append(did)
        r = admin.post(f"{BASE_URL}/api/deposits/{did}/refund",
                       json={"damage_items": [{"description": "x", "amount": -500}]})
        assert r.status_code == 200
        assert r.json()["damage_items"] == []  # negative amounts filtered out
        assert r.json()["refund_amount"] <= 1000
