"""Compact SMS reminder text with a single GSM-7 segment."""

import re
import unicodedata
from urllib.parse import urlsplit


_TONES = {
    "friendly": (
        "Vriendelijke herinnering: uw betaling staat nog open.",
        "Vriendelijke herinnering: er staat een betaling open.",
        "Vriendelijke herinnering: er staat nog een betaling open.",
    ),
    "reminder": (
        "Herinnering: uw betaling staat nog open. Betaal alstublieft spoedig.",
        "Herinnering: uw betaling staat nog open. Betaal deze alstublieft.",
        "Herinnering: er staat nog een betaling open. Betaal alstublieft.",
    ),
    "urgent": (
        "Dringende herinnering: uw betaling staat nog open. Neem snel actie.",
        "Dringende herinnering: er staat nog een betaling open. Reageer snel.",
        "Dringende herinnering: uw betaling staat open. Neem snel actie.",
    ),
}

_OPTIONAL_SENTENCES = (
    ("", " Heeft u al betaald? Negeer dit bericht.", " Heeft u al betaald? Negeer dan dit bericht.",
     " Al betaald? Dan kunt u dit bericht negeren.", " Al betaald? Negeer dan dit bericht."),
    ("", " Vragen? Neem contact op.", " Bij vragen kunt u contact opnemen.",
     " Neem bij vragen contact met ons op.", " Bij vragen helpen wij u graag."),
    ("", " Dank u.", " Dank u wel.", " Bedankt.", " Bedankt voor uw aandacht.", " Dank voor uw medewerking."),
    ("", " De link is 30 dagen geldig.", " Deze link is 30 dagen geldig.", " De betaallink is 30 dagen geldig."),
)
_LINK_LABELS = (
    " Betaal via: ", " Betaal via ", " Betaal op: ", " Betaal op ",
    " Bekijk en betaal: ", " Betaal veilig via: ", " Uw betaallink: ",
)


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

    additions = {0: ""}
    for alternatives in _OPTIONAL_SENTENCES:
        next_additions = {}
        for existing in additions.values():
            for alternative in alternatives:
                combined = existing + alternative
                next_additions.setdefault(len(combined), combined)
        additions = next_additions

    for length in range(min(len(company), 160), 0, -1):
        name = company[:length].rstrip()
        if not name:
            continue
        punctuation = "" if name.endswith(".") else "."
        for opening in _TONES[tone]:
            for sender in (" Van: ", " Van "):
                for label in _LINK_LABELS:
                    prefix = opening + sender + name + punctuation
                    suffix = label + payment_url
                    extra_length = 160 - len(prefix) - len(suffix)
                    if extra_length in additions:
                        return prefix + additions[extra_length] + suffix
    raise ValueError("Geen geschikt SMS-bericht van 160 tekens voor deze naam en link")
