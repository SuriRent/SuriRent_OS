from io import BytesIO

from pypdf import PdfReader

from pdf_gen import invoice_bon_pdf


def test_invoice_pdf_uses_thermal_bon_layout_and_shows_balance():
    pdf_bytes = invoice_bon_pdf(
        {
            "invoice_number": "F2026-00123",
            "company_name": "SuriRent",
            "company_address": "Paramaribo",
            "invoice_date": "2026-11-01",
            "due_date": "2026-11-15",
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

    reader = PdfReader(BytesIO(pdf_bytes))
    page = reader.pages[0]
    text = page.extract_text()
    expected_width = 58 * 72 / 25.4

    assert abs(float(page.mediabox.width) - expected_width) < 0.1
    assert "HUURFACTUUR" in text
    assert "F2026-00123" in text
    assert "Huurder" in text
    assert "Reeds betaald: SRD 250,00" in text
    assert "Nog te betalen: SRD 750,00" in text
