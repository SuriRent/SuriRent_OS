"""
Stroombeheer (Tuya slimme DIN-railschakelaars, bv. TONGOU met verbruiksmeting).

- Per bedrijf: Tuya Cloud-gegevens (Access ID/Secret + regio) in `companies.power_config`.
- Per appartement: één schakelaar in `power_devices`.
- Automatische afsluiting bij achterstand: aankondiging -> uitstel -> uitzetten,
  en automatisch weer aanzetten zodra de achterstand is betaald.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from . import _deps

router = APIRouter()
ADMIN_ROLES = ("admin", "owner", "superadmin")

TUYA_HOSTS = {
    "eu": "https://openapi.tuyaeu.com",
    "us": "https://openapi.tuyaus.com",
    "us-east": "https://openapi-ueaz.tuyaus.com",
    "in": "https://openapi.tuyain.com",
    "cn": "https://openapi.tuyacn.com",
}
DEFAULTS = {"auto_cutoff": False, "months": 2, "grace_days": 3}
_token_cache: dict = {}


async def _admin(user: dict = Depends(_deps.get_current_user)) -> dict:
    cid = _deps.company_id_of(user)
    if user.get("role") not in ADMIN_ROLES or not cid:
        raise HTTPException(403, "Alleen de beheerder kan stroom beheren")
    await _deps.require_plan_feature(cid, "allow_power", "Stroombeheer")
    return user


async def _owner(user: dict = Depends(_admin)) -> dict:
    # Kiosk-medewerkers (staff) mogen schakelen, maar de instellingen niet wijzigen.
    if user.get("staff"):
        raise HTTPException(403, "Alleen de beheerder kan de stroominstellingen wijzigen")
    return user


def _mask(v: str) -> str:
    return (v[:3] + "…" + v[-3:]) if v and len(v) > 8 else ("•" * len(v or ""))


async def _cfg(cid: str) -> dict:
    c = await _deps.db.companies.find_one({"id": cid}, {"_id": 0, "power_config": 1}) or {}
    return c.get("power_config") or {}


class TuyaError(Exception):
    pass


def _sign(secret: str, msg: str) -> str:
    return hmac.new(secret.encode(), msg.encode(), hashlib.sha256).hexdigest().upper()


async def _tuya(cfg: dict, method: str, path: str, body: Optional[dict] = None, with_token: bool = True) -> dict:
    """Ondertekende Tuya Cloud-aanroep (HMAC-SHA256, token wordt per bedrijf gecachet)."""
    access_id, secret = cfg.get("access_id", ""), cfg.get("access_secret", "")
    host = TUYA_HOSTS.get(cfg.get("region") or "eu", TUYA_HOSTS["eu"])
    if not (access_id and secret):
        raise TuyaError("Tuya-gegevens zijn niet ingevuld")
    token = ""
    if with_token:
        cached = _token_cache.get(access_id)
        if cached and cached[1] > time.time() + 60:
            token = cached[0]
        else:
            res = await _tuya(cfg, "GET", "/v1.0/token?grant_type=1", with_token=False)
            token = res["access_token"]
            _token_cache[access_id] = (token, time.time() + int(res.get("expire_time", 7200)))
    t = str(int(time.time() * 1000))
    raw = json_body = ""
    if body is not None:
        import json as _json
        raw = json_body = _json.dumps(body, separators=(",", ":"))
    string_to_sign = f"{method}\n{hashlib.sha256(raw.encode()).hexdigest()}\n\n{path}"
    sign = _sign(secret, access_id + token + t + string_to_sign)
    headers = {"client_id": access_id, "sign": sign, "t": t, "sign_method": "HMAC-SHA256",
               "Content-Type": "application/json"}
    if token:
        headers["access_token"] = token
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.request(method, host + path, headers=headers, content=json_body or None)
    data = r.json()
    if not data.get("success"):
        if data.get("code") in (1010, 1011):
            _token_cache.pop(access_id, None)
        raise TuyaError(f"Tuya: {data.get('msg') or data.get('code') or r.status_code}")
    return data.get("result") or {}


def _parse_status(status: list) -> dict:
    """Zet Tuya-datapunten om naar eenheden (typische TONGOU-schalen)."""
    d = {s.get("code"): s.get("value") for s in status or []}
    switch_codes = sorted(
        (code for code in d if code in ("switch", "switch_led") or (code.startswith("switch_") and code[7:].isdigit())),
        key=lambda code: (code != "switch_led", code != "switch_1", code),
    )
    sw_code = switch_codes[0] if switch_codes else None
    out = {"switch_code": sw_code, "on": bool(d.get(sw_code)) if sw_code else None}
    if "cur_power" in d:
        out["power_w"] = round(float(d["cur_power"]) / 10, 1)
    if "cur_voltage" in d:
        out["voltage_v"] = round(float(d["cur_voltage"]) / 10, 1)
    if "cur_current" in d:
        out["current_a"] = round(float(d["cur_current"]) / 1000, 2)
    if "add_ele" in d:
        out["energy_kwh"] = round(float(d["add_ele"]) / 1000, 2)
    return out


def _supported_switch_code(functions: dict, status_code: Optional[str]) -> Optional[str]:
    """Choose a Boolean on/off command actually advertised by this Tuya device."""
    entries = functions.get("functions", []) if isinstance(functions, dict) else []
    supported = {}
    for item in entries:
        if not isinstance(item, dict):
            continue
        code = item.get("code")
        if not isinstance(code, str) or not (
            code in ("switch", "switch_led") or (code.startswith("switch_") and code[7:].isdigit())
        ):
            continue
        values = item.get("values")
        if isinstance(values, str):
            try:
                values = json.loads(values)
            except json.JSONDecodeError:
                values = {}
        values_type = values.get("type") if isinstance(values, dict) else None
        value_type = str(item.get("type") or values_type or "").lower()
        if value_type == "boolean":
            supported[code] = item
    if status_code in supported:
        return status_code
    ordered = sorted(
        supported,
        key=lambda code: (code != "switch_led", code != "switch_1", code != "switch", code),
    )
    return ordered[0] if ordered else None


async def _read(cfg: dict, device_id: str) -> dict:
    res = await _tuya(cfg, "GET", f"/v1.0/devices/{device_id}/status")
    return _parse_status(res if isinstance(res, list) else [])


async def _log(cid: str, dev: dict, action: str, by: str, reason: str = "") -> None:
    await _deps.db.power_log.insert_one({
        "id": str(uuid.uuid4()), "company_id": cid, "device_id": dev["id"],
        "apartment_id": dev.get("apartment_id"), "action": action, "by": by, "reason": reason,
        "at": _deps.iso(_deps.now_utc()),
    })


async def _switch(cid: str, dev: dict, on: bool, by: str, reason: str = "") -> dict:
    if not str(dev.get("tuya_device_id", "")).startswith("demo-"):
        cfg = await _cfg(cid)
        st = await _read(cfg, dev["tuya_device_id"])
        function_data = await _tuya(cfg, "GET", f"/v1.0/devices/{dev['tuya_device_id']}/functions")
        code = _supported_switch_code(function_data, st.get("switch_code"))
        if not code:
            raise TuyaError("Dit Tuya-apparaat ondersteunt geen aan/uit-schakeling")
        await _tuya(cfg, "POST", f"/v1.0/devices/{dev['tuya_device_id']}/commands",
                    {"commands": [{"code": code, "value": bool(on)}]})
    patch = {"on": bool(on), "updated_at": _deps.iso(_deps.now_utc())}
    if on:
        patch.update({"cut_by_auto": False, "notice_at": None, "cut_at": None})
    else:
        patch.update({"cut_at": _deps.iso(_deps.now_utc()), "cut_by_auto": by == "auto"})
    await _deps.db.power_devices.update_one({"id": dev["id"]}, {"$set": patch})
    await _log(cid, dev, "aan" if on else "uit", by, reason)
    try:
        apt = await _deps.db.apartments.find_one({"id": dev.get("apartment_id")}, {"_id": 0, "number": 1}) or {}
        await _deps.notify_kiosk_employees(
            cid, "Stroom aangezet" if on else "Stroom uitgezet",
            f"Appartement {apt.get('number') or ''}".strip() + (f" · {reason}" if reason else ""),
            {"kind": "power"}, "power")
    except Exception as e:  # noqa: BLE001
        print(f"[power] medewerker-push mislukt: {e}")
    return patch


# ----------------------------------------------------------------- instellingen
class PowerConfigIn(BaseModel):
    access_id: Optional[str] = None
    access_secret: Optional[str] = None
    region: str = "eu"
    auto_cutoff: bool = False
    months: int = 2
    grace_days: int = 3


@router.get("/power/config")
async def get_power_config(user: dict = Depends(_admin)):
    c = await _cfg(_deps.company_id_of(user))
    return {
        "access_id": c.get("access_id", ""), "secret_set": bool(c.get("access_secret")),
        "secret_masked": _mask(c.get("access_secret", "")), "region": c.get("region") or "eu",
        "auto_cutoff": bool(c.get("auto_cutoff", DEFAULTS["auto_cutoff"])),
        "months": int(c.get("months") or DEFAULTS["months"]),
        "grace_days": int(c.get("grace_days") if c.get("grace_days") is not None else DEFAULTS["grace_days"]),
        "regions": list(TUYA_HOSTS),
    }


@router.put("/power/config")
async def put_power_config(body: PowerConfigIn, user: dict = Depends(_owner)):
    cid = _deps.company_id_of(user)
    if body.region not in TUYA_HOSTS:
        raise HTTPException(400, "Onbekende Tuya-regio")
    if not (1 <= body.months <= 12) or not (0 <= body.grace_days <= 30):
        raise HTTPException(400, "Ongeldige waarden voor maanden of uitstel")
    cur = await _cfg(cid)
    new = {**cur, "region": body.region, "auto_cutoff": body.auto_cutoff,
           "months": body.months, "grace_days": body.grace_days}
    if (body.access_id or "").strip():
        new["access_id"] = body.access_id.strip()
    if (body.access_secret or "").strip():
        new["access_secret"] = body.access_secret.strip()
    await _deps.db.companies.update_one({"id": cid}, {"$set": {"power_config": new}})
    _token_cache.pop(new.get("access_id", ""), None)
    return {"ok": True}


@router.post("/power/config/test")
async def test_power_config(user: dict = Depends(_owner)):
    try:
        await _tuya(await _cfg(_deps.company_id_of(user)), "GET", "/v1.0/token?grant_type=1", with_token=False)
    except TuyaError as e:
        raise HTTPException(400, str(e))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"Tuya niet bereikbaar: {e}")
    return {"ok": True}


# ------------------------------------------------------------------ apparaten
class DeviceIn(BaseModel):
    apartment_id: str
    tuya_device_id: str
    exempt: bool = False


@router.get("/power/devices")
async def list_devices(user: dict = Depends(_admin)):
    cid = _deps.company_id_of(user)
    devs = await _deps.db.power_devices.find({"company_id": cid}, {"_id": 0}).to_list(2000)
    aids = [d["apartment_id"] for d in devs]
    apts = {a["id"]: a async for a in _deps.db.apartments.find({"id": {"$in": aids}}, {"_id": 0, "id": 1, "number": 1})}
    tens = {}
    async for t in _deps.db.tenants.find({"company_id": cid, "apartment_id": {"$in": aids}, "status": {"$ne": "archived"}},
                                         {"_id": 0, "apartment_id": 1, "name": 1}):
        tens[t["apartment_id"]] = t.get("name") or ""
    for d in devs:
        d["apartment_number"] = (apts.get(d["apartment_id"]) or {}).get("number", "")
        d["tenant_name"] = tens.get(d["apartment_id"], "")
    devs.sort(key=lambda d: str(d["apartment_number"]))
    return devs


@router.post("/power/devices")
async def save_device(body: DeviceIn, user: dict = Depends(_owner)):
    cid = _deps.company_id_of(user)
    if not await _deps.db.apartments.find_one({"id": body.apartment_id, "company_id": cid}, {"_id": 1}):
        raise HTTPException(404, "Appartement niet gevonden")
    did = body.tuya_device_id.strip()
    if not did:
        raise HTTPException(400, "Vul het Tuya device-id in")
    await _deps.db.power_devices.update_one(
        {"company_id": cid, "apartment_id": body.apartment_id},
        {"$set": {"tuya_device_id": did, "exempt": body.exempt},
         "$setOnInsert": {"id": str(uuid.uuid4()), "on": None, "created_at": _deps.iso(_deps.now_utc())}},
        upsert=True)
    return {"ok": True}


async def _own_device(cid: str, dev_id: str) -> dict:
    d = await _deps.db.power_devices.find_one({"id": dev_id, "company_id": cid}, {"_id": 0})
    if not d:
        raise HTTPException(404, "Schakelaar niet gevonden")
    return d


async def _overdue_by_tenant(cid: str) -> tuple[dict, bool]:
    try:
        overdue = await _deps.get_overdue_tenants(cid)
        return {item["tenant_id"]: item for item in overdue}, True
    except Exception as e:  # noqa: BLE001
        print(f"[power] achterstandssaldo ophalen mislukt voor {cid}: {e}")
        return {}, False


async def _send_cutoff_receipt(
    cid: str, dev: dict, overdue_by_tenant: dict, balance_available: bool,
    automatic: bool = False, tenant: Optional[dict] = None, at: Optional[datetime] = None,
) -> None:
    try:
        if tenant is None:
            tenant = await _deps.db.tenants.find_one(
                {"company_id": cid, "apartment_id": dev.get("apartment_id"), "status": {"$ne": "archived"}},
                {"_id": 0, "id": 1, "name": 1},
            ) or {}
        apt = await _deps.db.apartments.find_one(
            {"id": dev.get("apartment_id"), "company_id": cid},
            {"_id": 0, "number": 1},
        ) or {}
        overdue = overdue_by_tenant.get(tenant.get("id"), {}) if balance_available else {}
        await _deps.publish_power_cutoff_receipt(cid, {
            "tenant_name": tenant.get("name") or "",
            "apartment_number": apt.get("number") or "",
            "at": _deps.iso(at or _deps.now_utc()),
            "amounts": overdue.get("amounts") if balance_available else None,
            "automatic": automatic,
        })
    except Exception as e:  # noqa: BLE001
        print(f"[power] afsluitbon versturen mislukt voor {cid}/{dev.get('id')}: {e}")


@router.delete("/power/devices/{dev_id}")
async def delete_device(dev_id: str, user: dict = Depends(_owner)):
    cid = _deps.company_id_of(user)
    await _own_device(cid, dev_id)
    await _deps.db.power_devices.delete_one({"id": dev_id, "company_id": cid})
    return {"ok": True}


@router.get("/power/devices/{dev_id}/status")
async def device_status(dev_id: str, connectivity_only: bool = False, user: dict = Depends(_admin)):
    cid = _deps.company_id_of(user)
    d = await _own_device(cid, dev_id)
    if str(d.get("tuya_device_id", "")).startswith("demo-"):
        return {"switch_code": "switch_1", "on": d.get("on"), "online": True}
    try:
        cfg = await _cfg(cid)
        details = await _tuya(cfg, "GET", f"/v1.0/devices/{d['tuya_device_id']}")
        online = details.get("online")
        if online is False:
            return {"switch_code": None, "on": None, "online": False}
        if connectivity_only:
            return {"on": d.get("on"), "online": online}
        st = await _read(cfg, d["tuya_device_id"])
        st["online"] = online
    except TuyaError as e:
        raise HTTPException(400, str(e))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"Tuya niet bereikbaar: {e}")
    if st.get("on") is not None:
        await _deps.db.power_devices.update_one({"id": dev_id}, {"$set": {"on": st["on"]}})
    return st


class SwitchIn(BaseModel):
    on: bool


@router.post("/power/devices/{dev_id}/switch")
async def device_switch(dev_id: str, body: SwitchIn, user: dict = Depends(_admin)):
    cid = _deps.company_id_of(user)
    d = await _own_device(cid, dev_id)
    overdue_by_tenant, balance_available = await _overdue_by_tenant(cid) if not body.on else ({}, False)
    try:
        await _switch(cid, d, body.on, user.get("name") or user.get("email") or "beheerder", "handmatig")
    except TuyaError as e:
        raise HTTPException(400, str(e))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"Tuya niet bereikbaar: {e}")
    if not body.on and d.get("on") is not False:
        await _send_cutoff_receipt(cid, d, overdue_by_tenant, balance_available)
    return {"ok": True, "on": body.on}


@router.post("/power/switch-all")
async def switch_all(body: SwitchIn, user: dict = Depends(_admin)):
    cid = _deps.company_id_of(user)
    by = user.get("name") or user.get("email") or "beheerder"
    devs = await _deps.db.power_devices.find({"company_id": cid}, {"_id": 0}).to_list(1000)
    overdue_by_tenant, balance_available = await _overdue_by_tenant(cid) if not body.on else ({}, False)
    done, failed = 0, []
    for d in devs:
        try:
            await _switch(cid, d, body.on, by, "handmatig (alles)")
            done += 1
            if not body.on and d.get("on") is not False:
                await _send_cutoff_receipt(cid, d, overdue_by_tenant, balance_available)
        except Exception as e:  # noqa: BLE001
            failed.append({"id": d["id"], "error": str(e)})
    return {"ok": not failed, "done": done, "failed": failed}


@router.get("/power/log")
async def power_log(user: dict = Depends(_admin)):
    cid = _deps.company_id_of(user)
    return await _deps.db.power_log.find({"company_id": cid}, {"_id": 0}).sort("at", -1).to_list(100)


# ---------------------------------------------------- automatische afsluiting
async def enforce_company(cid: str, overdue_fn) -> None:
    """Eén controleronde voor een bedrijf.

    overdue_fn(cid) -> lijst met {tenant_id, name, count, ...} (achterstallige facturen)."""
    cfg = await _cfg(cid)
    if not cfg.get("auto_cutoff") or not cfg.get("access_id"):
        return
    months = int(cfg.get("months") or DEFAULTS["months"])
    grace = int(cfg.get("grace_days") if cfg.get("grace_days") is not None else DEFAULTS["grace_days"])
    overdue = await overdue_fn(cid)
    late_by_tenant = {
        o["tenant_id"]: o for o in overdue
        if int(o.get("count") or 0) >= months
    }
    late = set(late_by_tenant)
    now = _deps.now_utc()
    async for dev in _deps.db.power_devices.find({"company_id": cid}, {"_id": 0}):
        tenant = await _deps.db.tenants.find_one(
            {"company_id": cid, "apartment_id": dev["apartment_id"], "status": {"$ne": "archived"}},
            {"_id": 0, "id": 1, "name": 1})
        is_late = bool(tenant and tenant["id"] in late) and not dev.get("exempt")
        try:
            if is_late:
                if dev.get("on") is False:
                    continue
                if not dev.get("notice_at"):
                    notice_at = _deps.iso(now)
                    await _deps.db.power_devices.update_one({"id": dev["id"]}, {"$set": {"notice_at": notice_at}})
                    dev["notice_at"] = notice_at
                    await _log(cid, dev, "aankondiging", "auto", f"{months} maanden achterstand")
                    await _deps.notify_company_admins(
                        cid, "Stroom wordt afgesloten",
                        f"{tenant['name']} heeft {months}+ maanden achterstand. Stroom gaat over {grace} dag(en) uit.",
                        {"kind": "power", "url": "/admin/power"})
                    await _deps.notify_tenant_power(
                        cid, tenant["id"],
                        f"Beste {tenant['name']}, u heeft {months} maanden of meer achterstand. "
                        f"Betaal binnen {grace} dag(en), anders wordt de stroom van uw appartement uitgezet.")
                    if grace > 0:
                        continue
                noticed = datetime.fromisoformat(dev["notice_at"].replace("Z", "+00:00"))
                if noticed.tzinfo is None:
                    noticed = noticed.replace(tzinfo=timezone.utc)
                if now - noticed >= timedelta(days=grace):
                    await _switch(cid, dev, False, "auto", f"{months} maanden achterstand")
                    await _send_cutoff_receipt(
                        cid, dev, late_by_tenant, True, automatic=True, tenant=tenant, at=now,
                    )
                    await _deps.notify_company_admins(
                        cid, "Stroom uitgezet", f"Stroom van {tenant['name']} is uitgezet wegens achterstand.",
                        {"kind": "power", "url": "/admin/power"})
                    await _deps.notify_tenant_power(
                        cid, tenant["id"],
                        "Uw stroom is uitgezet wegens achterstand. Na betaling gaat de stroom automatisch weer aan.")
            else:
                if dev.get("notice_at") and dev.get("on") is not False:
                    await _deps.db.power_devices.update_one({"id": dev["id"]}, {"$set": {"notice_at": None}})
                if dev.get("cut_by_auto") and dev.get("on") is False:
                    await _switch(cid, dev, True, "auto", "achterstand betaald")
                    if tenant:
                        await _deps.notify_tenant_power(cid, tenant["id"], "Bedankt voor uw betaling. Uw stroom is weer aangezet.")
        except Exception as e:  # noqa: BLE001
            print(f"[power] {cid}/{dev.get('id')}: {e}")


async def enforce_all(overdue_fn) -> None:
    async for c in _deps.db.companies.find({"power_config.auto_cutoff": True}, {"_id": 0, "id": 1}):
        await enforce_company(c["id"], overdue_fn)
