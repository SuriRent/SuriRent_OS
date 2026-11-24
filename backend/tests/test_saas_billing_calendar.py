from datetime import datetime, timedelta, timezone

from saas_billing_calendar import (
    plan_period_end,
    plan_period_start,
    saas_invoice_amount,
    saas_invoice_due_date,
    saas_next_renewal,
    monthly_billing_period,
    next_monthly_invoice_date,
    fixed_monthly_invoice_date,
    fixed_monthly_billing_period,
    first_monthly_invoice_after_trial,
    invoice_covers_period,
    invoice_fully_covers_period,
    saas_invoice_overdue_at,
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


def test_monthly_renewal_stays_on_next_cycle_after_late_payment():
    renewal = saas_next_renewal(
        {"interval": "month"},
        {"billing_cycle": "calendar_month", "period_end": "2026-11-30T00:00:00+00:00"},
        datetime(2026, 12, 12, tzinfo=timezone.utc),
    )

    assert renewal == datetime(2027, 1, 1, tzinfo=timezone.utc)


def test_invoice_issued_in_december_covers_november_due_december_tenth():
    start, end = monthly_billing_period(datetime(2026, 12, 1, tzinfo=timezone.utc))

    assert start == datetime(2026, 11, 1, tzinfo=timezone.utc)
    assert end == datetime(2026, 11, 30, tzinfo=timezone.utc)
    assert saas_invoice_due_date(end + timedelta(days=1)) == "2026-12-10"
    assert next_monthly_invoice_date(end) == datetime(2027, 1, 1, tzinfo=timezone.utc)


def test_fixed_monthly_invoice_covers_its_billed_calendar_month():
    issued_at = datetime(2026, 11, 28, tzinfo=timezone.utc)
    start, end = fixed_monthly_billing_period(issued_at)

    assert start == datetime(2026, 11, 1, tzinfo=timezone.utc)
    assert end == datetime(2026, 11, 30, tzinfo=timezone.utc)
    assert fixed_monthly_invoice_date(issued_at, include_current=False) == datetime(
        2026, 12, 28, tzinfo=timezone.utc,
    )
    assert saas_invoice_due_date(end + timedelta(days=1)) == "2026-12-10"
    december_start, december_end = fixed_monthly_billing_period(
        datetime(2026, 12, 28, tzinfo=timezone.utc),
    )
    assert december_start == datetime(2026, 12, 1, tzinfo=timezone.utc)
    assert december_end == datetime(2026, 12, 31, tzinfo=timezone.utc)
    assert saas_invoice_due_date(december_end + timedelta(days=1)) == "2027-01-10"


def test_first_post_trial_invoice_covers_current_month_and_skips_duplicate_cycle():
    start, end, next_invoice = first_monthly_invoice_after_trial(
        datetime(2026, 11, 23, tzinfo=timezone.utc),
    )

    assert start == datetime(2026, 11, 1, tzinfo=timezone.utc)
    assert end == datetime(2026, 11, 30, tzinfo=timezone.utc)
    assert next_invoice == datetime(2026, 12, 28, tzinfo=timezone.utc)
    assert saas_invoice_due_date(end + timedelta(days=1)) == "2026-12-10"


def test_trial_ending_on_february_28_skips_that_months_regular_invoice():
    start, end, next_invoice = first_monthly_invoice_after_trial(
        datetime(2026, 2, 28, 12, tzinfo=timezone.utc),
    )
    assert start == datetime(2026, 2, 1, tzinfo=timezone.utc)
    assert end == datetime(2026, 2, 28, tzinfo=timezone.utc)
    assert next_invoice == datetime(2026, 3, 28, tzinfo=timezone.utc)


def test_due_date_is_not_overdue_until_next_day_in_suriname():
    overdue_at = saas_invoice_overdue_at({"due_date": "2026-12-10"})

    assert overdue_at == datetime(2026, 12, 11, 3, tzinfo=timezone.utc)
    assert datetime(2026, 12, 11, 2, 59, tzinfo=timezone.utc) < overdue_at


def test_monthly_renewal_uses_invoice_next_cycle_date_after_late_payment():
    renewal = saas_next_renewal(
        {"interval": "month"},
        {
            "billing_cycle": "fixed_28_arrears",
            "period_end": "2026-11-30T00:00:00+00:00",
            "next_invoice_at": "2026-12-28T00:00:00+00:00",
        },
        datetime(2027, 1, 12, tzinfo=timezone.utc),
    )

    assert renewal == datetime(2026, 12, 28, tzinfo=timezone.utc)


def test_existing_invoice_overlap_and_full_period_checks():
    invoice = {
        "charge_history": [{
            "kind": "subscription",
            "period_start": "2026-11-01T00:00:00+00:00",
            "period_end": "2026-11-30T00:00:00+00:00",
        }],
    }

    assert invoice_covers_period(
        invoice,
        datetime(2026, 11, 1, tzinfo=timezone.utc),
        datetime(2026, 11, 30, tzinfo=timezone.utc),
    )
    assert invoice_covers_period(
        invoice,
        datetime(2026, 10, 31, tzinfo=timezone.utc),
        datetime(2026, 11, 30, tzinfo=timezone.utc),
    )
    assert not invoice_fully_covers_period(
        invoice,
        datetime(2026, 10, 31, tzinfo=timezone.utc),
        datetime(2026, 11, 30, tzinfo=timezone.utc),
    )
    assert invoice_fully_covers_period(
        invoice,
        datetime(2026, 11, 1, tzinfo=timezone.utc),
        datetime(2026, 11, 30, tzinfo=timezone.utc),
    )


def test_saas_invoice_deadline_is_the_next_tenth():
    assert saas_invoice_due_date(datetime(2026, 11, 4, tzinfo=timezone.utc)) == "2026-11-10"
    assert saas_invoice_due_date(datetime(2026, 11, 11, tzinfo=timezone.utc)) == "2026-12-10"
