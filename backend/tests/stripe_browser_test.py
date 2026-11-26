"""Opt-in browser test: synthetic tenant, local MongoDB and Stripe test mode only."""

import asyncio
import os
import sys
import types
from pathlib import Path
from unittest.mock import AsyncMock
from uuid import uuid4

from motor.motor_asyncio import AsyncIOMotorClient
from playwright.async_api import async_playwright
from starlette.responses import FileResponse
from starlette.staticfiles import StaticFiles
import uvicorn

from sms_payment_attempts import tenant_payment_key
from sms_payment_links import create_payment_link
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
    })
    for name in ("emergentintegrations", "emergentintegrations.llm",
                 "emergentintegrations.llm.chat", "emergentintegrations.llm.openai"):
        sys.modules[name] = types.ModuleType(name)
    for name in ("LlmChat", "UserMessage"):
        setattr(sys.modules["emergentintegrations.llm.chat"], name, type(name, (), {}))
    for name in ("OpenAISpeechToText", "OpenAITextToSpeech"):
        setattr(sys.modules["emergentintegrations.llm.openai"], name, type(name, (), {}))

    import server
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
        await database.tenants.insert_one({"id": "test-tenant", "company_id": "test-company", "status": "active"})
        await database.companies.insert_one({"id": "test-company", "name": "Testbedrijf"})
        await database.invoices.insert_one({
            "id": "test-invoice", "company_id": "test-company", "tenant_id": "test-tenant",
            "invoice_number": "TEST-1", "amount": 1, "paid_amount": 0, "currency": "EUR", "status": "open",
        })
        link = await create_payment_link(
            database.sms_payment_links, "https://example.test", "test-company", "test-tenant", ["test-invoice"], [],
        )
        token = link.rsplit("/", 1)[1]
        server.db, server.client = database, client
        server._SMS_CHECKOUT_READY = True
        server._company_has_plan_feature = AsyncMock(return_value=True)
        _deps.require_plan_feature = AsyncMock()
        config = {"enabled": True, "mode": "test", "methods": ["card"],
                  "secret_key": secret, "publishable_key": public}
        company_stripe._active = lambda _: config
        company_stripe._cfg_doc = AsyncMock(return_value={"stripe_config": {"test": {"secret_key": secret}}})

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
            card = page.frame_locator('iframe[title="Secure payment input frame"][src*="elements-inner-easel"]')
            await card.locator('input[name="cardNumber"]').fill("4242424242424242")
            await card.locator('input[name="cardExpiry"]').fill("1234")
            await card.locator('input[name="cardCvc"]').fill("123")
            postal = card.locator('input[name="billingPostalCode"]')
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
        print("Isolated browser Stripe test-mode payment booked exactly once")
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
