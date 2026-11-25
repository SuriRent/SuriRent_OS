"""Short-lived, payment-only grants for SMS reminders."""

import hashlib
import math
import re
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("ascii")).hexdigest()


async def create_payment_link(collection, origin: str, company_id: str, tenant_id: str,
                              invoice_ids: list[str], installments: list[dict],
                              *, now: datetime | None = None) -> str:
    try:
        parsed = urlsplit(origin)
        port = parsed.port
    except ValueError as exc:
        raise ValueError("Ongeldige publieke app-URL") from exc
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
            or parsed.path not in ("", "/") or parsed.query or parsed.fragment
            or not re.fullmatch(r"[A-Za-z0-9.-]+", parsed.hostname)):
        raise ValueError("Een publieke HTTPS-apporigin is vereist")
    if not company_id or not tenant_id or not (invoice_ids or installments):
        raise ValueError("Bedrijf, huurder en ten minste een openstaande post zijn vereist")
    if any(not isinstance(item, str) or not item for item in invoice_ids):
        raise ValueError("Ongeldige factuur")
    if any(not isinstance(item, dict) or not isinstance(item.get("plan_id"), str)
           or not item["plan_id"] or not isinstance(item.get("sequence"), int)
           or isinstance(item["sequence"], bool) or item["sequence"] < 1 for item in installments):
        raise ValueError("Ongeldige regelingstermijn")
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        raise ValueError("De aanmaaktijd moet een tijdzone bevatten")
    token = secrets.token_urlsafe(16)
    await collection.insert_one({
        "_id": _token_hash(token),
        "company_id": company_id,
        "tenant_id": tenant_id,
        "invoice_ids": list(dict.fromkeys(invoice_ids)),
        "installments": [{"plan_id": item["plan_id"], "sequence": item["sequence"]} for item in installments],
        "created_at": now,
        "expires_at": now + timedelta(days=30),
    })
    host = parsed.hostname
    if port:
        host += f":{port}"
    return f"https://{host}/b/{token}"


async def get_payment_grant(collection, token: str, *, now: datetime | None = None) -> dict | None:
    if not re.fullmatch(r"[A-Za-z0-9_-]{22}", token or ""):
        return None
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        raise ValueError("De controletijd moet een tijdzone bevatten")
    return await collection.find_one(
        {"_id": _token_hash(token), "expires_at": {"$gt": now}},
        {"_id": 0},
    )


def payment_items(grant: dict, invoices: list[dict], plans: list[dict]) -> list[dict]:
    """Return only the still-open posts named by the grant."""
    invoice_ids = set(grant["invoice_ids"])
    installment_ids = {(item["plan_id"], item["sequence"]) for item in grant["installments"]}
    items = []
    for invoice in invoices:
        if (invoice.get("id") not in invoice_ids or invoice.get("company_id") != grant["company_id"]
                or invoice.get("tenant_id") != grant["tenant_id"]
                or invoice.get("archived") is True
                or invoice.get("status") in ("paid", "cancelled", "archived")):
            continue
        remaining = invoice.get("remaining_amount")
        if not isinstance(remaining, (int, float)) or isinstance(remaining, bool) or not math.isfinite(remaining):
            raise ValueError("Factuursaldo ontbreekt")
        if remaining > 0:
            items.append({
                "kind": "invoice", "id": invoice["id"], "reference": invoice.get("invoice_number") or "",
                "amount": remaining, "currency": invoice.get("currency") or "SRD",
                "due_date": invoice.get("due_date"),
            })
    for plan in plans:
        if plan.get("status") != "active" or plan.get("tenant_id") != grant["tenant_id"]:
            continue
        remaining = plan.get("remaining_amount")
        if not isinstance(remaining, (int, float)) or isinstance(remaining, bool) or not math.isfinite(remaining):
            raise ValueError("Regelingssaldo ontbreekt")
        for installment in plan.get("installments") or []:
            if ((plan["id"], installment.get("sequence")) not in installment_ids
                    or installment.get("status") != "pending"):
                continue
            amount = installment.get("amount")
            if not isinstance(amount, (int, float)) or isinstance(amount, bool) or not math.isfinite(amount):
                raise ValueError("Termijnbedrag ontbreekt")
            amount = round(min(amount, remaining), 2)
            if amount > 0:
                items.append({
                    "kind": "installment", "plan_id": plan["id"], "sequence": installment["sequence"],
                    "amount": amount, "currency": plan.get("currency") or "SRD",
                    "due_date": installment.get("due_date"),
                })
    return items
