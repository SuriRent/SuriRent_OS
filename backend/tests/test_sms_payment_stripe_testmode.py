"""Opt-in Stripe test-mode checkout against an isolated MongoDB replica set."""

import asyncio
import os
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import stripe
from motor.motor_asyncio import AsyncIOMotorClient

from sms_payment_attempts import PaymentAttemptConflict, tenant_payment_key
from sms_payment_checkout import finish_sms_checkout, start_sms_checkout
from sms_payment_links import create_payment_link


def _test_configuration():
    key = os.environ.get("SMS_STRIPE_TEST_SECRET_KEY", "")
    mongo_url = os.environ.get("SMS_STRIPE_TEST_MONGO_URL", "")
    if not key:
        raise ValueError("The Stripe test-mode secret is empty or unavailable to this workflow")
    if not key.startswith("sk_test_") or len(key) <= len("sk_test_"):
        raise ValueError("A Stripe test-mode secret key is required; live keys are not accepted")
    if mongo_url != "mongodb://127.0.0.1:27019/?replicaSet=rs0&directConnection=true":
        raise ValueError("The isolated test replica URL is required")
    return key, mongo_url


class StripeTestConfigurationTests(unittest.TestCase):
    def test_refuses_live_keys_and_nonisolated_database(self):
        test_url = "mongodb://127.0.0.1:27019/?replicaSet=rs0&directConnection=true"
        for key, url in (("sk_live_example", test_url), ("sk_test_example", "mongodb://example.com"),
                         ("", test_url)):
            with self.subTest(key=key, url=url), patch.dict(os.environ, {
                "SMS_STRIPE_TEST_SECRET_KEY": key, "SMS_STRIPE_TEST_MONGO_URL": url,
            }), self.assertRaises(ValueError):
                _test_configuration()


@unittest.skipUnless(os.environ.get("RUN_SMS_STRIPE_TESTMODE") == "1", "Explicit Stripe test-mode run required")
class StripeTestModeCheckoutTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.key, mongo_url = _test_configuration()
        self.client = AsyncIOMotorClient(mongo_url, serverSelectionTimeoutMS=5000)
        hello = await self.client.admin.command("hello")
        if hello.get("setName") != "rs0" or not hello.get("isWritablePrimary"):
            self.client.close()
            raise RuntimeError("The isolated test replica is not ready")
        self.name = f"test_sms_stripe_{uuid4().hex}"
        self.db = self.client[self.name]
        self.addAsyncCleanup(self._cleanup)
        await self.db.tenants.insert_one({"id": "test-tenant", "company_id": "test-company", "status": "active"})
        await self.db.invoices.insert_one({
            "id": "test-invoice", "company_id": "test-company", "tenant_id": "test-tenant",
            "invoice_number": "TEST-1", "amount": 1, "paid_amount": 0, "currency": "EUR", "status": "open",
        })
        link = await create_payment_link(
            self.db.sms_payment_links, "https://example.test", "test-company", "test-tenant", ["test-invoice"], [],
        )
        self.token = link.rsplit("/", 1)[1]
        self.item = {"kind": "invoice", "id": "test-invoice"}
        deps = SimpleNamespace(require_plan_feature=AsyncMock())
        config = {"enabled": True, "mode": "test", "methods": ["card"],
                  "secret_key": self.key, "publishable_key": "pk_test_placeholder"}
        route = SimpleNamespace(
            _active=lambda _: config,
            _cfg_doc=AsyncMock(return_value={"stripe_config": {"test": {"secret_key": self.key}}}),
        )
        self.routes = patch.dict(sys.modules, {"routes": SimpleNamespace(_deps=deps), "routes.company_stripe": route})
        self.routes.start()
        self.addCleanup(self.routes.stop)

    async def _cleanup(self):
        try:
            await self.client.drop_database(self.name)
        finally:
            self.client.close()

    async def test_real_testmode_payment_is_verified_and_booked_once(self):
        started = await start_sms_checkout(
            self.db, self.client, token=self.token, item=self.item, method="card",
        )
        attempt = started["attempt_id"]
        with self.assertRaises(PaymentAttemptConflict):
            await finish_sms_checkout(self.db, self.client, token=self.token, item=self.item, attempt_id=attempt)
        self.assertEqual(await self.db.payments.count_documents({}), 0)
        self.assertEqual((await self.db.invoices.find_one({"id": "test-invoice"}))["paid_amount"], 0)

        confirmed = await asyncio.to_thread(
            stripe.PaymentIntent.confirm, started["payment_intent_id"], payment_method="pm_card_visa",
            api_key=self.key,
        )
        self.assertIs(confirmed.get("livemode"), False)
        self.assertEqual(confirmed.get("status"), "succeeded")
        result = await finish_sms_checkout(self.db, self.client, token=self.token, item=self.item, attempt_id=attempt)
        replay = await finish_sms_checkout(self.db, self.client, token=self.token, item=self.item, attempt_id=attempt)
        self.assertEqual(replay, result)
        self.assertEqual(result["status"], "paid")
        self.assertEqual(await self.db.payments.count_documents({}), 1)
        self.assertEqual((await self.db.invoices.find_one({"id": "test-invoice"}))["paid_amount"], 1)
        self.assertIsNone(await self.db.tenant_payment_guards.find_one({
            "_id": tenant_payment_key("test-company", "test-tenant"),
        }))
