import asyncio
import json

import httpx
import pytest

from twilio_service import TwilioError, _validate_number, send_whatsapp


@pytest.mark.parametrize("number", ["+597 123-4567", "whatsapp:+597 123-4567", "+597 (123) 4567"])
def test_whatsapp_number_formatting_is_removed(number):
    assert _validate_number(number, "whatsapp") == "whatsapp:+5971234567"


def test_sms_number_formatting_is_removed():
    assert _validate_number("+597 123-4567", "sms") == "+5971234567"


@pytest.mark.parametrize("number", ["", "1234567", "+123", "+5971234567ext1", "+5971234567/+5977654321"])
def test_invalid_numbers_are_rejected(number):
    with pytest.raises(TwilioError):
        _validate_number(number, "whatsapp")


def test_send_normalizes_both_sender_and_recipient(monkeypatch):
    from urllib.parse import parse_qs
    import twilio_service

    requests = []

    def handle(request):
        requests.append(parse_qs(request.content.decode()))
        return httpx.Response(201, json={"sid": "test-message"})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handle))
    monkeypatch.setattr(twilio_service.httpx, "AsyncClient", lambda **kwargs: client)
    result = asyncio.run(send_whatsapp({
        "enabled": True, "account_sid": "test", "auth_token": "test",
        "whatsapp_from": "whatsapp:+1 (415) 555-0100",
    }, "+597 123-4567", "Test"))

    assert result["sid"] == "test-message"
    assert requests[0]["From"] == ["whatsapp:+14155550100"]
    assert requests[0]["To"] == ["whatsapp:+5971234567"]


@pytest.mark.parametrize("kind", ["receipt", "reminder"])
def test_template_uses_content_fields_without_body_or_media(monkeypatch, kind):
    from urllib.parse import parse_qs
    import twilio_service

    requests = []

    def handle(request):
        requests.append(parse_qs(request.content.decode()))
        return httpx.Response(201, json={"sid": "template-message"})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handle))
    monkeypatch.setattr(twilio_service.httpx, "AsyncClient", lambda **kwargs: client)
    variables = twilio_service.whatsapp_variables("Huurder", "Bedrijf", "SRD 100.00", "BON-1", "https://example.com/bon")
    asyncio.run(send_whatsapp({
        "enabled": True, "account_sid": "test", "auth_token": "test",
        "whatsapp_from": "+14155550100", f"{kind}_content_sid": "HX" + "a" * 32,
    }, "+5971234567", "Vrije tekst", media_url="https://example.com/bon",
        template_kind=kind, variables=variables))

    assert requests[0]["ContentSid"] == ["HX" + "a" * 32]
    assert json.loads(requests[0]["ContentVariables"][0]) == variables
    assert "Body" not in requests[0]
    assert "MediaUrl" not in requests[0]


def test_template_failure_is_not_retried_as_free_text(monkeypatch):
    import twilio_service

    calls = []

    def handle(request):
        calls.append(request)
        return httpx.Response(400, json={"code": 63016, "message": "Template not approved"})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handle))
    monkeypatch.setattr(twilio_service.httpx, "AsyncClient", lambda **kwargs: client)
    with pytest.raises(TwilioError, match="63016"):
        asyncio.run(send_whatsapp({
            "enabled": True, "account_sid": "test", "auth_token": "test",
            "whatsapp_from": "+14155550100", "receipt_content_sid": "HX" + "a" * 32,
        }, "+5971234567", "Tekst", template_kind="receipt", variables={"1": "Huurder"}))
    assert len(calls) == 1


def test_blank_template_sid_keeps_existing_free_text_behavior(monkeypatch):
    from unittest.mock import AsyncMock
    import twilio_service

    send = AsyncMock(return_value={"sid": "message"})
    monkeypatch.setattr(twilio_service, "_send", send)
    asyncio.run(send_whatsapp({"enabled": True}, "+5971234567", "Tekst", template_kind="receipt"))
    assert not send.await_args.kwargs["content_sid"]


@pytest.mark.parametrize("sid,variables", [("invalid", {"1": "name"}), ("HX" + "a" * 32, None)])
def test_invalid_template_configuration_is_rejected(sid, variables):
    with pytest.raises(TwilioError):
        asyncio.run(send_whatsapp({
            "enabled": True, "account_sid": "test", "auth_token": "test",
            "whatsapp_from": "+14155550100", "receipt_content_sid": sid,
        }, "+5971234567", "Tekst", template_kind="receipt", variables=variables))
