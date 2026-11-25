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
def test_messente_settings_test_sends_to_requested_number(monkeypatch, number):
    import server
    import messente_service

    config = {"enabled": True, "whatsapp_from": "+14155238886"}
    send = AsyncMock()
    monkeypatch.setattr(server, "company_id_of", lambda user: "company-1")
    monkeypatch.setattr(server, "get_company_section", AsyncMock(return_value=config))
    monkeypatch.setattr(server, "db", SimpleNamespace(
        companies=SimpleNamespace(find_one=AsyncMock(return_value={"name": "Bedrijf"}))
    ))
    monkeypatch.setattr(messente_service, "send_whatsapp", send)

    result = asyncio.run(server.test_settings_section(
        "messente", body=server.SettingsTestIn(to=number), user={"id": "admin"}
    ))

    assert result["ok"] is True
    send.assert_awaited_once()
    assert send.await_args.args[1] == "+5971234567"


def test_messente_settings_test_accepts_recipient_in_http_body(monkeypatch):
    import server
    import messente_service

    send = AsyncMock()
    monkeypatch.setattr(server, "company_id_of", lambda user: "company-1")
    monkeypatch.setattr(server, "get_company_section", AsyncMock(return_value={
        "enabled": True, "whatsapp_from": "+14155238886",
    }))
    monkeypatch.setattr(server, "db", SimpleNamespace(
        companies=SimpleNamespace(find_one=AsyncMock(return_value={"name": "Bedrijf"}))
    ))
    monkeypatch.setattr(messente_service, "send_whatsapp", send)
    monkeypatch.setitem(server.app.dependency_overrides, server.get_current_user, lambda: {"id": "admin"})

    async def request():
        async with AsyncClient(transport=ASGITransport(app=server.app), base_url="http://test") as client:
            return await client.post("/api/settings/messente/test", json={"to": "+5971234567"})

    response = asyncio.run(request())
    assert response.status_code == 200
    assert response.json()["ok"] is True
    assert send.await_args.args[1] == "+5971234567"


@pytest.mark.parametrize("number", [None, "", "5971234567", "+123"])
def test_messente_settings_test_rejects_missing_or_invalid_number(monkeypatch, number):
    import server
    import messente_service

    send = AsyncMock()
    monkeypatch.setattr(server, "company_id_of", lambda user: "company-1")
    monkeypatch.setattr(server, "get_company_section", AsyncMock(return_value={
        "enabled": True, "whatsapp_from": "+14155238886",
    }))
    monkeypatch.setattr(server, "db", SimpleNamespace(
        companies=SimpleNamespace(find_one=AsyncMock(return_value={"name": "Bedrijf"}))
    ))
    monkeypatch.setattr(messente_service, "send_whatsapp", send)

    with pytest.raises(HTTPException) as error:
        asyncio.run(server.test_settings_section(
            "messente", body=server.SettingsTestIn(to=number), user={"id": "admin"}
        ))
    assert error.value.status_code == 400
    send.assert_not_awaited()


@pytest.mark.parametrize("kind", ["receipt", "receipt_media", "reminder"])
def test_template_test_uses_saved_name_and_sample_variables(monkeypatch, kind):
    import server
    import messente_service

    send = AsyncMock()
    monkeypatch.setattr(server, "company_id_of", lambda user: "company-1")
    monkeypatch.setattr(server, "get_company_section", AsyncMock(return_value={
        "enabled": True, "whatsapp_from": "+14155550100", f"{kind}_template": f"test_{kind}",
    }))
    monkeypatch.setattr(server, "db", SimpleNamespace(
        companies=SimpleNamespace(find_one=AsyncMock(return_value={"name": "Bedrijf"}))
    ))
    monkeypatch.setattr(messente_service, "send_whatsapp", send)
    monkeypatch.setenv("APP_PUBLIC_URL", "https://example.com")

    result = asyncio.run(server.test_settings_section(
        "messente", body=server.SettingsTestIn(to="+5971234567", template_kind=kind), user={"id": "admin"}
    ))
    assert result["ok"] is True
    assert send.await_args.kwargs["template_kind"] == kind
    assert send.await_args.kwargs["variables"] == {
        "1": "Testhuurder", "2": "Bedrijf", "3": "SRD 100.00", "4": "TEST-001",
        "5": "https://example.com/api/public/whatsapp-receipts/sample.jpg" if kind == "receipt_media" else "https://example.com/kiosk/huurder",
    }


def test_missing_template_name_does_not_send_free_text(monkeypatch):
    import server
    import messente_service

    send = AsyncMock()
    monkeypatch.setattr(server, "company_id_of", lambda user: "company-1")
    monkeypatch.setattr(server, "get_company_section", AsyncMock(return_value={
        "enabled": True, "whatsapp_from": "+14155550100",
    }))
    monkeypatch.setattr(server, "db", SimpleNamespace(
        companies=SimpleNamespace(find_one=AsyncMock(return_value={"name": "Bedrijf"}))
    ))
    monkeypatch.setattr(messente_service, "send_whatsapp", send)
    with pytest.raises(HTTPException) as error:
        asyncio.run(server.test_settings_section(
            "messente", body=server.SettingsTestIn(to="+5971234567", template_kind="receipt"), user={"id": "admin"}
        ))
    assert error.value.status_code == 400
    send.assert_not_awaited()


@pytest.mark.parametrize("channel", ["whatsapp", "sms"])
def test_receipt_endpoint_supplies_template_data_without_changing_sms(monkeypatch, channel):
    import server
    import messente_service

    send_wa, send_sms = AsyncMock(), AsyncMock()
    payment = {"receipt_number": "BON-1", "currency": "SRD", "amount": 100, "tenant_id": "tenant-1"}
    monkeypatch.setattr(server, "_messente_or_400", AsyncMock(return_value={"receipt_template": "receipt"}))
    monkeypatch.setattr(server, "_enrich_payment", AsyncMock(return_value=payment))
    monkeypatch.setattr(server, "_brand_name_of", AsyncMock(return_value="Bedrijf"))
    monkeypatch.setattr(server, "scope", lambda user: {"company_id": "company-1"})
    monkeypatch.setattr(server, "company_id_of", lambda user: "company-1")
    monkeypatch.setattr(server, "db", SimpleNamespace(
        payments=SimpleNamespace(find_one=AsyncMock(return_value=payment)),
        tenants=SimpleNamespace(find_one=AsyncMock(return_value={"name": "Huurder", "phone": "+5971234567"})),
    ))
    monkeypatch.setattr(messente_service, "send_whatsapp", send_wa)
    monkeypatch.setattr(messente_service, "send_sms", send_sms)
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


def test_messente_templates_and_encrypted_credentials_are_persisted_per_company(monkeypatch):
    import server
    from settings_service import MASK, decrypt, merge_section

    update = AsyncMock()
    monkeypatch.setattr(server, "company_id_of", lambda user: "company-1")
    monkeypatch.setattr(server, "_get_company_settings_doc", AsyncMock(return_value={}))
    monkeypatch.setattr(server, "db", SimpleNamespace(company_settings=SimpleNamespace(update_one=update)))
    result = asyncio.run(server.update_settings_section("messente", {
        "receipt_template": "receipt", "reminder_template": "reminder",
        "receipt_media_template": "receipt_jpg", "authentication_template": "otp", "template_language": "en_US",
        "api_username": "test-user", "api_password": "test-password",
    }, user={"id": "admin"}))
    assert result["data"]["receipt_template"] == "receipt"
    assert result["data"]["reminder_template"] == "reminder"
    assert result["data"]["receipt_media_template"] == "receipt_jpg"
    assert result["data"]["api_username"] == result["data"]["api_password"] == MASK
    stored = update.await_args.args[1]["$set"]["messente"]
    assert stored["api_password"] != "test-password"
    assert decrypt(stored["api_username"]) == "test-user"
    assert decrypt(stored["api_password"]) == "test-password"
    assert merge_section("messente", stored, {"api_password": MASK, "api_username": ""}) == stored
    assert update.await_args.args[0] == {"company_id": "company-1"}


@pytest.mark.parametrize("key,value", [
    ("receipt_template", "HX" + "a" * 32), ("receipt_media_template", "Bad template"),
    ("template_language", "Dutch"), ("sms_from", []),
])
def test_invalid_template_configuration_is_not_saved(monkeypatch, key, value):
    import server

    update = AsyncMock()
    monkeypatch.setattr(server, "company_id_of", lambda user: "company-1")
    monkeypatch.setattr(server, "_get_company_settings_doc", AsyncMock(return_value={}))
    monkeypatch.setattr(server, "db", SimpleNamespace(company_settings=SimpleNamespace(update_one=update)))
    with pytest.raises(HTTPException) as error:
        asyncio.run(server.update_settings_section("messente", {
            key: value,
        }, user={"id": "admin"}))
    assert error.value.status_code == 422
    update.assert_not_awaited()


def test_kiosk_receipt_uses_receipt_template(monkeypatch):
    import server
    import messente_service

    send = AsyncMock()
    payment = {"receipt_number": "BON-2", "currency": "USD", "amount": 25, "tenant_id": "tenant-1"}
    monkeypatch.setattr(server, "get_company_section", AsyncMock(return_value={
        "enabled": True, "whatsapp_from": "+14155550100", "receipt_template": "receipt",
    }))
    monkeypatch.setattr(server, "_enrich_payment", AsyncMock(return_value=payment))
    monkeypatch.setattr(server, "_brand_name_of", AsyncMock(return_value="Bedrijf"))
    monkeypatch.setattr(server, "db", SimpleNamespace(
        payments=SimpleNamespace(find_one=AsyncMock(return_value=payment)),
        tenants=SimpleNamespace(find_one=AsyncMock(return_value={"name": "Huurder", "phone": "+5971234567"})),
    ))
    monkeypatch.setattr(messente_service, "send_whatsapp", send)
    monkeypatch.setenv("APP_PUBLIC_URL", "https://example.com")
    result = asyncio.run(server.kiosk_whatsapp_receipt("payment-2", _session={"company_id": "company-1"}))
    assert result["sent"] is True
    assert send.await_args.kwargs["template_kind"] == "receipt"
    assert send.await_args.kwargs["variables"]["3"] == "USD 25.00"
    assert send.await_args.kwargs["variables"]["4"] == "BON-2"


def test_overdue_reminder_uses_reminder_template(monkeypatch):
    import server
    import messente_service

    send = AsyncMock()
    monkeypatch.setattr(server, "_messente_or_400", AsyncMock(return_value={"reminder_template": "reminder"}))
    monkeypatch.setattr(server, "_calc_balance", AsyncMock(return_value={"balance": 50, "currency": "SRD"}))
    monkeypatch.setattr(server, "_brand_name_of", AsyncMock(return_value="Bedrijf"))
    monkeypatch.setattr(server, "scope", lambda user: {"company_id": "company-1"})
    monkeypatch.setattr(server, "company_id_of", lambda user: "company-1")
    monkeypatch.setattr(server, "db", SimpleNamespace(
        tenants=SimpleNamespace(find_one=AsyncMock(return_value={"name": "Huurder", "phone": "+5971234567"})),
    ))
    monkeypatch.setattr(messente_service, "send_whatsapp", send)
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
        {"receipt_template": "text", "receipt_media_template": "media"},
        "payment-1", "Huurder", "Bedrijf", "SRD 100", "BON-1", "old-link",
    )
    assert kind == "receipt_media"
    assert variables["5"].endswith(".jpg")
    token = variables["5"].rsplit("/", 1)[-1][:-4]
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
        server._receipt_template({"receipt_media_template": "media"}, "payment", "A", "B", "C", "D", "link")
    with pytest.raises(HTTPException):
        server._receipt_template({"receipt_media_template": "media"}, None, "A", "B", "C", "D", "link")
    kind, variables = server._receipt_template(
        {"receipt_media_template": "media", "receipt_template": "text"},
        None, "A", "B", "C", "D", "link",
    )
    assert kind == "receipt" and variables["5"] == "link"


@pytest.mark.parametrize("route", ["kiosk", "manual"])
def test_receipt_routes_prefer_media_template(monkeypatch, route):
    import server
    import messente_service

    send = AsyncMock()
    cfg = {"enabled": True, "whatsapp_from": "+14155550100",
           "receipt_template": "receipt", "receipt_media_template": "receipt_jpg"}
    payment = {"receipt_number": "BON-1", "currency": "SRD", "amount": 100, "tenant_id": "tenant-1"}
    monkeypatch.setenv("APP_PUBLIC_URL", "https://example.com")
    monkeypatch.setattr(server, "get_company_section", AsyncMock(return_value=cfg))
    monkeypatch.setattr(server, "_messente_or_400", AsyncMock(return_value=cfg))
    monkeypatch.setattr(server, "_enrich_payment", AsyncMock(return_value=payment))
    monkeypatch.setattr(server, "_brand_name_of", AsyncMock(return_value="Bedrijf"))
    monkeypatch.setattr(server, "scope", lambda user: {"company_id": "company-1"})
    monkeypatch.setattr(server, "company_id_of", lambda user: "company-1")
    monkeypatch.setattr(server, "db", SimpleNamespace(
        payments=SimpleNamespace(find_one=AsyncMock(return_value=payment)),
        tenants=SimpleNamespace(find_one=AsyncMock(return_value={"name": "Huurder", "phone": "+5971234567"})),
    ))
    monkeypatch.setattr(messente_service, "send_whatsapp", send)
    if route == "kiosk":
        result = asyncio.run(server.kiosk_whatsapp_receipt("payment-1", _session={"company_id": "company-1"}))
        assert result["sent"]
    else:
        result = asyncio.run(server.message_payment_receipt(
            "payment-1", server.MessageSendIn(channel="whatsapp"), user={"id": "admin"}
        ))
        assert result["ok"]
    assert send.await_args.kwargs["template_kind"] == "receipt_media"
    image_url = send.await_args.kwargs["variables"]["5"]
    assert image_url.startswith("https://example.com/api/public/whatsapp-receipts/")
    token = image_url.rsplit("/", 1)[-1].removesuffix(".jpg")
    assert server.jwt.decode(token, server.JWT_SECRET, algorithms=[server.JWT_ALG])["payment_id"] == "payment-1"


def test_old_provider_settings_are_not_used_as_messente_credentials(monkeypatch):
    import server

    monkeypatch.setattr(server, "db", SimpleNamespace(company_settings=SimpleNamespace(
        find_one=AsyncMock(return_value={"company_id": "company-1", "twilio": {
            "enabled": True, "account_sid": "old-provider", "auth_token": "old-secret",
        }}),
    )))
    cfg = asyncio.run(server.get_company_section("company-1", "messente"))
    assert cfg["enabled"] is False
    assert cfg["api_username"] is None and cfg["api_password"] is None


def test_settings_test_can_select_sms_when_whatsapp_is_configured(monkeypatch):
    import server
    import messente_service

    wa, sms = AsyncMock(), AsyncMock()
    monkeypatch.setattr(server, "company_id_of", lambda user: "company-1")
    monkeypatch.setattr(server, "get_company_section", AsyncMock(return_value={
        "enabled": True, "whatsapp_from": "+14155550100", "sms_from": "SuriRent",
    }))
    monkeypatch.setattr(server, "db", SimpleNamespace(
        companies=SimpleNamespace(find_one=AsyncMock(return_value={"name": "Bedrijf"})),
    ))
    monkeypatch.setattr(messente_service, "send_whatsapp", wa)
    monkeypatch.setattr(messente_service, "send_sms", sms)
    result = asyncio.run(server.test_settings_section(
        "messente", server.SettingsTestIn(to="+5971234567", channel="sms"), user={"id": "admin"},
    ))
    assert result["ok"]
    sms.assert_awaited_once()
    wa.assert_not_awaited()


def test_password_reset_uses_company_messente_sms(monkeypatch):
    import server
    import messente_service

    send = AsyncMock()
    config = AsyncMock(return_value={"enabled": True, "sms_from": "Bedrijf"})
    monkeypatch.setattr(server, "get_company_section", config)
    monkeypatch.setattr(messente_service, "send_sms", send)
    asyncio.run(server._send_password_reset_sms("+5971234567", "Huurder", "123456", "company-1"))
    config.assert_awaited_once_with("company-1", "messente")
    assert send.await_args.args[0]["sms_from"] == "Bedrijf"
    assert send.await_args.args[1] == "+5971234567"
    assert "123456" in send.await_args.args[2]
    assert send.await_args.kwargs == {}


@pytest.mark.parametrize("company_id", [None, "company-1"])
def test_password_reset_uses_encrypted_platform_account_when_no_enabled_company_config(monkeypatch, company_id):
    import server
    import messente_service
    from settings_service import merge_section

    send = AsyncMock()
    platform = merge_section("messente", {}, {
        "enabled": True, "api_username": "platform-user", "api_password": "platform-secret", "sms_from": "SuriRent",
    })
    monkeypatch.setattr(server, "get_company_section", AsyncMock(return_value={"enabled": False}))
    monkeypatch.setattr(server, "db", SimpleNamespace(
        saas_settings=SimpleNamespace(find_one=AsyncMock(return_value={"messente": platform})),
    ))
    monkeypatch.setattr(messente_service, "send_sms", send)
    asyncio.run(server._send_password_reset_sms("+5971234567", "Huurder", "123456", company_id))
    assert send.await_args.args[0]["api_password"] == "platform-secret"
    assert send.await_args.args[0]["api_username"] == "platform-user"


def test_password_reset_does_not_retry_rejected_company_send_using_platform(monkeypatch):
    import server
    import messente_service

    send = AsyncMock(side_effect=messente_service.MessenteError("Rejected"))
    lookup = AsyncMock()
    monkeypatch.setattr(server, "get_company_section", AsyncMock(return_value={"enabled": True}))
    monkeypatch.setattr(server, "db", SimpleNamespace(saas_settings=SimpleNamespace(find_one=lookup)))
    monkeypatch.setattr(messente_service, "send_sms", send)
    with pytest.raises(messente_service.MessenteError):
        asyncio.run(server._send_password_reset_sms("+5971234567", "Huurder", "123456", "company-1"))
    lookup.assert_not_awaited()
    send.assert_awaited_once()


def test_platform_messente_save_masks_credentials_and_preserves_existing_secrets(monkeypatch):
    import server
    from settings_service import MASK, decrypt, merge_section

    stored = merge_section("messente", {}, {"api_password": "original"})
    update = AsyncMock()
    monkeypatch.setattr(server, "db", SimpleNamespace(saas_settings=SimpleNamespace(
        find_one=AsyncMock(return_value={"messente": stored}), update_one=update,
    )))
    result = asyncio.run(server.update_saas_messente(
        {"api_username": "platform-user", "api_password": MASK, "sms_from": "SuriRent", "enabled": True},
        user={"role": "superadmin", "email": "admin@example.com"},
    ))
    assert result["data"]["api_username"] == result["data"]["api_password"] == MASK
    persisted = update.await_args.args[1]["$set"]["messente"]
    assert decrypt(persisted["api_username"]) == "platform-user"
    assert decrypt(persisted["api_password"]) == "original"
    assert update.await_args.args[0] == {"id": server.SAAS_SETTINGS_ID}


@pytest.mark.parametrize("role,expected", [("admin", 403), ("superadmin", 200)])
def test_platform_messente_endpoints_require_superadmin(monkeypatch, role, expected):
    import server
    import messente_service
    from settings_service import merge_section, MASK

    cfg = merge_section("messente", {}, {
        "enabled": True, "api_username": "platform-user", "api_password": "platform-secret", "sms_from": "SuriRent",
    })
    doc = {"messente": cfg}
    monkeypatch.setattr(server, "db", SimpleNamespace(saas_settings=SimpleNamespace(
        find_one=AsyncMock(return_value=doc), update_one=AsyncMock(),
    )))
    send = AsyncMock()
    monkeypatch.setattr(messente_service, "send_sms", send)
    monkeypatch.setitem(server.app.dependency_overrides, server.get_current_user, lambda: {"id": "test", "role": role})

    async def request():
        async with AsyncClient(transport=ASGITransport(app=server.app), base_url="http://test") as client:
            return [
                await client.get("/api/superadmin/settings"),
                await client.put("/api/superadmin/settings/messente", json={"sms_from": "SuriRent"}),
                await client.post("/api/superadmin/settings/messente/test", json={"to": "+5971234567", "channel": "sms"}),
            ]

    results = asyncio.run(request())
    assert [response.status_code for response in results] == [expected] * 3
    if role == "superadmin":
        assert results[0].json()["messente"]["api_password"] == MASK
        assert results[1].json()["data"]["api_username"] == MASK
        assert results[2].json()["ok"]
        assert send.await_args.args[0]["api_password"] == "platform-secret"
    else:
        send.assert_not_awaited()


@pytest.mark.parametrize("exists", [False, True])
def test_forgot_password_sms_route_is_generic_and_uses_stored_contact(monkeypatch, exists):
    import server

    send_sms, send_email = AsyncMock(), AsyncMock()
    monkeypatch.setattr(server, "_send_password_reset_sms", send_sms)
    monkeypatch.setattr(server, "_send_password_reset_email", send_email)
    monkeypatch.setattr(server, "db", SimpleNamespace(
        users=SimpleNamespace(find_one=AsyncMock(return_value={
            "email": "user@example.com", "name": "Gebruiker", "company_id": "company-1",
        } if exists else None)),
        companies=SimpleNamespace(find_one=AsyncMock(return_value={"contact_phone": "+5971234567"})),
        password_reset_tokens=SimpleNamespace(update_one=AsyncMock()),
    ))

    async def request():
        async with AsyncClient(transport=ASGITransport(app=server.app), base_url="http://test") as client:
            sms = await client.post("/api/auth/forgot-password", json={"email": "user@example.com", "channel": "sms"})
            old_channel = await client.post("/api/auth/forgot-password", json={"email": "user@example.com", "channel": "whatsapp"})
            return sms, old_channel

    result, old_channel = asyncio.run(request())
    assert result.status_code == 200 and result.json() == {
        "ok": True, "message": "Als dit account bestaat, is een herstelcode verzonden via SMS.",
    }
    assert old_channel.status_code == 422
    send_email.assert_not_awaited()
    if exists:
        assert send_sms.await_args.args[0] == "+5971234567"
        assert send_sms.await_args.args[3] == "company-1"
    else:
        send_sms.assert_not_awaited()


@pytest.mark.parametrize("channel", ["whatsapp", "sms"])
def test_paid_installment_notification_uses_messente_and_supports_sms_only(monkeypatch, channel):
    import server
    import messente_service

    wa, sms = AsyncMock(), AsyncMock()
    cfg = {"enabled": True, "sms_from": "SuriRent", "receipt_media_template": "receipt_jpg"}
    if channel == "whatsapp":
        cfg["whatsapp_from"] = "+14155550100"
    monkeypatch.setenv("APP_PUBLIC_URL", "https://example.com")
    monkeypatch.setattr(server, "get_company_section", AsyncMock(side_effect=lambda cid, section: cfg if section == "messente" else {}))
    monkeypatch.setattr(server, "_brand_name_of", AsyncMock(return_value="Bedrijf"))
    monkeypatch.setattr(server, "_notify_kiosk_employees", AsyncMock())
    monkeypatch.setattr(messente_service, "send_whatsapp", wa)
    monkeypatch.setattr(messente_service, "send_sms", sms)
    monkeypatch.setattr(server, "db", SimpleNamespace(
        payment_plans=SimpleNamespace(find_one=AsyncMock(return_value={
            "id": "plan-1", "tenant_id": "tenant-1", "company_id": "company-1", "currency": "SRD",
        })),
        tenants=SimpleNamespace(find_one=AsyncMock(return_value={"name": "Huurder", "phone": "+5971234567"})),
        payment_plan_installments=SimpleNamespace(
            find_one=AsyncMock(side_effect=[{"amount": 100, "payment_id": "payment-1"}, None]),
            count_documents=AsyncMock(side_effect=[1, 1]),
        ),
    ))
    asyncio.run(server._notify_tenant_installment_paid("plan-1", 1))
    if channel == "sms":
        sms.assert_awaited_once()
        wa.assert_not_awaited()
    else:
        wa.assert_awaited_once()
        assert wa.await_args.kwargs["template_kind"] == "receipt_media"
        assert wa.await_args.kwargs["variables"]["5"].startswith("https://example.com/api/public/whatsapp-receipts/")
        sms.assert_not_awaited()


def test_tenant_pin_recovery_uses_authentication_template_and_sms_fallback(monkeypatch):
    import server
    import messente_service

    wa = AsyncMock(side_effect=messente_service.MessenteError("Template geweigerd"))
    sms = AsyncMock()
    monkeypatch.setattr(messente_service, "send_whatsapp", wa)
    monkeypatch.setattr(messente_service, "send_sms", sms)
    monkeypatch.setattr(server, "_client_ip", lambda request: "test-ip")
    monkeypatch.setattr(server, "_pin_throttle_check", lambda key: None)
    monkeypatch.setattr(server, "_pin_throttle_clear", lambda key: None)
    monkeypatch.setattr(server, "_generate_unique_pin", lambda used: "4321")
    monkeypatch.setattr(server, "get_company_section", AsyncMock(return_value={
        "enabled": True, "whatsapp_from": "+14155550100", "sms_from": "SuriRent", "authentication_template": "otp",
    }))
    monkeypatch.setattr(server, "db", SimpleNamespace(
        tenants=SimpleNamespace(
            find_one=AsyncMock(return_value={"id": "tenant-1", "name": "Huurder", "phone": "+5971234567"}),
            find=lambda *args: SimpleNamespace(to_list=AsyncMock(return_value=[])),
            update_one=AsyncMock(),
        ),
        companies=SimpleNamespace(find_one=AsyncMock(return_value={"name": "Bedrijf"})),
    ))
    result = asyncio.run(server.tenant_forgot_pin(
        server.TenantForgotPinIn(company_id="company-1", identifier="+5971234567"), request=None,
    ))
    assert result["via"] == ["sms"]
    assert wa.await_args.kwargs == {"template_kind": "authentication", "variables": {"1": "4321"}}
    sms.assert_awaited_once()
