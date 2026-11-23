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


def test_fixed_monthly_invoice_covers_the_following_calendar_month():
    issued_at = datetime(2026, 11, 28, tzinfo=timezone.utc)
    start, end = fixed_monthly_billing_period(issued_at)

    assert start == datetime(2026, 12, 1, tzinfo=timezone.utc)
    assert end == datetime(2026, 12, 31, tzinfo=timezone.utc)
    assert fixed_monthly_invoice_date(issued_at, include_current=False) == datetime(
        2026, 12, 28, tzinfo=timezone.utc,
    )
    assert saas_invoice_due_date(issued_at) == "2026-12-10"


def test_first_post_trial_invoice_is_full_bridge_until_fixed_cycle():
    start, end, next_invoice = first_monthly_invoice_after_trial(
        datetime(2026, 11, 23, tzinfo=timezone.utc),
    )

    assert start == datetime(2026, 11, 23, tzinfo=timezone.utc)
    assert end == datetime(2026, 12, 31, tzinfo=timezone.utc)
    assert next_invoice == datetime(2026, 12, 28, tzinfo=timezone.utc)


def test_monthly_renewal_uses_invoice_next_cycle_date_after_late_payment():
    renewal = saas_next_renewal(
        {"interval": "month"},
        {
            "billing_cycle": "fixed_28_advance",
            "period_end": "2026-12-31T00:00:00+00:00",
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
