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
    apartments = SimpleNamespace(find_one=AsyncMock(return_value={"number": "1A"}))
    db = SimpleNamespace(power_devices=devices, tenants=tenants, apartments=apartments)
    config = {"auto_cutoff": True, "access_id": "tuya-id", "months": 1, "grace_days": 0}
    monkeypatch.setattr(power._deps, "db", db)
    monkeypatch.setattr(power, "_cfg", AsyncMock(return_value=config))
    monkeypatch.setattr(power._deps, "now_utc", lambda: now)
    monkeypatch.setattr(power._deps, "iso", lambda value: value.isoformat())
    monkeypatch.setattr(power, "_log", AsyncMock())
    monkeypatch.setattr(power._deps, "notify_company_admins", AsyncMock())
    monkeypatch.setattr(power._deps, "notify_tenant_power", AsyncMock())
    publish_receipt = AsyncMock()
    monkeypatch.setattr(power._deps, "publish_power_cutoff_receipt", publish_receipt)
    switch = AsyncMock()
    monkeypatch.setattr(power, "_switch", switch)
    overdue = AsyncMock(return_value=[{
        "tenant_id": "tenant-a", "name": "Huurder", "count": 1,
        "amounts": {"SRD": 1250},
    }])

    asyncio.run(power.enforce_company("company-a", overdue))

    switch.assert_awaited_once_with("company-a", device, False, "auto", "1 maanden achterstand")
    assert devices.update_one.await_args.args[1] == {"$set": {"notice_at": now.isoformat()}}
    publish_receipt.assert_awaited_once_with("company-a", {
        "tenant_name": "Huurder",
        "apartment_number": "1A",
        "at": now.isoformat(),
        "amounts": {"SRD": 1250},
        "automatic": True,
    })
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


def test_manual_power_off_sends_receipt_with_overdue_balance(monkeypatch):
    device = {"id": "device-a", "apartment_id": "apartment-a", "on": True}
    tenants = SimpleNamespace(find_one=AsyncMock(return_value={"id": "tenant-a", "name": "Huurder"}))
    apartments = SimpleNamespace(find_one=AsyncMock(return_value={"number": "1A"}))
    monkeypatch.setattr(power, "_own_device", AsyncMock(return_value=device))
    monkeypatch.setattr(power, "_switch", AsyncMock())
    monkeypatch.setattr(power._deps, "company_id_of", lambda _user: "company-a")
    monkeypatch.setattr(power._deps, "db", SimpleNamespace(tenants=tenants, apartments=apartments))
    monkeypatch.setattr(power._deps, "get_overdue_tenants", AsyncMock(return_value=[{
        "tenant_id": "tenant-a", "amounts": {"SRD": 1250}, "count": 1,
    }]))
    publish_receipt = AsyncMock()
    monkeypatch.setattr(power._deps, "publish_power_cutoff_receipt", publish_receipt)
    monkeypatch.setattr(power._deps, "now_utc", lambda: datetime(2026, 11, 22, tzinfo=timezone.utc))
    monkeypatch.setattr(power._deps, "iso", lambda value: value.isoformat())

    result = asyncio.run(power.device_switch("device-a", power.SwitchIn(on=False), {"name": "Beheerder"}))

    assert result == {"ok": True, "on": False}
    publish_receipt.assert_awaited_once()
    assert publish_receipt.await_args.args[0] == "company-a"
    assert publish_receipt.await_args.args[1] == {
        "tenant_name": "Huurder",
        "apartment_number": "1A",
        "at": "2026-11-22T00:00:00+00:00",
        "amounts": {"SRD": 1250},
        "automatic": False,
    }
