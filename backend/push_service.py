"""Web Push notifications via VAPID.

Belangrijk: pywebpush 2.3.0 verwacht `vapid_private_key` als ofwel een
Vapid01 instance, een file path, of een raw/DER string. PEM strings worden
NIET correct geparsed door de moderne `Vapid.from_string` (die assumeert
raw 32-byte of DER). Daarom laden we de PEM eenmaal naar een Vapid01
instance en gebruiken die voor elke push.
"""
import os
import json
import base64
from enum import Enum
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from py_vapid import Vapid01
from pywebpush import webpush, WebPushException


class PushResult(Enum):
    SENT = "sent"
    EXPIRED = "expired"
    FAILED = "failed"


VAPID_PUBLIC_KEY = os.environ.get("VAPID_PUBLIC_KEY", "").strip()
VAPID_PRIVATE_PEM_B64 = os.environ.get("VAPID_PRIVATE_KEY_B64", "")
VAPID_CONTACT = os.environ.get("VAPID_CONTACT", "mailto:admin@vastgoed.sr")

_vapid_instance = None


def _get_vapid() -> Vapid01:
    """Lazy-load + cache the VAPID instance from the base64-encoded PEM."""
    global _vapid_instance
    if _vapid_instance is not None:
        return _vapid_instance
    if not VAPID_PRIVATE_PEM_B64:
        raise RuntimeError("VAPID_PRIVATE_KEY_B64 not configured")
    pem_bytes = base64.b64decode(VAPID_PRIVATE_PEM_B64)
    _vapid_instance = Vapid01.from_pem(pem_bytes)
    return _vapid_instance


def get_vapid_public_key() -> str:
    """Return the public key for the configured private key, deriving it if needed."""
    if not VAPID_PRIVATE_PEM_B64:
        return ""
    pem_bytes = base64.b64decode(VAPID_PRIVATE_PEM_B64, validate=True)
    private_key = serialization.load_pem_private_key(pem_bytes, password=None)
    if not isinstance(private_key, ec.EllipticCurvePrivateKey) or not isinstance(
        private_key.curve, ec.SECP256R1,
    ):
        raise ValueError("VAPID private key must use the P-256 curve")
    public_key = private_key.public_key().public_bytes(
        serialization.Encoding.X962,
        serialization.PublicFormat.UncompressedPoint,
    )
    derived_key = base64.urlsafe_b64encode(public_key).decode("ascii").rstrip("=")
    if VAPID_PUBLIC_KEY and VAPID_PUBLIC_KEY != derived_key:
        raise ValueError("VAPID_PUBLIC_KEY does not match VAPID_PRIVATE_KEY_B64")
    return derived_key


def send_push(subscription: dict, title: str, body: str, data: dict | None = None) -> PushResult:
    """Stuur een Web Push naar één subscription.

    Alleen verlopen endpoints worden als EXPIRED gemarkeerd; tijdelijke fouten
    mogen geen werkende toestelregistratie verwijderen.
    """
    if not subscription or not subscription.get("endpoint"):
        return PushResult.EXPIRED
    payload = json.dumps({
        "title": title, "body": body, "data": data or {},
    })
    try:
        vv = _get_vapid()
        webpush(
            subscription_info=subscription,
            data=payload,
            vapid_private_key=vv,
            vapid_claims={"sub": VAPID_CONTACT},
            # TTL=0 (default) laat de pushdienst de melding weggooien als het
            # toestel even niet bereikbaar is → meldingen kwamen soms nooit aan.
            ttl=86400,
            headers={"Urgency": "high"},
            timeout=10,
        )
        return PushResult.SENT
    except WebPushException as e:
        # Alleen 404/410 geven aan dat de browser-subscription verlopen is.
        status = e.response.status_code if e.response is not None else "n/a"
        print(f"[push] WebPushException status={status}: {str(e)[:200]}")
        return PushResult.EXPIRED if status in (404, 410) else PushResult.FAILED
    except Exception as e:
        print(f"[push] Unexpected error: {type(e).__name__}: {e}")
        return PushResult.FAILED
