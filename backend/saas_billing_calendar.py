"""Calendar rules for SaaS invoice periods and due dates."""

import calendar
from datetime import datetime, timedelta, timezone
from typing import Optional


def plan_period_end(plan: Optional[dict], start: datetime) -> Optional[datetime]:
    interval = str((plan or {}).get("interval") or "month").lower()
    if interval in {"lifetime", "once"}:
        return None
    if interval == "month":
        last_day = calendar.monthrange(start.year, start.month)[1]
        return start.replace(day=last_day, hour=0, minute=0, second=0, microsecond=0)
    return start + timedelta(days={"quarter": 90, "year": 365}.get(interval, 30))


def plan_period_start(plan: Optional[dict], start: datetime) -> datetime:
    interval = str((plan or {}).get("interval") or "month").lower()
    if interval == "month":
        if start.tzinfo is None:
            start = start.replace(tzinfo=timezone.utc)
        return start.replace(hour=0, minute=0, second=0, microsecond=0)
    return start


def saas_invoice_amount(plan: Optional[dict], amount: float, period_start: datetime,
                        period_end: Optional[datetime]) -> float:
    """Prorate a monthly invoice when service starts after the first of a month."""
    interval = str((plan or {}).get("interval") or "month").lower()
    if interval != "month" or not period_end:
        return round(float(amount), 2)
    days_in_month = calendar.monthrange(period_start.year, period_start.month)[1]
    billable_days = max(0, (period_end.date() - period_start.date()).days + 1)
    return round(float(amount) * billable_days / days_in_month, 2)


def saas_invoice_cycle_fields(plan: Optional[dict]) -> dict:
    interval = str((plan or {}).get("interval") or "month").lower()
    return {"billing_cycle": "calendar_month"} if interval == "month" else {}


def saas_next_renewal(plan: Optional[dict], invoice: Optional[dict],
                      now: datetime) -> Optional[datetime]:
    interval = str((plan or {}).get("interval") or "month").lower()
    if interval == "month" and (invoice or {}).get("billing_cycle") == "calendar_month":
        period_end = (invoice or {}).get("period_end")
        try:
            end = datetime.fromisoformat(str(period_end).replace("Z", "+00:00"))
            if end.tzinfo is None:
                end = end.replace(tzinfo=timezone.utc)
            return end.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)
        except (TypeError, ValueError):
            pass
    period_end = plan_period_end(plan, now)
    if interval == "month" and period_end:
        return period_end + timedelta(days=1)
    return period_end


def saas_invoice_due_date(issued_at: Optional[datetime] = None) -> str:
    """Return the next 10th on or after the invoice date."""
    issued_on = (issued_at or datetime.now(timezone.utc)).date()
    due = issued_on.replace(day=10)
    if issued_on > due:
        year, month = (issued_on.year + 1, 1) if issued_on.month == 12 else (issued_on.year, issued_on.month + 1)
        due = due.replace(year=year, month=month)
    return due.isoformat()
