"""Compact SMS reminder text with a single GSM-7 segment."""

import re
import unicodedata
from urllib.parse import urlsplit


_TONES = {
    "friendly": "Vriendelijke herinnering: uw betaling staat nog open.",
    "reminder": "Herinnering: uw betaling staat nog open. Betaal alstublieft spoedig.",
    "urgent": "Dringende herinnering: uw betaling staat nog open. Neem snel actie.",
}


def reminder_sms(tone: str, company_name: str, payment_url: str) -> str:
    if tone not in _TONES:
        raise ValueError("Onbekende herinneringstoon")
    try:
        parsed = urlsplit(payment_url)
        _ = parsed.port
    except ValueError as exc:
        raise ValueError("Ongeldige betaallink") from exc
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
            or parsed.query or parsed.fragment or not re.fullmatch(r"https://[A-Za-z0-9._:-]+/[A-Za-z0-9._/-]+", payment_url)):
        raise ValueError("De betaallink moet een korte HTTPS-link zijn")

    if not isinstance(company_name, str):
        raise ValueError("Ongeldige bedrijfsnaam")
    company = unicodedata.normalize("NFKD", company_name)
    company = "".join(char for char in company if not unicodedata.combining(char))
    if not company.isascii():
        raise ValueError("Bedrijfsnaam kan niet in een enkele SMS worden weergegeven")
    company = re.sub(r"[^A-Za-z0-9 .,-]", "", company)
    company = re.sub(r"\s+", " ", company).strip()
    if not company:
        raise ValueError("Bedrijfsnaam ontbreekt")

    suffix = f" Betaal via: {payment_url}"
    prefix = f"{_TONES[tone]} Van: "
    available = 160 - len(prefix) - len(suffix)
    if available < 1:
        raise ValueError("De betaallink is te lang voor een SMS van 160 tekens")
    message = prefix + company[:available].rstrip() + suffix
    return message.ljust(160)
