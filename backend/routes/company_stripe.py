"""
Bedrijfs-Stripe (Beheerder) — eigen Stripe-account per bedrijf zodat huurders
in de Kiosk met Creditcard of iDEAL kunnen betalen (QR op telefoon of direct
op het kiosk-scherm). Bedragen in SRD/USD worden naar EUR omgerekend.
"""
from __future__ import annotations

import secrets
from typing import Literal, Optional

import stripe
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from . import _deps
from .saas_stripe import _mask, _to_eur_cents

router = APIRouter()
ADMIN_ROLES = ("admin", "owner", "superadmin")


async def _admin(user: dict = Depends(_deps.get_current_user)) -> dict:
    if user.get("role") not in ADMIN_ROLES or not _deps.company_id_of(user):
        raise HTTPException(403, "Alleen de beheerder kan Stripe instellen")
    return user


async def _cfg_doc(cid: str) -> dict:
    c = await _deps.db.companies.find_one({"id": cid}, {"_id": 0, "stripe_config": 1, "name": 1, "logo_url": 1}) or {}
    return c


def _active(sc: dict) -> dict:
    mode = sc.get("mode") or "test"
    k = sc.get(mode) or {}
    methods = [m for m in ("card", "ideal") if (sc.get("methods") or {}).get(m)]
    enabled = bool(k.get("secret_key") and k.get("publishable_key") and methods)
    return {"mode": mode, "publishable_key": k.get("publishable_key", ""), "secret_key": k.get("secret_key", ""),
            "methods": methods, "enabled": enabled}


class KeysIn(BaseModel):
    publishable_key: Optional[str] = None
    secret_key: Optional[str] = None


class CompanyStripeIn(BaseModel):
    mode: Literal["test", "live"]
    test: Optional[KeysIn] = None
    live: Optional[KeysIn] = None
    card: bool = True
    ideal: bool = True


@router.get("/company/stripe-config")
async def get_company_stripe(user: dict = Depends(_admin)):
    sc = (await _cfg_doc(_deps.company_id_of(user))).get("stripe_config") or {}
    out = {"mode": sc.get("mode") or "test", "card": (sc.get("methods") or {}).get("card", True),
           "ideal": (sc.get("methods") or {}).get("ideal", True), "enabled": _active(sc)["enabled"]}
    for m in ("test", "live"):
        k = sc.get(m) or {}
        out[m] = {"publishable_key": k.get("publishable_key", ""), "secret_key_set": bool(k.get("secret_key")),
                  "secret_key_masked": _mask(k.get("secret_key", ""))}
    return out


@router.put("/company/stripe-config")
async def put_company_stripe(body: CompanyStripeIn, user: dict = Depends(_admin)):
    cid = _deps.company_id_of(user)
    sc = (await _cfg_doc(cid)).get("stripe_config") or {}
    new = {"mode": body.mode, "methods": {"card": body.card, "ideal": body.ideal}}
    for m in ("test", "live"):
        cur = dict(sc.get(m) or {})
        inc = getattr(body, m)
        for field, val in (inc.model_dump().items() if inc else []):
            val = (val or "").strip()
            if not val:
                continue
            prefix = "pk_" if field == "publishable_key" else ("sk_", "rk_")
            if not val.startswith(prefix) or f"_{m}_" not in val:
                raise HTTPException(400, f"Ongeldige {field.replace('_', ' ')} voor {m}-modus")
            cur[field] = val
        new[m] = cur
    k = new[body.mode]
    if body.mode == "live" and not (k.get("publishable_key") and k.get("secret_key")):
        raise HTTPException(400, "Vul eerst de live Publishable key en Secret key in")
    await _deps.db.companies.update_one({"id": cid}, {"$set": {"stripe_config": new}})
    return {"ok": True, "enabled": _active(new)["enabled"]}


@router.post("/company/stripe-config/test")
async def test_company_stripe(user: dict = Depends(_admin)):
    a = _active((await _cfg_doc(_deps.company_id_of(user))).get("stripe_config") or {})
    if not a["secret_key"]:
        raise HTTPException(400, "Geen Secret key ingesteld")
    try:
        acct = stripe.Account.retrieve(api_key=a["secret_key"]).to_dict()
    except stripe.error.StripeError as e:
        raise HTTPException(400, f"Stripe verbinding mislukt: {(e.user_message or str(e))[:120]}")
    name = ((acct.get("settings") or {}).get("dashboard") or {}).get("display_name") or acct.get("email") or acct.get("id")
    return {"ok": True, "mode": a["mode"], "name": name}


# ─── Kiosk ──────────────────────────────────────────────────────────────────

@router.get("/kiosk/stripe/config")
async def kiosk_stripe_config(session: dict = Depends(_deps.get_kiosk_session)):
    a = _active((await _cfg_doc(session.get("company_id"))).get("stripe_config") or {})
    return {"enabled": a["enabled"], "methods": a["methods"], "mode": a["mode"]}


class KioskIntentIn(BaseModel):
    tenant_id: str
    amount: float
    currency: Literal["SRD", "USD", "EUR"] = "SRD"
    method: Literal["card", "ideal"]
    origin: Optional[str] = None


@router.post("/kiosk/stripe/intent")
async def kiosk_stripe_intent(body: KioskIntentIn, session: dict = Depends(_deps.get_kiosk_session)):
    cid = session.get("company_id")
    a = _active((await _cfg_doc(cid)).get("stripe_config") or {})
    if not a["enabled"] or body.method not in a["methods"]:
        raise HTTPException(400, "Deze betaalmethode is niet ingeschakeld")
    if body.amount <= 0:
        raise HTTPException(400, "Ongeldig bedrag")
    tenant = await _deps.db.tenants.find_one({"id": body.tenant_id, "company_id": cid}, {"_id": 0, "name": 1}) or {}
    cents, rate = await _to_eur_cents(body.amount, body.currency)
    token = secrets.token_urlsafe(16)
    extra = {}
    if body.method == "ideal" and body.origin:
        extra = {"confirm": True, "payment_method_data": {"type": "ideal"},
                 "return_url": f"{body.origin.rstrip('/')}/betalen/{token}"}
    try:
        pi = stripe.PaymentIntent.create(
            api_key=a["secret_key"], amount=cents, currency="eur", payment_method_types=[body.method],
            metadata={"company_id": cid, "tenant_id": body.tenant_id, "source": "surirent_kiosk",
                      "original": f"{body.currency} {body.amount}"},
            description=f"Huur {tenant.get('name') or ''}".strip(), **extra,
        )
    except stripe.error.StripeError as e:
        msg = e.user_message or str(e)
        if body.method == "ideal" and "ideal" in msg.lower():
            msg = "iDEAL is niet geactiveerd in uw Stripe-account."
        raise HTTPException(400, f"Stripe: {msg[:200]}")
    na = getattr(pi, "next_action", None)
    rtu = getattr(na, "redirect_to_url", None) if na else None
    redirect_url = getattr(rtu, "url", None) if rtu else None
    now = _deps.iso(_deps.now_utc())
    await _deps.db.kiosk_stripe_payments.insert_one({
        "id": _deps.new_id(), "token": token, "company_id": cid, "tenant_id": body.tenant_id,
        "tenant_name": tenant.get("name"), "payment_intent_id": pi.id, "client_secret": pi.client_secret,
        "mode": a["mode"], "method": body.method, "amount": body.amount, "currency": body.currency,
        "amount_eur_cents": cents, "eur_rate": rate, "status": "pending", "consumed": False,
        "created_at": now, "updated_at": now,
    })
    return {"token": token, "payment_intent_id": pi.id, "client_secret": pi.client_secret,
            "publishable_key": a["publishable_key"], "amount_eur_cents": cents, "method": body.method, "mode": a["mode"], "redirect_url": redirect_url}


async def _refresh(tx: dict) -> dict:
    if tx.get("status") in ("paid", "canceled"):
        return tx
    c = await _cfg_doc(tx["company_id"])
    sk = ((c.get("stripe_config") or {}).get(tx.get("mode") or "test") or {}).get("secret_key")
    try:
        pi = stripe.PaymentIntent.retrieve(tx["payment_intent_id"], api_key=sk)
    except stripe.error.StripeError:
        return tx
    status = {"succeeded": "paid", "canceled": "canceled"}.get(pi.status)
    if not status and pi.status == "requires_payment_method" and pi.last_payment_error:
        status = "failed"
    if status and status != tx.get("status"):
        await _deps.db.kiosk_stripe_payments.update_one(
            {"payment_intent_id": tx["payment_intent_id"]},
            {"$set": {"status": status, "updated_at": _deps.iso(_deps.now_utc())}})
        tx["status"] = status
    return tx


@router.get("/kiosk/stripe/status/{pi_id}")
async def kiosk_stripe_status(pi_id: str, session: dict = Depends(_deps.get_kiosk_session)):
    tx = await _deps.db.kiosk_stripe_payments.find_one(
        {"payment_intent_id": pi_id, "company_id": session.get("company_id")}, {"_id": 0})
    if not tx:
        raise HTTPException(404, "Niet gevonden")
    tx = await _refresh(tx)
    return {"status": tx["status"], "payment_intent_id": pi_id}


@router.get("/public/kiosk-pay/{token}")
async def public_kiosk_pay(token: str):
    tx = await _deps.db.kiosk_stripe_payments.find_one({"token": token}, {"_id": 0})
    if not tx:
        raise HTTPException(404, "Betaallink niet gevonden of verlopen")
    tx = await _refresh(tx)
    c = await _cfg_doc(tx["company_id"])
    pk = ((c.get("stripe_config") or {}).get(tx.get("mode") or "test") or {}).get("publishable_key")
    return {"status": tx["status"], "company_name": c.get("name"), "logo_url": c.get("logo_url"),
            "tenant_name": tx.get("tenant_name"), "amount": tx["amount"], "currency": tx["currency"],
            "amount_eur_cents": tx["amount_eur_cents"], "method": tx["method"], "mode": tx.get("mode"),
            "payment_intent_id": tx["payment_intent_id"],
            "client_secret": tx["client_secret"] if tx["status"] == "pending" else None, "publishable_key": pk}


async def consume_kiosk_stripe_payment(cid: str, pi_id: str) -> dict:
    """Bij boeken van de kiosk-betaling: verifieer dat de Stripe-betaling geslaagd
    is en nog niet eerder is geboekt (idempotent)."""
    tx = await _deps.db.kiosk_stripe_payments.find_one({"payment_intent_id": pi_id, "company_id": cid}, {"_id": 0})
    if not tx:
        raise HTTPException(404, "Stripe-betaling niet gevonden")
    tx = await _refresh(tx)
    if tx["status"] != "paid":
        raise HTTPException(400, "Stripe-betaling is nog niet voltooid")
    res = await _deps.db.kiosk_stripe_payments.find_one_and_update(
        {"payment_intent_id": pi_id, "consumed": False}, {"$set": {"consumed": True}})
    if not res:
        raise HTTPException(409, "Deze Stripe-betaling is al geboekt")
    return tx
