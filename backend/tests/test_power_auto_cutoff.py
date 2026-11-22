import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

from routes import power


class AsyncCursor:
    def __init__(self, items):
        self.items = items

    def __aiter__(self):
        self.iterator = iter(self.items)
        return self

    async def __anext__(self):
        try:
            return next(self.iterator)
        except StopIteration:
            raise StopAsyncIteration


def test_zero_grace_sends_notice_then_cuts_power_in_same_pass(monkeypatch):
    now = datetime(2026, 11, 22, tzinfo=timezone.utc)
    device = {
        "id": "device-a",
        "apartment_id": "apartment-a",
        "on": True,
    }
    devices = SimpleNamespace(
        find=lambda *_args, **_kwargs: AsyncCursor([device]),
        update_one=AsyncMock(),
    )
    tenants = SimpleNamespace(find_one=AsyncMock(return_value={"id": "tenant-a", "name": "Huurder"}))
    db = SimpleNamespace(power_devices=devices, tenants=tenants)
    config = {"auto_cutoff": True, "access_id": "tuya-id", "months": 1, "grace_days": 0}
    monkeypatch.setattr(power._deps, "db", db)
    monkeypatch.setattr(power, "_cfg", AsyncMock(return_value=config))
    monkeypatch.setattr(power._deps, "now_utc", lambda: now)
    monkeypatch.setattr(power._deps, "iso", lambda value: value.isoformat())
    monkeypatch.setattr(power, "_log", AsyncMock())
    monkeypatch.setattr(power._deps, "notify_company_admins", AsyncMock())
    monkeypatch.setattr(power._deps, "notify_tenant_power", AsyncMock())
    switch = AsyncMock()
    monkeypatch.setattr(power, "_switch", switch)
    overdue = AsyncMock(return_value=[{"tenant_id": "tenant-a", "name": "Huurder", "count": 1}])

    asyncio.run(power.enforce_company("company-a", overdue))

    switch.assert_awaited_once_with("company-a", device, False, "auto", "1 maanden achterstand")
    assert devices.update_one.await_args.args[1] == {"$set": {"notice_at": now.isoformat()}}
    power._deps.notify_tenant_power.assert_awaited()


def test_paid_overdue_tenant_restores_power_cut_automatically(monkeypatch):
    device = {
        "id": "device-a",
        "apartment_id": "apartment-a",
        "on": False,
        "cut_by_auto": True,
    }
    devices = SimpleNamespace(
        find=lambda *_args, **_kwargs: AsyncCursor([device]),
        update_one=AsyncMock(),
    )
    tenants = SimpleNamespace(find_one=AsyncMock(return_value={"id": "tenant-a", "name": "Huurder"}))
    monkeypatch.setattr(power._deps, "db", SimpleNamespace(power_devices=devices, tenants=tenants))
    monkeypatch.setattr(power, "_cfg", AsyncMock(return_value={
        "auto_cutoff": True, "access_id": "tuya-id", "months": 1, "grace_days": 0,
    }))
    monkeypatch.setattr(power, "_log", AsyncMock())
    monkeypatch.setattr(power._deps, "notify_company_admins", AsyncMock())
    notify_tenant = AsyncMock()
    monkeypatch.setattr(power._deps, "notify_tenant_power", notify_tenant)
    switch = AsyncMock()
    monkeypatch.setattr(power, "_switch", switch)
    overdue = AsyncMock(return_value=[])

    asyncio.run(power.enforce_company("company-a", overdue))

    switch.assert_awaited_once_with("company-a", device, True, "auto", "achterstand betaald")
    notify_tenant.assert_awaited_once_with(
        "company-a", "tenant-a", "Bedankt voor uw betaling. Uw stroom is weer aangezet.",
    )
