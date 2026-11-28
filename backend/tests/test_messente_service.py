import asyncio
import base64
import json

import httpx
import pytest

from messente_service import MessenteError, _validate_number, send_sms, send_whatsapp, whatsapp_variables


CONFIG = {
    "enabled": True, "api_username": "test-user", "api_password": "test-password",
    "whatsapp_from": "+14155550100", "sms_from": "SuriRent", "template_language": "nl",
}


def mock_api(monkeypatch, response=None):
    import messente_service

    requests = []

    def handle(request):
        requests.append(request)
        if response is not None:
            return response
        message = json.loads(request.content)["messages"][0]
        return httpx.Response(201, json={
            "omnimessage_id": "omni-1", "messages": [{"channel": message["channel"], "message_id": "msg-1"}],
        })

    client = httpx.AsyncClient(transport=httpx.MockTransport(handle))
    monkeypatch.setattr(messente_service.httpx, "AsyncClient", lambda **kwargs: client)
    return requests


@pytest.mark.parametrize("number", ["+5971234567", "+597 123-4567", "whatsapp:+597 (123) 4567"])
def test_recipient_number_is_e164_without_channel_prefix(number):
    assert _validate_number(number) == "+5971234567"


@pytest.mark.parametrize("number", ["", "1234567", "+123", "+5971234567ext1", "+5971234567/+5977654321"])
def test_invalid_numbers_are_rejected(number):
    with pytest.raises(MessenteError):
        _validate_number(number)


@pytest.mark.parametrize("channel", ["sms", "whatsapp"])
def test_json_endpoint_credentials_and_service_text(monkeypatch, channel):
    requests = mock_api(monkeypatch)
    send = send_sms if channel == "sms" else send_whatsapp
    result = asyncio.run(send(CONFIG, "+597 123-4567", "Hallo huurder"))
    assert result["omnimessage_id"] == "omni-1"
    request = requests[0]
    assert str(request.url) == "https://api.messente.com/v1/omnimessage"
    assert request.headers["authorization"] == "Basic " + base64.b64encode(b"test-user:test-password").decode()
    message = json.loads(request.content)
    assert message["to"] == "+5971234567"
    expected = {"channel": channel, "sender": CONFIG["sms_from" if channel == "sms" else "whatsapp_from"]}
    if channel == "sms":
        expected.update(text="Hallo huurder", autoconvert="off")
    else:
        expected["text"] = {"body": "Hallo huurder"}
    assert message["messages"] == [expected]


def test_sms_requests_delivery_report_callback(monkeypatch):
    requests = mock_api(monkeypatch)
    asyncio.run(send_sms(CONFIG, "+5971234567", "Test", dlr_url="https://example.com/api/public/messente/sms-status/id"))
    assert json.loads(requests[0].content)["dlr_url"] == "https://example.com/api/public/messente/sms-status/id"


@pytest.mark.parametrize("body,valid", [
    ("a" * 160, True), ("a" * 161, False),
    ("a" * 158 + "€", True), ("a" * 159 + "€", False),
    ("界" * 70, True), ("界" * 71, False),
    ("😀" * 35, True), ("😀" * 36, False),
])
def test_sms_is_limited_to_one_encoded_segment(monkeypatch, body, valid):
    requests = mock_api(monkeypatch)
    if valid:
        asyncio.run(send_sms(CONFIG, "+5971234567", body))
        assert len(requests) == 1
    else:
        with pytest.raises(MessenteError, match="één SMS"):
            asyncio.run(send_sms(CONFIG, "+5971234567", body))
        assert requests == []


@pytest.mark.parametrize("kind", ["receipt", "reminder", "receipt_media", "authentication"])
def test_templates_use_messente_components_not_provider_sids(monkeypatch, kind):
    requests = mock_api(monkeypatch)
    variables = whatsapp_variables("Huurder", "Bedrijf", "SRD 100.00", "BON-1", "https://example.com/bon.jpg")
    if kind == "authentication":
        variables = {"1": "123456"}
    asyncio.run(send_whatsapp(
        {**CONFIG, f"{kind}_template": f"test_{kind}"}, "+5971234567", "Vrije tekst",
        media_url="https://example.com/unused.jpg", template_kind=kind, variables=variables,
    ))
    message = json.loads(requests[0].content)["messages"][0]
    assert set(message) == {"channel", "sender", "template"}
    template = message["template"]
    assert template["name"] == f"test_{kind}"
    assert template["language"] == {"code": "nl"}
    body = next(component for component in template["components"] if component["type"] == "body")
    count = 1 if kind == "authentication" else 4 if kind == "receipt_media" else 5
    assert body["parameters"] == [{"type": "text", "text": variables[str(i)]} for i in range(1, count + 1)]
    if kind == "receipt_media":
        assert template["components"][0] == {
            "type": "header", "parameters": [{"type": "image", "image": {"link": variables["5"]}}],
        }
    if kind == "authentication":
        assert template["components"][1] == {
            "type": "button", "sub_type": "url", "index": 0, "parameters": [{"type": "text", "text": "123456"}],
        }


def test_service_image_uses_caption(monkeypatch):
    requests = mock_api(monkeypatch)
    asyncio.run(send_whatsapp(CONFIG, "+5971234567", "Uw bon", media_url="https://example.com/bon.jpg"))
    assert json.loads(requests[0].content)["messages"][0]["image"] == {
        "link": "https://example.com/bon.jpg", "caption": "Uw bon",
    }


@pytest.mark.parametrize("response", [
    httpx.Response(400, json={"errors": [{"code": "105", "detail": "Invalid recipient"}]}),
    httpx.Response(200, json={"errors": [{"code": "105", "detail": "Invalid recipient"}]}),
    httpx.Response(502, text="gateway error"),
    httpx.Response(200, json={}),
    httpx.Response(200, json={"omnimessage_id": "id", "messages": []}),
])
def test_failed_or_unconfirmed_sends_raise_without_retry(monkeypatch, response):
    requests = mock_api(monkeypatch, response)
    with pytest.raises(MessenteError, match="Messente"):
        asyncio.run(send_whatsapp(
            {**CONFIG, "receipt_template": "receipt"}, "+5971234567", "Tekst",
            template_kind="receipt", variables=whatsapp_variables("A", "B", "C", "D", "E"),
        ))
    assert len(requests) == 1


@pytest.mark.parametrize("change", [
    {"enabled": False}, {"api_username": ""}, {"api_password": ""}, {"whatsapp_from": ""},
])
def test_incomplete_credentials_do_not_send(monkeypatch, change):
    from unittest.mock import Mock
    import messente_service

    client = Mock()
    monkeypatch.setattr(messente_service.httpx, "AsyncClient", client)
    with pytest.raises(MessenteError):
        asyncio.run(send_whatsapp({**CONFIG, **change}, "+5971234567", "Tekst"))
    client.assert_not_called()


@pytest.mark.parametrize("kind,variables", [
    ("unknown", {"1": "A"}),
    ("receipt_media", {"1": "A"}),
    ("receipt", None),
    ("receipt_media", {**whatsapp_variables("A", "B", "C", "D", "http://example.com/bon.jpg")}),
])
def test_invalid_template_data_is_not_sent(kind, variables):
    with pytest.raises(MessenteError):
        asyncio.run(send_whatsapp(
            {**CONFIG, "receipt_template": "receipt", "receipt_media_template": "receipt_jpg"},
            "+5971234567", "Tekst", template_kind=kind, variables=variables,
        ))


def test_network_timeout_is_not_retried(monkeypatch):
    import messente_service

    calls = []

    def handle(request):
        calls.append(request)
        raise httpx.ReadTimeout("timeout", request=request)

    client = httpx.AsyncClient(transport=httpx.MockTransport(handle))
    monkeypatch.setattr(messente_service.httpx, "AsyncClient", lambda **kwargs: client)
    with pytest.raises(MessenteError, match="Controleer de verzendstatus"):
        asyncio.run(send_whatsapp(CONFIG, "+5971234567", "Tekst"))
    assert len(calls) == 1
