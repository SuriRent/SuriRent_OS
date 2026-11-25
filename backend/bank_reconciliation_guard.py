"""Guarded registration of one bank statement for one tenant."""

from fastapi import HTTPException

from tenant_payment_guard import legacy_payment_guard


async def register_bank_payment(db, *, company_id, tenant_id, statement_id, body,
                                paid_at, now, new_id, create_payment):
    """Return (payment, created, rejection); retain the guard after uncertain writes."""
    async with legacy_payment_guard(
        db, company_id=company_id, tenant_id=tenant_id,
        operation="bank_reconciliation", operation_id=statement_id,
    ):
        statement = await db.bank_statements.find_one(
            {"id": statement_id, "company_id": company_id}, {"_id": 0},
        )
        if not statement:
            return None, False, HTTPException(status_code=404, detail="Bankbewijs niet gevonden")
        existing = await db.payments.find_one(
            {"bank_statement_id": statement_id, "company_id": company_id}, {"_id": 0},
        )
        if existing:
            if existing.get("tenant_id") and existing["tenant_id"] != tenant_id:
                return None, False, HTTPException(status_code=409, detail="Bankbewijs hoort bij een andere huurder.")
            if (existing.get("tenant_id") == tenant_id
                    and isinstance(existing.get("id"), str) and existing["id"]
                    and statement.get("reconciliation_status") == "registered"
                    and statement.get("payment_id") == existing.get("id")):
                return existing, False, None
            raise RuntimeError("Bestaande bankbetaling moet eerst handmatig worden gecontroleerd")
        if statement.get("reconciliation_status") != "uploaded":
            other_tenant = statement.get("registration_tenant_id")
            if other_tenant and other_tenant != tenant_id:
                return None, False, HTTPException(status_code=409, detail="Bankbewijs wordt door een andere huurder verwerkt.")
            raise RuntimeError("Bankbewijs heeft een onzekere registratiestatus")
        reference = (body.bank_reference or "").strip()
        if reference:
            duplicate = await db.payments.find_one({
                "company_id": company_id, "method": "bank", "amount": body.amount,
                "currency": body.currency, "paid_at": paid_at, "bank_reference": reference,
                "status": {"$ne": "rejected"},
            }, {"_id": 0, "receipt_number": 1})
            if duplicate:
                receipt = duplicate.get("receipt_number") or "bestaande betaling"
                return None, False, HTTPException(
                    status_code=409, detail=f"Mogelijke dubbele betaling: deze referentie staat al op {receipt}.",
                )
        attempt_id = new_id()
        claim = await db.bank_statements.update_one(
            {"id": statement_id, "company_id": company_id, "reconciliation_status": "uploaded"},
            {"$set": {"reconciliation_status": "registering", "registration_attempt_id": attempt_id,
                      "registration_tenant_id": tenant_id, "registration_started_at": now()}},
        )
        if not claim.modified_count:
            current = await db.bank_statements.find_one(
                {"id": statement_id, "company_id": company_id}, {"_id": 0},
            )
            if current and current.get("registration_tenant_id") and current["registration_tenant_id"] != tenant_id:
                return None, False, HTTPException(status_code=409, detail="Bankbewijs wordt door een andere huurder verwerkt.")
            if current and current.get("reconciliation_status") == "registered":
                registered = await db.payments.find_one(
                    {"bank_statement_id": statement_id, "company_id": company_id}, {"_id": 0},
                )
                if registered and registered.get("tenant_id") and registered["tenant_id"] != tenant_id:
                    return None, False, HTTPException(status_code=409, detail="Bankbewijs hoort bij een andere huurder.")
            raise RuntimeError("Bankbewijs is tijdens registratie gewijzigd")
        payment = await create_payment(statement, reference)
        finalized = await db.bank_statements.update_one(
            {"id": statement_id, "company_id": company_id, "registration_attempt_id": attempt_id,
             "reconciliation_status": "registering"},
            {"$set": {"reconciliation_status": "registered", "payment_id": payment["id"],
                      "registered_at": now()},
             "$unset": {"registration_attempt_id": "", "registration_tenant_id": "", "registration_started_at": ""}},
        )
        if finalized.matched_count != 1:
            raise RuntimeError("Bankbewijs kon na betaling niet worden afgerond")
        return payment, True, None
