"""Iteratie 57 — Live-sync SSE broadcast over alle admin CRUD modules.

Verifieert dat de `_live_sync_broadcast` HTTP middleware voor elke geslaagde
non-GET mutatie op /api/* een `{"type":"change","path":...,"method":...}`
event naar de SSE-stream (/api/admin/events) van dezelfde company pusht.

Modules gedekt: companies (branding/profile), locations, apartments, tenants,
contracts, invoices, payments, settings (smtp/invoicing).

Sync implementatie (requests + thread) omdat pytest-asyncio niet geïnstalleerd
is in deze omgeving.
"""
import json
import os
import threading
import time
import uuid
from datetime import datetime, timezone

import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")

BASE = (os.environ.get("REACT_APP_BACKEND_URL") or "").rstrip("/")
assert BASE, "REACT_APP_BACKEND_URL is required"
API = f"{BASE}/api"

DEMO_EMAIL = os.environ.get("TEST_DEMO_EMAIL", "demo@surirent.sr")
DEMO_PASSWORD = os.environ.get("TEST_DEMO_PASSWORD", "demo1234")

TAG = f"TEST_LS_{uuid.uuid4().hex[:6]}"


# ---------------------------------------------------------------- fixtures
@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login",
                      json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD}, timeout=30)
    if r.status_code != 200:
        pytest.fail(f"Login demo admin faalde: {r.status_code} {r.text[:300]}")
    tok = r.json().get("token")
    assert isinstance(tok, str) and tok, "login response mist token"
    return tok


@pytest.fixture(scope="module")
def client(token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {token}",
                      "Content-Type": "application/json"})
    return s


class SSEListener:
    """Leest /api/admin/events in een achtergrond-thread."""

    def __init__(self, token):
        self.token = token
        self.events = []
        self.ready = threading.Event()
        self._stop = threading.Event()
        self._t = threading.Thread(target=self._run, daemon=True)

    def _run(self):
        try:
            with requests.get(f"{API}/admin/events?token={self.token}",
                              stream=True, timeout=120,
                              headers={"Accept": "text/event-stream"}) as resp:
                if resp.status_code != 200:
                    self.events.append({"type": "_http_error",
                                        "status": resp.status_code})
                    self.ready.set()
                    return
                for raw in resp.iter_lines(decode_unicode=True):
                    if self._stop.is_set():
                        break
                    if raw is None:
                        continue
                    line = raw.strip()
                    if line.startswith("event: ready"):
                        self.ready.set()
                    if line.startswith("data:"):
                        body = line[5:].strip()
                        if not body:
                            continue
                        try:
                            self.events.append(json.loads(body))
                        except json.JSONDecodeError:
                            self.ready.set()
        except Exception as e:  # noqa: BLE001
            self.events.append({"type": "_exception", "error": str(e)})
            self.ready.set()

    def start(self):
        self._t.start()
        self.ready.wait(timeout=20)
        time.sleep(1.0)

    def stop(self):
        self._stop.set()

    def wait_for_path(self, path, method, timeout=8.0):
        deadline = time.time() + timeout
        while time.time() < deadline:
            for e in self.events:
                if (e.get("type") == "change" and e.get("path") == path
                        and (e.get("method") or "").upper() == method.upper()):
                    return e
            time.sleep(0.25)
        return None


@pytest.fixture(scope="module")
def sse(token):
    listener = SSEListener(token)
    listener.start()
    yield listener
    listener.stop()


@pytest.fixture(scope="module")
def created(client):
    """Houdt aangemaakte test-resources bij en ruimt ze op."""
    bucket = {"payments": [], "invoices": [], "contracts": [],
              "tenants": [], "apartments": [], "locations": []}
    yield bucket
    for coll in ["payments", "invoices", "contracts", "tenants",
                 "apartments", "locations"]:
        for rid in bucket[coll]:
            try:
                client.delete(f"{API}/{coll}/{rid}", timeout=30)
            except Exception:  # noqa: BLE001
                pass


# ---------------------------------------------------------------- tests
class TestSSEConnection:
    """SSE stream availability"""

    def test_sse_stream_connects(self, sse):
        assert sse.ready.is_set(), "SSE stream stuurde geen ready handshake"
        errs = [e for e in sse.events if e.get("type") in ("_http_error", "_exception")]
        assert not errs, f"SSE stream fout: {errs}"


class TestCompanyMutations:
    """PUT /api/companies/me/branding + /profile"""

    def test_branding_put_broadcasts(self, client, sse):
        cur = client.get(f"{API}/companies/me/branding", timeout=30)
        assert cur.status_code == 200, cur.text[:300]
        original = cur.json()
        r = client.put(f"{API}/companies/me/branding",
                       json={"tagline": f"{TAG} tagline"}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        evt = sse.wait_for_path("/api/companies/me/branding", "PUT")
        # restore
        client.put(f"{API}/companies/me/branding",
                   json={"tagline": original.get("tagline") or ""}, timeout=30)
        assert evt is not None, "geen SSE change-event voor branding PUT"

    def test_profile_put_broadcasts(self, client, sse):
        cur = client.get(f"{API}/companies/me/branding", timeout=30)
        assert cur.status_code == 200, cur.text[:300]
        original_name = cur.json().get("name")
        assert original_name
        r = client.put(f"{API}/companies/me/profile",
                       json={"name": f"{original_name}"}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        evt = sse.wait_for_path("/api/companies/me/profile", "PUT")
        assert evt is not None, "geen SSE change-event voor profile PUT"


class TestCrudMutations:
    """Locations → apartments → tenants → contracts → invoices → payments"""

    def test_create_location_broadcasts(self, client, sse, created):
        r = client.post(f"{API}/locations",
                        json={"name": f"{TAG} Locatie", "address": "Teststraat 1"},
                        timeout=30)
        if r.status_code == 403 and "plan_limit_reached" in r.text:
            # Demo-plan staat max. 2 locaties toe; POST kan hier niet getest
            # worden. PUT-test hieronder dekt de locations-broadcast.
            pytest.skip("plan_limit_reached voor locaties op demo-account")
        assert r.status_code in (200, 201), r.text[:300]
        loc = r.json()
        assert loc.get("name") == f"{TAG} Locatie"
        created["locations"].append(loc["id"])
        assert sse.wait_for_path("/api/locations", "POST") is not None, \
            "geen SSE event voor POST /api/locations"

    def test_update_location_broadcasts(self, client, sse, created):
        if created["locations"]:
            loc_id = created["locations"][0]
            original = {"name": f"{TAG} Locatie", "address": "Teststraat 1"}
        else:
            g = client.get(f"{API}/locations", timeout=30)
            assert g.status_code == 200 and g.json(), "geen locaties beschikbaar"
            existing = g.json()[0]
            loc_id = existing["id"]
            original = {"name": existing["name"],
                        "address": existing.get("address") or "",
                        "photo_url": existing.get("photo_url") or ""}
        r = client.put(f"{API}/locations/{loc_id}",
                       json={**original, "name": f"{TAG} Locatie B"}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        assert r.json()["name"] == f"{TAG} Locatie B"
        # verify persistence
        g = client.get(f"{API}/locations", timeout=30)
        assert g.status_code == 200
        assert any(x["id"] == loc_id and x["name"] == f"{TAG} Locatie B"
                   for x in g.json())
        evt = sse.wait_for_path(f"/api/locations/{loc_id}", "PUT")
        # restore original naam
        client.put(f"{API}/locations/{loc_id}", json=original, timeout=30)
        assert evt is not None, "geen SSE event voor PUT /api/locations/{id}"

    def test_create_apartment_broadcasts(self, client, sse, created):
        r = client.post(f"{API}/apartments",
                        json={"number": f"{TAG}-A1", "rent_amount": 1000,
                              "currency": "SRD"}, timeout=30)
        assert r.status_code in (200, 201), r.text[:300]
        apt = r.json()
        assert apt["number"] == f"{TAG}-A1"
        assert apt["status"] == "vacant"
        created["apartments"].append(apt["id"])
        assert sse.wait_for_path("/api/apartments", "POST") is not None, \
            "geen SSE event voor POST /api/apartments"

    def test_update_apartment_broadcasts(self, client, sse, created):
        apt_id = created["apartments"][0]
        r = client.put(f"{API}/apartments/{apt_id}",
                       json={"number": f"{TAG}-A1", "rent_amount": 1250,
                             "currency": "SRD"}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        assert r.json()["rent_amount"] == 1250
        assert sse.wait_for_path(f"/api/apartments/{apt_id}", "PUT") is not None, \
            "geen SSE event voor PUT /api/apartments/{id}"

    def test_create_tenant_broadcasts(self, client, sse, created):
        r = client.post(f"{API}/tenants",
                        json={"name": f"{TAG} Huurder",
                              "phone": "+597 8000001",
                              "email": f"{TAG.lower()}@test.sr",
                              "apartment_id": created["apartments"][0]}, timeout=30)
        assert r.status_code in (200, 201), r.text[:300]
        t = r.json()
        assert t["name"] == f"{TAG} Huurder"
        created["tenants"].append(t["id"])
        assert sse.wait_for_path("/api/tenants", "POST") is not None, \
            "geen SSE event voor POST /api/tenants"

    def test_update_tenant_broadcasts(self, client, sse, created):
        tid = created["tenants"][0]
        r = client.put(f"{API}/tenants/{tid}",
                       json={"name": f"{TAG} Huurder B", "phone": "+597 8000002",
                             "email": f"{TAG.lower()}@test.sr",
                             "apartment_id": created["apartments"][0]}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        assert r.json()["name"] == f"{TAG} Huurder B"
        assert sse.wait_for_path(f"/api/tenants/{tid}", "PUT") is not None, \
            "geen SSE event voor PUT /api/tenants/{id}"

    def test_create_contract_broadcasts(self, client, sse, created):
        r = client.post(f"{API}/contracts",
                        json={"tenant_id": created["tenants"][0],
                              "apartment_id": created["apartments"][0],
                              "start_date": "2026-07-01",
                              "payment_day": 1, "deposit_amount": 500},
                        timeout=30)
        assert r.status_code in (200, 201), r.text[:300]
        c = r.json()
        created["contracts"].append(c["id"])
        assert c["tenant_id"] == created["tenants"][0]
        assert sse.wait_for_path("/api/contracts", "POST") is not None, \
            "geen SSE event voor POST /api/contracts"

    def test_create_invoice_broadcasts(self, client, sse, created):
        now = datetime.now(timezone.utc)
        r = client.post(f"{API}/invoices",
                        json={"tenant_id": created["tenants"][0],
                              "period_month": now.month, "period_year": now.year},
                        timeout=30)
        assert r.status_code in (200, 201), r.text[:300]
        inv = r.json()
        created["invoices"].append(inv["id"])
        assert inv["tenant_id"] == created["tenants"][0]
        assert sse.wait_for_path("/api/invoices", "POST") is not None, \
            "geen SSE event voor POST /api/invoices"

    def test_create_payment_broadcasts(self, client, sse, created):
        r = client.post(f"{API}/payments",
                        json={"tenant_id": created["tenants"][0],
                              "apartment_id": created["apartments"][0],
                              "amount": 100, "currency": "SRD",
                              "method": "contant", "category": "huur",
                              "note": TAG}, timeout=30)
        assert r.status_code in (200, 201), r.text[:300]
        p = r.json()
        created["payments"].append(p["id"])
        assert float(p["amount"]) == 100.0
        assert sse.wait_for_path("/api/payments", "POST") is not None, \
            "geen SSE event voor POST /api/payments"


class TestSettingsMutations:
    """PUT /api/settings/{section}"""

    def test_settings_smtp_broadcasts(self, client, sse):
        cur = client.get(f"{API}/settings", timeout=30)
        assert cur.status_code == 200, cur.text[:300]
        existing = (cur.json() or {}).get("smtp") or {}
        r = client.put(f"{API}/settings/smtp",
                       json={"from_name": existing.get("from_name") or "SuriRent"},
                       timeout=30)
        assert r.status_code == 200, r.text[:300]
        assert r.json().get("section") == "smtp"
        assert sse.wait_for_path("/api/settings/smtp", "PUT") is not None, \
            "geen SSE event voor PUT /api/settings/smtp"

    def test_settings_invoicing_broadcasts(self, client, sse):
        cur = client.get(f"{API}/settings", timeout=30)
        existing = (cur.json() or {}).get("invoicing") or {}
        payload = {k: v for k, v in existing.items()} or {"due_days": 7}
        r = client.put(f"{API}/settings/invoicing", json=payload, timeout=30)
        assert r.status_code == 200, r.text[:300]
        assert r.json().get("section") == "invoicing"
        assert sse.wait_for_path("/api/settings/invoicing", "PUT") is not None, \
            "geen SSE event voor PUT /api/settings/invoicing"


class TestBroadcastHygiene:
    """GET-requests en auth-routes mogen geen change-event triggeren."""

    def test_get_requests_do_not_broadcast(self, client, sse):
        before = len([e for e in sse.events if e.get("type") == "change"])
        for _ in range(3):
            client.get(f"{API}/tenants", timeout=30)
            client.get(f"{API}/apartments", timeout=30)
        time.sleep(2.0)
        after = len([e for e in sse.events if e.get("type") == "change"])
        assert after == before, "GET request veroorzaakte een change-event"

    def test_failed_mutation_does_not_broadcast(self, client, sse):
        before = len([e for e in sse.events if e.get("type") == "change"])
        r = client.put(f"{API}/tenants/nonexistent-id-xyz",
                       json={"name": "x"}, timeout=30)
        assert r.status_code >= 400
        time.sleep(2.0)
        after = len([e for e in sse.events if e.get("type") == "change"])
        assert after == before, "mislukte mutatie (>=400) veroorzaakte change-event"
