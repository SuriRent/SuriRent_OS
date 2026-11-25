import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

from sms_payment_links import create_payment_link, get_payment_grant, payment_items


class PaymentLinkTests(unittest.IsolatedAsyncioTestCase):
    async def test_short_link_only_stores_hash_and_expires_after_30_days(self):
        collection = SimpleNamespace(insert_one=AsyncMock(), find_one=AsyncMock(return_value={"tenant_id": "t1"}))
        now = datetime(2026, 1, 1, tzinfo=timezone.utc)
        url = await create_payment_link(collection, "https://app.example.com/", "c1", "t1", ["i1"], [], now=now)
        token = url.rsplit("/", 1)[1]
        doc = collection.insert_one.await_args.args[0]
        self.assertEqual(len(token), 22)
        self.assertNotIn(token, repr(doc))
        self.assertEqual(doc["expires_at"], now + timedelta(days=30))
        self.assertEqual(await get_payment_grant(collection, token, now=now), {"tenant_id": "t1"})
        query = collection.find_one.await_args.args[0]
        self.assertEqual(query["_id"], doc["_id"])
        self.assertEqual(query["expires_at"], {"$gt": now})

    async def test_invalid_origin_and_empty_scope_are_rejected(self):
        collection = SimpleNamespace(insert_one=AsyncMock(), find_one=AsyncMock())
        with self.assertRaises(ValueError):
            await create_payment_link(collection, "http://example.com", "c1", "t1", ["i1"], [])
        with self.assertRaises(ValueError):
            await create_payment_link(collection, "https://example.com", "c1", "t1", [], [])
        self.assertIsNone(await get_payment_grant(collection, "bad"))
        collection.find_one.assert_not_awaited()

    async def test_expired_or_forged_grant_cannot_be_used(self):
        stored = {}

        async def insert(doc):
            stored.update(doc)

        async def find(query, projection):
            if query["_id"] == stored["_id"] and stored["expires_at"] > query["expires_at"]["$gt"]:
                return {"tenant_id": stored["tenant_id"]}
            return None

        collection = SimpleNamespace(insert_one=insert, find_one=find)
        now = datetime(2026, 1, 1, tzinfo=timezone.utc)
        url = await create_payment_link(collection, "https://example.com", "c1", "t1", ["i1"], [], now=now)
        token = url.rsplit("/", 1)[1]
        self.assertIsNotNone(await get_payment_grant(collection, token, now=now + timedelta(days=29)))
        self.assertIsNone(await get_payment_grant(collection, token, now=now + timedelta(days=30)))
        other = ("A" if token[0] != "A" else "B") + token[1:]
        self.assertIsNone(await get_payment_grant(collection, other, now=now))

    def test_only_granted_open_posts_are_visible(self):
        grant = {"company_id": "c1", "tenant_id": "t1", "invoice_ids": ["i1", "i2"],
                 "installments": [{"plan_id": "p1", "sequence": 1}]}
        invoices = [
            {"id": "i1", "company_id": "c1", "tenant_id": "t1", "remaining_amount": 50},
            {"id": "i2", "company_id": "c2", "tenant_id": "t1", "remaining_amount": 99},
            {"id": "i3", "company_id": "c1", "tenant_id": "t1", "remaining_amount": 77},
        ]
        plans = [{"id": "p1", "tenant_id": "t1", "status": "active", "remaining_amount": 30,
                  "installments": [{"sequence": 1, "amount": 40, "status": "pending"},
                                   {"sequence": 2, "amount": 10, "status": "pending"}]}]
        items = payment_items(grant, invoices, plans)
        self.assertEqual([(i["kind"], i["amount"]) for i in items], [("invoice", 50), ("installment", 30)])
