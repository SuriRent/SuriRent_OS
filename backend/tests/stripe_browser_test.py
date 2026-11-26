"""Opt-in browser test: synthetic tenant, local MongoDB and Stripe test mode only."""

import asyncio
import json
import os
import re
import sys
import types
from pathlib import Path
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import httpx
from motor.motor_asyncio import AsyncIOMotorClient
from playwright.async_api import async_playwright
from starlette.responses import FileResponse
from starlette.staticfiles import StaticFiles
import uvicorn

from sms_payment_attempts import tenant_payment_key
from sms_payment_links import get_payment_grant
from test_sms_payment_stripe_testmode import _test_configuration


async def main():
    if os.environ.get("RUN_SMS_STRIPE_BROWSER_TEST") != "1":
        raise RuntimeError("Explicit browser test activation is required")
    secret, mongo_url = _test_configuration()
    public = os.environ.get("SMS_STRIPE_TEST_PUBLISHABLE_KEY", "")
    if not public.startswith("pk_test_") or len(public) <= len("pk_test_"):
        raise ValueError("A Stripe test-mode publishable key is required")
    build = Path(__file__).resolve().parents[2] / "frontend" / "build"
    if not (build / "index.html").is_file():
        raise RuntimeError("The isolated frontend build is missing")

    os.environ.update({
        "MONGO_URL": mongo_url, "DB_NAME": "stripe_browser_unused",
        "JWT_SECRET": "isolated-browser-test-only-key-with-adequate-length",
        "APP_PUBLIC_URL": "https://example.test",
    })
    for name in ("emergentintegrations", "emergentintegrations.llm",
                 "emergentintegrations.llm.chat", "emergentintegrations.llm.openai"):
        sys.modules[name] = types.ModuleType(name)
    for name in ("LlmChat", "UserMessage"):
        setattr(sys.modules["emergentintegrations.llm.chat"], name, type(name, (), {}))
    for name in ("OpenAISpeechToText", "OpenAITextToSpeech"):
        setattr(sys.modules["emergentintegrations.llm.openai"], name, type(name, (), {}))

    import server
    import messente_service
    from routes import _deps, company_stripe

    client = AsyncIOMotorClient(mongo_url, serverSelectionTimeoutMS=5000)
    name = f"test_sms_browser_{uuid4().hex}"
    database = client[name]
    http_server = None
    task = None
    browser = None
    try:
        hello = await client.admin.command("hello")
        if hello.get("setName") != "rs0" or not hello.get("isWritablePrimary"):
            raise RuntimeError("The isolated test replica is not ready")
        await database.tenants.insert_one({
            "id": "test-tenant", "company_id": "test-company", "status": "active", "phone": "+5971234567",
        })
        await database.companies.insert_one({"id": "test-company", "name": "Testbedrijf"})
        await database.invoices.insert_one({
            "id": "test-invoice", "company_id": "test-company", "tenant_id": "test-tenant",
            "invoice_number": "TEST-1", "amount": 1, "paid_amount": 0, "currency": "EUR", "status": "open",
            "period_month": 1, "period_year": 2026,
        })
        server.db, server.client = database, client
        server._SMS_CHECKOUT_READY = True
        server._SMS_PAYMENT_REMINDERS_READY = True
        server._company_has_plan_feature = AsyncMock(return_value=True)
        _deps.require_plan_feature = AsyncMock()
        config = {"enabled": True, "mode": "test", "methods": ["card"],
                  "secret_key": secret, "publishable_key": public}
        company_stripe._active = lambda _: config
        company_stripe._cfg_doc = AsyncMock(return_value={"stripe_config": {"test": {
            "secret_key": secret, "publishable_key": public,
        }}})

        requests = []

        def fake_messente(request):
            requests.append(request)
            return httpx.Response(201, json={
                "omnimessage_id": "synthetic-omni",
                "messages": [{"channel": "sms", "message_id": "synthetic-message"}],
            })

        messente_cfg = {
            "enabled": True, "api_username": "synthetic-user", "api_password": "synthetic-password",
            "sms_from": "Testbedrijf",
        }
        server.app.dependency_overrides[server.get_current_user] = lambda: {
            "role": "admin", "active_company_id": "test-company",
        }
        original_async_client = httpx.AsyncClient
        async with original_async_client(
            transport=httpx.ASGITransport(app=server.app), base_url="http://test",
        ) as api_client:
            with patch.object(server, "_messente_or_400", AsyncMock(return_value=messente_cfg)), \
                    patch.object(messente_service.httpx, "AsyncClient",
                                 side_effect=lambda **_: original_async_client(transport=httpx.MockTransport(fake_messente))):
                response = await api_client.post(
                    "/api/tenants/test-tenant/reminder", json={"channel": "sms", "tone": "urgent"},
                )
        if response.status_code != 200 or len(requests) != 1:
            raise AssertionError("The synthetic SMS reminder was not accepted once")
        payload = json.loads(requests[0].content)
        if (str(requests[0].url) != messente_service.MESSENTE_API or payload.get("to") != "+5971234567"
                or len(payload.get("messages", [])) != 1):
            raise AssertionError("The synthetic SMS request has an unexpected recipient or endpoint")
        sms = payload["messages"][0]
        text = sms.get("text", "")
        link = re.search(r"https://example\.test/b/([A-Za-z0-9_-]{22})", text)
        if (sms.get("channel") != "sms" or sms.get("autoconvert") != "off"
                or len(text) != 160 or not text.startswith("Dringende herinnering") or not link):
            raise AssertionError("The synthetic SMS did not contain the expected scoped reminder")
        token = link.group(1)
        grant = await get_payment_grant(database.sms_payment_links, token)
        if (not grant or grant.get("company_id") != "test-company" or grant.get("tenant_id") != "test-tenant"
                or grant.get("invoice_ids") != ["test-invoice"] or grant.get("installments") != []):
            raise AssertionError("The synthetic SMS grant is not scoped to the test invoice")
        history = await database.sms_history.find_one({"company_id": "test-company"})
        if (not history or history.get("status") != "accepted" or token in repr(history)
                or "text" in history or "body" in history
                or not payload.get("dlr_url", "").startswith("https://example.test/api/public/messente/sms-status/")):
            raise AssertionError("The synthetic SMS history or delivery callback is incorrect")

        async def enrich(invoices):
            return [{**invoice, "remaining_amount": invoice["amount"] - invoice["paid_amount"]}
                    for invoice in invoices]

        server._enrich_invoices_batch = enrich

        @server.app.get("/b/{test_token}")
        async def browser_page(test_token: str):
            return FileResponse(build / "index.html")

        server.app.mount("/", StaticFiles(directory=str(build), html=True), name="browser-test-static")
        http_server = uvicorn.Server(uvicorn.Config(
            server.app, host="127.0.0.1", port=8123, log_level="warning", access_log=False, lifespan="off",
        ))
        task = asyncio.create_task(http_server.serve())
        for _ in range(100):
            if http_server.started:
                break
            if task.done():
                await task
                raise RuntimeError("The isolated browser test server stopped unexpectedly")
            await asyncio.sleep(0.1)
        else:
            raise RuntimeError("The isolated browser test server did not start")

        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(headless=True)
            page = await browser.new_page(viewport={"width": 390, "height": 844})
            page.set_default_timeout(30000)
            await page.goto(f"http://127.0.0.1:8123/b/{token}", wait_until="domcontentloaded")
            await page.get_by_text("Factuur TEST-1").first.wait_for()
            await page.get_by_role("button", name="Verder met betalen").click()
            await page.wait_for_function(
                """() => {
                    const raw = sessionStorage.getItem('surirent_sms_checkout');
                    return raw && JSON.parse(raw).attempt_id;
                }"""
            )
            attempt_id = await page.evaluate(
                "JSON.parse(sessionStorage.getItem('surirent_sms_checkout')).attempt_id"
            )
            await page.reload(wait_until="domcontentloaded")
            await page.get_by_role("button", name="Hervat betaling").click()
            if await database.sms_payment_attempts.count_documents({"attempt_id": attempt_id}) != 1:
                raise AssertionError("Reload did not preserve the original attempt")
            for _ in range(100):
                matches = [
                    frame for frame in page.frames
                    if frame.url.startswith("https://js.stripe.com/")
                    and await frame.locator('input[name="number"]').count()
                ]
                if len(matches) == 1:
                    card = matches[0]
                    break
                if len(matches) > 1:
                    raise RuntimeError("Multiple Stripe card input frames found")
                await asyncio.sleep(0.3)
            else:
                raise RuntimeError("Stripe card input frame did not load")
            await card.locator('input[name="number"]').fill("4242424242424242")
            await card.locator('input[name="expiry"]').fill("1234")
            await card.locator('input[name="cvc"]').fill("123")
            postal = card.locator('input[name="postalCode"]')
            if await postal.count():
                await postal.fill("12345")
            if await database.payments.count_documents({}) != 0:
                raise AssertionError("A payment was booked before confirmation")
            await page.get_by_test_id("stripe-pay-btn").click()
            await page.get_by_text("Betaling bevestigd").wait_for(timeout=60000)
            invoice = await database.invoices.find_one({"id": "test-invoice"})
            if invoice.get("paid_amount") != 1 or await database.payments.count_documents({}) != 1:
                raise AssertionError("The confirmed test payment was not booked exactly once")
            if await database.tenant_payment_guards.find_one({
                "_id": tenant_payment_key("test-company", "test-tenant"),
            }):
                raise AssertionError("The completed test payment still has a guard")
            if await page.evaluate("sessionStorage.getItem('surirent_sms_checkout')") is not None:
                raise AssertionError("The completed browser attempt was not cleared")
            await browser.close()
            browser = None
        print("Synthetic SMS request and isolated browser Stripe test-mode payment booked exactly once")
    finally:
        if browser is not None:
            await browser.close()
        if http_server is not None:
            http_server.should_exit = True
        if task is not None:
            await task
        await client.drop_database(name)
        client.close()


if __name__ == "__main__":
    asyncio.run(main())
