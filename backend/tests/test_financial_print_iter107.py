# Iter107: tenant-portal total_due parity + kiosk financial print-data / remote-print / png
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for ln in f:
            if ln.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = ln.split("=", 1)[1].strip().rstrip("/")
SLUG = "my-awesome-rentals-bv"
JAN_ID = "1c9d8b79-d100-4467-a315-ee060cc02569"


@pytest.fixture(scope="module")
def H():
    r = requests.post(f"{BASE_URL}/api/auth/kiosk-pin", json={"pin": "4321", "company_slug": SLUG})
    if r.status_code != 200:
        pytest.skip(f"kiosk login failed {r.status_code} {r.text}")
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(scope="module")
def TH():
    r = requests.post(f"{BASE_URL}/api/tenant-portal/login", json={"identifier": "jan@demo.sr", "pin": "7391"})
    if r.status_code != 200:
        pytest.skip(f"tenant login failed {r.status_code} {r.text}")
    return {"Authorization": f"Bearer {r.json()['token']}"}


# Tenant portal total_due == kiosk achterstand + huidige maand
def test_tenant_total_due_matches_kiosk(H, TH):
    k = requests.get(f"{BASE_URL}/api/kiosk/tenants/{JAN_ID}/overview", headers=H)
    assert k.status_code == 200, k.text
    ko = k.json()
    expected = round(float(ko.get("open_invoices_total") or 0) + float(ko.get("current_invoices_total") or 0), 2)
    t = requests.get(f"{BASE_URL}/api/tenant-portal/overview", headers=TH)
    assert t.status_code == 200, t.text
    to = t.json()
    print("kiosk expected", expected, "tenant total_due", to.get("total_due"), "keys", list(to.keys()))
    assert round(float(to["total_due"]), 2) == expected
    assert expected > 0


def test_print_data_requires_session():
    r = requests.get(f"{BASE_URL}/api/kiosk/tenants/{JAN_ID}/financial-print-data")
    assert r.status_code == 401
    r = requests.post(f"{BASE_URL}/api/kiosk/tenants/{JAN_ID}/financial-remote-print", json={"printer_id": "x"})
    assert r.status_code == 401


# Print-data structure and totals
def test_print_data_structure(H):
    r = requests.get(f"{BASE_URL}/api/kiosk/tenants/{JAN_ID}/financial-print-data", headers=H)
    assert r.status_code == 200, r.text
    d = r.json()
    for k in ("lines", "printer", "paper_width", "cols", "lettergrootte", "textZoom", "fontSizes"):
        assert k in d, k
    assert isinstance(d["lines"], list) and d["lines"]
    for ln in d["lines"]:
        assert set(("text", "align", "bold", "size")) <= set(ln.keys())
    texts = [ln["text"] for ln in d["lines"]]
    assert "FINANCIEEL OVERZICHT" in texts
    assert any(t.startswith("TOTAAL:") for t in texts)
    ov = requests.get(f"{BASE_URL}/api/kiosk/tenants/{JAN_ID}/overview", headers=H).json()
    tot = float(ov["open_invoices_total"]) + float(ov["current_invoices_total"])
    tot_line = next(t for t in texts if t.startswith("TOTAAL:"))
    expected_str = f"{tot:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    print("\n".join(texts))
    assert expected_str in tot_line
    assert all(len(t) <= d["cols"] for t in texts), "line exceeds cols"


def test_print_data_unknown_tenant(H):
    r = requests.get(f"{BASE_URL}/api/kiosk/tenants/does-not-exist/financial-print-data", headers=H)
    assert r.status_code == 404


def test_remote_print_offline_409(H):
    r = requests.post(f"{BASE_URL}/api/kiosk/tenants/{JAN_ID}/financial-remote-print", headers=H,
                      json={"printer_id": "TEST_offline_printer"})
    assert r.status_code == 409
    assert "online" in r.json().get("detail", "")


def test_remote_print_missing_body(H):
    r = requests.post(f"{BASE_URL}/api/kiosk/tenants/{JAN_ID}/financial-remote-print", headers=H, json={})
    assert r.status_code == 422


def test_online_printers_endpoint(H):
    r = requests.get(f"{BASE_URL}/api/kiosk/printers/online", headers=H)
    assert r.status_code == 200
    print("online printers", r.json())


def test_png_still_works(H):
    r = requests.get(f"{BASE_URL}/api/kiosk/tenants/{JAN_ID}/financial-receipt.png", headers=H)
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("image/png")
    assert r.content[:8] == b"\x89PNG\r\n\x1a\n"
    assert requests.get(f"{BASE_URL}/api/kiosk/tenants/{JAN_ID}/financial-receipt.png").status_code == 401
