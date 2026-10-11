"""Pure auth-helpers: password hashing, JWT create/decode, tijd-helpers en
PIN-brute-force throttle. Uit server.py geëxtraheerd om het endpoint-bestand
kleiner te houden. Geen db-import — dit is puur functioneel.

Server.py importeert alles hier vandaan; route-modules kunnen deze
helpers ook direct importeren i.p.v. via `_deps` als ze puur functioneel zijn.
"""
import os
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

import bcrypt
import jwt
from fastapi import HTTPException, Request


# ---------- Config ----------
JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALG = "HS256"
SESSION_MIN = 60 * 24 * 365  # 1 jaar — sessies verlopen niet automatisch
ACCESS_MIN = SESSION_MIN
KIOSK_TOKEN_MIN = SESSION_MIN


# ---------- Password hashing ----------
def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


# ---------- JWT ----------
def create_token(payload: dict, minutes: int) -> str:
    data = {**payload, "exp": datetime.now(timezone.utc) + timedelta(minutes=minutes)}
    return jwt.encode(data, JWT_SECRET, algorithm=JWT_ALG)


def decode_token(token: str) -> dict:
    return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])


# ---------- Time helpers ----------
def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


def new_id() -> str:
    return str(uuid.uuid4())


# =====================================================================
# Brute-force lockout for PIN endpoints (in-memory, per process)
# =====================================================================
# key -> {"attempts": int, "locked_until": float (epoch seconds)}
_PIN_ATTEMPTS: dict = {}
PIN_MAX_ATTEMPTS = int(os.environ.get("PIN_MAX_ATTEMPTS", "8"))
PIN_LOCKOUT_SECONDS = int(os.environ.get("PIN_LOCKOUT_SECONDS", "300"))  # 5 minutes


def _pin_throttle_check(key: str) -> None:
    import time
    rec = _PIN_ATTEMPTS.get(key)
    if rec and rec.get("locked_until", 0) > time.time():
        wait = int(rec["locked_until"] - time.time())
        raise HTTPException(
            status_code=429,
            detail=f"Te veel mislukte pogingen. Probeer opnieuw over {wait} seconden.",
        )


def _pin_throttle_fail(key: str) -> None:
    import time
    rec = _PIN_ATTEMPTS.get(key, {"attempts": 0, "locked_until": 0})
    rec["attempts"] = rec.get("attempts", 0) + 1
    if rec["attempts"] >= PIN_MAX_ATTEMPTS:
        rec["locked_until"] = time.time() + PIN_LOCKOUT_SECONDS
        rec["attempts"] = 0
    _PIN_ATTEMPTS[key] = rec


def _pin_throttle_clear(key: str) -> None:
    _PIN_ATTEMPTS.pop(key, None)


def _client_ip(request: Request) -> str:
    return (request.headers.get("x-forwarded-for", "").split(",")[0].strip()
            or (request.client.host if request.client else "unknown"))


def extract_token(request: Request, cookie_name: str = "access_token") -> Optional[str]:
    """Cookie-first token extractie met Bearer + ?token= fallback.

    SSE (EventSource) kan geen custom headers sturen — daarom accepteren
    we `?token=...` als query param op endpoints waar dat expliciet nodig is.
    """
    tok = request.cookies.get(cookie_name)
    if tok:
        return tok
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:]
    qp = request.query_params.get("token")
    if qp:
        return qp
    return None
