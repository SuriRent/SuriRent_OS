import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from httpx import ASGITransport, AsyncClient


@pytest.fixture(scope="module", autouse=True)
def server_loop():
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    yield
    loop.close()
    asyncio.set_event_loop(None)


def test_invalid_link_is_not_available(monkeypatch):
    import server
    import sms_payment_links

    monkeypatch.setattr(server, "db", SimpleNamespace(sms_payment_links=object()))
    monkeypatch.setattr(sms_payment_links, "get_payment_grant", AsyncMock(return_value=None))

    async def request():
        async with AsyncClient(transport=ASGITransport(app=server.app), base_url="http://test") as client:
            return await client.get("/api/public/sms-payment", headers={"X-Sms-Payment-Token": "not-valid"})

    response = asyncio.run(request())
    assert response.status_code == 404
    assert response.headers["cache-control"] == "private, no-store"
    assert response.headers["referrer-policy"] == "no-referrer"


def test_link_returns_only_scoped_open_items_and_enabled_methods(monkeypatch):
    import server
    import sms_payment_links
    from routes import company_mope, company_stripe

    grant = {"company_id": "c1", "tenant_id": "t1", "invoice_ids": ["i1"],
             "installments": [{"plan_id": "p1", "sequence": 1}]}
    invoice = {"id": "i1", "company_id": "c1", "tenant_id": "t1", "remaining_amount": 50}
    plan = {"id": "p1", "tenant_id": "t1", "status": "active", "remaining_amount": 30,
            "installments": [{"sequence": 1, "amount": 30, "status": "pending"},
                             {"sequence": 2, "amount": 10, "status": "pending"}]}
    find_calls = []

    def find(*args):
        find_calls.append(args)
        return SimpleNamespace(to_list=AsyncMock(return_value=[invoice]))

    monkeypatch.setattr(server, "db", SimpleNamespace(
        sms_payment_links=object(),
        tenants=SimpleNamespace(find_one=AsyncMock(return_value={"id": "t1", "company_id": "c1"})),
        companies=SimpleNamespace(find_one=AsyncMock(return_value={
            "name": "Bedrijf", "address": "Straat", "bank_account_sr": "123",
        })),
        invoices=SimpleNamespace(find=find),
    ))
    monkeypatch.setattr(sms_payment_links, "get_payment_grant", AsyncMock(return_value=grant))
    monkeypatch.setattr(server, "_enrich_invoices_batch", AsyncMock(return_value=[invoice]))
    monkeypatch.setattr(server, "_plan_core", {"list_plans_for_tenant": AsyncMock(return_value=[plan])})
    monkeypatch.setattr(server, "_company_has_plan_feature", AsyncMock(return_value=True))
    monkeypatch.setattr(company_stripe, "_cfg_doc", AsyncMock(return_value={"stripe_config": {}}))
    monkeypatch.setattr(company_stripe, "_active", lambda cfg: {"enabled": True, "methods": ["card"]})
    monkeypatch.setattr(company_mope, "_config", AsyncMock(return_value={"enabled": True}))
    monkeypatch.setattr(company_mope, "_active", lambda cfg: cfg["enabled"])

    async def request():
        async with AsyncClient(transport=ASGITransport(app=server.app), base_url="http://test") as client:
            return await client.get("/api/public/sms-payment", headers={"X-Sms-Payment-Token": "example"})

    response = asyncio.run(request())
    assert response.status_code == 200
    assert response.headers["cache-control"] == "private, no-store"
    assert find_calls[0][0] == {"id": {"$in": ["i1"]}, "company_id": "c1", "tenant_id": "t1"}
    body = response.json()
    assert [item["kind"] for item in body["items"]] == ["invoice", "installment"]
    assert [item["id"] for item in body["online_methods"]] == ["card"]
    assert body["online_payment_available"] is False
    assert body["bank_accounts"] == [{"country": "Suriname", "account": "123"}]
