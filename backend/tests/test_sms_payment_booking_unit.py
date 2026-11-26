import asyncio
import copy
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import stripe
from pymongo.errors import DuplicateKeyError

from sms_payment_attempts import (
    PaymentAttemptConflict, _tenant_key, begin_provider_request, reserve_attempt, tenant_payment_key,
)
from sms_payment_booking import (
    _previous_request_fully_booked, book_verified_payment, preflight_reserved_payment, release_booked_attempt,
)
from sms_payment_providers import create_sms_stripe_intent
from sms_payment_reconciliation import reconcile_sms_payment
from tenant_payment_guard import acquire_payment_guard, cancel_reserved_sms_attempt, guard_reserved_sms_attempt


def matches(doc, query):
    for key, value in query.items():
        if key == "allocations.invoice_id":
            actual = [entry.get("invoice_id") for entry in doc.get("allocations") or [] if isinstance(entry, dict)]
        else:
            actual = doc.get(key)
        if isinstance(value, dict) and "$ne" in value:
            if actual == value["$ne"]:
                return False
        elif isinstance(value, dict) and "$in" in value:
            if actual not in value["$in"]:
                return False
        elif isinstance(value, dict) and "$nin" in value:
            if actual in value["$nin"]:
                return False
        elif isinstance(actual, list):
            if value not in actual:
                return False
        elif actual != value:
            return False
    return True


class Collection:
    def __init__(self, documents=None):
        self.docs = documents or []

    def with_options(self, **_kwargs):
        return self

    async def find_one(self, query, session=None):
        return next((copy.deepcopy(doc) for doc in self.docs if matches(doc, query)), None)

    def find(self, query, session=None):
        docs = [copy.deepcopy(doc) for doc in self.docs if matches(doc, query)]

        class Cursor:
            async def to_list(self, _length):
                return docs

        return Cursor()

    async def insert_one(self, doc, session=None):
        if any(existing.get("_id") == doc["_id"] for existing in self.docs):
            raise DuplicateKeyError("duplicate")
        self.docs.append(copy.deepcopy(doc))

    async def delete_one(self, query, session=None):
        for doc in self.docs:
            if matches(doc, query):
                self.docs.remove(doc)
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)

    async def update_one(self, query, update, session=None):
        for doc in self.docs:
            if matches(doc, query):
                doc.update(copy.deepcopy(update["$set"]))
                return SimpleNamespace(modified_count=1, matched_count=1)
        return SimpleNamespace(modified_count=0, matched_count=0)

    async def find_one_and_update(self, query, update, *, upsert, return_document, session=None):
        doc = next((doc for doc in self.docs if matches(doc, query)), None)
        if doc is None:
            doc = dict(query)
            self.docs.append(doc)
        doc["seq"] = doc.get("seq", 0) + update["$inc"]["seq"]
        return copy.deepcopy(doc)


class Client:
    def __init__(self, db):
        self.db = db
        self.lock = asyncio.Lock()
        self.in_transaction = False

    async def start_session(self):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        pass

    async def with_transaction(self, callback, **_kwargs):
        async with self.lock:
            snapshot = {name: copy.deepcopy(collection.docs) for name, collection in vars(self.db).items()}
            self.in_transaction = True
            try:
                return await callback(self)
            except BaseException:
                for name, docs in snapshot.items():
                    getattr(self.db, name).docs = docs
                raise
            finally:
                self.in_transaction = False


class BookingUnitTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.db = SimpleNamespace(
            sms_payment_attempts=Collection([{
                "_id": "key", "attempt_id": "attempt1", "state": "verified",
                "company_id": "c1", "tenant_id": "t1",
                "item": {"kind": "invoice", "id": "i1"},
                "amount_cents": 7500, "currency": "SRD", "method": "card", "provider_id": "pi_1",
                "guard_owner": "attempt1",
            }]),
            sms_payment_attempt_history=Collection(),
            tenant_payment_guards=Collection([{
                "_id": tenant_payment_key("c1", "t1"), "company_id": "c1", "tenant_id": "t1",
                "kind": "sms", "owner": "attempt1",
            }]),
            invoices=Collection([{
                "id": "i1", "company_id": "c1", "tenant_id": "t1",
                "amount": 100.0, "paid_amount": 25.0, "currency": "SRD", "status": "partial",
            }]),
            payments=Collection(), payment_plans=Collection(), payment_plan_installments=Collection(),
            kiosk_stripe_payments=Collection(), kiosk_mope_payments=Collection(),
            tenants=Collection([{"id": "t1", "company_id": "c1", "apartment_id": "a1"}]),
            counters=Collection(),
        )
        self.client = Client(self.db)

    async def book(self):
        return await book_verified_payment(self.db, self.client, key="key", attempt_id="attempt1")

    async def test_booking_is_idempotent(self):
        first, second = await asyncio.gather(self.book(), self.book())
        self.assertEqual(first["id"], second["id"])
        self.assertEqual(len(self.db.payments.docs), 1)
        self.assertEqual(self.db.invoices.docs[0]["paid_amount"], 100)
        self.assertEqual(self.db.sms_payment_attempts.docs[0]["state"], "booked")

    async def test_new_unpaid_invoice_without_paid_amount_can_be_booked(self):
        invoice = self.db.invoices.docs[0]
        invoice.pop("paid_amount")
        invoice["status"] = "open"
        self.db.sms_payment_attempts.docs[0]["amount_cents"] = 10000
        await self.book()
        self.assertEqual((invoice["paid_amount"], invoice["status"]), (100, "paid"))

    async def test_reminder_invoice_statuses_can_be_booked_without_a_prior_payment(self):
        for status in ("sent", "pending", "overdue"):
            with self.subTest(status=status):
                self.setUp()
                invoice = self.db.invoices.docs[0]
                invoice.pop("paid_amount")
                invoice["status"] = status
                self.db.sms_payment_attempts.docs[0]["amount_cents"] = 10000
                await self.book()
                self.assertEqual((invoice["paid_amount"], invoice["status"]), (100, "paid"))

    async def test_missing_invoice_balance_with_previous_payment_stays_blocked(self):
        invoice = self.db.invoices.docs[0]
        invoice.pop("paid_amount")
        invoice["status"] = "open"
        self.db.sms_payment_attempts.docs[0]["amount_cents"] = 10000
        self.db.payments.docs.append({"_id": "prior", "status": "approved", "invoice_ids": ["i1"]})
        with self.assertRaises(PaymentAttemptConflict):
            await self.book()
        self.assertNotIn("paid_amount", self.db.invoices.docs[0])

    async def test_pending_payment_keeps_verified_attempt_and_guard(self):
        self.db.payments.docs.append({
            "_id": "p1", "company_id": "c1", "tenant_id": "t1", "status": "approving",
        })
        with self.assertRaises(PaymentAttemptConflict):
            await self.book()
        self.assertEqual(self.db.invoices.docs[0]["paid_amount"], 25)
        self.assertEqual(self.db.sms_payment_attempts.docs[0]["state"], "verified")
        self.assertEqual(self.db.tenant_payment_guards.docs[0]["owner"], "attempt1")

    async def test_rejecting_payment_keeps_verified_attempt_and_guard(self):
        self.db.payments.docs.append({
            "_id": "p1", "company_id": "c1", "tenant_id": "t1", "status": "rejecting",
        })
        with self.assertRaises(PaymentAttemptConflict):
            await self.book()
        self.assertEqual(self.db.invoices.docs[0]["paid_amount"], 25)
        self.assertEqual(self.db.sms_payment_attempts.docs[0]["state"], "verified")

    async def test_paid_legacy_provider_request_is_not_assumed_fully_booked(self):
        for collection in (self.db.kiosk_stripe_payments, self.db.kiosk_mope_payments):
            with self.subTest(provider=collection):
                collection.docs.append({
                    "_id": "previous", "company_id": "c1", "tenant_id": "t1", "status": "paid",
                })
                with self.assertRaises(PaymentAttemptConflict):
                    await self.book()
                self.assertEqual(self.db.invoices.docs[0]["paid_amount"], 25)
                self.assertEqual(self.db.sms_payment_attempts.docs[0]["state"], "verified")
                self.assertEqual(self.db.tenant_payment_guards.docs[0]["owner"], "attempt1")
                collection.docs.clear()

    async def test_other_tenant_and_cancelled_stripe_do_not_block_booking(self):
        self.db.kiosk_stripe_payments.docs.extend([
            {"_id": "cancelled", "company_id": "c1", "tenant_id": "t1", "status": "canceled"},
            {"_id": "other", "company_id": "c1", "tenant_id": "t2", "status": "paid"},
        ])
        self.db.kiosk_mope_payments.docs.append(
            {"_id": "other", "company_id": "c1", "tenant_id": "t2", "status": "paid"},
        )
        await self.book()
        self.assertEqual(self.db.invoices.docs[0]["paid_amount"], 100)

    def add_previous_request(self, provider):
        tx = {"_id": "previous", "company_id": "c1", "tenant_id": "t1",
              "status": "paid", "currency": "SRD"}
        payment = {"_id": "old-payment", "id": "old-payment", "company_id": "c1", "tenant_id": "t1",
                   "status": "approved", "amount": 50.0, "currency": "SRD",
                   "allocations": [{"invoice_id": "old-invoice", "amount": 50.0}]}
        if provider == "stripe":
            tx.update({"payment_intent_id": "pi-old", "amount": 50.0, "method": "card", "consumed": True})
            payment.update({"method": "creditcard", "stripe_payment_intent_id": "pi-old"})
            self.db.kiosk_stripe_payments.docs.append(tx)
        else:
            tx.update({"payment_request_id": "mp-old", "amount_cents": 5000, "booked_amount_cents": 5000})
            payment.update({"method": "mope", "mope_payment_request_id": "mp-old"})
            self.db.kiosk_mope_payments.docs.append(tx)
        self.db.payments.docs.append(payment)
        self.db.invoices.docs.append({"id": "old-invoice", "company_id": "c1", "tenant_id": "t1",
                                      "status": "paid", "amount": 50.0, "paid_amount": 50.0, "currency": "SRD"})
        return tx, payment

    async def test_fully_allocated_previous_stripe_does_not_block_booking(self):
        self.add_previous_request("stripe")
        await self.book()
        self.assertEqual(self.db.invoices.docs[0]["paid_amount"], 100)

    async def test_fully_allocated_previous_mope_does_not_block_booking(self):
        self.add_previous_request("mope")
        await self.book()
        self.assertEqual(self.db.invoices.docs[0]["paid_amount"], 100)

    async def test_previous_request_requires_consistent_complete_evidence(self):
        tx, payment = self.add_previous_request("stripe")
        scope = {"company_id": "c1", "tenant_id": "t1"}
        self.assertTrue(await _previous_request_fully_booked(self.db, tx, "stripe", scope, None))
        for field, value in (("status", "pending_approval"), ("currency", "EUR"),
                             ("amount", 40), ("allocations", [])):
            original = payment[field]
            payment[field] = value
            with self.subTest(field=field):
                self.assertFalse(await _previous_request_fully_booked(self.db, tx, "stripe", scope, None))
            payment[field] = original
        self.db.payments.docs.append({**payment, "_id": "duplicate", "id": "duplicate"})
        self.assertFalse(await _previous_request_fully_booked(self.db, tx, "stripe", scope, None))
        self.db.payments.docs.pop()
        self.db.payment_plans.docs.append({"id": "plan", **scope, "status": "active", "invoice_ids": ["old-invoice"]})
        self.assertFalse(await _previous_request_fully_booked(self.db, tx, "stripe", scope, None))

    async def test_two_recorded_allocations_cannot_exceed_invoice_paid_amount(self):
        tx, payment = self.add_previous_request("stripe")
        self.db.payments.docs.append({**payment, "_id": "other", "id": "other",
                                      "stripe_payment_intent_id": "other-intent"})
        scope = {"company_id": "c1", "tenant_id": "t1"}
        self.assertFalse(await _previous_request_fully_booked(self.db, tx, "stripe", scope, None))
        with self.assertRaises(PaymentAttemptConflict):
            await self.book()

    async def test_verified_payment_without_guard_is_not_booked(self):
        self.db.tenant_payment_guards.docs.clear()
        with self.assertRaises(PaymentAttemptConflict):
            await self.book()
        self.assertEqual(self.db.invoices.docs[0]["paid_amount"], 25)
        self.assertEqual(self.db.payments.docs, [])

    async def test_failure_after_invoice_update_rolls_back(self):
        self.db.payments.docs.append({"_id": "sms-attempt1"})
        with self.assertRaises(DuplicateKeyError):
            await self.book()
        self.assertEqual(self.db.invoices.docs[0]["paid_amount"], 25)
        self.assertEqual(self.db.sms_payment_attempts.docs[0]["state"], "verified")
        self.assertEqual(self.db.counters.docs, [])

    async def test_retry_after_commit_response_lost_does_not_book_twice(self):
        run = self.client.with_transaction

        async def lost_response(*args, **kwargs):
            await run(*args, **kwargs)
            raise ConnectionError("response lost")

        self.client.with_transaction = lost_response
        with self.assertRaises(ConnectionError):
            await self.book()
        self.client.with_transaction = run
        result = await self.book()
        self.assertEqual(result["id"], "sms-attempt1")
        self.assertEqual(len(self.db.payments.docs), 1)
        self.assertEqual(self.db.invoices.docs[0]["paid_amount"], 100)

    async def test_changed_balance_wrong_tenant_and_active_plan_fail_closed(self):
        self.db.invoices.docs[0]["paid_amount"] = 50
        with self.assertRaises(PaymentAttemptConflict):
            await self.book()
        self.db.invoices.docs[0].update({"paid_amount": 25, "tenant_id": "other"})
        with self.assertRaises(PaymentAttemptConflict):
            await self.book()
        self.db.invoices.docs[0]["tenant_id"] = "t1"
        self.db.payment_plans.docs.append({
            "company_id": "c1", "tenant_id": "t1", "invoice_ids": ["i1"], "status": "active",
        })
        with self.assertRaises(PaymentAttemptConflict):
            await self.book()
        self.assertEqual(self.db.payments.docs, [])

    async def test_booked_attempt_is_released_once_and_replay_stays_safe(self):
        payment = await self.book()
        await asyncio.gather(*[
            release_booked_attempt(self.db, self.client, key="key", attempt_id="attempt1")
            for _ in range(2)
        ])
        self.assertEqual(self.db.sms_payment_attempts.docs, [])
        self.assertEqual(len(self.db.sms_payment_attempt_history.docs), 1)
        self.assertEqual(self.db.tenant_payment_guards.docs, [])
        self.db.sms_payment_attempts.docs.append({"_id": "key", "attempt_id": "new", "state": "reserved"})
        self.assertEqual((await self.book())["id"], payment["id"])
        await release_booked_attempt(self.db, self.client, key="key", attempt_id="attempt1")
        self.assertEqual(self.db.sms_payment_attempts.docs[0]["attempt_id"], "new")
        with self.assertRaises(PaymentAttemptConflict):
            await release_booked_attempt(self.db, self.client, key="wrong", attempt_id="attempt1")
        self.assertEqual(len(self.db.payments.docs), 1)

    async def test_release_refuses_unbooked_or_inconsistent_payment(self):
        with self.assertRaises(PaymentAttemptConflict):
            await release_booked_attempt(self.db, self.client, key="key", attempt_id="attempt1")
        await self.book()
        self.db.payments.docs[0]["amount"] = 1
        with self.assertRaises(PaymentAttemptConflict):
            await release_booked_attempt(self.db, self.client, key="key", attempt_id="attempt1")
        self.assertEqual(len(self.db.sms_payment_attempts.docs), 1)
        self.assertEqual(self.db.sms_payment_attempt_history.docs, [])

    async def test_history_insert_failure_does_not_release_reservation(self):
        await self.book()
        self.db.sms_payment_attempt_history.docs.append({"_id": "attempt1"})
        with self.assertRaises(DuplicateKeyError):
            await release_booked_attempt(self.db, self.client, key="key", attempt_id="attempt1")
        self.assertEqual(self.db.sms_payment_attempts.docs[0]["state"], "booked")
        self.assertEqual(len(self.db.tenant_payment_guards.docs), 1)


class InstallmentBookingUnitTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        BookingUnitTests.setUp(self)
        self.db.sms_payment_attempts.docs[0].update({
            "item": {"kind": "installment", "plan_id": "p1", "sequence": 2},
            "amount_cents": 7500,
        })
        self.db.invoices.docs = [
            {"id": "i2", "company_id": "c1", "tenant_id": "t1", "period_month": 2,
             "amount": 100.0, "paid_amount": 0.0, "currency": "SRD", "status": "open"},
            {"id": "i1", "company_id": "c1", "tenant_id": "t1", "period_month": 1,
             "amount": 50.0, "paid_amount": 0.0, "currency": "SRD", "status": "open"},
        ]
        self.db.payment_plans.docs = [{
            "id": "p1", "company_id": "c1", "tenant_id": "t1", "status": "active",
            "invoice_ids": ["i2", "i1"], "total_amount": 150.0, "currency": "SRD",
        }]
        self.db.payment_plan_installments.docs = [
            {"id": "s1", "plan_id": "p1", "company_id": "c1", "sequence": 1,
             "amount": 75.0, "status": "pending"},
            {"id": "s2", "plan_id": "p1", "company_id": "c1", "sequence": 2,
             "amount": 75.0, "status": "pending"},
        ]

    async def book(self):
        return await book_verified_payment(self.db, self.client, key="key", attempt_id="attempt1")

    async def test_installment_allocates_only_linked_invoices_and_retries_once(self):
        first, second = await asyncio.gather(self.book(), self.book())
        self.assertEqual(first["id"], second["id"])
        self.assertEqual([(a["invoice_id"], a["amount"]) for a in first["allocations"]],
                         [("i1", 50), ("i2", 25)])
        self.assertEqual([(i["paid_amount"], i["status"]) for i in self.db.invoices.docs],
                         [(25, "partial"), (50, "paid")])
        self.assertEqual([i["status"] for i in self.db.payment_plan_installments.docs], ["pending", "paid"])
        self.assertEqual(self.db.payment_plans.docs[0]["status"], "active")
        self.assertEqual(len(self.db.payments.docs), 1)
        self.assertEqual(first["apartment_id"], "a1")
        await release_booked_attempt(self.db, self.client, key="key", attempt_id="attempt1")
        self.assertEqual((await self.book())["id"], first["id"])

    async def test_final_installment_completes_plan(self):
        self.db.payment_plan_installments.docs[0]["status"] = "paid"
        self.db.invoices.docs[0]["paid_amount"] = 75.0
        self.db.invoices.docs[0]["status"] = "partial"
        await self.book()
        self.assertEqual(self.db.payment_plans.docs[0]["status"], "completed")

    async def test_installment_conflicts_fail_closed(self):
        scenarios = [
            lambda: self.db.payment_plans.docs[0].update({"tenant_id": "other"}),
            lambda: self.db.invoices.docs[0].update({"tenant_id": "other"}),
            lambda: self.db.payment_plan_installments.docs[0].update({"status": "pending_payment"}),
            lambda: self.db.payment_plan_installments.docs[1].update({"amount": 70}),
            lambda: self.db.payment_plan_installments.docs[0].update({"sequence": 2}),
            lambda: self.db.payment_plans.docs[0].update({"invoice_ids": 0}),
            lambda: self.db.tenants.docs[0].update({"company_id": "other"}),
            lambda: self.db.invoices.docs[0].update({"paid_amount": 50}),
            lambda: self.db.payment_plans.docs.append({
                "id": "other", "company_id": "c1", "tenant_id": "t1",
                "invoice_ids": ["i1"], "status": "active",
            }),
        ]
        for scenario in scenarios:
            self.setUp()
            scenario()
            with self.assertRaises(PaymentAttemptConflict):
                await self.book()
            self.assertEqual(self.db.payments.docs, [])
            self.assertEqual(self.db.sms_payment_attempts.docs[0]["state"], "verified")

    async def test_payment_insert_failure_rolls_back_installment_and_invoice(self):
        self.db.payments.docs.append({"_id": "sms-attempt1"})
        with self.assertRaises(DuplicateKeyError):
            await self.book()
        self.assertEqual([i["paid_amount"] for i in self.db.invoices.docs], [0, 0])
        self.assertEqual([i["status"] for i in self.db.payment_plan_installments.docs], ["pending", "pending"])
        self.assertEqual(self.db.sms_payment_attempts.docs[0]["state"], "verified")


class ReconciliationUnitTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        BookingUnitTests.setUp(self)
        self.db.sms_payment_attempts.docs[0].update({
            "state": "open", "provider_amount_cents": 250,
            "provider_currency": "EUR", "stripe_mode": "test",
        })
        self.proof = {"provider_id": "pi_1", "status": "paid", "amount_cents": 250, "currency": "EUR"}

    async def reconcile(self):
        return await reconcile_sms_payment(self.db, self.client, key="key", attempt_id="attempt1")

    async def test_open_payment_verified_booked_archived_and_retried(self):
        with patch("sms_payment_providers._stripe_proof", new=AsyncMock(return_value=self.proof)) as verify:
            payment = await self.reconcile()
            self.db.sms_payment_attempts.docs.append({"_id": "key", "attempt_id": "next", "state": "reserved"})
            self.assertEqual((await self.reconcile())["id"], payment["id"])
            verify.assert_awaited_once()
        self.assertEqual(len(self.db.payments.docs), 1)
        self.assertEqual(self.db.invoices.docs[0]["paid_amount"], 100)
        self.assertEqual(self.db.sms_payment_attempts.docs[0]["attempt_id"], "next")
        self.assertEqual(self.db.sms_payment_attempt_history.docs[0]["state"], "booked")

    async def test_provider_not_paid_or_mismatched_leaves_attempt_open(self):
        for change in ({"status": "pending"}, {"amount_cents": 251}, {"provider_id": "other"}):
            with self.subTest(change=change), patch(
                "sms_payment_providers._stripe_proof", new=AsyncMock(return_value={**self.proof, **change}),
            ), self.assertRaises(PaymentAttemptConflict):
                await self.reconcile()
        self.assertEqual(self.db.sms_payment_attempts.docs[0]["state"], "open")
        self.assertEqual(self.db.payments.docs, [])

    async def test_provider_unavailable_does_not_book_or_release(self):
        with patch("sms_payment_providers._stripe_proof", new=AsyncMock(side_effect=ConnectionError("offline"))):
            with self.assertRaises(ConnectionError):
                await self.reconcile()
        self.assertEqual(self.db.sms_payment_attempts.docs[0]["state"], "open")
        self.assertEqual(self.db.payments.docs, [])
        self.assertEqual(self.db.sms_payment_attempt_history.docs, [])

    async def test_booking_conflict_remains_verified_until_resolved(self):
        self.db.invoices.docs[0]["paid_amount"] = 50
        with patch("sms_payment_providers._stripe_proof", new=AsyncMock(return_value=self.proof)) as verify:
            with self.assertRaises(PaymentAttemptConflict):
                await self.reconcile()
            self.assertEqual(self.db.sms_payment_attempts.docs[0]["state"], "verified")
            self.db.invoices.docs[0]["paid_amount"] = 25
            await self.reconcile()
            verify.assert_awaited_once()
        self.assertEqual(len(self.db.payments.docs), 1)

    async def test_uncertain_requests_never_reach_provider_or_release(self):
        with patch("sms_payment_providers._stripe_proof", new=AsyncMock()) as verify:
            for state in ("reserved", "creating", "uncertain"):
                self.db.sms_payment_attempts.docs[0]["state"] = state
                with self.subTest(state=state), self.assertRaises(PaymentAttemptConflict):
                    await self.reconcile()
                self.assertEqual(self.db.sms_payment_attempts.docs[0]["state"], state)
            verify.assert_not_awaited()

    async def test_release_failure_can_be_retried_without_rebooking(self):
        with patch("sms_payment_providers._stripe_proof", new=AsyncMock(return_value=self.proof)), \
                patch("sms_payment_reconciliation.release_booked_attempt",
                      new=AsyncMock(side_effect=ConnectionError("unavailable"))):
            with self.assertRaises(ConnectionError):
                await self.reconcile()
        self.assertEqual(self.db.sms_payment_attempts.docs[0]["state"], "booked")
        await self.reconcile()
        self.assertEqual(len(self.db.payments.docs), 1)
        self.assertEqual(self.db.sms_payment_attempt_history.docs[0]["state"], "booked")

    async def test_other_worker_can_finish_during_provider_lookup(self):
        async def concurrent_reconcile(_attempt):
            await self.db.sms_payment_attempts.update_one(
                {"_id": "key", "state": "open"}, {"$set": {"state": "verified"}},
            )
            await book_verified_payment(self.db, self.client, key="key", attempt_id="attempt1")
            await release_booked_attempt(self.db, self.client, key="key", attempt_id="attempt1")
            return self.proof

        with patch("sms_payment_providers._stripe_proof", new=AsyncMock(side_effect=concurrent_reconcile)):
            result = await self.reconcile()
        self.assertEqual(result["id"], "sms-attempt1")
        self.assertEqual(len(self.db.payments.docs), 1)


class PreflightUnitTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        BookingUnitTests.setUp(self)
        attempt = self.db.sms_payment_attempts.docs[0]
        attempt.pop("provider_id", None)
        self.key = _tenant_key(attempt["company_id"], attempt["tenant_id"], attempt["item"])
        attempt.update({
            "_id": self.key, "state": "reserved", "provider_amount_cents": 250,
            "provider_currency": "EUR", "stripe_mode": "test",
        })

    async def preflight(self):
        return await preflight_reserved_payment(self.db, self.client, key=self.key, attempt_id="attempt1")

    async def test_invoice_checks_booking_without_changing_records(self):
        self.assertEqual((await self.preflight())["state"], "reserved")
        self.assertEqual(self.db.invoices.docs[0]["paid_amount"], 25)
        self.assertEqual(self.db.payments.docs, [])
        self.assertEqual(self.db.counters.docs, [])

    async def test_invalid_snapshots_fail_before_provider_request(self):
        scenarios = [
            lambda: self.db.invoices.docs[0].update({"paid_amount": 50}),
            lambda: self.db.invoices.docs[0].update({"company_id": "other"}),
            lambda: self.db.payment_plans.docs.append({
                "id": "p1", "company_id": "c1", "tenant_id": "other", "invoice_ids": ["i1"], "status": "active",
            }),
            lambda: self.db.sms_payment_attempts.docs[0].update({"provider_amount_cents": 0}),
            lambda: self.db.sms_payment_attempts.docs[0].update({"provider_currency": "USD"}),
            lambda: self.db.sms_payment_attempts.docs[0].update({"state": "creating"}),
            lambda: self.db.sms_payment_attempts.docs[0].update({"tenant_id": "other"}),
            lambda: self.db.payments.docs.append({
                "_id": "p1", "company_id": "c1", "tenant_id": "t1", "status": "pending_approval",
            }),
            lambda: self.db.payments.docs.append({
                "_id": "p1", "company_id": "c1", "tenant_id": "t1", "status": "approving",
            }),
        ]
        for scenario in scenarios:
            self.setUp()
            scenario()
            with self.subTest(scenario=scenario), self.assertRaises(PaymentAttemptConflict):
                await self.preflight()
            self.assertTrue(all(payment.get("_id") != "sms-attempt1" for payment in self.db.payments.docs))

    async def test_pending_payment_in_another_scope_does_not_block_preflight(self):
        self.db.payments.docs.extend([
            {"_id": "other-company", "company_id": "c2", "tenant_id": "t1", "status": "pending_approval"},
            {"_id": "other-tenant", "company_id": "c1", "tenant_id": "t2", "status": "approving"},
            {"_id": "completed", "company_id": "c1", "tenant_id": "t1", "status": "approved"},
        ])
        self.assertEqual((await self.preflight())["state"], "reserved")

    async def test_open_legacy_provider_requests_block_preflight(self):
        for collection_name, status in (
            ("kiosk_stripe_payments", "pending"),
            ("kiosk_stripe_payments", "failed"),
            ("kiosk_mope_payments", "open"),
            ("kiosk_mope_payments", "expired"),
        ):
            self.setUp()
            collection = getattr(self.db, collection_name)
            collection.docs.append({"company_id": "c1", "tenant_id": "t1", "status": status})
            with self.subTest(provider=collection_name, status=status), self.assertRaises(PaymentAttemptConflict):
                await self.preflight()

    async def test_closed_or_other_tenant_provider_requests_do_not_block_preflight(self):
        self.db.kiosk_stripe_payments.docs.extend([
            {"company_id": "c1", "tenant_id": "t1", "status": "canceled"},
            {"company_id": "c1", "tenant_id": "t2", "status": "pending"},
        ])
        self.db.kiosk_mope_payments.docs.append(
            {"company_id": "c2", "tenant_id": "t1", "status": "open"},
        )
        self.assertEqual((await self.preflight())["state"], "reserved")

    async def test_installment_checks_all_linked_balances(self):
        InstallmentBookingUnitTests.setUp(self)
        attempt = self.db.sms_payment_attempts.docs[0]
        attempt.pop("provider_id", None)
        self.key = _tenant_key(attempt["company_id"], attempt["tenant_id"], attempt["item"])
        attempt.update({
            "_id": self.key, "state": "reserved", "provider_amount_cents": 250,
            "provider_currency": "EUR", "stripe_mode": "test",
        })
        await self.preflight()
        self.db.payment_plan_installments.docs[0]["status"] = "pending_payment"
        with self.assertRaises(PaymentAttemptConflict):
            await self.preflight()

    async def test_provider_request_uses_real_preflight(self):
        self.db.sms_payment_attempts.docs = []
        self.db.tenant_payment_guards.docs = []
        async def reserve():
            return await reserve_attempt(
                self.db.sms_payment_attempts, company_id="c1", tenant_id="t1",
                item={"kind": "invoice", "id": "i1"}, method="card", amount_cents=7500,
                currency="SRD", provider_amount_cents=250, provider_currency="EUR", stripe_mode="test",
            )

        attempt = await reserve()
        self.db.invoices.docs[0]["paid_amount"] = 50
        fake_deps = SimpleNamespace(require_plan_feature=AsyncMock())
        fake_route = SimpleNamespace(
            _cfg_doc=AsyncMock(return_value={"stripe_config": {}}),
            _active=lambda _: {"enabled": True, "mode": "test", "methods": ["card"],
                               "secret_key": "test-key", "publishable_key": "public-key"},
        )
        create = Mock(return_value=stripe.PaymentIntent.construct_from(
            {"id": "pi_1", "client_secret": "secret", "amount": 250,
             "currency": "eur", "livemode": False}, key=None,
        ))
        with patch.dict(sys.modules, {"routes": SimpleNamespace(_deps=fake_deps),
                                     "routes.company_stripe": fake_route}), \
                patch("sms_payment_providers.stripe.PaymentIntent.create", create):
            with self.assertRaises(PaymentAttemptConflict):
                await create_sms_stripe_intent(self.db, self.client, attempt)
            create.assert_not_called()
            self.assertEqual(self.db.sms_payment_attempts.docs, [])
            self.assertEqual(self.db.sms_payment_attempt_history.docs[-1]["state"], "cancelled")
            self.db.invoices.docs[0]["paid_amount"] = 25
            self.db.payments.docs.append({
                "_id": "p1", "company_id": "c1", "tenant_id": "t1", "status": "pending_approval",
            })
            attempt = await reserve()
            with self.assertRaises(PaymentAttemptConflict):
                await create_sms_stripe_intent(self.db, self.client, attempt)
            create.assert_not_called()
            self.assertEqual(self.db.sms_payment_attempts.docs, [])
            self.db.payments.docs.clear()
            attempt = await reserve()
            result = await create_sms_stripe_intent(self.db, self.client, attempt)
            self.assertEqual(result["payment_intent_id"], "pi_1")
            create.assert_called_once()

    def unguarded_attempt(self):
        attempt = self.db.sms_payment_attempts.docs[0]
        attempt.pop("guard_owner", None)
        self.db.tenant_payment_guards.docs.clear()
        return attempt

    async def test_guard_and_cancel_are_atomic_and_retry_safe(self):
        self.unguarded_attempt()
        await guard_reserved_sms_attempt(self.db, self.client, key=self.key, attempt_id="attempt1")
        await guard_reserved_sms_attempt(self.db, self.client, key=self.key, attempt_id="attempt1")
        self.assertEqual(len(self.db.tenant_payment_guards.docs), 1)
        await cancel_reserved_sms_attempt(self.db, self.client, key=self.key, attempt_id="attempt1")
        await cancel_reserved_sms_attempt(self.db, self.client, key=self.key, attempt_id="attempt1")
        self.assertEqual(self.db.sms_payment_attempts.docs, [])
        self.assertEqual(self.db.tenant_payment_guards.docs, [])
        self.assertEqual(self.db.sms_payment_attempt_history.docs[0]["state"], "cancelled")

    async def test_unguarded_cancel_preserves_another_operations_guard(self):
        self.unguarded_attempt()
        await acquire_payment_guard(self.db, company_id="c1", tenant_id="t1", kind="legacy", owner="cash")
        await cancel_reserved_sms_attempt(self.db, self.client, key=self.key, attempt_id="attempt1")
        await cancel_reserved_sms_attempt(self.db, self.client, key=self.key, attempt_id="attempt1")
        self.assertEqual(self.db.sms_payment_attempts.docs, [])
        self.assertEqual(self.db.sms_payment_attempt_history.docs[0]["state"], "cancelled")
        self.assertEqual(self.db.tenant_payment_guards.docs[0]["owner"], "cash")

    async def test_cancel_archive_failure_keeps_attempt_and_guard(self):
        self.unguarded_attempt()
        await guard_reserved_sms_attempt(self.db, self.client, key=self.key, attempt_id="attempt1")
        self.db.sms_payment_attempt_history.docs.append({"_id": "attempt1"})
        with self.assertRaises(DuplicateKeyError):
            await cancel_reserved_sms_attempt(self.db, self.client, key=self.key, attempt_id="attempt1")
        self.assertEqual(self.db.sms_payment_attempts.docs[0]["state"], "reserved")
        self.assertEqual(len(self.db.tenant_payment_guards.docs), 1)

    async def test_other_operation_blocks_provider_guard(self):
        self.unguarded_attempt()
        await acquire_payment_guard(self.db, company_id="c1", tenant_id="t1", kind="legacy", owner="cash")
        with self.assertRaises(PaymentAttemptConflict):
            await guard_reserved_sms_attempt(self.db, self.client, key=self.key, attempt_id="attempt1")
        self.assertEqual(self.db.sms_payment_attempts.docs[0]["state"], "reserved")
        self.assertEqual(self.db.tenant_payment_guards.docs[0]["owner"], "cash")

    async def test_conflicting_legacy_guard_cancels_only_unstarted_sms_attempt(self):
        attempt = self.unguarded_attempt().copy()
        await acquire_payment_guard(self.db, company_id="c1", tenant_id="t1", kind="legacy", owner="cash")
        fake_route = SimpleNamespace(_active=Mock(), _cfg_doc=AsyncMock())
        with patch.dict(sys.modules, {"routes": SimpleNamespace(_deps=SimpleNamespace()),
                                     "routes.company_stripe": fake_route}), \
                patch("sms_payment_providers.stripe.PaymentIntent.create") as create:
            with self.assertRaises(PaymentAttemptConflict):
                await create_sms_stripe_intent(self.db, self.client, attempt)
            create.assert_not_called()
        self.assertEqual(self.db.sms_payment_attempts.docs, [])
        self.assertEqual(self.db.sms_payment_attempt_history.docs[0]["state"], "cancelled")
        self.assertEqual(self.db.tenant_payment_guards.docs[0]["owner"], "cash")

    async def test_started_request_cannot_be_cancelled_as_unstarted(self):
        self.unguarded_attempt()
        await guard_reserved_sms_attempt(self.db, self.client, key=self.key, attempt_id="attempt1")
        stored = self.db.sms_payment_attempts.docs[0].copy()
        self.assertTrue(await begin_provider_request(self.db.sms_payment_attempts, stored))
        with self.assertRaises(PaymentAttemptConflict):
            await cancel_reserved_sms_attempt(self.db, self.client, key=self.key, attempt_id="attempt1")
        self.assertEqual(self.db.sms_payment_attempts.docs[0]["state"], "creating")
        self.assertEqual(len(self.db.tenant_payment_guards.docs), 1)

    async def test_changed_balance_after_guard_cancels_without_provider_call(self):
        attempt = self.unguarded_attempt().copy()
        real_preflight = preflight_reserved_payment
        count = 0

        async def changed_after_check(db, client, **kwargs):
            nonlocal count
            result = await real_preflight(db, client, **kwargs)
            count += 1
            if count == 1:
                self.db.invoices.docs[0]["paid_amount"] = 50
            return result

        fake_route = SimpleNamespace(_active=Mock(), _cfg_doc=AsyncMock())
        with patch.dict(sys.modules, {"routes": SimpleNamespace(_deps=SimpleNamespace()),
                                     "routes.company_stripe": fake_route}), \
                patch("sms_payment_providers.preflight_reserved_payment", side_effect=changed_after_check), \
                patch("sms_payment_providers.stripe.PaymentIntent.create") as create:
            with self.assertRaises(PaymentAttemptConflict):
                await create_sms_stripe_intent(self.db, self.client, attempt)
            create.assert_not_called()
        self.assertEqual(self.db.tenant_payment_guards.docs, [])
        self.assertEqual(self.db.sms_payment_attempt_history.docs[0]["state"], "cancelled")

    async def test_disabled_provider_cancels_unstarted_attempt(self):
        attempt = self.unguarded_attempt().copy()
        fake_deps = SimpleNamespace(require_plan_feature=AsyncMock())
        fake_route = SimpleNamespace(
            _cfg_doc=AsyncMock(return_value={"stripe_config": {}}),
            _active=lambda _: {"enabled": False, "mode": "test", "methods": ["card"]},
        )
        with patch.dict(sys.modules, {"routes": SimpleNamespace(_deps=fake_deps),
                                     "routes.company_stripe": fake_route}), \
                patch("sms_payment_providers.stripe.PaymentIntent.create") as create:
            with self.assertRaises(PaymentAttemptConflict):
                await create_sms_stripe_intent(self.db, self.client, attempt)
            create.assert_not_called()
        self.assertEqual(self.db.tenant_payment_guards.docs, [])
        self.assertEqual(self.db.sms_payment_attempt_history.docs[0]["state"], "cancelled")
