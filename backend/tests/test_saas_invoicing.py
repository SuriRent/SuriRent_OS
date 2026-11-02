import asyncio
import copy
import unittest

from saas_invoicing import (
    append_company_invoice_charge,
    apply_saas_plan_payment,
    consolidate_company_invoices,
    update_invoice_paid_amount,
)


def _matches(document, query):
    for key, expected in query.items():
        if key == "$or":
            if not any(_matches(document, clause) for clause in expected):
                return False
            continue
        value = document.get(key)
        if isinstance(expected, dict):
            for operator, operand in expected.items():
                if operator == "$exists" and (key in document) != operand:
                    return False
                if operator == "$ne" and value == operand:
                    return False
                if operator == "$nin" and value in operand:
                    return False
                if operator == "$in":
                    if isinstance(value, list):
                        if not any(item in operand for item in value):
                            return False
                    elif value not in operand:
                        return False
        elif value != expected:
            return False
    return True


class _Cursor:
    def __init__(self, documents):
        self.documents = documents

    def sort(self, key, direction=1):
        if isinstance(key, list):
            key, direction = key[0]
        self.documents.sort(key=lambda doc: doc.get(key) or "", reverse=direction < 0)
        return self

    async def to_list(self, length):
        return copy.deepcopy(self.documents[:length] if length is not None else self.documents)

    def __aiter__(self):
        self._iterator = iter(copy.deepcopy(self.documents))
        return self

    async def __anext__(self):
        try:
            return next(self._iterator)
        except StopIteration:
            raise StopAsyncIteration


class _Collection:
    def __init__(self):
        self.documents = []

    def find(self, query=None, projection=None):
        return _Cursor([doc for doc in self.documents if _matches(doc, query or {})])

    async def find_one(self, query, projection=None, sort=None):
        matches = [doc for doc in self.documents if _matches(doc, query)]
        if sort and matches:
            key, direction = sort[0]
            matches.sort(key=lambda doc: doc.get(key) or "", reverse=direction < 0)
        return copy.deepcopy(matches[0]) if matches else None

    async def insert_one(self, document):
        self.documents.append(copy.deepcopy(document))

    async def update_one(self, query, update):
        for document in self.documents:
            if not _matches(document, query):
                continue
            for operator, values in update.items():
                for key, value in values.items():
                    if operator == "$set":
                        document[key] = copy.deepcopy(value)
                    elif operator == "$inc":
                        document[key] = document.get(key, 0) + value
                    elif operator == "$push":
                        document.setdefault(key, []).append(copy.deepcopy(value))
                    elif operator == "$addToSet":
                        values_list = document.setdefault(key, [])
                        if value not in values_list:
                            values_list.append(copy.deepcopy(value))
                    elif operator == "$pull":
                        document[key] = [item for item in document.get(key, []) if item != value]
            return type("UpdateResult", (), {"modified_count": 1})()
        return type("UpdateResult", (), {"modified_count": 0})()

    async def update_many(self, query, update):
        count = 0
        for document in self.documents:
            if _matches(document, query):
                for key, value in update.get("$set", {}).items():
                    document[key] = copy.deepcopy(value)
                count += 1
        return type("UpdateResult", (), {"modified_count": count})()

    async def find_one_and_update(self, query, pipeline, projection=None, return_document=None):
        for document in self.documents:
            if not _matches(document, query):
                continue
            added = pipeline[0]["$set"]["paid_amount"]["$round"][0]["$add"][1]
            document["paid_amount"] = round(document.get("paid_amount", 0) + added, 2)
            document["balance_due"] = max(document["amount"] - document["paid_amount"], 0)
            if document["paid_amount"] >= document["amount"]:
                document["status"] = "paid"
            elif document.get("status") != "overdue":
                document["status"] = "open"
            return copy.deepcopy(document)
        return None


class _Database:
    def __init__(self):
        self.collections = {}

    def __getattr__(self, name):
        return self.collections.setdefault(name, _Collection())


class SaaSInvoicingTests(unittest.TestCase):
    def test_new_billing_period_reuses_invoice_and_preserves_payments(self):
        async def scenario():
            db = _Database()
            first = {
                "id": "invoice-stable",
                "company_id": "company-a",
                "company_name": "Company A",
                "amount": 100,
                "currency": "SRD",
                "status": "open",
                "kind": "subscription",
                "period_start": "2026-01-01",
                "period_end": "2026-01-31",
                "due_date": "2026-01-15",
                "created_at": "2026-01-01",
            }
            invoice, created = await append_company_invoice_charge(db, first, "subscription:2026-01-01")
            self.assertTrue(created)
            original_id = invoice["id"]

            paid = await update_invoice_paid_amount(db, original_id, 100)
            self.assertEqual(paid["status"], "paid")
            self.assertEqual(paid["balance_due"], 0)

            second = {
                **first,
                "id": "invoice-duplicate",
                "amount": 75,
                "period_start": "2026-02-01",
                "period_end": "2026-02-28",
                "due_date": "2026-02-15",
                "created_at": "2026-02-01",
            }
            invoice, created = await append_company_invoice_charge(db, second, "subscription:2026-02-01")
            self.assertTrue(created)
            self.assertEqual(invoice["id"], original_id)
            self.assertEqual(invoice["amount"], 175)
            self.assertEqual(invoice["paid_amount"], 100)
            self.assertEqual(invoice["balance_due"], 75)
            self.assertEqual(invoice["status"], "open")

            duplicate, created = await append_company_invoice_charge(db, second, "subscription:2026-02-01")
            self.assertFalse(created)
            self.assertEqual(duplicate["amount"], 175)
            self.assertEqual(len(db.subscription_invoices.documents), 1)

            paid = await update_invoice_paid_amount(db, original_id, 75)
            self.assertEqual(paid["status"], "paid")
            self.assertEqual(paid["paid_amount"], 175)
            self.assertEqual(paid["balance_due"], 0)

        asyncio.run(scenario())

    def test_legacy_installments_become_one_invoice_with_schedule(self):
        async def scenario():
            db = _Database()
            db.subscription_invoices.documents.extend([
                {
                    "id": "term-1",
                    "company_id": "company-b",
                    "amount": 50,
                    "currency": "SRD",
                    "status": "paid",
                    "kind": "installment",
                    "saas_plan_id": "plan-b",
                    "installment_seq": 1,
                    "installment_total": 2,
                    "created_at": "2026-01-01",
                },
                {
                    "id": "term-2",
                    "company_id": "company-b",
                    "amount": 50,
                    "currency": "SRD",
                    "status": "open",
                    "kind": "installment",
                    "saas_plan_id": "plan-b",
                    "installment_seq": 2,
                    "installment_total": 2,
                    "created_at": "2026-01-02",
                },
            ])
            db.saas_payment_plans.documents.append({
                "id": "plan-b",
                "company_id": "company-b",
                "total_amount": 100,
                "installments": 2,
                "source_invoice_id": "old-source",
            })

            invoice = await consolidate_company_invoices(db, "company-b")
            self.assertEqual(invoice["id"], "term-1")
            self.assertEqual(invoice["amount"], 100)
            self.assertEqual(invoice["paid_amount"], 50)
            self.assertEqual(invoice["balance_due"], 50)
            self.assertEqual(
                sum(item.get("status") != "merged" for item in db.subscription_invoices.documents),
                1,
            )

            plan = db.saas_payment_plans.documents[0]
            self.assertEqual(plan["invoice_id"], invoice["id"])
            self.assertEqual(plan["source_invoice_id"], invoice["id"])
            self.assertEqual([term["status"] for term in plan["schedule"]], ["paid", "open"])

            updated = await update_invoice_paid_amount(db, invoice["id"], 50)
            await apply_saas_plan_payment(db, invoice["id"], 50, "plan-b", 2)
            self.assertEqual(updated["status"], "paid")
            self.assertEqual([term["status"] for term in plan["schedule"]], ["paid", "paid"])

        asyncio.run(scenario())
