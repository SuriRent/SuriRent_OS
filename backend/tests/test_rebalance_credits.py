"""Test: rebalance-credits endpoint distributeert leftover credit FIFO
naar openstaande facturen die NA de betaling zijn aangemaakt (bijv. via
historische facturen). Repareert ook overshoot-facturen.

Scenario user-rapport (13 sep 2026):
  - Mei factuur SRD 7.000 open
  - User betaalt 15.000 → mei paid, 8.000 blijft credit
  - Daarna worden juni/juli/aug aangemaakt (historisch)
  - Verwacht na rebalance: juni paid (7000), juli paid_amount=1000 (nog 6750 open)
"""
import os
import asyncio
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorClient

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]


async def _cleanup(db, tag):
    await db.tenants.delete_many({"id": tag})
    await db.invoices.delete_many({"tenant_id": tag})
    await db.payments.delete_many({"tenant_id": tag})


async def run():
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    tag = "test_rebal_" + datetime.now(timezone.utc).strftime("%H%M%S")
    await _cleanup(db, tag)

    # Setup: tenant + mei factuur
    await db.tenants.insert_one({
        "id": tag, "name": tag, "company_id": "test-co-rebal",
    })
    await db.invoices.insert_one({
        "id": f"{tag}-mei", "tenant_id": tag, "company_id": "test-co-rebal",
        "amount": 7000.0, "paid_amount": 7000.0, "currency": "SRD",
        "period_month": 5, "period_year": 2026, "status": "paid",
        "created_at": "2026-05-01T00:00:00+00:00",
    })
    # Payment met 8000 credit_remaining (simuleert de situatie na 15000 betaling
    # toen alleen mei openstond)
    await db.payments.insert_one({
        "id": f"{tag}-pay", "tenant_id": tag, "company_id": "test-co-rebal",
        "amount": 15000.0, "currency": "SRD", "method": "cash",
        "category": "huur", "status": "approved",
        "period_month": 5, "period_year": 2026,
        "invoice_id": f"{tag}-mei", "receipt_number": "TESTKW-1",
        "paid_at": "2026-09-13T00:00:00+00:00",
        "credit_remaining": 8000.0, "credit_origin": "overflow",
    })
    # Later aangemaakte historische facturen (juni/juli/aug)
    await db.invoices.insert_many([
        {"id": f"{tag}-jun", "tenant_id": tag, "company_id": "test-co-rebal",
         "amount": 7000.0, "paid_amount": 0.0, "currency": "SRD",
         "period_month": 6, "period_year": 2026, "status": "open",
         "created_at": "2026-09-14T00:00:00+00:00", "is_historical": True},
        {"id": f"{tag}-jul", "tenant_id": tag, "company_id": "test-co-rebal",
         "amount": 7750.0, "paid_amount": 0.0, "currency": "SRD",
         "period_month": 7, "period_year": 2026, "status": "open",
         "created_at": "2026-09-14T00:00:00+00:00", "is_historical": True},
        {"id": f"{tag}-aug", "tenant_id": tag, "company_id": "test-co-rebal",
         "amount": 8500.0, "paid_amount": 0.0, "currency": "SRD",
         "period_month": 8, "period_year": 2026, "status": "open",
         "created_at": "2026-09-14T00:00:00+00:00", "is_historical": True},
    ])

    # Roep de helper _apply_tenant_credit_to_invoice per open factuur aan,
    # zoals rebalance_tenant_credits doet.
    import sys
    sys.path.insert(0, "/app/backend")
    import server as srv
    srv.db = db

    applied_total = 0.0
    for inv_id in [f"{tag}-jun", f"{tag}-jul", f"{tag}-aug"]:
        applied_total += await srv._apply_tenant_credit_to_invoice(tag, inv_id, "test-co-rebal")

    jun = await db.invoices.find_one({"id": f"{tag}-jun"}, {"_id": 0})
    jul = await db.invoices.find_one({"id": f"{tag}-jul"}, {"_id": 0})
    aug = await db.invoices.find_one({"id": f"{tag}-aug"}, {"_id": 0})
    pay = await db.payments.find_one({"id": f"{tag}-pay"}, {"_id": 0})

    assert applied_total == 8000.0, f"Expected 8000 applied, got {applied_total}"
    assert jun["paid_amount"] == 7000.0 and jun["status"] == "paid", f"juni: {jun}"
    assert jul["paid_amount"] == 1000.0 and jul["status"] == "partial", f"juli: {jul}"
    assert aug["paid_amount"] == 0.0 and aug["status"] == "open", f"aug: {aug}"
    assert pay["credit_remaining"] == 0.0, f"credit should be depleted: {pay}"

    print(f"PASS applied={applied_total} jun_paid={jun['paid_amount']} jul_paid={jul['paid_amount']} aug_paid={aug['paid_amount']} credit_left={pay['credit_remaining']}")

    await _cleanup(db, tag)
    client.close()


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    asyncio.run(run())
