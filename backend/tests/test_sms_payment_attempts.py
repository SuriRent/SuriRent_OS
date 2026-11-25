import asyncio
import copy
import unittest
from types import SimpleNamespace

from pymongo.errors import DuplicateKeyError

from sms_payment_attempts import (
    PaymentAttemptConflict,
    begin_provider_request,
    finish_provider_request,
    mark_provider_uncertain,
    reserve_attempt,
    verify_provider_payment,
)


class Attempts:
    def __init__(self):
        self.docs = {}

    async def insert_one(self, doc):
        if doc["_id"] in self.docs:
            raise DuplicateKeyError("duplicate")
        self.docs[doc["_id"]] = copy.deepcopy(doc)

    async def find_one(self, query):
        return copy.deepcopy(self.docs.get(query["_id"]))

    async def update_one(self, query, update):
        doc = self.docs.get(query["_id"])
        if doc is None or any(doc.get(k) != v for k, v in query.items()):
            return SimpleNamespace(modified_count=0)
        doc.update(copy.deepcopy(update["$set"]))
        return SimpleNamespace(modified_count=1)


class PaymentAttemptTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.collection = Attempts()
        self.args = {
            "company_id": "c1", "tenant_id": "t1",
            "item": {"kind": "invoice", "id": "i1"},
            "method": "card", "amount_cents": 10000, "currency": "SRD",
            "provider_amount_cents": 250, "provider_currency": "EUR",
            "stripe_mode": "test",
        }

    def mark_guarded(self, attempt):
        attempt["guard_owner"] = attempt["attempt_id"]
        self.collection.docs[attempt["_id"]]["guard_owner"] = attempt["attempt_id"]
        return attempt

    async def test_parallel_requests_share_reservation_and_only_one_may_call_provider(self):
        attempts = await asyncio.gather(*[
            reserve_attempt(self.collection, **self.args) for _ in range(10)
        ])
        self.assertEqual(len({a["attempt_id"] for a in attempts}), 1)
        for attempt in attempts:
            self.mark_guarded(attempt)
        allowed = await asyncio.gather(*[
            begin_provider_request(self.collection, a) for a in attempts
        ])
        self.assertEqual(sum(allowed), 1)
        await finish_provider_request(self.collection, attempts[0], "pi_123")
        stored = await self.collection.find_one({"_id": attempts[0]["_id"]})
        self.assertEqual((stored["state"], stored["provider_id"]), ("open", "pi_123"))
        with self.assertRaises(PaymentAttemptConflict):
            await finish_provider_request(self.collection, attempts[0], "pi_456")

    async def test_changed_amount_or_method_cannot_start_second_attempt(self):
        await reserve_attempt(self.collection, **self.args)
        for changed in (
            {"amount_cents": 20000},
            {"method": "mope", "stripe_mode": None, "provider_amount_cents": 10000, "provider_currency": "SRD"},
            {"currency": "EUR"}, {"provider_amount_cents": 251},
            {"stripe_mode": "live"},
            {"item": {"kind": "installment", "plan_id": "p1", "sequence": 1}},
        ):
            with self.subTest(changed=changed), self.assertRaises(PaymentAttemptConflict):
                await reserve_attempt(self.collection, **{**self.args, **changed})

    async def test_changed_snapshot_cannot_start_provider_request(self):
        attempt = self.mark_guarded(await reserve_attempt(self.collection, **self.args))
        self.collection.docs[attempt["_id"]]["amount_cents"] = 20000
        self.assertFalse(await begin_provider_request(self.collection, attempt))
        self.assertEqual(self.collection.docs[attempt["_id"]]["state"], "reserved")

    async def test_uncertain_or_interrupted_provider_call_is_not_retried(self):
        attempt = self.mark_guarded(await reserve_attempt(self.collection, **self.args))
        self.assertTrue(await begin_provider_request(self.collection, attempt))
        recovered = await reserve_attempt(self.collection, **self.args)
        self.assertEqual(recovered["state"], "creating")
        self.assertFalse(await begin_provider_request(self.collection, recovered))
        await mark_provider_uncertain(self.collection, attempt)
        recovered = await reserve_attempt(self.collection, **self.args)
        self.assertEqual(recovered["state"], "uncertain")
        self.assertFalse(await begin_provider_request(self.collection, recovered))
        with self.assertRaises(PaymentAttemptConflict):
            await finish_provider_request(self.collection, attempt, "pi_123")

    async def test_only_exact_verified_provider_result_moves_to_verified(self):
        attempt = self.mark_guarded(await reserve_attempt(self.collection, **self.args))
        await begin_provider_request(self.collection, attempt)
        await finish_provider_request(self.collection, attempt, "pi_123")
        proof = {"provider_id": "pi_123", "status": "paid", "amount_cents": 250, "currency": "EUR"}

        for changed in (
            {"status": "pending"}, {"provider_id": "pi_other"},
            {"amount_cents": 251}, {"currency": "USD"},
        ):
            async def verify(_attempt, value={**proof, **changed}):
                return value

            with self.subTest(changed=changed), self.assertRaises(PaymentAttemptConflict):
                await verify_provider_payment(self.collection, attempt["attempt_id"], attempt["_id"], verify)
            self.assertEqual(self.collection.docs[attempt["_id"]]["state"], "open")

        async def verify(_attempt):
            return proof

        confirmed = await verify_provider_payment(self.collection, attempt["attempt_id"], attempt["_id"], verify)
        self.assertEqual(confirmed["state"], "verified")
        confirmed_again = await verify_provider_payment(self.collection, attempt["attempt_id"], attempt["_id"], verify)
        self.assertEqual(confirmed_again["verified_at"], confirmed["verified_at"])

    async def test_mope_request_must_match_original_amount_and_currency(self):
        args = {**self.args, "method": "mope", "stripe_mode": None,
                "provider_amount_cents": 10000, "provider_currency": "SRD"}
        with self.assertRaises(ValueError):
            await reserve_attempt(self.collection, **{**args, "provider_amount_cents": 9999})
        with self.assertRaises(ValueError):
            await reserve_attempt(self.collection, **{**args, "provider_currency": "EUR"})
        attempt = self.mark_guarded(await reserve_attempt(self.collection, **args))
        await begin_provider_request(self.collection, attempt)
        await finish_provider_request(self.collection, attempt, "mope_123")

    async def test_unguarded_attempt_cannot_contact_provider(self):
        attempt = await reserve_attempt(self.collection, **self.args)
        self.assertFalse(await begin_provider_request(self.collection, attempt))
        self.assertEqual(self.collection.docs[attempt["_id"]]["state"], "reserved")

    async def test_validates_item_and_scopes_reservations(self):
        original = await reserve_attempt(self.collection, **self.args)
        other = await reserve_attempt(self.collection, **{**self.args, "company_id": "c2"})
        self.assertNotEqual(original["_id"], other["_id"])
        for changed in (
            {"amount_cents": True}, {"amount_cents": 0}, {"method": "bank"},
            {"item": {"kind": "installment", "plan_id": "p1", "sequence": True}},
            {"item": {"kind": "invoice", "id": "i1", "extra": "x"}},
        ):
            with self.subTest(changed=changed), self.assertRaises(ValueError):
                await reserve_attempt(self.collection, **{**self.args, **changed})
