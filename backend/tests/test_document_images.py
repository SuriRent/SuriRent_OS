from document_images import pdf_first_page_jpeg
from pdf_gen import invoice_bon_pdf


def test_invoice_bon_pdf_renders_to_jpeg():
    pdf_bytes = invoice_bon_pdf(
        {
            "invoice_number": "F2026-00123",
            "period_month": 11,
            "period_year": 2026,
            "amount": 1000,
            "paid_amount": 250,
            "currency": "SRD",
        },
        {"name": "Huurder"},
        {"number": "A1"},
        [],
    )

    jpg_bytes = pdf_first_page_jpeg(pdf_bytes)

    assert jpg_bytes.startswith(b"\xff\xd8\xff")
