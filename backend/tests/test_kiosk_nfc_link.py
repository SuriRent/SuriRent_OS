# Kiosk NFC-tag lookup/link + admin nfc-card endpoints (iter102)
import json
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")

TAG = "04PYTEST9911"


def tenant_tag(admin, tid):
    lst = admin.get(f"{BASE_URL}/api/tenants").json()
    return next(t for t in lst if t["id"] == tid).get("nfc_card_id")


@pytest.fixture(scope="module")
def ctx():
    with open("/tmp/iter85_ctx.json") as f:
        return json.load(f)


@pytest.fixture(scope="module")
def kiosk(ctx):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {ctx['kiosk_token']}"})
    return s


@pytest.fixture(scope="module")
def admin(ctx):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {ctx['admin_token']}"})
    return s


@pytest.fixture(scope="module")
def two_tenants(kiosk, admin):
    apts = kiosk.get(f"{BASE_URL}/api/kiosk/apartments").json()
    with_t = [a for a in apts if a.get("tenant_id")]
    assert len(with_t) >= 2
    a, b = with_t[0], with_t[1]
    # remember previous tags for restore
    prev = {}
    for x in (a, b):
        prev[x["tenant_id"]] = tenant_tag(admin, x['tenant_id'])
    yield a, b
    for tid, v in prev.items():
        admin.put(f"{BASE_URL}/api/admin/tenants/{tid}/nfc-card", json={"card_id": v or ""})


class TestKioskNfc:
    def test_lookup_unknown_normalized(self, kiosk):
        r = kiosk.post(f"{BASE_URL}/api/kiosk/nfc-lookup", json={"card_id": "04:py-test:99 11".lower()})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["found"] is False
        assert d["card_id"] == TAG

    def test_lookup_short_422(self, kiosk):
        assert kiosk.post(f"{BASE_URL}/api/kiosk/nfc-lookup", json={"card_id": "ab"}).status_code == 422
        assert kiosk.post(f"{BASE_URL}/api/kiosk/nfc-lookup", json={"card_id": "::--::"}).status_code == 422

    def test_link_requires_kiosk_auth(self):
        r = requests.post(f"{BASE_URL}/api/kiosk/nfc-link", json={"card_id": TAG, "tenant_id": "x"})
        assert r.status_code in (401, 403)

    def test_link_invalid_tenant_404(self, kiosk):
        r = kiosk.post(f"{BASE_URL}/api/kiosk/nfc-link", json={"card_id": TAG, "tenant_id": "nope-xyz"})
        assert r.status_code == 404

    def test_link_lookup_clash_replace(self, kiosk, admin, two_tenants):
        a, b = two_tenants
        r = kiosk.post(f"{BASE_URL}/api/kiosk/nfc-link", json={"card_id": TAG.lower(), "tenant_id": a["tenant_id"]})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["found"] is True and d["tenant"]["id"] == a["tenant_id"]
        assert d["apartment"]["tenant_id"] == a["tenant_id"]
        assert set(a.keys()) <= set(d["apartment"].keys()), set(a.keys()) - set(d["apartment"].keys())
        # lookup (lowercase) finds it
        lk = kiosk.post(f"{BASE_URL}/api/kiosk/nfc-lookup", json={"card_id": TAG.lower()}).json()
        assert lk["found"] is True and lk["tenant"]["id"] == a["tenant_id"]
        # admin GET tenant shows it
        assert tenant_tag(admin, a['tenant_id']) == TAG
        # re-link same tenant ok (idempotent)
        assert kiosk.post(f"{BASE_URL}/api/kiosk/nfc-link", json={"card_id": TAG, "tenant_id": a["tenant_id"]}).status_code == 200
        # clash
        c = kiosk.post(f"{BASE_URL}/api/kiosk/nfc-link", json={"card_id": TAG, "tenant_id": b["tenant_id"]})
        assert c.status_code == 409
        assert "al gekoppeld aan" in c.json()["detail"]
        # replace
        rp = kiosk.post(f"{BASE_URL}/api/kiosk/nfc-link", json={"card_id": TAG, "tenant_id": b["tenant_id"], "replace": True})
        assert rp.status_code == 200 and rp.json()["tenant"]["id"] == b["tenant_id"]
        assert tenant_tag(admin, a['tenant_id']) in (None, "")
        assert tenant_tag(admin, b['tenant_id']) == TAG

    def test_admin_put_and_clear(self, kiosk, admin, two_tenants):
        a, b = two_tenants
        # clash via admin (TAG currently on b, or set it)
        admin.put(f"{BASE_URL}/api/admin/tenants/{b['tenant_id']}/nfc-card", json={"card_id": TAG})
        r = admin.put(f"{BASE_URL}/api/admin/tenants/{a['tenant_id']}/nfc-card", json={"card_id": TAG})
        assert r.status_code == 409
        r = admin.put(f"{BASE_URL}/api/admin/tenants/{a['tenant_id']}/nfc-card", json={"card_id": "04pyadm77"})
        assert r.status_code == 200 and r.json()["nfc_card_id"] == "04PYADM77"
        assert tenant_tag(admin, a['tenant_id']) == "04PYADM77"
        assert kiosk.post(f"{BASE_URL}/api/kiosk/nfc-lookup", json={"card_id": "04PYADM77"}).json()["tenant"]["id"] == a["tenant_id"]
        r = admin.put(f"{BASE_URL}/api/admin/tenants/{a['tenant_id']}/nfc-card", json={"card_id": ""})
        assert r.status_code == 200
        assert tenant_tag(admin, a['tenant_id']) in (None, "")
        assert kiosk.post(f"{BASE_URL}/api/kiosk/nfc-lookup", json={"card_id": "04PYADM77"}).json()["found"] is False
        admin.put(f"{BASE_URL}/api/admin/tenants/{b['tenant_id']}/nfc-card", json={"card_id": ""})

    def test_cross_company_scope(self, kiosk):
        # superadmin-created other company tags aren't visible; simple sanity: tenant from other company → 404
        sa = requests.post(f"{BASE_URL}/api/auth/login", json={"email": "super@surirent.sr", "password": "super1234"})
        if sa.status_code != 200:
            pytest.skip("no superadmin")
        from pymongo import MongoClient
        db = MongoClient("mongodb://localhost:27017")["vastgoed_kiosk"]
        other = db.tenants.find_one({"company_id": {"$ne": "demo-company-fixed-uuid-00000000000"}}, {"_id": 0, "id": 1})
        if not other:
            pytest.skip("no other-company tenant")
        r = kiosk.post(f"{BASE_URL}/api/kiosk/nfc-link", json={"card_id": TAG, "tenant_id": other["id"]})
        assert r.status_code == 404
