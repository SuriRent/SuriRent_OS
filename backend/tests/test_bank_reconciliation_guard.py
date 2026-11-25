import asyncio
import copy
import os
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

from motor.motor_asyncio import AsyncIOMotorClient

from bank_reconciliation_guard import register_bank_payment
from sms_payment_attempts import PaymentAttemptConflict
from tenant_payment_guard import acquire_payment_guard, tenant_payment_key
from test_tenant_payment_guard import Guards


def matches(doc, query):
    for key, value in query.items():
        if isinstance(value, dict) and "$ne" in value:
            if doc.get(key) == value["$ne"]:
                return False
        elif isinstance(value, dict) and "$nin" in value:
            if doc.get(key) in value["$nin"]:
                return False
        elif doc.get(key) != value:
            return False
    return True


class Records:
    def __init__(self):
        self.docs = []

    async def insert_one(self, doc):
        self.docs.append(copy.deepcopy(doc))

    async def find_one(self, query, _projection=None, **_kwargs):
        return next((copy.deepcopy(doc) for doc in self.docs if matches(doc, query)), None)

    async def update_one(self, query, update):
        for doc in self.docs:
            if matches(doc, query):
                doc.update(update.get("$set", {}))
                for key, value in update.get("$push", {}).items():
                    doc.setdefault(key, []).append(copy.deepcopy(value))
                for key in update.get("$unset", {}):
                    doc.pop(key, None)
                return SimpleNamespace(modified_count=1, matched_count=1)
        return SimpleNamespace(modified_count=0, matched_count=0)

    async def find_one_and_update(self, query, update, projection=None):
        for doc in self.docs:
            if matches(doc, query):
                previous = copy.deepcopy(doc)
                doc.update(update.get("$set", {}))
                return previous
        return None


class BankRegistrationCases:
    async def prepare(self):
        await self.db.bank_statements.insert_one({
            "id": "statement1", "company_id": "c1", "reconciliation_status": "uploaded",
        })

    async def register(self, creator, reference=""):
        return await register_bank_payment(
            self.db, company_id="c1", tenant_id="t1", statement_id="statement1",
            body=SimpleNamespace(bank_reference=reference, amount=50, currency="SRD"),
            paid_at="2026-01-01", now=lambda: "2026-01-01", new_id=lambda: "attempt1",
            create_payment=creator,
        )

    async def create(self, _statement, _reference):
        doc = {"id": "payment1", "company_id": "c1", "tenant_id": "t1",
               "bank_statement_id": "statement1", "status": "approved"}
        await self.db.payments.insert_one(doc)
        return doc

    async def test_active_sms_attempt_blocks_bank_before_first_write(self):
        await self.prepare()
        await acquire_payment_guard(self.db, company_id="c1", tenant_id="t1", kind="sms", owner="sms1")
        create = AsyncMock(side_effect=self.create)
        with self.assertRaises(PaymentAttemptConflict):
            await self.register(create)
        create.assert_not_awaited()
        statement = await self.db.bank_statements.find_one({"id": "statement1"})
        self.assertEqual(statement["reconciliation_status"], "uploaded")
        self.assertIsNone(await self.db.payments.find_one({"id": "payment1"}))

    async def test_bank_holds_guard_until_registration_finishes(self):
        await self.prepare()
        entered, resume = asyncio.Event(), asyncio.Event()

        async def create(statement, reference):
            entered.set()
            await resume.wait()
            return await self.create(statement, reference)

        task = asyncio.create_task(self.register(create))
        await asyncio.wait_for(entered.wait(), 5)
        with self.assertRaises(PaymentAttemptConflict):
            await acquire_payment_guard(self.db, company_id="c1", tenant_id="t1", kind="sms", owner="sms1")
        resume.set()
        payment, created, rejection = await task
        self.assertTrue(created)
        self.assertIsNone(rejection)
        self.assertEqual(payment["id"], "payment1")
        self.assertEqual((await self.db.bank_statements.find_one({"id": "statement1"}))["payment_id"], "payment1")
        self.assertIsNone(await self.db.tenant_payment_guards.find_one({"_id": tenant_payment_key("c1", "t1")}))

        result = await self.register(AsyncMock(side_effect=AssertionError("must not book again")))
        self.assertFalse(result[1])
        self.assertEqual(result[0]["id"], "payment1")

    async def test_failed_partial_booking_stays_locked_and_cannot_retry(self):
        await self.prepare()

        async def partial(statement, reference):
            await self.create(statement, reference)
            raise RuntimeError("allocation failed")

        with self.assertRaises(RuntimeError):
            await self.register(partial)
        guard = await self.db.tenant_payment_guards.find_one({"_id": tenant_payment_key("c1", "t1")})
        self.assertEqual((guard["operation"], guard["operation_id"]), ("bank_reconciliation", "statement1"))
        self.assertEqual((await self.db.bank_statements.find_one({"id": "statement1"}))["reconciliation_status"],
                         "registering")
        with self.assertRaises(PaymentAttemptConflict):
            await self.register(AsyncMock())
        with self.assertRaises(PaymentAttemptConflict):
            await acquire_payment_guard(self.db, company_id="c1", tenant_id="t1", kind="sms", owner="sms1")

    async def test_old_incomplete_booking_requires_review(self):
        await self.prepare()
        await self.create(None, None)
        with self.assertRaises(RuntimeError):
            await self.register(AsyncMock())
        guard = await self.db.tenant_payment_guards.find_one({"_id": tenant_payment_key("c1", "t1")})
        self.assertEqual(guard["operation_id"], "statement1")

    async def test_missing_statement_releases_guard(self):
        payment, created, error = await self.register(AsyncMock())
        self.assertIsNone(payment)
        self.assertFalse(created)
        self.assertEqual(error.status_code, 404)
        self.assertIsNone(await self.db.tenant_payment_guards.find_one({"_id": tenant_payment_key("c1", "t1")}))

    async def test_statement_claimed_by_another_tenant_does_not_leave_our_guard(self):
        await self.prepare()
        await self.db.bank_statements.update_one(
            {"id": "statement1"},
            {"$set": {"reconciliation_status": "registering", "registration_tenant_id": "t2"}},
        )
        payment, created, error = await self.register(AsyncMock())
        self.assertIsNone(payment)
        self.assertFalse(created)
        self.assertEqual(error.status_code, 409)
        self.assertIsNone(await self.db.tenant_payment_guards.find_one({"_id": tenant_payment_key("c1", "t1")}))

    async def test_duplicate_reference_rejected_without_leaving_guard(self):
        await self.prepare()
        await self.db.payments.insert_one({
            "id": "previous", "company_id": "c1", "tenant_id": "t1", "method": "bank",
            "amount": 50, "currency": "SRD", "paid_at": "2026-01-01",
            "bank_reference": "ref1", "status": "approved", "receipt_number": "receipt1",
        })
        payment, created, error = await self.register(AsyncMock(), reference="ref1")
        self.assertIsNone(payment)
        self.assertFalse(created)
        self.assertEqual(error.status_code, 409)
        self.assertIsNone(await self.db.tenant_payment_guards.find_one({"_id": tenant_payment_key("c1", "t1")}))


class BankRegistrationUnitTests(BankRegistrationCases, unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.db = SimpleNamespace(tenant_payment_guards=Guards(), bank_statements=Records(), payments=Records())

    async def test_finalization_failure_retains_guard(self):
        await self.prepare()
        update = self.db.bank_statements.update_one

        async def fail_finalization(query, changes):
            if changes.get("$set", {}).get("reconciliation_status") == "registered":
                return SimpleNamespace(modified_count=0, matched_count=0)
            return await update(query, changes)

        self.db.bank_statements.update_one = fail_finalization
        with self.assertRaises(RuntimeError):
            await self.register(self.create)
        self.assertIsNotNone(await self.db.payments.find_one({"id": "payment1"}))
        self.assertIsNotNone(await self.db.tenant_payment_guards.find_one({"_id": tenant_payment_key("c1", "t1")}))


@unittest.skipUnless(os.environ.get("SMS_BOOKING_MONGO_URL"), "MongoDB replica set is required")
class BankRegistrationMongoTests(BankRegistrationCases, unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.client = AsyncIOMotorClient(os.environ["SMS_BOOKING_MONGO_URL"], serverSelectionTimeoutMS=5000)
        self.name = f"test_bank_guard_{uuid4().hex}"
        self.db = self.client[self.name]

    async def asyncTearDown(self):
        await self.client.drop_database(self.name)
        self.client.close()
