import logging
import math
from datetime import datetime, timezone


def _utc_datetime(value):
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def invoice_fine_amount(invoice, *, as_of=None):
    cutoff = _utc_datetime(as_of)
    total = 0.0
    for charge in invoice.get("charges") or []:
        if charge.get("kind") != "boete":
            continue
        if as_of is not None:
            issued = _utc_datetime(charge.get("created_at"))
            if not (issued and cutoff and issued <= cutoff):
                continue
        total += _positive_amount(charge.get("amount"))
    return round(total, 2)


def _positive_amount(value):
    try:
        amount = float(value or 0)
    except (TypeError, ValueError):
        return 0
    return amount if math.isfinite(amount) and amount > 0 else 0


def payment_invoice_ids(payment):
    if payment.get("allocations"):
        return {
            entry["invoice_id"] for entry in payment["allocations"]
            if entry.get("invoice_id") and _positive_amount(entry.get("amount"))
        }
    ids = set(payment.get("invoice_ids") or [])
    if payment.get("invoice_id"):
        ids.add(payment["invoice_id"])
    return ids if len(ids) == 1 else set()


def with_invoice_fine_label(description, payment):
    amount = payment.get("invoice_fine_amount") or 0
    if amount <= 0:
        return description
    formatted = f"{amount:,.2f}".translate(str.maketrans(",.", ".,"))
    prefix = f"{description} · " if description else ""
    return f"{prefix}Factuurboete: {payment.get('currency') or 'SRD'} {formatted}"


def paid_amounts_by_invoice(invoice_ids: list, payments: list) -> dict:
    """Calculate legacy paid amounts without double-counting multi-invoice payments."""
    paid = {invoice_id: 0.0 for invoice_id in invoice_ids}
    for payment in payments:
        allocations = payment.get("allocations") or []
        if allocations:
            for allocation in allocations:
                invoice_id = allocation.get("invoice_id")
                if invoice_id not in paid:
                    continue
                try:
                    paid[invoice_id] += float(allocation.get("amount") or 0)
                except (TypeError, ValueError):
                    logging.getLogger("uvicorn.error").warning(
                        "Invalid payment allocation amount for invoice id=%s", invoice_id,
                    )
            continue

        linked_ids = set(payment.get("invoice_ids") or [])
        if payment.get("invoice_id"):
            linked_ids.add(payment["invoice_id"])
        if len(linked_ids) != 1:
            if linked_ids:
                logging.getLogger("uvicorn.error").warning(
                    "Legacy payment with multiple invoices has no allocations; "
                    "paid totals cannot be assigned reliably",
                )
            continue
        invoice_id = next(iter(linked_ids))
        if invoice_id not in paid:
            continue
        try:
            paid[invoice_id] += float(payment.get("amount") or 0)
        except (TypeError, ValueError):
            logging.getLogger("uvicorn.error").warning(
                "Invalid legacy payment amount for invoice id=%s", invoice_id,
            )
    return {invoice_id: round(amount + 1e-9, 2) for invoice_id, amount in paid.items()}
