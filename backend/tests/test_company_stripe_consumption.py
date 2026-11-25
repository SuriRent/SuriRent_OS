import asyncio
import copy
import os
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from fastapi import HTTPException
from motor.motor_asyncio import AsyncIOMotorClient

from routes import _deps
from payment_plans import _build_pay_core

with patch.object(_deps, "get_current_user", lambda: {}), \
        patch.object(_deps, "get_kiosk_session", lambda: {}), \
        patch.object(_deps, "require_role", lambda *_roles: lambda: {}):
    import routes.company_stripe as stripe_routes
    from routes.company_stripe import consume_kiosk_stripe_payment, consume_tenant_stripe_payment


def matches(doc, query):
    for key, condition in query.items():
        value = doc.get(key)
        if not isinstance(condition, dict):
            if value != condition:
                return False
            continue
        for op, expected in condition.items():
            if op == "$exists" and (key in doc) != expected:
                return False
            if op == "$ne" and value == expected:
                return False
            if op == "$in" and value not in expected:
                return False
            if op == "$gte" and (value is None or value < expected):
                return False
            if op == "$lte" and (value is None or value > expected):
                return False
    return True


class FakePayments:
    def __init__(self):
        self.docs = []

    async def insert_one(self, doc):
        self.docs.append(copy.deepcopy(doc))

    async def find_one(self, query, _projection=None):
        await asyncio.sleep(0)
        return next((copy.deepcopy(doc) for doc in self.docs if matches(doc, query)), None)

    async def update_one(self, query, update):
        await asyncio.sleep(0)
        for doc in self.docs:
            if matches(doc, query):
                doc.update(update.get("$set", {}))
                return SimpleNamespace(modified_count=1)
        return SimpleNamespace(modified_count=0)

    async def find_one_and_update(self, query, update):
        await asyncio.sleep(0)
        for doc in self.docs:
            if matches(doc, query):
                previous = copy.deepcopy(doc)
                doc.update(update.get("$set", {}))
                for key, value in update.get("$inc", {}).items():
                    doc[key] = doc.get(key, 0) + value
                return previous
        return None


class StripeConsumptionCases:
    async def prepare_payment(self, **overrides):
        await self.db.kiosk_stripe_payments.insert_one({
            "payment_intent_id": "pi_1", "company_id": "c1", "tenant_id": "t1",
            "status": "paid", "consumed": False, "amount": 100.0,
            "currency": "SRD", "method": "card", **overrides,
        })

    async def kiosk(self, **kwargs):
        params = {"tenant_id": "t1", "amount": 100.0, "currency": "SRD", "method": "card"}
        params.update(kwargs)
        return await consume_kiosk_stripe_payment("c1", "pi_1", **params)

    async def tenant(self, amount=100.0, currency="SRD", tenant_id="t1"):
        await consume_tenant_stripe_payment("c1", tenant_id, "pi_1", amount, currency)

    async def test_kiosk_and_tenant_cannot_consume_same_intent(self):
        await self.prepare_payment()
        results = await asyncio.gather(self.kiosk(), self.tenant(), return_exceptions=True)
        self.assertEqual(sum(isinstance(value, HTTPException) and value.status_code == 409
                             for value in results), 1)
        self.assertEqual(sum(not isinstance(value, Exception) for value in results), 1)

    async def test_partial_tenant_bookings_block_kiosk_and_cannot_exceed_amount(self):
        await self.prepare_payment()
        await self.tenant(30)
        with self.assertRaises(HTTPException) as conflict:
            await self.kiosk()
        self.assertEqual(conflict.exception.status_code, 409)
        with self.assertRaises(HTTPException):
            await self.tenant(70.01)
        await self.tenant(70)
        with self.assertRaises(HTTPException):
            await self.tenant(0.01)

    async def test_kiosk_consumption_blocks_tenant(self):
        await self.prepare_payment()
        await self.kiosk()
        with self.assertRaises(HTTPException) as conflict:
            await self.tenant()
        self.assertEqual(conflict.exception.status_code, 409)

    async def test_partial_kiosk_payment_does_not_consume_full_intent(self):
        await self.prepare_payment()
        with self.assertRaises(HTTPException) as error:
            await self.kiosk(amount=40)
        self.assertEqual(error.exception.status_code, 400)
        await self.tenant(100)

    async def test_mismatch_and_invalid_amount_do_not_consume(self):
        await self.prepare_payment()
        for kwargs in ({"tenant_id": "other"}, {"currency": "EUR"}, {"method": "ideal"},
                       {"amount": 100.01}, {"amount": 0}, {"amount": 1.001}):
            with self.subTest(kwargs=kwargs), self.assertRaises(HTTPException):
                await self.kiosk(**kwargs)
        with self.assertRaises(HTTPException):
            await self.tenant(currency="EUR")
        with self.assertRaises(HTTPException):
            await self.tenant(tenant_id="other")
        await self.tenant()

    async def test_changed_provider_amount_cannot_consume_stale_validation(self):
        await self.prepare_payment()
        original = stripe_routes._verified_payment

        async def change_after_validation(*args):
            result = await original(*args)
            await self.db.kiosk_stripe_payments.update_one(
                {"payment_intent_id": "pi_1"}, {"$set": {"amount": 200.0}},
            )
            return result

        with patch.object(stripe_routes, "_verified_payment", side_effect=change_after_validation):
            with self.assertRaises(HTTPException) as conflict:
                await self.kiosk()
        self.assertEqual(conflict.exception.status_code, 409)

    async def test_fractional_bookings_do_not_allow_an_extra_cent(self):
        await self.prepare_payment(amount=0.30)
        await self.tenant(0.10)
        await self.tenant(0.10)
        await self.tenant(0.10)
        with self.assertRaises(HTTPException):
            await self.tenant(0.01)


class InstallmentStripeReferenceTests(unittest.IsolatedAsyncioTestCase):
    async def test_installment_records_stripe_intent(self):
        plan = {"id": "p1", "company_id": "c1", "tenant_id": "t1",
                "status": "active", "total_amount": 50, "currency": "SRD"}
        installment = {"plan_id": "p1", "sequence": 1, "amount": 50,
                       "status": "pending", "due_date": "2027-01-01"}
        cursor = SimpleNamespace(sort=lambda *_args: SimpleNamespace(to_list=AsyncMock(return_value=[installment])))
        db = SimpleNamespace(
            payment_plan_installments=SimpleNamespace(
                find_one=AsyncMock(return_value=installment), update_one=AsyncMock(),
                count_documents=AsyncMock(return_value=1), find=lambda *_args: cursor,
            ),
            payments=SimpleNamespace(insert_one=AsyncMock()),
            payment_plans=SimpleNamespace(find_one=AsyncMock(return_value=plan), update_one=AsyncMock()),
            companies=SimpleNamespace(find_one=AsyncMock(return_value={})),
            tenants=SimpleNamespace(find_one=AsyncMock(return_value={})),
        )
        helpers = {
            "new_id": lambda: "payment1", "iso": lambda value: value.isoformat(),
            "now_utc": lambda: datetime(2026, 1, 1, tzinfo=timezone.utc),
            "next_receipt_number": AsyncMock(return_value="receipt1"),
        }
        core = _build_pay_core(db, helpers)
        await core["pay_installment_for"](
            plan, 1, method="creditcard", amount=50, stripe_payment_intent_id="pi_1",
        )
        payment = db.payments.insert_one.await_args.args[0]
        self.assertEqual(payment["stripe_payment_intent_id"], "pi_1")
        self.assertEqual(payment["amount"], 50)


class StripeConsumptionUnitTests(StripeConsumptionCases, unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.db = SimpleNamespace(kiosk_stripe_payments=FakePayments())
        self.deps_patch = patch.object(_deps, "db", self.db)
        self.deps_patch.start()
        self.addCleanup(self.deps_patch.stop)


@unittest.skipUnless(os.environ.get("SMS_BOOKING_MONGO_URL"), "MongoDB replica set is required")
class StripeConsumptionMongoTests(StripeConsumptionCases, unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.client = AsyncIOMotorClient(os.environ["SMS_BOOKING_MONGO_URL"], serverSelectionTimeoutMS=5000)
        self.name = f"test_stripe_consumption_{uuid4().hex}"
        self.db = self.client[self.name]
        self.deps_patch = patch.object(_deps, "db", self.db)
        self.deps_patch.start()
        self.addCleanup(self.deps_patch.stop)

    async def asyncTearDown(self):
        await self.client.drop_database(self.name)
        self.client.close()
