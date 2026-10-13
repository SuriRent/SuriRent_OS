"""Iter 76 — Facturen pagination/caching backend tests.

Covers:
- GET /api/invoices still returns required fields (tenant_name, apartment_number, etc.)
- GET /api/tenants returns apartment_number, rent_amount, currency
- GET /api/invoices/grouped with offset/limit/tab/severity/q filters + summary
- Cache invalidation after create/delete invoice
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": "demo@surirent.sr", "password": "demo1234"},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def session(admin_token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"})
    return s


# --- /api/invoices response shape ---------------------------------------
def test_list_invoices_shape(session):
    r = session.get(f"{BASE_URL}/api/invoices", timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    assert isinstance(data, list)
    assert len(data) > 0, "expected seeded perf test invoices"
    sample = data[0]
    for k in ("tenant_name", "apartment_number", "location_name", "paid_amount",
              "remaining_amount", "plans", "status"):
        assert k in sample, f"missing field {k}"
    assert isinstance(sample["plans"], list)
    # 'bucket' present on unpaid invoices
    unpaid = [i for i in data if (i.get("status") or "") != "paid"]
    if unpaid:
        assert "bucket" in unpaid[0]


# --- /api/tenants response shape ----------------------------------------
def test_list_tenants_shape(session):
    r = session.get(f"{BASE_URL}/api/tenants", timeout=30)
    assert r.status_code == 200, r.text
    tenants = r.json()
    assert isinstance(tenants, list) and tenants
    # at least one should have apartment info populated
    with_apt = [t for t in tenants if t.get("apartment_number")]
    assert with_apt, "no tenants with apartment_number"
    t = with_apt[0]
    assert "rent_amount" in t
    assert "currency" in t


# --- /api/invoices/grouped — paging + summary ---------------------------
def test_grouped_default_page(session):
    r = session.get(f"{BASE_URL}/api/invoices/grouped", timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    for k in ("tenant_ids", "invoices", "total", "offset", "has_more", "summary"):
        assert k in body
    assert body["offset"] == 0
    assert len(body["tenant_ids"]) <= 25
    # with seeded 40+ tenants we should have >= 25 total and has_more True
    assert body["total"] >= 25
    assert body["has_more"] is True
    s = body["summary"]
    for k in ("allCount", "openCount", "paidCount", "totalOpenAmount",
              "currency", "totalOpenMonths", "thisMonthExpected", "hasInvoices"):
        assert k in s
    assert s["allCount"] == body["total"] or s["allCount"] >= body["total"]
    assert s["hasInvoices"] is True


def test_grouped_second_page(session):
    r = session.get(f"{BASE_URL}/api/invoices/grouped?offset=25&limit=25", timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["offset"] == 25
    assert len(body["tenant_ids"]) >= 1  # 45 total => 20 on page 2
    # No overlap with first page
    r1 = session.get(f"{BASE_URL}/api/invoices/grouped?offset=0&limit=25", timeout=30).json()
    assert set(r1["tenant_ids"]).isdisjoint(set(body["tenant_ids"]))


def test_grouped_tab_open_paid(session):
    r_all = session.get(f"{BASE_URL}/api/invoices/grouped?tab=all&limit=100", timeout=30).json()
    r_open = session.get(f"{BASE_URL}/api/invoices/grouped?tab=open&limit=100", timeout=30).json()
    r_paid = session.get(f"{BASE_URL}/api/invoices/grouped?tab=paid&limit=100", timeout=30).json()
    # summary should be independent of tab
    assert r_all["summary"]["allCount"] == r_open["summary"]["allCount"] == r_paid["summary"]["allCount"]
    # tab=open total <= allCount, tab=paid total <= allCount
    assert r_open["total"] <= r_all["summary"]["allCount"]
    assert r_paid["total"] <= r_all["summary"]["allCount"]
    assert r_open["total"] + r_paid["total"] <= r_all["summary"]["allCount"]


def test_grouped_search_finds_tenant_outside_first_page(session):
    # Testhuurder 39 should be in seed and not necessarily on page 1
    r = session.get(f"{BASE_URL}/api/invoices/grouped?q=Testhuurder%2039&limit=25", timeout=30).json()
    assert r["total"] >= 1
    # Must appear somewhere in invoices list
    names = {i.get("tenant_name") for i in r["invoices"]}
    assert any("Testhuurder 39" in (n or "") for n in names), f"names={names}"


# --- Cache invalidation --------------------------------------------------
def test_cache_invalidation_on_create_and_delete(session):
    # pick a Testhuurder with existing invoices to add a new unique-period one.
    tenants = session.get(f"{BASE_URL}/api/tenants", timeout=30).json()
    target = next(
        (t for t in tenants if t.get("apartment_id")),
        None,
    )
    if not target:
        pytest.skip("No Testhuurder seeded")
    tid = target["id"]
    # Snapshot invoices count before
    before = session.get(f"{BASE_URL}/api/invoices", timeout=30).json()
    before_ids = {i["id"] for i in before if i["tenant_id"] == tid}

    # Find a period that's not yet used — go a few years forward
    used = {(i.get("period_year"), i.get("period_month")) for i in before if i["tenant_id"] == tid}
    period = None
    for y in (2030, 2031, 2032):
        for m in range(1, 13):
            if (y, m) not in used:
                period = (y, m)
                break
        if period:
            break
    assert period
    created = session.post(
        f"{BASE_URL}/api/invoices",
        json={"tenant_id": tid, "period_month": period[1], "period_year": period[0]},
        timeout=30,
    )
    assert created.status_code == 200, created.text
    new_id = created.json()["id"]

    # Immediate GET must reflect new invoice (cache cleared)
    after = session.get(f"{BASE_URL}/api/invoices", timeout=30).json()
    after_ids = {i["id"] for i in after if i["tenant_id"] == tid}
    assert new_id in after_ids, "Cache not invalidated after create"

    # Grouped endpoint must also see it immediately
    g = session.get(f"{BASE_URL}/api/invoices/grouped?tenant_id={tid}&limit=25", timeout=30).json()
    assert any(i["id"] == new_id for i in g["invoices"]), "Grouped cache not invalidated after create"

    # Delete and re-check
    d = session.delete(f"{BASE_URL}/api/invoices/{new_id}", timeout=30)
    assert d.status_code in (200, 204), d.text
    after2 = session.get(f"{BASE_URL}/api/invoices", timeout=30).json()
    after2_ids = {i["id"] for i in after2 if i["tenant_id"] == tid}
    assert new_id not in after2_ids, "Cache not invalidated after delete"
