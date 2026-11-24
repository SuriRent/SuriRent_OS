import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from httpx import ASGITransport, AsyncClient


def test_twilio_settings_test_sends_to_requested_number(monkeypatch):
    import server
    import twilio_service

    config = {"enabled": True, "whatsapp_from": "whatsapp:+14155238886"}
    send = AsyncMock()
    monkeypatch.setattr(server, "company_id_of", lambda user: "company-1")
    monkeypatch.setattr(server, "get_company_section", AsyncMock(return_value=config))
    monkeypatch.setattr(server, "db", SimpleNamespace(
        companies=SimpleNamespace(find_one=AsyncMock(return_value={"name": "Bedrijf"}))
    ))
    monkeypatch.setattr(twilio_service, "send_whatsapp", send)

    result = asyncio.run(server.test_settings_section(
        "twilio", body=server.SettingsTestIn(to="+5971234567"), user={"id": "admin"}
    ))

    assert result["ok"] is True
    send.assert_awaited_once()
    assert send.await_args.args[1] == "+5971234567"


def test_twilio_settings_test_accepts_recipient_in_http_body(monkeypatch):
    import server
    import twilio_service

    send = AsyncMock()
    monkeypatch.setattr(server, "company_id_of", lambda user: "company-1")
    monkeypatch.setattr(server, "get_company_section", AsyncMock(return_value={
        "enabled": True, "whatsapp_from": "whatsapp:+14155238886",
    }))
    monkeypatch.setattr(server, "db", SimpleNamespace(
        companies=SimpleNamespace(find_one=AsyncMock(return_value={"name": "Bedrijf"}))
    ))
    monkeypatch.setattr(twilio_service, "send_whatsapp", send)
    monkeypatch.setitem(server.app.dependency_overrides, server.get_current_user, lambda: {"id": "admin"})

    async def request():
        async with AsyncClient(transport=ASGITransport(app=server.app), base_url="http://test") as client:
            return await client.post("/api/settings/twilio/test", json={"to": "+5971234567"})

    response = asyncio.run(request())
    assert response.status_code == 200
    assert response.json()["ok"] is True
    assert send.await_args.args[1] == "+5971234567"


@pytest.mark.parametrize("number", [None, "", "5971234567", "+123"])
def test_twilio_settings_test_rejects_missing_or_invalid_number(monkeypatch, number):
    import server
    import twilio_service

    send = AsyncMock()
    monkeypatch.setattr(server, "company_id_of", lambda user: "company-1")
    monkeypatch.setattr(server, "get_company_section", AsyncMock(return_value={
        "enabled": True, "whatsapp_from": "whatsapp:+14155238886",
    }))
    monkeypatch.setattr(server, "db", SimpleNamespace(
        companies=SimpleNamespace(find_one=AsyncMock(return_value={"name": "Bedrijf"}))
    ))
    monkeypatch.setattr(twilio_service, "send_whatsapp", send)

    with pytest.raises(HTTPException) as error:
        asyncio.run(server.test_settings_section(
            "twilio", body=server.SettingsTestIn(to=number), user={"id": "admin"}
        ))
    assert error.value.status_code == 400
    send.assert_not_awaited()
