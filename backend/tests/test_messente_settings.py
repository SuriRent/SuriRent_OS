import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from httpx import ASGITransport, AsyncClient


class AsyncItems:
    def __init__(self, items):
        self.items = items

    def __aiter__(self):
        async def iterate():
            for item in self.items:
                yield item
        return iterate()


def test_overdue_invoice_sms_sends_once_next_day_even_with_whatsapp(monkeypatch):
    from datetime import datetime, timezone
    from pymongo.errors import DuplicateKeyError
    import server

    invoices = [
        {"id": "due", "company_id": "company-1", "tenant_id": "tenant-1", "status": "open",
         "due_date": "2026-08-10", "amount": 100, "paid_amount": 25, "invoice_number": "F-1"},
        {"id": "paid", "company_id": "company-1", "tenant_id": "tenant-1", "status": "paid",
         "due_date": "2026-08-10", "amount": 100, "paid_amount": 100},
        {"id": "older", "company_id": "company-1", "tenant_id": "tenant-1", "status": "open",
         "due_date": "2026-08-09", "amount": 100},
        {"id": "fully-paid", "company_id": "company-1", "tenant_id": "tenant-1", "status": "open",
         "due_date": "2026-08-10", "amount": 100, "paid_amount": 100},
    ]
    markers = {}

    def find_invoices(query, projection):
        return AsyncItems([i for i in invoices if i["company_id"] == query["company_id"]
                           and i["due_date"] == query["due_date"]
                           and i["status"] not in query["status"]["$nin"]])

    async def insert_marker(marker):
        key = (marker["invoice_id"], marker["days_bucket"])
        if key in markers:
            raise DuplicateKeyError("duplicate")
        markers[key] = marker

    async def update_marker(query, update):
        markers[(query["invoice_id"], query["days_bucket"])].update(update["$set"])

    send = AsyncMock()
    monkeypatch.setattr(server, "now_utc", lambda: datetime(2026, 8, 11, 12, 0, tzinfo=timezone.utc))
    monkeypatch.setattr(server, "get_company_section", AsyncMock(return_value={
        "enabled": True, "whatsapp_from": "+14155550100",
    }))
    monkeypatch.setattr(server, "_messente_send", send)
    tenant_lookup = AsyncMock(return_value={"phone": "+5971234567"})
    monkeypatch.setattr(server, "db", SimpleNamespace(
        company_settings=SimpleNamespace(find=lambda *args: AsyncItems([
            {"company_id": "company-1", "invoicing": {"reminder_days_before": 4}},
            {"company_id": "company-2", "invoicing": {"reminder_days_before": 0}},
        ])),
        invoices=SimpleNamespace(find=find_invoices),
        tenants=SimpleNamespace(find_one=tenant_lookup),
        sent_upcoming_invoice_reminders=SimpleNamespace(
            insert_one=AsyncMock(side_effect=insert_marker), update_one=AsyncMock(side_effect=update_marker),
        ),
    ))

    asyncio.run(server._send_overdue_invoice_sms())
    asyncio.run(server._send_overdue_invoice_sms())
    send.assert_awaited_once()
    assert send.await_args.args[1:3] == ("sms", "+5971234567")
    assert send.await_args.args[3] == (
        "Factuur F-1 is vervallen. Openstaand saldo: SRD 75,00. "
        "Betaal zo spoedig mogelijk om een boete en extra kosten te voorkomen."
    )
    assert tenant_lookup.await_args.args[0] == {"id": "tenant-1", "company_id": "company-1"}
    assert markers[("due", -1)]["sms_status"] == "accepted"


def test_overdue_invoice_sms_records_failure_without_retry(monkeypatch):
    from datetime import datetime, timezone
    from pymongo.errors import DuplicateKeyError
    import server

    marker = {}

    async def insert(doc):
        if marker:
            raise DuplicateKeyError("duplicate")
        marker.update(doc)

    async def update(query, changes):
        marker.update(changes["$set"])

    send = AsyncMock(side_effect=RuntimeError("provider unavailable"))
    monkeypatch.setattr(server, "now_utc", lambda: datetime(2026, 8, 11, 12, tzinfo=timezone.utc))
    monkeypatch.setattr(server, "get_company_section", AsyncMock(return_value={"enabled": True}))
    monkeypatch.setattr(server, "_messente_send", send)
    monkeypatch.setattr(server, "db", SimpleNamespace(
        company_settings=SimpleNamespace(find=lambda *args: AsyncItems([
            {"company_id": "company-1", "invoicing": {"reminder_days_before": 4}},
        ])),
        invoices=SimpleNamespace(find=lambda *args: AsyncItems([
            {"id": "inv-1", "tenant_id": "tenant-1", "amount": 100},
        ])),
        tenants=SimpleNamespace(find_one=AsyncMock(return_value={"phone": "+5971234567"})),
        sent_upcoming_invoice_reminders=SimpleNamespace(
            insert_one=AsyncMock(side_effect=insert), update_one=AsyncMock(side_effect=update),
        ),
    ))
    asyncio.run(server._send_overdue_invoice_sms())
    asyncio.run(server._send_overdue_invoice_sms())
    send.assert_awaited_once()
    assert marker["sms_status"] == "failed"


@pytest.mark.parametrize("messente_enabled,phone", [(False, "+5971234567"), (True, "")])
def test_overdue_invoice_sms_requires_enabled_messente_and_phone(monkeypatch, messente_enabled, phone):
    from datetime import datetime, timezone
    import server

    send, insert = AsyncMock(), AsyncMock()
    monkeypatch.setattr(server, "now_utc", lambda: datetime(2026, 8, 11, 12, tzinfo=timezone.utc))
    monkeypatch.setattr(server, "get_company_section", AsyncMock(return_value={"enabled": messente_enabled}))
    monkeypatch.setattr(server, "_messente_send", send)
    monkeypatch.setattr(server, "db", SimpleNamespace(
        company_settings=SimpleNamespace(find=lambda *args: AsyncItems([
            {"company_id": "company-1", "invoicing": {"reminder_days_before": 4}},
        ])),
        invoices=SimpleNamespace(find=lambda *args: AsyncItems([
            {"id": "inv-1", "tenant_id": "tenant-1", "amount": 100},
        ])),
        tenants=SimpleNamespace(find_one=AsyncMock(return_value={"phone": phone})),
        sent_upcoming_invoice_reminders=SimpleNamespace(insert_one=insert),
    ))
    asyncio.run(server._send_overdue_invoice_sms())
    send.assert_not_awaited()
    insert.assert_not_awaited()


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
def test_receipt_endpoint_supplies_template_data_or_sms_link(monkeypatch, channel):
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
        sms_receipt_links=SimpleNamespace(insert_one=AsyncMock()),
    ))
    monkeypatch.setattr(messente_service, "send_whatsapp", send_wa)
    monkeypatch.setattr(server, "_send_company_sms", send_sms)
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


def test_sms_receipt_link_is_scoped_and_expires(monkeypatch):
    import hashlib
    from datetime import timedelta
    from urllib.parse import urlsplit
    import server
    from fastapi.responses import Response

    monkeypatch.setenv("APP_PUBLIC_URL", "https://example.com")
    now = server.now_utc()
    clock = [now]
    saved = {}
    payment = {"id": "payment-1", "company_id": "company-1"}

    async def insert(doc):
        saved.update(doc)

    async def find_link(query):
        if query["_id"] == saved.get("_id") and saved["expires_at"] > query["expires_at"]["$gt"]:
            return saved
        return None

    async def find_payment(query, projection):
        return payment if query == payment else None

    monkeypatch.setattr(server, "now_utc", lambda: clock[0])
    monkeypatch.setattr(server, "db", SimpleNamespace(
        sms_receipt_links=SimpleNamespace(insert_one=insert, find_one=find_link),
        payments=SimpleNamespace(find_one=find_payment),
    ))
    image = AsyncMock(return_value=Response(b"jpeg-data", media_type="image/jpeg"))
    monkeypatch.setattr(server, "_payment_image_response", image)
    message = asyncio.run(server._receipt_sms("company-1", "payment-1", "SRD", 100))
    url = message.split()[-1]
    token = url.rsplit("/", 1)[-1]
    assert saved["_id"] == hashlib.sha256(token.encode()).hexdigest()
    assert saved["expires_at"] == now + timedelta(days=30)
    assert token not in str(saved)

    async def request(path):
        async with AsyncClient(transport=ASGITransport(app=server.app), base_url="http://test") as client:
            return await client.get(path)

    response = asyncio.run(request(urlsplit(url).path))
    assert response.status_code == 200 and response.content == b"jpeg-data"
    assert response.headers["cache-control"] == "private, no-store"
    image.assert_awaited_once_with(payment)
    saved["company_id"] = "other-company"
    assert asyncio.run(request(urlsplit(url).path)).status_code == 404
    saved["company_id"] = "company-1"
    assert asyncio.run(request("/api/r/" + "A" * 22)).status_code == 404
    clock[0] = now + timedelta(days=30)
    assert asyncio.run(request(urlsplit(url).path)).status_code == 404


@pytest.mark.parametrize("route", ["manual", "kiosk", "kiosk_fallback"])
def test_payment_receipt_sms_contains_short_link(monkeypatch, route):
    import server
    import messente_service

    cfg = {"enabled": True, "sms_from": "SuriRent"}
    if route == "kiosk_fallback":
        cfg["whatsapp_from"] = "+14155550100"
    payment = {"id": "payment-1", "company_id": "company-1", "receipt_number": "BON-1",
               "currency": "SRD", "amount": 100, "tenant_id": "tenant-1"}
    sms = AsyncMock()
    links = AsyncMock()
    monkeypatch.setenv("APP_PUBLIC_URL", "https://example.com")
    monkeypatch.setattr(server, "get_company_section", AsyncMock(return_value=cfg))
    monkeypatch.setattr(server, "_messente_or_400", AsyncMock(return_value=cfg))
    monkeypatch.setattr(server, "_enrich_payment", AsyncMock(return_value=payment))
    monkeypatch.setattr(server, "_brand_name_of", AsyncMock(return_value="Bedrijf"))
    monkeypatch.setattr(server, "scope", lambda user: {"company_id": "company-1"})
    monkeypatch.setattr(server, "company_id_of", lambda user: "company-1")
    monkeypatch.setattr(server, "_send_company_sms", sms)
    monkeypatch.setattr(messente_service, "send_whatsapp", AsyncMock(side_effect=messente_service.MessenteError("failed")))
    monkeypatch.setattr(server, "db", SimpleNamespace(
        payments=SimpleNamespace(find_one=AsyncMock(return_value=payment)),
        tenants=SimpleNamespace(find_one=AsyncMock(return_value={"name": "Huurder", "phone": "+5971234567"})),
        sms_receipt_links=SimpleNamespace(insert_one=links),
    ))
    if route == "manual":
        result = asyncio.run(server.message_payment_receipt(
            "payment-1", server.MessageSendIn(channel="sms"), user={"id": "admin"}
        ))
        assert result["ok"]
    else:
        result = asyncio.run(server.kiosk_whatsapp_receipt("payment-1", _session={"company_id": "company-1"}))
        assert result["sent"] and result["channel"] == "sms"
    text = sms.await_args.args[3]
    messente_service.validate_sms_body(text)
    assert "Bekijk bon: https://example.com/api/r/" in text
    assert "foto meegestuurd" not in text
    assert links.await_args.args[0]["company_id"] == "company-1"


def test_sms_receipt_rejects_long_custom_text_before_saving_link(monkeypatch):
    import server
    from messente_service import MessenteError

    monkeypatch.setenv("APP_PUBLIC_URL", "https://example.com")
    insert = AsyncMock()
    monkeypatch.setattr(server, "db", SimpleNamespace(sms_receipt_links=SimpleNamespace(insert_one=insert)))
    with pytest.raises(MessenteError, match="één SMS"):
        asyncio.run(server._receipt_sms("company-1", "payment-1", "SRD", 100, "a" * 160))
    insert.assert_not_awaited()


def test_auto_invoice_sms_always_uses_sms_and_private_invoice_link(monkeypatch):
    from datetime import timedelta
    import server
    from fastapi.responses import Response
    from urllib.parse import urlsplit

    now = server.now_utc()
    clock = [now]
    saved = {}
    invoice = {"id": "invoice-1", "company_id": "company-1", "invoice_number": "F2026-00001",
               "currency": "SRD", "amount": 100}

    async def insert(doc):
        saved.update(doc)

    async def find_link(query):
        return saved if query["_id"] == saved.get("_id") and saved["expires_at"] > query["expires_at"]["$gt"] else None

    async def find_invoice(query, projection):
        if query == {"id": invoice["id"], "company_id": invoice["company_id"]}:
            return invoice
        return None

    send = AsyncMock()
    render = AsyncMock(return_value=Response(b"invoice-jpg", media_type="image/jpeg"))
    monkeypatch.setenv("APP_PUBLIC_URL", "https://example.com")
    monkeypatch.setattr(server, "now_utc", lambda: clock[0])
    monkeypatch.setattr(server, "get_company_section", AsyncMock(return_value={
        "enabled": True, "sms_from": "SuriRent", "whatsapp_from": "+14155550100",
    }))
    monkeypatch.setattr(server, "_send_company_sms", send)
    monkeypatch.setattr(server, "_invoice_image_response", render)
    monkeypatch.setattr(server, "db", SimpleNamespace(
        sms_receipt_links=SimpleNamespace(insert_one=insert, find_one=find_link),
        invoices=SimpleNamespace(find_one=find_invoice),
    ))
    asyncio.run(server._notify_auto_invoice_sms(invoice, {"phone": "+5971234567"}))
    send.assert_awaited_once()
    text = send.await_args.args[3]
    from messente_service import validate_sms_body
    validate_sms_body(text)
    assert text.startswith("Factuur F2026-00001: SRD 100.00. Bekijk factuur: ")
    assert send.await_args.args[4] == "Nieuwe factuur"
    assert saved["expires_at"] == now + timedelta(days=30)
    assert saved["document_type"] == "invoice"

    async def request():
        async with AsyncClient(transport=ASGITransport(app=server.app), base_url="http://test") as client:
            return await client.get(urlsplit(text.split()[-1]).path)

    response = asyncio.run(request())
    assert response.status_code == 200 and response.content == b"invoice-jpg"
    assert response.headers["cache-control"] == "private, no-store"
    saved["company_id"] = "other-company"
    assert asyncio.run(request()).status_code == 404
    saved["company_id"] = "company-1"
    clock[0] += timedelta(days=30)
    assert asyncio.run(request()).status_code == 404


def test_auto_invoice_sms_failure_does_not_break_invoice_creation(monkeypatch, caplog):
    import server

    invoice = {"id": "invoice-1", "company_id": "company-1", "invoice_number": "F1",
               "currency": "SRD", "amount": 100}
    monkeypatch.setattr(server, "get_company_section", AsyncMock(return_value={"enabled": False}))
    send = AsyncMock()
    monkeypatch.setattr(server, "_send_company_sms", send)
    asyncio.run(server._notify_auto_invoice_sms(invoice, {"phone": "+5971234567"}))
    send.assert_not_awaited()
    assert "Automatische factuur-SMS niet verzonden" in caplog.text


@pytest.mark.parametrize("notify", [True, False])
def test_invoice_generation_notifies_only_new_invoices_after_credit(monkeypatch, notify):
    import server

    tenant = {"id": "tenant-1", "phone": "+5971234567"}
    apartment = {"id": "apt-1", "tenant_id": "tenant-1", "rent_amount": 100}
    invoices = {}

    async def find_invoice(query, *args):
        return next(iter(invoices.values()), None)

    async def insert_invoice(doc):
        invoices[doc["id"]] = dict(doc)

    async def apply_credit(*args):
        invoices[args[1]]["paid_amount"] = 20
        return 20

    async def notify_invoice(invoice, recipient):
        assert invoices[invoice["id"]]["paid_amount"] == 20
        assert recipient == tenant

    notify_mock = AsyncMock(side_effect=notify_invoice)
    monkeypatch.setattr(server, "_notify_auto_invoice_sms", notify_mock)
    monkeypatch.setattr(server, "_apply_tenant_credit_to_invoice", apply_credit)
    monkeypatch.setattr(server, "_next_seq", AsyncMock(return_value=1))
    monkeypatch.setattr(server, "db", SimpleNamespace(
        company_settings=SimpleNamespace(find_one=AsyncMock(return_value={})),
        apartments=SimpleNamespace(find=lambda *args: SimpleNamespace(to_list=AsyncMock(return_value=[apartment]))),
        tenants=SimpleNamespace(find_one=AsyncMock(return_value=tenant)),
        invoices=SimpleNamespace(find_one=find_invoice, insert_one=insert_invoice),
    ))
    async def run():
        first = await server._generate_month_invoices_for_company("company-1", 1, 2026, notify_sms=notify)
        second = await server._generate_month_invoices_for_company("company-1", 1, 2026, notify_sms=notify)
        await asyncio.sleep(0)
        return first, second

    first, second = asyncio.run(run())
    assert first["created"] == 1 and second["skipped"] == 1
    assert notify_mock.await_count == int(notify)


@pytest.mark.parametrize("existing", [False, True])
def test_invoice_created_by_payment_notifies_after_payment_allocation(monkeypatch, existing):
    import server

    tenant = {"id": "tenant-1", "company_id": "company-1", "apartment_id": "apt-1",
              "phone": "+5971234567"}
    invoice = {"id": "invoice-existing", "amount": 100, "paid_amount": 0}
    applied = AsyncMock()
    async def notify_after_allocation(*args):
        applied.assert_awaited_once()
    notified = AsyncMock(side_effect=notify_after_allocation)
    monkeypatch.setattr(server, "_next_receipt_number", AsyncMock(return_value="BON-1"))
    monkeypatch.setattr(server, "_next_seq", AsyncMock(return_value=1))
    monkeypatch.setattr(server, "_apply_payment_to_invoice", applied)
    monkeypatch.setattr(server, "_notify_auto_invoice_sms", notified)
    monkeypatch.setattr(server, "_notify_tenant_payment", AsyncMock())
    monkeypatch.setattr(server, "_reconcile_power_after_payment", AsyncMock())
    monkeypatch.setattr(server, "db", SimpleNamespace(
        tenants=SimpleNamespace(find_one=AsyncMock(return_value=tenant)),
        companies=SimpleNamespace(find_one=AsyncMock(return_value={"name": "Bedrijf"})),
        apartments=SimpleNamespace(find_one=AsyncMock(return_value={"rent_amount": 100, "currency": "SRD"})),
        invoices=SimpleNamespace(find_one=AsyncMock(return_value=invoice if existing else None), insert_one=AsyncMock()),
        payments=SimpleNamespace(insert_one=AsyncMock()),
    ))

    async def run():
        result = await server._create_payment_doc(
            server.PaymentIn(tenant_id="tenant-1", amount=100, period_month=1, period_year=2026),
            company_id="company-1",
        )
        await asyncio.sleep(0)
        return result

    result = asyncio.run(run())
    applied.assert_awaited_once()
    if existing:
        notified.assert_not_awaited()
    else:
        notified.assert_awaited_once()
        assert notified.await_args.args[0]["id"] == result["invoice_id"]


def test_automatic_invoice_triggers_enable_sms(monkeypatch):
    import server

    class SettingsCursor:
        def __aiter__(self):
            async def items():
                yield {"company_id": "company-1", "invoicing": {
                    "auto_generate": True, "mode": "fixed_day", "billing_day": 1,
                }}
            return items()

    generate = AsyncMock(return_value={"created": 1, "skipped": 0, "credit_applied": 0})
    monkeypatch.setattr(server, "_generate_month_invoices_for_company", generate)
    monkeypatch.setattr(server, "_notify_company_admins", AsyncMock())
    monkeypatch.setattr(server, "db", SimpleNamespace(
        company_settings=SimpleNamespace(find=lambda *args: SettingsCursor(), update_one=AsyncMock()),
        tenants=SimpleNamespace(update_one=AsyncMock()),
        contracts=SimpleNamespace(update_many=AsyncMock()),
    ))
    asyncio.run(server._auto_invoice_tick())
    assert generate.await_args.kwargs == {"notify_sms": True}
    generate.reset_mock()
    asyncio.run(server._activate_after_deposit("company-1", "tenant-1", "deposit-1"))
    assert generate.await_args.kwargs == {"only_tenant_id": "tenant-1", "notify_sms": True}


def test_kiosk_sms_custom_message_uses_only_tenant_phone_and_company(monkeypatch):
    import server
    import messente_service

    tenant_find = AsyncMock(return_value={"name": "Huurder", "phone": "+5971234567"})
    sms = AsyncMock()
    monkeypatch.setattr(server, "db", SimpleNamespace(tenants=SimpleNamespace(find_one=tenant_find)))
    monkeypatch.setattr(server, "get_company_section", AsyncMock(return_value={"enabled": True}))
    monkeypatch.setattr(server, "_send_company_sms", sms)
    result = asyncio.run(server.kiosk_tenant_send_sms(
        "tenant-1", server.KioskTenantSmsIn(action="message", message="Hallo"),
        session={"company_id": "company-1"},
    ))
    assert result["ok"]
    assert tenant_find.await_args.args[0] == {"id": "tenant-1", "company_id": "company-1"}
    assert sms.await_args.args == ("company-1", {"enabled": True}, "+5971234567", "Hallo", "Vrij bericht")
    sms.reset_mock()
    with pytest.raises(HTTPException) as error:
        asyncio.run(server.kiosk_tenant_send_sms(
            "tenant-1", server.KioskTenantSmsIn(action="message", message="  "),
            session={"company_id": "company-1"},
        ))
    assert error.value.status_code == 400
    sms.assert_not_awaited()
    monkeypatch.setattr(server, "_send_company_sms", AsyncMock(side_effect=messente_service.MessenteError("SMS-bericht is te lang")))
    with pytest.raises(HTTPException, match="SMS-bericht is te lang"):
        asyncio.run(server.kiosk_tenant_send_sms(
            "tenant-1", server.KioskTenantSmsIn(action="message", message="x" * 161),
            session={"company_id": "company-1"},
        ))


def test_kiosk_sms_options_are_scoped_to_selected_tenant(monkeypatch):
    import server
    from unittest.mock import Mock

    def cursor(data):
        return SimpleNamespace(sort=Mock(return_value=SimpleNamespace(to_list=AsyncMock(return_value=data))))

    invoices = Mock(return_value=cursor([{"id": "invoice-1"}]))
    payments = Mock(return_value=cursor([{"id": "payment-1"}]))
    monkeypatch.setattr(server, "db", SimpleNamespace(
        tenants=SimpleNamespace(find_one=AsyncMock(return_value={"name": "Huurder", "phone": "+5971234567"})),
        invoices=SimpleNamespace(find=invoices), payments=SimpleNamespace(find=payments),
    ))
    result = asyncio.run(server.kiosk_tenant_sms_options("tenant-1", session={"company_id": "company-1"}))
    assert result["invoices"] == [{"id": "invoice-1"}]
    assert result["payments"] == [{"id": "payment-1"}]
    for find in (invoices, payments):
        assert find.call_args.args[0]["tenant_id"] == "tenant-1"
        assert find.call_args.args[0]["company_id"] == "company-1"


@pytest.mark.parametrize("action", ["invoice", "receipt"])
def test_kiosk_sms_document_requires_selected_tenant_and_company(monkeypatch, action):
    import server

    lookup = AsyncMock(return_value=None)
    send_invoice, send_receipt = AsyncMock(), AsyncMock()
    monkeypatch.setattr(server, "db", SimpleNamespace(
        tenants=SimpleNamespace(find_one=AsyncMock(return_value={"phone": "+5971234567"})),
        invoices=SimpleNamespace(find_one=lookup), payments=SimpleNamespace(find_one=lookup),
    ))
    monkeypatch.setattr(server, "message_invoice", send_invoice)
    monkeypatch.setattr(server, "message_payment_receipt", send_receipt)
    request = server.KioskTenantSmsIn(action=action, document_id="other-document")
    with pytest.raises(HTTPException) as error:
        asyncio.run(server.kiosk_tenant_send_sms("tenant-1", request, session={"company_id": "company-1"}))
    assert error.value.status_code == 404
    assert lookup.await_args.args[0]["tenant_id"] == "tenant-1"
    assert lookup.await_args.args[0]["company_id"] == "company-1"
    send_invoice.assert_not_awaited()
    send_receipt.assert_not_awaited()
    lookup.return_value = {"_id": "found"}
    asyncio.run(server.kiosk_tenant_send_sms("tenant-1", request, session={"company_id": "company-1"}))
    chosen = send_invoice if action == "invoice" else send_receipt
    assert chosen.await_args.args[0] == "other-document"
    assert chosen.await_args.args[1].channel == "sms"
    assert chosen.await_args.kwargs["user"]["active_company_id"] == "company-1"


@pytest.mark.parametrize("action", ["reminder", "signature"])
def test_kiosk_sms_uses_existing_tenant_actions(monkeypatch, action):
    import server

    reminder, signature = AsyncMock(), AsyncMock()
    monkeypatch.setattr(server, "db", SimpleNamespace(
        tenants=SimpleNamespace(find_one=AsyncMock(return_value={"phone": "+5971234567"})),
    ))
    monkeypatch.setattr(server, "tenant_payment_reminder", reminder)
    monkeypatch.setattr(server, "request_tenant_signature", signature)
    asyncio.run(server.kiosk_tenant_send_sms(
        "tenant-1", server.KioskTenantSmsIn(action=action), session={"company_id": "company-1"},
    ))
    chosen = reminder if action == "reminder" else signature
    chosen.assert_awaited_once()
    assert chosen.await_args.kwargs["user"]["active_company_id"] == "company-1"


def test_kiosk_sms_rejects_missing_session_and_other_company_tenant(monkeypatch):
    import server

    find = AsyncMock(return_value=None)
    monkeypatch.setattr(server, "db", SimpleNamespace(tenants=SimpleNamespace(find_one=find)))
    with pytest.raises(HTTPException) as error:
        asyncio.run(server.kiosk_tenant_send_sms(
            "tenant-other", server.KioskTenantSmsIn(action="message", message="Hallo"),
            session={"company_id": "company-1"},
        ))
    assert error.value.status_code == 404
    assert find.await_args.args[0] == {"id": "tenant-other", "company_id": "company-1"}

    async def request():
        async with AsyncClient(transport=ASGITransport(app=server.app), base_url="http://test") as client:
            return await client.post("/api/kiosk/tenants/tenant-other/sms", json={"action": "message", "message": "Hallo"})

    assert asyncio.run(request()).status_code == 401


def test_kiosk_sms_http_endpoint_uses_unlocked_kiosk_session(monkeypatch):
    import server

    send = AsyncMock()
    monkeypatch.setitem(server.app.dependency_overrides, server.get_kiosk_session,
                        lambda: {"company_id": "company-1"})
    monkeypatch.setattr(server, "db", SimpleNamespace(
        tenants=SimpleNamespace(find_one=AsyncMock(return_value={"phone": "+5971234567"})),
    ))
    monkeypatch.setattr(server, "get_company_section", AsyncMock(return_value={"enabled": True}))
    monkeypatch.setattr(server, "_send_company_sms", send)

    async def request():
        async with AsyncClient(transport=ASGITransport(app=server.app), base_url="http://test") as client:
            return await client.post("/api/kiosk/tenants/tenant-1/sms", json={"action": "message", "message": "Hallo"})

    response = asyncio.run(request())
    assert response.status_code == 200 and response.json()["ok"]
    assert send.await_args.args[0:4] == ("company-1", {"enabled": True}, "+5971234567", "Hallo")


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
    monkeypatch.setattr(server, "_send_company_sms", sms)
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
    monkeypatch.setattr(server, "_send_company_sms", send)
    asyncio.run(server._send_password_reset_sms("+5971234567", "Huurder", "123456", "company-1"))
    config.assert_awaited_once_with("company-1", "messente")
    assert send.await_args.args[0] == "company-1"
    assert send.await_args.args[1]["sms_from"] == "Bedrijf"
    assert send.await_args.args[2] == "+5971234567"
    assert "123456" in send.await_args.args[3]
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
    if company_id:
        monkeypatch.setattr(server, "_send_company_sms", send)
    else:
        monkeypatch.setattr(messente_service, "send_sms", send)
    asyncio.run(server._send_password_reset_sms("+5971234567", "Huurder", "123456", company_id))
    cfg = send.await_args.args[1 if company_id else 0]
    assert cfg["api_password"] == "platform-secret"
    assert cfg["api_username"] == "platform-user"


def test_password_reset_does_not_retry_rejected_company_send_using_platform(monkeypatch):
    import server
    import messente_service

    send = AsyncMock(side_effect=messente_service.MessenteError("Rejected"))
    lookup = AsyncMock()
    monkeypatch.setattr(server, "get_company_section", AsyncMock(return_value={"enabled": True}))
    monkeypatch.setattr(server, "db", SimpleNamespace(saas_settings=SimpleNamespace(find_one=lookup)))
    monkeypatch.setattr(server, "_send_company_sms", send)
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
    monkeypatch.setattr(server, "_send_company_sms", sms)
    monkeypatch.setattr(server, "db", SimpleNamespace(
        payment_plans=SimpleNamespace(find_one=AsyncMock(return_value={
            "id": "plan-1", "tenant_id": "tenant-1", "company_id": "company-1", "currency": "SRD",
        })),
        tenants=SimpleNamespace(find_one=AsyncMock(return_value={"name": "Huurder", "phone": "+5971234567"})),
        payment_plan_installments=SimpleNamespace(
            find_one=AsyncMock(side_effect=[{"amount": 100, "payment_id": "payment-1"}, None]),
            count_documents=AsyncMock(side_effect=[1, 1]),
        ),
        sms_receipt_links=SimpleNamespace(insert_one=AsyncMock()),
    ))
    asyncio.run(server._notify_tenant_installment_paid("plan-1", 1))
    if channel == "sms":
        sms.assert_awaited_once()
        assert "Bekijk bon: https://example.com/api/r/" in sms.await_args.args[3]
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
    monkeypatch.setattr(server, "_send_company_sms", sms)
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
