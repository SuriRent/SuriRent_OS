from datetime import datetime, timedelta, timezone

from billing_access import TRIAL_GRACE_DAYS, billing_access_state


def test_trial_has_full_access_until_trial_ends():
    now = datetime(2026, 11, 1, tzinfo=timezone.utc)
    state = billing_access_state(
        {"billing_status": "trial", "trial_ends_at": (now + timedelta(days=1)).isoformat()},
        now,
    )

    assert state["status"] == "trial"
    assert state["access_restricted"] is False


def test_trial_end_date_infers_trial_status_when_status_is_missing():
    now = datetime(2026, 11, 1, tzinfo=timezone.utc)
    state = billing_access_state(
        {"trial_ends_at": (now - timedelta(days=1)).isoformat()},
        now,
    )

    assert state["status"] == "expired"
    assert state["access_restricted"] is False


def test_expired_trial_keeps_full_access_during_seven_day_grace():
    now = datetime(2026, 11, 1, tzinfo=timezone.utc)
    ended = now - timedelta(days=3)
    state = billing_access_state(
        {"billing_status": "trial", "trial_ends_at": ended.isoformat()},
        now,
    )

    assert state["status"] == "expired"
    assert state["access_restricted"] is False
    assert state["grace_days_left"] == 4
    assert state["grace_period_days"] == TRIAL_GRACE_DAYS


def test_expired_trial_is_restricted_at_end_of_grace_period():
    ended = datetime(2026, 11, 1, tzinfo=timezone.utc)
    now = ended + timedelta(days=TRIAL_GRACE_DAYS)
    state = billing_access_state(
        {"billing_status": "expired", "trial_ends_at": ended.isoformat()},
        now,
    )

    assert state["access_restricted"] is True
    assert state["grace_days_left"] == 0


def test_paid_or_cancelled_company_is_not_restricted_by_trial_policy():
    now = datetime(2026, 11, 20, tzinfo=timezone.utc)
    for status in ("active", "cancelled", "past_due"):
        state = billing_access_state(
            {"billing_status": status, "trial_ends_at": "2026-10-01T00:00:00Z"},
            now,
        )
        assert state["access_restricted"] is False
