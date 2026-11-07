"""Helpers for one cumulative subscription invoice per company."""

from pymongo.errors import DuplicateKeyError

MERGED_STATUSES = {"merged", "superseded", "cancelled", "void", "archived"}


def _period_entry(invoice: dict, charge_key: str) -> dict:
    return {
        "charge_key": charge_key,
        "amount": float(invoice.get("amount") or 0),
        "currency": (invoice.get("currency") or "SRD").upper(),
        "period_start": invoice.get("period_start"),
        "period_end": invoice.get("period_end"),
        "kind": invoice.get("kind") or "subscription",
        "note": invoice.get("note") or "",
        "plan": invoice.get("plan"),
        "installment_seq": invoice.get("installment_seq"),
        "installment_total": invoice.get("installment_total"),
        "due_date": invoice.get("due_date"),
        "saas_plan_id": invoice.get("saas_plan_id"),
    }


async def consolidate_company_invoices(db, company_id: str) -> dict | None:
    """Keep the oldest active invoice as the company record and fold legacy rows into it."""
    cursor = db.subscription_invoices.find(
        {"company_id": company_id, "merged_into_invoice_id": {"$exists": False},
         "status": {"$nin": list(MERGED_STATUSES)}},
        {"_id": 0},
    ).sort("created_at", 1)
    invoices = await cursor.to_list(1000)
    if not invoices:
        return None

    currencies = {(invoice.get("currency") or "SRD").upper() for invoice in invoices}
    if len(currencies) != 1:
        raise ValueError("Facturen van hetzelfde bedrijf hebben verschillende valuta en kunnen niet worden samengevoegd.")

    master = next((invoice for invoice in invoices if invoice.get("master_invoice")), invoices[0])
    secondary = [invoice for invoice in invoices if invoice["id"] != master["id"]]
    all_ids = [invoice["id"] for invoice in invoices]
    payment_rows = await db.subscription_payments.find(
        {"invoice_id": {"$in": all_ids}}, {"_id": 0, "invoice_id": 1, "amount": 1},
    ).to_list(10000)
    paid_by_invoice: dict[str, float] = {}
    for payment in payment_rows:
        invoice_id = payment.get("invoice_id")
        paid_by_invoice[invoice_id] = paid_by_invoice.get(invoice_id, 0) + float(payment.get("amount") or 0)

    total_amount = round(sum(float(invoice.get("amount") or 0) for invoice in invoices), 2)
    payment_total = sum(paid_by_invoice.values())
    inferred_paid = sum(
        max(float(invoice.get("amount") or 0) - paid_by_invoice.get(invoice["id"], 0), 0)
        for invoice in invoices
        if invoice.get("status") == "paid"
    )
    paid_amount = round(max(payment_total + inferred_paid, float(master.get("paid_amount") or 0)), 2)
    starts = [invoice.get("period_start") for invoice in invoices if invoice.get("period_start")]
    ends = [invoice.get("period_end") for invoice in invoices if invoice.get("period_end")]
    due_dates = [
        invoice.get("due_date") for invoice in invoices
        if invoice.get("due_date") and float(invoice.get("amount") or 0) > paid_by_invoice.get(invoice["id"], 0)
    ]

    charge_history = list(master.get("charge_history") or [])
    charge_keys = list(master.get("charge_keys") or [])
    for invoice in invoices:
        if invoice["id"] == master["id"] and invoice.get("charge_history"):
            continue
        key = f"legacy:{invoice['id']}"
        if key not in charge_keys:
            charge_keys.append(key)
            charge_history.append(_period_entry(invoice, key))

    now_paid = paid_amount >= total_amount
    status = "paid" if now_paid else (
        "overdue" if any(invoice.get("status") == "overdue" for invoice in invoices) else "open"
    )
    changes = {
        "amount": total_amount,
        "paid_amount": paid_amount,
        "balance_due": round(max(total_amount - paid_amount, 0), 2),
        "status": status,
        "master_invoice": True,
        "kind": "subscription",
        "charge_history": charge_history,
        "charge_keys": charge_keys,
    }
    if starts:
        changes["period_start"] = min(starts)
    if ends:
        changes["period_end"] = max(ends)
    if due_dates:
        changes["due_date"] = min(due_dates)
    await db.subscription_invoices.update_one({"id": master["id"]}, {"$set": changes})

    if secondary:
        secondary_ids = [invoice["id"] for invoice in secondary]
        await db.subscription_payments.update_many(
            {"invoice_id": {"$in": secondary_ids}},
            {"$set": {"invoice_id": master["id"]}},
        )
        for invoice in invoices:
            if invoice.get("saas_plan_id") and invoice.get("installment_seq"):
                await db.saas_payment_requests.update_many(
                    {"invoice_id": invoice["id"], "status": "pending_approval"},
                    {"$set": {
                        "invoice_id": master["id"],
                        "plan_id": invoice["saas_plan_id"],
                        "installment_seq": invoice["installment_seq"],
                    }},
                )
        await db.saas_payment_requests.update_many(
            {"invoice_id": {"$in": secondary_ids}},
            {"$set": {"invoice_id": master["id"]}},
        )
        await db.bank_statements.update_many(
            {"invoice_id": {"$in": secondary_ids}},
            {"$set": {"invoice_id": master["id"]}},
        )
        pending_companies = await db.companies.find(
            {"pending_invoice_id": {"$in": all_ids}}, {"_id": 0},
        ).to_list(1000)
        for company in pending_companies:
            pending_invoice_id = company["pending_invoice_id"]
            pending_charge_key = company.get("pending_charge_key")
            if pending_charge_key not in charge_keys:
                pending_charge_key = f"legacy:{pending_invoice_id}"
                if pending_charge_key not in charge_keys:
                    continue
            if pending_invoice_id != master["id"] or pending_charge_key != company.get("pending_charge_key"):
                await db.companies.update_one(
                    {"id": company["id"]},
                    {"$set": {
                        "pending_invoice_id": master["id"],
                        "pending_charge_key": pending_charge_key,
                    }},
                )
        await db.saas_payment_plans.update_many(
            {"source_invoice_id": {"$in": secondary_ids}},
            {"$set": {"source_invoice_id": master["id"], "invoice_id": master["id"]}},
        )
        transactions = await db.saas_stripe_transactions.find(
            {"$or": [
                {"invoice_ids": {"$in": secondary_ids}},
                {"invoice_id": {"$in": secondary_ids}},
            ]},
            {"_id": 1, "invoice_id": 1, "invoice_ids": 1},
        ).to_list(10000)
        for transaction in transactions:
            invoice_ids = [
                master["id"] if invoice_id in secondary_ids else invoice_id
                for invoice_id in transaction.get("invoice_ids") or []
            ]
            invoice_ids = list(dict.fromkeys(invoice_ids))
            changes = {"invoice_ids": invoice_ids}
            if transaction.get("invoice_id") in secondary_ids:
                changes["invoice_id"] = master["id"]
            await db.saas_stripe_transactions.update_one(
                {"_id": transaction["_id"]}, {"$set": changes},
            )
        await db.subscription_invoices.update_many(
            {"id": {"$in": secondary_ids}},
            {"$set": {"status": "merged", "merged_into_invoice_id": master["id"]}},
        )

    plan_ids = {invoice.get("saas_plan_id") for invoice in invoices if invoice.get("saas_plan_id")}
    for plan_id in plan_ids:
        plan = await db.saas_payment_plans.find_one({"id": plan_id}, {"_id": 0})
        if not plan:
            continue
        schedule = plan.get("schedule")
        if not schedule:
            schedule = []
            for invoice in invoices:
                if invoice.get("saas_plan_id") != plan_id:
                    continue
                paid = paid_by_invoice.get(invoice["id"], 0)
                if invoice.get("status") == "paid" and paid <= 0:
                    paid = float(invoice.get("amount") or 0)
                term_amount = float(invoice.get("amount") or 0)
                schedule.append({
                    "seq": invoice.get("installment_seq"),
                    "amount": term_amount,
                    "paid_amount": round(min(paid, term_amount), 2),
                    "status": "paid" if paid >= term_amount else invoice.get("status", "open"),
                    "due_date": invoice.get("due_date"),
                    "period_end": invoice.get("period_end"),
                })
            schedule.sort(key=lambda term: term.get("seq") or 0)
        await db.saas_payment_plans.update_one(
            {"id": plan_id},
            {"$set": {
                "invoice_id": master["id"],
                "source_invoice_id": master["id"],
                "schedule": schedule,
            }},
        )

    return await db.subscription_invoices.find_one({"id": master["id"]}, {"_id": 0})


async def apply_saas_plan_payment(
    db,
    invoice_id: str,
    amount: float,
    plan_id: str | None = None,
    installment_seq: int | None = None,
) -> None:
    """Keep schedule balances in sync with payments posted to the master invoice."""
    query = {"invoice_id": invoice_id}
    if plan_id:
        query["id"] = plan_id
    plans = await db.saas_payment_plans.find(query, {"_id": 0}).sort("created_at", 1).to_list(1000)
    remaining = round(float(amount), 2)
    if plan_id and installment_seq is not None:
        plans = [plan for plan in plans if plan.get("id") == plan_id]
    for plan in plans:
        schedule = list(plan.get("schedule") or [])
        terms = sorted(schedule, key=lambda term: term.get("seq") or 0)
        if plan_id and installment_seq is not None:
            terms = [term for term in terms if term.get("seq") == installment_seq]
        for term in terms:
            due = round(max(float(term.get("amount") or 0) - float(term.get("paid_amount") or 0), 0), 2)
            if due <= 0 or remaining <= 0:
                continue
            applied = min(due, remaining)
            term["paid_amount"] = round(float(term.get("paid_amount") or 0) + applied, 2)
            term["status"] = "paid" if term["paid_amount"] >= float(term.get("amount") or 0) else "open"
            remaining = round(remaining - applied, 2)
        await db.saas_payment_plans.update_one(
            {"id": plan["id"]}, {"$set": {"schedule": schedule}},
        )


async def remove_unpaid_invoice_charge(db, invoice_id: str, charge_key: str) -> dict | None:
    """Remove a pending plan-change charge without removing the lasting invoice."""
    invoice = await db.subscription_invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        return None
    history = list(invoice.get("charge_history") or [])
    entry = next((item for item in history if item.get("charge_key") == charge_key), None)
    if not entry:
        return invoice
    charge_amount = float(entry.get("amount") or 0)
    paid_amount = float(invoice.get("paid_amount") or 0)
    balance_due = float(invoice.get("amount") or 0) - paid_amount
    if balance_due + 0.005 < charge_amount:
        raise ValueError("De pakketwijziging kan niet worden geannuleerd omdat er al op is betaald.")
    history.remove(entry)
    remaining_amount = round(max(float(invoice.get("amount") or 0) - charge_amount, 0), 2)
    status = "paid" if paid_amount >= remaining_amount else (
        "overdue" if invoice.get("status") == "overdue" else "open"
    )
    await db.subscription_invoices.update_one(
        {"id": invoice_id},
        {"$set": {
            "amount": remaining_amount,
            "balance_due": round(max(remaining_amount - paid_amount, 0), 2),
            "status": status,
            "charge_history": history,
        }, "$pull": {"charge_keys": charge_key}},
    )
    return await db.subscription_invoices.find_one({"id": invoice_id}, {"_id": 0})


async def consolidate_all_company_invoices(db) -> int:
    company_ids = await db.subscription_invoices.distinct("company_id")
    consolidated = 0
    for company_id in company_ids:
        if not company_id:
            continue
        try:
            await consolidate_company_invoices(db, company_id)
            consolidated += 1
        except ValueError as exc:
            print(f"[saas-invoice] could not consolidate {company_id}: {exc}")
    return consolidated


async def append_company_invoice_charge(db, invoice: dict, charge_key: str) -> tuple[dict, bool]:
    """Append a billing period once, preserving the company's invoice ID and payment history."""
    existing = await consolidate_company_invoices(db, invoice["company_id"])
    currency = (invoice.get("currency") or "SRD").upper()
    amount = round(float(invoice.get("amount") or 0), 2)
    if amount <= 0:
        raise ValueError("Het factuurbedrag moet groter zijn dan nul.")

    if existing:
        if (existing.get("currency") or "SRD").upper() != currency:
            raise ValueError("De valuta van de bestaande factuur moet gelijk blijven.")
        if charge_key in (existing.get("charge_keys") or []):
            return existing, False

        old_balance = float(existing.get("amount") or 0) - float(existing.get("paid_amount") or 0)
        update = await db.subscription_invoices.update_one(
            {"id": existing["id"], "charge_keys": {"$ne": charge_key}},
            {
                "$inc": {"amount": amount},
                "$addToSet": {"charge_keys": charge_key},
                "$push": {"charge_history": _period_entry(invoice, charge_key)},
                "$set": {
                    "balance_due": round(max(old_balance + amount, 0), 2),
                    "status": "overdue" if old_balance > 0 and existing.get("status") == "overdue" else "open",
                    "period_end": invoice.get("period_end") or existing.get("period_end"),
                    "due_date": min(
                        [value for value in (existing.get("due_date"), invoice.get("due_date")) if value]
                    ) if old_balance > 0 else invoice.get("due_date"),
                    "plan": invoice.get("plan") or existing.get("plan"),
                    "kind": "subscription",
                    "company_name": invoice.get("company_name") or existing.get("company_name"),
                    "master_invoice": True,
                },
            },
        )
        updated = await db.subscription_invoices.find_one({"id": existing["id"]}, {"_id": 0})
        return updated, update.modified_count == 1

    new_invoice = {
        **invoice,
        "amount": amount,
        "currency": currency,
        "master_invoice": True,
        "paid_amount": 0,
        "balance_due": amount,
        "charge_keys": [charge_key],
        "charge_history": [_period_entry(invoice, charge_key)],
    }
    try:
        await db.subscription_invoices.insert_one(new_invoice)
    except DuplicateKeyError:
        return await append_company_invoice_charge(db, invoice, charge_key)
    new_invoice.pop("_id", None)
    return new_invoice, True


async def update_invoice_paid_amount(db, invoice_id: str, amount: float) -> dict | None:
    """Apply a payment and derive the cumulative invoice status from its balance."""
    if amount <= 0:
        raise ValueError("Het betaalbedrag moet groter zijn dan nul.")
    invoice = await db.subscription_invoices.find_one_and_update(
        {"id": invoice_id},
        [{"$set": {
            "paid_amount": {"$round": [{"$add": [{"$ifNull": ["$paid_amount", 0]}, amount]}, 2]},
        }}, {"$set": {
            "balance_due": {"$max": [{"$subtract": ["$amount", "$paid_amount"]}, 0]},
            "status": {"$cond": [
                {"$gte": ["$paid_amount", "$amount"]}, "paid",
                {"$cond": [{"$eq": ["$status", "overdue"]}, "overdue", "open"]},
            ]},
        }}],
        projection={"_id": 0},
        return_document=True,
    )
    if not invoice:
        return None
    return invoice
