"""Iter95 — Notification action buttons (Goedkeuren/Afwijzen).

Covers:
- Regression: POST /api/payments/{pid}/approve + /reject still work (with signature).
- _with_action_token: injects action_token/action_url/actions/require_approval only
  for approval kinds with payment_id (positive + negative scoping).
- POST /api/push/action (NO auth):
    * approve path -> status=approved, approved_by '<name> (via melding)',
      approved_via='notification', signature taken from PUT /api/me/approval-signature
      when set, else null.
    * reject path -> status=rejected, rejected_reason='Afgewezen via melding'.
    * Second use -> 409.
    * Tampered token -> 401. Expired token -> 401.
    * Unknown action -> 422. Token.uid is not admin -> 403.
- /api/me/approval-signature GET/PUT: store/clear data:image URL; invalid -> 422.
- /api/push/fcm/register accepts capabilities=['actions'] and /devices does not
  leak `token`/`capabilities`.
- fcm_service._send_one data_only=True omits notification{} block.

All tokens are generated with pdf_security.make_verify_token (same JWT_SECRET as
the backend process). Uses demo admin + Anita kiosk employee like other iters.
"""
import os
import sys
import time
import uuid
import asyncio
import pytest
import requests

sys.path.insert(0, "/app/backend")
from pdf_security import make_verify_token  # noqa: E402

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
SLUG = "my-awesome-rentals-bv"
ADMIN_EMAIL = "demo@surirent.sr"
ADMIN_PASS = "demo1234"


# -------------------- fixtures --------------------

@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASS})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="module")
def admin_me(admin_headers):
    r = requests.get(f"{BASE}/api/auth/me", headers=admin_headers)
    assert r.status_code == 200, r.text
    me = r.json()
    assert me.get("id") and me.get("company_id"), me
    return me


@pytest.fixture(scope="module")
def anita_id(admin_headers):
    emps = requests.get(f"{BASE}/api/employees", headers=admin_headers).json()
    anita = next((e for e in emps if "Anita" in e.get("name", "")), None)
    assert anita, "Anita employee not found"
    # Re-seed PIN + kiosk role (demo DB resets every 30m)
    requests.put(f"{BASE}/api/employees/{anita['id']}",
                 headers=admin_headers,
                 json={"name": "Anita Sewdas", "app_role": "kiosk", "email": "",
                       "monthly_salary": 0, "currency": "SRD", "active": True,
                       "pin": "4321"})
    return anita["id"]


@pytest.fixture(scope="module")
def kiosk_token():
    kr = requests.post(f"{BASE}/api/auth/kiosk-pin",
                       json={"pin": "4321", "company_slug": SLUG})
    if kr.status_code != 200:
        pytest.skip(f"Kiosk login failed: {kr.status_code} {kr.text}")
    return kr.json()["token"]


@pytest.fixture(scope="module")
def tenant_id(admin_headers):
    r = requests.get(f"{BASE}/api/tenants", headers=admin_headers)
    assert r.status_code == 200
    tenants = r.json()
    assert tenants, "No tenants seeded"
    return tenants[0]["id"]


def _mint_token(pid: str, uid: str, cid: str, exp_delta: int = 3600, kind: str = "pa") -> str:
    return make_verify_token({
        "t": kind, "pid": pid, "uid": uid, "cid": cid,
        "exp": int(time.time()) + exp_delta,
    })


def _create_pending_payment(kiosk_token, anita_id, tenant_id, amount=1.0):
    """Create a pending_approval payment via the kiosk employee flow."""
    r = requests.post(
        f"{BASE}/api/kiosk/payments",
        cookies={"kiosk_token": kiosk_token},
        params={"employee_id": anita_id, "employee_pin": "4321"},
        json={"tenant_id": tenant_id, "amount": amount, "currency": "SRD",
              "method": "contant", "category": "overig",
              "note": "TEST_iter95_pending"},
    )
    assert r.status_code in (200, 201), f"{r.status_code}: {r.text}"
    doc = r.json()
    assert doc["status"] == "pending_approval"
    return doc


@pytest.fixture
def pending_payment(kiosk_token, anita_id, tenant_id):
    doc = _create_pending_payment(kiosk_token, anita_id, tenant_id)
    yield doc
    # Cleanup: try to delete (admin endpoint)
    try:
        requests.delete(f"{BASE}/api/payments/{doc['id']}", timeout=5)
    except Exception:
        pass


# -------------------- REGRESSION: /approve + /reject --------------------

TINY_SIG = ("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAA"
            "AC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=")


class TestRegressionApproveReject:
    def test_approve_with_signature_still_works(self, admin_headers, pending_payment):
        pid = pending_payment["id"]
        r = requests.post(f"{BASE}/api/payments/{pid}/approve",
                          headers=admin_headers,
                          json={"signature_data_url": TINY_SIG})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["status"] == "approved"
        # When approved via /approve (not /push/action): no " (via melding)" suffix
        assert "(via melding)" not in (data.get("approved_by") or "")
        assert data.get("approved_via") in (None, "")  # not set by direct flow

    def test_approve_without_signature_rejected(self, admin_headers, pending_payment):
        r = requests.post(f"{BASE}/api/payments/{pending_payment['id']}/approve",
                          headers=admin_headers,
                          json={"signature_data_url": ""})
        assert r.status_code == 400

    def test_reject_with_reason_still_works(self, admin_headers, pending_payment):
        pid = pending_payment["id"]
        r = requests.post(f"{BASE}/api/payments/{pid}/reject",
                          headers=admin_headers,
                          json={"reason": "TEST manual reject"})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "rejected"
        assert r.json().get("rejected_reason") == "TEST manual reject"


# -------------------- /api/me/approval-signature --------------------

class TestApprovalSignatureStore:
    def test_get_and_put_signature_roundtrip(self, admin_headers):
        # Clear first
        r0 = requests.put(f"{BASE}/api/me/approval-signature",
                          headers=admin_headers,
                          json={"signature_data_url": None})
        assert r0.status_code == 200
        assert r0.json()["signature_data_url"] in (None, "")

        # Set
        r1 = requests.put(f"{BASE}/api/me/approval-signature",
                          headers=admin_headers,
                          json={"signature_data_url": TINY_SIG})
        assert r1.status_code == 200
        assert r1.json()["signature_data_url"] == TINY_SIG

        # GET
        r2 = requests.get(f"{BASE}/api/me/approval-signature",
                          headers=admin_headers)
        assert r2.status_code == 200
        assert r2.json()["signature_data_url"] == TINY_SIG

        # Clear again
        r3 = requests.put(f"{BASE}/api/me/approval-signature",
                          headers=admin_headers,
                          json={"signature_data_url": None})
        assert r3.status_code == 200
        assert r3.json()["signature_data_url"] in (None, "")
        r4 = requests.get(f"{BASE}/api/me/approval-signature",
                          headers=admin_headers)
        assert r4.json()["signature_data_url"] in (None, "")

    def test_invalid_signature_returns_422(self, admin_headers):
        r = requests.put(f"{BASE}/api/me/approval-signature",
                         headers=admin_headers,
                         json={"signature_data_url": "not-a-data-url"})
        assert r.status_code == 422


# -------------------- POST /api/push/action --------------------

class TestPushAction:
    def test_approve_without_saved_signature_sets_null_and_suffix(
            self, admin_headers, admin_me, pending_payment):
        # Ensure no saved signature
        requests.put(f"{BASE}/api/me/approval-signature", headers=admin_headers,
                     json={"signature_data_url": None})

        tok = _mint_token(pending_payment["id"], admin_me["id"], admin_me["company_id"])
        r = requests.post(f"{BASE}/api/push/action",
                          json={"token": tok, "action": "approve"})
        # NO auth header — the token is the auth.
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True
        assert body["status"] == "approved"

        # Fetch payment and inspect
        p = requests.get(f"{BASE}/api/payments/{pending_payment['id']}",
                         headers=admin_headers).json()
        assert p["status"] == "approved"
        assert "(via melding)" in (p.get("approved_by") or "")
        # NOTE: approved_via is persisted in Mongo but PaymentOut response_model
        # strips it. Verify directly via Mongo to confirm backend wrote it.
        from pymongo import MongoClient
        _c = MongoClient("mongodb://localhost:27017")
        _raw = _c["vastgoed_kiosk"].payments.find_one({"id": pending_payment["id"]})
        assert _raw.get("approved_via") == "notification"
        assert p.get("signature_data_url") in (None, "")  # no saved sig

    def test_approve_uses_saved_signature(
            self, admin_headers, admin_me, pending_payment):
        # Save a signature on admin profile
        requests.put(f"{BASE}/api/me/approval-signature", headers=admin_headers,
                     json={"signature_data_url": TINY_SIG})
        try:
            tok = _mint_token(pending_payment["id"], admin_me["id"], admin_me["company_id"])
            r = requests.post(f"{BASE}/api/push/action",
                              json={"token": tok, "action": "approve"})
            assert r.status_code == 200, r.text

            p = requests.get(f"{BASE}/api/payments/{pending_payment['id']}",
                             headers=admin_headers).json()
            assert p["status"] == "approved"
            assert p.get("signature_data_url") == TINY_SIG
            assert "(via melding)" in (p.get("approved_by") or "")
            from pymongo import MongoClient
            _c = MongoClient("mongodb://localhost:27017")
            _raw = _c["vastgoed_kiosk"].payments.find_one({"id": pending_payment["id"]})
            assert _raw.get("approved_via") == "notification"
        finally:
            requests.put(f"{BASE}/api/me/approval-signature",
                         headers=admin_headers,
                         json={"signature_data_url": None})

    def test_reject_sets_default_reason(self, admin_me, admin_headers, pending_payment):
        tok = _mint_token(pending_payment["id"], admin_me["id"], admin_me["company_id"])
        r = requests.post(f"{BASE}/api/push/action",
                          json={"token": tok, "action": "reject"})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "rejected"

        p = requests.get(f"{BASE}/api/payments/{pending_payment['id']}",
                         headers=admin_headers).json()
        assert p["status"] == "rejected"
        assert p.get("rejected_reason") == "Afgewezen via melding"

    def test_second_use_returns_409(self, admin_me, admin_headers, pending_payment):
        tok = _mint_token(pending_payment["id"], admin_me["id"], admin_me["company_id"])
        r1 = requests.post(f"{BASE}/api/push/action",
                           json={"token": tok, "action": "approve"})
        assert r1.status_code == 200
        # Second use — payment is no longer pending_approval → 409
        r2 = requests.post(f"{BASE}/api/push/action",
                           json={"token": tok, "action": "approve"})
        assert r2.status_code == 409, r2.text
        assert "al verwerkt" in r2.json().get("detail", "").lower()

    def test_tampered_token_returns_401(self, admin_me, pending_payment):
        tok = _mint_token(pending_payment["id"], admin_me["id"], admin_me["company_id"])
        bad = tok[:-2] + ("00" if tok[-2:] != "00" else "11")
        r = requests.post(f"{BASE}/api/push/action",
                          json={"token": bad, "action": "approve"})
        assert r.status_code == 401

    def test_expired_token_returns_401(self, admin_me, pending_payment):
        tok = _mint_token(pending_payment["id"], admin_me["id"],
                          admin_me["company_id"], exp_delta=-10)
        r = requests.post(f"{BASE}/api/push/action",
                          json={"token": tok, "action": "approve"})
        assert r.status_code == 401

    def test_unknown_action_returns_422(self, admin_me, pending_payment):
        tok = _mint_token(pending_payment["id"], admin_me["id"], admin_me["company_id"])
        r = requests.post(f"{BASE}/api/push/action",
                          json={"token": tok, "action": "approve_but_also"})
        assert r.status_code == 422

    def test_non_admin_uid_returns_403(self, admin_headers, admin_me, pending_payment, anita_id):
        # anita_id is an employee doc, not a users-collection id. Should 403.
        tok = _mint_token(pending_payment["id"], anita_id, admin_me["company_id"])
        r = requests.post(f"{BASE}/api/push/action",
                          json={"token": tok, "action": "approve"})
        # No matching user doc → 403 ("Onvoldoende rechten")
        assert r.status_code == 403, r.text


# -------------------- _with_action_token unit (via import) --------------------

class TestWithActionTokenUnit:
    def test_adds_fields_for_approval_kind_with_payment_id(self, admin_me):
        from server import _with_action_token
        out = _with_action_token(
            {"kind": "payment_pending", "payment_id": "p-123", "url": "/x"},
            admin_me["id"], admin_me["company_id"],
        )
        assert out["require_approval"] is True
        assert out["actions"] == "approve,reject"
        assert out["action_token"] and "." in out["action_token"]
        assert out["action_url"].endswith("/api/push/action")

    def test_skips_for_non_approval_kind(self, admin_me):
        from server import _with_action_token
        out = _with_action_token(
            {"kind": "payment", "payment_id": "p-123"},
            admin_me["id"], admin_me["company_id"],
        )
        assert "action_token" not in out
        assert "require_approval" not in out

    def test_skips_when_missing_payment_id(self, admin_me):
        from server import _with_action_token
        out = _with_action_token(
            {"kind": "approval"},
            admin_me["id"], admin_me["company_id"],
        )
        assert "action_token" not in out

    def test_skips_when_missing_uid(self, admin_me):
        from server import _with_action_token
        out = _with_action_token(
            {"kind": "approval", "payment_id": "p-1"},
            None, admin_me["company_id"],
        )
        assert "action_token" not in out


# -------------------- /push/fcm/register capabilities --------------------

class TestFcmRegisterCapabilities:
    def test_capabilities_actions_accepted_and_not_leaked(self, admin_headers):
        tok = "TEST_iter95_cap_" + uuid.uuid4().hex + ("z" * 20)
        try:
            r = requests.post(f"{BASE}/api/push/fcm/register",
                              headers=admin_headers,
                              json={"token": tok,
                                    "device_name": "TEST_iter95_caps",
                                    "capabilities": ["actions"]})
            assert r.status_code == 200, r.text
            assert r.json()["ok"] is True

            lst = requests.get(f"{BASE}/api/push/fcm/devices",
                               headers=admin_headers).json()["devices"]
            # Device present; neither 'token' nor 'capabilities' leaked
            found = next((d for d in lst if d["device_name"] == "TEST_iter95_caps"), None)
            assert found, "Device not listed"
            assert "token" not in found
            assert "capabilities" not in found
        finally:
            # Cleanup
            try:
                lst = requests.get(f"{BASE}/api/push/fcm/devices",
                                   headers=admin_headers).json()["devices"]
                for d in lst:
                    if d.get("device_name") == "TEST_iter95_caps":
                        requests.delete(f"{BASE}/api/push/fcm/devices/{d['id']}",
                                        headers=admin_headers)
            except Exception:
                pass


# -------------------- fcm_service _send_one data_only payload --------------------

class TestFcmSendOneDataOnly:
    def test_data_only_payload_has_no_notification_block(self, monkeypatch):
        import importlib
        fcm = importlib.import_module("fcm_service")

        # Force fcm_configured() path (_PROJECT_ID present) by patching env not needed:
        # _send_one builds msg BEFORE any network call. We intercept the HTTP call.
        captured = {}

        class _FakeResp:
            is_success = True
            headers = {"content-type": "application/json"}
            status_code = 200
            def json(self):
                return {"name": "ok"}

        class _FakeClient:
            is_closed = False
            async def post(self, url, json=None, headers=None):
                captured["msg"] = json
                return _FakeResp()

        async def _fake_token():
            return "fake-bearer"

        monkeypatch.setattr(fcm, "_access_token", _fake_token)
        monkeypatch.setattr(fcm, "_http", lambda: _FakeClient())

        async def run():
            return await fcm._send_one("fake-token", "T", "B",
                                       {"kind": "approval", "payment_id": "p1",
                                        "action_token": "a.b"}, data_only=True)

        result = asyncio.run(run())
        assert result == "ok"
        msg = captured["msg"]["message"]
        assert "notification" not in msg, f"data_only must NOT include notification: {msg}"
        assert "data" in msg
        assert msg["data"]["title"] == "T"
        assert msg["data"]["body"] == "B"
        assert msg["data"]["kind"] == "approval"
        assert msg["data"]["action_token"] == "a.b"

    def test_regular_payload_includes_notification_block(self, monkeypatch):
        import importlib
        fcm = importlib.import_module("fcm_service")
        captured = {}

        class _FakeResp:
            is_success = True
            headers = {"content-type": "application/json"}
            status_code = 200
            def json(self):
                return {"name": "ok"}

        class _FakeClient:
            is_closed = False
            async def post(self, url, json=None, headers=None):
                captured["msg"] = json
                return _FakeResp()

        async def _fake_token():
            return "fake-bearer"

        monkeypatch.setattr(fcm, "_access_token", _fake_token)
        monkeypatch.setattr(fcm, "_http", lambda: _FakeClient())

        async def run():
            return await fcm._send_one("tok", "T", "B", {"kind": "payment"}, data_only=False)
        asyncio.run(run())
        msg = captured["msg"]["message"]
        assert "notification" in msg
        assert msg["notification"]["title"] == "T"
