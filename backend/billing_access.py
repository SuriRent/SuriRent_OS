from datetime import datetime, timedelta, timezone
from math import ceil


TRIAL_GRACE_DAYS = 7


def _parse_datetime(value):
    if not value:
        return None
    try:
        parsed = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def billing_access_state(company, now=None):
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    now = now.astimezone(timezone.utc)

    trial_ends_at = _parse_datetime(company.get("trial_ends_at"))
    expiry_at = _parse_datetime(company.get("expired_at"))
    status = str(company.get("billing_status") or ("trial" if trial_ends_at else "active")).lower()

    if status == "trial" and trial_ends_at and trial_ends_at <= now:
        status = "expired"

    anchor = trial_ends_at or expiry_at
    restricted_at = anchor + timedelta(days=TRIAL_GRACE_DAYS) if status == "expired" and anchor else None
    restricted = bool(restricted_at and now >= restricted_at)
    grace_days_left = (
        max(0, ceil((restricted_at - now).total_seconds() / 86400))
        if restricted_at and not restricted
        else 0
    )

    return {
        "status": status,
        "access_restricted": restricted,
        "grace_period_days": TRIAL_GRACE_DAYS,
        "grace_days_left": grace_days_left,
        "restricted_at": restricted_at.isoformat() if restricted_at else None,
    }
