import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from httpx import ASGITransport, AsyncClient


@pytest.fixture(scope="module", autouse=True)
def load_server_with_event_loop():
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        import server  # noqa: F401
        yield
    finally:
        loop.close()
        asyncio.set_event_loop(None)


@pytest.mark.parametrize("doc,expected", [
    ({}, ""),
    ({"banking": {"whatsapp": "+597 7251674", "account_number": "private"},
      "smtp": {"password": "private"}}, "+597 7251674"),
])
def test_public_marketing_contact_only_returns_configured_number(monkeypatch, doc, expected):
    import server

    monkeypatch.setattr(server, "db", SimpleNamespace(
        saas_settings=SimpleNamespace(find_one=AsyncMock(return_value=doc)),
    ))

    async def request():
        async with AsyncClient(transport=ASGITransport(app=server.app), base_url="http://test") as client:
            return await client.get("/api/public/marketing-contact")

    response = asyncio.run(request())
    assert response.status_code == 200
    assert response.json() == {"whatsapp": expected}
