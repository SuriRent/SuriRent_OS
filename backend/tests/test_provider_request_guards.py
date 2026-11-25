import asyncio
import os
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch
from uuid import uuid4

from fastapi import HTTPException
from motor.motor_asyncio import AsyncIOMotorClient

from routes import _deps
from sms_payment_attempts import PaymentAttemptConflict, tenant_payment_key
from tenant_payment_guard import acquire_payment_guard
from test_bank_reconciliation_guard import Records
from test_tenant_payment_guard import Guards

with patch.object(_deps, "get_current_user", lambda: {}), \
        patch.object(_deps, "get_kiosk_session", lambda: {}), \
        patch.object(_deps, "get_tenant_session", lambda: {}), \
        patch.object(_deps, "require_role", lambda *_roles: lambda: {}):
    from routes import company_stripe, company_mope


class ProviderRequestCases:
    async def prepare(self):
        await self.db.tenants.insert_one({"id": "t1", "company_id": "c1", "name": "Tenant"})
        self.stripe_create = Mock(return_value=SimpleNamespace(
            id="pi1", client_secret="client-secret", next_action=None,
        ))
        self.mope_create = AsyncMock(return_value=SimpleNamespace(is_success=True))
        patches = (
            patch.object(_deps, "db", self.db),
            patch.object(_deps, "require_plan_feature", AsyncMock()),
            patch.object(_deps, "new_id", return_value="request1"),
            patch.object(_deps, "public_url", return_value="https://example.test/"),
            patch.object(_deps, "now_utc", return_value="now"),
            patch.object(_deps, "iso", return_value="now"),
            patch.object(company_stripe, "_cfg_doc", AsyncMock(return_value={"stripe_config": {
                "mode": "test", "test": {"secret_key": "test", "publishable_key": "test"},
                "methods": {"card": True},
            }})),
            patch.object(company_stripe, "_to_eur_cents", AsyncMock(return_value=(5000, 1))),
            patch.object(company_stripe.stripe.PaymentIntent, "create", self.stripe_create),
            patch.object(company_mope, "_config", AsyncMock(return_value={"enabled": True, "api_token": "test"})),
            patch.object(company_mope, "_request_api", self.mope_create),
            patch.object(company_mope, "_response_payload", return_value={
                "id": "mp1", "url": "https://mope.sr/pay/1",
            }),
        )
        for item in patches:
            item.start()
            self.addCleanup(item.stop)

    async def stripe(self):
        body = company_stripe.KioskIntentIn(tenant_id="t1", amount=50, currency="SRD", method="card")
        return await company_stripe.kiosk_stripe_intent(body, {"company_id": "c1"})

    async def mope(self):
        return await company_mope._create_request("c1", "t1", 50, "SRD", "kiosk")

    async def test_sms_guard_blocks_both_providers_before_request(self):
        await acquire_payment_guard(self.db, company_id="c1", tenant_id="t1", kind="sms", owner="sms1")
        for create in (self.stripe, self.mope):
            with self.assertRaises(HTTPException) as error:
                await create()
            self.assertEqual(error.exception.status_code, 409)
        self.stripe_create.assert_not_called()
        self.mope_create.assert_not_awaited()

    async def test_successful_requests_are_recorded_before_guard_release(self):
        self.assertEqual((await self.stripe())["payment_intent_id"], "pi1")
        stripe = await self.db.kiosk_stripe_payments.find_one({"id": "request1"})
        self.assertEqual(stripe["payment_intent_id"], "pi1")
        self.assertEqual(self.stripe_create.call_args.kwargs["metadata"]["legacy_request_id"], "request1")
        self.assertEqual(self.stripe_create.call_args.kwargs["idempotency_key"], "surirent-kiosk-request1")
        self.assertIsNone(await self.db.tenant_payment_guards.find_one({"_id": tenant_payment_key("c1", "t1")}))
        self.assertEqual((await self.mope())["payment_id"], "mp1")
        self.assertIsNotNone(await self.db.kiosk_mope_payments.find_one({"id": "request1"}))
        self.assertEqual(self.mope_create.await_args.args[3]["order_id"], "request1")
        self.assertIsNone(await self.db.tenant_payment_guards.find_one({"_id": tenant_payment_key("c1", "t1")}))

    async def test_failure_after_provider_call_retains_guard_and_prevents_retry(self):
        self.db.kiosk_stripe_payments.insert_one = AsyncMock(side_effect=RuntimeError("database down"))
        with self.assertRaises(HTTPException) as error:
            await self.stripe()
        self.assertEqual(error.exception.status_code, 500)
        guard = await self.db.tenant_payment_guards.find_one({"_id": tenant_payment_key("c1", "t1")})
        self.assertEqual((guard["operation"], guard["operation_id"]), ("stripe_request", "request1"))
        with self.assertRaises(HTTPException) as retry:
            await self.stripe()
        self.assertEqual(retry.exception.status_code, 409)
        self.stripe_create.assert_called_once()

    async def test_guard_is_held_while_mope_request_is_in_flight(self):
        entered, resume = asyncio.Event(), asyncio.Event()

        async def hold(*_args):
            entered.set()
            await resume.wait()
            return SimpleNamespace(is_success=True)

        self.mope_create.side_effect = hold
        task = asyncio.create_task(self.mope())
        try:
            await asyncio.wait_for(entered.wait(), 5)
            with self.assertRaises(PaymentAttemptConflict):
                await acquire_payment_guard(self.db, company_id="c1", tenant_id="t1", kind="sms", owner="sms1")
        finally:
            resume.set()
        self.assertEqual((await task)["payment_id"], "mp1")


class ProviderRequestGuardTests(ProviderRequestCases, unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.db = SimpleNamespace(
            tenants=Records(), kiosk_stripe_payments=Records(), kiosk_mope_payments=Records(),
            tenant_payment_guards=Guards(),
        )
        await self.prepare()


@unittest.skipUnless(os.environ.get("SMS_BOOKING_MONGO_URL"), "MongoDB replica set is required")
class ProviderRequestGuardMongoTests(ProviderRequestCases, unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.client = AsyncIOMotorClient(os.environ["SMS_BOOKING_MONGO_URL"], serverSelectionTimeoutMS=5000)
        self.name = f"test_provider_request_guard_{uuid4().hex}"
        mongo_db = self.client[self.name]
        self.db = SimpleNamespace(
            tenants=mongo_db.tenants, kiosk_stripe_payments=mongo_db.kiosk_stripe_payments,
            kiosk_mope_payments=mongo_db.kiosk_mope_payments, tenant_payment_guards=mongo_db.tenant_payment_guards,
        )
        await self.prepare()

    async def asyncTearDown(self):
        await self.client.drop_database(self.name)
        self.client.close()
