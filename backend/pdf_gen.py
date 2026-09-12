"""PDF generation helpers using ReportLab.

Brand-styled met grijze pagina-achtergrond, prominente titel, twee-koloms
detail-blokken, groot bedrag-blok en geverifieerde footer met SHA-256 hash —
gebaseerd op de SuriRent voorbeeld-kwitantie (KW2026-00019). Alle PDFs
(kwitantie, factuur, contract, borg-restitutie, loonstrook) gebruiken
dezelfde visuele taal.
"""
import io
import hashlib
import base64
import os
from datetime import datetime
from reportlab.lib.pagesizes import A4, A6
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, Image,
)

# =====================================================================
# Font registratie — DejaVuSerif voor de luxe titel (Playfair-achtige look),
# DejaVuSans voor Unicode-symbolen (crown ♛, icons, bell etc.). Deze fonts
# staan standaard op Debian/Ubuntu via `fonts-dejavu-core`. Fallback naar
# Times/Helvetica als registratie faalt.
# =====================================================================
_LUX_SERIF = "Helvetica-Bold"
_LUX_SERIF_REG = "Helvetica"
_LUX_SANS = "Helvetica"
_LUX_SANS_BOLD = "Helvetica-Bold"
try:
    _dejavu_dir = "/usr/share/fonts/truetype/dejavu"
    if os.path.isdir(_dejavu_dir):
        pdfmetrics.registerFont(TTFont("LuxSerif", f"{_dejavu_dir}/DejaVuSerif.ttf"))
        pdfmetrics.registerFont(TTFont("LuxSerif-Bold", f"{_dejavu_dir}/DejaVuSerif-Bold.ttf"))
        pdfmetrics.registerFont(TTFont("LuxSans", f"{_dejavu_dir}/DejaVuSans.ttf"))
        pdfmetrics.registerFont(TTFont("LuxSans-Bold", f"{_dejavu_dir}/DejaVuSans-Bold.ttf"))
        _LUX_SERIF = "LuxSerif-Bold"
        _LUX_SERIF_REG = "LuxSerif"
        _LUX_SANS = "LuxSans"
        _LUX_SANS_BOLD = "LuxSans-Bold"
except Exception:  # noqa: BLE001
    pass

# Palet — bewust beperkt: zwarte tekst + lichte grijze achtergrond.
ORANGE = colors.HexColor("#FF5C00")           # Behouden voor accenten/sticky knoppen
DARK = colors.HexColor("#1a1a1a")
MUTED = colors.HexColor("#6b7280")
LIGHT = colors.HexColor("#f5f5f5")
PAGE_BG = colors.HexColor("#F8F8F8")           # Lichte grijze pagina-achtergrond
HAIRLINE = colors.HexColor("#E5E5E5")
SUCCESS = colors.HexColor("#16a34a")           # "VOLDAAN" status groen

# =====================================================================
# Luxueuze PDF template palettes — kwitantie/factuur "premium" ontwerp
# =====================================================================
# 4 kleurthema's die de tenant kan kiezen in Instellingen → Facturatie →
# PDF-sjabloon. Elk palet bevat:
#   `dark`  — hoofdkleur voor header/footer ribbons + iconen chips
#   `gold`  — accent voor bedrag-blok, onderstreping, iconen highlights
#   `soft`  — 8% dark-tint voor rij-hairlines
#   `label` — muted tekstkleur voor kv-labels
_TEMPLATES = {
    "midnight_gold": {   # Donkerblauw + goud (default — referentie ontwerp)
        "dark":  colors.HexColor("#0B1F3A"),
        "gold":  colors.HexColor("#C9A24A"),
        "soft":  colors.HexColor("#EFEBE0"),
        "label": colors.HexColor("#0B1F3A"),
    },
    "charcoal_gold": {   # Antraciet/zwart + goud
        "dark":  colors.HexColor("#0F0F10"),
        "gold":  colors.HexColor("#C9A24A"),
        "soft":  colors.HexColor("#EDECEA"),
        "label": colors.HexColor("#0F0F10"),
    },
    "forest_gold": {     # Diep groen + goud
        "dark":  colors.HexColor("#0F3B2E"),
        "gold":  colors.HexColor("#C9A24A"),
        "soft":  colors.HexColor("#E7EEE9"),
        "label": colors.HexColor("#0F3B2E"),
    },
    "sunset_gold": {     # Diep oranje/brique + goud
        "dark":  colors.HexColor("#8A2B0F"),
        "gold":  colors.HexColor("#F0B34A"),
        "soft":  colors.HexColor("#F5E7DE"),
        "label": colors.HexColor("#8A2B0F"),
    },
}
_DEFAULT_TEMPLATE = "midnight_gold"


def _palette(doc: dict) -> dict:
    """Kies palet uit doc-dict (`company_pdf_template`). Ongeldige waarden
    vallen terug op midnight_gold. Custom dark-kleur via `company_pdf_custom_
    dark` overschrijft `dark`. Legacy `company_primary_color` wordt gebruikt
    wanneer geen template gekozen is."""
    key = ((doc or {}).get("company_pdf_template") or "").strip().lower()
    palette = dict(_TEMPLATES.get(key, _TEMPLATES[_DEFAULT_TEMPLATE]))
    # Custom dark override — hoogste prioriteit
    custom_dark = ((doc or {}).get("company_pdf_custom_dark") or "").strip()
    if custom_dark and custom_dark.startswith("#") and len(custom_dark) in (4, 7):
        try:
            palette["dark"] = colors.HexColor(custom_dark)
            palette["label"] = palette["dark"]
        except Exception:
            pass
    else:
        # Legacy override: als er een primary_color is en géén template gekozen,
        # gebruik de primary als dark maar behoud goud.
        raw = (doc or {}).get("company_primary_color") or ""
        if key not in _TEMPLATES and raw and isinstance(raw, str):
            s = raw.strip().lower()
            if s.startswith("#") and len(s) in (4, 7):
                try:
                    palette["dark"] = colors.HexColor(s)
                    palette["label"] = palette["dark"]
                except Exception:
                    pass
    return palette

MONTHS_NL = ["januari", "februari", "maart", "april", "mei", "juni",
             "juli", "augustus", "september", "oktober", "november", "december"]


# =====================================================================
# Getal-naar-woorden (Nederlands) — gebruikt voor "zegge" formulering
# op huurcontracten. Werkt voor 0..999.999 en rondt af op hele eenheden.
# =====================================================================
_NL_UNITS = ["nul", "een", "twee", "drie", "vier", "vijf", "zes", "zeven",
             "acht", "negen", "tien", "elf", "twaalf", "dertien", "veertien",
             "vijftien", "zestien", "zeventien", "achttien", "negentien"]
_NL_TENS = ["", "", "twintig", "dertig", "veertig", "vijftig", "sestig",
            "zeventig", "tachtig", "negentig"]  # noqa: (typo behouden voor 60 fix hieronder)
_NL_TENS[6] = "zestig"  # correcte spelling


def _nl_under_hundred(n: int) -> str:
    if n < 20:
        return _NL_UNITS[n]
    tens, unit = divmod(n, 10)
    if unit == 0:
        return _NL_TENS[tens]
    # Klinkerbotsing: tweeen → tweeën, drieen → drieën
    unit_word = _NL_UNITS[unit]
    joined = f"{unit_word}en{_NL_TENS[tens]}"
    joined = joined.replace("eeen", "eeën").replace("drieen", "drieën").replace("tweeen", "tweeën")
    return joined


def _nl_under_thousand(n: int) -> str:
    if n < 100:
        return _nl_under_hundred(n)
    hundreds, rest = divmod(n, 100)
    h_word = "honderd" if hundreds == 1 else f"{_NL_UNITS[hundreds]}honderd"
    if rest == 0:
        return h_word
    return f"{h_word}{_nl_under_hundred(rest)}"


def number_to_nl_words(amount: float) -> str:
    """Getal naar Nederlandse woorden. Rondt af op hele eenheden."""
    n = int(round(float(amount or 0)))
    if n == 0:
        return "nul"
    if n < 0:
        return f"min {number_to_nl_words(-n)}"
    parts = []
    millions, rest = divmod(n, 1_000_000)
    if millions:
        m_word = "miljoen" if millions == 1 else f"{_nl_under_thousand(millions)} miljoen"
        parts.append(m_word)
    thousands, rest = divmod(rest, 1_000)
    if thousands:
        t_word = "duizend" if thousands == 1 else f"{_nl_under_thousand(thousands)}duizend"
        parts.append(t_word)
    if rest:
        parts.append(_nl_under_thousand(rest))
    return " ".join(parts)


def _styles():
    base = getSampleStyleSheet()
    base.add(ParagraphStyle(
        name="BrandName", parent=base["Normal"],
        fontName="Helvetica-Bold", fontSize=10, textColor=DARK,
        leading=12, spaceAfter=2,
    ))
    base.add(ParagraphStyle(
        name="BrandContact", parent=base["Normal"],
        fontName="Helvetica", fontSize=7.5, textColor=MUTED,
        leading=9, spaceAfter=1,
    ))
    base.add(ParagraphStyle(
        name="DocTitle", parent=base["Normal"],
        fontName="Helvetica-Bold", fontSize=26, textColor=DARK,
        leading=30, alignment=1, spaceBefore=4, spaceAfter=2,
    ))
    base.add(ParagraphStyle(
        name="DocNumber", parent=base["Normal"],
        fontName="Helvetica-Bold", fontSize=10, textColor=MUTED,
        leading=12, alignment=1, spaceAfter=18,
    ))
    base.add(ParagraphStyle(
        name="SectionHead", parent=base["Normal"],
        fontName="Helvetica-Bold", fontSize=9, textColor=DARK,
        leading=12, spaceAfter=4,
    ))
    base.add(ParagraphStyle(
        name="KVLabel", parent=base["Normal"],
        fontName="Helvetica-Bold", fontSize=9, textColor=DARK,
        leading=12, spaceAfter=0,
    ))
    base.add(ParagraphStyle(
        name="KVValue", parent=base["Normal"],
        fontName="Helvetica", fontSize=9, textColor=DARK,
        leading=12, spaceAfter=0,
    ))
    base.add(ParagraphStyle(
        name="AmountLabel", parent=base["Normal"],
        fontName="Helvetica-Bold", fontSize=10, textColor=DARK,
    ))
    base.add(ParagraphStyle(
        name="AmountValue", parent=base["Normal"],
        fontName="Helvetica-Bold", fontSize=18, textColor=DARK,
        alignment=2,  # right
    ))
    base.add(ParagraphStyle(
        name="StatusValue", parent=base["Normal"],
        fontName="Helvetica-Bold", fontSize=12, textColor=SUCCESS,
        alignment=2,
    ))
    base.add(ParagraphStyle(
        name="StatusOpen", parent=base["Normal"],
        fontName="Helvetica-Bold", fontSize=12, textColor=ORANGE,
        alignment=2,
    ))
    base.add(ParagraphStyle(
        name="ApprovalLabel", parent=base["Normal"],
        fontName="Helvetica-Bold", fontSize=8.5, textColor=MUTED,
        leading=11, spaceAfter=2,
    ))
    base.add(ParagraphStyle(
        name="ApprovalValue", parent=base["Normal"],
        fontName="Helvetica", fontSize=10, textColor=DARK,
        leading=13, spaceAfter=0,
    ))
    base.add(ParagraphStyle(
        name="Footer", parent=base["Normal"],
        fontName="Helvetica", fontSize=7, textColor=MUTED,
        leading=9, alignment=1,
    ))
    base.add(ParagraphStyle(
        name="FooterVerify", parent=base["Normal"],
        fontName="Helvetica-Bold", fontSize=7.5, textColor=SUCCESS,
        leading=10, alignment=1,
    ))
    base.add(ParagraphStyle(
        name="FooterHash", parent=base["Normal"],
        fontName="Helvetica", fontSize=6.5, textColor=MUTED,
        leading=8, alignment=1,
    ))
    base.add(ParagraphStyle(
        name="Body", parent=base["Normal"], fontSize=10, leading=14,
    ))
    base.add(ParagraphStyle(
        name="Small", parent=base["Normal"], fontSize=8, textColor=MUTED,
    ))
    base.add(ParagraphStyle(
        name="Sub", parent=base["Normal"],
        fontSize=9, textColor=MUTED, spaceAfter=12,
    ))
    base.add(ParagraphStyle(
        name="H1Orange", parent=base["Heading1"],
        fontSize=22, textColor=DARK, spaceAfter=4, leading=26,
    ))
    return base


def _doc_hash(doc_number: str, *parts) -> str:
    """SHA-256 over receipt/factuur/contract nummer + extra payload — getoond
    in de footer als bewijs van authenticiteit. Niet kritisch beveiligd
    (printbare PDF is geen tamper-proof) maar wel een sterke visuele indicator."""
    raw = " | ".join([str(doc_number or "")] + [str(p or "") for p in parts])
    return hashlib.sha256(raw.encode("utf-8")).hexdigest().upper()


def _fmt_money(amount: float, currency: str = "SRD") -> str:
    """Format `3000.0` → `SRD 3,000.00` (Engelse notatie zoals in voorbeeld)."""
    try:
        return f"{currency} {float(amount):,.2f}"
    except Exception:
        return f"{currency} {amount}"


def _fmt_date_nl(iso_str: str) -> str:
    """`2026-05-13T...` → `13 mei 2026`."""
    if not iso_str:
        return ""
    try:
        dt = datetime.fromisoformat(str(iso_str).replace("Z", "+00:00"))
        return f"{dt.day} {MONTHS_NL[dt.month - 1]} {dt.year}"
    except Exception:
        return str(iso_str)[:10]


def _bg_canvas(canvas, doc):
    """Tekent de lichte grijze pagina-achtergrond — wordt aangeroepen door
    SimpleDocTemplate voor elke pagina via onFirstPage/onLaterPages."""
    canvas.saveState()
    canvas.setFillColor(PAGE_BG)
    canvas.rect(0, 0, doc.pagesize[0], doc.pagesize[1], fill=1, stroke=0)
    canvas.restoreState()


def _brand_header(el, payment_or_doc: dict):
    """Linksboven: bedrijfsnaam (bold) + adres + contact (tel/wa/email).
    Optioneel: bedrijfslogo links naast de naam.

    `payment_or_doc` mag een enriched dict zijn met company_name /
    company_address / company_phone / company_email / company_logo_bytes velden.
    """
    s = _styles()
    name = payment_or_doc.get("company_name") or "SuriRent N.V."
    address = payment_or_doc.get("company_address") or ""
    phone = payment_or_doc.get("company_phone") or ""
    email = payment_or_doc.get("company_email") or ""
    parts = []
    if phone:
        parts.append(f"Tel: {phone}")
        parts.append(f"WhatsApp: {phone}")
    if email:
        parts.append(email)
    contact = " | ".join(parts) if parts else ""

    # Tekstblok
    text_parts = [Paragraph(name.upper(), s["BrandName"])]
    if address:
        text_parts.append(Paragraph(address, s["BrandContact"]))
    if contact:
        text_parts.append(Paragraph(contact, s["BrandContact"]))

    # Logo links indien beschikbaar (gerenderd op max 22mm × 22mm)
    logo_bytes = payment_or_doc.get("company_logo_bytes")
    if logo_bytes:
        try:
            from reportlab.lib.utils import ImageReader
            reader = ImageReader(io.BytesIO(logo_bytes))
            iw, ih = reader.getSize()
            max_h = 22 * mm
            max_w = 28 * mm
            # Schaal om binnen max_w x max_h te passen.
            scale = min(max_w / iw, max_h / ih)
            w = iw * scale
            h = ih * scale
            logo = Image(io.BytesIO(logo_bytes), width=w, height=h)
            t = Table([[logo, text_parts]], colWidths=[max_w + 4 * mm, 170 * mm - max_w - 4 * mm])
            t.setStyle(TableStyle([
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ]))
            el.append(t)
            el.append(Spacer(1, 14))
            return
        except Exception:
            pass  # fallback naar text-only header

    for p in text_parts:
        el.append(p)
    el.append(Spacer(1, 14))


def _brand_title(el, title: str, doc_number: str = ""):
    """Grote gecentreerde titel + kleinere documentnummer eronder."""
    s = _styles()
    el.append(Paragraph(title.upper(), s["DocTitle"]))
    if doc_number:
        el.append(Paragraph(doc_number, s["DocNumber"]))
    else:
        el.append(Spacer(1, 14))


def _two_col_block(el, rows: list, label_col_mm: float = 50, gap_after: int = 14,
                   accent=None):
    """Twee-koloms blok: label links (bold), value rechts.
    `rows` is een lijst van `(label, value)` tuples. Lege values worden geskipped."""
    s = _styles()
    data = []
    for k, v in rows:
        if v in (None, "", "—"):
            continue
        data.append([
            Paragraph(str(k).upper(), s["KVLabel"]),
            Paragraph(str(v), s["KVValue"]),
        ])
    if not data:
        return
    total_w = 170 * mm
    line_color = _hairline_color(accent) if accent is not None else HAIRLINE
    t = Table(data, colWidths=[label_col_mm * mm, total_w - label_col_mm * mm])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LINEBELOW", (0, 0), (-1, -2), 0.3, line_color),
    ]))
    el.append(t)
    el.append(Spacer(1, gap_after))


def _amount_block(el, label: str, amount: float, currency: str = "SRD", accent=None):
    """Groot bedrag-blok: label links, bedrag groot rechts."""
    s = _styles()
    data = [[
        Paragraph(label.upper(), s["AmountLabel"]),
        Paragraph(_fmt_money(amount, currency), s["AmountValue"]),
    ]]
    border = _hairline_color(accent) if accent is not None else HAIRLINE
    t = Table(data, colWidths=[100 * mm, 70 * mm])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ("BACKGROUND", (0, 0), (-1, -1), colors.white),
        ("BOX", (0, 0), (-1, -1), 0.5, border),
    ]))
    el.append(t)
    el.append(Spacer(1, 10))


def _status_row(el, label: str, value: str, is_paid: bool = False, accent=None):
    """Status-rij: label links, status rechts (groen=VOLDAAN, accent=open).

    `accent` overschrijft de standaard ORANGE voor "openstaand" status zodat
    de PDF-kleur synchroon loopt met `branding.primary_color` van de company.
    """
    s = _styles()
    if is_paid:
        value_style = s["StatusValue"]
    elif accent is not None:
        # Bouw inline style met dynamische accent kleur
        value_style = ParagraphStyle(
            name=f"StatusAccent_{id(accent)}", parent=s["Normal"],
            fontName="Helvetica-Bold", fontSize=12, textColor=accent, alignment=2,
        )
    else:
        value_style = s["StatusOpen"]
    line_color = _hairline_color(accent) if accent is not None else HAIRLINE
    data = [[
        Paragraph(label.upper(), s["KVLabel"]),
        Paragraph(value.upper(), value_style),
    ]]
    t = Table(data, colWidths=[100 * mm, 70 * mm])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LINEBELOW", (0, 0), (-1, -1), 0.3, line_color),
    ]))
    el.append(t)


def _signature_block(el, received_by: str = "", approved_by: str = "",
                     company_name: str = "", signature_data: str = ""):
    """Twee-koloms signature blok onderaan vóór de footer.

    Links: 'ONTVANGEN DOOR' + naam (+ rol indien aanwezig)
    Rechts: 'GOEDGEKEURD DOOR {bedrijf}' + (optioneel) ingesloten signature image
    """
    s = _styles()
    el.append(Spacer(1, 18))
    left_parts = []
    left_parts.append(Paragraph("ONTVANGEN DOOR", s["ApprovalLabel"]))
    left_parts.append(Paragraph(received_by or "—", s["ApprovalValue"]))
    # Signature placeholder (links): handtekeningvak
    left_parts.append(Spacer(1, 14))
    left_parts.append(Paragraph("_" * 28, s["ApprovalValue"]))
    left_parts.append(Paragraph("Handtekening huurder", s["Small"]))

    right_parts = []
    label = f"GOEDGEKEURD DOOR {company_name.upper()}" if company_name else "GOEDGEKEURD DOOR"
    right_parts.append(Paragraph(label, s["ApprovalLabel"]))
    if approved_by:
        right_parts.append(Paragraph(approved_by, s["ApprovalValue"]))
    # Probeer een ingesloten signature image te renderen (base64 data URL).
    sig_img = None
    if signature_data and isinstance(signature_data, str):
        try:
            raw = signature_data.split(",", 1)[1] if "," in signature_data else signature_data
            img_bytes = base64.b64decode(raw)
            sig_img = Image(io.BytesIO(img_bytes), width=60 * mm, height=20 * mm)
        except Exception:
            sig_img = None
    if sig_img:
        right_parts.append(Spacer(1, 4))
        right_parts.append(sig_img)
    else:
        right_parts.append(Spacer(1, 14))
        right_parts.append(Paragraph("_" * 28, s["ApprovalValue"]))
    right_parts.append(Paragraph("Handtekening / Stempel", s["Small"]))

    data = [[left_parts, right_parts]]
    t = Table(data, colWidths=[85 * mm, 85 * mm])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    el.append(t)


def _verification_footer(el, doc_number: str, company_name: str = "",
                         company_address: str = "", *hash_payload):
    """Bottom verification line + SHA-256 + bedrijfs-regel."""
    s = _styles()
    el.append(Spacer(1, 24))
    el.append(Paragraph("✓ GEVERIFIEERD ORIGINEEL · AUTHENTIEK DOCUMENT", s["FooterVerify"]))
    h = _doc_hash(doc_number, *hash_payload)
    short_hash = f"{h[:16]} … {h[-4:]}"
    el.append(Paragraph(f"Document-hash (SHA-256): {short_hash}", s["FooterHash"]))
    parts = [p for p in [company_name, company_address, doc_number] if p]
    el.append(Paragraph(" · ".join(parts), s["FooterHash"]))


def _accent_color(doc: dict):
    """Bepaal accentkleur uit doc-dict (`company_primary_color`). Valt terug
    op brand-oranje (#FF5C00) wanneer niet aanwezig of ongeldig."""
    raw = (doc or {}).get("company_primary_color") or ""
    if not raw or not isinstance(raw, str):
        return ORANGE
    s = raw.strip().lower()
    if not s.startswith("#") or len(s) not in (4, 7):
        return ORANGE
    try:
        return colors.HexColor(s)
    except Exception:
        return ORANGE


def _hairline_color(accent):
    """Zeer subtiele getinte hairline: 12% accent op witte basis."""
    try:
        r, g, b = accent.red, accent.green, accent.blue
        return colors.Color(
            r + (1 - r) * 0.88,
            g + (1 - g) * 0.88,
            b + (1 - b) * 0.88,
        )
    except Exception:
        return HAIRLINE



def _header(elements, styles, title, subtitle="", company="SuriRent N.V."):
    elements.append(Paragraph(f"<b>{company}</b>", styles["Body"]))
    elements.append(Paragraph(title, styles["H1Orange"]))
    if subtitle:
        elements.append(Paragraph(subtitle, styles["Sub"]))
    line = Table([[""]], colWidths=[170 * mm], rowHeights=[2])
    line.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), ORANGE)]))
    elements.append(line)
    elements.append(Spacer(1, 10))


def _kv_table(rows):
    data = []
    for k, v in rows:
        data.append([Paragraph(f"<b>{k}</b>", _styles()["Body"]), Paragraph(str(v or "—"), _styles()["Body"])])
    t = Table(data, colWidths=[55 * mm, 115 * mm])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ROWBACKGROUNDS", (0, 0), (-1, -1), [colors.white, LIGHT]),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return t


def _build(doc_elements, *, with_bg: bool = True):
    """Bouwt A4 PDF met optionele grijze pagina-achtergrond."""
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4,
        leftMargin=20 * mm, rightMargin=20 * mm,
        topMargin=20 * mm, bottomMargin=20 * mm)
    if with_bg:
        doc.build(doc_elements, onFirstPage=_bg_canvas, onLaterPages=_bg_canvas)
    else:
        doc.build(doc_elements)
    buf.seek(0)
    return buf.getvalue()


# =====================================================================
# LUXURY / PREMIUM PDF template — donker ribbon, gouden accenten,
# icoon-chips per detailrij, 2-toon bedrag-bar, dark footer met SHA hash.
# Gebruikt voor kwitantie + factuur PDFs. Andere documenten (contract,
# betalingsregeling, loonstrook) blijven de oude minimalistische helpers
# gebruiken zodat we niet per ongeluk daar layouts breken.
# =====================================================================

def _lux_bg_canvas_factory(palette, doc_meta, hash_payload=None):
    """Canvas callback — tekent alle "vaste" elementen die niet uit flowables
    komen: witte pagina, ROUNDED dark header shape (linksboven, ~60% breed,
    met diagonale gouden accent-driehoek rechts ernaast), brand+logo+contact,
    rounded dark footer met gold shield + hash + gestileerde skyline-silhouet.

    Layout streeft naar zo dichte match als mogelijk met de referentie:
    - Header shape is een ROUNDED-corner rect (geen full-width strip)
    - Extra gouden driehoek in de rechter-header-zone
    - Diagonale gouden strook onder de dark header (loopt van links naar
      rechts-boven af)
    - Footer heeft rounded bovenhoeken + gestileerde stad-silhouet in gold
      rechts van de shield
    """
    dark = palette["dark"]
    gold = palette["gold"]
    brand_name = (doc_meta.get("company_name") or "SuriRent").upper()
    tagline = (doc_meta.get("company_tagline") or "").strip().upper()
    address = doc_meta.get("company_address") or ""
    phone = doc_meta.get("company_phone") or ""
    whatsapp = doc_meta.get("company_whatsapp") or phone
    email = doc_meta.get("company_email") or ""
    logo_bytes = doc_meta.get("company_logo_bytes")
    hp = hash_payload or {}

    def _canvas(canvas, doc):
        canvas.saveState()
        w, h = doc.pagesize
        # Witte pagina
        canvas.setFillColor(colors.white)
        canvas.rect(0, 0, w, h, fill=1, stroke=0)

        # === HEADER — POLYGON dark shape (linksboven met angulaire cut) ===
        # Match template: dark shape gaat van top-left tot ~55% breed op top,
        # dan diagonaal naar beneden-rechts tot ~35% breed op onderkant.
        hdr_top_w = w * 0.55        # breedte top
        hdr_bot_w = w * 0.36        # breedte bottom van header shape
        hdr_h = 48 * mm
        canvas.setFillColor(dark)
        p = canvas.beginPath()
        p.moveTo(0, h)
        p.lineTo(hdr_top_w, h)
        p.lineTo(hdr_bot_w, h - hdr_h)
        p.lineTo(0, h - hdr_h)
        p.close()
        canvas.drawPath(p, fill=1, stroke=0)

        # Twee parallelle gouden diagonale strepen onder de dark shape,
        # volgen dezelfde helling.
        canvas.setFillColor(gold)
        for offset, thickness in [(2 * mm, 1.6 * mm), (5 * mm, 0.6 * mm)]:
            slope_delta = (hdr_top_w - hdr_bot_w) / hdr_h * offset  # x-shift langs helling
            sp = canvas.beginPath()
            sp.moveTo(0, h - hdr_h - offset)
            sp.lineTo(hdr_bot_w - slope_delta, h - hdr_h - offset)
            sp.lineTo(hdr_bot_w - slope_delta - (thickness * (hdr_top_w - hdr_bot_w) / hdr_h),
                      h - hdr_h - offset - thickness)
            sp.lineTo(0, h - hdr_h - offset - thickness)
            sp.close()
            canvas.drawPath(sp, fill=1, stroke=0)

        # Kleine gouden accent-driehoek rechts van de dark shape (referentie)
        canvas.setFillColor(gold)
        tri = canvas.beginPath()
        tri.moveTo(hdr_top_w + 4 * mm, h - 4 * mm)
        tri.lineTo(hdr_top_w + 26 * mm, h - 4 * mm)
        tri.lineTo(hdr_top_w + 4 * mm, h - 26 * mm)
        tri.close()
        canvas.drawPath(tri, fill=1, stroke=0)

        # === Header logo — prominent gouden dak (roof + windows) ===
        left_x = 22 * mm
        top_y = h - 12 * mm
        logo_h_used = 0
        if logo_bytes:
            try:
                from reportlab.lib.utils import ImageReader
                reader = ImageReader(io.BytesIO(logo_bytes))
                iw, ih = reader.getSize()
                max_h = 20 * mm
                max_w = 30 * mm
                scale = min(max_w / iw, max_h / ih)
                lw, lh = iw * scale, ih * scale
                canvas.drawImage(reader, left_x, top_y - lh,
                                 width=lw, height=lh, mask="auto")
                logo_h_used = lh + 3 * mm
            except Exception:
                logo_h_used = 0
        else:
            # Groot gouden dak-icoon: brede driehoek + 2 kleine dak-vensters
            canvas.setFillColor(gold)
            roof_x = left_x
            roof_base = top_y - 18 * mm
            # Driehoek dak
            r = canvas.beginPath()
            r.moveTo(roof_x + 18 * mm, roof_base + 16 * mm)  # top point
            r.lineTo(roof_x, roof_base + 4 * mm)              # left base
            r.lineTo(roof_x + 5 * mm, roof_base + 4 * mm)     # inner left
            r.lineTo(roof_x + 18 * mm, roof_base + 12 * mm)   # dip
            r.lineTo(roof_x + 31 * mm, roof_base + 4 * mm)    # inner right
            r.lineTo(roof_x + 36 * mm, roof_base + 4 * mm)    # right base
            r.close()
            canvas.drawPath(r, fill=1, stroke=0)
            # 2 kleine dak-vensters/schoorstenen
            canvas.setFillColor(dark)
            canvas.rect(roof_x + 14 * mm, roof_base + 6 * mm, 3 * mm, 3 * mm, fill=1, stroke=0)
            canvas.rect(roof_x + 19 * mm, roof_base + 6 * mm, 3 * mm, 3 * mm, fill=1, stroke=0)
            logo_h_used = 22 * mm

        # Brand naam — SERIF wit, kleiner om binnen het polygonshape te passen
        canvas.setFillColor(colors.white)
        max_brand_w = hdr_bot_w - left_x - 8 * mm
        fs = 22
        while fs > 12 and canvas.stringWidth(brand_name, _LUX_SERIF, fs) > max_brand_w:
            fs -= 1
        canvas.setFont(_LUX_SERIF, fs)
        brand_y = top_y - logo_h_used
        # Alleen brand naam tonen als er GENOEG ruimte is (polygon is smal)
        if fs >= 14:
            canvas.drawString(left_x, brand_y, brand_name)
            canvas.setFillColor(gold)
            sep_w = min(20 * mm, canvas.stringWidth(brand_name, _LUX_SERIF, fs) * 0.35)
            canvas.rect(left_x, brand_y - 2.5 * mm, sep_w, 1.2, fill=1, stroke=0)
            if tagline:
                canvas.setFont(_LUX_SANS, 7)
                canvas.drawString(left_x, brand_y - 7 * mm, tagline)

        # === Contact stack RECHTS — 4 verticaal gestapelde gouden cirkels
        # met icoon + verticale gouden hairline aan de rechterkant, met
        # tekst-placeholders links van de cirkels. Match referentie template. ===
        contact_x = w - 32 * mm         # x-positie van gouden cirkels
        contact_top = h - 15 * mm       # y-positie eerste cirkel
        gap = 10 * mm                   # verticale afstand tussen cirkels
        icons_and_vals = [
            ("⌂", address),
            ("✆", phone),
            ("W", whatsapp if whatsapp and whatsapp != phone else ""),
            ("✉", email),
        ]
        # Verticale gouden hairline rechts van de cirkels (visuele separator)
        canvas.setFillColor(gold)
        canvas.rect(contact_x + 5 * mm, contact_top - 4 * mm - 3 * gap - 3 * mm,
                    0.4, 4 * gap - 2 * mm, fill=1, stroke=0)
        # Cirkels + tekst
        for idx, (icon_char, val) in enumerate(icons_and_vals):
            cy = contact_top - idx * gap
            canvas.setFillColor(gold)
            canvas.circle(contact_x, cy, 3 * mm, fill=1, stroke=0)
            canvas.setFillColor(colors.white)
            canvas.setFont(_LUX_SANS_BOLD, 9)
            canvas.drawCentredString(contact_x, cy - 1.5 * mm, icon_char)
            # Tekst links van cirkel — donker
            if val:
                canvas.setFillColor(dark)
                canvas.setFont(_LUX_SANS, 8.5)
                # Splits over meerdere regels indien "\n"
                lines = [ln.strip() for ln in str(val).split("\n") if ln.strip()]
                for li, ln in enumerate(lines[:2]):  # max 2 regels om overflow te voorkomen
                    text_w = canvas.stringWidth(ln, _LUX_SANS, 8.5)
                    canvas.drawString(contact_x - 8 * mm - text_w,
                                      cy - 1 * mm + li * (-3.5 * mm), ln)

        # === FOOTER — dark navy shape onderaan met rounded LEFT corner
        # (grote rounded corner links, klein rechts) + gouden accent-lijnen ===
        foot_h = 28 * mm
        canvas.setFillColor(dark)
        fp = canvas.beginPath()
        fp.moveTo(0, 0)
        fp.lineTo(w, 0)
        fp.lineTo(w, foot_h - 4 * mm)
        fp.lineTo(w - 4 * mm, foot_h)                        # kleine hoek rechts
        # Diagonale bovenkant loopt van rechts-boven omlaag naar links-onder
        fp.lineTo(w * 0.32, foot_h)
        fp.lineTo(0, foot_h - 14 * mm)                       # angulaire linkerkant
        fp.close()
        canvas.drawPath(fp, fill=1, stroke=0)
        # 2 parallelle gouden strepen die de diagonale bovenkant volgen
        canvas.setFillColor(gold)
        for offset, thick in [(2 * mm, 1.2 * mm), (5 * mm, 0.5 * mm)]:
            gp = canvas.beginPath()
            gp.moveTo(w * 0.32 + offset * 0.7, foot_h + offset)
            gp.lineTo(w - 4 * mm - offset * 0.3, foot_h + offset)
            gp.lineTo(w - 4 * mm - offset * 0.3, foot_h + offset - thick)
            gp.lineTo(w * 0.32 + offset * 0.7 + thick, foot_h + offset - thick)
            gp.close()
            canvas.drawPath(gp, fill=1, stroke=0)

        # === Footer content: shield-icoon (gouden outline) links + hash midden ===
        doc_number = hp.get("doc_number") or ""
        company_name_hp = hp.get("company_name") or ""
        company_address_hp = hp.get("company_address") or ""
        try:
            h256 = _doc_hash(doc_number, *hp.get("extras", []))
        except Exception:
            h256 = ""
        short_hash = h256[:40]
        # Shield-outline (transparant met gouden lijn)
        shield_x = 18 * mm
        shield_y = 15 * mm
        canvas.setStrokeColor(gold)
        canvas.setLineWidth(1.2)
        sh = canvas.beginPath()
        sh.moveTo(shield_x, shield_y + 8 * mm)
        sh.lineTo(shield_x + 8 * mm, shield_y + 8 * mm)
        sh.lineTo(shield_x + 8 * mm, shield_y - 1 * mm)
        sh.curveTo(shield_x + 8 * mm, shield_y - 5 * mm,
                   shield_x + 4 * mm, shield_y - 7 * mm,
                   shield_x + 4 * mm, shield_y - 7 * mm)
        sh.curveTo(shield_x + 4 * mm, shield_y - 7 * mm,
                   shield_x, shield_y - 5 * mm,
                   shield_x, shield_y - 1 * mm)
        sh.close()
        canvas.drawPath(sh, fill=0, stroke=1)
        canvas.setFillColor(gold)
        canvas.setFont(_LUX_SANS_BOLD, 9)
        canvas.drawCentredString(shield_x + 4 * mm, shield_y + 1 * mm, "✓")

        # Verificatie-tekst (compacter, want de skyline neemt rechts ruimte in)
        text_x = shield_x + 14 * mm
        canvas.setFillColor(gold)
        canvas.setFont(_LUX_SANS_BOLD, 8.5)
        canvas.drawString(text_x, foot_h - 8 * mm, "GEVERIFIEERD ORIGINEEL")
        canvas.drawString(text_x, foot_h - 12 * mm, "AUTHENTIEK DOCUMENT")
        canvas.setFillColor(colors.HexColor("#B8B8B8"))
        canvas.setFont(_LUX_SANS, 6.5)
        canvas.drawString(text_x, foot_h - 16 * mm, "Document-hash (SHA-256):")
        canvas.setFillColor(colors.white)
        canvas.setFont(_LUX_SANS, 6.5)
        canvas.drawString(text_x, foot_h - 19 * mm, short_hash)
        parts = [pp for pp in [company_name_hp,
                                (company_address_hp or "").replace("\n", ", "),
                                doc_number] if pp]
        canvas.setFillColor(colors.HexColor("#B8B8B8"))
        canvas.setFont(_LUX_SANS, 6.5)
        canvas.drawString(text_x, foot_h - 23 * mm, " • ".join(parts))

        # === Skyline-silhouette RECHTS in de footer + boven de foot_h grens ===
        # Match referentie: gebouwen die BOVEN de dark footer uitsteken tot in
        # de rechter-kolom (subtiel, semi-transparant grijs op wit-rechts, en
        # met warm-gouden ramen).
        sky_x = w * 0.63
        # Gebouwen strekken van onder de dark footer tot boven de footer-lijn
        sky_bottom = 0
        sky_top = foot_h + 30 * mm
        # Kolom-strook (lichte tint van dark voor "gebouw silhouette" boven
        # het footer-vlak en donker binnen het footer-vlak).
        light_bldg = colors.Color(0.85, 0.85, 0.85)
        dark_bldg = colors.Color(
            min(1.0, dark.red + (1 - dark.red) * 0.15),
            min(1.0, dark.green + (1 - dark.green) * 0.15),
            min(1.0, dark.blue + (1 - dark.blue) * 0.15),
        )
        # Gebouw 1
        b1x, b1w, b1h = sky_x, 22 * mm, 46 * mm
        # 2 splitsen: onder-deel in footer (dark_bldg), boven-deel op wit (light_bldg)
        canvas.setFillColor(light_bldg)
        canvas.rect(b1x, foot_h, b1w, b1h - foot_h, fill=1, stroke=0)
        canvas.setFillColor(dark_bldg)
        canvas.rect(b1x, sky_bottom, b1w, foot_h, fill=1, stroke=0)
        # Gebouw 2
        b2x, b2w, b2h = sky_x + 24 * mm, 18 * mm, 34 * mm
        canvas.setFillColor(light_bldg)
        canvas.rect(b2x, foot_h, b2w, b2h - foot_h, fill=1, stroke=0)
        canvas.setFillColor(dark_bldg)
        canvas.rect(b2x, sky_bottom, b2w, foot_h, fill=1, stroke=0)
        # Gebouw 3
        b3x, b3w, b3h = sky_x + 44 * mm, 20 * mm, 40 * mm
        canvas.setFillColor(light_bldg)
        canvas.rect(b3x, foot_h, b3w, b3h - foot_h, fill=1, stroke=0)
        canvas.setFillColor(dark_bldg)
        canvas.rect(b3x, sky_bottom, b3w, foot_h, fill=1, stroke=0)
        # Warme gouden verlichte ramen — alleen in het footer-deel (donker)
        canvas.setFillColor(gold)
        import random as _r
        _r.seed(42)
        for bx, bw, bh in [(b1x, b1w, foot_h),
                           (b2x, b2w, foot_h),
                           (b3x, b3w, foot_h)]:
            for _ in range(int(bw * bh / (25 * mm))):
                rx = bx + _r.uniform(1, bw / mm - 1) * mm
                ry = _r.uniform(2, bh / mm - 2) * mm
                canvas.rect(rx, ry, 0.8 * mm, 0.8 * mm, fill=1, stroke=0)

        canvas.restoreState()
    return _canvas


def _lux_header_placeholder(el):
    """(No-op — behouden voor backwards compat, header wordt in canvas
    callback getekend.)"""
    return


def _lux_title(el, title: str, doc_number: str, palette: dict):
    """Referentie template heeft GEEN grote titel — alleen een gouden divider
    met crown-ornament in het midden. Titel + documentnummer verschijnen
    kort erboven en eronder in kleinere serif-tekst voor herkenning.
    """
    from reportlab.platypus import Flowable

    dark = palette["dark"]
    gold = palette["gold"]

    class CrownDivider(Flowable):
        def __init__(self, title_txt, num_txt, width=170 * mm, height=22 * mm):
            super().__init__()
            self.title_txt = title_txt
            self.num_txt = num_txt
            self.width = width
            self.height = height

        def wrap(self, aw, ah):
            return (self.width, self.height)

        def draw(self):
            c = self.canv
            w_ = self.width
            h_ = self.height
            # Grote gecentreerde title bovenaan in serif
            c.setFillColor(dark)
            c.setFont(_LUX_SERIF, 20)
            c.drawCentredString(w_ / 2, h_ - 6 * mm, (self.title_txt or "").upper())
            # Horizontale gouden hairline met crown in midden
            c.setStrokeColor(gold)
            c.setLineWidth(0.6)
            gap = 6 * mm
            line_y = h_ / 2 - 4 * mm
            # Links line
            c.line(w_ * 0.32, line_y, w_ / 2 - gap, line_y)
            # Rechts line
            c.line(w_ / 2 + gap, line_y, w_ * 0.68, line_y)
            # Crown character in midden
            c.setFillColor(gold)
            c.setFont(_LUX_SANS, 12)
            c.drawCentredString(w_ / 2, line_y - 1.5 * mm, "♛")
            # Document nummer onderaan
            if self.num_txt:
                c.setFillColor(gold)
                c.setFont(_LUX_SANS_BOLD, 9)
                c.drawCentredString(w_ / 2, 2 * mm, f"— {self.num_txt} —")

    el.append(CrownDivider(title, doc_number))
    el.append(Spacer(1, 6))


def _lux_icon_chip(icon_char: str, palette: dict):
    """Klein donker afgerond vierkant met wit iconkarakter erin — gerenderd
    als 1-cel table met dark background. Wordt links van elke kv-rij geplaatst."""
    dark = palette["dark"]
    chip = Table([[Paragraph(f'<font color="white" size="10" name="{_LUX_SANS_BOLD}">{icon_char}</font>',
                             ParagraphStyle(name="LuxChipIcon", alignment=1, fontName=_LUX_SANS_BOLD))]],
                 colWidths=[9 * mm], rowHeights=[9 * mm])
    chip.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("BACKGROUND", (0, 0), (-1, -1), dark),
        ("ROUNDEDCORNERS", [2 * mm, 2 * mm, 2 * mm, 2 * mm]),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    return chip


# Icoon-mapping voor detail-chips — kleine Unicode symbolen die door
# DejaVuSans goed worden gerenderd (geen emoji, geen exotische characters).
_LUX_ICON_MAP = {
    "datum":            "◷",   # klok/schijf
    "huurder":          "◉",
    "appartement":      "⌂",   # huisje
    "type betaling":    "◆",
    "betaling voor":    "▦",   # brick wall
    "betalingswijze":   "◈",
    "notitie":          "!",
    "factuurnummer":    "#",
    "periode":          "▦",
    "vervaldatum":      "◐",
    "openstaand":       "!",
    "openstaand na betaling": "!",
    "totaal openstaand": "!",
    "totaal":           "∑",
    "subtotaal":        "∑",
    "btw":              "%",
}


def _lux_kv_block(el, rows, palette):
    """Detail-blok in een WITTE ROUNDED-corner card met soft-gold border.
    Elke rij: [chip-icon][label][waarde]."""
    dark = palette["dark"]
    gold = palette["gold"]
    label_style = ParagraphStyle(
        name="LuxKVLabel", fontName=_LUX_SANS_BOLD, fontSize=9,
        textColor=dark, leading=11, spaceAfter=0,
    )
    value_style = ParagraphStyle(
        name="LuxKVValue", fontName=_LUX_SANS, fontSize=10,
        textColor=dark, leading=13, spaceAfter=0,
    )
    data = []
    for k, v in rows:
        if v in (None, "", "—"):
            continue
        icon = _LUX_ICON_MAP.get(str(k).strip().lower(), "•")
        chip = _lux_icon_chip(icon, palette)
        data.append([
            chip,
            Paragraph(str(k).upper(), label_style),
            Paragraph(str(v), value_style),
        ])
    if not data:
        return
    total_w = 170 * mm
    t = Table(data, colWidths=[12 * mm, 45 * mm, total_w - 57 * mm])
    line_color = colors.Color(gold.red, gold.green, gold.blue, alpha=0.25)
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LINEBELOW", (1, 0), (-1, -2), 0.4, line_color),
        # Witte card met soft-gold border
        ("BACKGROUND", (0, 0), (-1, -1), colors.white),
        ("BOX", (0, 0), (-1, -1), 0.6, line_color),
        ("ROUNDEDCORNERS", [3 * mm, 3 * mm, 3 * mm, 3 * mm]),
    ]))
    el.append(t)
    el.append(Spacer(1, 8))


def _lux_amount_bar(el, label: str, amount: float, currency: str, palette: dict):
    """Bicolor bedrag-bar met DIAGONALE overgang van dark naar gold.
    Links: label wit-op-donker. Rechts: bedrag donker-op-goud.
    De diagonale streep wordt via een custom Flowable getekend op canvas."""
    from reportlab.platypus import Flowable

    dark = palette["dark"]
    gold = palette["gold"]

    class DiagonalAmountBar(Flowable):
        def __init__(self, label_txt, amount_txt, width, height):
            super().__init__()
            self.label_txt = label_txt
            self.amount_txt = amount_txt
            self.width = width
            self.height = height

        def wrap(self, avail_w, avail_h):
            return (self.width, self.height)

        def draw(self):
            c = self.canv
            w_ = self.width
            h_ = self.height
            r = 5 * mm   # rounded corners
            # Splitpunt (~52% van links, met diagonale offset)
            split_x = w_ * 0.52
            slant = 8 * mm
            # === DARK LEFT (rounded left corners, diagonaal rechts-op naar links-onder) ===
            c.setFillColor(dark)
            p = c.beginPath()
            p.moveTo(r, 0)
            p.lineTo(split_x + slant / 2, 0)
            p.lineTo(split_x - slant / 2, h_)
            p.lineTo(r, h_)
            p.curveTo(r * 0.4, h_, 0, h_ - r * 0.4, 0, h_ - r)
            p.lineTo(0, r)
            p.curveTo(0, r * 0.4, r * 0.4, 0, r, 0)
            p.close()
            c.drawPath(p, fill=1, stroke=0)
            # === GOLD RIGHT (rounded right corners) ===
            c.setFillColor(gold)
            p2 = c.beginPath()
            p2.moveTo(split_x + slant / 2 + 1.5 * mm, 0)  # kleine gap tussen 2 shapes
            p2.lineTo(w_ - r, 0)
            p2.curveTo(w_ - r * 0.4, 0, w_, r * 0.4, w_, r)
            p2.lineTo(w_, h_ - r)
            p2.curveTo(w_, h_ - r * 0.4, w_ - r * 0.4, h_, w_ - r, h_)
            p2.lineTo(split_x - slant / 2 + 1.5 * mm, h_)
            p2.close()
            c.drawPath(p2, fill=1, stroke=0)
            # === Tekst ===
            c.setFillColor(colors.white)
            c.setFont(_LUX_SANS_BOLD, 11.5)
            c.drawString(12 * mm, h_ / 2 - 2, self.label_txt.upper())
            c.setFillColor(dark)
            c.setFont(_LUX_SANS_BOLD, 22)
            # Center within right section
            right_center = (split_x + w_) / 2 + 2 * mm
            c.drawCentredString(right_center, h_ / 2 - 6, self.amount_txt)

    bar = DiagonalAmountBar(label, _fmt_money(amount, currency), 170 * mm, 20 * mm)
    el.append(bar)
    el.append(Spacer(1, 10))


def _lux_status_block(el, rows, palette):
    """Status-rijen in een witte rounded card met soft-gold border, elke rij
    met chevron-chip links, label midden, bedrag rechts."""
    dark = palette["dark"]
    gold = palette["gold"]
    label_style = ParagraphStyle(
        name="LuxStatusLabel", fontName=_LUX_SANS_BOLD, fontSize=9.5,
        textColor=dark, leading=12,
    )
    open_style = ParagraphStyle(
        name="LuxStatusOpen", fontName=_LUX_SANS_BOLD, fontSize=11.5,
        textColor=colors.HexColor("#B91C1C"), alignment=2, leading=14,
    )
    paid_style = ParagraphStyle(
        name="LuxStatusPaid", fontName=_LUX_SANS_BOLD, fontSize=11.5,
        textColor=SUCCESS, alignment=2, leading=14,
    )
    data = []
    for label, value, is_paid in rows:
        # Chevron als ronde chip (donker + wit ">")
        chip = _lux_icon_chip("›", palette)
        val_style = paid_style if is_paid else open_style
        data.append([
            chip,
            Paragraph(label.upper(), label_style),
            Paragraph(str(value).upper(), val_style),
        ])
    if not data:
        return
    total_w = 170 * mm
    t = Table(data, colWidths=[12 * mm, 90 * mm, total_w - 102 * mm])
    line_color = colors.Color(gold.red, gold.green, gold.blue, alpha=0.25)
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LINEBELOW", (1, 0), (-1, -2), 0.4, line_color),
        ("BACKGROUND", (0, 0), (-1, -1), colors.white),
        ("BOX", (0, 0), (-1, -1), 0.6, line_color),
        ("ROUNDEDCORNERS", [3 * mm, 3 * mm, 3 * mm, 3 * mm]),
    ]))
    el.append(t)
    el.append(Spacer(1, 6))


def _lux_note(el, note_text: str, palette: dict):
    """Notitie-blok — soft cream-gold-tinted box met bell-icon (in gold)
    en rounded corners."""
    if not note_text:
        return
    gold = palette["gold"]
    soft = palette["soft"]
    style = ParagraphStyle(
        name="LuxNote", fontName=_LUX_SANS, fontSize=9.5,
        textColor=palette["dark"], leading=13,
    )
    bell_style = ParagraphStyle(
        name="LuxNoteBell", fontName=_LUX_SANS, fontSize=14,
        textColor=gold, leading=16, alignment=1,
    )
    bell_cell = Paragraph("!", bell_style)
    text_cell = Paragraph(f'<b>Notitie:</b> {note_text}', style)
    t = Table([[bell_cell, text_cell]], colWidths=[10 * mm, 160 * mm])
    soft_gold = colors.Color(gold.red, gold.green, gold.blue, alpha=0.3)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), soft),
        ("BOX", (0, 0), (-1, -1), 0.6, soft_gold),
        ("ROUNDEDCORNERS", [3 * mm, 3 * mm, 3 * mm, 3 * mm]),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    el.append(t)
    el.append(Spacer(1, 8))


def _lux_signature_block(el, received_by: str, company_name: str,
                         signature_data: str, palette: dict):
    """Signature block in een WITTE ROUNDED-corner card met soft-gold border,
    twee kolommen: links huurder-handtekening, midden gouden LAUREL-G-LAUREL
    ornament, rechts bedrijfs-handtekening. Onderaan een dunne gouden lijn
    en 'Handtekening huurder' / 'Handtekening / Stempel'."""
    dark = palette["dark"]
    gold = palette["gold"]
    label_style = ParagraphStyle(
        name="LuxSigLabel", fontName=_LUX_SANS_BOLD, fontSize=8.5,
        textColor=dark, leading=11, spaceAfter=2,
    )
    name_style = ParagraphStyle(
        name="LuxSigName", fontName=_LUX_SANS, fontSize=9.5,
        textColor=dark, leading=12, spaceAfter=6,
    )
    small_style = ParagraphStyle(
        name="LuxSigSmall", fontName=_LUX_SANS, fontSize=7.5,
        textColor=MUTED, leading=9,
    )
    # Signature line via kleine gouden onderstreping
    line = Table([[""]], colWidths=[55 * mm], rowHeights=[0.6],
                 style=TableStyle([("BACKGROUND", (0, 0), (-1, -1), gold)]))

    left = [
        Paragraph("ONTVANGEN DOOR", label_style),
        Paragraph(received_by or "—", name_style),
        Spacer(1, 8),
        line,
        Spacer(1, 2),
        Paragraph("Handtekening huurder", small_style),
    ]

    # Midden — laurel-krans met gouden "G" (of eerste letter bedrijf)
    from reportlab.platypus import Flowable

    class LaurelOrnament(Flowable):
        def __init__(self, letter, w=30 * mm, h=22 * mm):
            super().__init__()
            self.letter = letter
            self.w = w
            self.h = h

        def wrap(self, aw, ah):
            return (self.w, self.h)

        def draw(self):
            c = self.canv
            cx = self.w / 2
            cy = self.h / 2
            # Laurel — 2 rijen met kleine gouden bladeren (elk als klein
            # ovaal), 6 per zijde.
            c.setFillColor(gold)
            for side in (-1, 1):
                for i in range(6):
                    angle_offset = 20 + i * 15  # graden
                    import math
                    theta = math.radians(angle_offset * side + (90 if side > 0 else -90))
                    lx = cx + side * (10 * mm + i * 0.4 * mm)
                    ly = cy - 6 * mm + i * 2 * mm
                    c.saveState()
                    c.translate(lx, ly)
                    c.rotate(-30 * side + i * 8 * side)
                    c.ellipse(-1.4 * mm, -0.6 * mm, 1.4 * mm, 0.6 * mm, fill=1, stroke=0)
                    c.restoreState()
            # Grote gouden "G" letter in midden — serif font
            c.setFillColor(gold)
            c.setFont(_LUX_SERIF, 26)
            c.drawCentredString(cx, cy - 4 * mm, (self.letter or "S").upper())
            # Klein crown-tje boven de letter
            c.setFillColor(gold)
            c.setFont(_LUX_SANS, 9)
            c.drawCentredString(cx, cy + 7 * mm, "♛")

    mid = [LaurelOrnament(company_name[:1] if company_name else "S")]

    # Rechts
    approved_label = f"GOEDGEKEURD DOOR {company_name.upper()}" if company_name else "GOEDGEKEURD DOOR"
    right = [Paragraph(approved_label, label_style),
             Paragraph(company_name or "—", name_style)]
    sig_img = None
    if signature_data and isinstance(signature_data, str):
        try:
            raw = signature_data.split(",", 1)[1] if "," in signature_data else signature_data
            img_bytes = base64.b64decode(raw)
            sig_img = Image(io.BytesIO(img_bytes), width=50 * mm, height=16 * mm)
        except Exception:
            sig_img = None
    if sig_img:
        right.append(sig_img)
    else:
        right.append(Spacer(1, 4))
    right.extend([
        line,
        Spacer(1, 2),
        Paragraph("Handtekening / Stempel", small_style),
    ])

    data = [[left, mid, right]]
    t = Table(data, colWidths=[65 * mm, 40 * mm, 65 * mm])
    soft_gold = colors.Color(gold.red, gold.green, gold.blue, alpha=0.25)
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("BACKGROUND", (0, 0), (-1, -1), colors.white),
        ("BOX", (0, 0), (-1, -1), 0.6, soft_gold),
        ("ROUNDEDCORNERS", [3 * mm, 3 * mm, 3 * mm, 3 * mm]),
    ]))
    el.append(Spacer(1, 4))
    el.append(t)


def _lux_footer_marker(el, doc_number: str, company_name: str,
                      company_address: str, palette: dict, *hash_payload):
    """Content bovenop het donker footer-ribbon: shield-icoon + 2 regels tekst
    (GEVERIFIEERD ORIGINEEL / AUTHENTIEK DOCUMENT) + hash + company line."""
    gold = palette["gold"]
    title_style = ParagraphStyle(
        name="LuxFootTitle", fontName="Helvetica-Bold", fontSize=10,
        textColor=gold, leading=13, spaceAfter=1,
    )
    body_style = ParagraphStyle(
        name="LuxFootBody", fontName="Helvetica", fontSize=8,
        textColor=colors.white, leading=11,
    )
    shield_style = ParagraphStyle(
        name="LuxFootShield", fontName="Helvetica", fontSize=22,
        textColor=gold, leading=26, alignment=1,
    )
    # Push naar bottom door zichzelf te wrappen in een tabel met vaste hoogte
    h = _doc_hash(doc_number, *hash_payload)
    short_hash = f"{h[:32]}"
    left_cell = [Paragraph("🛡", shield_style)]
    right_cell = [
        Paragraph("GEVERIFIEERD ORIGINEEL", title_style),
        Paragraph("AUTHENTIEK DOCUMENT", title_style),
        Spacer(1, 2),
        Paragraph(f'<font color="#B8B8B8">Document-hash (SHA-256):</font><br/>{short_hash}', body_style),
    ]
    company_line_parts = [p for p in [company_name, company_address, doc_number] if p]
    right_cell.append(Spacer(1, 2))
    right_cell.append(Paragraph(" • ".join(company_line_parts), body_style))

    t = Table([[left_cell, right_cell]], colWidths=[18 * mm, 152 * mm])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    el.append(Spacer(1, 14))
    el.append(t)


def _build_lux(doc_elements, palette, doc_meta, hash_payload=None):
    """Bouwt luxury A4 PDF. topMargin en bottomMargin zijn dusdanig ingesteld
    dat de flowable content past tussen de dark ribbons (header 52mm hoog,
    footer 30mm hoog) én dat de kwitantie op 1 pagina staat."""
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4,
        leftMargin=20 * mm, rightMargin=20 * mm,
        topMargin=56 * mm, bottomMargin=36 * mm)
    cb = _lux_bg_canvas_factory(palette, doc_meta, hash_payload)
    doc.build(doc_elements, onFirstPage=cb, onLaterPages=cb)
    buf.seek(0)
    return buf.getvalue()



def _build_a6(doc_elements):
    """A6 (105 x 148mm) print — ideaal voor stickers naast de voordeur."""
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A6,
        leftMargin=6 * mm, rightMargin=6 * mm,
        topMargin=6 * mm, bottomMargin=6 * mm)
    doc.build(doc_elements)
    buf.seek(0)
    return buf.getvalue()


# ============== Receipt PDF (KWITANTIE-look) ==============
def payment_plan_pdf(plan: dict) -> bytes:
    """Bonnetje voor een betalingsregeling die zojuist is aangemaakt in de Kiosk.
    Toont totaal, aantal termijnen, per-termijn-bedrag en tabel met alle
    vervaldatums + bedragen. Huurder krijgt dit mee voor administratie.
    """
    el = []
    accent = colors.HexColor("#FF5C00")
    _brand_header(el, plan)
    _brand_title(el, "Betalingsregeling", plan.get("plan_number") or plan.get("id", "")[:8].upper())

    rows = [
        ("Datum afspraak", _fmt_date_nl(plan.get("created_at"))),
        ("Huurder", plan.get("tenant_name", "")),
        ("Appartement", plan.get("apartment_number") or "—"),
        ("Aantal termijnen", f"{plan.get('num_installments', 0)}× termijn"),
        ("Eerste vervaldatum", _fmt_date_nl(plan.get("first_due_date") or "")),
    ]
    if plan.get("notes"):
        rows.append(("Betreft", plan["notes"]))
    _two_col_block(el, rows, label_col_mm=48, gap_after=14, accent=accent)

    total = float(plan.get("total_amount") or 0)
    currency = plan.get("currency") or "SRD"
    _amount_block(el, "Totaal regeling", total, currency, accent=accent)
    el.append(Spacer(1, 6))

    n = int(plan.get("num_installments") or 0)
    per = float(plan.get("installment_amount") or (total / n if n else 0))
    _status_row(el, "Per termijn", _fmt_money(per, currency), is_paid=False, accent=accent)

    # Termijnen-tabel
    insts = plan.get("installments") or []
    if insts:
        s = _styles()
        el.append(Spacer(1, 12))
        el.append(Paragraph("<b>Termijn-overzicht</b>", s["Body"]))
        el.append(Spacer(1, 4))
        data = [["#", "Vervaldatum", "Bedrag", "Status"]]
        for inst in insts:
            data.append([
                str(inst.get("sequence", "")),
                _fmt_date_nl(inst.get("due_date", "")),
                _fmt_money(float(inst.get("amount") or 0), currency),
                (inst.get("status") or "open").capitalize(),
            ])
        t = Table(data, colWidths=[12 * mm, 50 * mm, 40 * mm, 30 * mm])
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), accent),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 9),
            ("ALIGN", (2, 0), (2, -1), "RIGHT"),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
            ("GRID", (0, 0), (-1, -1), 0.25, HAIRLINE),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
        ]))
        el.append(t)

    # Footer note
    s = _styles()
    el.append(Spacer(1, 14))
    el.append(Paragraph(
        "<b>Belangrijk:</b> de huurder verbindt zich tot betaling van bovenstaande "
        "termijnen op de aangegeven vervaldatums. Betaling kan via de Kiosk, "
        "Mope, contant of bankoverschrijving. Bij niet-nakoming behoudt de "
        "verhuurder het recht de regeling te annuleren.",
        s["Body"],
    ))

    _signature_block(
        el,
        received_by=plan.get("tenant_name") or "Huurder",
        approved_by=plan.get("company_name") or "",
        company_name=plan.get("company_name") or "",
        signature_data=plan.get("signature_data") or "",
    )

    _verification_footer(
        el,
        plan.get("plan_number") or plan.get("id", "")[:8].upper(),
        plan.get("company_name") or "",
        plan.get("company_address") or "",
        total, currency, plan.get("tenant_id", ""),
    )
    return _build(el)


def receipt_pdf(payment: dict) -> bytes:
    """Genereert de luxury kwitantie: dark-ribbon header met brand+contact,
    grote gecentreerde serif-titel met crown-ornament + gouden nummer,
    icoon-chip detailrijen, 2-toon bedrag-bar (dark+gold), status-rijen,
    optionele notitie-box, twee-koloms signature blok, en dark-footer met
    shield-icoon + SHA-256 hash."""
    el = []
    palette = _palette(payment)

    _lux_title(el, "Kwitantie", payment.get("receipt_number", ""), palette)

    period = ""
    if payment.get("period_month") and payment.get("period_year"):
        period = f"{MONTHS_NL[payment['period_month'] - 1]} {payment['period_year']}"

    rows = [
        ("Datum", _fmt_date_nl(payment.get("paid_at"))),
        ("Huurder", payment.get("tenant_name", "")),
        ("Appartement", payment.get("apartment_number") or "—"),
        ("Type betaling", (payment.get("category") or "").capitalize() or "Huurbetaling"),
    ]
    if period:
        rows.append(("Betaling voor", period))
    rows.append(("Betalingswijze", (payment.get("method") or "").capitalize() or "Contant"))
    _lux_kv_block(el, rows, palette)

    amount = float(payment.get("amount") or 0)
    currency = payment.get("currency") or "SRD"
    _lux_amount_bar(el, "Ontvangen bedrag", amount, currency, palette)

    # Status — VOLDAAN of openstaand bedrag (2 rijen)
    outstanding_after = float(payment.get("outstanding_after") or 0)
    if outstanding_after <= 0.01:
        status_rows = [
            ("Openstaand na betaling", "VOLDAAN", True),
            ("Totaal openstaand", "VOLDAAN", True),
        ]
    else:
        status_rows = [
            ("Openstaand na betaling", _fmt_money(outstanding_after, currency), False),
            ("Totaal openstaand", _fmt_money(outstanding_after, currency), False),
        ]
    _lux_status_block(el, status_rows, palette)

    if payment.get("note"):
        _lux_note(el, payment["note"], palette)

    # Signature blok — huurder links, bedrijf rechts
    received = payment.get("received_by") or payment.get("tenant_name") or ""
    if payment.get("kiosk_employee_name"):
        received = payment["kiosk_employee_name"]
    _lux_signature_block(
        el,
        received_by=received,
        company_name=payment.get("company_name") or "",
        signature_data=payment.get("signature_data") or "",
        palette=palette,
    )

    # Footer marker wordt via canvas callback op de dark ribbon getekend,
    # dus we voegen hem NIET meer toe aan de flowable-stream. Dat voorkomt
    # dat de kwitantie naar pagina 2 overflowt en dat wit-op-wit text
    # onzichtbaar is boven de ribbon.
    hash_payload = {
        "doc_number": payment.get("receipt_number", ""),
        "company_name": payment.get("company_name") or "",
        "company_address": payment.get("company_address") or "",
        "extras": [amount, currency, payment.get("tenant_id", "")],
    }
    return _build_lux(el, palette, payment, hash_payload)


# ============== Contract PDF ==============
def contract_pdf(contract: dict, tenant: dict, apartment: dict,
                 id_photo_bytes: bytes | None = None,
                 id_photo_back_bytes: bytes | None = None,
                 signature_bytes: bytes | None = None,
                 landlord_signature_bytes: bytes | None = None) -> bytes:
    """Officiële HUUROVEREENKOMST — Surinaams recht.

    Volgt de door de opdrachtgever vastgestelde structuur met 10 artikelen.
    Missende gegevens (geboortedatum, ID-nummers) worden als invulregel
    weergegeven zodat de PDF met pen kan worden aangevuld en dubbel worden
    ondertekend.

    Handtekeningen (`signature_bytes` voor huurder, `landlord_signature_bytes`
    voor verhuurder) worden inline op de contract-pagina zelf gerenderd
    boven de "Handtekening:" tekst. NIET meer als aparte bijlage.

    `id_photo_bytes` (voorkant) en `id_photo_back_bytes` (achterkant)
    komen als Bijlage 1 en 2 aan het eind van het document.
    """
    s = _styles()
    el = []
    _brand_header(el, contract)

    # === Titel ===
    title_style = ParagraphStyle(
        name="ContractTitle", parent=s["Normal"],
        fontName="Helvetica-Bold", fontSize=18, textColor=DARK,
        leading=22, alignment=1, spaceBefore=6, spaceAfter=14,
    )
    el.append(Paragraph("HUUROVEREENKOMST", title_style))

    # === Body & artikel stijlen ===
    body = ParagraphStyle(
        name="ContractBody", parent=s["Normal"],
        fontName="Helvetica", fontSize=10, textColor=DARK,
        leading=14, spaceAfter=6, alignment=0,
    )
    art = ParagraphStyle(
        name="ContractArticle", parent=s["Normal"],
        fontName="Helvetica-Bold", fontSize=11, textColor=DARK,
        leading=14, spaceBefore=10, spaceAfter=4,
    )
    small = ParagraphStyle(
        name="ContractSmall", parent=s["Normal"],
        fontName="Helvetica", fontSize=9, textColor=MUTED, leading=12,
    )

    # Placeholder voor missende gegevens — user vult met pen aan bij ondertekenen
    UNSET = "____________________"

    landlord_name = contract.get("landlord") or contract.get("company_name") or UNSET
    landlord_dob = contract.get("landlord_dob") or UNSET
    landlord_id = contract.get("landlord_id") or UNSET

    tenant_name = tenant.get("name") or UNSET
    tenant_dob = tenant.get("birth_date") or tenant.get("dob") or UNSET
    tenant_id = tenant.get("id_number") or tenant.get("id_no") or UNSET

    apt_number = apartment.get("number") or UNSET
    apt_address = apartment.get("address") or contract.get("company_address") or UNSET
    cur = apartment.get("currency", "SRD")
    rent_amount = _fmt_money(apartment.get("rent_amount", 0), cur)
    # "Zegge" — huurprijs in woorden voor extra juridische zekerheid
    rent_words = number_to_nl_words(apartment.get("rent_amount", 0))
    cur_word = {"SRD": "Surinaamse dollars", "USD": "Amerikaanse dollars",
                "EUR": "euro"}.get(cur, cur)
    rent_zegge = f"zegge: {rent_words} {cur_word}"
    start_date = contract.get("start_date") or UNSET

    # === Ondergetekenden ===
    el.append(Paragraph("<b>Ondergetekenden</b>", body))
    el.append(Paragraph(
        f"De heer/mevrouw <b>{landlord_name}</b>,<br/>"
        f"Geboren op: {landlord_dob},<br/>"
        f"ID-nummer: {landlord_id},<br/>"
        "hierna te noemen: &quot;<b>Verhuurder</b>&quot;,",
        body,
    ))
    el.append(Paragraph("en", body))
    el.append(Paragraph(
        f"<b>{tenant_name}</b>,<br/>"
        f"geboren op: {tenant_dob},<br/>"
        f"ID-nummer: {tenant_id},<br/>"
        "hierna te noemen: &quot;<b>Huurder</b>&quot;,",
        body,
    ))
    el.append(Paragraph(
        "verklaren met elkaar de volgende huurovereenkomst te zijn aangegaan.",
        body,
    ))

    # === Artikel 1 ===
    el.append(Paragraph("Artikel 1 – Het gehuurde", art))
    el.append(Paragraph(
        f"De verhuurder verhuurt aan de huurder het appartement gelegen aan:<br/>"
        f"<b>{apt_address}</b>.<br/>"
        f"Het betreft specifiek:<br/><b>{apt_number}</b><br/><br/>"
        "Het gehuurde mag uitsluitend worden gebruikt als woonruimte door de huurder.",
        body,
    ))

    # === Artikel 2 ===
    el.append(Paragraph("Artikel 2 – Huurprijs en ingangsdatum", art))
    el.append(Paragraph(
        f"De maandelijkse huurprijs bedraagt <b>{rent_amount}</b>,- "
        f"(<i>{rent_zegge}</i>).<br/>"
        f"De huurovereenkomst gaat in op <b>[{start_date}]</b>.<br/>"
        "De huur dient maandelijks te worden betaald en dient uiterlijk op de "
        "<b>10e dag</b> van iedere kalendermaand te zijn voldaan.",
        body,
    ))

    # === Artikel 3 ===
    el.append(Paragraph("Artikel 3 – Betalingsvoorwaarden, herinneringen en boete", art))
    el.append(Paragraph(
        "Indien de huur niet uiterlijk op de 10e van de maand is betaald, geldt de "
        "volgende procedure:",
        body,
    ))
    el.append(Paragraph(
        "&nbsp;&nbsp;• Vanaf de <b>11e</b> van de maand ontvangt de huurder de eerste betalingsherinnering.<br/>"
        "&nbsp;&nbsp;• Eén week daarna ontvangt de huurder de tweede betalingsherinnering.<br/>"
        "&nbsp;&nbsp;• Eén week daarna ontvangt de huurder de derde betalingsherinnering.",
        body,
    ))
    el.append(Paragraph(
        "Indien de huur na de derde betalingsherinnering nog steeds niet volledig is "
        "betaald, is de huurder een eenmalige boete van <b>SRD 500,-</b> verschuldigd "
        "voor die betreffende huurmaand, onverminderd de verplichting tot betaling van "
        "de achterstallige huur.",
        body,
    ))

    # === Artikel 4 ===
    el.append(Paragraph("Artikel 4 – Betalingsachterstand en ontbinding", art))
    el.append(Paragraph(
        "Indien de huurder een huurachterstand van <b>twee (2) maanden</b> heeft, "
        "zullen partijen indien mogelijk in overleg treden om een betalingsregeling "
        "te treffen.",
        body,
    ))
    el.append(Paragraph(
        "Indien de huurachterstand <b>drie (3) maanden of meer</b> bedraagt en de "
        "huurder ondanks schriftelijke herinneringen en aanmaningen niet aan zijn "
        "betalingsverplichtingen voldoet, is de verhuurder gerechtigd de ontbinding "
        "van deze huurovereenkomst en de ontruiming van het gehuurde te vorderen "
        "overeenkomstig het Surinaamse recht.",
        body,
    ))
    el.append(Paragraph(
        "Indien de huurder vrijwillig instemt met beëindiging van de huurovereenkomst "
        "wegens de betalingsachterstand, krijgt de huurder maximaal <b>één (1) maand</b> "
        "de tijd om het appartement te verlaten en een andere woonruimte te vinden.",
        body,
    ))
    el.append(Paragraph(
        "Bij het verlaten van het gehuurde dient het appartement leeg, bezemschoon en "
        "in goede staat te worden opgeleverd, behoudens normale slijtage.",
        body,
    ))

    # === Artikel 5 ===
    el.append(Paragraph("Artikel 5 – Onderhoud en reparaties", art))
    el.append(Paragraph("<b>Voor rekening van de verhuurder:</b>", body))
    el.append(Paragraph(
        "&nbsp;&nbsp;• Reparaties aan de elektrische installatie.<br/>"
        "&nbsp;&nbsp;• Het verhelpen van verstoppingen in de afvoer of riolering, tenzij deze door onjuist gebruik van de huurder zijn ontstaan.<br/>"
        "&nbsp;&nbsp;• Groot onderhoud aan het appartement.",
        body,
    ))
    el.append(Paragraph("<b>Voor rekening van de huurder:</b>", body))
    el.append(Paragraph(
        "&nbsp;&nbsp;• Het vervangen van lampen.<br/>"
        "&nbsp;&nbsp;• Het vervangen of repareren van de wc-bril.<br/>"
        "&nbsp;&nbsp;• Alle kleine dagelijkse onderhoudswerkzaamheden.<br/>"
        "&nbsp;&nbsp;• Schade ontstaan door onzorgvuldig, onjuist of nalatig gebruik van het gehuurde.",
        body,
    ))

    # === Artikel 6 ===
    el.append(Paragraph("Artikel 6 – Waarborgsom", art))
    el.append(Paragraph(
        "Na beëindiging van de huurovereenkomst wordt de waarborgsom, na verrekening "
        "van eventuele openstaande huur, schade of andere verschuldigde bedragen, "
        "binnen <b>dertig (30) dagen</b> terugbetaald.",
        body,
    ))

    # === Artikel 7 ===
    el.append(Paragraph("Artikel 7 – Gebruik van het gehuurde", art))
    el.append(Paragraph("De huurder zal het appartement als een goed huurder gebruiken.", body))
    el.append(Paragraph(
        "Het is zonder voorafgaande schriftelijke toestemming van de verhuurder niet toegestaan:",
        body,
    ))
    el.append(Paragraph(
        "&nbsp;&nbsp;• het appartement geheel of gedeeltelijk onder te verhuren;<br/>"
        "&nbsp;&nbsp;• het appartement aan derden in gebruik te geven;<br/>"
        "&nbsp;&nbsp;• wijzigingen aan het appartement aan te brengen die niet eenvoudig ongedaan kunnen worden gemaakt.",
        body,
    ))

    # === Artikel 8 ===
    el.append(Paragraph("Artikel 8 – Oplevering", art))
    el.append(Paragraph(
        "Bij aanvang en beëindiging van de huurovereenkomst kunnen partijen gezamenlijk "
        "een inspectie van het appartement uitvoeren.",
        body,
    ))
    el.append(Paragraph(
        "Bij beëindiging dient het appartement leeg, schoon en in goede staat te worden "
        "opgeleverd, behoudens normale slijtage.",
        body,
    ))

    # === Artikel 9 ===
    el.append(Paragraph("Artikel 9 – Opzegging en verhuizing", art))
    el.append(Paragraph(
        "De huurder is verplicht om de verhuurder minimaal <b>één (1) maand</b> vóór de "
        "geplande verhuisdatum schriftelijk op de hoogte te stellen van de beëindiging "
        "van de huurovereenkomst.",
        body,
    ))
    el.append(Paragraph(
        "Indien de huurder zonder de vereiste voorafgaande schriftelijke kennisgeving "
        "verhuist of de woning voortijdig verlaat, is de huurder een contractuele boete "
        "van <b>SRD 3.000</b> verschuldigd.",
        body,
    ))
    el.append(Paragraph(
        "Deze boete laat de verplichting van de huurder onverlet om eventuele achterstallige "
        "huur, schade aan het gehuurde, openstaande kosten voor water, elektriciteit, "
        "internet en overige verschuldigde bedragen volledig te betalen.",
        body,
    ))
    el.append(Paragraph(
        "De verhuurder is gerechtigd de openstaande bedragen en de overeengekomen boete te "
        "verrekenen met de waarborgsom, voor zover dit wettelijk is toegestaan. Indien de "
        "waarborgsom onvoldoende is, blijft de huurder verplicht het resterende bedrag te "
        "voldoen.",
        body,
    ))

    # === Artikel 10 ===
    el.append(Paragraph("Artikel 10 – Slotbepalingen", art))
    el.append(Paragraph("Op deze overeenkomst is het Surinaamse recht van toepassing.", body))
    el.append(Paragraph(
        "Wijzigingen of aanvullingen op deze overeenkomst zijn uitsluitend geldig indien "
        "deze schriftelijk door beide partijen zijn overeengekomen.",
        body,
    ))
    el.append(Paragraph(
        "Partijen verklaren deze overeenkomst te hebben gelezen, de inhoud te begrijpen en "
        "hiermee akkoord te gaan.",
        body,
    ))

    el.append(Spacer(1, 10))
    el.append(Paragraph(
        "Aldus in tweevoud opgemaakt en ondertekend te <b>Paramaribo, Suriname</b>.",
        body,
    ))
    # Datum-regel (dd/mm/yyyy invulplekken)
    now_year = datetime.utcnow().year
    el.append(Paragraph(
        f"Datum: ____ / ____ / {now_year}",
        body,
    ))
    el.append(Spacer(1, 18))

    # === Handtekening blok — twee koloms ===
    sig_style = ParagraphStyle(
        name="ContractSigLabel", parent=s["Normal"],
        fontName="Helvetica-Bold", fontSize=10, textColor=DARK,
        leading=12, spaceAfter=4,
    )
    sig_line_style = ParagraphStyle(
        name="ContractSigLine", parent=s["Normal"],
        fontName="Helvetica", fontSize=9, textColor=MUTED,
        leading=12, spaceAfter=2,
    )

    def _inline_sig_image(raw_bytes):
        """Rendert een handtekening PNG als reportlab Image (max 70mm x 22mm)
        boven de 'Handtekening:' regel. Geeft None terug bij fout of leeg."""
        if not raw_bytes:
            return None
        try:
            from PIL import Image as PILImage
            src = PILImage.open(io.BytesIO(raw_bytes))
            if src.mode not in ("RGB", "RGBA", "L"):
                src = src.convert("RGB")
            buf = io.BytesIO()
            src.save(buf, format="PNG")
            iw, ih = src.size
            max_w, max_h = 70 * mm, 22 * mm
            ratio = min(max_w / iw, max_h / ih)
            img = Image(io.BytesIO(buf.getvalue()), width=iw * ratio, height=ih * ratio)
            img.hAlign = "LEFT"
            return img
        except Exception:
            return None

    landlord_sig_img = _inline_sig_image(landlord_signature_bytes)
    tenant_sig_img = _inline_sig_image(signature_bytes)

    # Verhuurder-kolom — met inline handtekening indien beschikbaar
    landlord_col = [
        Paragraph("Verhuurder", sig_style),
        Paragraph(f"Naam: <b>{landlord_name}</b>", sig_line_style),
    ]
    if landlord_sig_img is not None:
        landlord_col.append(Spacer(1, 4))
        landlord_col.append(landlord_sig_img)
        landlord_col.append(Paragraph("Handtekening: <i>digitaal ondertekend</i>", sig_line_style))
    else:
        landlord_col.append(Spacer(1, 30))
        landlord_col.append(Paragraph("Handtekening: ________________________", sig_line_style))

    # Huurder-kolom — met inline handtekening indien beschikbaar
    tenant_col = [
        Paragraph("Huurder", sig_style),
        Paragraph(f"Naam: <b>{tenant_name}</b>", sig_line_style),
    ]
    if tenant_sig_img is not None:
        tenant_col.append(Spacer(1, 4))
        tenant_col.append(tenant_sig_img)
        signed_dt = ""
        if tenant.get("signature_signed_at"):
            signed_dt = f" · {tenant.get('signature_signed_at', '')[:10]}"
        tenant_col.append(Paragraph(f"Handtekening: <i>digitaal ondertekend{signed_dt}</i>", sig_line_style))
    else:
        tenant_col.append(Spacer(1, 30))
        tenant_col.append(Paragraph("Handtekening: ________________________", sig_line_style))

    sig_table_data = [[landlord_col, tenant_col]]
    sig_table = Table(sig_table_data, colWidths=[85 * mm, 85 * mm])
    sig_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    el.append(sig_table)

    # Optionele digitale ondertekening — als de kiosk een signatuur heeft
    # vastgelegd tonen we dat + datum onderaan als bewijs.
    signed = contract.get("signed_at")
    if signed:
        el.append(Spacer(1, 14))
        try:
            dt = datetime.fromisoformat(signed.replace("Z", "+00:00"))
            when = dt.strftime("%d-%m-%Y %H:%M")
        except Exception:
            when = signed
        el.append(Paragraph(
            f"<i>Digitaal ondertekend door: {contract.get('signed_by') or tenant_name} · {when}</i>",
            small,
        ))

    _verification_footer(
        el,
        contract.get("contract_number", ""),
        contract.get("company_name") or "",
        contract.get("company_address") or "",
        tenant.get("id", ""), apartment.get("id", ""),
    )

    # === Bijlage 1 — ID-kaart foto van huurder (indien beschikbaar) ===
    # Wordt op een aparte A4 pagina getoond met kader en toelichting. Dient
    # als bewijs bij het contract en past binnen 170mm x 220mm bounding box.
    def _safe_image(el_list, raw_bytes, title, subtitle=""):
        try:
            from PIL import Image as PILImage
            src = PILImage.open(io.BytesIO(raw_bytes))
            if src.mode not in ("RGB", "L"):
                src = src.convert("RGB")
            buf = io.BytesIO()
            src.save(buf, format="PNG")
            safe = buf.getvalue()
            iw, ih = src.size
            max_w, max_h = 170 * mm, 200 * mm
            ratio = min(max_w / iw, max_h / ih)
            w, h = iw * ratio, ih * ratio
            el_list.append(PageBreak())
            el_list.append(Paragraph(title, title_style))
            if subtitle:
                el_list.append(Spacer(1, 6))
                el_list.append(Paragraph(subtitle, body))
            el_list.append(Spacer(1, 10))
            img = Image(io.BytesIO(safe), width=w, height=h)
            img.hAlign = "CENTER"
            el_list.append(img)
            return True
        except Exception:
            return False

    if id_photo_bytes:
        _safe_image(
            el, id_photo_bytes,
            "BIJLAGE 1 — LEGITIMATIEBEWIJS HUURDER (VOORKANT)",
            f"Naam: <b>{tenant.get('name') or ''}</b> · ID-nr: <b>{tenant.get('id_number') or ''}</b> · "
            f"Geboortedatum: <b>{tenant.get('birth_date') or ''}</b>",
        )
    if id_photo_back_bytes:
        _safe_image(
            el, id_photo_back_bytes,
            "BIJLAGE 2 — LEGITIMATIEBEWIJS HUURDER (ACHTERKANT)",
            f"Naam: <b>{tenant.get('name') or ''}</b>",
        )

    return _build(el)


# ============== Invoice PDF ==============
def invoice_pdf(invoice: dict, tenant: dict, apartment: dict, payments: list) -> bytes:
    """Luxury factuur — zelfde design-taal als kwitantie: dark-ribbon header,
    gouden accenten, icoon-chip detailrijen, 2-toon bedrag-bar, en dark footer
    met hash."""
    el = []
    palette = _palette(invoice)
    dark = palette["dark"]

    _lux_title(el, "Factuur", invoice.get("invoice_number", ""), palette)

    cur = apartment.get("currency", invoice.get("currency", "SRD"))
    period = ""
    if invoice.get("period_month") and invoice.get("period_year"):
        period = f"{MONTHS_NL[invoice['period_month'] - 1]} {invoice['period_year']}"

    _lux_kv_block(el, [
        ("Factuurdatum", _fmt_date_nl(invoice.get("created_at"))),
        ("Huurder", tenant.get("name", "")),
        ("Appartement", apartment.get("number", "")),
        ("Periode", period),
    ], palette)

    # Specificatie — luxe table met dark header
    section_style = ParagraphStyle(
        name="LuxSpecHead", fontName="Helvetica-Bold", fontSize=9,
        textColor=colors.white, leading=12, alignment=0,
    )
    row_label_style = ParagraphStyle(
        name="LuxSpecRow", fontName="Helvetica", fontSize=10,
        textColor=dark, leading=13,
    )
    row_amount_style = ParagraphStyle(
        name="LuxSpecAmt", fontName="Helvetica-Bold", fontSize=11,
        textColor=dark, leading=14, alignment=2,
    )
    spec_data = [
        [Paragraph("OMSCHRIJVING", section_style), Paragraph("BEDRAG", section_style)],
        [
            Paragraph(f"Maandhuur appartement {apartment.get('number', '')}", row_label_style),
            Paragraph(_fmt_money(invoice.get("amount", 0), cur), row_amount_style),
        ],
    ]
    line_color = colors.Color(palette["gold"].red, palette["gold"].green,
                              palette["gold"].blue, alpha=0.35)
    t = Table(spec_data, colWidths=[120 * mm, 50 * mm])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("BACKGROUND", (0, 0), (-1, 0), dark),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, 0), 6),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 6),
        ("TOPPADDING", (0, 1), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 1), (-1, -1), 10),
        ("LINEBELOW", (0, 1), (-1, -1), 0.4, line_color),
        ("ALIGN", (1, 0), (1, 0), "RIGHT"),
    ]))
    el.append(t)
    el.append(Spacer(1, 12))

    # Totalen
    total = float(invoice.get("amount", 0) or 0)
    paid = sum(float(p.get("amount", 0) or 0) for p in (payments or []))
    due = max(total - paid, 0)
    _lux_amount_bar(el, "Totaal", total, cur, palette)

    status_rows = []
    if paid > 0:
        status_rows.append(("Reeds betaald", _fmt_money(paid, cur), True))
    if due > 0.01:
        status_rows.append(("Nog te betalen", _fmt_money(due, cur), False))
    else:
        status_rows.append(("Status", "VOLDAAN", True))
    _lux_status_block(el, status_rows, palette)

    if due > 0.01:
        _lux_note(el,
                  "Gelieve dit bedrag binnen 14 dagen te voldoen via de kiosk of bankoverschrijving.",
                  palette)

    # Footer marker via canvas callback (zie _lux_bg_canvas_factory).
    hash_payload = {
        "doc_number": invoice.get("invoice_number", ""),
        "company_name": invoice.get("company_name") or "",
        "company_address": invoice.get("company_address") or "",
        "extras": [total, cur, tenant.get("id", "")],
    }
    return _build_lux(el, palette, invoice, hash_payload)


# ============== SaaS subscription invoice PDF ==============
def saas_invoice_pdf(invoice: dict, company: dict, saas_provider: dict | None = None) -> bytes:
    """PDF factuur van de SaaS-eigenaar (SuriRent) naar een klant-bedrijf.
    Gebruikt zelfde brand-stijl als andere PDFs. Optioneel `saas_provider`
    dict {name, address, ...} voor de header; anders defaults.
    """
    s = _styles()
    el = []
    accent = _accent_color(invoice)
    # Force brand-header met SaaS eigenaar (default SuriRent) als afzender.
    header_doc = {
        "company_name": (saas_provider or {}).get("name", "SuriRent N.V."),
        "company_address": (saas_provider or {}).get("address", "Paramaribo, Suriname"),
        "company_email": (saas_provider or {}).get("email", ""),
        "company_phone": (saas_provider or {}).get("phone", ""),
    }
    _brand_header(el, header_doc)

    inv_nr = invoice.get("id", "")[:8].upper()
    _brand_title(el, "SaaS Factuur", f"INV-{inv_nr}")

    cur = invoice.get("currency", "SRD")
    plan_label = str(invoice.get("plan", "")).capitalize() or "Abonnement"
    kind_label = "Termijnfactuur" if invoice.get("kind") == "installment" else "Abonnement"

    _two_col_block(el, [
        ("Factuurdatum", _fmt_date_nl(invoice.get("created_at"))),
        ("Klant", company.get("name", "")),
        ("Klant slug", f"/{company.get('slug', '')}"),
        ("Plan", plan_label),
    ], gap_after=10, accent=accent)

    period_start = _fmt_date_nl(invoice.get("period_start"))
    period_end = _fmt_date_nl(invoice.get("period_end"))
    _two_col_block(el, [
        ("Periode", f"{period_start} → {period_end}"),
        ("Type", kind_label),
        ("Termijn", (
            f"{invoice.get('installment_seq')}/{invoice.get('installment_total')}"
            if invoice.get("kind") == "installment" else "—"
        )),
    ], gap_after=14, accent=accent)

    # Specificatie
    el.append(Paragraph("SPECIFICATIE", s["SectionHead"]))
    el.append(Spacer(1, 4))
    desc = f"{kind_label} · {plan_label} · {period_start} – {period_end}"
    spec_data = [[
        Paragraph(desc, s["Body"]),
        Paragraph(_fmt_money(invoice.get("amount", 0), cur), s["AmountValue"]),
    ]]
    t = Table(spec_data, colWidths=[120 * mm, 50 * mm])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LINEBELOW", (0, 0), (-1, -1), 0.4, _hairline_color(accent)),
    ]))
    el.append(t)
    el.append(Spacer(1, 14))

    total = float(invoice.get("amount", 0) or 0)
    _amount_block(el, "Totaal", total, cur, accent=accent)
    el.append(Spacer(1, 4))

    if invoice.get("status") == "paid":
        _status_row(el, "Status", "VOLDAAN", is_paid=True, accent=accent)
        if invoice.get("paid_at"):
            el.append(Spacer(1, 4))
            el.append(Paragraph(
                f"Ontvangen op {_fmt_date_nl(invoice.get('paid_at'))}.",
                s["Small"]
            ))
    else:
        _status_row(el, "Nog te betalen", _fmt_money(total, cur), is_paid=False, accent=accent)

    el.append(Spacer(1, 16))
    el.append(Paragraph(
        "Gelieve dit bedrag binnen 14 dagen te voldoen via bankoverschrijving of "
        "Uni5Pay. Vermeld de factuurreferentie bij uw betaling.",
        s["Small"]
    ))

    _verification_footer(
        el, f"INV-{inv_nr}", header_doc["company_name"], header_doc["company_address"],
        total, cur, company.get("id", ""),
    )
    return _build(el)


# ============== Deposit refund PDF ==============
def deposit_refund_pdf(deposit: dict, tenant: dict, apartment: dict) -> bytes:
    el = []
    accent = _accent_color(deposit)
    _brand_header(el, deposit)
    nr = (deposit.get("id") or "")[:8].upper()
    _brand_title(el, "Borg restitutie", nr)

    cur = deposit.get("currency", "SRD")
    _two_col_block(el, [
        ("Huurder", tenant.get("name", "")),
        ("Appartement", apartment.get("number") or "—"),
        ("Borg ontvangen", _fmt_date_nl(deposit.get("created_at"))),
        ("Borg restitutie", _fmt_date_nl(deposit.get("refunded_at"))),
    ], gap_after=14, accent=accent)

    _amount_block(el, "Borgbedrag", deposit.get("amount", 0), cur, accent=accent)
    if float(deposit.get("deduction", 0) or 0) > 0:
        _status_row(el, "Aftrek", _fmt_money(deposit.get("deduction", 0), cur),
                    is_paid=False, accent=accent)
    _amount_block(el, "Terugbetaald", deposit.get("refund_amount", 0), cur, accent=accent)

    if deposit.get("refund_note"):
        s = _styles()
        el.append(Spacer(1, 12))
        el.append(Paragraph("TOELICHTING AFTREK", s["SectionHead"]))
        el.append(Paragraph(deposit["refund_note"], s["Body"]))

    _signature_block(
        el,
        received_by=tenant.get("name", ""),
        approved_by=deposit.get("company_name") or "",
        company_name=deposit.get("company_name") or "",
        signature_data=deposit.get("signature_data") or "",
    )
    _verification_footer(
        el, f"BORG-{nr}",
        deposit.get("company_name") or "",
        deposit.get("company_address") or "",
        deposit.get("refund_amount", 0), cur, tenant.get("id", ""),
    )
    return _build(el)


# ============== Payslip PDF ==============
def payslip_pdf(salary: dict, employee: dict) -> bytes:
    s = _styles()
    el = []
    accent = _accent_color(salary)
    _brand_header(el, salary)
    period_label = ""
    if salary.get("period_month") and salary.get("period_year"):
        period_label = f"{MONTHS_NL[salary['period_month'] - 1]} {salary['period_year']}"
    nr = f"LS-{salary.get('id','')[:8].upper()}" if salary.get("id") else "LS"
    _brand_title(el, "Loonstrook", nr)

    cur = salary.get("currency", "SRD")
    _two_col_block(el, [
        ("Werknemer", employee.get("name", "")),
        ("Functie", employee.get("role") or "—"),
        ("Periode", period_label),
        ("Uitbetaald op", _fmt_date_nl(salary.get("paid_at"))),
    ], gap_after=14, accent=accent)

    el.append(Paragraph("LOONSPECIFICATIE", s["SectionHead"]))
    el.append(Spacer(1, 4))
    rows = []
    if salary.get("gross") is not None:
        rows.append(("Bruto salaris", _fmt_money(salary.get("gross", 0), cur)))
    if float(salary.get("advance", 0) or 0) > 0:
        rows.append(("Voorschotten", "- " + _fmt_money(salary.get("advance", 0), cur)))
    if float(salary.get("deductions", 0) or 0) > 0:
        rows.append(("Inhoudingen", "- " + _fmt_money(salary.get("deductions", 0), cur)))
    _two_col_block(el, rows, label_col_mm=80, gap_after=6, accent=accent)

    _amount_block(el, "Netto uitbetaald", salary.get("net", 0), cur, accent=accent)

    if salary.get("note"):
        el.append(Spacer(1, 10))
        el.append(Paragraph(f"<b>Notitie:</b> {salary['note']}", s["Body"]))

    _signature_block(
        el,
        received_by=employee.get("name", ""),
        approved_by=salary.get("company_name") or "",
        company_name=salary.get("company_name") or "",
        signature_data=salary.get("signature_data") or "",
    )
    _verification_footer(
        el, nr,
        salary.get("company_name") or "",
        salary.get("company_address") or "",
        salary.get("net", 0), cur, employee.get("id", ""),
    )
    return _build(el)



def _make_qr_png(url: str, size_px: int = 360) -> bytes:
    """Generate a QR-code PNG for the given URL. Returns raw PNG bytes."""
    import qrcode
    qr = qrcode.QRCode(version=None, error_correction=qrcode.constants.ERROR_CORRECT_M,
                       box_size=10, border=2)
    qr.add_data(url)
    qr.make(fit=True)
    img = qr.make_image(fill_color="#1a1a1a", back_color="white")
    img = img.resize((size_px, size_px))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def onboarding_pdf(*, company_name: str, contact_name: str, email: str,
                   plan_name: str, plan_price_text: str,
                   login_url: str, subdomain_url: str | None,
                   kiosk_pin: str | None,
                   primary_hex: str = "#FF5C00") -> bytes:
    """Premium onboarding PDF — login info + QR code + iOS/Android install steps.
    Sent as attachment to the welcome email."""
    from reportlab.platypus import Image as RLImage
    s = _styles()
    accent = colors.HexColor(primary_hex) if primary_hex.startswith("#") else ORANGE
    elements = []

    # Title
    elements.append(Paragraph(
        f'<font color="{accent.hexval()}">Welkom bij SuriRent!</font>', s["H1Orange"]
    ))
    elements.append(Paragraph(
        f"Uw eigen Vastgoed-omgeving voor <b>{company_name}</b> is klaar.",
        s["Sub"],
    ))
    elements.append(Spacer(1, 8))

    # Two-column layout: QR (left) + Login info (right)
    qr_png = _make_qr_png(login_url, size_px=360)
    qr_img = RLImage(io.BytesIO(qr_png), width=55 * mm, height=55 * mm)

    info_rows = [
        ["Bedrijf", company_name],
        ["Contactpersoon", contact_name],
        ["E-mailadres", email],
        ["Wachtwoord", "(zoals opgegeven bij registratie)"],
    ]
    if kiosk_pin:
        info_rows.append(["Kiosk PIN", kiosk_pin])
    info_rows.append(["Pakket", plan_name])
    info_rows.append(["Prijs", plan_price_text])
    info_rows.append(["Proefperiode", "14 dagen gratis"])

    info_table = Table(info_rows, colWidths=[35 * mm, 75 * mm])
    info_table.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("TEXTCOLOR", (0, 0), (0, -1), MUTED),
        ("TEXTCOLOR", (1, 0), (1, -1), DARK),
        ("FONTNAME", (1, 0), (1, -1), "Helvetica-Bold"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("LINEBELOW", (0, 0), (-1, -2), 0.4, LIGHT),
    ]))

    qr_caption = Paragraph(
        '<para align="center"><font size="8" color="#6b7280">Scan om direct in te loggen</font></para>',
        s["Body"],
    )
    qr_block = Table([[qr_img], [qr_caption]], colWidths=[60 * mm])
    qr_block.setStyle(TableStyle([
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("BOX", (0, 0), (-1, -1), 0.5, LIGHT),
        ("BACKGROUND", (0, 0), (-1, -1), colors.white),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
    ]))

    top = Table([[qr_block, info_table]], colWidths=[65 * mm, 115 * mm])
    top.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
    elements.append(top)

    elements.append(Spacer(1, 14))
    elements.append(Paragraph("UW LOGIN LINK", s["SectionHead"]))
    elements.append(Paragraph(
        f'<font color="{accent.hexval()}"><b><link href="{login_url}">{login_url}</link></b></font>',
        ParagraphStyle("Link", parent=s["Body"], fontSize=10, leading=13, wordWrap="CJK"),
    ))
    if subdomain_url:
        # Legacy parameter — subdomein-feature is verwijderd. Genegeerd.
        pass

    elements.append(Spacer(1, 14))

    # Install instructions: two columns (iOS / Android)
    elements.append(Paragraph("INSTALLEER ALS APP OP UW TELEFOON", s["SectionHead"]))
    elements.append(Paragraph(
        "Voor een ware app-ervaring (eigen icoon, fullscreen) installeer SuriRent als PWA:",
        s["Body"],
    ))
    elements.append(Spacer(1, 6))

    ios_steps = [
        ["1.", "Open de link op uw iPhone of iPad <b>via Safari</b>"],
        ["2.", "Tik op het <b>Delen</b>-icoon (vierkant met pijl omhoog)"],
        ["3.", "Scroll en kies <b>'Zet op beginscherm'</b>"],
        ["4.", "Bevestig met <b>Voeg toe</b> — klaar!"],
    ]
    android_steps = [
        ["1.", "Open de link in <b>Chrome</b> of <b>Edge</b>"],
        ["2.", "Tik op de prompt <b>'Installeren'</b> onderaan"],
        ["3.", "Of via het menu: <b>'App installeren'</b>"],
        ["4.", "SuriRent verschijnt op uw startscherm — klaar!"],
    ]

    def _steps_table(title: str, rows):
        body = [[Paragraph(f'<b><font color="{accent.hexval()}">{title}</font></b>', s["Body"])]]
        body += [[Paragraph(f'<b>{n}</b> {t}', s["Body"])] for n, t in rows]
        tbl = Table(body, colWidths=[85 * mm])
        tbl.setStyle(TableStyle([
            ("FONTSIZE", (0, 0), (-1, -1), 9),
            ("BACKGROUND", (0, 0), (-1, 0), LIGHT),
            ("BOX", (0, 0), (-1, -1), 0.4, LIGHT),
            ("INNERGRID", (0, 0), (-1, -1), 0.3, LIGHT),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ("LEFTPADDING", (0, 0), (-1, -1), 10),
            ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ]))
        return tbl

    install_row = Table([[
        _steps_table("iOS — iPhone / iPad", ios_steps),
        _steps_table("Android — Chrome / Edge", android_steps),
    ]], colWidths=[90 * mm, 90 * mm])
    install_row.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
    elements.append(install_row)

    elements.append(Spacer(1, 14))
    elements.append(Paragraph("HULP NODIG?", s["SectionHead"]))
    elements.append(Paragraph(
        "Heeft u vragen of loopt u ergens vast? Beantwoord de welkomst-mail "
        "of stuur een bericht via WhatsApp. Wij helpen graag persoonlijk.",
        s["Body"],
    ))

    return _build(elements)



# ============== Kiosk sticker PDF ==============
def kiosk_sticker_pdf(*, apartment_number: str, address: str,
                     tenant_name: str | None, company_name: str,
                     kiosk_url: str, primary_hex: str = "#FF5C00") -> bytes:
    """A4 printable poster met grote QR-code voor naast de voordeur.
    Scant naar de Huurder Kiosk met apartment_id voorgevuld."""
    from reportlab.platypus import Image as RLImage
    s = _styles()
    accent = colors.HexColor(primary_hex) if str(primary_hex).startswith("#") else ORANGE

    elements = []
    elements.append(Spacer(1, 8 * mm))
    elements.append(Paragraph(
        f'<font color="{accent.hexval()}"><b>HUURDER KIOSK</b></font>',
        ParagraphStyle("StickerEyebrow", parent=s["Body"], fontSize=12,
                       alignment=1, spaceAfter=4, fontName="Helvetica-Bold"),
    ))
    elements.append(Paragraph(
        f"<b>Appartement {apartment_number}</b>",
        ParagraphStyle("StickerTitle", parent=s["H1Orange"], fontSize=36,
                       alignment=1, leading=42, spaceAfter=4),
    ))
    if address:
        elements.append(Paragraph(
            address,
            ParagraphStyle("StickerAddr", parent=s["Sub"], fontSize=11,
                           alignment=1, spaceAfter=14),
        ))

    # Grote QR (centered)
    qr_png = _make_qr_png(kiosk_url, size_px=600)
    qr_img = RLImage(io.BytesIO(qr_png), width=110 * mm, height=110 * mm)
    qr_table = Table([[qr_img]], colWidths=[170 * mm])
    qr_table.setStyle(TableStyle([("ALIGN", (0, 0), (-1, -1), "CENTER")]))
    elements.append(qr_table)
    elements.append(Spacer(1, 10 * mm))

    elements.append(Paragraph(
        "Scan deze code met uw telefoon en log in met uw PIN-code.",
        ParagraphStyle("StickerInstr", parent=s["Body"], fontSize=14,
                       alignment=1, leading=20, spaceAfter=6),
    ))
    elements.append(Paragraph(
        "Betalen · Onderhoud melden · Mijn gegevens · Contact",
        ParagraphStyle("StickerSubInstr", parent=s["Sub"], fontSize=11,
                       alignment=1, spaceAfter=18),
    ))

    if tenant_name:
        elements.append(Paragraph(
            f'<font color="{MUTED.hexval()}">Toegewezen aan</font> <b>{tenant_name}</b>',
            ParagraphStyle("StickerTenant", parent=s["Body"], fontSize=10,
                           alignment=1, spaceAfter=4),
        ))
    elements.append(Spacer(1, 8 * mm))
    elements.append(Paragraph(
        f"<font color='{MUTED.hexval()}'>{company_name}</font>",
        ParagraphStyle("StickerFooter", parent=s["Small"], fontSize=9,
                       alignment=1),
    ))

    return _build(elements)



# ============== Tenant Portal A6 Poster ==============
def portal_poster_pdf(*, company_name: str, portal_url: str,
                      tenant_name: str | None = None,
                      apartment_number: str | None = None,
                      apartment_address: str | None = None,
                      primary_hex: str = "#FF5C00") -> bytes:
    """A6 (105 x 148mm) printbaar kaartje voor naast de voordeur of in een
    welkomstmap. QR linkt naar het huurportaal van het bedrijf.
    Per-huurder variant: `portal_url` bevat al `?identifier=…` zodat de
    huurder alleen nog een PIN hoeft in te voeren."""
    from reportlab.platypus import Image as RLImage
    s = _styles()
    accent = colors.HexColor(primary_hex) if str(primary_hex).startswith("#") else ORANGE

    # A6 binnenwerk (na 6mm marge): ~93mm breed x 136mm hoog
    inner_w = 93 * mm

    el = []

    # 1) Brand band — bedrijfsnaam + label
    brand_band = Table(
        [[
            Paragraph(
                f'<para align="center"><font color="white" size="9"><b>{(company_name or "").upper()}</b></font></para>',
                s["Body"],
            )
        ],
        [
            Paragraph(
                '<para align="center"><font color="white" size="14"><b>MIJN HUURPORTAAL</b></font></para>',
                s["Body"],
            )
        ]],
        colWidths=[inner_w], rowHeights=[7 * mm, 9 * mm],
    )
    brand_band.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), accent),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ROUNDEDCORNERS", [4, 4, 0, 0]),
    ]))
    el.append(brand_band)

    # 2) Grote QR — gecentreerd
    qr_png = _make_qr_png(portal_url, size_px=600)
    qr_img = RLImage(io.BytesIO(qr_png), width=70 * mm, height=70 * mm)
    qr_block = Table([[qr_img]], colWidths=[inner_w])
    qr_block.setStyle(TableStyle([
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    el.append(qr_block)

    # 3) Hoofd-instructie
    el.append(Paragraph(
        '<para align="center"><b>Scan voor mijn huurportaal</b></para>',
        ParagraphStyle("PosterMain", parent=s["Body"], fontSize=11, leading=13,
                       textColor=DARK, spaceAfter=2),
    ))
    el.append(Paragraph(
        '<para align="center"><font color="#6b7280" size="8">'
        'Betalen · Kwitanties · Onderhoud melden'
        '</font></para>',
        s["Body"],
    ))
    el.append(Spacer(1, 4 * mm))

    # 4) Tenant + appartement info (alleen bij per-huurder variant)
    if tenant_name or apartment_number:
        rows = []
        if tenant_name:
            rows.append([
                Paragraph(
                    '<font color="#6b7280" size="7">VOOR</font>',
                    s["Body"],
                ),
                Paragraph(
                    f'<b>{tenant_name}</b>',
                    ParagraphStyle("PosterTenant", parent=s["Body"], fontSize=9,
                                   leading=11, textColor=DARK),
                ),
            ])
        if apartment_number:
            apt_label = f"Appt. {apartment_number}"
            if apartment_address:
                apt_label += f" · {apartment_address}"
            rows.append([
                Paragraph(
                    '<font color="#6b7280" size="7">ADRES</font>',
                    s["Body"],
                ),
                Paragraph(
                    apt_label,
                    ParagraphStyle("PosterAddr", parent=s["Body"], fontSize=8,
                                   leading=10, textColor=DARK),
                ),
            ])
        info = Table(rows, colWidths=[14 * mm, inner_w - 14 * mm])
        info.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("BACKGROUND", (0, 0), (-1, -1), LIGHT),
            ("BOX", (0, 0), (-1, -1), 0.4, colors.HexColor("#E5E7EB")),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))
        el.append(info)
        el.append(Spacer(1, 3 * mm))

    # 5) Footer
    el.append(Paragraph(
        f'<para align="center"><font color="#9CA3AF" size="6">'
        f'{(company_name or "SuriRent")} · Powered by SuriRent'
        f'</font></para>',
        s["Body"],
    ))

    return _build_a6(el)



def luxury_plate_pdf(*, tenant_name: str, apartment_number: str,
                     address: str, company_name: str,
                     kiosk_url: str, company_logo: bytes | None = None,
                     accent_hex: str = "#D4AF37",
                     size: str = "medium") -> bytes:
    """Luxueuze "gouden plaat" QR-poster per huurder, gegenereerd door de
    door de gebruiker geleverde template-afbeelding (1536×1024 PNG) als
    achtergrond te gebruiken en alleen de dynamische delen erboven te
    overlayen: bedrijfsnaam, transparante QR-code, HUIS-nummer, en adres.

    Template-bestand: /app/backend/assets/qr-plate-template.png
    """
    import os
    from PIL import Image as PILImage
    from PIL import ImageDraw, ImageFont
    import qrcode

    # 1) Template laden
    template_path = "/app/backend/assets/qr-plate-template.png"
    if not os.path.exists(template_path):
        # Fallback: laadbare alternatieve template, anders error
        raise FileNotFoundError(f"QR plate template ontbreekt: {template_path}")
    img = PILImage.open(template_path).convert("RGB")
    W, H = img.size  # 1536 × 1024
    draw = ImageDraw.Draw(img)

    # Goud-kleur die overeenkomt met de template (gesampled uit de afbeelding)
    GOLD = (212, 174, 92)
    GOLD_LIGHT = (232, 199, 102)
    PLATE_BLACK = (14, 13, 10)  # warm-zwart, exact gesampled uit template

    # Helper om TTF te laden (Liberation Sans Bold lijkt visueel op Helvetica)
    def font_at(size: int):
        for fp in (
            "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        ):
            if os.path.exists(fp):
                return ImageFont.truetype(fp, size)
        return ImageFont.load_default()

    # STAP 0 — Maskeer de COMPLETE binnenkant van de plaat met flat zwart,
    # zodat we vers kunnen tekenen. Bewust GEEN cropping uit andere delen
    # van de template (kopieerde de bestaande tekst over zichzelf heen!).
    # We behouden:
    #   • Gouden buitenrand
    #   • Logo regio links (x < 600, y in 150..820)
    #   • Schroef-cirkels in onderhoeken
    # Alles binnen het zwarte vlak wordt vers opgebouwd.

    # Mask alle bestaande sjabloon-tekst zodat we vers kunnen overschilderen.
    # We behouden bewust: gouden buitenrand, het S-huis logo links, en de
    # 4 schroef-cirkels bij de onderhoeken.
    # Bovenste rechterzone — verbergt "Gopi", "Appartement's", QR, scan-tekst
    draw.rectangle([540, 130, W - 130, 640], fill=PLATE_BLACK)
    # Onderste midden-strook — verbergt "HUIS 7B" + "Kewalbansingweg 7 B".
    # Begin/eind binnen de schroef-zone (~x=260 ↔ x=1280) zodat de schroeven
    # in de hoeken intact blijven.
    draw.rectangle([260, 640, W - 260, H - 130], fill=PLATE_BLACK)

    # 2) BEDRIJFSNAAM — alles in rechterhelft is al zwart gemaskeerd in STAP 0.
    company_name_clean = (company_name or "").strip() or "Bedrijf"
    # Tekst-zone (rechts van logo, met marge zodat het logo intact blijft)
    cn_x0, cn_y0, cn_x1, cn_y1 = 600, 230, 1080, 480
    # Auto-fit font op breedte
    cn_size = 130
    while cn_size > 50:
        cn_font = font_at(cn_size)
        bbox = draw.textbbox((0, 0), company_name_clean, font=cn_font)
        if (bbox[2] - bbox[0]) <= (cn_x1 - cn_x0) and (bbox[3] - bbox[1]) <= 160:
            break
        cn_size -= 8
    cn_font = font_at(cn_size)
    bbox = draw.textbbox((0, 0), company_name_clean, font=cn_font)
    cn_h = bbox[3] - bbox[1]
    text_x = cn_x0
    text_y = cn_y0 + ((cn_y1 - cn_y0) - cn_h) // 2 - bbox[1] - 30
    draw.text((text_x, text_y), company_name_clean, fill=GOLD, font=cn_font)
    # "Appartement's" subtekst onder bedrijfsnaam
    sub_font = font_at(50)
    sub_x = cn_x0 + 8
    sub_y = text_y + cn_h + 30
    draw.text((sub_x, sub_y), "Appartement's", fill=GOLD_LIGHT, font=sub_font)

    # 3) QR-CODE — overlay vers in de top-right zone (al gemaskeerd in STAP 0)
    qr_x0, qr_y0, qr_x1, qr_y1 = 1120, 160, 1395, 440
    # Gouden frame rond QR (vers tekenen)
    frame_thickness = 6
    draw.rectangle([qr_x0, qr_y0, qr_x1, qr_y1], outline=GOLD, width=frame_thickness)
    # Klein binnen-margin tussen frame en QR
    inner = 14
    # Nieuwe transparante QR (goud op plaat-zwart, naadloos met achtergrond)
    qr_box_size = qr_x1 - qr_x0 - 2 * inner  # ~257px
    qr = qrcode.QRCode(box_size=10, border=0, error_correction=qrcode.constants.ERROR_CORRECT_H)
    qr.add_data(kiosk_url)
    qr.make(fit=True)
    qr_pil = qr.make_image(fill_color=GOLD, back_color=PLATE_BLACK).convert("RGB")
    qr_resized = qr_pil.resize((qr_box_size, qr_box_size), PILImage.NEAREST)
    img.paste(qr_resized, (qr_x0 + inner, qr_y0 + inner))

    # Horizontale scheidingslijn boven HUIS-tekst (gouden lijn vers tekenen)
    div_y = 620
    draw.line([(180, div_y), (W - 180, div_y)], fill=GOLD, width=4)

    # 4) HUIS XX
    apt_clean = (apartment_number or "").strip()
    upper = apt_clean.upper()
    if upper.startswith("HUIS "):
        apt_clean = apt_clean[5:].strip()
    elif upper.startswith("APPARTEMENT "):
        apt_clean = apt_clean[12:].strip()
    headline = f"HUIS {apt_clean}".upper()
    huis_y0, huis_y1 = 660, 830
    # Auto-fit font
    huis_size = 200
    while huis_size > 80:
        huis_font = font_at(huis_size)
        bbox = draw.textbbox((0, 0), headline, font=huis_font)
        if (bbox[2] - bbox[0]) <= (W - 360):
            break
        huis_size -= 10
    huis_font = font_at(huis_size)
    bbox = draw.textbbox((0, 0), headline, font=huis_font)
    hw = bbox[2] - bbox[0]
    hh = bbox[3] - bbox[1]
    hx = (W - hw) // 2
    hy = huis_y0 + ((huis_y1 - huis_y0) - hh) // 2 - bbox[1]
    draw.text((hx, hy), headline, fill=GOLD, font=huis_font)

    # 5) ADRES (al gemaskeerd in STAP 0)
    addr_x0, addr_y0, addr_x1, addr_y1 = 240, 860, 1280, 940
    if address:
        addr_text = address
        addr_size = 56
        while addr_size > 24:
            addr_font = font_at(addr_size)
            bbox = draw.textbbox((0, 0), addr_text, font=addr_font)
            if (bbox[2] - bbox[0]) <= (addr_x1 - addr_x0 - 100):
                break
            addr_size -= 4
        addr_font = font_at(addr_size)
        bbox = draw.textbbox((0, 0), addr_text, font=addr_font)
        aw = bbox[2] - bbox[0]
        ah = bbox[3] - bbox[1]
        # Pin-icoon + tekst, samen gecentreerd
        pin_d = max(20, addr_size // 2)
        total_w = pin_d + 12 + aw
        start_x = (W - total_w) // 2
        addr_baseline_y = addr_y0 + ((addr_y1 - addr_y0) - ah) // 2 - bbox[1]
        # Pin tekenen (druppel-shape: cirkel + driehoek)
        pin_cx = start_x + pin_d // 2
        pin_cy = addr_baseline_y + ah // 2 - 4
        draw.ellipse(
            [pin_cx - pin_d // 2, pin_cy - pin_d // 2,
             pin_cx + pin_d // 2, pin_cy + pin_d // 2],
            fill=GOLD,
        )
        draw.polygon(
            [(pin_cx - pin_d // 3, pin_cy + pin_d // 4),
             (pin_cx + pin_d // 3, pin_cy + pin_d // 4),
             (pin_cx, pin_cy + pin_d)],
            fill=GOLD,
        )
        # Gat in pin
        hole_r = max(3, pin_d // 6)
        draw.ellipse(
            [pin_cx - hole_r, pin_cy - hole_r,
             pin_cx + hole_r, pin_cy + hole_r],
            fill=PLATE_BLACK,
        )
        # Adres tekst
        draw.text((start_x + pin_d + 12, addr_baseline_y), addr_text,
                  fill=GOLD_LIGHT, font=addr_font)

    # 6) PNG → PDF conversie. Behoud volledige resolutie, 3:2 landscape.
    pdf_buf = io.BytesIO()
    from reportlab.pdfgen import canvas as rl_canvas
    from reportlab.lib.utils import ImageReader
    SIZE_MAP = {
        "small":  (200, 133),
        "medium": (300, 200),
        "large":  (400, 267),
    }
    pw, ph = SIZE_MAP.get(size, SIZE_MAP["medium"])
    PAGE_W = pw * mm
    PAGE_H = ph * mm
    c = rl_canvas.Canvas(pdf_buf, pagesize=(PAGE_W, PAGE_H))
    c.setFillColor(colors.HexColor("#dcd6cd"))
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    out = io.BytesIO()
    img.save(out, format="PNG", optimize=True)
    out.seek(0)
    c.drawImage(ImageReader(out), 0, 0, PAGE_W, PAGE_H,
                preserveAspectRatio=True, anchor='c')
    c.showPage()
    c.save()
    pdf_buf.seek(0)
    return pdf_buf.getvalue()



# ---------------------------------------------------------------------------
# AI-powered "Luxury Gold Plaque" generator — gebruikt Gemini Nano Banana om
# de dynamische tekst in de template afbeelding te vervangen met behoud van
# het 3D-embossed gouden effect, lederen textuur en schroef-details.
# ---------------------------------------------------------------------------

async def _nano_banana_edit_plate(template_bytes: bytes, *, company_name: str,
                                  apartment_number: str, address: str,
                                  session_suffix: str = "") -> bytes:
    """Stuurt template + edit-instructies naar Gemini Nano Banana.

    Returns: edited PNG bytes (1536x1024).
    Raises: RuntimeError als generatie faalt of geen image teruggegeven wordt.
    """
    import os
    import base64
    import uuid
    from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent

    api_key = os.getenv("EMERGENT_LLM_KEY")
    if not api_key:
        raise RuntimeError("EMERGENT_LLM_KEY ontbreekt in environment")

    # Normaliseer huisnummer ("HUIS 7B" stijl)
    apt = (apartment_number or "").strip()
    upper = apt.upper()
    if upper.startswith("HUIS "):
        apt = apt[5:].strip()
    elif upper.startswith("APPARTEMENT "):
        apt = apt[12:].strip()
    huis_label = f"HUIS {apt}".upper() if apt else "HUIS"

    company_clean = (company_name or "").strip() or "Bedrijf"
    address_clean = (address or "").strip()

    # Prompt — uiterst expliciet zodat de AI alléén de tekst vervangt en
    # niet de hele compositie hertekent. Engels werkt het meest betrouwbaar.
    prompt = (
        "You are editing a luxury 3D-embossed gold-on-black house plaque. "
        "Keep the EXACT same composition, materials, lighting, leather texture, "
        "polished gold outer border, and the two metal screw heads in the "
        "bottom corners. "
        "CRITICAL — DO NOT REMOVE OR MODIFY THE LOGO: There is a large 3D "
        "embossed gold 'S-shaped house' logo on the LEFT side of the plaque "
        "(an S that doubles as a stylized house with a triangular roof and four "
        "small window squares inside). This logo MUST remain fully intact, in "
        "the same position, with the same 3D embossing and gold finish. Do not "
        "shrink it, move it, replace it with text, or remove it. "
        "Also keep the horizontal gold divider line below the QR area. "
        "Do NOT redesign the plaque. Only replace the text content as follows, "
        "preserving the same embossed gold typography (3D extruded letters with "
        "realistic highlights and shadows, matching the existing engraving "
        "depth):\n\n"
        f"1. Replace the large company-name text (currently 'Gopi') with: '{company_clean}'. "
        "If the company name is long, wrap it onto two lines so it stays inside "
        "the left-half region (must NOT cross to the right of approximately x=1050 "
        "in a 1536-wide image — the QR code on the right must remain clear).\n"
        f"2. Keep the smaller subtext 'Appartement\u2019s' directly underneath it.\n"
        f"3. Replace the large bottom heading (currently 'HUIS 7B') with: '{huis_label}'\n"
        f"4. Replace the address line with pin icon (currently 'Kewalbansingweg 7 B') with: "
        f"'{address_clean or 'Adres niet ingevuld'}'\n"
        "5. CRITICAL: Completely REMOVE both the existing QR code pattern AND its "
        "gold frame from the top-right area. In that entire region, render only "
        "the flat warm-black plaque background with the same leather/grain texture "
        "as the rest of the plaque — no QR pixels, no frame, no border, no "
        "rectangle, nothing. We will draw a new QR code with its own gold frame "
        "on top afterwards. Leave that ~340x310 px area in the top-right corner "
        "as a clean empty black surface.\n"
        "6. Keep the small 'Scan voor mijn huurportaal / Betalen \u00b7 Kwitanties \u00b7 Onderhoud melden' "
        "text under the QR exactly as it appears.\n\n"
        "Output: a single full-resolution photorealistic PNG of the edited plaque, "
        "identical aspect ratio and dimensions to the input (1536\u00d71024). "
        "No extra borders, no white margins, no captions."
    )

    image_b64 = base64.b64encode(template_bytes).decode("utf-8")

    # Retry tot 3x — Nano Banana faalt soms zonder fout (lege response).
    last_err: Exception | None = None
    for attempt in range(3):
        chat = LlmChat(
            api_key=api_key,
            session_id=f"plate-{uuid.uuid4().hex[:8]}{session_suffix}-{attempt}",
            system_message=(
                "You are a precision image editor that preserves source "
                "compositions while replacing only the specified text."
            ),
        )
        chat.with_model("gemini", "gemini-3.1-flash-image-preview").with_params(
            modalities=["image", "text"]
        )
        msg = UserMessage(text=prompt, file_contents=[ImageContent(image_b64)])
        try:
            _text, images = await chat.send_message_multimodal_response(msg)
        except Exception as e:
            last_err = e
            continue
        if images:
            return base64.b64decode(images[0]["data"])
        last_err = RuntimeError("Nano Banana gaf geen afbeelding terug")

    raise last_err or RuntimeError("Nano Banana faalde na 3 pogingen")


async def luxury_plate_pdf_ai(*, tenant_name: str, apartment_number: str,
                              address: str, company_name: str,
                              kiosk_url: str, company_logo: bytes | None = None,
                              accent_hex: str = "#D4AF37",
                              size: str = "medium") -> bytes:
    """AI-versie van :func:`luxury_plate_pdf`. Gebruikt Gemini Nano Banana om
    de dynamische tekst in de template te vervangen met behoud van het
    3D-embossed gouden effect, en plakt vervolgens een echte scanbare QR-code
    over het door de AI gegenereerde QR-gebied (anders is de QR niet
    betrouwbaar scanbaar).
    """
    import os
    from PIL import Image as PILImage
    import qrcode

    template_path = "/app/backend/assets/qr-plate-template.png"
    if not os.path.exists(template_path):
        raise FileNotFoundError(f"QR plate template ontbreekt: {template_path}")
    with open(template_path, "rb") as f:
        template_bytes = f.read()

    # 1) AI-edit van de plaat
    edited_png = await _nano_banana_edit_plate(
        template_bytes,
        company_name=company_name,
        apartment_number=apartment_number,
        address=address,
    )

    # 2) Echte scanbare QR genereren en op het QR-gebied plakken.
    # Nano Banana kan geen pixel-perfecte scanbare QR-code garanderen, dus we
    # overlayen een echte QR op de bekende positie van het QR-frame. We maken
    # de mask-zone bewust groter dan het frame zodat eventuele AI-resten
    # (offset/groter getekende QR) volledig overschilderd worden.
    img = PILImage.open(io.BytesIO(edited_png)).convert("RGB")
    # Resize naar canonieke 1536x1024 voor consistente coördinaten.
    if img.size != (1536, 1024):
        img = img.resize((1536, 1024), PILImage.LANCZOS)

    from PIL import ImageDraw as _ImageDraw
    draw = _ImageDraw.Draw(img)

    GOLD = (212, 174, 92)
    PLATE_BLACK = (14, 13, 10)
    # QR-frame coördinaten in het template
    qr_x0, qr_y0, qr_x1, qr_y1 = 1120, 160, 1395, 440
    # STAP 2a: Mask het hele QR-gebied zwart (iets ruimer dan het frame zodat
    # eventueel AI-restant van frame/QR verdwijnt). We blijven binnen veilige
    # grenzen: rechts/onder dicht bij de plaquette-rand, links niet over de
    # bedrijfsnaam (die op 2 regels staat tot ~x=1060) heen.
    safety = 16
    mask_x0 = qr_x0 - safety
    mask_y0 = qr_y0 - safety
    mask_x1 = qr_x1 + safety
    mask_y1 = qr_y1 + safety
    draw.rectangle([mask_x0, mask_y0, mask_x1, mask_y1], fill=PLATE_BLACK)

    # STAP 2b: Teken zelf een 3D-achtig gouden frame op vaste coördinaten
    # zodat het altijd uitgelijnd is met de QR-overlay. Meerdere concentrische
    # lijnen met goud-tinten suggereren een bevel/emboss-effect.
    GOLD_LIGHT = (240, 210, 130)
    GOLD_DARK = (140, 110, 50)
    # 6px dik frame opgebouwd uit: 1px donker (buiten) + 4px goud + 1px licht (binnen)
    # buitenste donkere schaduwlijn
    draw.rectangle([qr_x0, qr_y0, qr_x1, qr_y1], outline=GOLD_DARK, width=1)
    # 4 goud-lijnen voor body
    for k in range(1, 5):
        draw.rectangle(
            [qr_x0 + k, qr_y0 + k, qr_x1 - k, qr_y1 - k],
            outline=GOLD, width=1,
        )
    # binnenste licht-goud hooglicht op boven + linkerrand (bevel boven-links)
    draw.line([(qr_x0 + 5, qr_y0 + 5), (qr_x1 - 5, qr_y0 + 5)],
              fill=GOLD_LIGHT, width=1)  # boven
    draw.line([(qr_x0 + 5, qr_y0 + 5), (qr_x0 + 5, qr_y1 - 5)],
              fill=GOLD_LIGHT, width=1)  # links
    # binnenste donker-goud op onder + rechterrand (schaduw onder-rechts)
    draw.line([(qr_x0 + 5, qr_y1 - 5), (qr_x1 - 5, qr_y1 - 5)],
              fill=GOLD_DARK, width=1)  # onder
    draw.line([(qr_x1 - 5, qr_y0 + 5), (qr_x1 - 5, qr_y1 - 5)],
              fill=GOLD_DARK, width=1)  # rechts
    # STAP 2c: De echte scanbare QR-code centreren binnen het mask-paneel.
    inner = 14
    qr_box_size = qr_x1 - qr_x0 - 2 * inner

    qr = qrcode.QRCode(box_size=10, border=0,
                       error_correction=qrcode.constants.ERROR_CORRECT_H)
    qr.add_data(kiosk_url)
    qr.make(fit=True)
    qr_pil = qr.make_image(fill_color=GOLD, back_color=PLATE_BLACK).convert("RGB")
    qr_resized = qr_pil.resize((qr_box_size, qr_box_size), PILImage.NEAREST)
    img.paste(qr_resized, (qr_x0 + inner, qr_y0 + inner))

    # 3) PNG → PDF (zelfde layout als de PIL-versie)
    pdf_buf = io.BytesIO()
    from reportlab.pdfgen import canvas as rl_canvas
    from reportlab.lib.utils import ImageReader
    # PDF-pagina exact 3:2 landschap formaat, configureerbare grootte.
    SIZE_MAP = {
        "small":  (200, 133),   # ~A5 landschap
        "medium": (300, 200),   # ~A4 landschap (default)
        "large":  (400, 267),   # ~A3 landschap
    }
    pw, ph = SIZE_MAP.get(size, SIZE_MAP["medium"])
    PAGE_W = pw * mm
    PAGE_H = ph * mm
    c = rl_canvas.Canvas(pdf_buf, pagesize=(PAGE_W, PAGE_H))
    c.setFillColor(colors.HexColor("#dcd6cd"))
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    # Plaat volledig vullend (geen marges, hele pagina = de plaat-image,
    # ratio matcht exact 1536×1024 = 3:2 dus geen vervorming).
    out = io.BytesIO()
    img.save(out, format="PNG", optimize=True)
    out.seek(0)
    c.drawImage(ImageReader(out), 0, 0, PAGE_W, PAGE_H,
                preserveAspectRatio=True, anchor='c')
    c.showPage()
    c.save()
    pdf_buf.seek(0)
    return pdf_buf.getvalue()



# =====================================================================
# Nieuwe kwitantie: "Blue House" ontwerp (op verzoek gebruiker, feb 2026).
# Volledig canvas-gebaseerd voor pixel-perfecte layout. A4 landscape zodat
# de brede tabel + betaalwijze-checkboxes op één pagina passen.
# =====================================================================
_BH_INK = colors.HexColor("#0D3B7A")      # Deep navy blue — borders/text
_BH_BAND = colors.HexColor("#DCE7F5")     # Light blue fill for header box + table row
_BH_ROW_FILL = colors.HexColor("#E9F0F9")  # Alt light blue for line-item row


def _bh_fmt_money(amount: float, currency: str = "SRD") -> str:
    """Nederlandse notatie: `5600` → `SRD 5.600,00`."""
    try:
        s = f"{float(amount):,.2f}"
        # ',' → '.' voor duizend, '.' → ',' voor decimaal
        s = s.replace(",", "X").replace(".", ",").replace("X", ".")
        return f"{currency} {s}"
    except Exception:
        return f"{currency} {amount}"


def _bh_house_icon(c, x, y, size):
    """Teken een simpele blauwe huisje-icoon (dak + gevel + venster) als
    linker-logo. Als het bedrijf een eigen logo heeft, wordt dat gebruikt
    ipv deze fallback."""
    c.saveState()
    c.setStrokeColor(_BH_INK)
    c.setFillColor(_BH_INK)
    c.setLineWidth(1.5)
    # Dak (driehoek)
    p = c.beginPath()
    p.moveTo(x, y + size * 0.55)
    p.lineTo(x + size * 0.5, y + size)
    p.lineTo(x + size, y + size * 0.55)
    p.close()
    c.drawPath(p, stroke=1, fill=1)
    # Gevel (rechthoek)
    body_h = size * 0.55
    c.rect(x + size * 0.1, y, size * 0.8, body_h, stroke=1, fill=1)
    # Venster (wit)
    c.setFillColor(colors.white)
    win_size = size * 0.22
    c.rect(x + size * 0.28, y + size * 0.12, win_size, win_size, stroke=0, fill=1)
    c.rect(x + size * 0.55, y + size * 0.12, win_size, win_size, stroke=0, fill=1)
    # Vensterkruis
    c.setStrokeColor(_BH_INK)
    c.setLineWidth(0.8)
    c.line(x + size * 0.28 + win_size / 2, y + size * 0.12,
           x + size * 0.28 + win_size / 2, y + size * 0.12 + win_size)
    c.line(x + size * 0.28, y + size * 0.12 + win_size / 2,
           x + size * 0.28 + win_size, y + size * 0.12 + win_size / 2)
    c.line(x + size * 0.55 + win_size / 2, y + size * 0.12,
           x + size * 0.55 + win_size / 2, y + size * 0.12 + win_size)
    c.line(x + size * 0.55, y + size * 0.12 + win_size / 2,
           x + size * 0.55 + win_size, y + size * 0.12 + win_size / 2)
    c.restoreState()


def _bh_checkbox(c, x, y, size, checked=False):
    """Teken een vierkant checkbox-icoon; indien checked, teken een dikke
    blauwe vinkje binnenin."""
    c.saveState()
    c.setStrokeColor(_BH_INK)
    c.setLineWidth(1.2)
    c.setFillColor(colors.white)
    c.rect(x, y, size, size, stroke=1, fill=1)
    if checked:
        c.setStrokeColor(_BH_INK)
        c.setLineWidth(2.2)
        c.setLineCap(1)
        c.line(x + size * 0.18, y + size * 0.48,
               x + size * 0.42, y + size * 0.22)
        c.line(x + size * 0.42, y + size * 0.22,
               x + size * 0.85, y + size * 0.72)
    c.restoreState()


def receipt_pdf_blue_house(payment: dict) -> bytes:
    """Nieuwe kwitantie in blauw huisje-ontwerp — één A4 landscape pagina.

    Layout:
      • Dikke blauwe dubbele-rand rond de hele pagina
      • Header: huisje-icoon + KWITANTIE-titel + subtitel + italic tagline;
        rechts een lichtblauw kader met "Kwitantie nr.:" en "Datum:"
      • Twee-koloms Verhuurder | Huurder met verticale scheidingslijn
      • Tabel Omschrijving | Bedrag + Totaal ontvangen-rij (blauwe kop)
      • Betaalwijze-rij: 3 checkboxes (Contant/Bankoverschrijving/Anders)
      • Verklaring-paragraaf + Opmerking-sectie
      • Twee handtekeningen-lijnen onderaan
    """
    from reportlab.pdfgen import canvas as _canvas
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.utils import ImageReader

    PAGE_W, PAGE_H = landscape(A4)  # 842 × 595 pt
    buf = io.BytesIO()
    c = _canvas.Canvas(buf, pagesize=(PAGE_W, PAGE_H))
    c.setTitle(f"Kwitantie {payment.get('receipt_number', '')}")

    # ---- Dubbele blauwe pagina-rand
    margin = 14 * mm
    c.setStrokeColor(_BH_INK)
    c.setLineWidth(2.5)
    c.rect(margin, margin, PAGE_W - 2 * margin, PAGE_H - 2 * margin, stroke=1, fill=0)
    c.setLineWidth(0.6)
    inner = margin + 3
    c.rect(inner, inner, PAGE_W - 2 * inner, PAGE_H - 2 * inner, stroke=1, fill=0)

    # ---- Content area binnen dubbele rand
    pad = margin + 10 * mm
    right_x = PAGE_W - pad

    # ---- Header: logo/huisje + titel-blok links; kwitantie-info kader rechts
    header_top = PAGE_H - pad - 5
    icon_size = 38 * mm / 1.8  # ~21mm
    logo_bytes = payment.get("company_logo_bytes")
    if logo_bytes:
        try:
            c.drawImage(ImageReader(io.BytesIO(logo_bytes)),
                        pad, header_top - icon_size, icon_size, icon_size,
                        preserveAspectRatio=True, mask="auto")
        except Exception:
            _bh_house_icon(c, pad, header_top - icon_size, icon_size)
    else:
        _bh_house_icon(c, pad, header_top - icon_size, icon_size)

    title_x = pad + icon_size + 8 * mm
    c.setFillColor(_BH_INK)
    c.setFont(_LUX_SANS_BOLD, 30)
    c.drawString(title_x, header_top - 7 * mm, "KWITANTIE")
    c.setFont(_LUX_SANS_BOLD, 10)
    c.drawString(title_x, header_top - 13 * mm, "HUURBETALING / HUUROVEREENKOMST")
    c.setFont("Helvetica-Oblique", 9)
    c.setFillColor(colors.HexColor("#3A5A85"))
    c.drawString(title_x, header_top - 19 * mm, "Ontvangen betaling voor de huur van het appartement.")

    # Rechter info-kader
    box_w = 78 * mm
    box_h = 24 * mm
    box_x = right_x - box_w
    box_y = header_top - box_h + 3
    c.setFillColor(_BH_BAND)
    c.setStrokeColor(_BH_INK)
    c.setLineWidth(0.6)
    c.rect(box_x, box_y, box_w, box_h, stroke=1, fill=1)
    c.setFillColor(_BH_INK)
    c.setFont(_LUX_SANS_BOLD, 10)
    c.drawString(box_x + 5 * mm, box_y + box_h - 8 * mm, "Kwitantie nr.:")
    c.drawString(box_x + 5 * mm, box_y + box_h - 16 * mm, "Datum:")
    c.setFont(_LUX_SANS, 10)
    c.drawString(box_x + 32 * mm, box_y + box_h - 8 * mm, payment.get("receipt_number", "—"))
    c.drawString(box_x + 32 * mm, box_y + box_h - 16 * mm, _fmt_date_nl(payment.get("paid_at")))

    # ---- Verhuurder / Huurder blok
    info_top = header_top - 27 * mm
    col_w = (PAGE_W - 2 * pad - 6 * mm) / 2
    left_col_x = pad
    right_col_x = pad + col_w + 6 * mm

    def _party_block(x, y, title, rows):
        c.setFillColor(_BH_INK)
        c.setFont(_LUX_SANS_BOLD, 12)
        c.drawString(x, y, title)
        c.setLineWidth(0.4)
        c.setStrokeColor(_BH_INK)
        c.line(x, y - 3, x + 26 * mm, y - 3)
        c.setFont(_LUX_SANS, 10)
        for i, (label, value) in enumerate(rows):
            row_y = y - 8 * mm - i * 6 * mm
            c.setFillColor(_BH_INK)
            c.drawString(x + 2, row_y, label)
            c.drawString(x + 24 * mm, row_y, ":")
            c.setFillColor(colors.black)
            c.drawString(x + 27 * mm, row_y, value or "—")

    # Verhuurder-data uit company brand info
    landlord_name = payment.get("landlord") or payment.get("company_name") or "—"
    landlord_addr = payment.get("company_address") or "—"
    landlord_phone = payment.get("company_whatsapp") or payment.get("company_phone") or "—"

    # Huurder-data — appartement als "adres"
    tenant_name = payment.get("tenant_name") or "—"
    tenant_addr = ""
    if payment.get("apartment_number"):
        tenant_addr = f"Appartement {payment['apartment_number']}"
        if payment.get("location_name"):
            tenant_addr = f"{tenant_addr} — {payment['location_name']}"
    tenant_phone = payment.get("tenant_phone") or "—"

    _party_block(left_col_x, info_top, "Verhuurder:", [
        ("Naam", landlord_name),
        ("Adres", landlord_addr),
        ("Telefoon", landlord_phone),
    ])
    _party_block(right_col_x, info_top, "Huurder:", [
        ("Naam", tenant_name),
        ("Adres", tenant_addr or "—"),
        ("Telefoon", tenant_phone),
    ])

    # Verticale scheidingslijn tussen kolommen
    div_x = pad + col_w + 3 * mm
    c.setStrokeColor(_BH_INK)
    c.setLineWidth(0.5)
    c.line(div_x, info_top - 24 * mm, div_x, info_top + 3)

    # ---- Tabel: Omschrijving | Bedrag
    tbl_top = info_top - 34 * mm
    tbl_x = pad
    tbl_w = PAGE_W - 2 * pad
    row_h = 9 * mm
    # Header rij (lichtblauw)
    c.setFillColor(_BH_BAND)
    c.setStrokeColor(_BH_INK)
    c.setLineWidth(0.6)
    c.rect(tbl_x, tbl_top - row_h, tbl_w, row_h, stroke=1, fill=1)
    # Vertical splitter for Bedrag-column
    amt_col_w = 55 * mm
    c.line(tbl_x + tbl_w - amt_col_w, tbl_top - row_h, tbl_x + tbl_w - amt_col_w, tbl_top)
    c.setFillColor(_BH_INK)
    c.setFont(_LUX_SANS_BOLD, 11)
    c.drawString(tbl_x + 5 * mm, tbl_top - row_h + 2.5 * mm, "Omschrijving")
    c.drawString(tbl_x + tbl_w - amt_col_w + 5 * mm, tbl_top - row_h + 2.5 * mm, "Bedrag")

    # Regel: omschrijving
    period_lbl = ""
    if payment.get("period_month") and payment.get("period_year"):
        period_lbl = f"{MONTHS_NL[payment['period_month'] - 1]} {payment['period_year']}"
    category = (payment.get("category") or "huur").lower()
    if category == "huur" and period_lbl:
        omschrijving = f"Huur maand {period_lbl}"
    elif category:
        omschrijving = f"{category.capitalize()}" + (f" — {period_lbl}" if period_lbl else "")
    else:
        omschrijving = payment.get("note") or "Huurbetaling"

    amount = float(payment.get("amount") or 0)
    currency = payment.get("currency") or "SRD"

    c.setStrokeColor(_BH_INK)
    c.setFillColor(colors.white)
    c.rect(tbl_x, tbl_top - 2 * row_h, tbl_w, row_h, stroke=1, fill=1)
    c.line(tbl_x + tbl_w - amt_col_w, tbl_top - 2 * row_h, tbl_x + tbl_w - amt_col_w, tbl_top - row_h)
    c.setFillColor(colors.black)
    c.setFont(_LUX_SANS, 11)
    c.drawString(tbl_x + 5 * mm, tbl_top - 2 * row_h + 2.5 * mm, omschrijving)
    c.drawString(tbl_x + tbl_w - amt_col_w + 5 * mm, tbl_top - 2 * row_h + 2.5 * mm, _bh_fmt_money(amount, currency))

    # Totaal-rij (lichtblauw)
    c.setFillColor(_BH_BAND)
    c.rect(tbl_x, tbl_top - 3 * row_h, tbl_w, row_h, stroke=1, fill=1)
    c.line(tbl_x + tbl_w - amt_col_w, tbl_top - 3 * row_h, tbl_x + tbl_w - amt_col_w, tbl_top - 2 * row_h)
    c.setFillColor(_BH_INK)
    c.setFont(_LUX_SANS_BOLD, 11)
    c.drawString(tbl_x + 5 * mm, tbl_top - 3 * row_h + 2.5 * mm, "Totaal ontvangen")
    c.drawString(tbl_x + tbl_w - amt_col_w + 5 * mm, tbl_top - 3 * row_h + 2.5 * mm, _bh_fmt_money(amount, currency))

    # ---- Betaalwijze checkboxes
    bw_y = tbl_top - 3 * row_h - 10 * mm
    c.setFillColor(_BH_INK)
    c.setFont(_LUX_SANS_BOLD, 11)
    c.drawString(pad, bw_y, "Betaalwijze:")
    method = (payment.get("method") or "contant").lower()
    box_size = 4 * mm
    positions = [
        ("Contant", method == "contant"),
        ("Bankoverschrijving", method in ("bank", "bankoverschrijving", "overschrijving", "transfer")),
        ("Anders", method not in ("contant", "bank", "bankoverschrijving", "overschrijving", "transfer")),
    ]
    cx = pad + 30 * mm
    for label, checked in positions:
        _bh_checkbox(c, cx, bw_y - 1, box_size, checked=checked)
        c.setFillColor(_BH_INK)
        c.setFont(_LUX_SANS, 10)
        c.drawString(cx + box_size + 2 * mm, bw_y, label)
        cx += box_size + 2 * mm + c.stringWidth(label, _LUX_SANS, 10) + 8 * mm

    # Fill-in line na "Anders:"
    line_x = cx - 6 * mm
    line_end_x = right_x
    c.setStrokeColor(_BH_INK)
    c.setLineWidth(0.5)
    c.line(line_x, bw_y - 1.5, line_end_x, bw_y - 1.5)

    # ---- Verklaring-paragraaf
    decl_y = bw_y - 11 * mm
    c.setFillColor(colors.black)
    c.setFont(_LUX_SANS, 10)
    decl_text = (
        f"Hierbij verklaart de verhuurder dat hij/zij van de huurder het bedrag van "
        f"{_bh_fmt_money(amount, currency)} heeft ontvangen"
    )
    c.drawString(pad, decl_y, decl_text)
    c.drawString(pad, decl_y - 5 * mm, "voor de huur van het hierboven genoemde appartement.")

    # ---- Opmerking-sectie
    note_y = decl_y - 14 * mm
    c.setFillColor(_BH_INK)
    c.setFont(_LUX_SANS_BOLD, 11)
    c.drawString(pad, note_y, "Opmerking:")
    note_text = payment.get("note") or ""
    if not note_text and period_lbl:
        note_text = f"Deze betaling betreft uitsluitend de huur over {period_lbl}."
    c.setFillColor(colors.black)
    c.setFont(_LUX_SANS, 10)
    if note_text:
        c.drawString(pad, note_y - 5 * mm, note_text[:180])

    # ---- Handtekening-lijnen onderaan
    sig_y = pad + 12 * mm
    sig_w = 90 * mm
    c.setStrokeColor(_BH_INK)
    c.setLineWidth(0.7)
    c.line(pad, sig_y, pad + sig_w, sig_y)
    c.line(right_x - sig_w, sig_y, right_x, sig_y)
    c.setFillColor(_BH_INK)
    c.setFont(_LUX_SANS_BOLD, 9)
    c.drawString(pad, sig_y - 5 * mm, "Handtekening verhuurder")
    c.drawString(right_x - sig_w, sig_y - 5 * mm, "Handtekening huurder")

    c.showPage()
    c.save()
    buf.seek(0)
    return buf.getvalue()



# =====================================================================
# Reminder PDF (Blue House ontwerp) — samenvattingsblad met ALLE open
# facturen van één huurder. Wordt gerenderd naar JPG voor WhatsApp-share.
# =====================================================================
def reminder_pdf_blue_house(reminder: dict) -> bytes:
    """Genereer een betalingsherinnering-PDF met alle open facturen.

    Verwacht dict-velden:
      - company_name, company_address, company_phone, company_logo_bytes
      - tenant_name, tenant_phone, apartment_number, location_name
      - invoices: [{ period_month, period_year, amount, paid_amount, remaining_amount,
                     currency, invoice_number, is_historical, description }]
      - currency, total_open (float)
      - reference_date (ISO string, default = today)
    """
    from reportlab.pdfgen import canvas as _canvas
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.utils import ImageReader

    PAGE_W, PAGE_H = landscape(A4)
    buf = io.BytesIO()
    c = _canvas.Canvas(buf, pagesize=(PAGE_W, PAGE_H))
    c.setTitle("Betalingsherinnering")

    margin = 14 * mm
    c.setStrokeColor(_BH_INK); c.setLineWidth(2.5)
    c.rect(margin, margin, PAGE_W - 2 * margin, PAGE_H - 2 * margin, stroke=1, fill=0)
    c.setLineWidth(0.6)
    inner = margin + 3
    c.rect(inner, inner, PAGE_W - 2 * inner, PAGE_H - 2 * inner, stroke=1, fill=0)

    pad = margin + 10 * mm
    right_x = PAGE_W - pad
    header_top = PAGE_H - pad - 5

    # Logo/huisje
    icon_size = 38 * mm / 1.8
    logo_bytes = reminder.get("company_logo_bytes")
    if logo_bytes:
        try:
            c.drawImage(ImageReader(io.BytesIO(logo_bytes)),
                        pad, header_top - icon_size, icon_size, icon_size,
                        preserveAspectRatio=True, mask="auto")
        except Exception:
            _bh_house_icon(c, pad, header_top - icon_size, icon_size)
    else:
        _bh_house_icon(c, pad, header_top - icon_size, icon_size)

    title_x = pad + icon_size + 8 * mm
    c.setFillColor(_BH_INK)
    c.setFont(_LUX_SANS_BOLD, 26)
    c.drawString(title_x, header_top - 7 * mm, "BETALINGSHERINNERING")
    c.setFont(_LUX_SANS_BOLD, 10)
    c.drawString(title_x, header_top - 13 * mm, "OVERZICHT OPENSTAANDE HUUR")
    c.setFont("Helvetica-Oblique", 9)
    c.setFillColor(colors.HexColor("#3A5A85"))
    c.drawString(title_x, header_top - 19 * mm, "Vriendelijk verzoek om de openstaande huur zo spoedig mogelijk te voldoen.")

    # Info-kader rechts: datum
    box_w = 78 * mm; box_h = 18 * mm
    box_x = right_x - box_w
    box_y = header_top - box_h + 3
    c.setFillColor(_BH_BAND); c.setStrokeColor(_BH_INK); c.setLineWidth(0.6)
    c.rect(box_x, box_y, box_w, box_h, stroke=1, fill=1)
    c.setFillColor(_BH_INK); c.setFont(_LUX_SANS_BOLD, 10)
    c.drawString(box_x + 5 * mm, box_y + box_h - 8 * mm, "Datum:")
    c.setFont(_LUX_SANS, 10)
    c.drawString(box_x + 22 * mm, box_y + box_h - 8 * mm, _fmt_date_nl(reminder.get("reference_date")) or _fmt_date_nl(datetime.utcnow().isoformat()))

    # Verhuurder / Huurder blok
    info_top = header_top - 27 * mm
    col_w = (PAGE_W - 2 * pad - 6 * mm) / 2
    left_col_x = pad
    right_col_x = pad + col_w + 6 * mm

    def _party(x, y, title, rows):
        c.setFillColor(_BH_INK); c.setFont(_LUX_SANS_BOLD, 12)
        c.drawString(x, y, title)
        c.setLineWidth(0.4); c.setStrokeColor(_BH_INK)
        c.line(x, y - 3, x + 26 * mm, y - 3)
        c.setFont(_LUX_SANS, 10)
        for i, (label, value) in enumerate(rows):
            row_y = y - 8 * mm - i * 6 * mm
            c.setFillColor(_BH_INK); c.drawString(x + 2, row_y, label)
            c.drawString(x + 24 * mm, row_y, ":")
            c.setFillColor(colors.black); c.drawString(x + 27 * mm, row_y, value or "—")

    tenant_addr = ""
    if reminder.get("apartment_number"):
        tenant_addr = f"Appartement {reminder['apartment_number']}"
        if reminder.get("location_name"):
            tenant_addr = f"{tenant_addr} — {reminder['location_name']}"
    _party(left_col_x, info_top, "Verhuurder:", [
        ("Naam", reminder.get("company_name") or "—"),
        ("Adres", reminder.get("company_address") or "—"),
        ("Telefoon", reminder.get("company_phone") or "—"),
    ])
    _party(right_col_x, info_top, "Huurder:", [
        ("Naam", reminder.get("tenant_name") or "—"),
        ("Adres", tenant_addr or "—"),
        ("Telefoon", reminder.get("tenant_phone") or "—"),
    ])

    div_x = pad + col_w + 3 * mm
    c.setStrokeColor(_BH_INK); c.setLineWidth(0.5)
    c.line(div_x, info_top - 24 * mm, div_x, info_top + 3)

    # ---- Tabel: Periode | Factuur nr | Bedrag
    invoices = list(reminder.get("invoices") or [])
    tbl_top = info_top - 34 * mm
    tbl_x = pad
    tbl_w = PAGE_W - 2 * pad
    row_h = 8.5 * mm
    period_col_x = tbl_x
    nr_col_x = tbl_x + 55 * mm
    amt_col_w = 50 * mm
    amt_col_x = tbl_x + tbl_w - amt_col_w

    # Header
    c.setFillColor(_BH_BAND); c.setStrokeColor(_BH_INK); c.setLineWidth(0.6)
    c.rect(tbl_x, tbl_top - row_h, tbl_w, row_h, stroke=1, fill=1)
    c.line(nr_col_x, tbl_top - row_h, nr_col_x, tbl_top)
    c.line(amt_col_x, tbl_top - row_h, amt_col_x, tbl_top)
    c.setFillColor(_BH_INK); c.setFont(_LUX_SANS_BOLD, 11)
    c.drawString(period_col_x + 5 * mm, tbl_top - row_h + 2.5 * mm, "Periode")
    c.drawString(nr_col_x + 5 * mm, tbl_top - row_h + 2.5 * mm, "Factuurnummer")
    c.drawString(amt_col_x + 5 * mm, tbl_top - row_h + 2.5 * mm, "Openstaand")

    currency = reminder.get("currency") or "SRD"
    max_rows = 8   # A4 landscape → maximaal ~8 regels netjes zichtbaar
    total = 0.0
    for i, inv in enumerate(invoices[:max_rows]):
        row_y = tbl_top - (i + 2) * row_h
        c.setFillColor(colors.white); c.setStrokeColor(_BH_INK); c.setLineWidth(0.5)
        c.rect(tbl_x, row_y, tbl_w, row_h, stroke=1, fill=1)
        c.line(nr_col_x, row_y, nr_col_x, row_y + row_h)
        c.line(amt_col_x, row_y, amt_col_x, row_y + row_h)
        period_lbl = ""
        if inv.get("period_month") and inv.get("period_year"):
            try:
                period_lbl = f"{MONTHS_NL[int(inv['period_month']) - 1]} {inv['period_year']}"
            except Exception:
                period_lbl = ""
        remaining = float(inv.get("remaining_amount")
                          if inv.get("remaining_amount") is not None
                          else max(0.0, float(inv.get("amount") or 0) - float(inv.get("paid_amount") or 0)))
        total += remaining
        c.setFillColor(colors.black); c.setFont(_LUX_SANS, 10)
        c.drawString(period_col_x + 5 * mm, row_y + 2.5 * mm, period_lbl or "—")
        c.drawString(nr_col_x + 5 * mm, row_y + 2.5 * mm, inv.get("invoice_number") or "—")
        c.setFont(_LUX_SANS_BOLD, 10)
        c.drawString(amt_col_x + 5 * mm, row_y + 2.5 * mm, _bh_fmt_money(remaining, inv.get("currency") or currency))
        if inv.get("is_historical"):
            c.setFillColor(colors.HexColor("#7C3AED"))
            c.setFont(_LUX_SANS_BOLD, 7)
            c.drawString(period_col_x + 5 * mm, row_y + 6.2 * mm, "HISTORISCH")

    # "meer regels" hint
    if len(invoices) > max_rows:
        hint_y = tbl_top - (max_rows + 2) * row_h + 4
        c.setFillColor(_BH_INK); c.setFont("Helvetica-Oblique", 9)
        c.drawString(tbl_x + 5 * mm, hint_y, f"+ nog {len(invoices) - max_rows} openstaande facturen …")

    # Totaal-rij
    total_open = float(reminder.get("total_open") or total)
    total_y = tbl_top - (min(len(invoices), max_rows) + 2) * row_h
    c.setFillColor(_BH_BAND); c.setStrokeColor(_BH_INK); c.setLineWidth(0.6)
    c.rect(tbl_x, total_y, tbl_w, row_h, stroke=1, fill=1)
    c.line(amt_col_x, total_y, amt_col_x, total_y + row_h)
    c.setFillColor(_BH_INK); c.setFont(_LUX_SANS_BOLD, 11)
    c.drawString(tbl_x + 5 * mm, total_y + 2.5 * mm, "Totaal openstaand")
    c.drawString(amt_col_x + 5 * mm, total_y + 2.5 * mm, _bh_fmt_money(total_open, currency))

    # Verklaring + Opmerking
    decl_y = total_y - 12 * mm
    c.setFillColor(colors.black); c.setFont(_LUX_SANS, 10)
    c.drawString(pad, decl_y, "Wij verzoeken u vriendelijk het openstaande saldo z.s.m. te voldoen.")
    c.drawString(pad, decl_y - 5 * mm, "Bij vragen kunt u ons bereiken via bovenstaand telefoonnummer.")

    note_y = decl_y - 14 * mm
    if reminder.get("note"):
        c.setFillColor(_BH_INK); c.setFont(_LUX_SANS_BOLD, 11)
        c.drawString(pad, note_y, "Opmerking:")
        c.setFillColor(colors.black); c.setFont(_LUX_SANS, 10)
        c.drawString(pad, note_y - 5 * mm, str(reminder["note"])[:180])

    c.showPage(); c.save(); buf.seek(0)
    return buf.getvalue()



# =====================================================================
# Nieuwe huurfactuur: "Blue House" ontwerp (op verzoek gebruiker, feb 2026).
# A4 landscape — huisje-icoon + HUURFACTUUR titel, Van/Aan-blokken met
# lichtblauwe headers, Omschrijving/Periode/Bedrag-tabel met donkerblauwe
# kop, Betalingsgegevens links + "Let op:" vervaldatum-kader rechts,
# tekening handtekeningen onderaan.
# =====================================================================
def _bh_hbar(c, x, y, w, h, text, radius=6, fill=None, text_color=None, font_size=11):
    """Lichtblauwe rounded header-bar met titel — herhaald in Van/Aan/
    Overzicht/Betalingsgegevens blokken."""
    fill = fill or _BH_BAND
    text_color = text_color or _BH_INK
    c.saveState()
    c.setFillColor(fill); c.setStrokeColor(_BH_INK); c.setLineWidth(0.6)
    c.roundRect(x, y, w, h, radius, stroke=1, fill=1)
    c.setFillColor(text_color); c.setFont(_LUX_SANS_BOLD, font_size)
    c.drawString(x + 4 * mm, y + h / 2 - font_size / 3.2, text)
    c.restoreState()


def invoice_pdf_blue_house(invoice: dict, tenant: dict, apartment: dict, _payments: list) -> bytes:
    """Huurfactuur in blauw huisje-ontwerp, matching kwitantie-stijl."""
    from reportlab.pdfgen import canvas as _canvas
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.utils import ImageReader

    PAGE_W, PAGE_H = landscape(A4)  # 842 × 595 pt
    buf = io.BytesIO()
    c = _canvas.Canvas(buf, pagesize=(PAGE_W, PAGE_H))
    c.setTitle(f"Factuur {invoice.get('invoice_number', '')}")

    margin = 12 * mm
    c.setStrokeColor(_BH_INK); c.setLineWidth(1.5)
    c.rect(margin, margin, PAGE_W - 2 * margin, PAGE_H - 2 * margin, stroke=1, fill=0)

    pad = margin + 8 * mm
    right_x = PAGE_W - pad
    header_top = PAGE_H - pad - 3

    # ---- Header
    icon_size = 20 * mm
    logo_bytes = invoice.get("company_logo_bytes")
    if logo_bytes:
        try:
            c.drawImage(ImageReader(io.BytesIO(logo_bytes)),
                        pad, header_top - icon_size, icon_size, icon_size,
                        preserveAspectRatio=True, mask="auto")
        except Exception:
            _bh_house_icon(c, pad, header_top - icon_size, icon_size)
    else:
        _bh_house_icon(c, pad, header_top - icon_size, icon_size)

    title_x = pad + icon_size + 6 * mm
    c.setFillColor(_BH_INK)
    c.setFont(_LUX_SANS_BOLD, 26)
    c.drawString(title_x, header_top - 6 * mm, "HUURFACTUUR")
    c.setFont(_LUX_SANS_BOLD, 10)
    c.drawString(title_x, header_top - 11 * mm, "Appartement / Woning")
    c.setFont("Helvetica-Oblique", 9)
    c.setFillColor(colors.HexColor("#3A5A85"))
    c.drawString(title_x, header_top - 16 * mm, "Betreft: huurbetaling voor het gehuurde appartement")

    # ---- Rechter info-kader
    box_w = 88 * mm; box_h = 22 * mm
    box_x = right_x - box_w
    box_y = header_top - box_h + 3
    c.setFillColor(_BH_BAND); c.setStrokeColor(_BH_INK); c.setLineWidth(0.6)
    c.roundRect(box_x, box_y, box_w, box_h, 4, stroke=1, fill=1)
    c.setFillColor(_BH_INK); c.setFont(_LUX_SANS_BOLD, 10)
    lines = [
        ("Factuurnummer:", invoice.get("invoice_number") or "—"),
        ("Factuurdatum:", _fmt_date_nl(invoice.get("created_at")) or _fmt_date_nl(datetime.utcnow().isoformat())),
        ("Vervaldatum:", _fmt_date_nl(invoice.get("due_date")) or f"15 {MONTHS_NL[(invoice.get('period_month') or 1) - 1]} {invoice.get('period_year')}"),
    ]
    for i, (label, value) in enumerate(lines):
        row_y = box_y + box_h - 6 * mm - i * 6 * mm
        c.setFillColor(_BH_INK); c.setFont(_LUX_SANS_BOLD, 9.5)
        c.drawString(box_x + 4 * mm, row_y, label)
        c.setFillColor(colors.black); c.setFont(_LUX_SANS, 10)
        c.drawString(box_x + 40 * mm, row_y, str(value))

    # Divider onder header
    div_y = header_top - 22 * mm
    c.setStrokeColor(_BH_INK); c.setLineWidth(0.5)
    c.line(pad, div_y, right_x, div_y)

    # ---- Van / Aan blokken
    party_top = div_y - 4 * mm
    col_w = (PAGE_W - 2 * pad - 6 * mm) / 2
    left_col_x = pad
    right_col_x = pad + col_w + 6 * mm

    _bh_hbar(c, left_col_x, party_top - 8 * mm, col_w, 8 * mm, "Van (verhuurder):")
    _bh_hbar(c, right_col_x, party_top - 8 * mm, col_w, 8 * mm, "Aan (huurder):")

    # Split company/tenant address across lines (max 2 for company, 3 for tenant)
    company_addr_lines = [ln for ln in (invoice.get("company_address") or "").split("\n") if ln.strip()][:2]
    if not company_addr_lines:
        company_addr_lines = ["—"]
    apt_addr_lines = []
    if apartment.get("number"):
        apt_addr_lines.append(f"Appartement {apartment['number']}")
    if invoice.get("location_name"):
        apt_addr_lines.append(str(invoice["location_name"]))
    elif apartment.get("address"):
        apt_addr_lines.append(str(apartment["address"]))
    if not apt_addr_lines:
        apt_addr_lines = ["—"]

    def _kv_block(x, y, rows):
        c.setFont(_LUX_SANS, 10)
        for i, (label, values) in enumerate(rows):
            row_y = y - i * 5.5 * mm
            c.setFillColor(_BH_INK); c.drawString(x + 2, row_y, label)
            c.drawString(x + 24 * mm, row_y, ":")
            c.setFillColor(colors.black)
            if isinstance(values, list):
                for j, v in enumerate(values):
                    c.drawString(x + 27 * mm, row_y - j * 4.5 * mm, str(v))
            else:
                c.drawString(x + 27 * mm, row_y, str(values) or "—")

    verhuurder_name = invoice.get("landlord_name") or invoice.get("company_name") or "—"
    verhuurder_rows = [
        ("Naam", verhuurder_name),
        ("Adres", company_addr_lines),
    ]
    # Push telefoon/email after multi-line adres
    base_y = party_top - 14 * mm
    _kv_block(left_col_x, base_y, verhuurder_rows)
    # Manual placement for phone + email so they line up under the address block
    addr_lines = len(company_addr_lines)
    phone_y = base_y - (1 * 5.5 * mm) - (addr_lines - 1) * 4.5 * mm - 5.5 * mm
    c.setFillColor(_BH_INK); c.setFont(_LUX_SANS, 10)
    c.drawString(left_col_x + 2, phone_y, "Telefoon")
    c.drawString(left_col_x + 24 * mm, phone_y, ":")
    c.setFillColor(colors.black)
    c.drawString(left_col_x + 27 * mm, phone_y, invoice.get("company_phone") or invoice.get("company_whatsapp") or "—")
    email_y = phone_y - 5.5 * mm
    c.setFillColor(_BH_INK); c.drawString(left_col_x + 2, email_y, "E-mail")
    c.drawString(left_col_x + 24 * mm, email_y, ":")
    c.setFillColor(colors.black)
    c.drawString(left_col_x + 27 * mm, email_y, invoice.get("contact_email") or "—")

    huurder_rows = [
        ("Naam", tenant.get("name") or "—"),
        ("Adres", apt_addr_lines[:3]),
    ]
    _kv_block(right_col_x, base_y, huurder_rows)
    apt_lines = len(apt_addr_lines[:3])
    r_phone_y = base_y - (1 * 5.5 * mm) - (apt_lines - 1) * 4.5 * mm - 5.5 * mm
    c.setFillColor(_BH_INK); c.setFont(_LUX_SANS, 10)
    c.drawString(right_col_x + 2, r_phone_y, "Telefoon")
    c.drawString(right_col_x + 24 * mm, r_phone_y, ":")
    c.setFillColor(colors.black)
    c.drawString(right_col_x + 27 * mm, r_phone_y, tenant.get("phone") or "—")

    # ---- Overzicht factuur titel
    ov_y = base_y - 30 * mm
    c.setFillColor(_BH_INK); c.setFont(_LUX_SANS_BOLD, 14)
    c.drawString(pad, ov_y, "Overzicht factuur")

    # ---- Tabel Omschrijving | Periode | Bedrag
    tbl_top = ov_y - 4 * mm
    tbl_x = pad; tbl_w = PAGE_W - 2 * pad
    row_h = 8 * mm
    omsch_col_w = tbl_w * 0.45
    per_col_w = tbl_w * 0.30
    bedr_col_x = tbl_x + omsch_col_w + per_col_w

    # Header — donkerblauw met witte tekst
    c.setFillColor(_BH_INK); c.setStrokeColor(_BH_INK); c.setLineWidth(0.6)
    c.rect(tbl_x, tbl_top - row_h, tbl_w, row_h, stroke=1, fill=1)
    c.setFillColor(colors.white); c.setFont(_LUX_SANS_BOLD, 10)
    c.drawString(tbl_x + 4 * mm, tbl_top - row_h + 2.5 * mm, "Omschrijving")
    c.drawString(tbl_x + omsch_col_w + 4 * mm, tbl_top - row_h + 2.5 * mm, "Periode")
    # "Bedrag" rechts-uitlijnen
    txt = "Bedrag"
    tw = c.stringWidth(txt, _LUX_SANS_BOLD, 10)
    c.drawString(tbl_x + tbl_w - 4 * mm - tw, tbl_top - row_h + 2.5 * mm, txt)

    period_lbl = ""
    if invoice.get("period_month") and invoice.get("period_year"):
        try:
            period_lbl = f"{MONTHS_NL[int(invoice['period_month']) - 1].capitalize()} {invoice['period_year']}"
        except Exception:
            pass
    currency = invoice.get("currency") or "SRD"
    amount = float(invoice.get("amount") or 0)
    service = float(invoice.get("service_charge") or 0)
    huur_amount = amount - service if service > 0 else amount

    rows = []
    # Historische facturen hebben vrije omschrijving — gebruik die als eerste regel
    if invoice.get("is_historical") and invoice.get("description"):
        rows.append((invoice["description"], period_lbl, huur_amount))
    else:
        rows.append(("Huur appartement", period_lbl, huur_amount))
    rows.append(("Servicekosten (indien van toepassing)", period_lbl, service))

    for i, (label, period, bedrag) in enumerate(rows):
        row_y = tbl_top - (i + 2) * row_h
        # Alternating fill
        c.setFillColor(colors.white if i % 2 == 0 else _BH_ROW_FILL)
        c.setStrokeColor(_BH_INK); c.setLineWidth(0.4)
        c.rect(tbl_x, row_y, tbl_w, row_h, stroke=1, fill=1)
        c.setFillColor(colors.black); c.setFont(_LUX_SANS, 10)
        c.drawString(tbl_x + 4 * mm, row_y + 2.5 * mm, label)
        c.drawString(tbl_x + omsch_col_w + 4 * mm, row_y + 2.5 * mm, period)
        bedr_txt = _bh_fmt_money(bedrag, currency)
        bw = c.stringWidth(bedr_txt, _LUX_SANS, 10)
        c.drawString(tbl_x + tbl_w - 4 * mm - bw, row_y + 2.5 * mm, bedr_txt)

    # Totaal-rij (lichtblauw, dikke rand boven)
    tot_y = tbl_top - (len(rows) + 2) * row_h
    c.setFillColor(_BH_BAND); c.setStrokeColor(_BH_INK); c.setLineWidth(0.6)
    c.rect(tbl_x, tot_y, tbl_w, row_h, stroke=1, fill=1)
    c.setFillColor(_BH_INK); c.setFont(_LUX_SANS_BOLD, 12)
    c.drawString(tbl_x + 4 * mm, tot_y + 2.5 * mm, "Totaal te betalen")
    tot_txt = _bh_fmt_money(amount, currency)
    tw2 = c.stringWidth(tot_txt, _LUX_SANS_BOLD, 12)
    c.drawString(tbl_x + tbl_w - 4 * mm - tw2, tot_y + 2.5 * mm, tot_txt)

    # ---- Bottom: Betalingsgegevens links + Let-op-kader rechts
    bot_top = tot_y - 8 * mm
    bg_w = (tbl_w - 6 * mm) * 0.60
    lp_w = (tbl_w - 6 * mm) * 0.40
    bg_x = pad
    lp_x = pad + bg_w + 6 * mm

    _bh_hbar(c, bg_x, bot_top - 8 * mm, bg_w, 8 * mm, "Betalingsgegevens:")
    # Bank + rekeningnr uit `bank_account_sr` extraheren als beste-guess
    bank_raw = (invoice.get("bank_account_sr") or invoice.get("bank_account_nl") or "").strip()
    bank_name = ""
    rek_nr = ""
    rek_naam = invoice.get("landlord_name") or invoice.get("company_name") or ""
    if bank_raw:
        # Format: "DSB Bank — 11.22.33.444 (Demo BV)" of vrije tekst
        parts = bank_raw.replace("—", "-").split("-")
        if len(parts) >= 2:
            bank_name = parts[0].strip()
            rest = parts[1].strip()
            if "(" in rest:
                rek_nr, holder = rest.split("(", 1)
                rek_nr = rek_nr.strip()
                rek_naam = holder.rstrip(") ").strip() or rek_naam
            else:
                rek_nr = rest
        else:
            bank_name = bank_raw
    bg_rows = [
        ("Bank", bank_name or "—"),
        ("Rekeningnummer", rek_nr or "—"),
        ("Naam rekeninghouder", rek_naam or "—"),
        ("Betalingskenmerk", f"Huur {period_lbl}" + (f" — {apartment.get('number')}" if apartment.get("number") else "")),
    ]
    c.setFont(_LUX_SANS, 10)
    kv_y = bot_top - 14 * mm
    for i, (lab, val) in enumerate(bg_rows):
        row_y = kv_y - i * 5.5 * mm
        c.setFillColor(_BH_INK); c.drawString(bg_x + 2, row_y, lab)
        c.drawString(bg_x + 44 * mm, row_y, ":")
        c.setFillColor(colors.black); c.drawString(bg_x + 47 * mm, row_y, str(val))

    # Let-op kader
    lp_h = 34 * mm
    lp_y = bot_top - lp_h - 2 * mm
    c.setFillColor(_BH_BAND); c.setStrokeColor(_BH_INK); c.setLineWidth(0.6)
    c.roundRect(lp_x, lp_y, lp_w, lp_h, 4, stroke=1, fill=1)
    # Calendar icon
    ic_x = lp_x + 5 * mm; ic_y = lp_y + lp_h - 10 * mm; ic_sz = 6 * mm
    c.setFillColor(_BH_INK)
    c.rect(ic_x, ic_y, ic_sz, ic_sz * 0.85, stroke=0, fill=1)
    c.setFillColor(colors.white)
    c.rect(ic_x + 0.8, ic_y + 0.8, ic_sz - 1.6, ic_sz * 0.55, stroke=0, fill=1)
    c.setFillColor(_BH_INK); c.setFont(_LUX_SANS_BOLD, 12)
    c.drawString(lp_x + 14 * mm, lp_y + lp_h - 8 * mm, "Let op:")
    c.setFont(_LUX_SANS, 9.5)
    due_txt = _fmt_date_nl(invoice.get("due_date")) or f"15 {MONTHS_NL[(invoice.get('period_month') or 1) - 1]} {invoice.get('period_year')}"
    c.drawString(lp_x + 5 * mm, lp_y + lp_h - 14 * mm, "De huur dient uiterlijk op")
    c.setFont(_LUX_SANS_BOLD, 10.5)
    c.drawString(lp_x + 5 * mm, lp_y + lp_h - 19 * mm, due_txt)
    c.setFont(_LUX_SANS, 9.5)
    c.drawString(lp_x + 5 * mm, lp_y + lp_h - 24 * mm, "op onze rekening te staan.")
    c.setFont("Helvetica-Oblique", 8.5); c.setFillColor(colors.HexColor("#3A5A85"))
    c.drawString(lp_x + 5 * mm, lp_y + lp_h - 29 * mm, "Bij niet tijdige betaling brengen wij rente en")
    c.drawString(lp_x + 5 * mm, lp_y + lp_h - 32 * mm, "incassokosten in rekening.")

    # ---- Bedankje + handtekening-lijnen onderaan
    thank_y = lp_y - 4 * mm
    c.setFillColor(colors.black); c.setFont(_LUX_SANS, 9)
    c.drawString(pad, thank_y, "Alvast bedankt voor uw tijdige betaling.")
    c.drawString(pad, thank_y - 4 * mm, "Met vriendelijke groet,")
    c.setFont(_LUX_SANS_BOLD, 9)
    c.drawString(pad, thank_y - 8 * mm, verhuurder_name)
    c.setFont(_LUX_SANS, 8); c.setFillColor(colors.HexColor("#3A5A85"))
    c.drawString(pad, thank_y - 12 * mm, "Verhuurder")

    # Signatures — bewust weggelaten voor huurfactuur (op verzoek gebruiker
    # feb 2026: geen handtekeningen op factuur, alleen op contract/kwitantie).

    # Centered italic footer
    c.setFont("Helvetica-Oblique", 9)
    c.setFillColor(colors.HexColor("#3A5A85"))
    foot_txt = "Samen zorgen we voor een prettige huurovereenkomst."
    fw = c.stringWidth(foot_txt, "Helvetica-Oblique", 9)
    c.drawString(PAGE_W / 2 - fw / 2, margin + 4 * mm, foot_txt)

    c.showPage(); c.save(); buf.seek(0)
    return buf.getvalue()
