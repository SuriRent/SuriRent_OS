"""Mopé checkout for each company's own merchant account."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Literal, Optional
from urllib.parse import quote, urlparse
from uuid import uuid4

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from . import _deps
from settings_service import merge_section, reveal_section

router = APIRouter()
ADMIN_ROLES = ("admin", "owner", "superadmin")
MOPE_API = "https://api.mope.sr/api"


async def _admin(user: dict = Depends(_deps.get_current_user)) -> dict:
    cid = _deps.company_id_of(user)
    if user.get("role") not in ADMIN_ROLES or not cid:
        raise HTTPException(403, "Alleen de beheerder kan Mopé instellen")
    await _deps.require_plan_feature(cid, "allow_mope", "Mopé-betalingen")
    return user


async def _cfg_doc(cid: str) -> dict:
    return await _deps.db.company_settings.find_one(
        {"company_id": cid}, {"_id": 0, "mope": 1},
    ) or {}


async def _config(cid: str) -> dict:
    return reveal_section("mope", (await _cfg_doc(cid)).get("mope") or {})


def _active(config: dict) -> bool:
    return bool(config.get("enabled") and config.get("api_token"))


def _mask_token(token: str) -> str:
    if len(token) <= 8:
        return "••••"
    return f"{token[:4]}…{token[-4:]}"


def _amount_to_cents(amount: float) -> int:
    try:
        amount_value = Decimal(str(amount))
        if not amount_value.is_finite():
            raise InvalidOperation
        cents = (amount_value * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    except (InvalidOperation, ValueError, TypeError):
        raise HTTPException(status_code=400, detail="Ongeldig betaalbedrag")
    if cents <= 0:
        raise HTTPException(status_code=400, detail="Ongeldig betaalbedrag")
    if amount_value != cents / 100:
        raise HTTPException(status_code=400, detail="Betaalbedrag mag maximaal twee decimalen bevatten")
    return int(cents)


async def _request_api(method: str, path: str, token: str, payload: Optional[dict] = None) -> httpx.Response:
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=5.0)) as client:
            response = await client.request(
                method,
                f"{MOPE_API}/{path.lstrip('/')}",
                headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
                json=payload,
            )
    except httpx.TimeoutException:
        raise HTTPException(status_code=502, detail="Mopé reageert niet op tijd. Probeer het opnieuw.")
    except httpx.RequestError:
        raise HTTPException(status_code=502, detail="Mopé is momenteel niet bereikbaar.")
    return response


def _response_payload(response: httpx.Response) -> dict:
    try:
        payload = response.json()
    except ValueError:
        payload = {}
    if not isinstance(payload, dict):
        return {}
    return payload


def _provider_error(response: httpx.Response) -> HTTPException:
    payload = _response_payload(response)
    error = payload.get("error", payload)
    message = error.get("message") if isinstance(error, dict) else None
    if response.status_code in (401, 403):
        message = "Mopé heeft het token geweigerd. Controleer het token en de webshop-toegang."
    elif not message:
        message = "Mopé kon het verzoek niet verwerken."
    status_code = 502 if response.status_code >= 500 else 400
    return HTTPException(status_code=status_code, detail=f"Mopé: {str(message)[:180]}")


class MopeConfigIn(BaseModel):
    api_token: Optional[str] = Field(default=None, max_length=500)
    enabled: bool = False


class MopeRequestIn(BaseModel):
    amount: float = Field(gt=0)
    currency: Literal["SRD", "USD", "EUR"] = "SRD"
    tenant_id: Optional[str] = None


@router.get("/company/mope-config")
async def get_company_mope(user: dict = Depends(_admin)):
    config = await _config(_deps.company_id_of(user))
    token = config.get("api_token") or ""
    return {
        "enabled": _active(config),
        "token_set": bool(token),
        "token_masked": _mask_token(token) if token else "",
    }


@router.put("/company/mope-config")
async def put_company_mope(body: MopeConfigIn, user: dict = Depends(_admin)):
    cid = _deps.company_id_of(user)
    current = (await _cfg_doc(cid)).get("mope") or {}
    incoming = body.model_dump()
    incoming["api_token"] = (incoming.get("api_token") or "").strip()
    config = merge_section("mope", current, incoming)
    token = reveal_section("mope", config).get("api_token") or ""
    if body.enabled and not token:
        raise HTTPException(400, "Vul eerst het Mopé API-token in")
    await _deps.db.company_settings.update_one(
        {"company_id": cid},
        {"$set": {"company_id": cid, "mope": config}},
        upsert=True,
    )
    return {"ok": True, "enabled": _active(reveal_section("mope", config)), "token_set": bool(token)}


@router.post("/company/mope-config/test")
async def test_company_mope(user: dict = Depends(_admin)):
    config = await _config(_deps.company_id_of(user))
    token = config.get("api_token") or ""
    if not token:
        raise HTTPException(400, "Geen Mopé API-token ingesteld")
    response = await _request_api("GET", f"shop/payment_request/{uuid4()}", token)
    payload = _response_payload(response)
    error = payload.get("error", payload)
    if response.status_code == 404 and isinstance(error, dict) and error.get("code") == 1002:
        return {"ok": True, "message": "Mopé-token is geldig en de webshop-API is bereikbaar."}
    if response.is_success:
        return {"ok": True, "message": "Mopé API is bereikbaar."}
    raise _provider_error(response)


async def _create_request(
    company_id: str,
    tenant_id: str,
    amount: float,
    currency: str,
    source: str,
) -> dict:
    await _deps.require_plan_feature(company_id, "allow_mope", "Mopé-betalingen")
    config = await _config(company_id)
    if not _active(config):
        raise HTTPException(400, "Mopé-betalingen zijn niet ingeschakeld door de beheerder")
    tenant = await _deps.db.tenants.find_one(
        {"id": tenant_id, "company_id": company_id}, {"_id": 0, "name": 1},
    )
    if not tenant:
        raise HTTPException(404, "Huurder niet gevonden")
    amount_cents = _amount_to_cents(amount)
    local_id = _deps.new_id()
    redirect_url = _deps.public_url("/")
    if not redirect_url.startswith(("https://", "http://")):
        raise HTTPException(503, "De publieke app-URL is niet ingesteld voor Mopé-betalingen")
    payload = {
        "amount": amount_cents,
        "description": f"SuriRent huurbetaling - {tenant.get('name') or 'huurder'}"[:120],
        "order_id": local_id[:120],
        "currency": currency,
        "redirect_url": redirect_url,
    }
    response = await _request_api("POST", "shop/payment_request", config["api_token"], payload)
    if not response.is_success:
        raise _provider_error(response)
    result = _response_payload(response)
    payment_id = result.get("id")
    payment_url = result.get("url")
    try:
        parsed_url = urlparse(payment_url) if isinstance(payment_url, str) else None
        hostname = parsed_url.hostname if parsed_url else None
    except ValueError:
        hostname = None
    if (
        not isinstance(payment_id, str)
        or not payment_id
        or not isinstance(payment_url, str)
        or parsed_url.scheme != "https"
        or not (hostname == "mope.sr" or (hostname or "").endswith(".mope.sr"))
    ):
        raise HTTPException(502, "Mopé gaf geen geldige betaalverzoek-link terug")

    now = _deps.iso(_deps.now_utc())
    await _deps.db.kiosk_mope_payments.insert_one({
        "id": local_id,
        "payment_request_id": payment_id,
        "company_id": company_id,
        "tenant_id": tenant_id,
        "tenant_name": tenant.get("name"),
        "source": source,
        "amount": float(amount),
        "amount_cents": amount_cents,
        "currency": currency,
        "payment_url": payment_url,
        "status": "open",
        "booked_amount_cents": 0,
        "created_at": now,
        "updated_at": now,
    })
    return {"payment_id": payment_id, "url": payment_url, "amount_cents": amount_cents, "currency": currency}


async def _refresh(tx: dict) -> dict:
    if tx.get("status") in ("paid", "expired"):
        return tx
    config = await _config(tx["company_id"])
    if not config.get("api_token"):
        raise HTTPException(400, "Mopé-token ontbreekt voor deze betaling")
    response = await _request_api(
        "GET", f"shop/payment_request/{quote(tx['payment_request_id'], safe='')}", config["api_token"],
    )
    if not response.is_success:
        raise _provider_error(response)
    result = _response_payload(response)
    currency = result.get("currency") or {}
    currency_code = currency.get("code") if isinstance(currency, dict) else currency
    status = result.get("status")
    if (
        result.get("id") != tx["payment_request_id"]
        or result.get("amount") != tx["amount_cents"]
        or currency_code != tx["currency"]
        or status not in ("open", "scanned", "unconfirmed", "paid")
    ):
        raise HTTPException(502, "Mopé-betalingsstatus komt niet overeen met het betaalverzoek")
    expires_at = result.get("expires_at")
    if not isinstance(expires_at, str):
        created_at = datetime.fromisoformat(tx["created_at"].replace("Z", "+00:00"))
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
        expires_at = (created_at + timedelta(days=1)).isoformat()
    if not isinstance(expires_at, str):
        raise HTTPException(502, "Mopé gaf geen geldige vervaldatum terug")
    try:
        expiry = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
        if expiry.tzinfo is None:
            expiry = expiry.replace(tzinfo=timezone.utc)
    except ValueError:
        raise HTTPException(502, "Mopé gaf geen geldige vervaldatum terug")
    if status != "paid" and expiry <= datetime.now(timezone.utc):
        status = "expired"
    if status != tx.get("status") or tx.get("expires_at") != expires_at:
        await _deps.db.kiosk_mope_payments.update_one(
            {"payment_request_id": tx["payment_request_id"], "company_id": tx["company_id"]},
            {"$set": {"status": status, "expires_at": expires_at, "updated_at": _deps.iso(_deps.now_utc())}},
        )
        tx["status"] = status
        tx["expires_at"] = expires_at
    return tx


async def _get_payment(payment_id: str, *, company_id: str, tenant_id: Optional[str] = None) -> dict:
    query = {"payment_request_id": payment_id, "company_id": company_id}
    if tenant_id:
        query["tenant_id"] = tenant_id
    tx = await _deps.db.kiosk_mope_payments.find_one(query, {"_id": 0})
    if not tx:
        raise HTTPException(404, "Mopé-betaalverzoek niet gevonden")
    return await _refresh(tx)


async def consume_mope_payment(
    payment_id: str,
    *,
    company_id: str,
    tenant_id: str,
    amount: float,
    currency: str,
) -> dict:
    tx = await _get_payment(payment_id, company_id=company_id, tenant_id=tenant_id)
    if tx["status"] != "paid":
        raise HTTPException(400, "Mopé-betaling is nog niet voltooid")
    if currency != tx["currency"]:
        raise HTTPException(400, "Valuta komt niet overeen met de Mopé-betaling")
    amount_cents = _amount_to_cents(amount)
    if amount_cents > tx["amount_cents"]:
        raise HTTPException(400, "Bedrag is hoger dan de Mopé-betaling")
    updated = await _deps.db.kiosk_mope_payments.find_one_and_update(
        {
            "payment_request_id": payment_id,
            "company_id": company_id,
            "tenant_id": tenant_id,
            "status": "paid",
            "booked_amount_cents": {"$lte": tx["amount_cents"] - amount_cents},
        },
        {"$inc": {"booked_amount_cents": amount_cents}},
    )
    if not updated:
        raise HTTPException(409, "Het volledige Mopé-bedrag is al verwerkt")
    return tx


@router.get("/kiosk/mope/config")
async def kiosk_mope_config(session: dict = Depends(_deps.get_kiosk_session)):
    if not await _deps.company_has_plan_feature(session.get("company_id"), "allow_mope"):
        return {"enabled": False}
    config = await _config(session.get("company_id"))
    return {"enabled": _active(config)}


@router.post("/kiosk/mope/request")
async def kiosk_mope_request(body: MopeRequestIn, session: dict = Depends(_deps.get_kiosk_session)):
    if not body.tenant_id:
        raise HTTPException(400, "Huurder ontbreekt")
    return await _create_request(
        session["company_id"], body.tenant_id, body.amount, body.currency, "kiosk",
    )


@router.get("/kiosk/mope/status/{payment_id}")
async def kiosk_mope_status(payment_id: str, session: dict = Depends(_deps.get_kiosk_session)):
    tx = await _get_payment(payment_id, company_id=session["company_id"])
    return {"payment_id": payment_id, "status": tx["status"], "expires_at": tx.get("expires_at")}


@router.post("/tenant-portal/mope/request")
async def tenant_mope_request(body: MopeRequestIn, tenant: dict = Depends(_deps.get_tenant_session)):
    return await _create_request(
        tenant["company_id"], tenant["id"], body.amount, body.currency, "tenant_portal",
    )


@router.get("/tenant-portal/mope/status/{payment_id}")
async def tenant_mope_status(payment_id: str, tenant: dict = Depends(_deps.get_tenant_session)):
    tx = await _get_payment(
        payment_id, company_id=tenant["company_id"], tenant_id=tenant["id"],
    )
    return {"payment_id": payment_id, "status": tx["status"], "expires_at": tx.get("expires_at")}
