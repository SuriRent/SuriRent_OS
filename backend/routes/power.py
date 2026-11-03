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
    if user.get("role") not in ADMIN_ROLES or not _deps.company_id_of(user):
        raise HTTPException(403, "Alleen de beheerder kan stroom beheren")
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
    sw_code = "switch_1" if "switch_1" in d else ("switch" if "switch" in d else None)
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
    cfg = await _cfg(cid)
    st = await _read(cfg, dev["tuya_device_id"])
    code = st.get("switch_code") or "switch_1"
    await _tuya(cfg, "POST", f"/v1.0/devices/{dev['tuya_device_id']}/commands",
                {"commands": [{"code": code, "value": bool(on)}]})
    patch = {"on": bool(on), "updated_at": _deps.iso(_deps.now_utc())}
    if on:
        patch.update({"cut_by_auto": False, "notice_at": None, "cut_at": None})
    else:
        patch.update({"cut_at": _deps.iso(_deps.now_utc()), "cut_by_auto": by == "auto"})
    await _deps.db.power_devices.update_one({"id": dev["id"]}, {"$set": patch})
    await _log(cid, dev, "aan" if on else "uit", by, reason)
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
async def put_power_config(body: PowerConfigIn, user: dict = Depends(_admin)):
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
async def test_power_config(user: dict = Depends(_admin)):
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
async def save_device(body: DeviceIn, user: dict = Depends(_admin)):
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


@router.delete("/power/devices/{dev_id}")
async def delete_device(dev_id: str, user: dict = Depends(_admin)):
    cid = _deps.company_id_of(user)
    await _own_device(cid, dev_id)
    await _deps.db.power_devices.delete_one({"id": dev_id, "company_id": cid})
    return {"ok": True}


@router.get("/power/devices/{dev_id}/status")
async def device_status(dev_id: str, user: dict = Depends(_admin)):
    cid = _deps.company_id_of(user)
    d = await _own_device(cid, dev_id)
    try:
        st = await _read(await _cfg(cid), d["tuya_device_id"])
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
    try:
        await _switch(cid, d, body.on, user.get("name") or user.get("email") or "beheerder", "handmatig")
    except TuyaError as e:
        raise HTTPException(400, str(e))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"Tuya niet bereikbaar: {e}")
    return {"ok": True, "on": body.on}


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
    late = {o["tenant_id"] for o in await overdue_fn(cid) if int(o.get("count") or 0) >= months}
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
                    await _deps.db.power_devices.update_one({"id": dev["id"]}, {"$set": {"notice_at": _deps.iso(now)}})
                    await _log(cid, dev, "aankondiging", "auto", f"{months} maanden achterstand")
                    await _deps.notify_company_admins(
                        cid, "Stroom wordt afgesloten",
                        f"{tenant['name']} heeft {months}+ maanden achterstand. Stroom gaat over {grace} dag(en) uit.",
                        {"kind": "power", "url": "/admin/instellingen#stroom"})
                    await _deps.notify_tenant_power(
                        cid, tenant["id"],
                        f"Beste {tenant['name']}, u heeft {months} maanden of meer achterstand. "
                        f"Betaal binnen {grace} dag(en), anders wordt de stroom van uw appartement uitgezet.")
                    continue
                noticed = datetime.fromisoformat(dev["notice_at"].replace("Z", "+00:00"))
                if noticed.tzinfo is None:
                    noticed = noticed.replace(tzinfo=timezone.utc)
                if now - noticed >= timedelta(days=grace):
                    await _switch(cid, dev, False, "auto", f"{months} maanden achterstand")
                    await _deps.notify_company_admins(
                        cid, "Stroom uitgezet", f"Stroom van {tenant['name']} is uitgezet wegens achterstand.",
                        {"kind": "power", "url": "/admin/instellingen#stroom"})
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
