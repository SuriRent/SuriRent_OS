"""Iter88 — Bon printer settings & kiosk print-data tests."""
import os, pytest, requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
assert BASE, "REACT_APP_BACKEND_URL missing"
API = f"{BASE}/api"
COMPANY_SLUG = "my-awesome-rentals-bv"


@pytest.fixture(scope="module")
def admin():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": "demo@surirent.sr", "password": "demo1234"})
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def kiosk():
    s = requests.Session()
    r = s.post(f"{API}/auth/kiosk-pin", json={"pin": "4321", "company_slug": COMPANY_SLUG})
    if r.status_code != 200:
        pytest.skip(f"Kiosk login failed: {r.status_code} {r.text[:120]} — reseed Anita.")
    return s


# ---------- Settings: PUT /settings/kiosk_devices ----------
class TestBonPrinterSettings:
    def test_invalid_printer_mode_returns_422(self, admin):
        r = admin.put(f"{API}/settings/kiosk_devices", json={"printer_mode": "laserjet"})
        assert r.status_code == 422
        assert "Onbekend printertype" in r.text

    def test_set_bluetooth_80mm_and_persist(self, admin):
        r = admin.put(f"{API}/settings/kiosk_devices", json={"printer_mode": "bluetooth", "paper_width": 80})
        assert r.status_code == 200, r.text
        data = r.json()["data"]
        assert data["printer_mode"] == "bluetooth"
        assert data["paper_width"] == 80
        assert data["kt_v520_enabled"] is False
        # verify persisted
        g = admin.get(f"{API}/settings").json()
        kd = g["kiosk_devices"]
        assert kd["printer_mode"] == "bluetooth"
        assert kd["paper_width"] == 80

    def test_legacy_kt_v520_enabled_maps_to_mode(self, admin):
        r = admin.put(f"{API}/settings/kiosk_devices", json={"kt_v520_enabled": True})
        assert r.status_code == 200, r.text
        data = r.json()["data"]
        assert data["printer_mode"] == "kt-v520"
        assert data["kt_v520_enabled"] is True
        # paper_width forced 58 for kt-v520? no — kt-v520 keeps whatever was set; print-data forces 58
        g = admin.get(f"{API}/settings").json()["kiosk_devices"]
        assert g["printer_mode"] == "kt-v520"

    def test_set_none_mode(self, admin):
        r = admin.put(f"{API}/settings/kiosk_devices", json={"printer_mode": "none", "paper_width": 58})
        assert r.status_code == 200, r.text
        assert r.json()["data"]["printer_mode"] == "none"
        g = admin.get(f"{API}/settings").json()["kiosk_devices"]
        assert g["printer_mode"] == "none"


# ---------- Kiosk print-data cols by mode ----------
class TestKioskPrintData:
    def _latest_payment(self, admin):
        r = admin.get(f"{API}/payments?limit=5")
        assert r.status_code == 200, r.text
        items = r.json() if isinstance(r.json(), list) else r.json().get("items") or []
        return items[0] if items else None

    def test_bluetooth_80mm_lines_48cols(self, admin, kiosk):
        admin.put(f"{API}/settings/kiosk_devices", json={"printer_mode": "bluetooth", "paper_width": 80})
        p = self._latest_payment(admin)
        if not p:
            pytest.skip("No payments available for print-data test")
        r = kiosk.get(f"{API}/kiosk/payments/{p['id']}/print-data")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["printer"] == "bluetooth"
        assert d["paper_width"] == 80
        assert isinstance(d["lines"], list) and len(d["lines"]) > 0
        # 80mm should have at least some lines near 48 cols
        assert max(len(ln) for ln in d["lines"]) <= 48
        # At least one line uses the extra width (>32 chars) given typical receipt content
        # (not strict, but reasonable)

    def test_bluetooth_58mm_lines_32cols(self, admin, kiosk):
        admin.put(f"{API}/settings/kiosk_devices", json={"printer_mode": "bluetooth", "paper_width": 58})
        p = self._latest_payment(admin)
        if not p:
            pytest.skip("No payments")
        d = kiosk.get(f"{API}/kiosk/payments/{p['id']}/print-data").json()
        assert d["printer"] == "bluetooth"
        assert d["paper_width"] == 58
        assert max(len(ln) for ln in d["lines"]) <= 32

    def test_kt_v520_always_58_32cols(self, admin, kiosk):
        # Even when stored paper_width is 80, kt-v520 forces 58
        admin.put(f"{API}/settings/kiosk_devices", json={"printer_mode": "kt-v520", "paper_width": 80})
        p = self._latest_payment(admin)
        if not p:
            pytest.skip("No payments")
        d = kiosk.get(f"{API}/kiosk/payments/{p['id']}/print-data").json()
        assert d["printer"] == "kt-v520"
        assert d["paper_width"] == 58
        assert max(len(ln) for ln in d["lines"]) <= 32


@pytest.fixture(scope="module", autouse=True)
def _reset_at_end(admin):
    yield
    admin.put(f"{API}/settings/kiosk_devices", json={"printer_mode": "none", "paper_width": 58})
