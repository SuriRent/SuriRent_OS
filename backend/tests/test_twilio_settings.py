import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
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


@pytest.mark.parametrize("number", ["+5971234567", "+597 123-4567", "whatsapp:+597 123-4567"])
def test_twilio_settings_test_sends_to_requested_number(monkeypatch, number):
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
        "twilio", body=server.SettingsTestIn(to=number), user={"id": "admin"}
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


@pytest.mark.parametrize("kind", ["receipt", "receipt_media", "reminder"])
def test_template_test_uses_saved_sid_and_sample_variables(monkeypatch, kind):
    import server
    import twilio_service

    send = AsyncMock()
    monkeypatch.setattr(server, "company_id_of", lambda user: "company-1")
    monkeypatch.setattr(server, "get_company_section", AsyncMock(return_value={
        "enabled": True, "whatsapp_from": "+14155550100", f"{kind}_content_sid": "HX" + "a" * 32,
    }))
    monkeypatch.setattr(server, "db", SimpleNamespace(
        companies=SimpleNamespace(find_one=AsyncMock(return_value={"name": "Bedrijf"}))
    ))
    monkeypatch.setattr(twilio_service, "send_whatsapp", send)
    monkeypatch.setenv("APP_PUBLIC_URL", "https://example.com")

    result = asyncio.run(server.test_settings_section(
        "twilio", body=server.SettingsTestIn(to="+5971234567", template_kind=kind), user={"id": "admin"}
    ))
    assert result["ok"] is True
    assert send.await_args.kwargs["template_kind"] == kind
    assert send.await_args.kwargs["variables"] == {
        "1": "Testhuurder", "2": "Bedrijf", "3": "SRD 100.00", "4": "TEST-001",
        "5": "sample.jpg" if kind == "receipt_media" else "https://example.com/kiosk/huurder",
    }


def test_missing_template_sid_does_not_send_free_text(monkeypatch):
    import server
    import twilio_service

    send = AsyncMock()
    monkeypatch.setattr(server, "company_id_of", lambda user: "company-1")
    monkeypatch.setattr(server, "get_company_section", AsyncMock(return_value={
        "enabled": True, "whatsapp_from": "+14155550100",
    }))
    monkeypatch.setattr(server, "db", SimpleNamespace(
        companies=SimpleNamespace(find_one=AsyncMock(return_value={"name": "Bedrijf"}))
    ))
    monkeypatch.setattr(twilio_service, "send_whatsapp", send)
    with pytest.raises(HTTPException) as error:
        asyncio.run(server.test_settings_section(
            "twilio", body=server.SettingsTestIn(to="+5971234567", template_kind="receipt"), user={"id": "admin"}
        ))
    assert error.value.status_code == 400
    send.assert_not_awaited()


@pytest.mark.parametrize("channel", ["whatsapp", "sms"])
def test_receipt_endpoint_supplies_template_data_without_changing_sms(monkeypatch, channel):
    import server
    import twilio_service

    send_wa, send_sms = AsyncMock(), AsyncMock()
    payment = {"receipt_number": "BON-1", "currency": "SRD", "amount": 100, "tenant_id": "tenant-1"}
    monkeypatch.setattr(server, "_twilio_or_400", AsyncMock(return_value={"receipt_content_sid": "HX" + "a" * 32}))
    monkeypatch.setattr(server, "_enrich_payment", AsyncMock(return_value=payment))
    monkeypatch.setattr(server, "_brand_name_of", AsyncMock(return_value="Bedrijf"))
    monkeypatch.setattr(server, "scope", lambda user: {"company_id": "company-1"})
    monkeypatch.setattr(server, "company_id_of", lambda user: "company-1")
    monkeypatch.setattr(server, "db", SimpleNamespace(
        payments=SimpleNamespace(find_one=AsyncMock(return_value=payment)),
        tenants=SimpleNamespace(find_one=AsyncMock(return_value={"name": "Huurder", "phone": "+5971234567"})),
    ))
    monkeypatch.setattr(twilio_service, "send_whatsapp", send_wa)
    monkeypatch.setattr(twilio_service, "send_sms", send_sms)
    monkeypatch.setenv("APP_PUBLIC_URL", "https://example.com")
    result = asyncio.run(server.message_payment_receipt(
        "payment-1", server.MessageSendIn(channel=channel), user={"id": "admin"}
    ))
    assert result["ok"] is True
    if channel == "sms":
        send_wa.assert_not_awaited()
        send_sms.assert_awaited_once()
    else:
        send_sms.assert_not_awaited()
        assert send_wa.await_args.kwargs["template_kind"] == "receipt"
        assert send_wa.await_args.kwargs["variables"] == {
            "1": "Huurder", "2": "Bedrijf", "3": "SRD 100.00", "4": "BON-1",
            "5": "https://example.com/api/payments/payment-1/image",
        }


def test_twilio_template_sids_are_persisted_per_company(monkeypatch):
    import server

    update = AsyncMock()
    monkeypatch.setattr(server, "company_id_of", lambda user: "company-1")
    monkeypatch.setattr(server, "_get_company_settings_doc", AsyncMock(return_value={}))
    monkeypatch.setattr(server, "db", SimpleNamespace(company_settings=SimpleNamespace(update_one=update)))
    result = asyncio.run(server.update_settings_section("twilio", {
        "receipt_content_sid": "HX" + "a" * 32, "reminder_content_sid": "HX" + "b" * 32,
        "receipt_media_content_sid": "HX" + "c" * 32,
    }, user={"id": "admin"}))
    assert result["data"]["receipt_content_sid"] == "HX" + "a" * 32
    assert result["data"]["reminder_content_sid"] == "HX" + "b" * 32
    assert result["data"]["receipt_media_content_sid"] == "HX" + "c" * 32
    assert update.await_args.args[0] == {"company_id": "company-1"}


@pytest.mark.parametrize("key", ["receipt_content_sid", "receipt_media_content_sid"])
def test_invalid_content_sid_is_not_saved(monkeypatch, key):
    import server

    update = AsyncMock()
    monkeypatch.setattr(server, "company_id_of", lambda user: "company-1")
    monkeypatch.setattr(server, "_get_company_settings_doc", AsyncMock(return_value={}))
    monkeypatch.setattr(server, "db", SimpleNamespace(company_settings=SimpleNamespace(update_one=update)))
    with pytest.raises(HTTPException) as error:
        asyncio.run(server.update_settings_section("twilio", {
            key: "invalid",
        }, user={"id": "admin"}))
    assert error.value.status_code == 422
    update.assert_not_awaited()


def test_kiosk_receipt_uses_receipt_template(monkeypatch):
    import server
    import twilio_service

    send = AsyncMock()
    payment = {"receipt_number": "BON-2", "currency": "USD", "amount": 25, "tenant_id": "tenant-1"}
    monkeypatch.setattr(server, "get_company_section", AsyncMock(return_value={
        "enabled": True, "whatsapp_from": "+14155550100", "receipt_content_sid": "HX" + "a" * 32,
    }))
    monkeypatch.setattr(server, "_enrich_payment", AsyncMock(return_value=payment))
    monkeypatch.setattr(server, "_brand_name_of", AsyncMock(return_value="Bedrijf"))
    monkeypatch.setattr(server, "db", SimpleNamespace(
        payments=SimpleNamespace(find_one=AsyncMock(return_value=payment)),
        tenants=SimpleNamespace(find_one=AsyncMock(return_value={"name": "Huurder", "phone": "+5971234567"})),
    ))
    monkeypatch.setattr(twilio_service, "send_whatsapp", send)
    monkeypatch.setenv("APP_PUBLIC_URL", "https://example.com")
    result = asyncio.run(server.kiosk_whatsapp_receipt("payment-2", _session={"company_id": "company-1"}))
    assert result["sent"] is True
    assert send.await_args.kwargs["template_kind"] == "receipt"
    assert send.await_args.kwargs["variables"]["3"] == "USD 25.00"
    assert send.await_args.kwargs["variables"]["4"] == "BON-2"


def test_overdue_reminder_uses_reminder_template(monkeypatch):
    import server
    import twilio_service

    send = AsyncMock()
    monkeypatch.setattr(server, "_twilio_or_400", AsyncMock(return_value={"reminder_content_sid": "HX" + "a" * 32}))
    monkeypatch.setattr(server, "_calc_balance", AsyncMock(return_value={"balance": 50, "currency": "SRD"}))
    monkeypatch.setattr(server, "_brand_name_of", AsyncMock(return_value="Bedrijf"))
    monkeypatch.setattr(server, "scope", lambda user: {"company_id": "company-1"})
    monkeypatch.setattr(server, "company_id_of", lambda user: "company-1")
    monkeypatch.setattr(server, "db", SimpleNamespace(
        tenants=SimpleNamespace(find_one=AsyncMock(return_value={"name": "Huurder", "phone": "+5971234567"})),
    ))
    monkeypatch.setattr(twilio_service, "send_whatsapp", send)
    monkeypatch.setenv("APP_PUBLIC_URL", "https://example.com")
    result = asyncio.run(server.message_overdue_reminder("tenant-1", server.MessageSendIn(), user={"id": "admin"}))
    assert result["ok"] is True
    assert send.await_args.kwargs["template_kind"] == "reminder"
    assert send.await_args.kwargs["variables"] == {
        "1": "Huurder", "2": "Bedrijf", "3": "SRD 50.00", "4": "Openstaand saldo",
        "5": "https://example.com/kiosk/huurder",
    }


def test_receipt_media_token_route_and_invalid_tokens(monkeypatch):
    import jwt
    import server
    from fastapi.responses import Response

    monkeypatch.setenv("APP_PUBLIC_URL", "https://example.com")
    image = AsyncMock(return_value=Response(b"jpeg-data", media_type="image/jpeg"))
    monkeypatch.setattr(server, "payment_image", image)
    kind, variables = server._receipt_template(
        {"receipt_content_sid": "text", "receipt_media_content_sid": "media"},
        "payment-1", "Huurder", "Bedrijf", "SRD 100", "BON-1", "old-link",
    )
    assert kind == "receipt_media"
    assert variables["5"].endswith(".jpg")
    token = variables["5"][:-4]
    expired = jwt.encode({"type": "whatsapp_receipt_image", "payment_id": "payment-1", "exp": 1},
                         server.JWT_SECRET, algorithm=server.JWT_ALG)
    wrong_purpose = jwt.encode({"type": "access", "payment_id": "payment-1", "exp": 4102444800},
                               server.JWT_SECRET, algorithm=server.JWT_ALG)
    tampered = jwt.encode({"type": "whatsapp_receipt_image", "payment_id": "payment-1", "exp": 4102444800},
                          "incorrect-secret", algorithm=server.JWT_ALG)

    async def request():
        async with AsyncClient(transport=ASGITransport(app=server.app), base_url="http://test") as client:
            results = []
            for value in [token, expired, wrong_purpose, tampered, "sample"]:
                results.append(await client.get(f"/api/public/whatsapp-receipts/{value}.jpg"))
            return results

    valid, expired_response, wrong_response, tampered_response, sample = asyncio.run(request())
    assert valid.status_code == 200 and valid.content == b"jpeg-data"
    assert valid.headers["cache-control"] == "private, no-store"
    image.assert_awaited_once_with("payment-1")
    assert [expired_response.status_code, wrong_response.status_code, tampered_response.status_code] == [404, 404, 404]
    assert sample.status_code == 200 and sample.headers["content-type"] == "image/jpeg"
    assert sample.content.startswith(b"\xff\xd8")


def test_media_template_requires_https_and_falls_back_only_to_configured_text(monkeypatch):
    import server

    monkeypatch.setenv("APP_PUBLIC_URL", "http://example.com")
    with pytest.raises(HTTPException):
        server._receipt_template({"receipt_media_content_sid": "media"}, "payment", "A", "B", "C", "D", "link")
    with pytest.raises(HTTPException):
        server._receipt_template({"receipt_media_content_sid": "media"}, None, "A", "B", "C", "D", "link")
    kind, variables = server._receipt_template(
        {"receipt_media_content_sid": "media", "receipt_content_sid": "text"},
        None, "A", "B", "C", "D", "link",
    )
    assert kind == "receipt" and variables["5"] == "link"


@pytest.mark.parametrize("route", ["kiosk", "manual"])
def test_receipt_routes_prefer_media_template(monkeypatch, route):
    import server
    import twilio_service

    send = AsyncMock()
    cfg = {"enabled": True, "whatsapp_from": "+14155550100",
           "receipt_content_sid": "HX" + "a" * 32, "receipt_media_content_sid": "HX" + "b" * 32}
    payment = {"receipt_number": "BON-1", "currency": "SRD", "amount": 100, "tenant_id": "tenant-1"}
    monkeypatch.setenv("APP_PUBLIC_URL", "https://example.com")
    monkeypatch.setattr(server, "get_company_section", AsyncMock(return_value=cfg))
    monkeypatch.setattr(server, "_twilio_or_400", AsyncMock(return_value=cfg))
    monkeypatch.setattr(server, "_enrich_payment", AsyncMock(return_value=payment))
    monkeypatch.setattr(server, "_brand_name_of", AsyncMock(return_value="Bedrijf"))
    monkeypatch.setattr(server, "scope", lambda user: {"company_id": "company-1"})
    monkeypatch.setattr(server, "company_id_of", lambda user: "company-1")
    monkeypatch.setattr(server, "db", SimpleNamespace(
        payments=SimpleNamespace(find_one=AsyncMock(return_value=payment)),
        tenants=SimpleNamespace(find_one=AsyncMock(return_value={"name": "Huurder", "phone": "+5971234567"})),
    ))
    monkeypatch.setattr(twilio_service, "send_whatsapp", send)
    if route == "kiosk":
        result = asyncio.run(server.kiosk_whatsapp_receipt("payment-1", _session={"company_id": "company-1"}))
        assert result["sent"]
    else:
        result = asyncio.run(server.message_payment_receipt(
            "payment-1", server.MessageSendIn(channel="whatsapp"), user={"id": "admin"}
        ))
        assert result["ok"]
    assert send.await_args.kwargs["template_kind"] == "receipt_media"
    token = send.await_args.kwargs["variables"]["5"].removesuffix(".jpg")
    assert server.jwt.decode(token, server.JWT_SECRET, algorithms=[server.JWT_ALG])["payment_id"] == "payment-1"
