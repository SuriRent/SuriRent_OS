"""Fail-closed tenant payment coordination.

Guards do not expire automatically: an interrupted operation may have already
changed financial data. SMS guards must only be released in the same
transaction that establishes a booked or definitively cancelled attempt.
"""

import secrets
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from pymongo.errors import DuplicateKeyError
from pymongo.read_concern import ReadConcern
from pymongo.write_concern import WriteConcern
from fastapi import HTTPException

from sms_payment_attempts import PaymentAttemptConflict, _tenant_key, tenant_payment_key


def _collection(db, session):
    collection = db.tenant_payment_guards
    if session is not None:
        if not session.in_transaction:
            raise ValueError("Betaalvergrendeling vereist een actieve transactie")
        return collection
    return collection.with_options(write_concern=WriteConcern("majority"))


async def acquire_payment_guard(db, *, company_id: str, tenant_id: str,
                                kind: str, owner: str, session=None,
                                operation: str | None = None, operation_id: str | None = None,
                                provider: str | None = None, provider_reference: str | None = None) -> dict:
    if kind not in ("legacy", "sms") or not isinstance(owner, str) or not owner:
        raise ValueError("Ongeldige betaalvergrendeling")
    if (operation is None) != (operation_id is None) or (
        operation is not None and (
            kind != "legacy" or not isinstance(operation, str) or not operation
            or not isinstance(operation_id, str) or not operation_id
        )
    ):
        raise ValueError("Ongeldige betaaloperatie")
    if (provider is None) != (provider_reference is None) or (
        provider is not None and (
            kind != "legacy" or operation is None or provider not in ("stripe", "mope")
            or not isinstance(provider_reference, str) or not provider_reference
        )
    ):
        raise ValueError("Ongeldige providerreferentie")
    key = tenant_payment_key(company_id, tenant_id)
    collection = _collection(db, session)
    guard = {"_id": key, "company_id": company_id, "tenant_id": tenant_id,
             "kind": kind, "owner": owner, "created_at": datetime.now(timezone.utc)}
    if operation is not None:
        guard.update({"operation": operation, "operation_id": operation_id})
    if provider is not None:
        guard.update({"provider": provider, "provider_reference": provider_reference})
    try:
        await collection.insert_one(guard, session=session)
    except DuplicateKeyError as exc:
        raise PaymentAttemptConflict("Een andere betaling voor deze huurder wordt verwerkt") from exc
    return guard


async def release_payment_guard(db, *, company_id: str, tenant_id: str,
                                kind: str, owner: str, session=None) -> None:
    if kind not in ("legacy", "sms") or not isinstance(owner, str) or not owner:
        raise ValueError("Ongeldige betaalvergrendeling")
    if kind == "sms" and (session is None or not session.in_transaction):
        raise ValueError("Een sms-vergrendeling vereist een transactie")
    key = tenant_payment_key(company_id, tenant_id)
    result = await _collection(db, session).delete_one(
        {"_id": key, "company_id": company_id, "tenant_id": tenant_id, "kind": kind, "owner": owner},
        session=session,
    )
    if result.deleted_count != 1:
        raise PaymentAttemptConflict("Betaalvergrendeling ontbreekt of is gewijzigd")


async def guarded_provider_request(db, *, company_id: str, tenant_id: str,
                                   operation_id: str, provider: str, create):
    if provider not in ("stripe", "mope"):
        raise ValueError("Ongeldige betaalprovider")
    owner = secrets.token_urlsafe(24)
    try:
        await acquire_payment_guard(
            db, company_id=company_id, tenant_id=tenant_id, kind="legacy", owner=owner,
            operation=f"{provider}_request", operation_id=operation_id,
        )
    except PaymentAttemptConflict as exc:
        raise HTTPException(status_code=409, detail="Een andere betaling voor deze huurder wordt verwerkt.") from exc
    try:
        result = await create()
        await release_payment_guard(db, company_id=company_id, tenant_id=tenant_id, kind="legacy", owner=owner)
        return result
    except Exception as exc:
        logging.getLogger(__name__).exception("Provider request requires review: %s", operation_id)
        raise HTTPException(
            status_code=500,
            detail="Het betaalverzoek is mogelijk aangemaakt. Controleer dit voordat u opnieuw probeert.",
        ) from exc


async def guarded_credit_change(db, *, company_id: str, tenant_id: str, operation_id: str, change):
    owner = secrets.token_urlsafe(24)
    try:
        await acquire_payment_guard(
            db, company_id=company_id, tenant_id=tenant_id, kind="legacy", owner=owner,
            operation="credit_reconciliation", operation_id=operation_id,
        )
    except PaymentAttemptConflict as exc:
        raise HTTPException(status_code=409, detail="Een andere betaling voor deze huurder wordt verwerkt.") from exc
    try:
        result = await change()
        await release_payment_guard(db, company_id=company_id, tenant_id=tenant_id, kind="legacy", owner=owner)
    except Exception as exc:
        logging.getLogger(__name__).exception("Credit change requires review: %s", operation_id)
        raise HTTPException(
            status_code=500, detail="Het tegoed is mogelijk gedeeltelijk verrekend. Controleer dit voordat u opnieuw probeert.",
        ) from exc
    if isinstance(result, HTTPException):
        raise result
    return result


async def guarded_invoice_change(db, *, company_id: str, tenant_id: str, operation_id: str, change):
    owner = secrets.token_urlsafe(24)
    try:
        await acquire_payment_guard(
            db, company_id=company_id, tenant_id=tenant_id, kind="legacy", owner=owner,
            operation="invoice_change", operation_id=operation_id,
        )
    except PaymentAttemptConflict as exc:
        raise HTTPException(status_code=409, detail="Een andere betaling voor deze huurder wordt verwerkt.") from exc
    try:
        result = await change()
        await release_payment_guard(db, company_id=company_id, tenant_id=tenant_id, kind="legacy", owner=owner)
    except Exception as exc:
        logging.getLogger(__name__).exception("Invoice change requires review: %s", operation_id)
        raise HTTPException(
            status_code=500, detail="De factuur is mogelijk gewijzigd. Controleer dit voordat u opnieuw probeert.",
        ) from exc
    if isinstance(result, HTTPException):
        raise result
    return result


async def guarded_tenant_move_out(db, *, company_id: str, tenant_id: str, change):
    owner = secrets.token_urlsafe(24)
    try:
        await acquire_payment_guard(
            db, company_id=company_id, tenant_id=tenant_id, kind="legacy", owner=owner,
            operation="tenant_move_out", operation_id=tenant_id,
        )
    except PaymentAttemptConflict as exc:
        raise HTTPException(status_code=409, detail="Een andere betaling voor deze huurder wordt verwerkt.") from exc
    try:
        result = await change()
        await release_payment_guard(db, company_id=company_id, tenant_id=tenant_id, kind="legacy", owner=owner)
    except Exception as exc:
        logging.getLogger(__name__).exception("Tenant move-out requires review: %s", tenant_id)
        raise HTTPException(
            status_code=500, detail="Het vertrek is mogelijk gedeeltelijk verwerkt. Controleer dit voordat u opnieuw probeert.",
        ) from exc
    if isinstance(result, HTTPException):
        raise result
    return result


async def guard_reserved_sms_attempt(db, client, *, key: str, attempt_id: str) -> None:
    """Atomically guard a reserved attempt before a provider can be contacted."""
    async def transaction(session):
        attempt = await db.sms_payment_attempts.find_one(
            {"_id": key, "attempt_id": attempt_id, "state": "reserved"}, session=session,
        )
        if not attempt:
            raise PaymentAttemptConflict("Betaalpoging kan niet worden vergrendeld")
        if attempt.get("provider_id") is not None:
            raise PaymentAttemptConflict("Betaalpoging heeft al een providerreferentie")
        try:
            expected = _tenant_key(attempt.get("company_id"), attempt.get("tenant_id"), attempt.get("item"))
        except ValueError as exc:
            raise PaymentAttemptConflict("Ongeldige betaalpoging") from exc
        if key != expected:
            raise PaymentAttemptConflict("Betaalpoging heeft een ongeldige scope")
        scope = {"company_id": attempt["company_id"], "tenant_id": attempt["tenant_id"]}
        owner = attempt.get("guard_owner")
        if owner is None:
            await acquire_payment_guard(db, **scope, kind="sms", owner=attempt_id, session=session)
        elif owner == attempt_id:
            guard = await db.tenant_payment_guards.find_one(
                {"_id": key, **scope, "kind": "sms", "owner": attempt_id}, session=session,
            )
            if not guard:
                raise PaymentAttemptConflict("Betaalvergrendeling ontbreekt")
        else:
            raise PaymentAttemptConflict("Betaalvergrendeling hoort niet bij deze poging")
        updated = await db.sms_payment_attempts.update_one(
            {"_id": key, "attempt_id": attempt_id, "state": "reserved", "guard_owner": owner},
            {"$set": {"guard_owner": attempt_id, "guard_checked_at": datetime.now(timezone.utc)}},
            session=session,
        )
        if updated.matched_count != 1:
            raise PaymentAttemptConflict("Betaalpoging is intussen gewijzigd")

    async with await client.start_session() as session:
        await session.with_transaction(
            transaction, read_concern=ReadConcern("snapshot"), write_concern=WriteConcern("majority"),
        )


async def cancel_reserved_sms_attempt(db, client, *, key: str, attempt_id: str) -> None:
    """Cancel an unstarted attempt, releasing its guard if it has one."""
    async def transaction(session):
        attempt = await db.sms_payment_attempts.find_one(
            {"_id": key, "attempt_id": attempt_id}, session=session,
        )
        if not attempt:
            archived = await db.sms_payment_attempt_history.find_one(
                {"_id": attempt_id, "reservation_key": key, "state": "cancelled"}, session=session,
            )
            if not archived:
                raise PaymentAttemptConflict("Betaalpoging niet gevonden")
            return
        owner = attempt.get("guard_owner")
        if (attempt.get("state") != "reserved" or owner not in (None, attempt_id)
                or attempt.get("provider_id") is not None):
            raise PaymentAttemptConflict("Gestarte betaalpoging kan niet zomaar worden vrijgegeven")
        now = datetime.now(timezone.utc)
        updated = await db.sms_payment_attempts.update_one(
            {"_id": key, "attempt_id": attempt_id, "state": "reserved",
             "guard_owner": owner, "provider_id": None},
            {"$set": {"state": "cancelled", "cancelled_at": now}}, session=session,
        )
        if updated.modified_count != 1:
            raise PaymentAttemptConflict("Betaalpoging is intussen gewijzigd")
        if owner is not None:
            await release_payment_guard(
                db, company_id=attempt["company_id"], tenant_id=attempt["tenant_id"],
                kind="sms", owner=attempt_id, session=session,
            )
        archived = {**attempt, "_id": attempt_id, "reservation_key": key,
                    "state": "cancelled", "cancelled_at": now}
        await db.sms_payment_attempt_history.insert_one(archived, session=session)
        deleted = await db.sms_payment_attempts.delete_one(
            {"_id": key, "attempt_id": attempt_id, "state": "cancelled"}, session=session,
        )
        if deleted.deleted_count != 1:
            raise PaymentAttemptConflict("Betaalpoging is intussen gewijzigd")

    async with await client.start_session() as session:
        await session.with_transaction(
            transaction, read_concern=ReadConcern("snapshot"), write_concern=WriteConcern("majority"),
        )


@asynccontextmanager
async def legacy_payment_guard(db, *, company_id: str, tenant_id: str,
                               operation: str | None = None, operation_id: str | None = None):
    """Keep the guard after an error for investigation of partial writes."""
    owner = secrets.token_urlsafe(24)
    await acquire_payment_guard(
        db, company_id=company_id, tenant_id=tenant_id, kind="legacy", owner=owner,
        operation=operation, operation_id=operation_id,
    )
    yield
    await release_payment_guard(db, company_id=company_id, tenant_id=tenant_id, kind="legacy", owner=owner)
