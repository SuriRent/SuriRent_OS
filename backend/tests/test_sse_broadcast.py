"""SSE broadcast middleware tests — verifies cookie-based auth mutations
correctly emit 'change' events on /api/admin/events, that Bearer legacy flow
still works, and that skip paths do NOT broadcast.
"""
import json
import os
import threading
import time
import uuid

import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

DEMO_EMAIL = "demo@surirent.sr"
DEMO_PW = "demo1234"


# ---------------------------------------------------------------------------
# Helpers / fixtures
# ---------------------------------------------------------------------------
def _login_get_cookie_and_token(email=DEMO_EMAIL, password=DEMO_PW):
    """Login and return (session_with_cookie, access_token_from_body_if_any)."""
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=10)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    cookie = s.cookies.get("access_token")
    assert cookie, f"No access_token cookie set. Cookies: {s.cookies.get_dict()}"
    body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
    token = body.get("access_token") or body.get("token") or cookie
    return s, token


class SSEListener:
    """Background SSE consumer that captures events into a list."""

    def __init__(self, url, cookies=None, headers=None):
        self.url = url
        self.cookies = cookies or {}
        self.headers = headers or {}
        self.events = []
        self.raw_lines = []
        self.stop_flag = False
        self.thread = None
        self.status = None
        self.error = None
        self.ready = threading.Event()

    def _run(self):
        try:
            with requests.get(
                self.url,
                cookies=self.cookies,
                headers={**self.headers, "Accept": "text/event-stream"},
                stream=True,
                timeout=30,
            ) as r:
                self.status = r.status_code
                if r.status_code != 200:
                    self.error = f"SSE HTTP {r.status_code}: {r.text[:200]}"
                    self.ready.set()
                    return
                buffer_event = None
                for line in r.iter_lines(decode_unicode=True):
                    if self.stop_flag:
                        break
                    if line is None:
                        continue
                    self.raw_lines.append(line)
                    if line.startswith("event: ready"):
                        self.ready.set()
                    elif line.startswith("data: "):
                        payload = line[6:]
                        try:
                            self.events.append(json.loads(payload))
                        except Exception:
                            self.events.append({"_raw": payload})
        except Exception as e:  # noqa: BLE001
            self.error = str(e)
            self.ready.set()

    def start(self):
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()
        self.ready.wait(timeout=5)

    def wait_for_event(self, predicate, timeout=8.0):
        deadline = time.time() + timeout
        while time.time() < deadline:
            for ev in list(self.events):
                if predicate(ev):
                    return ev
            time.sleep(0.15)
        return None

    def stop(self):
        self.stop_flag = True


@pytest.fixture(scope="module")
def demo_session():
    s, token = _login_get_cookie_and_token()
    return {"session": s, "token": token, "cookie": s.cookies.get("access_token")}


@pytest.fixture(scope="module")
def created_ids():
    """Track resource IDs created during tests for cleanup."""
    ids = {"tenants": [], "apartments": [], "locations": []}
    yield ids


# ---------------------------------------------------------------------------
# 1) SSE endpoint reachability with cookie auth
# ---------------------------------------------------------------------------
class TestSSEEndpoint:
    def test_sse_endpoint_401_without_auth(self):
        r = requests.get(f"{API}/admin/events", stream=True, timeout=5)
        assert r.status_code == 401, f"Expected 401 without auth, got {r.status_code}"
        r.close()

    def test_sse_endpoint_opens_with_cookie(self, demo_session):
        listener = SSEListener(
            f"{API}/admin/events",
            cookies={"access_token": demo_session["cookie"]},
        )
        listener.start()
        try:
            assert listener.ready.is_set(), f"SSE never became ready. err={listener.error}"
            assert listener.status == 200, f"SSE status={listener.status} err={listener.error}"
        finally:
            listener.stop()

    def test_sse_endpoint_opens_with_bearer(self, demo_session):
        listener = SSEListener(
            f"{API}/admin/events",
            headers={"Authorization": f"Bearer {demo_session['token']}"},
        )
        listener.start()
        try:
            assert listener.ready.is_set(), f"SSE ready timeout (bearer). err={listener.error}"
            assert listener.status == 200
        finally:
            listener.stop()


# ---------------------------------------------------------------------------
# 2) Cookie-auth mutation triggers broadcast (THE FIX)
# ---------------------------------------------------------------------------
class TestCookieAuthBroadcast:
    def test_cookie_post_tenant_broadcasts(self, demo_session, created_ids):
        listener = SSEListener(
            f"{API}/admin/events",
            cookies={"access_token": demo_session["cookie"]},
        )
        listener.start()
        assert listener.ready.is_set(), f"SSE not ready. err={listener.error}"
        time.sleep(0.3)

        # Do POST using cookie only (NO Authorization header)
        s = demo_session["session"]
        unique = uuid.uuid4().hex[:8]
        payload = {
            "name": f"TEST_SSECookie_{unique}",
            "email": f"test_sse_cookie_{unique}@example.com",
            "phone": "+5978765432",
        }
        r = s.post(f"{API}/tenants", json=payload, timeout=10)
        assert r.status_code in (200, 201), f"Tenant create failed: {r.status_code} {r.text[:300]}"
        try:
            created_ids["tenants"].append(r.json().get("id"))
        except Exception:
            pass

        ev = listener.wait_for_event(
            lambda e: e.get("type") == "change"
            and e.get("path", "").startswith("/api/tenants")
            and e.get("method") == "POST",
            timeout=6.0,
        )
        listener.stop()
        assert ev is not None, (
            f"No SSE 'change' event received for cookie-auth POST /api/tenants. "
            f"Received: {listener.events}"
        )


# ---------------------------------------------------------------------------
# 3) Bearer-auth mutation still broadcasts (backwards compat)
# ---------------------------------------------------------------------------
class TestBearerAuthBroadcast:
    def test_bearer_post_tenant_broadcasts(self, demo_session, created_ids):
        listener = SSEListener(
            f"{API}/admin/events",
            headers={"Authorization": f"Bearer {demo_session['token']}"},
        )
        listener.start()
        assert listener.ready.is_set(), f"SSE not ready (bearer). err={listener.error}"
        time.sleep(0.3)

        # Fresh session with ONLY Authorization header, no cookie jar
        unique = uuid.uuid4().hex[:8]
        payload = {
            "name": f"TEST_SSEBearer_{unique}",
            "email": f"test_sse_bearer_{unique}@example.com",
            "phone": "+5978765432",
        }
        r = requests.post(
            f"{API}/tenants",
            json=payload,
            headers={"Authorization": f"Bearer {demo_session['token']}"},
            timeout=10,
        )
        assert r.status_code in (200, 201), f"Tenant create bearer failed: {r.status_code} {r.text[:300]}"
        try:
            created_ids["tenants"].append(r.json().get("id"))
        except Exception:
            pass

        ev = listener.wait_for_event(
            lambda e: e.get("type") == "change"
            and e.get("path", "").startswith("/api/tenants")
            and e.get("method") == "POST",
            timeout=6.0,
        )
        listener.stop()
        assert ev is not None, (
            f"No SSE 'change' event received for Bearer POST /api/tenants. "
            f"Received: {listener.events}"
        )


# ---------------------------------------------------------------------------
# 4) Skip paths do NOT broadcast
# ---------------------------------------------------------------------------
class TestSkipPathsNoBroadcast:
    def test_auth_login_does_not_broadcast(self, demo_session):
        """POST /api/auth/login should not emit a 'change' event."""
        listener = SSEListener(
            f"{API}/admin/events",
            cookies={"access_token": demo_session["cookie"]},
        )
        listener.start()
        assert listener.ready.is_set(), f"SSE not ready. err={listener.error}"
        time.sleep(0.3)

        # Trigger a POST on a skip path
        requests.post(
            f"{API}/auth/login",
            json={"email": DEMO_EMAIL, "password": DEMO_PW},
            timeout=10,
        )

        ev = listener.wait_for_event(
            lambda e: e.get("type") == "change" and e.get("path", "").startswith("/api/auth/"),
            timeout=3.0,
        )
        listener.stop()
        assert ev is None, f"Skip path /api/auth/login incorrectly broadcasted: {ev}"


# ---------------------------------------------------------------------------
# 5) Regression smoke test — cookie-auth CRUD still works
# ---------------------------------------------------------------------------
class TestRegressionCookieCRUD:
    def test_list_tenants_cookie(self, demo_session):
        r = demo_session["session"].get(f"{API}/tenants", timeout=10)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_list_apartments_cookie(self, demo_session):
        r = demo_session["session"].get(f"{API}/apartments", timeout=10)
        assert r.status_code == 200

    def test_list_locations_cookie(self, demo_session):
        r = demo_session["session"].get(f"{API}/locations", timeout=10)
        assert r.status_code == 200

    def test_list_invoices_cookie(self, demo_session):
        r = demo_session["session"].get(f"{API}/invoices", timeout=10)
        assert r.status_code in (200, 404)  # 404 acceptable if no invoices resource path

    def test_list_payments_cookie(self, demo_session):
        r = demo_session["session"].get(f"{API}/payments", timeout=10)
        assert r.status_code in (200, 404)


# ---------------------------------------------------------------------------
# Cleanup
# ---------------------------------------------------------------------------
class TestZZZCleanup:
    def test_cleanup_tenants(self, demo_session, created_ids):
        s = demo_session["session"]
        for tid in created_ids["tenants"]:
            if not tid:
                continue
            try:
                s.delete(f"{API}/tenants/{tid}", timeout=10)
            except Exception:
                pass
        # No assertion — best-effort cleanup
