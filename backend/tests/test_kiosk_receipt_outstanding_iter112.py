# Iter112: kiosk print-data outstanding_after (numeric) == receipt "Nog openstaand"
import json, re, os, requests, pytest

BASE = open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split()[0].rstrip("/")
API = f"{BASE}/api"


def nl_money(cur, v):
    return f"{cur} " + f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


@pytest.fixture(scope="module")
def kh():
    r = requests.post(f"{API}/auth/kiosk-pin", json={"pin": "4321", "company_slug": "my-awesome-rentals-bv"})
    if r.status_code != 200:
        pytest.skip("kiosk pin login failed")
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(scope="module")
def payments(kh):
    apts = requests.get(f"{API}/kiosk/apartments", headers=kh).json()
    out = []
    for a in apts:
        tid = a.get("tenant_id")
        if not tid:
            continue
        r = requests.get(f"{API}/kiosk/tenants/{tid}/payments", headers=kh)
        if r.status_code == 200:
            d = r.json()
            lst = d if isinstance(d, list) else (d.get("payments") or d.get("items") or [])
            out += lst[:3]
    if not out:
        pytest.skip("no payments")
    return out


def test_print_data_has_numeric_outstanding_after(kh, payments):
    for p in payments[:8]:
        r = requests.get(f"{API}/kiosk/payments/{p['id']}/print-data", headers=kh)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "outstanding_after" in d
        assert isinstance(d["outstanding_after"], (int, float))
        cur = (p.get("currency") or "SRD")
        assert d["openstaand"] == nl_money(cur, d["outstanding_after"])


def test_print_data_matches_receipt_html(kh, payments):
    for p in payments[:5]:
        d = requests.get(f"{API}/kiosk/payments/{p['id']}/print-data", headers=kh).json()
        h = requests.get(f"{API}/payments/{p['id']}/print.html", params={"preview": 1, "format": "thermal"}, headers=kh)
        assert h.status_code == 200
        txt = re.sub(r"<[^>]+>", " ", h.text)
        txt = re.sub(r"\s+", " ", txt)
        if d["outstanding_after"] > 0.001:
            assert d["openstaand"] in txt, f"{d['openstaand']} not in receipt"
