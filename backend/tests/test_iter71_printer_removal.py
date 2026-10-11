"""Iteration 71 — regression tests for removal of KTP/Sunmi/Bluetooth printer
integration and the Printers admin section. Verifies:
  • Removed endpoints return 404/405.
  • /api/payments/{id}/print.html?format=thermal&preview=1 still renders and
    contains '@media print' + '@page { size: 58mm' and no 'size: ... auto'.
  • format=a4 still works.
"""
import os
import re
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
SLUG = "my-awesome-rentals-bv"
ADMIN_EMAIL = "demo@surirent.sr"
ADMIN_PASSWORD = "demo1234"


@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def existing_payment_id(admin_session):
    # Find any existing payment id
    r = admin_session.get(f"{BASE_URL}/api/payments?limit=1")
    if r.status_code != 200:
        pytest.skip(f"cannot list payments: {r.status_code}")
    data = r.json()
    items = data if isinstance(data, list) else data.get("items", [])
    if not items:
        pytest.skip("no payments available to render receipt")
    pid = items[0].get("id") or items[0].get("_id")
    assert pid, "payment missing id"
    return pid


class TestRemovedPrinterEndpoints:
    def test_locations_printer_settings_gone(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/locations/printer-settings")
        assert r.status_code in (404, 405), f"expected 404/405, got {r.status_code}"

    def test_kiosk_printer_settings_gone(self):
        r = requests.get(f"{BASE_URL}/api/kiosk/printer-settings")
        assert r.status_code in (404, 405), f"expected 404/405, got {r.status_code}"

    def test_location_put_printer_gone(self, admin_session):
        # Random id is fine — must be 404/405 regardless.
        r = admin_session.put(
            f"{BASE_URL}/api/locations/00000000-0000-0000-0000-000000000000/printer",
            json={"printer_type": "sunmi"},
        )
        assert r.status_code in (404, 405), f"expected 404/405, got {r.status_code}"

    def test_location_test_print_gone(self, admin_session):
        r = admin_session.get(
            f"{BASE_URL}/api/locations/00000000-0000-0000-0000-000000000000/test-print.html"
        )
        assert r.status_code in (404, 405), f"expected 404/405, got {r.status_code}"


class TestReceiptHtmlStillWorks:
    def test_thermal_preview_contains_media_print_and_page(self, admin_session, existing_payment_id):
        r = admin_session.get(
            f"{BASE_URL}/api/payments/{existing_payment_id}/print.html",
            params={"format": "thermal", "preview": 1},
        )
        assert r.status_code == 200, f"status {r.status_code}: {r.text[:300]}"
        assert "text/html" in r.headers.get("content-type", "").lower()
        html = r.text
        assert "@media print" in html, "missing '@media print'"
        # Must contain @page with 58mm (default). Allow optional whitespace.
        assert re.search(r"@page\s*\{\s*size:\s*58mm", html), "expected '@page { size: 58mm ...'"
        # Must NOT use 'auto' as size dimension.
        assert not re.search(r"size:\s*\d+mm\s+auto", html), "'size: ...mm auto' present (invalid CSS)"
        assert not re.search(r"size:\s*auto", html), "'size: auto' present"

    def test_thermal_preview_no_autoprint_script(self, admin_session, existing_payment_id):
        r = admin_session.get(
            f"{BASE_URL}/api/payments/{existing_payment_id}/print.html",
            params={"format": "thermal", "preview": 1},
        )
        assert r.status_code == 200
        # preview=1 should NOT include the auto window.print() script
        assert "window.print()" not in r.text or "onclick=\"window.print()\"" in r.text, \
            "preview mode should not auto-print; only the manual button is allowed"

    def test_a4_format_still_works(self, admin_session, existing_payment_id):
        r = admin_session.get(
            f"{BASE_URL}/api/payments/{existing_payment_id}/print.html",
            params={"format": "a4"},
        )
        assert r.status_code == 200, f"a4 render failed: {r.status_code}"
        assert "@media print" in r.text
        assert "@page" in r.text
