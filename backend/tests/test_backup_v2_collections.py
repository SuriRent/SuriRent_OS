"""Backup v2: nieuwe collecties, sleutels zonder id, geen duplicaten, foto's nooit wissen."""
import os
import uuid

import pytest
import requests
from pymongo import MongoClient

API = open('/app/frontend/.env').read().split('REACT_APP_BACKEND_URL=')[1].split('\n')[0].strip() + '/api'
ENV = dict(l.split('=', 1) for l in open('/app/backend/.env').read().splitlines() if '=' in l)
db = MongoClient(ENV['MONGO_URL'].strip('"'))[ENV['DB_NAME'].strip('"')]
TAG = f"bk-{uuid.uuid4().hex[:8]}"


@pytest.fixture(scope="module")
def auth():
    r = requests.post(f"{API}/auth/login", json={"email": "demo@surirent.sr", "password": "demo1234"}, timeout=30)
    r.raise_for_status()
    tok = r.json().get("token") or r.json().get("access_token")
    h = {"Authorization": f"Bearer {tok}"}
    cid = requests.get(f"{API}/companies/me/backup", headers=h, timeout=60).json()["company_id"]
    return h, cid


@pytest.fixture(scope="module")
def seeded(auth):
    _, cid = auth
    asset_id = f"{TAG}-asset"
    db.landing_assets.insert_one({"id": asset_id, "filename": "x.webp", "content_type": "image/webp", "data_b64": "AAAA", "size": 3})
    db.tenant_notes.insert_one({"id": f"{TAG}-note", "company_id": cid, "text": f"foto /api/landing/asset/{asset_id}"})
    db.fcm_tokens.insert_one({"token": f"{TAG}-tok", "company_id": cid, "user_id": "u1"})
    db.payment_plan_reminders.insert_one({"tenant_id": f"{TAG}-ten", "company_id": cid, "last_sent": "x"})
    db.sent_upcoming_invoice_reminders.insert_one({"invoice_id": f"{TAG}-inv", "company_id": cid, "days_bucket": 3})
    db.sent_trial_warnings.insert_one({"_key": f"{TAG}-trial", "company_id": cid})
    yield asset_id
    for c, q in [("landing_assets", {"id": asset_id}), ("tenant_notes", {"id": f"{TAG}-note"}), ("fcm_tokens", {"token": f"{TAG}-tok"}),
                 ("payment_plan_reminders", {"tenant_id": f"{TAG}-ten"}), ("sent_upcoming_invoice_reminders", {"invoice_id": f"{TAG}-inv"}),
                 ("sent_trial_warnings", {"_key": f"{TAG}-trial"})]:
        db[c].delete_many(q)


def _backup(h):
    r = requests.get(f"{API}/companies/me/backup", headers=h, timeout=60)
    assert r.status_code == 200
    return r.json()


def test_export_contains_new_collections(auth, seeded):
    h, _ = auth
    b = _backup(h)
    assert b["format_version"] == 2
    c = b["collections"]
    for k in ["company_settings", "company_landings", "payment_plans", "payment_plan_installments", "payment_plan_reminders",
              "tenant_notes", "fines", "power_devices", "power_log", "kiosk_pins", "kiosk_printers", "kiosk_id_owners",
              "kiosk_emp_state", "kiosk_stripe_payments", "kiosk_print_log", "kiosk_devices_seen", "bank_statements",
              "audit_log", "notifications", "fcm_tokens", "sent_invoice_reminders", "sent_upcoming_invoice_reminders",
              "sent_trial_warnings", "landing_assets"]:
        assert k in c, k
    assets = [a for a in c["landing_assets"] if a["id"] == seeded]
    assert assets and assets[0]["data_b64"] == "AAAA"
    assert any(t.get("token") == f"{TAG}-tok" for t in c["fcm_tokens"])
    assert any(t.get("_key") == f"{TAG}-trial" for t in c["sent_trial_warnings"])


def test_merge_twice_no_duplicates(auth, seeded):
    h, _ = auth
    b = _backup(h)
    for _ in range(2):
        r = requests.post(f"{API}/companies/me/restore", headers=h, json={"backup": b, "mode": "merge"}, timeout=120)
        assert r.status_code == 200, r.text
    assert db.fcm_tokens.count_documents({"token": f"{TAG}-tok"}) == 1
    assert db.payment_plan_reminders.count_documents({"tenant_id": f"{TAG}-ten"}) == 1
    assert db.sent_upcoming_invoice_reminders.count_documents({"invoice_id": f"{TAG}-inv", "days_bucket": 3}) == 1
    assert db.sent_trial_warnings.count_documents({"_key": f"{TAG}-trial"}) == 1
    assert db.landing_assets.count_documents({"id": seeded}) == 1


def test_replace_restores_and_keeps_assets(auth, seeded):
    h, cid = auth
    b = _backup(h)
    before = {k: len(v) for k, v in b["collections"].items()}
    r = requests.post(f"{API}/companies/me/restore", headers=h, json={"backup": b, "mode": "replace"}, timeout=180)
    assert r.status_code == 200, r.text
    s = r.json()["collections"]
    assert "landing_assets" not in s or s["landing_assets"]["deleted"] == 0
    assert db.landing_assets.count_documents({"id": seeded}) == 1
    after = _backup(h)["collections"]
    for k in ["tenants", "tenant_notes", "sent_trial_warnings", "sent_upcoming_invoice_reminders", "fcm_tokens", "payment_plan_reminders"]:
        assert len(after[k]) == before[k], k


def test_v1_backup_still_accepted(auth):
    h, _ = auth
    b = _backup(h)
    v1 = {"format_version": 1, "company_id": b["company_id"], "collections": {"tenants": b["collections"]["tenants"]}}
    r = requests.post(f"{API}/companies/me/restore", headers=h, json={"backup": v1, "mode": "merge"}, timeout=60)
    assert r.status_code == 200, r.text
