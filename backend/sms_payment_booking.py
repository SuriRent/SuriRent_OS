"""Atomic booking of verified SMS invoice and installment payments.

This requires MongoDB transactions. The checkout must remain disabled until
the deployment supports transactions and other payment paths are coordinated.
"""

from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation

from pymongo import ReturnDocument
from pymongo.read_concern import ReadConcern
from pymongo.write_concern import WriteConcern

from sms_payment_attempts import PaymentAttemptConflict, _tenant_key, tenant_payment_key
from tenant_payment_guard import release_payment_guard


def _cents(value) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise PaymentAttemptConflict("Factuurbedrag is ongeldig")
    try:
        amount = Decimal(str(value))
        cents = amount * 100
        if not amount.is_finite() or cents != cents.to_integral_value() or cents < 0:
            raise InvalidOperation
        return int(cents)
    except (InvalidOperation, ValueError, OverflowError) as exc:
        raise PaymentAttemptConflict("Factuurbedrag is ongeldig") from exc


async def _invoice_paid_cents(db, invoice, session) -> int:
    if invoice.get("paid_amount") is not None:
        return _cents(invoice["paid_amount"])
    if invoice.get("status") != "open":
        raise PaymentAttemptConflict("Factuursaldo moet eerst worden gecontroleerd")
    for field in ("invoice_id", "invoice_ids", "allocations.invoice_id"):
        if await db.payments.find_one({"status": "approved", field: invoice["id"]}, session=session):
            raise PaymentAttemptConflict("Factuursaldo moet eerst worden gecontroleerd")
    return 0


async def _installment_context(db, attempt: dict, session) -> dict:
    item = attempt["item"]
    plan_scope = {
        "id": item["plan_id"], "company_id": attempt["company_id"],
        "tenant_id": attempt["tenant_id"], "status": "active",
    }
    plan = await db.payment_plans.find_one(plan_scope, session=session)
    if not plan or (plan.get("currency") or "SRD") != attempt["currency"]:
        raise PaymentAttemptConflict("Regeling is gewijzigd; controleer de betaling handmatig")
    installments = await db.payment_plan_installments.find(
        {"plan_id": plan["id"], "company_id": attempt["company_id"]}, session=session,
    ).to_list(None)
    sequences = [row.get("sequence") for row in installments]
    if (any(type(sequence) is not int or sequence < 1 for sequence in sequences)
            or len(set(sequences)) != len(sequences)
            or any(row.get("status") not in ("pending", "paid", "cancelled", "pending_payment")
                   for row in installments)):
        raise PaymentAttemptConflict("Termijnen zijn ongeldig; controleer de betaling handmatig")
    selected_rows = [row for row in installments if row.get("sequence") == item["sequence"]]
    if len(selected_rows) != 1 or selected_rows[0].get("status") != "pending":
        raise PaymentAttemptConflict("Termijn is gewijzigd; controleer de betaling handmatig")
    selected = selected_rows[0]
    if any(row.get("status") == "pending_payment" for row in installments):
        raise PaymentAttemptConflict("Een andere termijnbetaling wordt verwerkt")
    paid = sum(_cents(row.get("amount")) for row in installments if row.get("status") == "paid")
    pending = sum(_cents(row.get("amount")) for row in installments if row.get("status") == "pending")
    remaining = _cents(plan.get("total_amount")) - paid
    amount = _cents(selected.get("amount"))
    if remaining <= 0 or pending != remaining or amount != attempt["amount_cents"]:
        raise PaymentAttemptConflict("Regelingsbedrag is gewijzigd; controleer de betaling handmatig")

    ids = plan.get("invoice_ids")
    if ids is None:
        ids = []
    if not isinstance(ids, list) or any(not isinstance(i, str) or not i for i in ids) or len(set(ids)) != len(ids):
        raise PaymentAttemptConflict("Ongeldige facturen in regeling")
    invoices = await db.invoices.find(
        {"id": {"$in": ids}, "company_id": attempt["company_id"], "tenant_id": attempt["tenant_id"]},
        session=session,
    ).to_list(None) if ids else []
    if len(invoices) != len(ids):
        raise PaymentAttemptConflict("Gekoppelde factuur ontbreekt")
    candidates = []
    for invoice in invoices:
        if (invoice.get("archived") is True or invoice.get("status") in ("cancelled", "archived")
                or (invoice.get("currency") or "SRD") != attempt["currency"]):
            raise PaymentAttemptConflict("Gekoppelde factuur is gewijzigd")
        total, invoice_paid = _cents(invoice.get("amount")), await _invoice_paid_cents(db, invoice, session)
        if invoice_paid > total or (invoice.get("status") == "paid" and invoice_paid != total):
            raise PaymentAttemptConflict("Ongeldig factuursaldo")
        if await db.payment_plans.find_one({
            "id": {"$ne": plan["id"]}, "company_id": attempt["company_id"],
            "invoice_ids": invoice["id"], "status": "active",
        }, session=session):
            raise PaymentAttemptConflict("Factuur is gekoppeld aan een andere actieve regeling")
        candidates.append((invoice, total, invoice_paid))
    if ids and sum(total - invoice_paid for _, total, invoice_paid in candidates) < remaining:
        raise PaymentAttemptConflict("Openstaand factuurbedrag is gewijzigd; controleer de betaling handmatig")
    candidates.sort(key=lambda row: (
        str(row[0].get("period_year") or "").zfill(4),
        str(row[0].get("period_month") or "").zfill(2),
        str(row[0].get("created_at") or ""), row[0]["id"],
    ))
    allocations = []
    outstanding = amount
    for invoice, total, invoice_paid in candidates:
        chunk = min(total - invoice_paid, outstanding)
        if chunk > 0:
            allocations.append((invoice, total, invoice_paid, chunk))
            outstanding -= chunk
    if ids and outstanding:
        raise PaymentAttemptConflict("Termijn kan niet volledig aan facturen worden gekoppeld")
    return {
        "plan": plan, "plan_scope": plan_scope, "selected": selected, "allocations": allocations,
        "complete": not any(row.get("status") == "pending" and row.get("sequence") != item["sequence"]
                            for row in installments),
        "paid_count": sum(row.get("status") == "paid" for row in installments) + 1,
    }


async def _booked_payment(db, attempt: dict, attempt_id: str, session) -> dict:
    payment_id = f"sms-{attempt_id}"
    payment = await db.payments.find_one({"_id": payment_id}, session=session)
    item = attempt.get("item") or {}
    metadata = (payment or {}).get("metadata") or {}
    if (not isinstance(item, dict) or not isinstance(metadata, dict)
            or attempt.get("attempt_id") != attempt_id
            or not isinstance(attempt.get("company_id"), str) or not attempt["company_id"]
            or not isinstance(attempt.get("tenant_id"), str) or not attempt["tenant_id"]
            or type(attempt.get("amount_cents")) is not int or attempt["amount_cents"] <= 0
            or attempt.get("method") not in ("card", "ideal", "mope")
            or attempt.get("currency") not in ("SRD", "USD", "EUR")
            or not isinstance(attempt.get("provider_id"), str) or not attempt["provider_id"]):
        raise PaymentAttemptConflict("Geboekte betaling ontbreekt of komt niet overeen")
    if item.get("kind") == "invoice":
        matches_item = (isinstance(item.get("id"), str) and bool(item["id"])
                        and (payment or {}).get("invoice_id") == item["id"])
    else:
        matches_item = (item.get("kind") == "installment"
                        and isinstance(item.get("plan_id"), str) and bool(item["plan_id"])
                        and type(item.get("sequence")) is int and item["sequence"] > 0
                        and metadata.get("plan_id") == item["plan_id"]
                        and metadata.get("installment_seq") == item["sequence"])
    if (not payment or attempt.get("state") != "booked"
            or payment.get("company_id") != attempt.get("company_id")
            or payment.get("tenant_id") != attempt.get("tenant_id")
            or payment.get("sms_attempt_id") != attempt_id
            or attempt.get("payment_id") != payment_id
            or payment.get("status") != "approved"
            or not matches_item
            or payment.get("currency") != attempt.get("currency")
            or _cents(payment.get("amount")) != attempt.get("amount_cents")
            or payment.get("mope_payment_request_id" if attempt.get("method") == "mope"
                           else "stripe_payment_intent_id") != attempt.get("provider_id")):
        raise PaymentAttemptConflict("Geboekte betaling ontbreekt of komt niet overeen")
    return payment


async def _previous_request_fully_booked(db, request, provider, scope, session) -> bool:
    if request.get("status") != "paid" or request.get("currency") not in ("SRD", "USD", "EUR"):
        return False
    reference_field = "stripe_payment_intent_id" if provider == "stripe" else "mope_payment_request_id"
    reference = request.get("payment_intent_id" if provider == "stripe" else "payment_request_id")
    if not isinstance(reference, str) or not reference:
        return False
    try:
        if provider == "stripe":
            total = _cents(request.get("amount"))
            if request.get("consumed") is True:
                if request.get("booked_amount") not in (None, 0):
                    return False
            elif _cents(request.get("booked_amount")) != total:
                return False
            method = {"card": "creditcard", "ideal": "ideal"}.get(request.get("method"))
        else:
            total = request.get("amount_cents")
            if (type(total) is not int or type(request.get("booked_amount_cents")) is not int
                    or request["booked_amount_cents"] != total):
                return False
            method = "mope"
        if not total or not method:
            return False
        payments = await db.payments.find({reference_field: reference}, session=session).to_list(None)
        if len(payments) != 1:
            return False
        payment = payments[0]
        if (payment.get("company_id") != scope["company_id"] or payment.get("tenant_id") != scope["tenant_id"]
                or payment.get("status") != "approved" or payment.get("method") != method
                or payment.get("currency") != request["currency"]
                or _cents(payment.get("amount")) != total
                or _cents(payment.get("credit_remaining", 0)) != 0
                or not isinstance(payment.get("id"), str) or not payment["id"]):
            return False
        allocations = payment.get("allocations")
        if not isinstance(allocations, list) or not allocations:
            return False
        allocated, seen = 0, set()
        for allocation in allocations:
            if not isinstance(allocation, dict):
                return False
            invoice_id = allocation.get("invoice_id")
            if not isinstance(invoice_id, str) or not invoice_id or invoice_id in seen:
                return False
            seen.add(invoice_id)
            amount = _cents(allocation.get("amount"))
            if amount <= 0:
                return False
            invoice = await db.invoices.find_one({**scope, "id": invoice_id}, session=session)
            if (not invoice or invoice.get("archived") is True
                    or invoice.get("status") not in ("open", "partial", "paid")
                    or (invoice.get("currency") or "SRD") != request["currency"]
                    or _cents(invoice.get("paid_amount")) < amount
                    or _cents(invoice.get("paid_amount")) > _cents(invoice.get("amount"))
                    or (invoice.get("status") == "paid"
                        and _cents(invoice.get("paid_amount")) != _cents(invoice.get("amount")))):
                return False
            invoice_paid, invoice_total = _cents(invoice.get("paid_amount")), _cents(invoice.get("amount"))
            if ((invoice.get("status") == "open" and invoice_paid != 0)
                    or (invoice.get("status") == "partial" and not 0 < invoice_paid < invoice_total)):
                return False
            other_payments = await db.payments.find({
                "company_id": scope["company_id"], "status": "approved", "allocations.invoice_id": invoice_id,
            }, session=session).to_list(None)
            recorded = 0
            for other in other_payments:
                if other.get("tenant_id") != scope["tenant_id"]:
                    return False
                for entry in other.get("allocations") or []:
                    if isinstance(entry, dict) and entry.get("invoice_id") == invoice_id:
                        recorded += _cents(entry.get("amount"))
            if recorded < amount or recorded > _cents(invoice.get("paid_amount")):
                return False
            if await db.payment_plans.find_one({
                "company_id": scope["company_id"], "invoice_ids": invoice_id, "status": "active",
            }, session=session):
                return False
            allocated += amount
        if payment.get("category") == "betalingsregeling":
            metadata = payment.get("metadata") or {}
            if (not isinstance(metadata, dict) or not isinstance(metadata.get("plan_id"), str)
                    or not metadata["plan_id"] or type(metadata.get("installment_seq")) is not int
                    or metadata["installment_seq"] < 1):
                return False
            if not await db.payment_plans.find_one({**scope, "id": metadata["plan_id"]}, session=session):
                return False
            installment = await db.payment_plan_installments.find_one({
                "company_id": scope["company_id"], "plan_id": metadata["plan_id"],
                "sequence": metadata.get("installment_seq"), "payment_id": payment["id"], "status": "paid",
            }, session=session)
            if not installment or _cents(installment.get("amount")) != total:
                return False
        return allocated == total
    except PaymentAttemptConflict:
        return False


async def _booking_context(db, attempt: dict, session) -> dict:
    item = attempt.get("item") or {}
    if not isinstance(item, dict) or item.get("kind") not in ("invoice", "installment"):
        raise PaymentAttemptConflict("Ongeldige betaalpost")
    if (type(attempt.get("amount_cents")) is not int or attempt["amount_cents"] <= 0
            or attempt.get("method") not in ("card", "ideal", "mope")
            or attempt.get("currency") not in ("SRD", "USD", "EUR")):
        raise PaymentAttemptConflict("Betaalpoging is onvolledig")
    pending = await db.payments.find_one({
        "company_id": attempt["company_id"], "tenant_id": attempt["tenant_id"],
        "status": {"$in": ["pending_approval", "approving", "rejecting"]},
    }, session=session)
    if pending:
        raise PaymentAttemptConflict("Een andere betaling voor deze huurder wacht op verwerking")
    scope = {"company_id": attempt["company_id"], "tenant_id": attempt["tenant_id"]}
    if await db.payments.find_one({
        **scope, "category": "huur", "invoice_id": {"$in": [None, ""]},
        "status": {"$nin": ["rejected", "cancelled", "canceled"]},
    }, session=session):
        raise PaymentAttemptConflict("Een eerdere huurbetaling moet eerst worden gecontroleerd")
    stripe_requests = await db.kiosk_stripe_payments.find(
        {**scope, "status": {"$ne": "canceled"}}, session=session,
    ).to_list(None)
    for request in stripe_requests:
        if not await _previous_request_fully_booked(db, request, "stripe", scope, session):
            raise PaymentAttemptConflict("Een eerder Stripe-betaalverzoek moet eerst worden gecontroleerd")
    mope_requests = await db.kiosk_mope_payments.find(scope, session=session).to_list(None)
    for request in mope_requests:
        if not await _previous_request_fully_booked(db, request, "mope", scope, session):
            raise PaymentAttemptConflict("Een eerder Mopé-betaalverzoek moet eerst worden gecontroleerd")
    context, tenant = None, None
    if item["kind"] == "invoice":
        if not isinstance(item.get("id"), str) or not item["id"]:
            raise PaymentAttemptConflict("Ongeldige factuur")
        scope = {"id": item["id"], "company_id": attempt["company_id"], "tenant_id": attempt["tenant_id"]}
        invoice = await db.invoices.find_one(scope, session=session)
        if (not invoice or invoice.get("archived") is True
                or invoice.get("status") in ("paid", "cancelled", "archived")
                or (invoice.get("currency") or "SRD") != attempt["currency"]):
            raise PaymentAttemptConflict("Factuur is gewijzigd; controleer de betaling handmatig")
        total, paid = _cents(invoice.get("amount")), await _invoice_paid_cents(db, invoice, session)
        if total - paid != attempt["amount_cents"]:
            raise PaymentAttemptConflict("Openstaand factuurbedrag is gewijzigd; controleer de betaling handmatig")
        if await db.payment_plans.find_one(
            {"company_id": attempt["company_id"], "invoice_ids": item["id"], "status": "active"},
            session=session,
        ):
            raise PaymentAttemptConflict("Factuur heeft een actieve regeling; controleer de betaling handmatig")
        allocations = [(invoice, total, paid, attempt["amount_cents"])]
    else:
        if (not isinstance(item.get("plan_id"), str) or not item["plan_id"]
                or type(item.get("sequence")) is not int or item["sequence"] < 1):
            raise PaymentAttemptConflict("Ongeldige regelingstermijn")
        context = await _installment_context(db, attempt, session)
        invoice = None
        allocations = context["allocations"]
        tenant = await db.tenants.find_one(
            {"id": attempt["tenant_id"], "company_id": attempt["company_id"]}, session=session,
        )
        if not tenant:
            raise PaymentAttemptConflict("Huurder niet gevonden")
    return {"invoice": invoice, "tenant": tenant, "plan": context, "allocations": allocations}


async def preflight_reserved_payment(db, client, *, key: str, attempt_id: str) -> dict:
    """Check current booking requirements before creating a provider request.

    This snapshot is not a lock: other payment flows must still be coordinated.
    """
    async def transaction(session):
        attempt = await db.sms_payment_attempts.find_one(
            {"_id": key, "attempt_id": attempt_id, "state": "reserved"}, session=session,
        )
        if not attempt:
            raise PaymentAttemptConflict("Betaalpoging kan niet opnieuw worden gestart")
        if attempt.get("provider_id") is not None:
            raise PaymentAttemptConflict("Betaalpoging heeft al een providerreferentie")
        try:
            expected_key = _tenant_key(attempt.get("company_id"), attempt.get("tenant_id"), attempt.get("item"))
        except ValueError as exc:
            raise PaymentAttemptConflict("Ongeldige betaalpoging") from exc
        if expected_key != key:
            raise PaymentAttemptConflict("Betaalpoging heeft een ongeldige scope")
        provider_amount = attempt.get("provider_amount_cents")
        if type(provider_amount) is not int or provider_amount <= 0:
            raise PaymentAttemptConflict("Ongeldig providerbedrag")
        if attempt.get("method") == "mope":
            if (provider_amount != attempt.get("amount_cents")
                    or attempt.get("provider_currency") != attempt.get("currency")
                    or attempt.get("stripe_mode") is not None):
                raise PaymentAttemptConflict("Mopé-bedrag of valuta wijkt af")
        elif (attempt.get("provider_currency") != "EUR" or attempt.get("stripe_mode") not in ("test", "live")):
            raise PaymentAttemptConflict("Ongeldige Stripe-betaalpoging")
        await _booking_context(db, attempt, session)
        return attempt

    async with await client.start_session() as session:
        return await session.with_transaction(
            transaction, read_concern=ReadConcern("snapshot"), write_concern=WriteConcern("majority"),
        )


async def book_verified_payment(db, client, *, key: str, attempt_id: str) -> dict:
    """Book a verified payment once, or leave it unchanged for review."""

    async def transaction(session):
        attempt = await db.sms_payment_attempts.find_one(
            {"_id": key, "attempt_id": attempt_id}, session=session,
        )
        if not attempt:
            attempt = await db.sms_payment_attempt_history.find_one(
                {"_id": attempt_id, "reservation_key": key}, session=session,
            )
            if not attempt:
                raise PaymentAttemptConflict("Betaalpoging niet gevonden")
            return await _booked_payment(db, attempt, attempt_id, session)
        payment_id = f"sms-{attempt_id}"
        if attempt.get("state") == "booked":
            return await _booked_payment(db, attempt, attempt_id, session)
        if attempt.get("state") != "verified":
            raise PaymentAttemptConflict("Betaling is nog niet door de provider bevestigd")
        guard = await db.tenant_payment_guards.find_one({
            "_id": tenant_payment_key(attempt["company_id"], attempt["tenant_id"]),
            "company_id": attempt["company_id"], "tenant_id": attempt["tenant_id"],
            "kind": "sms", "owner": attempt_id,
        }, session=session)
        if attempt.get("guard_owner") != attempt_id or not guard:
            raise PaymentAttemptConflict("Betaalvergrendeling ontbreekt of is gewijzigd")
        if not isinstance(attempt.get("provider_id"), str) or not attempt["provider_id"]:
            raise PaymentAttemptConflict("Betaalpoging is onvolledig")
        booking = await _booking_context(db, attempt, session)
        item = attempt["item"]
        invoice, tenant, context = booking["invoice"], booking["tenant"], booking["plan"]
        allocations = booking["allocations"]

        now = datetime.now(timezone.utc)
        paid_at = now.isoformat()
        counter = await db.counters.find_one_and_update(
            {"_id": f"receipt_{now.year}"}, {"$inc": {"seq": 1}},
            upsert=True, return_document=ReturnDocument.AFTER, session=session,
        )
        receipt = f"KW{now.year}-{counter['seq']:05d}"
        method = "creditcard" if attempt["method"] == "card" else attempt["method"]
        payment = {
            "_id": payment_id, "id": payment_id, "sms_attempt_id": attempt_id,
            "company_id": attempt["company_id"], "tenant_id": attempt["tenant_id"],
            "apartment_id": invoice.get("apartment_id") if invoice else tenant.get("apartment_id"),
            "amount": attempt["amount_cents"] / 100, "currency": attempt["currency"],
            "method": method, "category": "huur" if invoice else "betalingsregeling", "status": "approved",
            "receipt_number": receipt, "paid_at": paid_at, "approved_at": paid_at,
            "approved_by": "Online betaling", "note": "Betaling via sms-betaallink",
            "allocations": [{"invoice_id": inv["id"], "amount": chunk / 100, "applied_at": paid_at}
                            for inv, _, _, chunk in allocations],
        }
        if invoice:
            payment.update({"invoice_id": invoice["id"], "invoice_number": invoice.get("invoice_number"),
                            "period_month": invoice.get("period_month"), "period_year": invoice.get("period_year")})
        else:
            payment["metadata"] = {"plan_id": item["plan_id"], "installment_seq": item["sequence"]}
        provider_field = "mope_payment_request_id" if method == "mope" else "stripe_payment_intent_id"
        payment[provider_field] = attempt["provider_id"]
        for inv, total, paid, chunk in allocations:
            new_paid = paid + chunk
            fields = {
                "paid_amount": new_paid / 100, "status": "paid" if new_paid == total else "partial",
                "payment_id": payment_id, "paid_method": method, "receipt_number": receipt,
            }
            if new_paid == total:
                fields["paid_at"] = paid_at
            updated = await db.invoices.update_one(
                {"id": inv["id"], "company_id": attempt["company_id"], "tenant_id": attempt["tenant_id"],
                 "amount": inv["amount"], "paid_amount": inv.get("paid_amount"),
                 "status": inv.get("status"), "archived": {"$ne": True}},
                {"$set": fields}, session=session,
            )
            if updated.modified_count != 1:
                raise PaymentAttemptConflict("Factuur is intussen gewijzigd")
        if context:
            selected = context["selected"]
            updated = await db.payment_plan_installments.update_one(
                {"id": selected["id"], "plan_id": item["plan_id"], "company_id": attempt["company_id"],
                 "sequence": item["sequence"], "status": "pending", "amount": selected["amount"]},
                {"$set": {"status": "paid", "paid_at": paid_at, "payment_id": payment_id}}, session=session,
            )
            if updated.modified_count != 1:
                raise PaymentAttemptConflict("Termijn is intussen gewijzigd")
            fields = {"paid_installments": context["paid_count"]}
            if context["complete"]:
                fields.update({"status": "completed", "completed_at": paid_at})
            updated = await db.payment_plans.update_one(
                {**context["plan_scope"], "total_amount": context["plan"]["total_amount"]},
                {"$set": fields}, session=session,
            )
            if updated.matched_count != 1:
                raise PaymentAttemptConflict("Regeling is intussen gewijzigd")
        await db.payments.insert_one(payment, session=session)
        updated = await db.sms_payment_attempts.update_one(
            {"_id": key, "attempt_id": attempt_id, "state": "verified"},
            {"$set": {"state": "booked", "payment_id": payment_id, "booked_at": now}}, session=session,
        )
        if updated.modified_count != 1:
            raise PaymentAttemptConflict("Betaalpoging is intussen gewijzigd")
        return payment

    async with await client.start_session() as session:
        return await session.with_transaction(
            transaction, read_concern=ReadConcern("snapshot"), write_concern=WriteConcern("majority"),
        )


async def release_booked_attempt(db, client, *, key: str, attempt_id: str) -> None:
    """Archive a confirmed booking and release its tenant reservation atomically."""

    async def transaction(session):
        attempt = await db.sms_payment_attempts.find_one(
            {"_id": key, "attempt_id": attempt_id}, session=session,
        )
        if not attempt:
            archived = await db.sms_payment_attempt_history.find_one(
                {"_id": attempt_id, "reservation_key": key}, session=session,
            )
            if not archived:
                raise PaymentAttemptConflict("Betaalpoging niet gevonden")
            await _booked_payment(db, archived, attempt_id, session)
            return
        await _booked_payment(db, attempt, attempt_id, session)
        deleted = await db.sms_payment_attempts.delete_one(
            {"_id": key, "attempt_id": attempt_id, "state": "booked",
             "payment_id": attempt["payment_id"]}, session=session,
        )
        if deleted.deleted_count != 1:
            raise PaymentAttemptConflict("Betaalpoging is intussen gewijzigd")
        archived = {**attempt, "_id": attempt_id, "reservation_key": key,
                    "released_at": datetime.now(timezone.utc)}
        await db.sms_payment_attempt_history.insert_one(archived, session=session)
        if attempt.get("guard_owner") != attempt_id:
            raise PaymentAttemptConflict("Betaalvergrendeling ontbreekt of is gewijzigd")
        await release_payment_guard(
            db, company_id=attempt["company_id"], tenant_id=attempt["tenant_id"],
            kind="sms", owner=attempt_id, session=session,
        )

    async with await client.start_session() as session:
        await session.with_transaction(
            transaction, read_concern=ReadConcern("snapshot"), write_concern=WriteConcern("majority"),
        )
