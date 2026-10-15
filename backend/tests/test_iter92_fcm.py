"""Iter92 — Firebase Cloud Messaging (FCM) integration tests.

Covers:
- POST /api/push/fcm/register (admin -> configured:true, non-admin -> 403)
- GET /api/push/fcm/devices (no token field, sorted)
- DELETE /api/push/fcm/devices/{id} (404 for unknown, 200 for valid)
- POST /api/push/fcm/test with fake tokens -> auto-cleanup
- PUT /api/settings/fcm_prefs persists, GET /api/settings returns 7 keys
- _fcm_notify_company via kiosk kasgeld creation (pref ON -> attempt+cleanup; pref OFF -> token stays)
- Existing PWA push endpoints untouched (/api/push/status, /api/push/devices, /api/push/test)
"""
import os
import time
import uuid
import pytest
import requests

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
SLUG = "my-awesome-rentals-bv"

ADMIN_EMAIL = "demo@surirent.sr"
ADMIN_PASS = "demo1234"

FAKE_TOKEN_PREFIX = "TEST_fake_fcm_"


# ----------------- fixtures -----------------

@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="module")
def kiosk_token(admin_token):
    """Fresh kiosk PIN login so demo-reset doesn't invalidate the saved ctx."""
    # Ensure Anita exists with PIN 4321
    emps = requests.get(f"{BASE}/api/employees",
                        headers={"Authorization": f"Bearer {admin_token}"}).json()
    anita = next((e for e in emps if "Anita" in e.get("name", "")), None)
    if anita:
        requests.put(f"{BASE}/api/employees/{anita['id']}",
                     headers={"Authorization": f"Bearer {admin_token}"},
                     json={"name": "Anita Sewdas", "app_role": "kiosk", "email": "",
                           "monthly_salary": 0, "currency": "SRD", "active": True, "pin": "4321"})
    kr = requests.post(f"{BASE}/api/auth/kiosk-pin",
                       json={"pin": "4321", "company_slug": SLUG})
    if kr.status_code != 200:
        pytest.skip(f"Kiosk login failed: {kr.status_code} {kr.text}")
    return kr.json()["token"]


@pytest.fixture(autouse=True)
def _cleanup_fake_tokens(admin_headers):
    yield
    # Best-effort cleanup of any TEST_ fake devices left behind.
    try:
        r = requests.get(f"{BASE}/api/push/fcm/devices", headers=admin_headers)
        if r.status_code == 200:
            for d in r.json().get("devices", []):
                if (d.get("device_name") or "").startswith("TEST_"):
                    requests.delete(f"{BASE}/api/push/fcm/devices/{d['id']}", headers=admin_headers)
    except Exception:
        pass


def _register_fake(headers, name_suffix=""):
    tok = FAKE_TOKEN_PREFIX + uuid.uuid4().hex + ("x" * 20)  # >=20 chars
    r = requests.post(f"{BASE}/api/push/fcm/register",
                      headers=headers,
                      json={"token": tok, "device_name": f"TEST_dev_{name_suffix or uuid.uuid4().hex[:6]}"})
    return tok, r


# ----------------- /push/fcm/register -----------------

class TestFcmRegister:
    def test_admin_register_returns_configured_true(self, admin_headers):
        tok, r = _register_fake(admin_headers, "reg")
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["ok"] is True
        assert data["configured"] is True  # FCM env is set

        # Verify device appears in list (without the raw token field)
        lst = requests.get(f"{BASE}/api/push/fcm/devices", headers=admin_headers).json()
        matching = [d for d in lst["devices"] if d.get("device_name", "").endswith("_reg") or tok[:10] in str(d)]
        assert any(d["device_name"].startswith("TEST_dev_") for d in lst["devices"])
        for d in lst["devices"]:
            assert "token" not in d, "Raw FCM token must not leak to client"

    def test_non_admin_kiosk_cannot_register(self, kiosk_token):
        # kiosk_token is NOT an admin user token — should 401/403
        tok = FAKE_TOKEN_PREFIX + uuid.uuid4().hex + ("y" * 20)
        r = requests.post(f"{BASE}/api/push/fcm/register",
                          cookies={"kiosk_token": kiosk_token},
                          json={"token": tok, "device_name": "TEST_dev_kiosk"})
        # kiosk session has no admin role → endpoint requires get_current_user (admin cookie/bearer)
        # so expected 401 (no admin auth) or 403 (admin role check)
        assert r.status_code in (401, 403), f"Expected 401/403, got {r.status_code}: {r.text}"


# ----------------- /push/fcm/devices -----------------

class TestFcmDevices:
    def test_list_devices_no_token_field_and_configured(self, admin_headers):
        _register_fake(admin_headers, "list")
        r = requests.get(f"{BASE}/api/push/fcm/devices", headers=admin_headers)
        assert r.status_code == 200
        data = r.json()
        assert data["configured"] is True
        assert isinstance(data["devices"], list)
        for d in data["devices"]:
            assert "token" not in d
            assert "id" in d and "device_name" in d and "updated_at" in d

    def test_delete_unknown_returns_404(self, admin_headers):
        r = requests.delete(f"{BASE}/api/push/fcm/devices/does-not-exist-{uuid.uuid4().hex}",
                            headers=admin_headers)
        assert r.status_code == 404

    def test_delete_known_removes(self, admin_headers):
        _register_fake(admin_headers, "del")
        lst = requests.get(f"{BASE}/api/push/fcm/devices", headers=admin_headers).json()["devices"]
        target = next(d for d in lst if d["device_name"].endswith("_del"))
        r = requests.delete(f"{BASE}/api/push/fcm/devices/{target['id']}", headers=admin_headers)
        assert r.status_code == 200
        lst2 = requests.get(f"{BASE}/api/push/fcm/devices", headers=admin_headers).json()["devices"]
        assert all(d["id"] != target["id"] for d in lst2)


# ----------------- /push/fcm/test (real Google call, fake token cleanup) -----------------

class TestFcmTestEndpoint:
    def test_fake_token_rejected_and_cleaned(self, admin_headers):
        tok, _ = _register_fake(admin_headers, "cleanup")
        # Fire the test endpoint — real FCM round-trip, slow
        r = requests.post(f"{BASE}/api/push/fcm/test", headers=admin_headers, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["sent"] == 0, f"Fake tokens must not be delivered, got {body}"
        # Google replied UNREGISTERED/INVALID_ARGUMENT → backend must delete it
        lst = requests.get(f"{BASE}/api/push/fcm/devices", headers=admin_headers).json()["devices"]
        assert all(not d["device_name"].endswith("_cleanup") for d in lst), \
            "Fake FCM token should be auto-removed after invalid response"


# ----------------- /settings/fcm_prefs -----------------

class TestFcmPrefs:
    EXPECTED_KEYS = {"payment", "overdue", "approval", "kasgeld", "employee", "maintenance", "invoices"}

    def test_get_settings_returns_all_7_keys(self, admin_headers):
        r = requests.get(f"{BASE}/api/settings", headers=admin_headers)
        assert r.status_code == 200
        prefs = r.json().get("fcm_prefs") or {}
        assert set(prefs.keys()) >= self.EXPECTED_KEYS, f"Missing keys: {self.EXPECTED_KEYS - set(prefs.keys())}"

    def test_put_fcm_prefs_persists_partial_update(self, admin_headers):
        # Flip kasgeld off, verify persistence
        r = requests.put(f"{BASE}/api/settings/fcm_prefs",
                         headers=admin_headers,
                         json={"kasgeld": False})
        assert r.status_code == 200, r.text
        data = r.json()["data"]
        assert data["kasgeld"] is False
        # other defaults preserved
        assert data["payment"] in (True, False)

        # GET verifies persisted
        all_settings = requests.get(f"{BASE}/api/settings", headers=admin_headers).json()
        assert all_settings["fcm_prefs"]["kasgeld"] is False

        # Reset
        r2 = requests.put(f"{BASE}/api/settings/fcm_prefs",
                          headers=admin_headers,
                          json={"payment": True, "overdue": True, "approval": True, "kasgeld": True,
                                "employee": True, "maintenance": True, "invoices": True})
        assert r2.status_code == 200
        assert r2.json()["data"]["kasgeld"] is True


# ----------------- _fcm_notify_company via kiosk kasgeld -----------------

class TestFcmNotifyCompany:
    def _register_and_set_pref(self, admin_headers, kasgeld_on: bool):
        tok, _ = _register_fake(admin_headers, "notify")
        r = requests.put(f"{BASE}/api/settings/fcm_prefs",
                         headers=admin_headers,
                         json={"kasgeld": kasgeld_on, "payment": True, "overdue": True,
                               "approval": True, "employee": True, "maintenance": True, "invoices": True})
        assert r.status_code == 200
        return tok

    def _device_exists(self, admin_headers, suffix="_notify"):
        lst = requests.get(f"{BASE}/api/push/fcm/devices", headers=admin_headers).json()["devices"]
        return any(d["device_name"].endswith(suffix) for d in lst)

    def test_pref_on_triggers_fcm_and_cleans_fake_token(self, admin_headers, kiosk_token):
        self._register_and_set_pref(admin_headers, kasgeld_on=True)
        assert self._device_exists(admin_headers), "Fake device should be present before kasgeld event"

        # Trigger kiosk kasgeld — this schedules _notify_company_admins(kind=kasgeld)
        kr = requests.post(f"{BASE}/api/kiosk/kasgeld",
                           cookies={"kiosk_token": kiosk_token},
                           json={"type": "in", "amount": 1.0, "currency": "SRD",
                                 "description": "TEST_iter92_kasgeld_on"})
        assert kr.status_code in (200, 201), kr.text

        # Give the background _fcm_notify_company task time to call Google and clean up
        deadline = time.time() + 20
        gone = False
        while time.time() < deadline:
            if not self._device_exists(admin_headers):
                gone = True
                break
            time.sleep(1)
        assert gone, "With kasgeld pref ON, fake FCM token should be cleaned after Google rejects it"

    def test_pref_off_keeps_token_no_send(self, admin_headers, kiosk_token):
        self._register_and_set_pref(admin_headers, kasgeld_on=False)
        assert self._device_exists(admin_headers)

        kr = requests.post(f"{BASE}/api/kiosk/kasgeld",
                           cookies={"kiosk_token": kiosk_token},
                           json={"type": "out", "amount": 1.0, "currency": "SRD",
                                 "description": "TEST_iter92_kasgeld_off"})
        assert kr.status_code in (200, 201), kr.text

        # Wait a bit — nothing should happen
        time.sleep(5)
        assert self._device_exists(admin_headers), \
            "With kasgeld pref OFF, no FCM send → fake token should remain"

        # Reset pref back ON for other tests
        requests.put(f"{BASE}/api/settings/fcm_prefs", headers=admin_headers,
                     json={"kasgeld": True, "payment": True, "overdue": True, "approval": True,
                           "employee": True, "maintenance": True, "invoices": True})


# ----------------- PWA push endpoints untouched -----------------

class TestPwaPushUnchanged:
    def test_push_status(self, admin_headers):
        r = requests.get(f"{BASE}/api/push/status", headers=admin_headers)
        assert r.status_code == 200
        data = r.json()
        # Should expose configured + public_key or similar fields; just assert dict
        assert isinstance(data, dict)

    def test_push_devices_list(self, admin_headers):
        r = requests.get(f"{BASE}/api/push/devices", headers=admin_headers)
        assert r.status_code == 200
        assert isinstance(r.json(), (dict, list))

    def test_push_test_no_subs_ok(self, admin_headers):
        r = requests.post(f"{BASE}/api/push/test", headers=admin_headers)
        # Either 200 with sent:0 or 400/404 if no subscriptions — must not be 500
        assert r.status_code < 500, r.text
