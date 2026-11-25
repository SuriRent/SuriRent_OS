"""Resume an SMS payment without trusting the browser or a provider redirect.

Not exposed as an endpoint or scheduled while checkout remains disabled.
Callers must authorize access to the exact attempt before calling this module.
"""

from sms_payment_attempts import PaymentAttemptConflict
from sms_payment_booking import book_verified_payment, release_booked_attempt
from sms_payment_providers import verify_sms_provider_payment


async def reconcile_sms_payment(db, client, *, key: str, attempt_id: str) -> dict:
    """Verify, book and archive one attempt; retries never create a second payment."""
    collection = db.sms_payment_attempts
    attempt = await collection.find_one({"_id": key, "attempt_id": attempt_id})
    if attempt and attempt.get("state") == "open":
        try:
            await verify_sms_provider_payment(collection, attempt_id, key)
        except PaymentAttemptConflict:
            current = await collection.find_one({"_id": key, "attempt_id": attempt_id})
            if current and current.get("state") not in ("verified", "booked"):
                raise
            if not current:
                archived = await db.sms_payment_attempt_history.find_one(
                    {"_id": attempt_id, "reservation_key": key},
                )
                if not archived or archived.get("state") != "booked":
                    raise
    elif attempt and attempt.get("state") not in ("verified", "booked"):
        raise PaymentAttemptConflict("Betaalpoging kan niet automatisch worden hersteld")

    payment = await book_verified_payment(db, client, key=key, attempt_id=attempt_id)
    await release_booked_attempt(db, client, key=key, attempt_id=attempt_id)
    return payment
