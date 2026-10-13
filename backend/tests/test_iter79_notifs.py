"""Iter79 — notification + overdue + pending-ids + kasgeld + kiosk WS tests."""
import asyncio
import json
import os
import time
import uuid

import pytest
import requests
import websockets

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE}/api"


# ------------------- fixtures -------------------
@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{API}/auth/login",
                      json={"email": "demo@surirent.sr", "password": "demo1234"})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="session")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="session")
def kiosk_token():
    r = requests.post(f"{API}/auth/kiosk-pin",
                      json={"pin": "4321", "company_slug": "my-awesome-rentals-bv"})
    if r.status_code != 200:
        # fallback — demo env may have reset. try 5566
        r = requests.post(f"{API}/auth/kiosk-pin",
                          json={"pin": "5566", "company_slug": "my-awesome-rentals-bv"})
    assert r.status_code == 200, f"kiosk-pin login failed: {r.status_code} {r.text}"
    data = r.json()
    return {"token": data["token"], "employee": data.get("employee") or {}}


@pytest.fixture(scope="session")
def kiosk_headers(kiosk_token):
    return {"Authorization": f"Bearer {kiosk_token['token']}"}


# ---------- Overdue ----------
class TestOverdue:
    def test_notify_overdue_returns_shape(self, admin_headers):
        r = requests.post(f"{API}/push/notify-overdue", headers=admin_headers)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "sent" in data and "overdue_count" in data and "message" in data
        assert isinstance(data["overdue_count"], int)
        assert isinstance(data["message"], str) and len(data["message"]) > 0
        # If no overdue → fixed friendly message
        if data["overdue_count"] == 0:
            assert "Geen achterstallige" in data["message"]
        else:
            # Dutch money format "SRD 12.000,00"
            assert "huurder" in data["message"].lower()
            # must contain currency token like SRD/USD/EUR
            assert any(cur in data["message"] for cur in ("SRD", "USD", "EUR"))
            # dutch decimal comma
            assert "," in data["message"]

    def test_overdue_message_matches_invoices(self, admin_headers):
        """Cross-check reported overdue_count against unpaid+past-due invoices.

        We cannot access the private helper; instead we assert that overdue_count
        is <= number of distinct tenants with past-due unpaid invoices visible via
        the admin API. Allow equality when invoices truly past due.
        """
        r = requests.post(f"{API}/push/notify-overdue", headers=admin_headers)
        assert r.status_code == 200
        reported = r.json()["overdue_count"]
        # Fetch invoices (if endpoint exists). Not strictly a failure if 404.
        inv_r = requests.get(f"{API}/invoices", headers=admin_headers)
        if inv_r.status_code == 200:
            invs = inv_r.json() if isinstance(inv_r.json(), list) else inv_r.json().get("items", [])
            # count distinct tenants with unpaid status
            unpaid_tenants = {i.get("tenant_id") for i in invs
                              if i.get("status") in ("open", "unpaid", "partial", "sent")
                              and i.get("tenant_id")}
            # reported must not exceed unpaid tenants
            assert reported <= len(unpaid_tenants) + 1  # +1 slack


# ---------- Pending-ids ----------
class TestPendingIds:
    def test_pending_ids_shape(self, admin_headers):
        r = requests.get(f"{API}/payments/pending-ids", headers=admin_headers)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "ids" in body and isinstance(body["ids"], list)

    def test_create_pending_and_appears(self, admin_headers, kiosk_headers, kiosk_token):
        # Find a tenant in company
        tr = requests.get(f"{API}/tenants", headers=admin_headers)
        assert tr.status_code == 200, tr.text
        tenants = tr.json() if isinstance(tr.json(), list) else tr.json().get("items", [])
        if not tenants:
            pytest.skip("no tenants")
        tenant = tenants[0]

        emp = kiosk_token["employee"]
        if not emp.get("id") or not emp.get("pin"):
            pytest.skip("no kiosk employee info in token response")

        # Try to create a kiosk payment via POST /kiosk/payments or similar.
        # Known: kiosk payment creates pending_approval if employee_id+pin given.
        payload = {
            "tenant_id": tenant["id"],
            "amount": 1.23,
            "currency": "SRD",
            "method": "contant",
            "category": "huur",
            "note": "TEST_iter79 pending",
        }
        pr = requests.post(
            f"{API}/kiosk/payments",
            headers=kiosk_headers,
            params={"employee_id": emp["id"], "employee_pin": emp["pin"]},
            json=payload,
        )
        if pr.status_code not in (200, 201):
            pytest.skip(f"kiosk payment endpoint not usable: {pr.status_code} {pr.text[:200]}")
        pid = pr.json().get("id") or pr.json().get("payment", {}).get("id")
        if not pid:
            pytest.skip("no payment id in response")

        time.sleep(0.5)
        lr = requests.get(f"{API}/payments/pending-ids", headers=admin_headers)
        assert lr.status_code == 200
        ids = lr.json()["ids"]
        assert pid in ids, f"pending id {pid} not in list {ids}"

        # Approve → should disappear. Needs signature data URL.
        sig = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
        ar = requests.post(f"{API}/payments/{pid}/approve", headers=admin_headers,
                           json={"signature_data_url": sig})
        assert ar.status_code in (200, 201, 204), ar.text
        time.sleep(0.3)
        lr2 = requests.get(f"{API}/payments/pending-ids", headers=admin_headers)
        assert pid not in lr2.json()["ids"]


# ---------- Kasgeld + SSE ----------
class TestKasgeldSSE:
    def test_kasgeld_create_triggers_sse(self, admin_token, kiosk_headers):
        """Open SSE as admin, POST /kiosk/kasgeld, expect notification event with title starting 'Kasgeld ·'."""
        import threading
        received = {"events": []}
        stop = {"flag": False}

        def sse_reader():
            try:
                with requests.get(
                    f"{API}/admin/events",
                    headers={"Authorization": f"Bearer {admin_token}"},
                    stream=True, timeout=20,
                ) as resp:
                    for raw in resp.iter_lines(decode_unicode=True):
                        if stop["flag"]:
                            break
                        if not raw or not raw.startswith("data:"):
                            continue
                        try:
                            ev = json.loads(raw[5:].strip())
                        except Exception:
                            continue
                        received["events"].append(ev)
                        if ev.get("type") == "notification" and str(ev.get("title", "")).startswith("Kasgeld ·"):
                            break
            except Exception as e:
                received["err"] = str(e)

        t = threading.Thread(target=sse_reader, daemon=True)
        t.start()
        time.sleep(1.2)  # allow SSE handshake

        payload = {
            "type": "in",
            "amount": 7.77,
            "currency": "SRD",
            "description": "TEST_iter79 kasgeld",
        }
        r = requests.post(f"{API}/kiosk/kasgeld", headers=kiosk_headers, json=payload)
        assert r.status_code in (200, 201), r.text
        kid = r.json().get("id")
        assert kid

        # wait up to 6s for SSE notification
        deadline = time.time() + 6
        found = None
        while time.time() < deadline:
            for ev in received["events"]:
                if ev.get("type") == "notification" and str(ev.get("title", "")).startswith("Kasgeld ·"):
                    found = ev
                    break
            if found:
                break
            time.sleep(0.3)
        stop["flag"] = True

        assert found is not None, f"No Kasgeld SSE received. events={received['events'][:6]}"
        assert "Inkomen" in found["title"] or "Uitgave" in found["title"]
        assert "SRD" in found["title"]
        assert "," in found["title"]  # dutch decimal

        # cleanup
        try:
            requests.delete(f"{API}/kasgeld/{kid}",
                            headers={"Authorization": f"Bearer {admin_token}"})
        except Exception:
            pass


# ---------- Kiosk WS login/logout notifications ----------
class TestKioskWSLogin:
    def test_ws_employee_login_logout_emits_sse(self, admin_token, kiosk_token):
        import threading
        emp = kiosk_token["employee"]
        if not emp.get("id"):
            pytest.skip("no employee in kiosk login")
        name = emp.get("name") or "Testmedewerker"
        emp_id = emp["id"] + "-iter79"  # unique so prev online state is false

        received = {"events": []}
        stop = {"flag": False}

        def sse_reader():
            try:
                with requests.get(
                    f"{API}/admin/events",
                    headers={"Authorization": f"Bearer {admin_token}"},
                    stream=True, timeout=20,
                ) as resp:
                    for raw in resp.iter_lines(decode_unicode=True):
                        if stop["flag"]:
                            break
                        if not raw or not raw.startswith("data:"):
                            continue
                        try:
                            ev = json.loads(raw[5:].strip())
                        except Exception:
                            continue
                        received["events"].append(ev)
            except Exception as e:
                received["err"] = str(e)

        t = threading.Thread(target=sse_reader, daemon=True)
        t.start()
        time.sleep(1.2)

        ws_url = BASE.replace("https://", "wss://").replace("http://", "ws://") + "/api/kiosk/ws"

        async def ws_scenario():
            async with websockets.connect(ws_url, open_timeout=10) as ws:
                await ws.send(json.dumps({
                    "type": "auth", "role": "employee",
                    "token": kiosk_token["token"], "name": name,
                    "employee_id": emp_id,
                }))
                await asyncio.sleep(2.0)  # let login notify fire
                await ws.send(json.dumps({"type": "BYE"}))
                await asyncio.sleep(0.2)

        try:
            asyncio.run(ws_scenario())
        except Exception as e:
            stop["flag"] = True
            pytest.fail(f"WS scenario failed: {e}")

        # wait up to 6s for logout event
        deadline = time.time() + 6
        login_evt = logout_evt = None
        while time.time() < deadline:
            for ev in received["events"]:
                if ev.get("type") != "notification":
                    continue
                title = str(ev.get("title", ""))
                if "is ingelogd" in title and name in title:
                    login_evt = ev
                if "is uitgelogd" in title and name in title:
                    logout_evt = ev
            if login_evt and logout_evt:
                break
            time.sleep(0.3)
        stop["flag"] = True

        titles = [e.get("title") for e in received["events"] if e.get("type") == "notification"]
        assert login_evt is not None, f"No 'is ingelogd' event. notifications={titles}"
        assert logout_evt is not None, f"No 'is uitgelogd' event. notifications={titles}"
        assert login_evt["title"].startswith("Kiosk · ")
        assert logout_evt["title"].startswith("Kiosk · ")

        # Count duplicates: should be exactly 1 ingelogd for this emp_id
        n_login = sum(1 for e in received["events"]
                      if e.get("type") == "notification"
                      and "is ingelogd" in str(e.get("title", ""))
                      and name in str(e.get("title", "")))
        assert n_login == 1, f"Expected 1 login notification, got {n_login}"


# ---------- Kiosk quick plan notification (does not log push failure) ----------
class TestKioskQuickPlan:
    def test_quick_plan_creates_and_notifies(self, admin_token, kiosk_token, kiosk_headers):
        # Need an admin token to list tenants + invoices
        ah = {"Authorization": f"Bearer {admin_token}"}
        tr = requests.get(f"{API}/tenants", headers=ah)
        tenants = tr.json() if isinstance(tr.json(), list) else tr.json().get("items", [])
        if not tenants:
            pytest.skip("no tenants")
        tenant = tenants[0]

        import threading
        received = {"events": []}
        stop = {"flag": False}

        def sse_reader():
            with requests.get(f"{API}/admin/events", headers=ah, stream=True, timeout=20) as resp:
                for raw in resp.iter_lines(decode_unicode=True):
                    if stop["flag"]:
                        break
                    if not raw or not raw.startswith("data:"):
                        continue
                    try:
                        ev = json.loads(raw[5:].strip())
                    except Exception:
                        continue
                    received["events"].append(ev)

        t = threading.Thread(target=sse_reader, daemon=True)
        t.start()
        time.sleep(1.2)

        payload = {
            "tenant_id": tenant["id"],
            "total_amount": 100.0,
            "num_installments": 2,
            "currency": "SRD",
            "notes": "TEST_iter79 quick plan",
        }
        pr = requests.post(f"{API}/kiosk/payment-plans/quick", headers=kiosk_headers, json=payload)
        assert pr.status_code == 200, pr.text
        plan_id = pr.json()["id"]

        deadline = time.time() + 6
        found = None
        while time.time() < deadline:
            for ev in received["events"]:
                if ev.get("type") == "notification" and "Nieuwe betalingsregeling vanuit kiosk" in str(ev.get("title", "")):
                    found = ev
                    break
            if found:
                break
            time.sleep(0.3)
        stop["flag"] = True
        titles = [e.get("title") for e in received["events"] if e.get("type") == "notification"]
        assert found is not None, f"No 'Nieuwe betalingsregeling' SSE. titles={titles}"
        assert "SRD" in str(found.get("body", ""))
        # cleanup — best effort
        try:
            requests.delete(f"{API}/payment-plans/{plan_id}", headers=ah)
        except Exception:
            pass
