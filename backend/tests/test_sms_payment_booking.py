import asyncio
import os
import unittest
from uuid import uuid4
from unittest.mock import AsyncMock, patch

from motor.motor_asyncio import AsyncIOMotorClient
from pymongo.errors import DuplicateKeyError

from sms_payment_attempts import PaymentAttemptConflict, _tenant_key, begin_provider_request, tenant_payment_key
from sms_payment_booking import book_verified_payment, preflight_reserved_payment, release_booked_attempt
from sms_payment_reconciliation import reconcile_sms_payment
from tenant_payment_guard import cancel_reserved_sms_attempt, guard_reserved_sms_attempt


@unittest.skipUnless(os.environ.get("SMS_BOOKING_MONGO_URL"), "MongoDB replica set is required")
class SmsPaymentBookingTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.client = AsyncIOMotorClient(os.environ["SMS_BOOKING_MONGO_URL"], serverSelectionTimeoutMS=5000)
        self.name = f"test_sms_booking_{uuid4().hex}"
        self.db = self.client[self.name]
        await self.db.sms_payment_attempts.insert_one({
            "_id": "key", "attempt_id": "attempt1", "state": "verified",
            "company_id": "company1", "tenant_id": "tenant1",
            "item": {"kind": "invoice", "id": "invoice1"}, "currency": "SRD",
            "amount_cents": 7500, "method": "card", "provider_id": "pi_123",
            "guard_owner": "attempt1",
        })
        await self.db.tenant_payment_guards.insert_one({
            "_id": tenant_payment_key("company1", "tenant1"), "company_id": "company1",
            "tenant_id": "tenant1", "kind": "sms", "owner": "attempt1",
        })
        await self.db.invoices.insert_one({
            "id": "invoice1", "company_id": "company1", "tenant_id": "tenant1",
            "invoice_number": "F-1", "amount": 100.0, "paid_amount": 25.0,
            "currency": "SRD", "status": "partial",
        })
        await self.db.payments.create_index("receipt_number", unique=True)

    async def asyncTearDown(self):
        await self.client.drop_database(self.name)
        self.client.close()

    async def book(self):
        return await book_verified_payment(self.db, self.client, key="key", attempt_id="attempt1")

    async def test_booking_and_retries_update_invoice_once(self):
        first, second = await asyncio.gather(self.book(), self.book())
        self.assertEqual(first["id"], second["id"])
        self.assertEqual(first["receipt_number"], second["receipt_number"])
        self.assertEqual(await self.db.payments.count_documents({}), 1)
        invoice = await self.db.invoices.find_one({"id": "invoice1"})
        self.assertEqual((invoice["paid_amount"], invoice["status"]), (100, "paid"))
        self.assertEqual((await self.db.sms_payment_attempts.find_one({"_id": "key"}))["state"], "booked")
        self.assertEqual((await self.book())["id"], first["id"])

    async def test_new_unpaid_invoice_without_paid_amount_can_be_booked(self):
        await self.db.invoices.update_one(
            {"id": "invoice1"}, {"$unset": {"paid_amount": ""}, "$set": {"status": "open"}},
        )
        await self.db.sms_payment_attempts.update_one({"_id": "key"}, {"$set": {"amount_cents": 10000}})
        await self.book()
        invoice = await self.db.invoices.find_one({"id": "invoice1"})
        self.assertEqual((invoice["paid_amount"], invoice["status"]), (100, "paid"))

    async def test_failed_payment_insert_rolls_back_invoice_and_attempt(self):
        await self.db.payments.insert_one({"_id": "sms-attempt1", "receipt_number": "other"})
        with self.assertRaises(DuplicateKeyError):
            await self.book()
        invoice = await self.db.invoices.find_one({"id": "invoice1"})
        self.assertEqual((invoice["paid_amount"], invoice["status"]), (25, "partial"))
        self.assertEqual((await self.db.sms_payment_attempts.find_one({"_id": "key"}))["state"], "verified")

    async def test_modified_balance_or_other_tenant_remains_unbooked(self):
        await self.db.invoices.update_one({"id": "invoice1"}, {"$set": {"paid_amount": 50}})
        with self.assertRaises(PaymentAttemptConflict):
            await self.book()
        await self.db.invoices.update_one(
            {"id": "invoice1"}, {"$set": {"paid_amount": 25, "tenant_id": "tenant2"}},
        )
        with self.assertRaises(PaymentAttemptConflict):
            await self.book()
        self.assertEqual(await self.db.payments.count_documents({}), 0)
        self.assertEqual((await self.db.sms_payment_attempts.find_one({"_id": "key"}))["state"], "verified")

    async def test_active_plan_requires_review(self):
        await self.db.payment_plans.insert_one({
            "id": "plan1", "company_id": "company1", "tenant_id": "tenant1",
            "invoice_ids": ["invoice1"], "status": "active",
        })
        with self.assertRaises(PaymentAttemptConflict):
            await self.book()
        self.assertEqual(await self.db.payments.count_documents({}), 0)

    async def test_booked_attempt_release_and_replay(self):
        payment = await self.book()
        await asyncio.gather(*[
            release_booked_attempt(self.db, self.client, key="key", attempt_id="attempt1")
            for _ in range(2)
        ])
        self.assertIsNone(await self.db.sms_payment_attempts.find_one({"_id": "key"}))
        self.assertEqual(await self.db.sms_payment_attempt_history.count_documents({}), 1)
        self.assertEqual(await self.db.tenant_payment_guards.count_documents({}), 0)
        await self.db.sms_payment_attempts.insert_one({"_id": "key", "attempt_id": "next", "state": "reserved"})
        self.assertEqual((await self.book())["id"], payment["id"])
        await release_booked_attempt(self.db, self.client, key="key", attempt_id="attempt1")
        self.assertEqual((await self.db.sms_payment_attempts.find_one({"_id": "key"}))["attempt_id"], "next")

    async def test_history_collision_rolls_back_release(self):
        await self.book()
        await self.db.sms_payment_attempt_history.insert_one({"_id": "attempt1"})
        with self.assertRaises(DuplicateKeyError):
            await release_booked_attempt(self.db, self.client, key="key", attempt_id="attempt1")
        self.assertEqual((await self.db.sms_payment_attempts.find_one({"_id": "key"}))["state"], "booked")

    async def test_reconciliation_verifies_and_recovers_without_browser(self):
        await self.db.sms_payment_attempts.update_one(
            {"_id": "key"}, {"$set": {
                "state": "open", "provider_amount_cents": 250, "provider_currency": "EUR", "stripe_mode": "test",
            }},
        )
        proof = {"provider_id": "pi_123", "status": "paid", "amount_cents": 250, "currency": "EUR"}
        with patch("sms_payment_providers._stripe_proof", new=AsyncMock(return_value=proof)) as verify:
            first = await reconcile_sms_payment(self.db, self.client, key="key", attempt_id="attempt1")
            second = await reconcile_sms_payment(self.db, self.client, key="key", attempt_id="attempt1")
            verify.assert_awaited_once()
        self.assertEqual(first["id"], second["id"])
        self.assertEqual(await self.db.payments.count_documents({}), 1)
        self.assertEqual((await self.db.invoices.find_one({"id": "invoice1"}))["paid_amount"], 100)
        self.assertEqual((await self.db.sms_payment_attempt_history.find_one({"_id": "attempt1"}))["state"], "booked")

    async def test_preflight_observes_changed_balance_without_booking(self):
        attempt = await self.db.sms_payment_attempts.find_one({"_id": "key"})
        await self.db.sms_payment_attempts.delete_one({"_id": "key"})
        attempt.pop("provider_id", None)
        key = _tenant_key(attempt["company_id"], attempt["tenant_id"], attempt["item"])
        attempt.update({"_id": key, "state": "reserved", "provider_amount_cents": 250,
                        "provider_currency": "EUR", "stripe_mode": "test"})
        await self.db.sms_payment_attempts.insert_one(attempt)
        await preflight_reserved_payment(self.db, self.client, key=key, attempt_id="attempt1")
        await self.db.payments.insert_one({
            "_id": "existing", "company_id": "company1", "tenant_id": "tenant1",
            "status": "approving", "receipt_number": "other",
        })
        with self.assertRaises(PaymentAttemptConflict):
            await preflight_reserved_payment(self.db, self.client, key=key, attempt_id="attempt1")
        await self.db.payments.delete_one({"_id": "existing"})
        await self.db.kiosk_stripe_payments.insert_one({
            "_id": "stripe", "company_id": "company1", "tenant_id": "tenant1", "status": "pending",
        })
        with self.assertRaises(PaymentAttemptConflict):
            await preflight_reserved_payment(self.db, self.client, key=key, attempt_id="attempt1")
        await self.db.kiosk_stripe_payments.update_one({"_id": "stripe"}, {"$set": {"status": "paid"}})
        with self.assertRaises(PaymentAttemptConflict):
            await preflight_reserved_payment(self.db, self.client, key=key, attempt_id="attempt1")
        await self.db.kiosk_stripe_payments.delete_one({"_id": "stripe"})
        await self.db.kiosk_mope_payments.insert_one({
            "_id": "mope", "company_id": "company1", "tenant_id": "tenant1", "status": "expired",
        })
        with self.assertRaises(PaymentAttemptConflict):
            await preflight_reserved_payment(self.db, self.client, key=key, attempt_id="attempt1")
        await self.db.kiosk_mope_payments.update_one({"_id": "mope"}, {"$set": {"status": "paid"}})
        with self.assertRaises(PaymentAttemptConflict):
            await preflight_reserved_payment(self.db, self.client, key=key, attempt_id="attempt1")
        await self.db.kiosk_mope_payments.delete_one({"_id": "mope"})
        await self.db.invoices.update_one({"id": "invoice1"}, {"$set": {"paid_amount": 50}})
        with self.assertRaises(PaymentAttemptConflict):
            await preflight_reserved_payment(self.db, self.client, key=key, attempt_id="attempt1")
        self.assertEqual(await self.db.payments.count_documents({}), 0)
        self.assertEqual((await self.db.sms_payment_attempts.find_one({"_id": key}))["state"], "reserved")

    async def test_old_fully_booked_stripe_and_mope_requests_do_not_block(self):
        for provider in ("stripe", "mope"):
            invoice_id, payment_id = f"{provider}-invoice", f"{provider}-payment"
            await self.db.invoices.insert_one({
                "id": invoice_id, "company_id": "company1", "tenant_id": "tenant1",
                "status": "paid", "amount": 50, "paid_amount": 50, "currency": "SRD",
            })
            payment = {
                "id": payment_id, "company_id": "company1", "tenant_id": "tenant1",
                "status": "approved", "amount": 50, "currency": "SRD", "receipt_number": payment_id,
                "allocations": [{"invoice_id": invoice_id, "amount": 50}],
            }
            if provider == "stripe":
                await self.db.kiosk_stripe_payments.insert_one({
                    "company_id": "company1", "tenant_id": "tenant1", "status": "paid", "currency": "SRD",
                    "amount": 50, "method": "card", "consumed": True, "payment_intent_id": "pi-old",
                })
                payment.update({"method": "creditcard", "stripe_payment_intent_id": "pi-old"})
            else:
                await self.db.kiosk_mope_payments.insert_one({
                    "company_id": "company1", "tenant_id": "tenant1", "status": "paid", "currency": "SRD",
                    "amount_cents": 5000, "booked_amount_cents": 5000, "payment_request_id": "mp-old",
                })
                payment.update({"method": "mope", "mope_payment_request_id": "mp-old"})
            await self.db.payments.insert_one(payment)
        await self.book()
        self.assertEqual((await self.db.invoices.find_one({"id": "invoice1"}))["paid_amount"], 100)

    async def test_old_provider_allocations_must_not_exceed_invoice_balance(self):
        await self.db.kiosk_stripe_payments.insert_one({
            "company_id": "company1", "tenant_id": "tenant1", "status": "paid", "currency": "SRD",
            "amount": 25, "method": "card", "consumed": True, "payment_intent_id": "pi-old",
        })
        for number in (1, 2):
            await self.db.payments.insert_one({
                "id": f"old-{number}", "company_id": "company1", "tenant_id": "tenant1",
                "status": "approved", "amount": 25, "currency": "SRD", "receipt_number": f"old-{number}",
                "method": "creditcard", "stripe_payment_intent_id": "pi-old" if number == 1 else "pi-other",
                "allocations": [{"invoice_id": "invoice1", "amount": 25}],
            })
        with self.assertRaises(PaymentAttemptConflict):
            await self.book()
        self.assertEqual((await self.db.invoices.find_one({"id": "invoice1"}))["paid_amount"], 25)

    async def test_pending_existing_payment_blocks_booking(self):
        await self.db.payments.insert_one({
            "_id": "existing", "company_id": "company1", "tenant_id": "tenant1",
            "status": "pending_approval", "receipt_number": "other",
        })
        with self.assertRaises(PaymentAttemptConflict):
            await self.book()
        self.assertEqual((await self.db.invoices.find_one({"id": "invoice1"}))["paid_amount"], 25)
        self.assertEqual((await self.db.sms_payment_attempts.find_one({"_id": "key"}))["state"], "verified")

    async def test_guarded_start_and_cancel_cannot_both_win(self):
        attempt = await self.db.sms_payment_attempts.find_one({"_id": "key"})
        await self.db.sms_payment_attempts.delete_one({"_id": "key"})
        await self.db.tenant_payment_guards.delete_one({"_id": tenant_payment_key("company1", "tenant1")})
        key = _tenant_key(attempt["company_id"], attempt["tenant_id"], attempt["item"])
        attempt.pop("provider_id", None)
        attempt.pop("guard_owner", None)
        attempt.update({"_id": key, "state": "reserved", "provider_amount_cents": 250,
                        "provider_currency": "EUR", "stripe_mode": "test"})
        await self.db.sms_payment_attempts.insert_one(attempt)
        await guard_reserved_sms_attempt(self.db, self.client, key=key, attempt_id="attempt1")
        guarded = await self.db.sms_payment_attempts.find_one({"_id": key})
        start, cancel = await asyncio.gather(
            begin_provider_request(self.db.sms_payment_attempts, guarded),
            cancel_reserved_sms_attempt(self.db, self.client, key=key, attempt_id="attempt1"),
            return_exceptions=True,
        )
        current = await self.db.sms_payment_attempts.find_one({"_id": key})
        guard = await self.db.tenant_payment_guards.find_one({"_id": key})
        if start is True:
            self.assertIsInstance(cancel, PaymentAttemptConflict)
            self.assertEqual(current["state"], "creating")
            self.assertEqual(guard["owner"], "attempt1")
        else:
            self.assertIs(start, False)
            self.assertIsNone(cancel)
            self.assertIsNone(current)
            self.assertIsNone(guard)
            self.assertEqual((await self.db.sms_payment_attempt_history.find_one({"_id": "attempt1"}))["state"],
                             "cancelled")

    async def test_unguarded_cancel_racing_guard_does_not_leave_orphan(self):
        attempt = await self.db.sms_payment_attempts.find_one({"_id": "key"})
        await self.db.sms_payment_attempts.delete_one({"_id": "key"})
        await self.db.tenant_payment_guards.delete_one({"_id": tenant_payment_key("company1", "tenant1")})
        key = _tenant_key(attempt["company_id"], attempt["tenant_id"], attempt["item"])
        attempt.pop("provider_id", None)
        attempt.pop("guard_owner", None)
        attempt.update({"_id": key, "state": "reserved"})
        await self.db.sms_payment_attempts.insert_one(attempt)
        guard_result, cancel_result = await asyncio.gather(
            guard_reserved_sms_attempt(self.db, self.client, key=key, attempt_id="attempt1"),
            cancel_reserved_sms_attempt(self.db, self.client, key=key, attempt_id="attempt1"),
            return_exceptions=True,
        )
        self.assertIsNone(cancel_result)
        self.assertTrue(guard_result is None or isinstance(guard_result, PaymentAttemptConflict))
        self.assertIsNone(await self.db.sms_payment_attempts.find_one({"_id": key}))
        self.assertIsNone(await self.db.tenant_payment_guards.find_one({"_id": key}))
        self.assertEqual((await self.db.sms_payment_attempt_history.find_one({"_id": "attempt1"}))["state"],
                         "cancelled")

    async def setup_installment(self):
        await self.db.tenants.insert_one({"id": "tenant1", "company_id": "company1"})
        await self.db.sms_payment_attempts.update_one(
            {"_id": "key"}, {"$set": {"item": {"kind": "installment", "plan_id": "plan1", "sequence": 1}}},
        )
        await self.db.payment_plans.insert_one({
            "id": "plan1", "company_id": "company1", "tenant_id": "tenant1", "status": "active",
            "invoice_ids": ["invoice1"], "total_amount": 75.0, "currency": "SRD",
        })
        await self.db.payment_plan_installments.insert_one({
            "id": "inst1", "plan_id": "plan1", "company_id": "company1",
            "sequence": 1, "amount": 75.0, "status": "pending",
        })

    async def test_installment_booking_concurrent_retry(self):
        await self.setup_installment()
        first, second = await asyncio.gather(self.book(), self.book())
        self.assertEqual(first["id"], second["id"])
        self.assertEqual(await self.db.payments.count_documents({}), 1)
        self.assertEqual((await self.db.invoices.find_one({"id": "invoice1"}))["paid_amount"], 100)
        self.assertEqual((await self.db.payment_plan_installments.find_one({"id": "inst1"}))["status"], "paid")
        self.assertEqual((await self.db.payment_plans.find_one({"id": "plan1"}))["status"], "completed")

    async def test_installment_insert_failure_rolls_back(self):
        await self.setup_installment()
        await self.db.payments.insert_one({"_id": "sms-attempt1", "receipt_number": "other"})
        with self.assertRaises(DuplicateKeyError):
            await self.book()
        self.assertEqual((await self.db.invoices.find_one({"id": "invoice1"}))["paid_amount"], 25)
        self.assertEqual((await self.db.payment_plan_installments.find_one({"id": "inst1"}))["status"], "pending")
        self.assertEqual((await self.db.payment_plans.find_one({"id": "plan1"}))["status"], "active")
        self.assertEqual((await self.db.sms_payment_attempts.find_one({"_id": "key"}))["state"], "verified")
