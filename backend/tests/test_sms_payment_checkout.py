import os
import sys
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch
from uuid import uuid4

from motor.motor_asyncio import AsyncIOMotorClient

from sms_payment_attempts import PaymentAttemptConflict, tenant_payment_key
from sms_payment_checkout import _stripe_amount, finish_sms_checkout, start_sms_checkout
from sms_payment_links import create_payment_link
from tenant_payment_guard import acquire_payment_guard


class CheckoutAmountTests(unittest.IsolatedAsyncioTestCase):
    async def test_conversion_requires_current_rate_and_does_not_inflate_small_amounts(self):
        deps = SimpleNamespace(get_eur_per_srd=AsyncMock(return_value={"rate": 0.025, "source": "live"}))
        with patch.dict(sys.modules, {"routes": SimpleNamespace(_deps=deps)}):
            self.assertEqual(await _stripe_amount(10000, "SRD"), 250)
            deps.get_eur_per_srd.return_value = {"rate": 0.025, "source": "stale_cache"}
            with self.assertRaises(PaymentAttemptConflict):
                await _stripe_amount(10000, "SRD")
            with self.assertRaises(PaymentAttemptConflict):
                await _stripe_amount(49, "EUR")
            with self.assertRaises(PaymentAttemptConflict):
                await _stripe_amount(10000, "USD")


@unittest.skipUnless(os.environ.get("SMS_BOOKING_MONGO_URL"), "MongoDB replica set is required")
class CheckoutMongoTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.client = AsyncIOMotorClient(os.environ["SMS_BOOKING_MONGO_URL"], serverSelectionTimeoutMS=5000)
        self.name = f"test_sms_checkout_{uuid4().hex}"
        self.db = self.client[self.name]
        await self.db.tenants.insert_one({"id": "t1", "company_id": "c1", "status": "active"})
        await self.db.invoices.insert_one({
            "id": "i1", "company_id": "c1", "tenant_id": "t1", "invoice_number": "F1",
            "amount": 100, "paid_amount": 25, "status": "partial", "currency": "EUR",
        })
        link = await create_payment_link(self.db.sms_payment_links, "https://app.example.com", "c1", "t1", ["i1"], [])
        self.token = link.rsplit("/", 1)[1]
        self.item = {"kind": "invoice", "id": "i1"}
        self.deps = SimpleNamespace(require_plan_feature=AsyncMock(), public_url=lambda _: "https://app.example.com/")
        self.config = {
            "enabled": True, "mode": "test", "methods": ["card"],
            "secret_key": "test-secret", "publishable_key": "test-publishable",
        }
        fake_stripe = SimpleNamespace(_active=lambda _: self.config, _cfg_doc=AsyncMock(
            return_value={"stripe_config": {"test": {"secret_key": "test-secret"}}},
        ))
        self.routes = patch.dict(sys.modules, {
            "routes": SimpleNamespace(_deps=self.deps),
            "routes.company_stripe": fake_stripe,
        })
        self.routes.start()
        self.addCleanup(self.routes.stop)

    async def asyncTearDown(self):
        await self.client.drop_database(self.name)
        self.client.close()

    async def test_complete_stripe_checkout_books_only_after_provider_verification(self):
        intent = {"id": "pi_1", "client_secret": "secret", "amount": 7500,
                  "currency": "eur", "livemode": False}
        with patch("sms_payment_providers.stripe.PaymentIntent.create", return_value=intent) as create:
            result = await start_sms_checkout(
                self.db, self.client, token=self.token, item=self.item, method="card",
            )
        attempt_id = result["attempt_id"]
        self.assertEqual((result["amount_cents"], result["provider_amount_cents"]), (7500, 7500))
        self.assertEqual(create.call_args.kwargs["amount"], 7500)
        self.assertEqual((await self.db.invoices.find_one({"id": "i1"}))["paid_amount"], 25)
        self.assertIsNotNone(await self.db.tenant_payment_guards.find_one({"_id": tenant_payment_key("c1", "t1")}))

        proof = {**intent, "status": "processing", "amount_received": 0, "payment_method_types": ["card"],
                 "metadata": {"source": "surirent_sms_payment", "attempt_id": attempt_id,
                              "company_id": "c1", "tenant_id": "t1"}}
        with patch("sms_payment_providers.stripe.PaymentIntent.retrieve", return_value=proof) as retrieve:
            with self.assertRaises(PaymentAttemptConflict):
                await finish_sms_checkout(
                    self.db, self.client, token=self.token, item=self.item, attempt_id=attempt_id,
                )
            self.assertEqual(await self.db.payments.count_documents({}), 0)
            proof.update({"status": "succeeded", "amount_received": 7500})
            result = await finish_sms_checkout(
                self.db, self.client, token=self.token, item=self.item, attempt_id=attempt_id,
            )
            repeated = await finish_sms_checkout(
                self.db, self.client, token=self.token, item=self.item, attempt_id=attempt_id,
            )
            self.assertEqual(repeated, result)
            self.assertEqual(retrieve.call_count, 2)
        self.assertEqual(result["status"], "paid")
        self.assertEqual(await self.db.payments.count_documents({}), 1)
        self.assertEqual((await self.db.invoices.find_one({"id": "i1"}))["paid_amount"], 100)
        self.assertIsNone(await self.db.tenant_payment_guards.find_one({"_id": tenant_payment_key("c1", "t1")}))

    async def test_expired_or_ungranted_item_never_creates_attempt(self):
        for token, item in ((self.token, {"kind": "invoice", "id": "other"}), ("invalid", self.item)):
            with self.assertRaises(PaymentAttemptConflict):
                await start_sms_checkout(self.db, self.client, token=token, item=item, method="card")
        await self.db.sms_payment_links.update_one(
            {}, {"$set": {"expires_at": datetime.now(timezone.utc) - timedelta(seconds=1)}},
        )
        with self.assertRaises(PaymentAttemptConflict):
            await start_sms_checkout(self.db, self.client, token=self.token, item=self.item, method="card")
        self.assertEqual(await self.db.sms_payment_attempts.count_documents({}), 0)

    async def test_other_guard_blocks_provider_and_cancels_reservation(self):
        await acquire_payment_guard(self.db, company_id="c1", tenant_id="t1", kind="legacy", owner="other")
        with patch("sms_payment_providers.stripe.PaymentIntent.create") as create:
            with self.assertRaises(PaymentAttemptConflict):
                await start_sms_checkout(self.db, self.client, token=self.token, item=self.item, method="card")
            create.assert_not_called()
        self.assertEqual(await self.db.sms_payment_attempts.count_documents({}), 0)
        guard = await self.db.tenant_payment_guards.find_one({"_id": tenant_payment_key("c1", "t1")})
        self.assertEqual(guard["owner"], "other")

    async def test_finish_cannot_read_other_attempt(self):
        with self.assertRaises(PaymentAttemptConflict):
            await finish_sms_checkout(self.db, self.client, token=self.token, item=self.item, attempt_id="other")

    async def test_mope_installment_is_verified_and_booked(self):
        await self.db.payment_plans.insert_one({
            "id": "p1", "company_id": "c1", "tenant_id": "t1", "status": "active",
            "total_amount": 75, "currency": "EUR", "invoice_ids": ["i1"],
        })
        await self.db.payment_plan_installments.insert_one({
            "id": "inst1", "plan_id": "p1", "company_id": "c1", "sequence": 1,
            "status": "pending", "amount": 75,
        })
        item = {"kind": "installment", "plan_id": "p1", "sequence": 1}
        link = await create_payment_link(
            self.db.sms_payment_links, "https://app.example.com", "c1", "t1", [],
            [{"plan_id": "p1", "sequence": 1}],
        )
        token = link.rsplit("/", 1)[1]
        provider_response = SimpleNamespace(is_success=True, payload={"id": "m1", "url": "https://mope.sr/pay/m1"})
        request = AsyncMock(return_value=provider_response)
        fake_mope = SimpleNamespace(
            _active=lambda _: True, _config=AsyncMock(return_value={"api_token": "test-token"}),
            _request_api=request, _response_payload=lambda response: response.payload, _provider_error=Mock(),
        )
        with patch.dict(sys.modules, {"routes.company_mope": fake_mope}):
            started = await start_sms_checkout(self.db, self.client, token=token, item=item, method="mope")
            provider_response.payload = {
                "id": "m1", "status": "paid", "amount": 7500, "currency": {"code": "EUR"},
                "meta_data": [{"key": "order_id", "value": started["attempt_id"]}],
            }
            result = await finish_sms_checkout(
                self.db, self.client, token=token, item=item, attempt_id=started["attempt_id"],
            )
        self.assertEqual(result["status"], "paid")
        self.assertEqual((await self.db.invoices.find_one({"id": "i1"}))["paid_amount"], 100)
        self.assertEqual((await self.db.payment_plan_installments.find_one({"id": "inst1"}))["status"], "paid")
        self.assertEqual((await self.db.payment_plans.find_one({"id": "p1"}))["status"], "completed")
        self.assertEqual(await self.db.payments.count_documents({}), 1)

