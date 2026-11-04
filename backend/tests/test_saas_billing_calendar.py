from datetime import datetime, timezone

from saas_billing_calendar import (
    plan_period_end,
    plan_period_start,
    saas_invoice_amount,
    saas_invoice_due_date,
    saas_next_renewal,
)


def test_monthly_period_ends_on_calendar_month_end():
    start = datetime(2024, 2, 4, 15, tzinfo=timezone.utc)

    assert plan_period_start({"interval": "month"}, start) == datetime(2024, 2, 4, tzinfo=timezone.utc)
    assert plan_period_end({"interval": "month"}, start) == datetime(2024, 2, 29, tzinfo=timezone.utc)


def test_first_month_is_prorated_by_remaining_calendar_days():
    start = datetime(2026, 11, 15, tzinfo=timezone.utc)
    end = plan_period_end({"interval": "month"}, start)

    assert saas_invoice_amount({"interval": "month"}, 3000, start, end) == 1600


def test_quarterly_and_yearly_plans_keep_their_existing_periods():
    start = datetime(2026, 11, 4, tzinfo=timezone.utc)

    assert plan_period_end({"interval": "quarter"}, start) == datetime(2027, 2, 2, tzinfo=timezone.utc)
    assert plan_period_end({"interval": "year"}, start) == datetime(2027, 11, 4, tzinfo=timezone.utc)
    assert saas_invoice_amount({"interval": "quarter"}, 900, start, start) == 900


def test_monthly_renewal_stays_on_first_after_late_payment():
    renewal = saas_next_renewal(
        {"interval": "month"},
        {"billing_cycle": "calendar_month", "period_end": "2026-11-30T00:00:00+00:00"},
        datetime(2026, 12, 12, tzinfo=timezone.utc),
    )

    assert renewal == datetime(2026, 12, 1, tzinfo=timezone.utc)


def test_saas_invoice_deadline_is_the_next_tenth():
    assert saas_invoice_due_date(datetime(2026, 11, 4, tzinfo=timezone.utc)) == "2026-11-10"
    assert saas_invoice_due_date(datetime(2026, 11, 11, tzinfo=timezone.utc)) == "2026-12-10"
