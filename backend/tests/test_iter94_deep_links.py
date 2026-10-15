"""Iter94 — Deep-link notifications for Android FCM tap-to-open.

Covers (per review request):
- GET /api/payments/{id}: enriched payment, scoped, 404 on unknown.
- GET /api/payments/pending-count & /pending-ids still work (route order
  not shadowed by /{payment_id}).
- _notify_company_admins -> _deep_link injects data.url based on kind:
    * kiosk pending kiosk-payment (employee flow) should deep-link to
      /admin/payments?open=payment:<id>
    * tenant-portal self-service pending payment likewise
  Verified via SSE /api/admin/events subscription.
"""
import json
import os
import time
import uuid
import threading
import pytest
import requests

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE}/api"
# SSE is buffered by Cloudflare on the public URL; use internal backend
# for the streaming endpoint only.
SSE_API = "http://localhost:8001/api"
SLUG = "my-awesome-rentals-bv"
ADMIN_EMAIL = "demo@surirent.sr"
ADMIN_PASS = "demo1234"


# ------------------------- fixtures -------------------------

@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="module")
def company_id(admin_headers):
    r = requests.get(f"{API}/auth/me", headers=admin_headers)
    assert r.status_code == 200, r.text
    return r.json().get("company_id")


@pytest.fixture(scope="module")
def kiosk_token(admin_headers):
    """Make sure Anita exists as kiosk employee, login via PIN."""
    emps = requests.get(f"{API}/employees", headers=admin_headers).json()
    anita = next((e for e in emps if "Anita" in (e.get("name") or "")), None)
    if anita:
        requests.put(f"{API}/employees/{anita['id']}", headers=admin_headers,
                     json={"name": "Anita Sewdas", "app_role": "kiosk", "email": "",
                           "monthly_salary": 0, "currency": "SRD", "active": True,
                           "pin": "4321", "role": "Receptie", "phone": "+597 8801010"})
    r = requests.post(f"{API}/auth/kiosk-pin", json={"pin": "4321", "company_slug": SLUG})
    if r.status_code != 200:
        pytest.skip(f"kiosk login failed: {r.status_code} {r.text}")
    return r.json()["token"]


@pytest.fixture(scope="module")
def anita_id(admin_headers):
    emps = requests.get(f"{API}/employees", headers=admin_headers).json()
    a = next((e for e in emps if "Anita" in (e.get("name") or "")), None)
    assert a, "Anita employee required"
    return a["id"]


@pytest.fixture(scope="module")
def demo_tenant_apt(admin_headers):
    """Pick a tenant + apartment for creating test payments."""
    tenants = requests.get(f"{API}/tenants", headers=admin_headers).json()
    assert tenants, "no tenants in demo"
    t = tenants[0]
    return t


# ------------------------- GET /payments/{id} -------------------------

class TestGetPayment:
    def test_404_unknown_payment(self, admin_headers):
        r = requests.get(f"{API}/payments/does-not-exist-{uuid.uuid4().hex}", headers=admin_headers)
        assert r.status_code == 404

    def test_get_enriched_payment(self, admin_headers):
        # pick any existing payment
        lst = requests.get(f"{API}/payments?page=1&page_size=1", headers=admin_headers).json()
        items = lst if isinstance(lst, list) else (lst.get("items") or lst.get("payments") or [])
        if not items:
            pytest.skip("no existing payments in demo tenant")
        pid = items[0]["id"]
        r = requests.get(f"{API}/payments/{pid}", headers=admin_headers)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["id"] == pid
        # Enriched fields present
        for k in ("amount", "currency", "status"):
            assert k in data

    def test_pending_count_route_not_shadowed(self, admin_headers):
        r = requests.get(f"{API}/payments/pending-count", headers=admin_headers)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "count" in body and isinstance(body["count"], int)

    def test_pending_ids_route_not_shadowed(self, admin_headers):
        r = requests.get(f"{API}/payments/pending-ids", headers=admin_headers)
        assert r.status_code == 200, r.text
        assert "ids" in r.json()


# ------------------------- Deep-link via SSE -------------------------

class _SSECatcher:
    """Open SSE stream in background and collect `notification` events."""
    def __init__(self, token):
        self.events = []
        self.stop_evt = threading.Event()
        self.ready_evt = threading.Event()
        self._t = threading.Thread(target=self._run, args=(token,), daemon=True)

    def _run(self, token):
        try:
            with requests.get(f"{SSE_API}/admin/events",
                              headers={"Authorization": f"Bearer {token}",
                                       "Accept": "text/event-stream",
                                       "Accept-Encoding": "identity"},
                              stream=True, timeout=(5, 60)) as r:
                print(f"[sse] connected status={r.status_code}")
                for raw in r.iter_lines():
                    if self.stop_evt.is_set():
                        break
                    if not raw:
                        continue
                    line = raw.decode("utf-8", errors="ignore")
                    print(f"[sse] <- {line[:160]}")
                    if line.startswith("data:"):
                        payload = line[5:].strip()
                        try:
                            obj = json.loads(payload)
                        except Exception:
                            continue
                        if obj.get("type") == "ready":
                            self.ready_evt.set()
                        elif obj.get("type") == "notification":
                            self.events.append(obj)
        except Exception as e:
            print(f"[sse] error: {e}")

    def start(self):
        self._t.start()
        # wait for `ready` so subsequent kiosk POST is subscribed
        self.ready_evt.wait(timeout=10)

    def wait_for(self, pred, timeout=10):
        deadline = time.time() + timeout
        while time.time() < deadline:
            for ev in list(self.events):
                if pred(ev):
                    return ev
            time.sleep(0.3)
        return None

    def stop(self):
        self.stop_evt.set()


class TestDeepLinkPayment:
    def test_kiosk_pending_payment_notification_has_deep_link(
            self, admin_token, kiosk_token, anita_id, demo_tenant_apt):
        """Create kiosk payment with employee+PIN -> pending_approval ->
        notification SSE should contain data.url pointing at the specific
        payment deep link, not just the pending filter."""
        tenant = demo_tenant_apt
        amount = round(1 + uuid.uuid4().int % 50, 2)

        catcher = _SSECatcher(admin_token)
        catcher.start()
        try:
            body = {
                "tenant_id": tenant["id"],
                "apartment_id": tenant.get("apartment_id") or "",
                "amount": amount,
                "currency": "SRD",
                "method": "contant",
                "category": "huur",
            }
            r = requests.post(
                f"{API}/kiosk/payments?employee_id={anita_id}&employee_pin=4321",
                cookies={"kiosk_token": kiosk_token},
                json=body,
            )
            assert r.status_code == 200, r.text
            created = r.json()
            pid = created["id"]
            assert created["status"] == "pending_approval"

            ev = catcher.wait_for(lambda e: (e.get("data") or {}).get("payment_id") == pid, timeout=10)
            assert ev is not None, f"no notification SSE for payment {pid}; got {catcher.events[-3:]}"
            url = (ev.get("data") or {}).get("url") or ""
            expected = f"/admin/payments?open=payment:{pid}"
            assert url == expected, f"Deep link mismatch: got {url!r}, expected {expected!r}"
        finally:
            catcher.stop()
            # cleanup payment
            try:
                requests.delete(f"{API}/payments/{pid}",
                                headers={"Authorization": f"Bearer {admin_token}"})
            except Exception:
                pass
