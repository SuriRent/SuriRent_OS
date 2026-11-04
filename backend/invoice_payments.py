import logging


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
