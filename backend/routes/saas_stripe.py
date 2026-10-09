"""
SaaS Stripe betalingen — custom PaymentIntent flow (NIET Stripe Hosted).
Klant (Mijn Abonnement) of superadmin start een betaling per abonnement-
factuur via Creditcard of iDEAL. Afrekening in EUR (SRD→EUR conversie).
Stripe-sleutels (test/live) worden beheerd in SaaS Instellingen.
"""
from __future__ import annotations

import os
import json
from typing import Literal, Optional

import stripe
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from . import _deps

router = APIRouter()

SAAS_SETTINGS_ID = "_saas_settings"
CLOSED_STATUSES = ["paid", "superseded", "cancelled", "void"]
FALLBACK_EUR_PER_SRD = 0.025


# ─── Config (DB eerst, test-mode valt terug op env) ──────────────────────────

async def _stripe_doc() -> dict:
    doc = await _deps.db.saas_settings.find_one({"id": SAAS_SETTINGS_ID}, {"_id": 0, "stripe": 1}) or {}
    return doc.get("stripe") or {}


def _keys_for(doc: dict, mode: str) -> dict:
    k = doc.get(mode) or {}
    if mode == "test":
        return {
            "publishable_key": k.get("publishable_key") or os.environ.get("STRIPE_PUBLISHABLE_KEY", ""),
            "secret_key": k.get("secret_key") or os.environ.get("STRIPE_SECRET_KEY", ""),
            "webhook_secret": k.get("webhook_secret") or os.environ.get("STRIPE_WEBHOOK_SECRET", ""),
        }
    return {
        "publishable_key": k.get("publishable_key", ""),
        "secret_key": k.get("secret_key", ""),
        "webhook_secret": k.get("webhook_secret", ""),
    }


async def _active_cfg() -> dict:
    doc = await _stripe_doc()
    mode = doc.get("mode") or "test"
    keys = _keys_for(doc, mode)
    return {"mode": mode, **keys, "enabled": bool(keys["secret_key"] and keys["publishable_key"])}


def _mask(v: str) -> str:
    return f"{v[:8]}…{v[-4:]}" if v and len(v) > 14 else ("••••" if v else "")


class StripeKeysIn(BaseModel):
    publishable_key: Optional[str] = None
    secret_key: Optional[str] = None
    webhook_secret: Optional[str] = None


class StripeConfigIn(BaseModel):
    mode: Literal["test", "live"]
    test: Optional[StripeKeysIn] = None
    live: Optional[StripeKeysIn] = None


@router.get("/superadmin/stripe-config")
async def get_stripe_config(user: dict = Depends(_deps.require_role("superadmin"))):
    doc = await _stripe_doc()
    out = {"mode": doc.get("mode") or "test"}
    for m in ("test", "live"):
        k = _keys_for(doc, m)
        out[m] = {
            "publishable_key": k["publishable_key"],
            "secret_key_masked": _mask(k["secret_key"]),
            "secret_key_set": bool(k["secret_key"]),
            "webhook_secret_set": bool(k["webhook_secret"]),
        }
    return out


@router.put("/superadmin/stripe-config")
async def put_stripe_config(body: StripeConfigIn, user: dict = Depends(_deps.require_role("superadmin"))):
    doc = await _stripe_doc()
    new = {"mode": body.mode}
    prefixes = {"publishable_key": "pk_", "secret_key": ("sk_", "rk_"), "webhook_secret": "whsec_"}
    for m in ("test", "live"):
        cur = dict(doc.get(m) or {})
        inc = getattr(body, m)
        if inc:
            for field, val in inc.model_dump().items():
                val = (val or "").strip()
                if not val:
                    continue  # leeg = huidige waarde behouden
                if not val.startswith(prefixes[field]):
                    raise HTTPException(400, f"Ongeldige {field.replace('_', ' ')} voor {m}-modus")
                if field != "webhook_secret" and f"_{m}_" not in val:
                    raise HTTPException(400, f"Deze {field.replace('_', ' ')} hoort niet bij {m}-modus")
                cur[field] = val
        new[m] = cur
    if body.mode == "live":
        lk = _keys_for(new, "live")
        if not (lk["secret_key"] and lk["publishable_key"]):
            raise HTTPException(400, "Vul eerst de live Publishable key en Secret key in")
    await _deps.db.saas_settings.update_one(
        {"id": SAAS_SETTINGS_ID},
        {"$set": {"id": SAAS_SETTINGS_ID, "stripe": new, "updated_at": _deps.iso(_deps.now_utc()),
                  "updated_by": user.get("email")}},
        upsert=True,
    )
    return {"ok": True}


@router.post("/superadmin/stripe-config/test")
async def test_stripe_config(user: dict = Depends(_deps.require_role("superadmin"))):
    cfg = await _active_cfg()
    if not cfg["secret_key"]:
        raise HTTPException(400, "Geen Secret key ingesteld")
    try:
        acct = stripe.Account.retrieve(api_key=cfg["secret_key"])
    except stripe.error.StripeError as e:
        raise HTTPException(400, f"Stripe verbinding mislukt: {e.user_message or str(e)[:120]}")
    a = acct.to_dict()
    return {"ok": True, "mode": cfg["mode"], "account_id": a.get("id"),
            "name": ((a.get("settings") or {}).get("dashboard") or {}).get("display_name") or a.get("email") or a.get("id")}


@router.get("/saas-stripe/public-config")
async def public_config(user: dict = Depends(_deps.get_current_user)):
    cfg = await _active_cfg()
    return {"enabled": cfg["enabled"], "mode": cfg["mode"], "methods": ["card", "ideal"]}


# ─── PaymentIntent ───────────────────────────────────────────────────────────

async def _to_eur_cents(amount: float, currency: str) -> tuple[int, float]:
    cur = (currency or "SRD").upper()
    rate = 1.0
    if cur == "SRD":
        try:
            rate = float((await _deps.get_eur_per_srd()).get("rate") or 0) or FALLBACK_EUR_PER_SRD
        except Exception:  # noqa: BLE001
            rate = FALLBACK_EUR_PER_SRD
    elif cur == "USD":
        rate = 0.92
    return max(50, round(amount * rate * 100)), rate


async def _resolve_invoice(invoice_id: Optional[str], user: dict) -> dict:
    is_super = user.get("role") == "superadmin"
    cid = _deps.company_id_of(user)
    if invoice_id:
        q = {"id": invoice_id} if is_super else {"id": invoice_id, "company_id": cid}
        inv = await _deps.db.subscription_invoices.find_one(q, {"_id": 0})
        if not inv:
            raise HTTPException(404, "Factuur niet gevonden")
        return inv
    if not cid:
        raise HTTPException(400, "Geen actief bedrijf")
    inv = await _deps.db.subscription_invoices.find_one(
        {"company_id": cid, "status": {"$nin": CLOSED_STATUSES}}, {"_id": 0}, sort=[("period_start", 1), ("created_at", 1)],
    )
    if inv:
        return inv
    c = await _deps.db.companies.find_one({"id": cid}, {"_id": 0})
    if not c:
        raise HTTPException(404, "Bedrijf niet gevonden")
    return await _deps.ensure_open_invoice(c, user.get("email", ""))


class CreateIntentIn(BaseModel):
    invoice_id: Optional[str] = None
    method: Literal["card", "ideal"] = "card"


@router.post("/saas-stripe/create-intent")
async def create_intent(body: CreateIntentIn, user: dict = Depends(_deps.get_current_user)):
    """Superadmin: elke factuur. Klant-admin: eigen factuur, of zonder
    invoice_id de oudste openstaande factuur."""
    inv = await _resolve_invoice(body.invoice_id, user)
    if inv.get("status") in CLOSED_STATUSES:
        raise HTTPException(400, "Deze factuur is al betaald of vervallen")
    cfg = await _active_cfg()
    if not cfg["enabled"]:
        raise HTTPException(400, "Online betalen is nog niet geactiveerd")

    original = float(inv.get("amount") or 0)
    cents, rate = await _to_eur_cents(original, inv.get("currency") or "SRD")
    try:
        intent = stripe.PaymentIntent.create(
            api_key=cfg["secret_key"],
            amount=cents,
            currency="eur",
            payment_method_types=[body.method],
            metadata={
                "invoice_id": inv["id"],
                "company_id": inv.get("company_id") or "",
                "original_amount": str(original),
                "original_currency": inv.get("currency") or "SRD",
                "source": "surirent_saas",
            },
            description=f"SuriRent abonnement {inv.get('invoice_number') or inv['id'][:8].upper()}",
        )
    except stripe.error.StripeError as e:
        msg = e.user_message or str(e)
        if body.method == "ideal" and "ideal" in msg.lower():
            msg = "iDEAL is niet geactiveerd in uw Stripe-account (Dashboard → Settings → Payment methods)."
        raise HTTPException(400, f"Stripe: {msg[:200]}")

    now = _deps.iso(_deps.now_utc())
    await _deps.db.saas_stripe_transactions.insert_one({
        "id": _deps.new_id(),
        "invoice_id": inv["id"],
        "company_id": inv.get("company_id"),
        "payment_intent_id": intent.id,
        "method": body.method,
        "mode": cfg["mode"],
        "amount_eur_cents": cents,
        "eur_rate": rate,
        "original_amount": original,
        "original_currency": inv.get("currency") or "SRD",
        "status": "pending",
        "created_by": user.get("email"),
        "created_at": now,
        "updated_at": now,
    })
    return {
        "client_secret": intent.client_secret,
        "payment_intent_id": intent.id,
        "amount_eur_cents": cents,
        "method": body.method,
        "mode": cfg["mode"],
        "publishable_key": cfg["publishable_key"],
        "invoice": {
            "id": inv["id"],
            "invoice_number": inv.get("invoice_number"),
            "amount": inv.get("amount"),
            "currency": inv.get("currency"),
            "plan": inv.get("plan"),
        },
    }


@router.get("/saas-stripe/intent-status/{intent_id}")
async def intent_status(intent_id: str):
    """Public polling-endpoint voor de checkout-UI (ook na iDEAL-redirect)."""
    tx = await _deps.db.saas_stripe_transactions.find_one({"payment_intent_id": intent_id}, {"_id": 0})
    if not tx:
        raise HTTPException(404, "Not found")
    if tx.get("status") not in ("paid", "refunded"):
        try:
            doc = await _stripe_doc()
            sk = _keys_for(doc, tx.get("mode") or "test")["secret_key"]
            pi = stripe.PaymentIntent.retrieve(intent_id, api_key=sk)
            if pi.status == "succeeded":
                await _mark_paid(intent_id)
                tx["status"] = "paid"
            elif pi.status == "requires_payment_method" and pi.last_payment_error:
                tx["status"] = "failed"
            elif pi.status == "canceled":
                tx["status"] = "canceled"
        except stripe.error.StripeError:
            pass
    return {"payment_intent_id": intent_id, "status": tx["status"], "invoice_id": tx["invoice_id"],
            "method": tx.get("method"), "amount_eur_cents": tx.get("amount_eur_cents")}


async def _mark_paid(intent_id: str) -> None:
    """Idempotent: transactie + factuur → paid, betaling boeken, bedrijf activeren."""
    now = _deps.iso(_deps.now_utc())
    res = await _deps.db.saas_stripe_transactions.update_one(
        {"payment_intent_id": intent_id, "status": {"$ne": "paid"}},
        {"$set": {"status": "paid", "paid_at": now, "updated_at": now}},
    )
    if res.modified_count == 0:
        return
    tx = await _deps.db.saas_stripe_transactions.find_one({"payment_intent_id": intent_id}, {"_id": 0})
    inv = await _deps.db.subscription_invoices.find_one({"id": tx["invoice_id"]}, {"_id": 0}) or {}
    method_label = "ideal" if tx.get("method") == "ideal" else "creditcard"
    await _deps.db.subscription_invoices.update_one(
        {"id": tx["invoice_id"], "status": {"$ne": "paid"}},
        {"$set": {"status": "paid", "paid_at": now, "payment_method": method_label,
                  "stripe_payment_intent_id": intent_id}},
    )
    company = await _deps.db.companies.find_one({"id": tx.get("company_id")}, {"_id": 0}) or {}
    await _deps.db.subscription_payments.insert_one({
        "id": _deps.new_id(),
        "company_id": tx.get("company_id"),
        "company_name": company.get("name", ""),
        "invoice_id": tx["invoice_id"],
        "amount": tx["original_amount"],
        "currency": tx["original_currency"],
        "amount_eur_cents": tx["amount_eur_cents"],
        "method": method_label,
        "reference": f"stripe:{intent_id}",
        "note": "Online betaald via Stripe",
        "paid_at": now,
        "created_at": now,
        "created_by": "stripe",
        "stripe_payment_intent_id": intent_id,
    })
    if tx.get("company_id"):
        await _deps.activate_company_after_payment(tx["company_id"], plan_in_payment=inv.get("plan"))
        if company:
            await _deps.send_saas_payment_email(company, tx["original_amount"], tx["original_currency"],
                                                method_label, tx["invoice_id"])


@router.post("/saas-stripe/webhook")
async def stripe_webhook(request: Request):
    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")
    doc = await _stripe_doc()
    secrets = [s for s in {_keys_for(doc, "live")["webhook_secret"], _keys_for(doc, "test")["webhook_secret"]} if s]
    verified = False
    for s in secrets:
        try:
            stripe.WebhookSignature.verify_header(payload.decode("utf-8"), sig, s)
            verified = True
            break
        except (ValueError, stripe.error.SignatureVerificationError):
            continue
    if not verified:
        raise HTTPException(400, "Invalid signature")
    event = json.loads(payload)
    t, obj = event.get("type"), (event.get("data") or {}).get("object") or {}
    now = _deps.iso(_deps.now_utc())
    if t == "payment_intent.succeeded":
        await _mark_paid(obj["id"])
    elif t == "payment_intent.payment_failed":
        await _deps.db.saas_stripe_transactions.update_one(
            {"payment_intent_id": obj.get("id")},
            {"$set": {"status": "failed", "last_error": (obj.get("last_payment_error") or {}).get("message"),
                      "updated_at": now}},
        )
    elif t == "payment_intent.canceled":
        await _deps.db.saas_stripe_transactions.update_one(
            {"payment_intent_id": obj.get("id")}, {"$set": {"status": "canceled", "updated_at": now}},
        )
    elif t == "charge.refunded" and obj.get("payment_intent"):
        await _deps.db.saas_stripe_transactions.update_one(
            {"payment_intent_id": obj["payment_intent"]}, {"$set": {"status": "refunded", "updated_at": now}},
        )
    return {"ok": True}


@router.get("/superadmin/client-payment-status")
async def client_payment_status(user: dict = Depends(_deps.require_role("superadmin"))):
    """Overzichtspagina: per klant het laatste abonnement + betaalstatus."""
    companies = await _deps.db.companies.find({}, {"_id": 0}).to_list(1000)
    rows = []
    for c in companies:
        cid = c.get("id")
        last_inv = await _deps.db.subscription_invoices.find_one(
            {"company_id": cid}, {"_id": 0}, sort=[("created_at", -1)]
        )
        last_pmt = await _deps.db.subscription_payments.find_one(
            {"company_id": cid}, {"_id": 0}, sort=[("paid_at", -1)]
        )
        summary = await _deps.billing_summary(c)
        rows.append({
            "company_id": cid,
            "name": c.get("name"),
            "slug": c.get("slug"),
            "plan": c.get("plan"),
            "billing_status": summary.get("billing_status"),
            "monthly_amount": summary.get("monthly_amount"),
            "currency": summary.get("currency") or "SRD",
            "last_invoice": last_inv and {
                "id": last_inv.get("id"),
                "number": last_inv.get("invoice_number"),
                "amount": last_inv.get("amount"),
                "status": last_inv.get("status"),
                "created_at": last_inv.get("created_at"),
            },
            "last_payment": last_pmt and {
                "method": last_pmt.get("method"),
                "amount": last_pmt.get("amount"),
                "paid_at": last_pmt.get("paid_at"),
            },
        })
    rows.sort(key=lambda r: r.get("name") or "")
    return rows
