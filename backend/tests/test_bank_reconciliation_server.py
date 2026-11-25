import asyncio
import os
import sys
import types
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from motor.motor_asyncio import AsyncIOMotorClient
from uuid import uuid4

from sms_payment_attempts import PaymentAttemptConflict, tenant_payment_key
from tenant_payment_guard import acquire_payment_guard
from test_bank_reconciliation_guard import Records
from test_tenant_payment_guard import Guards

mock_modules = {
    name: types.ModuleType(name)
    for name in ("emergentintegrations", "emergentintegrations.llm",
                 "emergentintegrations.llm.chat", "emergentintegrations.llm.openai")
}
for name in ("LlmChat", "UserMessage"):
    setattr(mock_modules["emergentintegrations.llm.chat"], name, type(name, (), {}))
for name in ("OpenAISpeechToText", "OpenAITextToSpeech"):
    setattr(mock_modules["emergentintegrations.llm.openai"], name, type(name, (), {}))
with patch.dict(sys.modules, mock_modules), patch.dict(os.environ, {
    "MONGO_URL": "mongodb://127.0.0.1:27017", "DB_NAME": "isolated_bank_tests",
    "JWT_SECRET": "isolated-test-only-key-with-adequate-length",
}):
    import server


class BankReconciliationServerTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def tearDownClass(cls):
        server.client.close()

    async def asyncSetUp(self):
        self.db = SimpleNamespace(
            tenant_payment_guards=Guards(), bank_statements=Records(), payments=Records(),
            tenants=Records(), invoices=Records(), companies=Records(),
        )
        await self.db.tenants.insert_one({"id": "t1", "company_id": "c1"})
        await self.db.invoices.insert_one({
            "id": "i1", "company_id": "c1", "tenant_id": "t1", "status": "open",
            "amount": 100.0, "paid_amount": 0.0, "currency": "SRD",
        })
        await self.db.bank_statements.insert_one({
            "id": "s1", "company_id": "c1", "reconciliation_status": "uploaded",
        })
        self.body = server.BankReconciliationRegisterIn(
            tenant_id="t1", amount=50, currency="SRD", paid_date="2026-01-01",
        )
        self.user = {"company_id": "c1", "name": "Admin"}
        self.patches = [
            patch.object(server, "db", self.db),
            patch.object(server, "company_id_of", lambda user: user["company_id"]),
            patch.object(server, "_next_receipt_number", AsyncMock(return_value="receipt1")),
            patch.object(server, "_sync_plan_installments_with_invoice", AsyncMock()),
            patch.object(server, "_reconcile_power_after_payment", AsyncMock()),
            patch.object(server, "_kiosk_overview_invalidate", AsyncMock()),
            patch.object(server, "_notify_tenant_payment", AsyncMock()),
            patch.object(server, "_notify_company_admins", AsyncMock()),
            patch.object(server, "_notify_kiosk_employees", AsyncMock()),
            patch.object(server, "_enrich_payment", AsyncMock(side_effect=lambda payment: payment)),
        ]
        for item in self.patches:
            item.start()
            self.addCleanup(item.stop)

    async def register(self):
        return await server.register_reconciled_payment("s1", self.body, self.user)

    async def test_successful_registration_applies_invoice_and_releases_guard(self):
        payment = await self.register()
        await asyncio.sleep(0)
        invoice = await self.db.invoices.find_one({"id": "i1"})
        statement = await self.db.bank_statements.find_one({"id": "s1"})
        self.assertEqual(invoice["paid_amount"], 50)
        self.assertEqual(statement["payment_id"], payment["id"])
        self.assertEqual(statement["reconciliation_status"], "registered")
        self.assertIsNone(await self.db.tenant_payment_guards.find_one({"_id": tenant_payment_key("c1", "t1")}))

    async def test_allocation_failure_keeps_statement_and_guard_for_review(self):
        self.db.payments.update_one = AsyncMock(side_effect=RuntimeError("allocation unavailable"))
        with self.assertRaises(HTTPException) as error:
            await self.register()
        self.assertEqual(error.exception.status_code, 500)
        self.assertIn("gedeeltelijk", error.exception.detail)
        self.assertEqual((await self.db.invoices.find_one({"id": "i1"}))["paid_amount"], 50)
        self.assertEqual((await self.db.bank_statements.find_one({"id": "s1"}))["reconciliation_status"],
                         "registering")
        self.assertEqual(len(self.db.payments.docs), 1)
        self.assertIsNotNone(await self.db.tenant_payment_guards.find_one({"_id": tenant_payment_key("c1", "t1")}))
        server._notify_tenant_payment.assert_not_awaited()
        with self.assertRaises(HTTPException) as conflict:
            await self.register()
        self.assertEqual(conflict.exception.status_code, 409)

    async def test_plan_sync_failure_keeps_guard_for_review(self):
        server._sync_plan_installments_with_invoice.side_effect = RuntimeError("sync failed")
        with self.assertRaises(HTTPException):
            await self.register()
        self.assertEqual((await self.db.bank_statements.find_one({"id": "s1"}))["reconciliation_status"],
                         "registering")
        self.assertIsNotNone(await self.db.tenant_payment_guards.find_one({"_id": tenant_payment_key("c1", "t1")}))

    async def test_sms_guard_prevents_payment_creation(self):
        await acquire_payment_guard(self.db, company_id="c1", tenant_id="t1", kind="sms", owner="sms1")
        with self.assertRaises(HTTPException) as conflict:
            await self.register()
        self.assertEqual(conflict.exception.status_code, 409)
        self.assertEqual(self.db.payments.docs, [])
        self.assertEqual((await self.db.bank_statements.find_one({"id": "s1"}))["reconciliation_status"], "uploaded")


class PaymentApprovalServerTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.db = SimpleNamespace(payments=Records(), invoices=Records(), tenant_payment_guards=Guards())
        await self.db.payments.insert_one({
            "id": "p1", "company_id": "c1", "tenant_id": "t1", "amount": 50,
            "currency": "SRD", "category": "huur", "method": "bank",
            "status": "pending_approval", "receipt_number": "r1",
        })
        await self.db.invoices.insert_one({
            "id": "i1", "company_id": "c1", "tenant_id": "t1", "status": "open",
            "amount": 100.0, "paid_amount": 0.0, "currency": "SRD",
        })
        patches = [
            patch.object(server, "db", self.db),
            patch.object(server, "_sync_plan_installments_with_invoice", AsyncMock()),
            patch.object(server, "_reconcile_power_after_payment", AsyncMock()),
            patch.object(server, "_notify_tenant_payment", AsyncMock()),
            patch.object(server, "_notify_company_admins", AsyncMock()),
            patch.object(server, "_enrich_payment", AsyncMock(side_effect=lambda payment: payment)),
        ]
        for item in patches:
            item.start()
            self.addCleanup(item.stop)

    async def approve(self):
        return await server._approve_payment_core({"id": "p1", "company_id": "c1"}, None, "u1", "Admin")

    async def test_partial_approval_failure_is_not_reset_for_retry(self):
        server._sync_plan_installments_with_invoice.side_effect = RuntimeError("sync failed")
        with self.assertRaises(HTTPException) as error:
            await self.approve()
        self.assertEqual(error.exception.status_code, 500)
        self.assertIn("gedeeltelijk", error.exception.detail)
        self.assertEqual((await self.db.invoices.find_one({"id": "i1"}))["paid_amount"], 50)
        self.assertEqual((await self.db.payments.find_one({"id": "p1"}))["status"], "approving")
        guard = await self.db.tenant_payment_guards.find_one({"_id": tenant_payment_key("c1", "t1")})
        self.assertEqual((guard["operation"], guard["operation_id"]), ("payment_approval", "p1"))
        with self.assertRaises(HTTPException) as conflict:
            await self.approve()
        self.assertEqual(conflict.exception.status_code, 400)
        server._notify_tenant_payment.assert_not_awaited()

    async def test_concurrent_approvals_only_apply_once(self):
        entered, resume = asyncio.Event(), asyncio.Event()

        async def hold_sync(_invoice_id):
            entered.set()
            await resume.wait()

        server._sync_plan_installments_with_invoice.side_effect = hold_sync
        first = asyncio.create_task(self.approve())
        await asyncio.wait_for(entered.wait(), 5)
        with self.assertRaises(HTTPException):
            await self.approve()
        with self.assertRaises(HTTPException):
            await server._reject_payment_core({"id": "p1", "company_id": "c1"}, "", "u1")
        with self.assertRaises(PaymentAttemptConflict):
            await acquire_payment_guard(self.db, company_id="c1", tenant_id="t1", kind="sms", owner="sms1")
        resume.set()
        self.assertEqual((await first)["status"], "approved")
        self.assertEqual((await self.db.invoices.find_one({"id": "i1"}))["paid_amount"], 50)
        self.assertIsNone(await self.db.tenant_payment_guards.find_one({"_id": tenant_payment_key("c1", "t1")}))

    async def test_sms_guard_blocks_approval_and_rejection_before_claim(self):
        await acquire_payment_guard(self.db, company_id="c1", tenant_id="t1", kind="sms", owner="sms1")
        with self.assertRaises(HTTPException) as approval:
            await self.approve()
        self.assertEqual(approval.exception.status_code, 409)
        with self.assertRaises(HTTPException) as rejection:
            await server._reject_payment_core({"id": "p1", "company_id": "c1"}, "", "u1")
        self.assertEqual(rejection.exception.status_code, 409)
        self.assertEqual((await self.db.payments.find_one({"id": "p1"}))["status"], "pending_approval")
        self.assertEqual((await self.db.invoices.find_one({"id": "i1"}))["paid_amount"], 0)

    async def test_stale_claim_releases_own_guard(self):
        self.db.payments.find_one_and_update = AsyncMock(return_value=None)
        with self.assertRaises(HTTPException) as error:
            await self.approve()
        self.assertEqual(error.exception.status_code, 400)
        self.assertIsNone(await self.db.tenant_payment_guards.find_one({"_id": tenant_payment_key("c1", "t1")}))

    async def test_failed_plan_rejection_cannot_be_approved_or_retried(self):
        self.db.payments.docs[0].update({
            "category": "betalingsregeling",
            "metadata": {"plan_id": "plan1", "installment_seq": 1},
        })
        self.db.payment_plan_installments = SimpleNamespace(
            update_one=AsyncMock(side_effect=RuntimeError("database unavailable")),
        )
        with self.assertRaises(HTTPException) as error:
            await server._reject_payment_core({"id": "p1", "company_id": "c1"}, "", "u1")
        self.assertEqual(error.exception.status_code, 500)
        self.assertIn("gedeeltelijk", error.exception.detail)
        self.assertEqual((await self.db.payments.find_one({"id": "p1"}))["status"], "rejecting")
        guard = await self.db.tenant_payment_guards.find_one({"_id": tenant_payment_key("c1", "t1")})
        self.assertEqual((guard["operation"], guard["operation_id"]), ("payment_rejection", "p1"))
        with self.assertRaises(HTTPException):
            await self.approve()
        with self.assertRaises(HTTPException):
            await server._reject_payment_core({"id": "p1", "company_id": "c1"}, "", "u1")

    async def test_successful_plan_rejection_releases_matching_installment(self):
        self.db.payments.docs[0].update({
            "category": "betalingsregeling",
            "metadata": {"plan_id": "plan1", "installment_seq": 1},
        })
        self.db.payment_plan_installments = Records()
        await self.db.payment_plan_installments.insert_one({
            "plan_id": "plan1", "sequence": 1, "payment_id": "p1", "status": "pending_payment",
        })
        result = await server._reject_payment_core({"id": "p1", "company_id": "c1"}, "reason", "u1")
        self.assertEqual(result["status"], "rejected")
        self.assertEqual((await self.db.payment_plan_installments.find_one({"plan_id": "plan1"}))["status"], "pending")

    async def test_ocr_uses_same_approval_claim(self):
        with patch.object(server, "_ocr_bank_statement", AsyncMock(return_value={})), \
                patch.object(server, "_ocr_match_ok", return_value=(True, [])), \
                patch.object(server, "_approve_payment_core", AsyncMock()) as approve:
            await server._ocr_and_auto_approve_payment(
                payment_id="p1", statement_id="s1", expected_amount=50,
                expected_currency="SRD", tenant_name="Tenant", company_id="c1",
            )
        approve.assert_awaited_once_with(
            {"id": "p1", "company_id": "c1"}, None, "system", "OCR auto-approve", via="ocr",
        )

    async def test_ocr_guard_conflict_leaves_payment_pending(self):
        await acquire_payment_guard(self.db, company_id="c1", tenant_id="t1", kind="sms", owner="sms1")
        with patch.object(server, "_ocr_bank_statement", AsyncMock(return_value={})), \
                patch.object(server, "_ocr_match_ok", return_value=(True, [])):
            await server._ocr_and_auto_approve_payment(
                payment_id="p1", statement_id="s1", expected_amount=50,
                expected_currency="SRD", tenant_name="Tenant", company_id="c1",
            )
        self.assertEqual((await self.db.payments.find_one({"id": "p1"}))["status"], "pending_approval")
        server._notify_company_admins.assert_not_awaited()

    async def test_processing_statuses_are_separate_from_payment_totals(self):
        queries = []

        class Cursor:
            def sort(self, *_args):
                return self

            async def to_list(self, _limit):
                return []

        def find(query, *_args):
            queries.append(query)
            return Cursor()

        self.db.payments.find = find
        self.db.payments.count_documents = AsyncMock(return_value=0)
        self.db.payments.aggregate = lambda *_args: Cursor()

        async def uncached(_name, _user, compute, _key):
            return await compute()

        with patch.object(server, "scope", return_value={"company_id": "c1"}), \
                patch.object(server, "_enrich_payments_bulk", AsyncMock(return_value=[])), \
                patch.object(server, "_list_cached", side_effect=uncached):
            await server.list_payments(tenant_id=None, status="needs_review", limit=200, user={})
            self.assertEqual(queries[-1]["status"], {"$in": ["approving", "rejecting"]})
            await server.list_payments(tenant_id=None, status=None, limit=200, user={})
            self.assertEqual(queries[-1]["status"], {"$nin": ["pending_approval", "approving", "rejecting"]})
            await server.list_payments_paged(start="2026-01-01", end="2026-02-01",
                                             today_start="2026-01-01", q="", offset=0, limit=25, user={})
            self.assertEqual(queries[-1]["status"], {"$nin": ["pending_approval", "approving", "rejecting"]})

    async def test_processing_payment_cannot_be_deleted(self):
        self.db.payments.docs[0]["status"] = "approving"
        with patch.object(server, "scope", return_value={"company_id": "c1"}):
            with self.assertRaises(HTTPException) as error:
                await server.delete_payment("p1", also_delete_invoices=True, user={})
        self.assertEqual(error.exception.status_code, 409)

    async def test_guard_listing_is_company_scoped_and_omits_owner(self):
        queries = []

        class Cursor:
            def sort(self, *_args):
                return self

            async def to_list(self, _limit):
                return [{
                    "company_id": "c1", "tenant_id": "t1", "operation": "payment_approval",
                    "operation_id": "p1", "owner": "secret-owner",
                }]

        self.db.tenant_payment_guards.find = lambda query, projection: (
            queries.append((query, projection)) or Cursor()
        )
        with patch.object(server, "company_id_of", return_value="c1"):
            result = await server.payment_processing_guards(user={})
        self.assertEqual(queries[0][0]["company_id"], "c1")
        self.assertEqual(result[0]["operation_id"], "p1")
        self.assertNotIn("owner", result[0])

    async def test_guard_listing_requires_company_scope(self):
        with patch.object(server, "company_id_of", return_value=None):
            with self.assertRaises(HTTPException) as error:
                await server.payment_processing_guards(user={})
        self.assertEqual(error.exception.status_code, 400)


@unittest.skipUnless(os.environ.get("SMS_BOOKING_MONGO_URL"), "MongoDB replica set is required")
class PaymentApprovalMongoTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.client = AsyncIOMotorClient(os.environ["SMS_BOOKING_MONGO_URL"], serverSelectionTimeoutMS=5000)
        self.name = f"test_payment_approval_{uuid4().hex}"
        self.db = self.client[self.name]
        await self.db.payments.insert_one({
            "id": "p1", "company_id": "c1", "tenant_id": "t1", "amount": 50,
            "currency": "SRD", "category": "huur", "method": "bank",
            "status": "pending_approval", "receipt_number": "r1",
        })
        await self.db.invoices.insert_one({
            "id": "i1", "company_id": "c1", "tenant_id": "t1", "status": "open",
            "amount": 100.0, "paid_amount": 0.0, "currency": "SRD",
        })
        for item in (
            patch.object(server, "db", self.db),
            patch.object(server, "_sync_plan_installments_with_invoice", AsyncMock()),
            patch.object(server, "_reconcile_power_after_payment", AsyncMock()),
            patch.object(server, "_notify_tenant_payment", AsyncMock()),
            patch.object(server, "_enrich_payment", AsyncMock(side_effect=lambda payment: payment)),
        ):
            item.start()
            self.addCleanup(item.stop)

    async def asyncTearDown(self):
        await self.client.drop_database(self.name)
        self.client.close()

    async def test_approval_excludes_sms_guard_until_complete(self):
        entered, resume = asyncio.Event(), asyncio.Event()

        async def hold_sync(_invoice_id):
            entered.set()
            await resume.wait()

        server._sync_plan_installments_with_invoice.side_effect = hold_sync
        task = asyncio.create_task(server._approve_payment_core(
            {"id": "p1", "company_id": "c1"}, None, "u1", "Admin",
        ))
        try:
            await asyncio.wait_for(entered.wait(), 5)
            with self.assertRaises(PaymentAttemptConflict):
                await acquire_payment_guard(self.db, company_id="c1", tenant_id="t1", kind="sms", owner="sms1")
        finally:
            resume.set()
        self.assertEqual((await task)["status"], "approved")
        await acquire_payment_guard(self.db, company_id="c1", tenant_id="t1", kind="sms", owner="sms1")
