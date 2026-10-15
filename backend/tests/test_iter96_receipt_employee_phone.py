"""Iter96 — Receipt-print data moet nu de kiosk-medewerker en het telefoonnummer
van de huurder tonen. Zie review-request iter96."""
import os
import time
import uuid
import json
from pathlib import Path

import pytest
import requests
from pymongo import MongoClient

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
SLUG = "my-awesome-rentals-bv"
COMPANY_ID = "demo-company-fixed-uuid-00000000000"


# ---------- Fixtures ----------

@pytest.fixture(scope="module")
def ctx():
    """Herbruik seed uit setup_iter85.py als die aanwezig is."""
    p = Path("/tmp/iter85_ctx.json")
    assert p.exists(), "Run setup_iter85.py first"
    return json.loads(p.read_text())


@pytest.fixture(scope="module")
def db():
    c = MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
    return c[os.environ.get("DB_NAME", "vastgoed_kiosk")]


@pytest.fixture(scope="module")
def admin_session(ctx):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {ctx['admin_token']}"})
    return s


@pytest.fixture(scope="module")
def kiosk_session(ctx):
    s = requests.Session()
    s.cookies.set("kiosk_token", ctx["kiosk_token"])
    return s


@pytest.fixture(scope="module")
def seeded_payment(ctx, db):
    """Koppel test-betaling aan een bestaande tenant met een telefoonnummer,
    zodat _enrich_payment() het nummer uit db.tenants kan lezen."""
    pid = ctx["payment_id"]
    tenant = db.tenants.find_one(
        {"company_id": COMPANY_ID, "phone": {"$exists": True, "$ne": ""}},
        {"_id": 0, "id": 1, "name": 1, "phone": 1},
    )
    assert tenant, "need a tenant with phone in demo seed"
    db.payments.update_one(
        {"id": pid},
        {"$set": {"tenant_id": tenant["id"],
                  "tenant_name": tenant["name"],
                  "kiosk_employee_name": "Anita Sewdas"}}
    )
    # expose expected phone to tests
    return {"pid": pid, "phone": tenant["phone"], "name": tenant["name"]}


# ---------- Tests ----------

class TestKioskPrintData:
    """GET /api/kiosk/payments/{id}/print-data"""

    def test_contains_medewerker_and_huurder_telefoon(self, kiosk_session, seeded_payment):
        r = kiosk_session.get(f"{BASE}/api/kiosk/payments/{seeded_payment['pid']}/print-data")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("medewerker") == "Anita Sewdas"
        assert d.get("huurder_telefoon") == seeded_payment["phone"]

    def test_lines_contain_tel_row_under_tenant(self, kiosk_session, seeded_payment):
        r = kiosk_session.get(f"{BASE}/api/kiosk/payments/{seeded_payment['pid']}/print-data")
        d = r.json()
        texts = [l["text"] for l in d["lines"]]
        idx_huurder = texts.index("HUURDER:")
        tel_rows = [t for t in texts[idx_huurder:idx_huurder + 6] if t.startswith("Tel:")]
        assert tel_rows, f"Expected Tel: row near HUURDER, got {texts[idx_huurder:idx_huurder+6]}"
        assert seeded_payment["phone"] in tel_rows[0]

    def test_lines_contain_ontvangen_door(self, kiosk_session, seeded_payment):
        r = kiosk_session.get(f"{BASE}/api/kiosk/payments/{seeded_payment['pid']}/print-data")
        d = r.json()
        texts = [l["text"] for l in d["lines"]]
        hits = [t for t in texts if t.startswith("Ontvangen door:")]
        assert hits, f"Expected 'Ontvangen door:' line, got: {texts}"
        assert "Anita Sewdas" in hits[0]

    def test_width_is_32_cols_for_58mm(self, kiosk_session, seeded_payment):
        r = kiosk_session.get(f"{BASE}/api/kiosk/payments/{seeded_payment['pid']}/print-data")
        d = r.json()
        line = next(l for l in d["lines"] if l["text"].startswith("Ontvangen door:"))
        assert len(line["text"]) == 32, f"expected 32 cols, got {len(line['text'])}: {line['text']!r}"

    def test_lines_contain_dash_width_32(self, kiosk_session, seeded_payment):
        r = kiosk_session.get(f"{BASE}/api/kiosk/payments/{seeded_payment['pid']}/print-data")
        d = r.json()
        # alleen echte scheidingslijnen (lang) tellen; "-" fallback voor lege naam telt niet.
        dashes = [l["text"] for l in d["lines"] if set(l["text"]) == {"-"} and len(l["text"]) > 1]
        assert dashes, "no separator lines"
        assert all(len(x) == 32 for x in dashes), [len(x) for x in dashes]


class TestKioskPrintData80mm:
    """Zelfde endpoint, maar met 80mm printer-config → 48 cols."""

    @pytest.fixture
    def switch_to_80mm(self, admin_session, db):
        prev = db.company_settings.find_one({"company_id": COMPANY_ID}) or {}
        prev_kd = (prev.get("kiosk_devices") or {}).copy()
        db.company_settings.update_one(
            {"company_id": COMPANY_ID},
            {"$set": {"kiosk_devices.printer_mode": "bluetooth",
                      "kiosk_devices.paper_width": "80"}},
            upsert=True,
        )
        yield
        if prev_kd:
            db.company_settings.update_one(
                {"company_id": COMPANY_ID},
                {"$set": {"kiosk_devices": prev_kd}},
            )
        else:
            db.company_settings.update_one(
                {"company_id": COMPANY_ID},
                {"$unset": {"kiosk_devices.paper_width": "", "kiosk_devices.printer": ""}},
            )

    def test_80mm_uses_48_cols(self, kiosk_session, seeded_payment, switch_to_80mm):
        r = kiosk_session.get(f"{BASE}/api/kiosk/payments/{seeded_payment['pid']}/print-data")
        d = r.json()
        assert d.get("paper_width") == 80
        line = next(l for l in d["lines"] if l["text"].startswith("Ontvangen door:"))
        assert len(line["text"]) == 48, f"expected 48 cols, got {len(line['text'])}: {line['text']!r}"


class TestPrintHtmlThermal:
    """GET /api/payments/{id}/print.html?format=thermal&preview=1"""

    def test_html_contains_tel_and_ontvangen_door(self, admin_session, seeded_payment):
        r = admin_session.get(
            f"{BASE}/api/payments/{seeded_payment['pid']}/print.html",
            params={"format": "thermal", "preview": 1},
        )
        assert r.status_code == 200, r.text
        html = r.text
        assert "TEL." in html, "missing TEL. row"
        assert seeded_payment["phone"] in html
        assert "ONTVANGEN DOOR" in html, "missing ONTVANGEN DOOR row"
        assert "Anita Sewdas" in html


class TestEmployeeFallback:
    """medewerker valt terug op received_by als kiosk_employee_name leeg is.
    (tenant_phone wordt alleen via de tenant-tabel geladen door _enrich_payment,
    dus bij een losse insert zonder tenant_id blijft die leeg — getest in de
    kern-TestKioskPrintData flow.)"""

    def test_fallback_to_received_by(self, kiosk_session, db, ctx):
        pid = "TEST_" + str(uuid.uuid4())
        db.payments.insert_one({
            "id": pid, "company_id": COMPANY_ID,
            "tenant_name": "TEST Fallback",
            "receipt_number": "TEST-FB-" + uuid.uuid4().hex[:6].upper(),
            "amount": 1, "currency": "SRD", "status": "approved", "method": "cash",
            "created_at": time.time(),
            "received_by": "Fallback Jan",
            # bewust GEEN kiosk_employee_name
        })
        try:
            r = kiosk_session.get(f"{BASE}/api/kiosk/payments/{pid}/print-data")
            assert r.status_code == 200, r.text
            d = r.json()
            assert d["medewerker"] == "Fallback Jan"
        finally:
            db.payments.delete_one({"id": pid})
