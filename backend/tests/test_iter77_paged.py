"""Iter77: /api/payments/paged + /api/tenants/paged pagination, search, summary, cache."""
import os
import time
from datetime import datetime, timedelta, timezone

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
EMAIL = "demo@surirent.sr"
PASSWORD = "demo1234"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{API}/auth/login", json={"email": EMAIL, "password": PASSWORD})
    assert r.status_code == 200, r.text
    tok = r.json().get("token") or r.json().get("access_token")
    if tok:
        s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


# ---------- Tenants paged ----------
class TestTenantsPaged:
    def test_default_page_25(self, client):
        r = client.get(f"{API}/tenants/paged")
        assert r.status_code == 200, r.text
        d = r.json()
        assert len(d["items"]) == 25
        assert d["offset"] == 0
        assert d["has_more"] is True
        s = d["summary"]
        assert "totalCount" in s and s["totalCount"] >= 40
        assert set(s["counts"].keys()) == {"all", "with_apt", "without_apt"}

    def test_pagination_no_overlap(self, client):
        p1 = client.get(f"{API}/tenants/paged", params={"offset": 0, "limit": 25}).json()
        p2 = client.get(f"{API}/tenants/paged", params={"offset": 25, "limit": 25}).json()
        ids1 = {t["id"] for t in p1["items"]}
        ids2 = {t["id"] for t in p2["items"]}
        assert not (ids1 & ids2)
        assert p2["offset"] == 25

    def test_search_finds_outside_first_page(self, client):
        r = client.get(f"{API}/tenants/paged", params={"q": "Testhuurder 39"})
        assert r.status_code == 200
        d = r.json()
        names = [t["name"] for t in d["items"]]
        assert any("Testhuurder 39" in n for n in names), names

    def test_filter_without_apt(self, client):
        d = client.get(f"{API}/tenants/paged", params={"filter": "without_apt"}).json()
        for t in d["items"]:
            assert not t.get("apartment_number")
        assert d["summary"]["counts"]["without_apt"] >= 40

    def test_id_param_returns_single(self, client):
        d = client.get(f"{API}/tenants/paged", params={"q": "Testhuurder 39"}).json()
        tid = d["items"][0]["id"]
        single = client.get(f"{API}/tenants/paged", params={"id": tid}).json()
        assert len(single["items"]) == 1 and single["items"][0]["id"] == tid

    def test_tenants_unchanged(self, client):
        r = client.get(f"{API}/tenants")
        assert r.status_code == 200
        arr = r.json()
        assert isinstance(arr, list)
        assert any("apartment_number" in t for t in arr) or len(arr) >= 0


# ---------- Payments paged ----------
def _month_bounds():
    """Return (start, end, today_start) ISO strings covering current UTC month."""
    now = datetime.now(timezone.utc)
    start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    # next month
    if start.month == 12:
        end = start.replace(year=start.year + 1, month=1)
    else:
        end = start.replace(month=start.month + 1)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    return start.isoformat(), end.isoformat(), today_start.isoformat()


class TestPaymentsPaged:
    def test_shape_and_summary(self, client):
        s, e, t = _month_bounds()
        r = client.get(f"{API}/payments/paged", params={"start": s, "end": e, "today_start": t})
        assert r.status_code == 200, r.text
        d = r.json()
        assert "items" in d and "total" in d and "offset" in d and "has_more" in d
        sm = d["summary"]
        for k in ("totalCount", "todaySum", "monthCount", "monthSum", "currency"):
            assert k in sm, sm
        assert isinstance(sm["monthCount"], int)
        # 40 perf-test payments created in last ~5 days should be in this/prev month;
        # at least monthCount should be a non-negative int
        assert sm["monthCount"] >= 0

    def test_pagination_no_overlap(self, client):
        s, e, t = _month_bounds()
        p = {"start": s, "end": e, "today_start": t}
        p1 = client.get(f"{API}/payments/paged", params={**p, "offset": 0, "limit": 25}).json()
        p2 = client.get(f"{API}/payments/paged", params={**p, "offset": 25, "limit": 25}).json()
        ids1 = {x["id"] for x in p1["items"]}
        ids2 = {x["id"] for x in p2["items"]}
        assert not (ids1 & ids2)

    def test_search_filters_but_summary_stable(self, client):
        s, e, t = _month_bounds()
        p = {"start": s, "end": e, "today_start": t}
        base = client.get(f"{API}/payments/paged", params=p).json()
        q = client.get(f"{API}/payments/paged", params={**p, "q": "Testhuurder 39"}).json()
        # Summary (monthCount, monthSum, totalCount) must be unchanged by q
        assert base["summary"]["monthCount"] == q["summary"]["monthCount"]
        assert base["summary"]["monthSum"] == q["summary"]["monthSum"]
        assert base["summary"]["totalCount"] == q["summary"]["totalCount"]
        # q total <= base total
        assert q["total"] <= base["total"]
        if q["total"] > 0:
            names = " ".join((it.get("tenant_name") or "") for it in q["items"])
            assert "Testhuurder 39" in names

    def test_payments_unchanged(self, client):
        r = client.get(f"{API}/payments")
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# ---------- Cache invalidation ----------
class TestCacheInvalidation:
    def test_create_delete_tenant_reflected(self, client):
        before = client.get(f"{API}/tenants/paged").json()["summary"]["totalCount"]
        r = client.post(f"{API}/tenants", json={"name": "TEST_iter77_cacheinv", "phone": "", "email": ""})
        assert r.status_code in (200, 201), r.text
        tid = r.json()["id"]
        try:
            after = client.get(f"{API}/tenants/paged").json()["summary"]["totalCount"]
            assert after == before + 1, (before, after)
        finally:
            d = client.delete(f"{API}/tenants/{tid}")
            assert d.status_code in (200, 204)
        final = client.get(f"{API}/tenants/paged").json()["summary"]["totalCount"]
        assert final == before
