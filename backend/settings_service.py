"""Company settings service.

Each company has ONE settings document in `company_settings` collection,
keyed by `company_id`. Secret fields (passwords, API keys, tokens) are
encrypted-at-rest using Fernet (symmetric AES-128-CBC + HMAC-SHA256).

When returning settings to the frontend, secret fields are MASKED ("•••••")
so the encrypted blob never leaves the server. On update, if the client sends
back the masked value or empty string, we keep the existing secret.
"""
import os
import base64
import hashlib
from cryptography.fernet import Fernet, InvalidToken


def _derive_key() -> bytes:
    """Derive a stable Fernet key from JWT_SECRET so credentials survive restarts."""
    secret = os.environ.get("SETTINGS_ENCRYPTION_KEY") or os.environ.get("JWT_SECRET", "fallback-secret")
    # Fernet needs a 32-byte url-safe base64 key.
    digest = hashlib.sha256(secret.encode()).digest()
    return base64.urlsafe_b64encode(digest)


_FERNET = Fernet(_derive_key())

MASK = "•••••"


def encrypt(value: str | None) -> str | None:
    if not value:
        return None
    return _FERNET.encrypt(value.encode()).decode()


def decrypt(token: str | None) -> str | None:
    if not token:
        return None
    try:
        return _FERNET.decrypt(token.encode()).decode()
    except (InvalidToken, ValueError):
        return None


# Map of section -> secret field names (everything else is plain).
SECTION_SECRETS = {
    "smtp": ["password"],
    "twilio": ["auth_token"],
    "shelly": ["cloud_token"],
    "domain": [],
    "invoicing": [],
}


# Default empty shape per section — used to bootstrap UIs.
def empty_section(section: str) -> dict:
    return {
        "smtp": {"host": "", "port": 587, "username": "", "password": None,
                 "from_email": "", "from_name": "", "use_tls": True, "enabled": False},
        "twilio": {"account_sid": "", "auth_token": None,
                   "whatsapp_from": "", "sms_from": "", "enabled": False},
        "shelly": {"cloud_token": None, "server": "shelly-cloud.shelly.cloud", "enabled": False},
        "domain": {"custom_domain": "", "dns_verified": False, "enabled": False},
        # Invoicing — automatische factuur-generatie + grace period
        # `grace_workdays`: aantal werkdagen NA de laatste dag van de maand
        # waarin de huurder nog moet betalen. Pas DAARNA wordt de volgende
        # maand-factuur automatisch aangemaakt. Voorbeeld: maart-factuur
        # verloopt 31 maart + 10 werkdagen = ~14 april → april-factuur
        # wordt op 15 april automatisch gegenereerd.
        # `last_auto_run`: laatste datum (YYYY-MM-DD) dat de auto-loop heeft
        # gedraaid voor deze company, gebruikt om idempotent te blijven.
        "invoicing": {
            "auto_generate": False,
            # Modus voor het bepalen van de factuur-datum:
            #  - "grace_workdays" (default): einde vorige maand + N werkdagen
            #  - "fixed_day"                : vaste dag van de HUIDIGE maand (bv. 5)
            #  - "due_next_month"           : vaste factuurdag + vervaldag in
            #                                 de VOLGENDE maand (bv. 1 juli
            #                                 factureren, vervalt 10 augustus)
            "mode": "grace_workdays",
            "grace_workdays": 10,
            "billing_day": 1,
            # Alleen relevant voor mode=due_next_month: op deze dag van de
            # VOLGENDE maand vervalt de factuur (bv. 10 → 10 augustus voor
            # de juli-factuur). Wordt geclamped naar de laatste dag als
            # 29/30/31 niet in de doelmaand valt.
            "due_day": 10,
            # Betaaltermijn in KALENDERdagen: aantal dagen tussen factuurdatum
            # en vervaldatum. Bepaalt zowel de "Vervaldatum" op de PDF als
            # wanneer een factuur naar "achterstand" (overdue) verhuist.
            # Alleen gebruikt voor fixed_day en grace_workdays modi.
            "payment_term_days": 14,
            # Aantal dagen VÓÓR de vervaldatum waarop een huurder een
            # herinnering ontvangt (WhatsApp/SMS via Twilio + Email via SMTP,
            # indien geconfigureerd). 0 = uit. Idempotent: max 1 herinnering
            # per factuur per drempel-passage.
            "reminder_days_before": 3,
            "last_auto_run": None,
            "enabled": False,
        },
    }.get(section, {})


def mask_section(section: str, data: dict) -> dict:
    """Replace encrypted secret values with MASK before returning to client."""
    if not data:
        return empty_section(section)
    out = dict(data)
    for f in SECTION_SECRETS.get(section, []):
        out[f] = MASK if out.get(f) else None
    return out


def merge_section(section: str, existing: dict, incoming: dict) -> dict:
    """Build new section doc.
    - For secret fields: if incoming is empty, MASK, or None → keep existing encrypted value.
      Otherwise encrypt new value.
    - For non-secret fields: take incoming as-is.
    """
    existing = existing or {}
    incoming = incoming or {}
    secret_fields = SECTION_SECRETS.get(section, [])
    out = {}
    base = empty_section(section)
    for key in base.keys():
        if key in secret_fields:
            new_val = incoming.get(key)
            if new_val and new_val != MASK:
                out[key] = encrypt(str(new_val))
            else:
                out[key] = existing.get(key)  # keep encrypted blob
        else:
            out[key] = incoming.get(key, existing.get(key, base[key]))
    return out


def reveal_section(section: str, data: dict) -> dict:
    """Return section with secret fields DECRYPTED — for internal use only
    when actually calling SMTP/Twilio/etc."""
    if not data:
        return empty_section(section)
    out = dict(data)
    for f in SECTION_SECRETS.get(section, []):
        out[f] = decrypt(out.get(f))
    return out
