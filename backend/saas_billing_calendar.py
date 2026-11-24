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
    return {"billing_cycle": "calendar_month_arrears"} if interval == "month" else {}


def monthly_billing_period(issue_at: datetime) -> tuple[datetime, datetime]:
    """Return the completed calendar month immediately before an invoice date."""
    if issue_at.tzinfo is None:
        issue_at = issue_at.replace(tzinfo=timezone.utc)
    current_month = issue_at.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    period_end = current_month - timedelta(days=1)
    period_start = period_end.replace(day=1)
    return period_start, period_end


def next_monthly_invoice_date(period_end: datetime) -> datetime:
    """Monthly arrears are invoiced on the first day after the next service month."""
    month_index = period_end.year * 12 + period_end.month - 1 + 2
    year, month = divmod(month_index, 12)
    return period_end.replace(
        year=year, month=month + 1, day=1, hour=0, minute=0, second=0, microsecond=0,
    )


def fixed_monthly_invoice_date(value: datetime, *, include_current: bool = True) -> datetime:
    """Return the next fixed monthly invoice date on or after ``value``."""
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    if value.day < 28 or (include_current and value.day == 28):
        return value.replace(day=28, hour=0, minute=0, second=0, microsecond=0)
    month_index = value.year * 12 + value.month
    year, month = divmod(month_index, 12)
    return value.replace(
        year=year, month=month + 1, day=28,
        hour=0, minute=0, second=0, microsecond=0,
    )


def fixed_monthly_billing_period(issue_at: datetime) -> tuple[datetime, datetime]:
    """A fixed 28th invoice covers the current calendar month."""
    if issue_at.tzinfo is None:
        issue_at = issue_at.replace(tzinfo=timezone.utc)
    period_start = issue_at.replace(
        day=1, hour=0, minute=0, second=0, microsecond=0,
    )
    period_end = period_start.replace(
        day=calendar.monthrange(period_start.year, period_start.month)[1],
    )
    return period_start, period_end


def first_monthly_invoice_after_trial(
    trial_ends_at: datetime,
) -> tuple[datetime, datetime, datetime]:
    """Return the trial-ending month's full-price invoice and the next 28th."""
    if trial_ends_at.tzinfo is None:
        trial_ends_at = trial_ends_at.replace(tzinfo=timezone.utc)
    period_start = trial_ends_at.replace(
        day=1, hour=0, minute=0, second=0, microsecond=0,
    )
    period_end = period_start.replace(
        day=calendar.monthrange(period_start.year, period_start.month)[1],
        hour=0, minute=0, second=0, microsecond=0,
    )
    next_invoice_at = fixed_monthly_invoice_date(period_end, include_current=False)
    return period_start, period_end, next_invoice_at


def invoice_covers_period(invoice: Optional[dict], period_start: datetime,
                          period_end: datetime) -> bool:
    if not invoice:
        return False
    entries = invoice.get("charge_history") or [invoice]
    for entry in entries:
        if entry.get("kind") not in {"subscription", "plan_change"}:
            continue
        try:
            start = datetime.fromisoformat(str(entry["period_start"]).replace("Z", "+00:00"))
            end = datetime.fromisoformat(str(entry["period_end"]).replace("Z", "+00:00"))
        except (KeyError, TypeError, ValueError):
            continue
        if start.date() <= period_end.date() and end.date() >= period_start.date():
            return True
    return False


def invoice_fully_covers_period(invoice: Optional[dict], period_start: datetime,
                                period_end: datetime) -> bool:
    if not invoice:
        return False
    entries = invoice.get("charge_history") or [invoice]
    for entry in entries:
        if entry.get("kind") not in {"subscription", "plan_change"}:
            continue
        try:
            start = datetime.fromisoformat(str(entry["period_start"]).replace("Z", "+00:00"))
            end = datetime.fromisoformat(str(entry["period_end"]).replace("Z", "+00:00"))
        except (KeyError, TypeError, ValueError):
            continue
        if start.date() <= period_start.date() and end.date() >= period_end.date():
            return True
    return False


def saas_next_renewal(plan: Optional[dict], invoice: Optional[dict],
                      now: datetime) -> Optional[datetime]:
    if invoice:
        next_invoice_at = invoice.get("next_invoice_at")
        if not next_invoice_at:
            history = invoice.get("charge_history") or []
            if history:
                next_invoice_at = history[-1].get("next_invoice_at")
        if next_invoice_at:
            try:
                renewal = datetime.fromisoformat(str(next_invoice_at).replace("Z", "+00:00"))
                if renewal.tzinfo is None:
                    renewal = renewal.replace(tzinfo=timezone.utc)
                return renewal
            except (TypeError, ValueError):
                pass
    interval = str((plan or {}).get("interval") or "month").lower()
    if interval == "month":
        period_end = (invoice or {}).get("period_end")
        try:
            end = datetime.fromisoformat(str(period_end).replace("Z", "+00:00"))
            if end.tzinfo is None:
                end = end.replace(tzinfo=timezone.utc)
            return next_monthly_invoice_date(end)
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


def saas_invoice_overdue_at(invoice: dict) -> Optional[datetime]:
    """Return when the invoice becomes overdue, after the due day in Suriname."""
    due = invoice.get("due_date")
    if due:
        day = datetime.fromisoformat(str(due)[:10]).date()
        suriname = timezone(timedelta(hours=-3))
        return datetime.combine(day + timedelta(days=1), datetime.min.time(), tzinfo=suriname)
    period_end = invoice.get("period_end")
    if not period_end:
        return None
    end = datetime.fromisoformat(str(period_end).replace("Z", "+00:00"))
    return end if end.tzinfo else end.replace(tzinfo=timezone.utc)
