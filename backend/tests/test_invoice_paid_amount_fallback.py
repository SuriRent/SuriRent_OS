from invoice_payments import paid_amounts_by_invoice


def test_legacy_paid_amount_uses_allocated_shares_and_single_invoice_links():
    payments = [
        {
            "invoice_id": "invoice-a",
            "amount": 1000,
            "allocations": [
                {"invoice_id": "invoice-a", "amount": 600},
                {"invoice_id": "invoice-b", "amount": 400},
            ],
        },
        {"invoice_id": "invoice-a", "amount": 250},
        {"invoice_ids": ["invoice-b"], "amount": 75},
    ]

    assert paid_amounts_by_invoice(["invoice-a", "invoice-b"], payments) == {
        "invoice-a": 850.0,
        "invoice-b": 475.0,
    }


def test_legacy_multi_invoice_payment_without_allocations_is_not_duplicated():
    payments = [{"invoice_ids": ["invoice-a", "invoice-b"], "amount": 1000}]

    assert paid_amounts_by_invoice(["invoice-a", "invoice-b"], payments) == {
        "invoice-a": 0.0,
        "invoice-b": 0.0,
    }
