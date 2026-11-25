import asyncio
import copy
import os
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

from fastapi import HTTPException
from motor.motor_asyncio import AsyncIOMotorClient

from payment_plans import _build_pay_core
from sms_payment_attempts import PaymentAttemptConflict, tenant_payment_key
from tenant_payment_guard import acquire_payment_guard
from test_bank_reconciliation_guard import Records
from test_company_stripe_consumption import matches
from test_tenant_payment_guard import Guards


class Cursor:
    def __init__(self, rows):
        self.rows = rows

    def sort(self, *_args):
        return self

    async def to_list(self, _limit):
        return copy.deepcopy(self.rows)

    def __aiter__(self):
        async def values():
            for row in self.rows:
                yield copy.deepcopy(row)
        return values()


class Collection(Records):
    def find(self, query, _projection=None):
        return Cursor([row for row in self.docs if matches(row, query)])

    async def find_one(self, query, _projection=None, **_kwargs):
        for row in self.docs:
            if "invoice_ids" in query:
                match = query["invoice_ids"] in (row.get("invoice_ids") or [])
                other = {key: value for key, value in query.items() if key != "invoice_ids"}
            elif "allocations.invoice_id" in query:
                match = any(a.get("invoice_id") == query["allocations.invoice_id"]
                            for a in row.get("allocations") or [])
                other = {key: value for key, value in query.items() if key != "allocations.invoice_id"}
            else:
                match, other = True, query
            if match and matches(row, other):
                return copy.deepcopy(row)
        return None

    async def count_documents(self, query):
        return sum(matches(row, query) for row in self.docs)

    async def update_many(self, query, update):
        for doc in self.docs:
            if matches(doc, query):
                doc.update(update.get("$set", {}))
        return SimpleNamespace(acknowledged=True)


class InstallmentGuardCases:
    async def prepare(self):
        self.plan = {
            "id": "plan1", "company_id": "c1", "tenant_id": "t1", "status": "active",
            "total_amount": 50, "currency": "SRD", "invoice_ids": [],
            "created_at": "2026-01-01",
        }
        await self.db.payment_plans.insert_one(self.plan)
        await self.db.payment_plan_installments.insert_one({
            "id": "inst1", "plan_id": "plan1", "company_id": "c1", "sequence": 1,
            "amount": 50, "status": "pending", "due_date": "2027-01-01",
        })
        await self.db.tenants.insert_one({"id": "t1", "company_id": "c1", "name": "Tenant"})
        self.allocate = AsyncMock(return_value=50)
        self.notify = AsyncMock()
        self.core = _build_pay_core(self.db, {
            "new_id": lambda: "payment1",
            "iso": lambda value: value.isoformat(),
            "now_utc": lambda: datetime(2026, 1, 1, tzinfo=timezone.utc),
            "next_receipt_number": AsyncMock(return_value="receipt1"),
            "allocate_to_invoices": self.allocate,
            "notify_tenant_paid": self.notify,
        })

    async def pay(self, **kwargs):
        return await self.core["pay_installment_for"](self.plan, 1, **kwargs)

    async def test_sms_guard_prevents_provider_and_booking(self):
        await acquire_payment_guard(self.db, company_id="c1", tenant_id="t1", kind="sms", owner="sms1")
        provider = AsyncMock()
        with self.assertRaises(HTTPException) as error:
            await self.pay(method="creditcard", stripe_payment_intent_id="pi1", consume_provider=provider)
        self.assertEqual(error.exception.status_code, 409)
        provider.assert_not_awaited()
        self.assertIsNone(await self.db.payments.find_one({"id": "payment1"}))

    async def test_provider_and_booking_hold_guard_until_complete(self):
        entered, resume = asyncio.Event(), asyncio.Event()

        async def provider(amount, currency):
            self.assertEqual((amount, currency), (50, "SRD"))
            entered.set()
            await resume.wait()

        task = asyncio.create_task(self.pay(
            method="creditcard", stripe_payment_intent_id="pi1", consume_provider=provider,
        ))
        try:
            await asyncio.wait_for(entered.wait(), 5)
            with self.assertRaises(PaymentAttemptConflict):
                await acquire_payment_guard(self.db, company_id="c1", tenant_id="t1", kind="sms", owner="sms1")
        finally:
            resume.set()
        result = await task
        await asyncio.sleep(0)
        self.assertEqual(result["status"], "completed")
        self.assertEqual((await self.db.payments.find_one({"id": "payment1"}))["stripe_payment_intent_id"], "pi1")
        self.assertEqual((await self.db.payment_plan_installments.find_one({"id": "inst1"}))["status"], "paid")
        self.assertIsNone(await self.db.tenant_payment_guards.find_one({"_id": tenant_payment_key("c1", "t1")}))
        self.notify.assert_awaited_once()

    async def test_pending_installment_cannot_be_booked_twice(self):
        await self.db.payment_plan_installments.update_one(
            {"id": "inst1"}, {"$set": {"status": "pending_payment"}},
        )
        provider = AsyncMock()
        with self.assertRaises(HTTPException) as error:
            await self.pay(method="creditcard", stripe_payment_intent_id="pi1", consume_provider=provider)
        self.assertEqual(error.exception.status_code, 409)
        provider.assert_not_awaited()
        self.assertIsNone(await self.db.tenant_payment_guards.find_one({"_id": tenant_payment_key("c1", "t1")}))
        self.assertIsNone(await self.db.payments.find_one({"id": "payment1"}))

    async def test_partial_allocation_failure_retains_guard(self):
        await self.db.payment_plans.update_one({"id": "plan1"}, {"$set": {"invoice_ids": ["i1"]}})
        await self.db.invoices.insert_one({
            "id": "i1", "company_id": "c1", "tenant_id": "t1", "currency": "SRD",
            "status": "open", "amount": 50, "paid_amount": 0,
        })
        self.allocate.side_effect = RuntimeError("allocation failed")
        with self.assertRaises(HTTPException) as error:
            await self.pay()
        self.assertEqual(error.exception.status_code, 500)
        guard = await self.db.tenant_payment_guards.find_one({"_id": tenant_payment_key("c1", "t1")})
        self.assertEqual((guard["operation"], guard["operation_id"]), ("installment_payment", "payment1"))
        self.assertIsNotNone(await self.db.payments.find_one({"id": "payment1"}))
        self.assertEqual((await self.db.payment_plan_installments.find_one({"id": "inst1"}))["status"], "paid")
        self.notify.assert_not_awaited()

    async def test_missing_invoice_rejected_without_provider_or_guard(self):
        await self.db.payment_plans.update_one({"id": "plan1"}, {"$set": {"invoice_ids": ["missing"]}})
        provider = AsyncMock()
        with self.assertRaises(HTTPException) as error:
            await self.pay(method="mope", mope_payment_request_id="mp1", consume_provider=provider)
        self.assertEqual(error.exception.status_code, 409)
        provider.assert_not_awaited()
        self.assertIsNone(await self.db.tenant_payment_guards.find_one({"_id": tenant_payment_key("c1", "t1")}))

    async def test_uncertain_provider_failure_keeps_reference_for_review(self):
        provider = AsyncMock(side_effect=RuntimeError("provider outcome unknown"))
        with self.assertRaises(HTTPException) as error:
            await self.pay(method="mope", mope_payment_request_id="mp1", consume_provider=provider)
        self.assertEqual(error.exception.status_code, 500)
        guard = await self.db.tenant_payment_guards.find_one({"_id": tenant_payment_key("c1", "t1")})
        self.assertEqual((guard["operation"], guard["provider"], guard["provider_reference"]),
                         ("installment_payment", "mope", "mp1"))
        self.assertIsNone(await self.db.payments.find_one({"id": "payment1"}))

    async def test_invalid_invoice_balance_never_contacts_provider(self):
        await self.db.payment_plans.update_one({"id": "plan1"}, {"$set": {"invoice_ids": ["i1"]}})
        await self.db.invoices.insert_one({
            "id": "i1", "company_id": "c1", "tenant_id": "t1", "currency": "SRD",
            "status": "open", "amount": 50, "paid_amount": 60,
        })
        provider = AsyncMock()
        with self.assertRaises(HTTPException) as error:
            await self.pay(method="mope", mope_payment_request_id="mp1", consume_provider=provider)
        self.assertEqual(error.exception.status_code, 409)
        provider.assert_not_awaited()
        self.assertIsNone(await self.db.tenant_payment_guards.find_one({"_id": tenant_payment_key("c1", "t1")}))

    async def test_unpaid_invoice_without_paid_amount_is_payable(self):
        await self.db.payment_plans.update_one({"id": "plan1"}, {"$set": {"invoice_ids": ["i1"]}})
        await self.db.invoices.insert_one({
            "id": "i1", "company_id": "c1", "tenant_id": "t1", "currency": "SRD",
            "status": "open", "amount": 50,
        })
        result = await self.pay()
        self.assertEqual(result["status"], "completed")
        self.allocate.assert_awaited_once()

    async def test_missing_paid_amount_with_prior_allocation_requires_review(self):
        await self.db.payment_plans.update_one({"id": "plan1"}, {"$set": {"invoice_ids": ["i1"]}})
        await self.db.invoices.insert_one({
            "id": "i1", "company_id": "c1", "tenant_id": "t1", "currency": "SRD",
            "status": "open", "amount": 50,
        })
        await self.db.payments.insert_one({
            "id": "older", "status": "approved", "allocations": [{"invoice_id": "i1", "amount": 10}],
        })
        provider = AsyncMock()
        with self.assertRaises(HTTPException) as error:
            await self.pay(method="mope", mope_payment_request_id="mp1", consume_provider=provider)
        self.assertEqual(error.exception.status_code, 409)
        provider.assert_not_awaited()
        self.assertIsNone(await self.db.tenant_payment_guards.find_one({"_id": tenant_payment_key("c1", "t1")}))

    async def test_invoice_sync_can_complete_plan_during_allocation(self):
        await self.db.payment_plans.update_one({"id": "plan1"}, {"$set": {"invoice_ids": ["i1"]}})
        await self.db.invoices.insert_one({
            "id": "i1", "company_id": "c1", "tenant_id": "t1", "currency": "SRD",
            "status": "open", "amount": 50, "paid_amount": 0,
        })

        async def allocate(*args, **kwargs):
            await self.db.invoices.update_one({"id": "i1"}, {"$set": {"paid_amount": 50, "status": "paid"}})
            await self.db.payment_plans.update_one({"id": "plan1"}, {"$set": {"status": "completed"}})
            return 50

        self.allocate.side_effect = allocate
        result = await self.pay()
        self.assertEqual(result["status"], "completed")
        self.assertIsNone(await self.db.tenant_payment_guards.find_one({"_id": tenant_payment_key("c1", "t1")}))


class InstallmentGuardTests(InstallmentGuardCases, unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.db = SimpleNamespace(
            payment_plans=Collection(), payment_plan_installments=Collection(),
            payments=Collection(), invoices=Collection(), companies=Collection(),
            tenants=Collection(), apartments=Collection(), tenant_payment_guards=Guards(),
        )
        await self.prepare()


@unittest.skipUnless(os.environ.get("SMS_BOOKING_MONGO_URL"), "MongoDB replica set is required")
class InstallmentGuardMongoTests(InstallmentGuardCases, unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.client = AsyncIOMotorClient(os.environ["SMS_BOOKING_MONGO_URL"], serverSelectionTimeoutMS=5000)
        self.name = f"test_installment_guard_{uuid4().hex}"
        self.db = self.client[self.name]
        await self.prepare()

    async def asyncTearDown(self):
        await self.client.drop_database(self.name)
        self.client.close()
