"""Provider-side status lookup for reserved SMS payment attempts.

Stripe requests must include the attempt scope in metadata; Mopé requests
must use the attempt ID as order_id. Neither lookup books the payment.
"""

import asyncio
from urllib.parse import quote, urlsplit

import stripe

from sms_payment_attempts import (
    PaymentAttemptConflict,
    begin_provider_request,
    finish_provider_request,
    mark_provider_uncertain,
    verify_provider_payment,
)
from sms_payment_booking import preflight_reserved_payment
from tenant_payment_guard import cancel_reserved_sms_attempt, guard_reserved_sms_attempt


async def _guarded_preflight(db, client, attempt: dict) -> dict:
    key, attempt_id = attempt["_id"], attempt["attempt_id"]
    try:
        await preflight_reserved_payment(db, client, key=key, attempt_id=attempt_id)
        await guard_reserved_sms_attempt(db, client, key=key, attempt_id=attempt_id)
    except PaymentAttemptConflict:
        await cancel_reserved_sms_attempt(db, client, key=key, attempt_id=attempt_id)
        raise
    try:
        return await preflight_reserved_payment(db, client, key=key, attempt_id=attempt_id)
    except PaymentAttemptConflict:
        await cancel_reserved_sms_attempt(db, client, key=key, attempt_id=attempt_id)
        raise


async def create_sms_stripe_intent(db, client, attempt: dict) -> dict:
    """Create one unconfirmed Stripe intent after reserving the provider request."""
    from routes import _deps
    from routes.company_stripe import _active, _cfg_doc

    collection = db.sms_payment_attempts
    stored = await _guarded_preflight(db, client, attempt)
    try:
        if stored.get("method") not in ("card", "ideal"):
            raise PaymentAttemptConflict("Geen Stripe-betaalpoging")
        await _deps.require_plan_feature(stored["company_id"], "allow_stripe", "Stripe-betalingen")
        config = _active((await _cfg_doc(stored["company_id"])).get("stripe_config") or {})
        if (not config["enabled"] or config["mode"] != stored["stripe_mode"]
                or stored["method"] not in config["methods"]):
            raise PaymentAttemptConflict("Deze Stripe-betaalmethode is niet ingeschakeld")
        if not await begin_provider_request(collection, stored):
            raise PaymentAttemptConflict("Betaalpoging is al gestart")
    except Exception:
        await cancel_reserved_sms_attempt(db, client, key=stored["_id"], attempt_id=stored["attempt_id"])
        raise
    try:
        intent = await asyncio.to_thread(
            stripe.PaymentIntent.create,
            api_key=config["secret_key"],
            idempotency_key=stored["attempt_id"],
            amount=stored["provider_amount_cents"], currency="eur",
            payment_method_types=[stored["method"]],
            metadata={
                "source": "surirent_sms_payment", "attempt_id": stored["attempt_id"],
                "company_id": stored["company_id"], "tenant_id": stored["tenant_id"],
            },
        )
    except stripe.error.StripeError as exc:
        await mark_provider_uncertain(collection, stored)
        raise PaymentAttemptConflict("Stripe-verzoek is niet bevestigd; controleer de status") from exc
    if (not intent.get("id") or not intent.get("client_secret")
            or intent.get("amount") != stored["provider_amount_cents"]
            or intent.get("currency") != "eur"
            or intent.get("livemode") is not (stored["stripe_mode"] == "live")):
        await mark_provider_uncertain(collection, stored)
        raise PaymentAttemptConflict("Stripe gaf geen geldig betaalverzoek terug")
    await finish_provider_request(collection, stored, intent["id"])
    return {
        "payment_intent_id": intent["id"], "client_secret": intent["client_secret"],
        "publishable_key": config["publishable_key"],
    }


async def create_sms_mope_request(db, client, attempt: dict) -> dict:
    """Create one Mopé request; a failed or ambiguous response is not retried."""
    from routes import _deps
    from routes.company_mope import _active, _config, _provider_error, _request_api, _response_payload

    collection = db.sms_payment_attempts
    stored = await _guarded_preflight(db, client, attempt)
    try:
        if stored.get("method") != "mope":
            raise PaymentAttemptConflict("Geen Mopé-betaalpoging")
        await _deps.require_plan_feature(stored["company_id"], "allow_mope", "Mopé-betalingen")
        config = await _config(stored["company_id"])
        if not _active(config):
            raise PaymentAttemptConflict("Mopé is niet ingeschakeld")
        redirect_url = _deps.public_url("/")
        try:
            redirect = urlsplit(redirect_url)
            _ = redirect.port
        except ValueError as exc:
            raise PaymentAttemptConflict("Publieke app-URL voor Mopé is ongeldig") from exc
        if (redirect.scheme != "https" or not redirect.hostname or redirect.username or redirect.password
                or redirect.path != "/" or redirect.query or redirect.fragment):
            raise PaymentAttemptConflict("Publieke HTTPS-app-URL voor Mopé ontbreekt")
        if not await begin_provider_request(collection, stored):
            raise PaymentAttemptConflict("Betaalpoging is al gestart")
    except Exception:
        await cancel_reserved_sms_attempt(db, client, key=stored["_id"], attempt_id=stored["attempt_id"])
        raise
    try:
        response = await _request_api("POST", "shop/payment_request", config["api_token"], {
            "amount": stored["provider_amount_cents"], "currency": stored["provider_currency"],
            "order_id": stored["attempt_id"], "description": "SuriRent huurbetaling",
            "redirect_url": redirect_url,
        })
        if not response.is_success:
            raise _provider_error(response)
        result = _response_payload(response)
        provider_id, payment_url = result.get("id"), result.get("url")
        try:
            parsed = urlsplit(payment_url) if isinstance(payment_url, str) else None
            hostname = parsed.hostname if parsed else None
            if parsed:
                _ = parsed.port
        except ValueError:
            parsed, hostname = None, None
        if (not isinstance(provider_id, str) or not provider_id
                or not parsed or parsed.scheme != "https" or parsed.username or parsed.password
                or not (hostname == "mope.sr" or (hostname or "").endswith(".mope.sr"))):
            raise PaymentAttemptConflict("Mopé gaf geen geldig betaalverzoek terug")
    except Exception:
        await mark_provider_uncertain(collection, stored)
        raise
    await finish_provider_request(collection, stored, provider_id)
    return {"payment_id": provider_id, "payment_url": payment_url}


async def _stripe_proof(attempt: dict) -> dict:
    from routes.company_stripe import _cfg_doc

    mode = attempt.get("stripe_mode")
    if mode not in ("test", "live"):
        raise PaymentAttemptConflict("Stripe-modus ontbreekt")
    config = (await _cfg_doc(attempt["company_id"])).get("stripe_config") or {}
    secret = (config.get(mode) or {}).get("secret_key")
    if not secret:
        raise PaymentAttemptConflict("Stripe-sleutel voor deze betaling ontbreekt")
    try:
        intent = await asyncio.to_thread(
            stripe.PaymentIntent.retrieve, attempt["provider_id"], api_key=secret,
        )
    except stripe.error.StripeError as exc:
        raise PaymentAttemptConflict("Stripe-betalingsstatus kon niet worden gecontroleerd") from exc

    metadata = intent.get("metadata") or {}
    if (intent.get("id") != attempt["provider_id"]
            or intent.get("livemode") is not (mode == "live")
            or metadata.get("source") != "surirent_sms_payment"
            or metadata.get("attempt_id") != attempt["attempt_id"]
            or metadata.get("company_id") != attempt["company_id"]
            or metadata.get("tenant_id") != attempt["tenant_id"]
            or attempt["method"] not in (intent.get("payment_method_types") or [])):
        raise PaymentAttemptConflict("Stripe-betaling hoort niet bij deze betaalpoging")
    paid = intent.get("status") == "succeeded"
    if paid and (type(intent.get("amount_received")) is not int
                 or intent.get("amount_received") != intent.get("amount")):
        raise PaymentAttemptConflict("Ontvangen Stripe-bedrag komt niet overeen")
    return {
        "provider_id": intent.get("id"),
        "status": "paid" if paid else "pending",
        "amount_cents": intent.get("amount"),
        "currency": (intent.get("currency") or "").upper(),
    }


async def _mope_proof(attempt: dict) -> dict:
    from routes.company_mope import _config, _provider_error, _request_api, _response_payload

    config = await _config(attempt["company_id"])
    token = config.get("api_token")
    if not token:
        raise PaymentAttemptConflict("Mopé-token voor deze betaling ontbreekt")
    response = await _request_api(
        "GET", f"shop/payment_request/{quote(attempt['provider_id'], safe='')}", token,
    )
    if not response.is_success:
        raise _provider_error(response)
    payment = _response_payload(response)
    metadata = payment.get("meta_data")
    order_ids = [entry.get("value") for entry in metadata if isinstance(entry, dict)
                 and entry.get("key") == "order_id"] if isinstance(metadata, list) else []
    if payment.get("id") != attempt["provider_id"] or order_ids != [attempt["attempt_id"]]:
        raise PaymentAttemptConflict("Mopé-betaling hoort niet bij deze betaalpoging")
    currency = payment.get("currency")
    return {
        "provider_id": payment.get("id"),
        "status": "paid" if payment.get("status") == "paid" else "pending",
        "amount_cents": payment.get("amount"),
        "currency": currency.get("code") if isinstance(currency, dict) else None,
    }


async def verify_sms_provider_payment(collection, attempt_id: str, key: str) -> dict:
    async def verify(attempt: dict) -> dict:
        if attempt.get("method") in ("card", "ideal"):
            return await _stripe_proof(attempt)
        if attempt.get("method") == "mope":
            return await _mope_proof(attempt)
        raise PaymentAttemptConflict("Onbekende betaalmethode")

    return await verify_provider_payment(collection, attempt_id, key, verify)
