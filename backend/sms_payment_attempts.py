"""Durable, fail-closed reservations for SMS payment attempts.

An attempt must be reserved before contacting a provider. Checkout remains
disabled until verified payments can be booked reliably.
"""

import hashlib
import json
import secrets
from datetime import datetime, timezone

from pymongo.errors import DuplicateKeyError


class PaymentAttemptConflict(Exception):
    pass


def tenant_payment_key(company_id: str, tenant_id: str) -> str:
    if not isinstance(company_id, str) or not company_id or not isinstance(tenant_id, str) or not tenant_id:
        raise ValueError("Bedrijf en huurder zijn vereist")
    value = json.dumps([company_id, tenant_id], ensure_ascii=True, separators=(",", ":"))
    return hashlib.sha256(value.encode("ascii")).hexdigest()


def _tenant_key(company_id: str, tenant_id: str, item: dict) -> str:
    key = tenant_payment_key(company_id, tenant_id)
    if not isinstance(item, dict):
        raise ValueError("Ongeldige betaalpost")
    if item.get("kind") == "invoice" and set(item) == {"kind", "id"}:
        if not isinstance(item["id"], str) or not item["id"]:
            raise ValueError("Ongeldige factuur")
    elif item.get("kind") == "installment" and set(item) == {"kind", "plan_id", "sequence"}:
        if (not isinstance(item["plan_id"], str) or not item["plan_id"]
                or not isinstance(item["sequence"], int) or isinstance(item["sequence"], bool)
                or item["sequence"] < 1):
            raise ValueError("Ongeldige termijn")
    else:
        raise ValueError("Ongeldige betaalpost")
    return key


async def reserve_attempt(collection, *, company_id: str, tenant_id: str, item: dict,
                          method: str, amount_cents: int, currency: str,
                          provider_amount_cents: int, provider_currency: str,
                          stripe_mode: str | None = None) -> dict:
    """Reserve one tenant's post across links and payment methods.

    An existing reservation is returned only when the complete amount and
    method match. A tenant-wide reservation also prevents simultaneous
    attempts for an invoice and a linked installment. Ambiguous attempts
    are not automatically released or replaced.
    """
    key = _tenant_key(company_id, tenant_id, item)
    if method not in ("card", "ideal", "mope"):
        raise ValueError("Ongeldige betaalmethode")
    if not isinstance(amount_cents, int) or isinstance(amount_cents, bool) or amount_cents <= 0:
        raise ValueError("Ongeldig bedrag")
    if currency not in ("SRD", "USD", "EUR"):
        raise ValueError("Ongeldige valuta")
    if (not isinstance(provider_amount_cents, int) or isinstance(provider_amount_cents, bool)
            or provider_amount_cents <= 0):
        raise ValueError("Ongeldig providerbedrag")
    if method == "mope":
        if provider_currency != currency or provider_amount_cents != amount_cents:
            raise ValueError("Mopé-bedrag of valuta wijkt af")
    elif provider_currency != "EUR":
        raise ValueError("Stripe-betalingen moeten in euro zijn")
    if (method == "mope" and stripe_mode is not None
            or method != "mope" and stripe_mode not in ("test", "live")):
        raise ValueError("Ongeldige Stripe-modus")
    doc = {
        "_id": key, "attempt_id": secrets.token_urlsafe(24),
        "company_id": company_id, "tenant_id": tenant_id, "item": dict(item),
        "method": method, "amount_cents": amount_cents, "currency": currency,
        "provider_amount_cents": provider_amount_cents, "provider_currency": provider_currency,
        "stripe_mode": stripe_mode,
        "state": "reserved", "created_at": datetime.now(timezone.utc),
    }
    try:
        await collection.insert_one(doc)
        return doc
    except DuplicateKeyError:
        existing = await collection.find_one({"_id": key})
        if (not existing or existing.get("company_id") != company_id
                or existing.get("tenant_id") != tenant_id or existing.get("item") != item
                or existing.get("method") != method or existing.get("amount_cents") != amount_cents
                or existing.get("currency") != currency or existing.get("stripe_mode") != stripe_mode
                or existing.get("provider_amount_cents") != provider_amount_cents
                or existing.get("provider_currency") != provider_currency):
            raise PaymentAttemptConflict("Voor deze post bestaat al een andere betaalpoging")
        return existing


async def begin_provider_request(collection, attempt: dict) -> bool:
    """Allow only the winner of the atomic transition to call the provider."""
    if attempt.get("guard_owner") != attempt.get("attempt_id") or not attempt.get("attempt_id"):
        return False
    snapshot = {name: attempt.get(name) for name in (
        "company_id", "tenant_id", "item", "method", "amount_cents", "currency",
        "provider_amount_cents", "provider_currency", "stripe_mode", "guard_owner",
    )}
    result = await collection.update_one(
        {"_id": attempt["_id"], "attempt_id": attempt["attempt_id"], "state": "reserved", **snapshot},
        {"$set": {"state": "creating", "updated_at": datetime.now(timezone.utc)}},
    )
    return result.modified_count == 1


async def finish_provider_request(collection, attempt: dict, provider_id: str) -> None:
    if not isinstance(provider_id, str) or not provider_id.strip():
        raise ValueError("Providerreferentie ontbreekt")
    stored = await collection.find_one({"_id": attempt["_id"], "attempt_id": attempt["attempt_id"]})
    if not stored or stored.get("attempt_id") != attempt["attempt_id"] or stored.get("state") != "creating":
        raise PaymentAttemptConflict("De betaalpoging is intussen gewijzigd")
    result = await collection.update_one(
        {"_id": attempt["_id"], "attempt_id": attempt["attempt_id"], "state": "creating"},
        {"$set": {
            "state": "open", "provider_id": provider_id, "updated_at": datetime.now(timezone.utc),
        }},
    )
    if result.modified_count != 1:
        raise PaymentAttemptConflict("De betaalpoging is intussen gewijzigd")


async def mark_provider_uncertain(collection, attempt: dict) -> None:
    result = await collection.update_one(
        {"_id": attempt["_id"], "attempt_id": attempt["attempt_id"], "state": "creating"},
        {"$set": {"state": "uncertain", "updated_at": datetime.now(timezone.utc)}},
    )
    if result.modified_count != 1:
        raise PaymentAttemptConflict("De betaalpoging is intussen gewijzigd")


async def verify_provider_payment(collection, attempt_id: str, key: str, verify) -> dict:
    """Persist proof only after a trusted provider lookup confirms this exact request."""
    attempt = await collection.find_one({"_id": key, "attempt_id": attempt_id})
    if not attempt or attempt.get("attempt_id") != attempt_id:
        raise PaymentAttemptConflict("Betaalpoging niet gevonden")
    if attempt.get("state") == "verified":
        return attempt
    if attempt.get("state") != "open":
        raise PaymentAttemptConflict("Betaalpoging kan niet worden gecontroleerd")
    result = await verify(attempt)
    if (not isinstance(result, dict) or result.get("status") != "paid"
            or result.get("provider_id") != attempt["provider_id"]
            or type(result.get("amount_cents")) is not int
            or result.get("amount_cents") != attempt["provider_amount_cents"]
            or result.get("currency") != attempt["provider_currency"]):
        raise PaymentAttemptConflict("Providerbetaling is niet bevestigd of komt niet overeen")
    verified_at = datetime.now(timezone.utc)
    updated = await collection.update_one(
        {"_id": key, "attempt_id": attempt_id, "state": "open", "provider_id": attempt["provider_id"]},
        {"$set": {"state": "verified", "verified_at": verified_at}},
    )
    if updated.modified_count != 1:
        attempt = await collection.find_one({"_id": key, "attempt_id": attempt_id})
        if not attempt or attempt.get("attempt_id") != attempt_id or attempt.get("state") != "verified":
            raise PaymentAttemptConflict("De betaalpoging is intussen gewijzigd")
        return attempt
    attempt["state"] = "verified"
    attempt["verified_at"] = verified_at
    return attempt
