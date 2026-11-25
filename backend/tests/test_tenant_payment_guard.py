import asyncio
import copy
import os
import unittest
from types import SimpleNamespace
from uuid import uuid4

from motor.motor_asyncio import AsyncIOMotorClient
from pymongo.errors import DuplicateKeyError

from sms_payment_attempts import PaymentAttemptConflict
from tenant_payment_guard import acquire_payment_guard, legacy_payment_guard, release_payment_guard


class Guards:
    def __init__(self):
        self.docs = {}

    def with_options(self, **_kwargs):
        return self

    async def find_one(self, query, session=None):
        return copy.deepcopy(self.docs.get(query["_id"]))

    async def insert_one(self, doc, session=None):
        if doc["_id"] in self.docs:
            raise DuplicateKeyError("duplicate")
        self.docs[doc["_id"]] = copy.deepcopy(doc)

    async def delete_one(self, query, session=None):
        doc = self.docs.get(query["_id"])
        if doc and all(doc.get(name) == value for name, value in query.items()):
            del self.docs[query["_id"]]
            return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)


class TenantPaymentGuardTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.db = SimpleNamespace(tenant_payment_guards=Guards())
        self.scope = {"company_id": "c1", "tenant_id": "t1"}

    async def test_only_one_owner_can_hold_tenant_guard(self):
        results = await asyncio.gather(*[
            acquire_payment_guard(self.db, **self.scope, kind="legacy", owner=f"op{i}")
            for i in range(10)
        ], return_exceptions=True)
        self.assertEqual(sum(isinstance(result, dict) for result in results), 1)
        self.assertEqual(sum(isinstance(result, PaymentAttemptConflict) for result in results), 9)

    async def test_sms_blocks_other_payments_and_only_owner_can_release(self):
        await acquire_payment_guard(self.db, **self.scope, kind="sms", owner="attempt1")
        with self.assertRaises(PaymentAttemptConflict):
            await acquire_payment_guard(self.db, **self.scope, kind="sms", owner="attempt1")
        with self.assertRaises(PaymentAttemptConflict):
            await acquire_payment_guard(self.db, **self.scope, kind="legacy", owner="cash")
        with self.assertRaises(ValueError):
            await release_payment_guard(self.db, **self.scope, kind="sms", owner="attempt1")
        with self.assertRaises(ValueError):
            await release_payment_guard(self.db, **self.scope, kind="sms", owner="attempt1",
                                        session=SimpleNamespace(in_transaction=False))
        with self.assertRaises(PaymentAttemptConflict):
            await release_payment_guard(self.db, **self.scope, kind="sms", owner="other",
                                        session=SimpleNamespace(in_transaction=True))
        await release_payment_guard(self.db, **self.scope, kind="sms", owner="attempt1",
                                    session=SimpleNamespace(in_transaction=True))
        await acquire_payment_guard(self.db, **self.scope, kind="legacy", owner="cash")

    async def test_scopes_are_independent(self):
        first = await acquire_payment_guard(self.db, **self.scope, kind="sms", owner="attempt1")
        second = await acquire_payment_guard(
            self.db, company_id="c2", tenant_id="t1", kind="legacy", owner="cash",
        )
        self.assertNotEqual(first["_id"], second["_id"])

    async def test_failed_legacy_operation_keeps_guard_for_review(self):
        with self.assertRaises(RuntimeError):
            async with legacy_payment_guard(self.db, **self.scope):
                raise RuntimeError("partial write")
        with self.assertRaises(PaymentAttemptConflict):
            await acquire_payment_guard(self.db, **self.scope, kind="sms", owner="attempt1")
        self.assertEqual(len(self.db.tenant_payment_guards.docs), 1)

    async def test_completed_legacy_operation_releases_guard(self):
        async with legacy_payment_guard(self.db, **self.scope):
            with self.assertRaises(PaymentAttemptConflict):
                await acquire_payment_guard(self.db, **self.scope, kind="sms", owner="attempt1")
        await acquire_payment_guard(self.db, **self.scope, kind="sms", owner="attempt1")

    async def test_provider_reference_is_scoped_to_legacy_operation(self):
        guard = await acquire_payment_guard(
            self.db, **self.scope, kind="legacy", owner="owner",
            operation="payment_creation", operation_id="p1", provider="stripe", provider_reference="pi1",
        )
        self.assertEqual((guard["provider"], guard["provider_reference"]), ("stripe", "pi1"))
        with self.assertRaises(ValueError):
            await acquire_payment_guard(
                self.db, company_id="c2", tenant_id="t1", kind="sms", owner="sms1",
                provider="stripe", provider_reference="pi1",
            )
        with self.assertRaises(ValueError):
            await acquire_payment_guard(
                self.db, company_id="c2", tenant_id="t1", kind="legacy", owner="owner",
                operation="payment_creation", operation_id="p1", provider="stripe",
            )


@unittest.skipUnless(os.environ.get("SMS_BOOKING_MONGO_URL"), "MongoDB replica set is required")
class TenantPaymentGuardMongoTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.client = AsyncIOMotorClient(os.environ["SMS_BOOKING_MONGO_URL"], serverSelectionTimeoutMS=5000)
        self.name = f"test_tenant_guard_{uuid4().hex}"
        self.db = self.client[self.name]
        self.scope = {"company_id": "c1", "tenant_id": "t1"}

    async def asyncTearDown(self):
        await self.client.drop_database(self.name)
        self.client.close()

    async def test_competing_guards_and_transactional_release(self):
        results = await asyncio.gather(
            acquire_payment_guard(self.db, **self.scope, kind="sms", owner="attempt1"),
            acquire_payment_guard(self.db, **self.scope, kind="legacy", owner="cash"),
            return_exceptions=True,
        )
        self.assertEqual(sum(isinstance(result, dict) for result in results), 1)
        self.assertEqual(sum(isinstance(result, PaymentAttemptConflict) for result in results), 1)
        winner = next(result for result in results if isinstance(result, dict))
        if winner["kind"] == "legacy":
            await release_payment_guard(self.db, **self.scope, kind="legacy", owner="cash")
            await acquire_payment_guard(self.db, **self.scope, kind="sms", owner="attempt1")

        async def rollback(session):
            await release_payment_guard(self.db, **self.scope, kind="sms", owner="attempt1", session=session)
            raise RuntimeError("rollback")

        async with await self.client.start_session() as session:
            with self.assertRaises(RuntimeError):
                await session.with_transaction(rollback)
        with self.assertRaises(PaymentAttemptConflict):
            await acquire_payment_guard(self.db, **self.scope, kind="legacy", owner="cash")

        async def release(session):
            await release_payment_guard(self.db, **self.scope, kind="sms", owner="attempt1", session=session)

        async with await self.client.start_session() as session:
            await session.with_transaction(release)
        await acquire_payment_guard(self.db, **self.scope, kind="legacy", owner="cash")
