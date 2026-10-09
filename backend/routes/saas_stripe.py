"""
SaaS Stripe betalingen — custom PaymentIntent flow (NIET Stripe Hosted).
Eenmalige betaling per abonnement-factuur, EUR-afrekening, SRD→EUR conversie
op het moment van checkout. Zie README-fragment in de PRD.
"""
from __future__ import annotations

import os
import json
from datetime import datetime, timezone
from typing import Optional

import stripe
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from . import _deps  # noqa: WPS300 — package relative

# ─── Stripe config ───────────────────────────────────────────────────────────
stripe.api_key = os.environ.get("STRIPE_SECRET_KEY") or "sk_test_emergent"
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")

# SRD → EUR conversie — fallback-koers (admin kan dit later overriden via
# een settings-doc in Mongo zodra er een echte FX-feed is).
SRD_TO_EUR_RATE = float(os.environ.get("SRD_EUR_RATE") or 0.025)  # 1 SRD ≈ €0,025


router = APIRouter()


class CreateIntentIn(BaseModel):
    invoice_id: str


def _ensure_eur_amount(amount: float, currency: str) -> tuple[int, str]:
    """Zet SRD/USD → EUR integer-cents voor Stripe."""
    cur = (currency or "SRD").upper()
    if cur == "EUR":
        eur = amount
    elif cur == "SRD":
        eur = amount * SRD_TO_EUR_RATE
    elif cur == "USD":
        eur = amount * 0.92  # ruwe USD→EUR fallback
    else:
        eur = amount
    cents = max(50, round(eur * 100))  # Stripe minimum ~€0,50
    return cents, "eur"


@router.post("/saas-stripe/create-intent")
async def create_intent(body: CreateIntentIn, user: dict = Depends(_deps.require_role("superadmin"))):
    """Superadmin triggert een PaymentIntent voor een specifieke factuur.
    Voor een klant-UI zou je dit achter huurder-auth zetten; hier gaan we
    uit van superadmin-gestuurde flow + een shareable payment-link."""
    inv = await _deps.db.subscription_invoices.find_one({"id": body.invoice_id}, {"_id": 0})
    if not inv:
        raise HTTPException(404, "Factuur niet gevonden")
    if inv.get("status") == "paid":
        raise HTTPException(400, "Factuur is al betaald")

    cents, cur = _ensure_eur_amount(float(inv.get("amount") or 0), inv.get("currency") or "SRD")

    intent = stripe.PaymentIntent.create(
        amount=cents,
        currency=cur,
        automatic_payment_methods={"enabled": True, "allow_redirects": "never"},
        metadata={
            "invoice_id": body.invoice_id,
            "company_id": inv.get("company_id") or "",
            "original_amount": str(inv.get("amount") or 0),
            "original_currency": inv.get("currency") or "SRD",
        },
        description=f"SuriRent SaaS factuur {inv.get('invoice_number') or body.invoice_id}",
    )

    # Transactie-record vóór redirect (idempotent dankzij invoice_id guard)
    now = _deps.iso(_deps.now_utc())
    await _deps.db.saas_stripe_transactions.update_one(
        {"invoice_id": body.invoice_id, "payment_intent_id": intent.id},
        {
            "$set": {
                "invoice_id": body.invoice_id,
                "company_id": inv.get("company_id"),
                "payment_intent_id": intent.id,
                "client_secret": intent.client_secret,
                "amount_eur_cents": cents,
                "original_amount": float(inv.get("amount") or 0),
                "original_currency": inv.get("currency") or "SRD",
                "status": "pending",
                "updated_at": now,
            },
            "$setOnInsert": {"created_at": now},
        },
        upsert=True,
    )
    return {
        "client_secret": intent.client_secret,
        "payment_intent_id": intent.id,
        "amount_eur_cents": cents,
        "publishable_key": os.environ.get("STRIPE_PUBLISHABLE_KEY", ""),
        "invoice": {
            "id": inv["id"],
            "invoice_number": inv.get("invoice_number"),
            "amount": inv.get("amount"),
            "currency": inv.get("currency"),
        },
    }


@router.get("/saas-stripe/intent-status/{intent_id}")
async def intent_status(intent_id: str):
    """Public polling-endpoint (unauth) voor de checkout-UI."""
    tx = await _deps.db.saas_stripe_transactions.find_one(
        {"payment_intent_id": intent_id}, {"_id": 0, "status": 1, "invoice_id": 1}
    )
    if not tx:
        raise HTTPException(404, "Not found")
    # Fallback: Stripe direct bevragen als webhook te laat is
    if tx.get("status") != "paid":
        try:
            pi = stripe.PaymentIntent.retrieve(intent_id)
            if pi.status == "succeeded":
                await _mark_paid(intent_id, pi.to_dict())
                tx["status"] = "paid"
        except stripe.error.StripeError:
            pass
    return {"payment_intent_id": intent_id, "status": tx["status"], "invoice_id": tx["invoice_id"]}


async def _mark_paid(intent_id: str, pi_obj: dict) -> None:
    """Idempotent: zet transactie + factuur op paid en activeer de company."""
    now = _deps.iso(_deps.now_utc())
    res = await _deps.db.saas_stripe_transactions.update_one(
        {"payment_intent_id": intent_id, "status": {"$ne": "paid"}},
        {"$set": {"status": "paid", "paid_at": now, "updated_at": now}},
    )
    if res.modified_count == 0:
        return  # al eerder verwerkt
    tx = await _deps.db.saas_stripe_transactions.find_one({"payment_intent_id": intent_id}, {"_id": 0})
    if not tx:
        return
    # Markeer de SaaS-factuur als paid
    await _deps.db.subscription_invoices.update_one(
        {"id": tx["invoice_id"], "status": {"$ne": "paid"}},
        {"$set": {"status": "paid", "paid_at": now, "payment_method": "stripe", "stripe_payment_intent_id": intent_id}},
    )
    # Boek een subscription_payment zodat de "Totaal ontvangen" KPI klopt
    await _deps.db.subscription_payments.insert_one({
        "id": _deps.new_id(),
        "company_id": tx.get("company_id"),
        "invoice_id": tx["invoice_id"],
        "amount": tx["original_amount"],
        "currency": tx["original_currency"],
        "amount_eur_cents": tx["amount_eur_cents"],
        "method": "stripe",
        "paid_at": now,
        "stripe_payment_intent_id": intent_id,
    })
    # Activeer company (gebruikt bestaande helper als die beschikbaar is)
    try:
        activate = getattr(_deps, "activate_company_after_payment", None)
        if callable(activate):
            await activate(tx.get("company_id"))
    except Exception:  # noqa: BLE001
        pass


@router.post("/saas-stripe/webhook")
async def stripe_webhook(request: Request):
    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")
    try:
        event = stripe.Webhook.construct_event(payload, sig, STRIPE_WEBHOOK_SECRET)
    except (ValueError, stripe.error.SignatureVerificationError):
        raise HTTPException(400, "Invalid signature")
    data = json.loads(payload)  # plain dict: StripeObject heeft geen .get()
    t, obj = event["type"], data["data"]["object"]
    now = _deps.iso(_deps.now_utc())
    if t == "payment_intent.succeeded":
        await _mark_paid(obj["id"], obj)
    elif t == "payment_intent.payment_failed":
        await _deps.db.saas_stripe_transactions.update_one(
            {"payment_intent_id": obj["id"]},
            {"$set": {"status": "failed", "last_error": (obj.get("last_payment_error") or {}).get("message"), "updated_at": now}},
        )
    elif t == "payment_intent.canceled":
        await _deps.db.saas_stripe_transactions.update_one(
            {"payment_intent_id": obj["id"]},
            {"$set": {"status": "canceled", "updated_at": now}},
        )
    elif t == "charge.refunded":
        pi_id = obj.get("payment_intent")
        if pi_id:
            await _deps.db.saas_stripe_transactions.update_one(
                {"payment_intent_id": pi_id},
                {"$set": {"status": "refunded", "updated_at": now}},
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
