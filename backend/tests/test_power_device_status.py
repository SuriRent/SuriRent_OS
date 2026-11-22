import asyncio
from unittest.mock import AsyncMock

from routes import power


def test_offline_tuya_device_reports_offline_without_cached_switch_state(monkeypatch):
    monkeypatch.setattr(power._deps, "company_id_of", lambda _user: "company-a")
    monkeypatch.setattr(power, "_own_device", AsyncMock(return_value={
        "id": "device-a",
        "tuya_device_id": "tuya-device-a",
        "on": True,
    }))
    monkeypatch.setattr(power, "_cfg", AsyncMock(return_value={}))
    tuya = AsyncMock(return_value={"online": False})
    monkeypatch.setattr(power, "_tuya", tuya)
    read = AsyncMock()
    monkeypatch.setattr(power, "_read", read)

    result = asyncio.run(power.device_status("device-a", user={"role": "admin"}))

    assert result == {"switch_code": None, "on": None, "online": False}
    tuya.assert_awaited_once_with({}, "GET", "/v1.0/devices/tuya-device-a")
    read.assert_not_awaited()


def test_connectivity_only_returns_tuya_online_state_without_reading_status(monkeypatch):
    monkeypatch.setattr(power._deps, "company_id_of", lambda _user: "company-a")
    monkeypatch.setattr(power, "_own_device", AsyncMock(return_value={
        "id": "device-a",
        "tuya_device_id": "tuya-device-a",
        "on": True,
    }))
    monkeypatch.setattr(power, "_cfg", AsyncMock(return_value={}))
    monkeypatch.setattr(power, "_tuya", AsyncMock(return_value={"online": True}))
    read = AsyncMock()
    monkeypatch.setattr(power, "_read", read)

    result = asyncio.run(power.device_status(
        "device-a", connectivity_only=True, user={"role": "admin"},
    ))

    assert result == {"on": True, "online": True}
    read.assert_not_awaited()
