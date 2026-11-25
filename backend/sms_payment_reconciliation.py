"""Resume an SMS payment without trusting the browser or a provider redirect.

The background worker runs only when checkout is enabled. Public callers must
authorize access to the exact attempt before calling this module.
"""

import asyncio
import logging

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


async def reconcile_sms_payment_batch(db, client, *, after_key: str | None = None, limit: int = 100) -> dict:
    """Scan a bounded page so unresolved attempts cannot starve later ones."""
    if type(limit) is not int or not 1 <= limit <= 1000:
        raise ValueError("Ongeldige batchgrootte")
    query = {"state": {"$in": ["open", "verified", "booked"]}}
    if after_key is not None:
        query["_id"] = {"$gt": after_key}
    attempts = await db.sms_payment_attempts.find(
        query, {"_id": 1, "attempt_id": 1},
    ).sort("_id", 1).limit(limit).to_list(limit)
    completed = 0
    for attempt in attempts:
        key, attempt_id = attempt["_id"], attempt.get("attempt_id")
        try:
            await reconcile_sms_payment(db, client, key=key, attempt_id=attempt_id)
            completed += 1
        except PaymentAttemptConflict as exc:
            logging.getLogger(__name__).warning("SMS payment %s needs review or is pending: %s", attempt_id, exc)
        except Exception:
            logging.getLogger(__name__).exception("SMS payment %s reconciliation failed", attempt_id)
    return {
        "scanned": len(attempts), "completed": completed,
        "next_key": attempts[-1]["_id"] if len(attempts) == limit else None,
    }


async def sms_payment_reconciliation_loop(db, client) -> None:
    cursor = None
    while True:
        try:
            result = await reconcile_sms_payment_batch(db, client, after_key=cursor)
            cursor = result["next_key"]
        except Exception:
            logging.getLogger(__name__).exception("SMS payment reconciliation scan failed")
        await asyncio.sleep(30)
