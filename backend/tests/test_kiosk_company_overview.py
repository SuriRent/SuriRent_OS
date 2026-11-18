import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import HTTPException


def test_company_overview_counts_only_net_open_balances_by_currency(monkeypatch):
    import server

    def inv(iid, month, currency, total, paid=None):
        return {
            "id": iid, "period_month": month, "period_year": 2026,
            "currency": currency, "amount_due": total, "paid_amount": paid,
        }

    invoices = [
        {**inv("legacy", 10, "SRD", 120), "due_date": "2026-11-03"},
        inv("partial", 11, "USD", 200, 150),
        inv("future", 12, "SRD", 500, 0),
        inv("settled", 10, "SRD", 100, 100),
    ]
    db = SimpleNamespace(
        companies=SimpleNamespace(find_one=AsyncMock(return_value={"kiosk_utility_months": {"2026-11": {"ebs": 0}}})),
        company_settings=SimpleNamespace(find_one=AsyncMock(return_value=None)),
        invoices=SimpleNamespace(find=Mock(return_value=SimpleNamespace(to_list=AsyncMock(return_value=invoices)))),
        payments=SimpleNamespace(find=Mock(return_value=SimpleNamespace(to_list=AsyncMock(return_value=[
            {"invoice_id": "legacy", "amount": 20},
        ])))),
        kasgeld=SimpleNamespace(find=Mock(return_value=Mock(sort=Mock(return_value=SimpleNamespace(
            to_list=AsyncMock(return_value=[{"id": "cash-a", "kiosk_utility": {"provider": "ebs"}, "amount": 75}]),
        ))))),
    )
    paid = AsyncMock(return_value={"USD": {"total": 150, "count": 1}})
    monkeypatch.setattr(server, "db", db)
    monkeypatch.setattr(server, "now_utc", lambda: datetime(2026, 11, 10, tzinfo=timezone.utc))
    monkeypatch.setattr(server, "_agg_by_currency", paid)
    result = asyncio.run(server.kiosk_company_overview(session={"company_id": "company-a"}))

    assert result["paid"] == {"USD": 150}
    assert result["outstanding"] == {"SRD": 100, "USD": 50}
    assert result["overdue"] == {"SRD": 100}
    assert result["utilities"] == {"ebs": 0}
    assert result["period"] == "2026-11"
    assert [entry["id"] for entry in result["utility_payments"]["ebs"]] == ["cash-a"]
    assert db.kasgeld.find.call_args.args[0]["kiosk_utility.period"] == "2026-11"
    assert db.companies.find_one.await_args.args[0] == {"id": "company-a"}
    assert db.invoices.find.call_args.args[0]["company_id"] == "company-a"
    assert db.payments.find.call_args.args[0]["company_id"] == "company-a"
    match = paid.await_args.args[1][0]["$match"]
    assert match["company_id"] == "company-a"
    assert match["status"] == "approved"
    assert match["paid_at"] == {"$gte": "2026-11-01T03:00:00+00:00", "$lt": "2026-12-01T03:00:00+00:00"}


def test_only_company_admin_can_save_utility_amounts(monkeypatch):
    import server

    update = AsyncMock(return_value=SimpleNamespace(matched_count=1))
    monkeypatch.setattr(server, "db", SimpleNamespace(companies=SimpleNamespace(update_one=update)))
    body = server.KioskUtilityAmounts(company_id="company-a", period="2025-11", ebs=125.5, swm=0, telesur=None)
    admin = {"role": "admin", "active_company_id": "company-a"}
    assert asyncio.run(server.kiosk_utility_edit_access(admin)) == {"company_id": "company-a"}
    assert asyncio.run(server.kiosk_utility_edit_access({**admin, "staff": True})) == {"company_id": None}
    assert asyncio.run(server.kiosk_utility_edit_access(None)) == {"company_id": None}

    for unauthorized in ({**admin, "staff": True}, {**admin, "active_company_id": "company-b"}, {**admin, "role": "boekhouder"}):
        with pytest.raises(HTTPException) as exc:
            asyncio.run(server.kiosk_save_utility_amounts(body, unauthorized))
        assert exc.value.status_code == 403
    update.assert_not_awaited()

    expected = {"ebs": 125.5, "swm": 0, "telesur": None}
    assert asyncio.run(server.kiosk_save_utility_amounts(body, admin)) == {"utilities": expected}
    update.assert_awaited_once_with({"id": "company-a"}, {"$set": {"kiosk_utility_months.2025-11": expected}})


def test_link_updates_only_the_existing_company_expense(monkeypatch):
    import server

    update = AsyncMock(side_effect=[SimpleNamespace(matched_count=1), SimpleNamespace(matched_count=0)])
    monkeypatch.setattr(server, "db", SimpleNamespace(kasgeld=SimpleNamespace(update_one=update)))
    body = server.KioskUtilityExpense(company_id="company-a", period="2025-11", provider="ebs", entry_id="cash-a", linked=True)
    admin = {"role": "admin", "active_company_id": "company-a"}
    with pytest.raises(HTTPException) as exc:
        asyncio.run(server.kiosk_link_utility_expense(body, {**admin, "active_company_id": "company-b"}))
    assert exc.value.status_code == 403
    update.assert_not_awaited()

    asyncio.run(server.kiosk_link_utility_expense(body, admin))
    criteria, change = update.await_args.args
    assert {key: criteria[key] for key in ("id", "company_id", "type", "currency")} == {
        "id": "cash-a", "company_id": "company-a", "type": "out", "currency": "SRD",
    }
    assert criteria["$or"] == [
        {"kiosk_utility": {"$exists": False}}, {"kiosk_utility": {"period": "2025-11", "provider": "ebs"}},
    ]
    assert change == {"$set": {"kiosk_utility": {"period": "2025-11", "provider": "ebs"}}}

    with pytest.raises(HTTPException) as exc:
        asyncio.run(server.kiosk_link_utility_expense(body.model_copy(update={"provider": "swm"}), admin))
    assert exc.value.status_code == 409
