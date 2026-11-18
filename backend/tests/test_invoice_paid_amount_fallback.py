from invoice_payments import invoice_fine_amount, paid_amounts_by_invoice, payment_invoice_ids, with_invoice_fine_label


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


def test_receipt_fines_exclude_later_charges_and_include_amount_with_currency():
    invoice = {"charges": [
        {"kind": "boete", "amount": 1250.5, "created_at": "2026-11-18T12:00:00+00:00"},
        {"kind": "boete", "amount": 200, "created_at": "2026-11-19T12:00:00Z"},
        {"kind": "servicekosten", "amount": 100},
    ]}
    assert invoice_fine_amount(invoice) == 1450.5
    amount = invoice_fine_amount(invoice, as_of="2026-11-18T10:00:00-03:00")
    assert with_invoice_fine_label("Huur", {"invoice_fine_amount": amount, "currency": "USD"}) == (
        "Huur · Factuurboete: USD 1.250,50"
    )
    assert with_invoice_fine_label("Huur", {"invoice_fine_amount": 0}) == "Huur"


def test_receipt_fines_use_actual_allocations_and_unambiguous_legacy_links():
    assert payment_invoice_ids({
        "invoice_ids": ["a", "b", "c"],
        "allocations": [{"invoice_id": "a", "amount": 50}, {"invoice_id": "b", "amount": 0}],
    }) == {"a"}
    assert payment_invoice_ids({"invoice_id": "a", "invoice_ids": ["a"]}) == {"a"}
    assert not payment_invoice_ids({"invoice_id": "a", "invoice_ids": ["a", "b"]})
