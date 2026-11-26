"""Checkout orchestration for a payment-only SMS grant.

The public checkout is disabled until all financial paths are coordinated.
"""

from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from sms_payment_attempts import PaymentAttemptConflict, _tenant_key, reserve_attempt, tenant_payment_key
from sms_payment_booking import _booking_context, _cents, _invoice_paid_cents, _installment_context
from sms_payment_links import get_payment_grant
from sms_payment_providers import create_sms_mope_request, create_sms_stripe_intent, resume_sms_stripe_intent
from sms_payment_reconciliation import reconcile_sms_payment


SMS_MOPE_READY = False


async def require_transaction_support(client) -> None:
    topology = await client.admin.command("hello")
    replica = bool(topology.get("setName") and topology.get("isWritablePrimary"))
    router = topology.get("msg") == "isdbgrid"
    if not (replica or router) or topology.get("logicalSessionTimeoutMinutes") is None:
        raise PaymentAttemptConflict("Online betalen is tijdelijk niet beschikbaar: databasetransacties ontbreken")


async def _authorized_grant(db, token: str, item: dict) -> dict:
    grant = await get_payment_grant(db.sms_payment_links, token)
    if not grant:
        raise PaymentAttemptConflict("Deze betaallink is ongeldig of verlopen")
    try:
        _tenant_key(grant["company_id"], grant["tenant_id"], item)
    except (KeyError, ValueError) as exc:
        raise PaymentAttemptConflict("Ongeldige betaalpost") from exc
    if item["kind"] == "invoice":
        allowed = item["id"] in grant.get("invoice_ids", [])
    else:
        allowed = {"plan_id": item["plan_id"], "sequence": item["sequence"]} in grant.get("installments", [])
    if not allowed:
        raise PaymentAttemptConflict("Deze betaalpost hoort niet bij de betaallink")
    tenant = await db.tenants.find_one({
        "id": grant["tenant_id"], "company_id": grant["company_id"], "status": {"$nin": ["archived", "archiving"]},
    })
    if not tenant:
        raise PaymentAttemptConflict("Deze betaallink is ongeldig of verlopen")
    return grant


async def _current_amount(db, grant: dict, item: dict) -> tuple[int, str]:
    scope = {"company_id": grant["company_id"], "tenant_id": grant["tenant_id"]}
    if item["kind"] == "invoice":
        invoice = await db.invoices.find_one({**scope, "id": item["id"]})
        if (not invoice or invoice.get("archived") is True
                or invoice.get("status") not in ("open", "sent", "pending", "overdue", "partial")):
            raise PaymentAttemptConflict("Factuur is niet meer open")
        amount = _cents(invoice.get("amount")) - await _invoice_paid_cents(db, invoice, None)
        currency = invoice.get("currency") or "SRD"
    else:
        plan = await db.payment_plans.find_one({**scope, "id": item["plan_id"], "status": "active"})
        installment = await db.payment_plan_installments.find_one({
            "company_id": scope["company_id"], "plan_id": item["plan_id"], "sequence": item["sequence"],
            "status": "pending",
        })
        if not plan or not installment:
            raise PaymentAttemptConflict("Regelingstermijn is niet meer open")
        amount, currency = _cents(installment.get("amount")), plan.get("currency") or "SRD"
        await _installment_context(db, {**scope, "item": item, "amount_cents": amount, "currency": currency}, None)
    if amount <= 0 or currency not in ("SRD", "USD", "EUR"):
        raise PaymentAttemptConflict("Openstaand bedrag of valuta is ongeldig")
    return amount, currency


async def _stripe_amount(amount_cents: int, currency: str) -> int:
    if currency == "EUR":
        cents = amount_cents
    elif currency == "SRD":
        from routes import _deps

        fx = await _deps.get_eur_per_srd()
        if fx.get("source") not in ("manual", "cache", "live"):
            raise PaymentAttemptConflict("Een actuele wisselkoers ontbreekt")
        try:
            rate = Decimal(str(fx.get("rate")))
            if not rate.is_finite() or rate <= 0:
                raise InvalidOperation
            cents = int((Decimal(amount_cents) * rate).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
        except (InvalidOperation, ValueError, OverflowError) as exc:
            raise PaymentAttemptConflict("Een geldige wisselkoers ontbreekt") from exc
    else:
        raise PaymentAttemptConflict("Stripe is voor deze valuta nog niet beschikbaar")
    if cents < 50:
        raise PaymentAttemptConflict("Het bedrag is te laag voor Stripe")
    return cents


async def start_sms_checkout(db, client, *, token: str, item: dict, method: str) -> dict:
    grant = await _authorized_grant(db, token, item)
    if method not in ("card", "ideal", "mope"):
        raise PaymentAttemptConflict("Ongeldige betaalmethode")
    if method == "mope" and not SMS_MOPE_READY:
        raise PaymentAttemptConflict("Mopé is voor deze betaallink nog niet beschikbaar")
    amount, currency = await _current_amount(db, grant, item)
    from routes import _deps

    if method == "mope":
        from routes.company_mope import _active, _config

        await _deps.require_plan_feature(grant["company_id"], "allow_mope", "Mopé-betalingen")
        if not _active(await _config(grant["company_id"])):
            raise PaymentAttemptConflict("Mopé is niet ingeschakeld")
        provider_amount, provider_currency, mode = amount, currency, None
    else:
        from routes.company_stripe import _active, _cfg_doc

        await _deps.require_plan_feature(grant["company_id"], "allow_stripe", "Stripe-betalingen")
        config = _active((await _cfg_doc(grant["company_id"])).get("stripe_config") or {})
        if not config["enabled"] or method not in config["methods"] or config["mode"] not in ("test", "live"):
            raise PaymentAttemptConflict("Deze Stripe-betaalmethode is niet ingeschakeld")
        provider_amount, provider_currency, mode = await _stripe_amount(amount, currency), "EUR", config["mode"]

    await require_transaction_support(client)

    attempt = await reserve_attempt(
        db.sms_payment_attempts, company_id=grant["company_id"], tenant_id=grant["tenant_id"],
        item=item, method=method, amount_cents=amount, currency=currency,
        provider_amount_cents=provider_amount, provider_currency=provider_currency, stripe_mode=mode,
    )
    if attempt.get("state") != "reserved":
        raise PaymentAttemptConflict("Een bestaande betaalpoging moet eerst worden gecontroleerd")
    create = create_sms_mope_request if method == "mope" else create_sms_stripe_intent
    provider = await create(db, client, attempt)
    return {
        "attempt_id": attempt["attempt_id"], "item": item, "method": method,
        "amount_cents": amount, "currency": currency,
        "provider_amount_cents": provider_amount, "provider_currency": provider_currency, **provider,
    }


async def finish_sms_checkout(db, client, *, token: str, item: dict, attempt_id: str) -> dict:
    grant = await _authorized_grant(db, token, item)
    if not isinstance(attempt_id, str) or not attempt_id:
        raise PaymentAttemptConflict("Ongeldige betaalpoging")
    key = _tenant_key(grant["company_id"], grant["tenant_id"], item)
    attempt = await db.sms_payment_attempts.find_one({"_id": key, "attempt_id": attempt_id})
    if not attempt:
        attempt = await db.sms_payment_attempt_history.find_one({"_id": attempt_id, "reservation_key": key})
    if (not attempt or attempt.get("company_id") != grant["company_id"]
            or attempt.get("tenant_id") != grant["tenant_id"] or attempt.get("item") != item):
        raise PaymentAttemptConflict("Betaalpoging hoort niet bij deze betaallink")
    payment = await reconcile_sms_payment(db, client, key=key, attempt_id=attempt_id)
    return {"status": "paid", "receipt_number": payment["receipt_number"]}


async def resume_sms_checkout(db, *, token: str, item: dict, attempt_id: str) -> dict:
    grant = await _authorized_grant(db, token, item)
    if not isinstance(attempt_id, str) or not attempt_id:
        raise PaymentAttemptConflict("Ongeldige betaalpoging")
    key = _tenant_key(grant["company_id"], grant["tenant_id"], item)
    query = {"_id": key, "attempt_id": attempt_id, "company_id": grant["company_id"],
             "tenant_id": grant["tenant_id"], "state": "open", "guard_owner": attempt_id}
    attempt = await db.sms_payment_attempts.find_one(query)
    if not attempt or attempt.get("item") != item or attempt.get("method") not in ("card", "ideal"):
        raise PaymentAttemptConflict("Deze betaalpoging kan niet worden hervat")
    guard_query = {"_id": tenant_payment_key(grant["company_id"], grant["tenant_id"]),
                   "company_id": grant["company_id"], "tenant_id": grant["tenant_id"],
                   "kind": "sms", "owner": attempt_id}
    if not await db.tenant_payment_guards.find_one(guard_query):
        raise PaymentAttemptConflict("Betaalvergrendeling ontbreekt of is gewijzigd")
    amount, currency = await _current_amount(db, grant, item)
    if (amount, currency) != (attempt.get("amount_cents"), attempt.get("currency")):
        raise PaymentAttemptConflict("Openstaand bedrag is gewijzigd")
    await _booking_context(db, attempt, None)
    provider = await resume_sms_stripe_intent(attempt)
    snapshot = {name: attempt.get(name) for name in (
        "item", "method", "provider_id", "stripe_mode", "amount_cents", "currency",
        "provider_amount_cents", "provider_currency",
    )}
    if (not await db.sms_payment_attempts.find_one({**query, **snapshot})
            or not await db.tenant_payment_guards.find_one(guard_query)):
        raise PaymentAttemptConflict("Betaalpoging is intussen gewijzigd")
    return {
        "attempt_id": attempt_id, "item": item, "method": attempt["method"],
        "amount_cents": amount, "currency": currency,
        "provider_amount_cents": attempt["provider_amount_cents"],
        "provider_currency": attempt["provider_currency"], **provider,
    }
