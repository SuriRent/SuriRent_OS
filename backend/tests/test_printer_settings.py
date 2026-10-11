"""Tests for printer settings endpoints (per location, admin + kiosk)."""
import os
import requests
import pytest

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
COMPANY_SLUG = "my-awesome-rentals-bv"


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    r = s.post(f"{BASE}/api/auth/login",
               json={"email": "demo@surirent.sr", "password": "demo1234"})
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def kiosk_session():
    s = requests.Session()
    r = s.post(f"{BASE}/api/auth/kiosk-pin",
               json={"pin": "4321", "company_slug": COMPANY_SLUG})
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def boekhouder_session():
    s = requests.Session()
    r = s.post(f"{BASE}/api/auth/login",
               json={"email": "boekhouder@surirent.sr", "password": "test1234"})
    if r.status_code != 200:
        pytest.skip("boekhouder account not available")
    return s


# ---------- admin list ----------
def test_admin_list_printer_settings(admin_session):
    r = admin_session.get(f"{BASE}/api/locations/printer-settings")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    assert len(data) >= 1
    first = data[0]
    assert "id" in first and "printer" in first
    p = first["printer"]
    assert set(["type", "command", "paper", "width_mm", "chars_per_line", "configured"]).issubset(p.keys())


# ---------- admin PUT valid ----------
def test_admin_put_printer_ktp_custom(admin_session):
    locs = admin_session.get(f"{BASE}/api/locations/printer-settings").json()
    loc_id = locs[0]["id"]
    r = admin_session.put(f"{BASE}/api/locations/{loc_id}/printer",
                          json={"type": "ktp", "paper": "custom", "width_mm": 72})
    assert r.status_code == 200, r.text
    p = r.json()["printer"]
    assert p["type"] == "ktp"
    assert p["command"] == "PRINT_KTP"
    assert p["paper"] == "custom"
    assert p["width_mm"] == 72
    assert p["chars_per_line"] == 43
    assert p["configured"] is True

    # verify persistence
    locs2 = admin_session.get(f"{BASE}/api/locations/printer-settings").json()
    this = next(l for l in locs2 if l["id"] == loc_id)
    assert this["printer"]["type"] == "ktp"
    assert this["printer"]["width_mm"] == 72


def test_admin_put_printer_bluetooth_58mm(admin_session):
    locs = admin_session.get(f"{BASE}/api/locations/printer-settings").json()
    loc_id = locs[0]["id"]
    r = admin_session.put(f"{BASE}/api/locations/{loc_id}/printer",
                          json={"type": "bluetooth", "paper": "58mm"})
    assert r.status_code == 200
    p = r.json()["printer"]
    assert p["command"] == "PRINT_BLUETOOTH"
    assert p["width_mm"] == 58
    assert p["chars_per_line"] == 32


# ---------- admin PUT invalid ----------
def test_admin_put_custom_without_width(admin_session):
    locs = admin_session.get(f"{BASE}/api/locations/printer-settings").json()
    loc_id = locs[0]["id"]
    r = admin_session.put(f"{BASE}/api/locations/{loc_id}/printer",
                          json={"type": "ktp", "paper": "custom"})
    assert r.status_code == 400
    # Dutch error
    detail = r.json().get("detail", "")
    assert "papier" in detail.lower() or "mm" in detail.lower()


def test_admin_put_invalid_location(admin_session):
    r = admin_session.put(f"{BASE}/api/locations/does-not-exist/printer",
                          json={"type": "sunmi", "paper": "80mm"})
    assert r.status_code == 404


# ---------- role restriction ----------
def test_boekhouder_cannot_update_printer(boekhouder_session, admin_session):
    locs = admin_session.get(f"{BASE}/api/locations/printer-settings").json()
    loc_id = locs[0]["id"]
    r = boekhouder_session.put(f"{BASE}/api/locations/{loc_id}/printer",
                               json={"type": "sunmi", "paper": "80mm"})
    assert r.status_code in (401, 403)


# ---------- kiosk endpoint ----------
def test_kiosk_printer_settings_known_location(admin_session, kiosk_session):
    # first set location to ktp custom 72
    locs = admin_session.get(f"{BASE}/api/locations/printer-settings").json()
    loc_id = locs[0]["id"]
    admin_session.put(f"{BASE}/api/locations/{loc_id}/printer",
                      json={"type": "ktp", "paper": "custom", "width_mm": 72})

    r = kiosk_session.get(f"{BASE}/api/kiosk/printer-settings",
                          params={"location_id": loc_id})
    assert r.status_code == 200
    p = r.json()["printer"]
    assert p["type"] == "ktp"
    assert p["command"] == "PRINT_KTP"
    assert p["width_mm"] == 72
    assert p["chars_per_line"] == 43
    assert p["configured"] is True


def test_kiosk_printer_settings_unknown_location(kiosk_session):
    r = kiosk_session.get(f"{BASE}/api/kiosk/printer-settings",
                          params={"location_id": "does-not-exist"})
    assert r.status_code == 200
    p = r.json()["printer"]
    assert p["type"] == "sunmi"
    assert p["paper"] == "80mm"
    assert p["width_mm"] == 80
    assert p["configured"] is False


def test_kiosk_printer_settings_no_location(kiosk_session):
    r = kiosk_session.get(f"{BASE}/api/kiosk/printer-settings")
    assert r.status_code == 200
    assert r.json()["printer"]["configured"] is False


def test_kiosk_cannot_update_printer(kiosk_session, admin_session):
    locs = admin_session.get(f"{BASE}/api/locations/printer-settings").json()
    loc_id = locs[0]["id"]
    r = kiosk_session.put(f"{BASE}/api/locations/{loc_id}/printer",
                          json={"type": "sunmi", "paper": "80mm"})
    assert r.status_code in (401, 403)


# ---------- restore sensible default at end ----------
def test_zzz_restore_default(admin_session):
    locs = admin_session.get(f"{BASE}/api/locations/printer-settings").json()
    for loc in locs:
        admin_session.put(f"{BASE}/api/locations/{loc['id']}/printer",
                          json={"type": "sunmi", "paper": "80mm"})
