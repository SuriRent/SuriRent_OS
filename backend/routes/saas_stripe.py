"""
SaaS Stripe betalingen — custom PaymentIntent flow (NIET Stripe Hosted).
Klant (Mijn Abonnement) of superadmin start een betaling per abonnement-
factuur via Creditcard of iDEAL. Afrekening in EUR (SRD→EUR conversie).
Stripe-sleutels (test/live) worden beheerd in SaaS Instellingen.
"""
from __future__ import annotations

import os
import json
from datetime import datetime
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


async def _resolve_invoices(body: "CreateIntentIn", user: dict) -> list[dict]:
    """Eén factuur, een selectie (invoice_ids) of alle openstaande (all_open)."""
    is_super = user.get("role") == "superadmin"
    cid = _deps.company_id_of(user)
    if body.invoice_ids or body.all_open:
        q: dict = {"status": {"$nin": CLOSED_STATUSES}}
        if body.invoice_ids:
            q["id"] = {"$in": body.invoice_ids}
        if not is_super or body.all_open:
            if not cid:
                raise HTTPException(400, "Geen actief bedrijf")
            q["company_id"] = cid
        invs = await _deps.db.subscription_invoices.find(q, {"_id": 0}).sort(
            [("period_start", 1), ("created_at", 1)]).to_list(100)
        if not invs:
            raise HTTPException(404, "Geen openstaande facturen gevonden")
        if len({i.get("company_id") for i in invs}) > 1:
            raise HTTPException(400, "Facturen van verschillende bedrijven kunnen niet samen betaald worden")
        return invs
    inv = await _resolve_invoice(body.invoice_id, user)
    if inv.get("status") in CLOSED_STATUSES:
        raise HTTPException(400, "Deze factuur is al betaald of vervallen")
    return [inv]


async def _ensure_customer(company_id: str, cfg: dict) -> str:
    c = await _deps.db.companies.find_one({"id": company_id}, {"_id": 0}) or {}
    cus = (c.get("stripe_customers") or {}).get(cfg["mode"])
    if cus:
        return cus
    obj = stripe.Customer.create(api_key=cfg["secret_key"], name=c.get("name") or company_id,
                                 email=c.get("owner_email") or None, metadata={"company_id": company_id})
    await _deps.db.companies.update_one({"id": company_id}, {"$set": {f"stripe_customers.{cfg['mode']}": obj.id}})
    return obj.id


class CreateIntentIn(BaseModel):
    invoice_id: Optional[str] = None
    invoice_ids: Optional[list[str]] = None
    all_open: bool = False
    method: Literal["card", "ideal"] = "card"


def _inv_summary(i: dict) -> dict:
    return {"id": i["id"], "invoice_number": i.get("invoice_number"), "amount": i.get("amount"),
            "currency": i.get("currency"), "plan": i.get("plan"),
            "period_start": i.get("period_start"), "period_end": i.get("period_end")}


async def _record_tx(*, invs: list[dict], pi_id: str, method: str, cfg: dict, cents: int, rate: float,
                     created_by: str, status: str = "pending", extra: Optional[dict] = None) -> None:
    now = _deps.iso(_deps.now_utc())
    await _deps.db.saas_stripe_transactions.insert_one({
        "id": _deps.new_id(),
        "invoice_id": invs[0]["id"],
        "invoice_ids": [i["id"] for i in invs],
        "company_id": invs[0].get("company_id"),
        "payment_intent_id": pi_id,
        "method": method,
        "mode": cfg["mode"],
        "amount_eur_cents": cents,
        "eur_rate": rate,
        "original_amount": sum(float(i.get("amount") or 0) for i in invs),
        "original_currency": invs[0].get("currency") or "SRD",
        "status": status,
        "created_by": created_by,
        "created_at": now,
        "updated_at": now,
        **(extra or {}),
    })


async def _cents_for(invs: list[dict]) -> tuple[int, float]:
    total, rate = 0, 1.0
    for i in invs:
        c, rate = await _to_eur_cents(float(i.get("amount") or 0), i.get("currency") or "SRD")
        total += c
    return total, rate


@router.post("/saas-stripe/create-intent")
async def create_intent(body: CreateIntentIn, user: dict = Depends(_deps.get_current_user)):
    """Superadmin: elke factuur. Klant-admin: eigen factuur/selectie/alle open,
    of zonder parameters de oudste openstaande factuur."""
    invs = await _resolve_invoices(body, user)
    cfg = await _active_cfg()
    if not cfg["enabled"]:
        raise HTTPException(400, "Online betalen is nog niet geactiveerd")
    cents, rate = await _cents_for(invs)
    cid = invs[0].get("company_id") or ""
    label = ", ".join((i.get("invoice_number") or i["id"][:8].upper()) for i in invs[:5])
    kwargs = {}
    if body.method == "card" and cid:
        kwargs["customer"] = await _ensure_customer(cid, cfg)
    try:
        intent = stripe.PaymentIntent.create(
            api_key=cfg["secret_key"], amount=cents, currency="eur",
            payment_method_types=[body.method],
            metadata={"invoice_ids": ",".join(i["id"] for i in invs)[:480], "company_id": cid, "source": "surirent_saas"},
            description=f"SuriRent abonnement {label}", **kwargs,
        )
    except stripe.error.StripeError as e:
        msg = e.user_message or str(e)
        if body.method == "ideal" and "ideal" in msg.lower():
            msg = "iDEAL is niet geactiveerd in uw Stripe-account (Dashboard → Settings → Payment methods)."
        raise HTTPException(400, f"Stripe: {msg[:200]}")

    await _record_tx(invs=invs, pi_id=intent.id, method=body.method, cfg=cfg, cents=cents, rate=rate,
                     created_by=user.get("email"))
    total = sum(float(i.get("amount") or 0) for i in invs)
    return {
        "client_secret": intent.client_secret,
        "payment_intent_id": intent.id,
        "amount_eur_cents": cents,
        "method": body.method,
        "mode": cfg["mode"],
        "publishable_key": cfg["publishable_key"],
        "can_save_card": body.method == "card" and user.get("role") != "superadmin",
        "invoice": _inv_summary(invs[0]) | {"amount": total},
        "invoices": [_inv_summary(i) for i in invs],
        "total_amount": total,
        "currency": invs[0].get("currency") or "SRD",
    }


class SaveCardIn(BaseModel):
    payment_intent_id: str
    save: bool


@router.post("/saas-stripe/intent-save-card")
async def intent_save_card(body: SaveCardIn, user: dict = Depends(_deps.get_current_user)):
    """Vóór bevestiging: kaart bewaren voor automatisch betalen aan/uit."""
    tx = await _deps.db.saas_stripe_transactions.find_one(
        {"payment_intent_id": body.payment_intent_id, "company_id": _deps.company_id_of(user)}, {"_id": 0})
    if not tx or tx.get("method") != "card" or tx.get("status") != "pending":
        raise HTTPException(404, "Betaling niet gevonden")
    if body.save and not tx.get("sfu_set"):
        doc = await _stripe_doc()
        sk = _keys_for(doc, tx.get("mode") or "test")["secret_key"]
        try:
            stripe.PaymentIntent.modify(body.payment_intent_id, api_key=sk, setup_future_usage="off_session")
        except stripe.error.StripeError as e:
            raise HTTPException(400, f"Stripe: {(e.user_message or str(e))[:200]}")
    await _deps.db.saas_stripe_transactions.update_one(
        {"payment_intent_id": body.payment_intent_id},
        {"$set": {"save_card": body.save, **({"sfu_set": True} if body.save else {})}})
    return {"ok": True, "save": body.save}


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
            "invoice_ids": tx.get("invoice_ids") or [tx["invoice_id"]],
            "method": tx.get("method"), "amount_eur_cents": tx.get("amount_eur_cents"),
            "card_saved": bool(tx.get("card_saved"))}


async def _store_card(tx: dict, intent_id: str) -> None:
    doc = await _stripe_doc()
    sk = _keys_for(doc, tx.get("mode") or "test")["secret_key"]
    pi = stripe.PaymentIntent.retrieve(intent_id, api_key=sk).to_dict()
    pm_id = pi.get("payment_method")
    if not pm_id:
        return
    card = (stripe.PaymentMethod.retrieve(pm_id, api_key=sk).to_dict().get("card") or {})
    await _deps.db.companies.update_one({"id": tx["company_id"]}, {"$set": {"autopay": {
        "enabled": True, "mode": tx.get("mode") or "test", "customer_id": pi.get("customer"),
        "payment_method_id": pm_id, "brand": card.get("brand"), "last4": card.get("last4"),
        "exp_month": card.get("exp_month"), "exp_year": card.get("exp_year"),
        "updated_at": _deps.iso(_deps.now_utc()),
    }}})
    await _deps.db.saas_stripe_transactions.update_one({"payment_intent_id": intent_id}, {"$set": {"card_saved": True}})


async def _mark_paid(intent_id: str) -> None:
    """Idempotent: transactie + facturen → paid, betalingen boeken, bedrijf activeren."""
    now = _deps.iso(_deps.now_utc())
    res = await _deps.db.saas_stripe_transactions.update_one(
        {"payment_intent_id": intent_id, "status": {"$ne": "paid"}},
        {"$set": {"status": "paid", "paid_at": now, "updated_at": now}},
    )
    if res.modified_count == 0:
        return
    tx = await _deps.db.saas_stripe_transactions.find_one({"payment_intent_id": intent_id}, {"_id": 0})
    ids = tx.get("invoice_ids") or [tx["invoice_id"]]
    invs = await _deps.db.subscription_invoices.find({"id": {"$in": ids}}, {"_id": 0}).to_list(100)
    method_label = "ideal" if tx.get("method") == "ideal" else "creditcard"
    company = await _deps.db.companies.find_one({"id": tx.get("company_id")}, {"_id": 0}) or {}
    note = "Automatisch afgeschreven (creditcard)" if tx.get("autopay") else "Online betaald via Stripe"
    for inv in invs:
        await _deps.db.subscription_invoices.update_one(
            {"id": inv["id"], "status": {"$ne": "paid"}},
            {"$set": {"status": "paid", "paid_at": now, "payment_method": method_label,
                      "stripe_payment_intent_id": intent_id}},
        )
        await _deps.db.subscription_payments.insert_one({
            "id": _deps.new_id(), "company_id": tx.get("company_id"), "company_name": company.get("name", ""),
            "invoice_id": inv["id"], "amount": float(inv.get("amount") or 0),
            "currency": inv.get("currency") or tx["original_currency"],
            "amount_eur_cents": tx["amount_eur_cents"] if len(invs) == 1 else None,
            "method": method_label, "reference": f"stripe:{intent_id}", "note": note,
            "paid_at": now, "created_at": now, "created_by": "stripe", "stripe_payment_intent_id": intent_id,
        })
    if tx.get("save_card") and tx.get("method") == "card":
        try:
            await _store_card(tx, intent_id)
        except Exception as e:  # noqa: BLE001
            print(f"[autopay] kaart opslaan mislukt: {e}")
    if tx.get("company_id"):
        last_plan = (invs[-1].get("plan") if invs else None)
        await _deps.activate_company_after_payment(tx["company_id"], plan_in_payment=last_plan)
        if company:
            await _deps.send_saas_payment_email(company, tx["original_amount"], tx["original_currency"],
                                                method_label, ids[0])
        if tx.get("autopay"):
            await _push(tx["company_id"], "Abonnement automatisch betaald",
                        f"{tx['original_currency']} {tx['original_amount']:,.0f} is afgeschreven van uw creditcard.")


# ─── Pushmeldingen + automatisch betalen ────────────────────────────────────

async def _push(company_id: str, title: str, body: str) -> None:
    try:
        await _deps.notify_company_admins(company_id, title, body,
                                          {"url": "/admin/instellingen#abonnement", "kind": "subscription"})
    except Exception as e:  # noqa: BLE001
        print(f"[saas-push] {e}")


async def autopay_charge_invoice(inv: dict) -> str:
    """Schrijf de bewaarde kaart direct af voor een nieuwe factuur.
    Retourneert 'skipped' | 'paid' | 'failed'."""
    c = await _deps.db.companies.find_one({"id": inv.get("company_id")}, {"_id": 0}) or {}
    ap = c.get("autopay") or {}
    cfg = await _active_cfg()
    if not (ap.get("enabled") and ap.get("payment_method_id") and cfg["enabled"] and ap.get("mode") == cfg["mode"]):
        return "skipped"
    cents, rate = await _cents_for([inv])
    try:
        pi = stripe.PaymentIntent.create(
            api_key=cfg["secret_key"], amount=cents, currency="eur", customer=ap["customer_id"],
            payment_method=ap["payment_method_id"], off_session=True, confirm=True,
            metadata={"invoice_ids": inv["id"], "company_id": inv["company_id"], "source": "surirent_saas_autopay"},
            description=f"SuriRent abonnement (automatisch) {inv['id'][:8].upper()}",
        )
    except stripe.error.StripeError as e:
        err = "kaart geweigerd" if isinstance(e, stripe.error.CardError) else (e.user_message or str(e))[:200]
        pi_id = getattr(getattr(e, "error", None), "payment_intent", None)
        pi_id = (pi_id.get("id") if isinstance(pi_id, dict) else getattr(pi_id, "id", None)) or f"failed:{_deps.new_id()}"
        await _record_tx(invs=[inv], pi_id=pi_id, method="card", cfg=cfg, cents=cents, rate=rate,
                         created_by="autopay", status="failed", extra={"autopay": True, "last_error": err})
        await _deps.db.subscription_invoices.update_one({"id": inv["id"]}, {"$set": {"autopay_failed": err}})
        await _push(inv["company_id"], "Automatische betaling mislukt",
                    f"Uw creditcard kon niet worden afgeschreven ({err}). Betaal uw factuur handmatig.")
        return "failed"
    await _record_tx(invs=[inv], pi_id=pi.id, method="card", cfg=cfg, cents=cents, rate=rate,
                     created_by="autopay", extra={"autopay": True})
    if pi.status == "succeeded":
        await _mark_paid(pi.id)
        return "paid"
    return "failed"


async def on_new_saas_invoice(inv: dict) -> str:
    """Hook bij een nieuwe abonnementsfactuur: pushmelding + automatisch betalen."""
    result = await autopay_charge_invoice(inv)
    if result == "skipped":
        await _push(inv["company_id"], "Nieuwe abonnementsfactuur",
                    f"{inv.get('currency') or 'SRD'} {float(inv.get('amount') or 0):,.0f} staat klaar om te betalen.")
    return result


async def expiry_push_tick() -> int:
    """Dagelijks: push bij verlopen proef/abonnement (1x per bedrijf per vervaldatum)."""
    now = _deps.now_utc()
    sent = 0
    async for c in _deps.db.companies.find({"billing_status": {"$in": ["trial", "expired", "active"]}}, {"_id": 0}):
        st = c.get("billing_status")
        ref = c.get("trial_ends_at") if st in ("trial", "expired") else None
        expired = st == "expired"
        if st == "trial" and ref:
            try:
                expired = datetime.fromisoformat(str(ref).replace("Z", "+00:00")) <= now
            except ValueError:
                expired = False
        if not expired:
            continue
        key = f"{c['id']}:{ref or st}"
        if await _deps.db.sent_expiry_push.find_one({"key": key}):
            continue
        await _deps.db.sent_expiry_push.insert_one({"key": key, "at": _deps.iso(now)})
        await _push(c["id"], "Abonnement verlopen", "Uw abonnement is verlopen. Betaal nu om toegang te behouden.")
        sent += 1
    return sent


class AutopayIn(BaseModel):
    enabled: bool


def _autopay_public(ap: dict) -> dict:
    has = bool(ap.get("payment_method_id"))
    return {"enabled": bool(ap.get("enabled")) and has, "has_card": has, "mode": ap.get("mode"),
            "card": {k: ap.get(k) for k in ("brand", "last4", "exp_month", "exp_year")} if has else None}


@router.get("/billing/me/autopay")
async def get_autopay(user: dict = Depends(_deps.get_current_user)):
    c = await _deps.db.companies.find_one({"id": _deps.company_id_of(user)}, {"_id": 0, "autopay": 1}) or {}
    return _autopay_public(c.get("autopay") or {})


@router.put("/billing/me/autopay")
async def put_autopay(body: AutopayIn, user: dict = Depends(_deps.get_current_user)):
    cid = _deps.company_id_of(user)
    c = await _deps.db.companies.find_one({"id": cid}, {"_id": 0, "autopay": 1}) or {}
    ap = c.get("autopay") or {}
    if body.enabled and not ap.get("payment_method_id"):
        raise HTTPException(400, "Betaal eerst één keer met creditcard en vink 'Kaart bewaren' aan")
    await _deps.db.companies.update_one({"id": cid}, {"$set": {"autopay.enabled": body.enabled}})
    return _autopay_public({**ap, "enabled": body.enabled})


@router.delete("/billing/me/autopay")
async def delete_autopay(user: dict = Depends(_deps.get_current_user)):
    cid = _deps.company_id_of(user)
    c = await _deps.db.companies.find_one({"id": cid}, {"_id": 0, "autopay": 1}) or {}
    ap = c.get("autopay") or {}
    if ap.get("payment_method_id"):
        try:
            sk = _keys_for(await _stripe_doc(), ap.get("mode") or "test")["secret_key"]
            stripe.PaymentMethod.detach(ap["payment_method_id"], api_key=sk)
        except stripe.error.StripeError:
            pass
    await _deps.db.companies.update_one({"id": cid}, {"$unset": {"autopay": ""}})
    return _autopay_public({})


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
