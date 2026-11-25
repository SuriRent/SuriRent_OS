import asyncio
import hashlib
import hmac
import json
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


def test_sms_saves_metadata_and_requests_delivery_report(monkeypatch):
    import server
    import messente_service
    from settings_service import decrypt

    insert, update = AsyncMock(), AsyncMock()
    send = AsyncMock(return_value={
        "omnimessage_id": "omni-1", "messages": [{"channel": "sms", "message_id": "sms-1"}],
    })
    monkeypatch.setattr(server, "db", SimpleNamespace(sms_history=SimpleNamespace(insert_one=insert, update_one=update)))
    monkeypatch.setattr(messente_service, "send_sms", send)
    monkeypatch.setenv("APP_PUBLIC_URL", "https://example.com")
    asyncio.run(server._send_company_sms("company-1", {"api_password": "secret"}, "+5971234567", "PIN 1234", "PIN-herstel"))
    record = insert.await_args.args[0]
    assert record["company_id"] == "company-1"
    assert record["to"] == "+5971234567"
    assert "PIN 1234" not in repr(record)
    assert decrypt(record["callback_secret"]) == "secret"
    assert send.await_args.kwargs["dlr_url"] == f"https://example.com/api/public/messente/sms-status/{record['_id']}"
    assert update.await_args_list[-1].args[1]["$set"]["status"] == "accepted"


def test_sms_without_public_https_does_not_claim_delivery(monkeypatch):
    import server
    import messente_service

    insert, update = AsyncMock(), AsyncMock()
    send = AsyncMock(return_value={
        "omnimessage_id": "omni-1", "messages": [{"channel": "sms", "message_id": "sms-1"}],
    })
    monkeypatch.setattr(server, "db", SimpleNamespace(sms_history=SimpleNamespace(insert_one=insert, update_one=update)))
    monkeypatch.setattr(messente_service, "send_sms", send)
    monkeypatch.setenv("APP_PUBLIC_URL", "http://localhost:3000")
    asyncio.run(server._send_company_sms("company-1", {}, "+5971234567", "Test", "Testbericht"))
    assert send.await_args.kwargs["dlr_url"] is None
    assert update.await_args_list[-1].args[1]["$set"]["status"] == "status_unavailable"


def test_unconfirmed_sms_is_not_reported_as_delivered(monkeypatch):
    import server
    import messente_service

    update = AsyncMock()
    monkeypatch.setattr(server, "db", SimpleNamespace(sms_history=SimpleNamespace(insert_one=AsyncMock(), update_one=update)))
    monkeypatch.setattr(messente_service, "send_sms", AsyncMock(side_effect=messente_service.MessenteError("Network error")))
    with pytest.raises(messente_service.MessenteError):
        asyncio.run(server._send_company_sms("company-1", {}, "+5971234567", "Test", "Testbericht"))
    assert update.await_args.args[1]["$set"]["status"] == "unconfirmed"


def test_delivery_callback_authenticates_and_records_status(monkeypatch):
    import server
    from settings_service import encrypt

    update = AsyncMock()
    monkeypatch.setattr(server, "db", SimpleNamespace(sms_history=SimpleNamespace(
        find_one=AsyncMock(return_value={"to": "+5971234567", "callback_secret": encrypt("secret"), "message_id": "sms-1"}),
        update_one=update,
    )))
    body = json.dumps({
        "channel": "sms", "to": "+5971234567", "message_id": "sms-1",
        "omnimessage_id": "omni-1", "status": "DELIVRD", "timestamp": "2026-01-01T10:00:00",
    }).encode()
    signature = hmac.new(b"secret", body, hashlib.sha256).hexdigest()

    async def requests():
        async with AsyncClient(transport=ASGITransport(app=server.app), base_url="http://test") as client:
            bad = await client.post("/api/public/messente/sms-status/id", content=body, headers={"X-Messente-Signature": "bad"})
            good = await client.post("/api/public/messente/sms-status/id", content=body, headers={"X-Messente-Signature": signature})
            return bad, good

    bad, good = asyncio.run(requests())
    assert bad.status_code == 401
    assert good.status_code == 200
    update.assert_awaited_once()
    assert update.await_args.args[1]["$set"]["status"] == "DELIVRD"
    assert "$lt" in update.await_args.args[0]["$or"][1]["status_at"]


def test_sms_history_is_scoped_to_company(monkeypatch):
    import server

    to_list = AsyncMock(return_value=[])
    find = lambda *args: SimpleNamespace(sort=lambda *args: SimpleNamespace(to_list=to_list))
    calls = []

    def scoped_find(*args):
        calls.append(args)
        return find(*args)
    collection = SimpleNamespace(find=scoped_find)
    monkeypatch.setattr(server, "db", SimpleNamespace(sms_history=collection))
    assert asyncio.run(server.sms_history({"role": "admin", "active_company_id": "company-1"})) == []
    assert calls[0][0] == {"company_id": "company-1"}


@pytest.mark.parametrize("role,expected", [("admin", 200), ("boekhouder", 403)])
def test_sms_history_requires_admin(monkeypatch, role, expected):
    import server

    cursor = SimpleNamespace(sort=lambda *args: SimpleNamespace(to_list=AsyncMock(return_value=[])))
    monkeypatch.setattr(server, "db", SimpleNamespace(sms_history=SimpleNamespace(find=lambda *args: cursor)))
    monkeypatch.setitem(server.app.dependency_overrides, server.get_current_user,
                        lambda: {"role": role, "active_company_id": "company-1"})

    async def request():
        async with AsyncClient(transport=ASGITransport(app=server.app), base_url="http://test") as client:
            return await client.get("/api/sms/history")

    assert asyncio.run(request()).status_code == expected
