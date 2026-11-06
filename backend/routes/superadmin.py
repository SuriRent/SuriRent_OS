"""Superadmin routes — SaaS-eigenaar endpoints voor multi-tenant beheer.

Eerste batch (incrementele refactor van server.py):
  GET  /superadmin/overview               — KPI dashboard data
  GET  /superadmin/online-status          — per-bedrijf live presence
  GET  /superadmin/subscription-invoices  — lijst SaaS-facturen
  GET  /superadmin/subscription-payments  — lijst ontvangen betalingen

Vervolg-batches kunnen dezelfde patroon volgen: overige /superadmin/*
routes uit server.py verplaatsen naar deze module.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
import io

from . import _deps
from saas_invoicing import (
    append_company_invoice_charge,
    consolidate_company_invoices,
)

router = APIRouter()


async def _superadmin(request: Request) -> dict:
    """Runtime-resolved auth dep. `_deps.get_current_user` wordt door
    server.py bij startup gevuld — daarom hier gewrapd i.p.v. direct als
    Depends() bij de route-definitie."""
    user = await _deps.get_current_user(request)
    if not user or user.get("role") != "superadmin":
        raise HTTPException(status_code=403, detail="Alleen superadmin")
    return user


# =====================================================================
# GET /superadmin/overview — aggregate KPI dashboard
# =====================================================================


@router.get("/superadmin/overview")
async def superadmin_overview(user: dict = Depends(_superadmin)):
    """Aggregate metrics voor het SaaS dashboard, incl. online-count,
    ontvangen inkomsten per valuta en open facturen in de lopende maand."""
    db = _deps.db
    companies = await db.companies.find({}, {"_id": 0}).to_list(1000)
    total = len(companies)
    trial = active = expired = cancelled = online_now = 0
    mrr_by_currency: dict[str, float] = {}
    for c in companies:
        s = await _deps.billing_summary(c)
        st = s["billing_status"]
        if st == "trial":
            trial += 1
        elif st == "active":
            active += 1
            interval = (s.get("plan_interval") or "month").lower()
            if interval not in {"lifetime", "once"}:
                period_count = {"quarter": 3, "year": 12}.get(interval, 1)
                currency = (s.get("currency") or "SRD").upper()
                mrr_by_currency[currency] = mrr_by_currency.get(currency, 0.0) + (
                    float(s.get("monthly_amount") or 0) / period_count
                )
        elif st == "expired":
            expired += 1
        elif st == "cancelled":
            cancelled += 1
        if _deps.is_online(c.get("last_seen_at")):
            online_now += 1

    paid_invoices = await db.subscription_invoices.count_documents({
        "status": "paid", "merged_into_invoice_id": {"$exists": False},
    })
    pending_ocr = await db.saas_payment_requests.count_documents({"status": "pending_approval"})
    open_invoices = await db.subscription_invoices.count_documents({"status": {"$in": ["open", "overdue"]}})
    overdue_invoices = await db.subscription_invoices.count_documents({"status": "overdue"})

    # Aggregeer ontvangen SaaS-inkomsten per valuta (Kas saldo hero).
    # Bron: `subscription_payments` — bevat alle ontvangen bedragen én
    # handmatige mutaties/refunds (positief = in, negatief = uit).
    total_received_by_currency: dict[str, float] = {}
    total_received_srd = 0.0
    async for pmt in db.subscription_payments.find({}, {"_id": 0, "amount": 1, "currency": 1}):
        cur = (pmt.get("currency") or "SRD").upper()
        amt = float(pmt.get("amount") or 0)
        total_received_by_currency[cur] = total_received_by_currency.get(cur, 0.0) + amt
        if cur == "SRD":
            total_received_srd += amt

    # Open facturen in de lopende maand — per valuta + telling.
    now = _deps.now_utc()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if month_start.month == 12:
        month_end = month_start.replace(year=month_start.year + 1, month=1)
    else:
        month_end = month_start.replace(month=month_start.month + 1)
    current_month_open_by_currency: dict[str, float] = {}
    current_month_open_count = 0
    async for iv in db.subscription_invoices.find({
        "status": {"$in": ["open", "overdue"]},
        "created_at": {"$gte": _deps.iso(month_start), "$lt": _deps.iso(month_end)},
    }, {"_id": 0, "amount": 1, "currency": 1}):
        cur = (iv.get("currency") or "SRD").upper()
        amt = float(iv.get("amount") or 0)
        current_month_open_by_currency[cur] = current_month_open_by_currency.get(cur, 0.0) + amt
        current_month_open_count += 1

    return {
        "companies_total": total,
        "trial": trial, "active": active, "expired": expired, "cancelled": cancelled,
        "online_now": online_now,
        "mrr": mrr_by_currency.get("SRD", 0), "currency": "SRD",
        "mrr_by_currency": mrr_by_currency,
        "paid_invoices": paid_invoices,
        "open_invoices": open_invoices,
        "overdue_invoices": overdue_invoices,
        "pending_ocr": pending_ocr,
        "total_received_srd": total_received_srd,
        "total_received_by_currency": total_received_by_currency,
        "current_month_open_count": current_month_open_count,
        "current_month_open_by_currency": current_month_open_by_currency,
    }


# =====================================================================
# GET /superadmin/online-status — per-bedrijf presence widget
# =====================================================================


@router.get("/superadmin/online-status")
async def superadmin_online_status(user: dict = Depends(_superadmin)):
    """Returns per-company online status: last_seen, online (bool), billing_status,
    plus een count van users gezien in de laatste 5 min."""
    db = _deps.db
    companies = await db.companies.find({}, {"_id": 0}).to_list(1000)
    threshold = _deps.now_utc().timestamp() - 300
    recent_user_counts: dict[str, int] = {}
    async for u in db.users.find(
        {"last_seen_at": {"$exists": True}, "company_id": {"$ne": None}},
        {"_id": 0, "company_id": 1, "last_seen_at": 1},
    ):
        try:
            ts = datetime.fromisoformat(str(u["last_seen_at"]).replace("Z", "+00:00")).timestamp()
            if ts >= threshold:
                cid = u.get("company_id")
                if cid:
                    recent_user_counts[cid] = recent_user_counts.get(cid, 0) + 1
        except Exception:
            continue

    rows = []
    for c in companies:
        last_seen = c.get("last_seen_at")
        s = await _deps.billing_summary(c)
        rows.append({
            "id": c.get("id"),
            "name": c.get("name"),
            "slug": c.get("slug"),
            "last_seen_at": last_seen,
            "online": _deps.is_online(last_seen),
            "active_users": recent_user_counts.get(c.get("id"), 0),
            "billing_status": s["billing_status"],
            "access_restricted": s.get("access_restricted", False),
            "grace_days_left": s.get("grace_days_left", 0),
            "plan": c.get("plan"),
            "trial_ends_at": c.get("trial_ends_at"),
            "monthly_amount": s.get("monthly_amount"),
            "currency": s.get("currency") or "SRD",
        })
    rows.sort(key=lambda r: (
        0 if r["online"] else 1,
        -(datetime.fromisoformat(str(r["last_seen_at"]).replace("Z", "+00:00")).timestamp()
           if r["last_seen_at"] else 0),
    ))
    return {
        "companies": rows,
        "total_online": sum(1 for r in rows if r["online"]),
        "threshold_seconds": 300,
        "checked_at": _deps.iso(_deps.now_utc()),
    }


# =====================================================================
# Subscription invoices — lijst + mark paid
# =====================================================================


@router.get("/superadmin/subscription-invoices")
async def list_subscription_invoices(user: dict = Depends(_superadmin)):
    docs = await _deps.db.subscription_invoices.find(
        {"merged_into_invoice_id": {"$exists": False},
         "status": {"$nin": ["merged", "superseded"]}}, {"_id": 0},
    ).sort("created_at", -1).to_list(500)
    invoice_ids = [invoice["id"] for invoice in docs]
    plans = await _deps.db.saas_payment_plans.find(
        {"invoice_id": {"$in": invoice_ids}}, {"_id": 0},
    ).to_list(1000)
    plans_by_invoice: dict[str, list[dict]] = {}
    for plan in plans:
        plans_by_invoice.setdefault(plan["invoice_id"], []).append(plan)
    for invoice in docs:
        invoice["payment_plans"] = plans_by_invoice.get(invoice["id"], [])
    return docs


# =====================================================================
# Subscription payments — lijst
# =====================================================================


@router.get("/superadmin/subscription-payments")
async def list_subscription_payments(user: dict = Depends(_superadmin)):
    docs = await _deps.db.subscription_payments.find({}, {"_id": 0}).sort("paid_at", -1).to_list(500)
    return docs


# =====================================================================
# Handmatige factuur aanmaken (POST /superadmin/subscription-invoices)
# =====================================================================


class NewInvoiceIn(BaseModel):
    company_id: str
    amount: float = Field(..., gt=0)
    currency: Literal["SRD", "USD", "EUR"] = "SRD"
    plan: Optional[str] = None                     # bv "starter", "pro"
    period_start: Optional[str] = None             # ISO; default = now
    period_end: Optional[str] = None               # ISO; default based on plan interval
    note: Optional[str] = ""


@router.post("/superadmin/subscription-invoices")
async def create_subscription_invoice(body: NewInvoiceIn,
                                       user: dict = Depends(_superadmin)):
    db = _deps.db
    c = await db.companies.find_one({"id": body.company_id}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Bedrijf niet gevonden")
    now = _deps.now_utc()
    plan_id = body.plan or c.get("plan", "starter")
    plan = await _deps.get_plan(plan_id)
    if not plan:
        raise HTTPException(status_code=400, detail=f"Onbekend pakket '{plan_id}'")
    try:
        requested_start = (
            datetime.fromisoformat(body.period_start.replace("Z", "+00:00"))
            if body.period_start else now
        )
    except ValueError:
        raise HTTPException(status_code=400, detail="Ongeldige startdatum voor de factuurperiode")
    period_start_dt = _deps.plan_period_start(plan, requested_start)
    period_start = _deps.iso(period_start_dt)
    default_period_end = _deps.plan_period_end(plan, period_start_dt)
    if str(plan.get("interval") or "month").lower() == "month":
        period_end = _deps.iso(default_period_end) if default_period_end else None
    else:
        period_end = body.period_end or (_deps.iso(default_period_end) if default_period_end else None)
    try:
        period_end_dt = (
            datetime.fromisoformat(period_end.replace("Z", "+00:00"))
            if period_end else None
        )
    except ValueError:
        raise HTTPException(status_code=400, detail="Ongeldige einddatum voor de factuurperiode")
    inv = {
        "id": _deps.new_id(),
        "company_id": body.company_id,
        "company_name": c.get("name", ""),
        "plan": plan_id,
        "amount": _deps.saas_invoice_amount(
            plan, float(body.amount), period_start_dt, period_end_dt,
        ),
        "currency": body.currency,
        "status": "open",
        "kind": "subscription",
        "period_start": period_start,
        "period_end": period_end,
        "due_date": _deps.saas_due_date(now),
        "created_at": _deps.iso(now),
        "created_by": user.get("email", "superadmin"),
        "note": body.note or "",
        "manual": True,                             # zichtbaar in UI als 'Handmatig'
        **_deps.saas_invoice_cycle_fields(plan),
    }
    try:
        inv, created = await append_company_invoice_charge(
            db, inv, f"manual:{str(period_start)[:10]}",
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    if not created:
        inv["autopay_result"] = "already_exists"
        return inv
    from .saas_stripe import on_new_saas_invoice
    inv["autopay_result"] = await on_new_saas_invoice(inv)
    return inv


# =====================================================================
# SaaS auto-invoice tick (aangeroepen vanuit daily-billing loop in server.py)
# =====================================================================


async def saas_auto_invoice_tick() -> list[dict]:
    """Invoice completed monthly service in arrears; preserve quarter/year billing intervals."""
    db = _deps.db
    now = _deps.now_utc()
    created: list[dict] = []
    cursor = db.companies.find({"billing_status": "active"}, {"_id": 0})
    async for c in cursor:
        renews_at_raw = c.get("subscription_renews_at")
        if not renews_at_raw:
            continue
        try:
            renews_at = datetime.fromisoformat(str(renews_at_raw).replace("Z", "+00:00"))
        except Exception:
            continue
        if renews_at > now:
            continue  # nog niet verlopen — wachten
        # Gebruik dezelfde plan-catalogus als pakkettenbeheer en registratie.
        plan_id = c.get("plan") or "starter"
        plan = await _deps.get_plan(plan_id)
        summary = await _deps.billing_summary(c)
        amount = float(summary.get("monthly_amount") or 0)
        currency = str(summary.get("currency") or (plan or {}).get("currency") or "SRD").upper()
        if amount <= 0:
            continue
        if str((plan or {}).get("interval") or "month").lower() == "month":
            period_start, period_end = _deps.monthly_billing_period(renews_at)
            subscription_started_at = c.get("subscription_started_at")
            if subscription_started_at:
                try:
                    started = datetime.fromisoformat(
                        str(subscription_started_at).replace("Z", "+00:00"),
                    )
                    if started.date() > period_end.date():
                        await db.companies.update_one(
                            {"id": c["id"]},
                            {"$set": {"subscription_renews_at": _deps.iso(
                                _deps.next_monthly_invoice_date(period_end),
                            )}},
                        )
                        continue
                    if started.date() > period_start.date():
                        period_start = _deps.plan_period_start(plan, started)
                except (TypeError, ValueError):
                    pass
            amount = _deps.saas_invoice_amount(plan, amount, period_start, period_end)
            due_date = _deps.saas_due_date(period_end + timedelta(days=1))
        else:
            period_start = _deps.plan_period_start(plan, renews_at)
            period_end = _deps.plan_period_end(plan, period_start)
            due_date = _deps.saas_due_date(now)
        try:
            current_invoice = await consolidate_company_invoices(db, c["id"])
        except ValueError as exc:
            print(f"[saas-invoice] could not check existing charges for {c['id']}: {exc}")
            continue
        if _deps.invoice_covers_period(current_invoice, period_start, period_end):
            if str((plan or {}).get("interval") or "month").lower() == "month":
                await db.companies.update_one(
                    {"id": c["id"]},
                    {"$set": {"subscription_renews_at": _deps.iso(
                        _deps.next_monthly_invoice_date(period_end),
                    )}},
                )
            continue
        inv = {
            "id": _deps.new_id(),
            "company_id": c["id"],
            "company_name": c.get("name", ""),
            "plan": plan_id,
            "amount": amount,
            "currency": currency,
            "status": "open",
            "kind": "subscription",
            "period_start": _deps.iso(period_start),
            "period_end": _deps.iso(period_end) if period_end else None,
            "due_date": due_date,
            "created_at": _deps.iso(now),
            "created_by": "auto_saas_invoice",
            "auto_generated": True,
            **_deps.saas_invoice_cycle_fields(plan),
        }
        try:
            inv, created_charge = await append_company_invoice_charge(
                db, inv, f"subscription:{_deps.iso(period_start)}",
            )
        except ValueError as exc:
            print(f"[saas-invoice] could not add charge for {c['id']}: {exc}")
            continue
        if str((plan or {}).get("interval") or "month").lower() == "month":
            await db.companies.update_one(
                {"id": c["id"]},
                {"$set": {"subscription_renews_at": _deps.iso(
                    _deps.next_monthly_invoice_date(period_end),
                )}},
            )
        if not created_charge:
            continue
        try:
            from .saas_stripe import on_new_saas_invoice
            await on_new_saas_invoice(inv)
        except Exception as e:  # noqa: BLE001
            print(f"[saas-invoice] autopay/push hook faalde: {e}")
        created.append({
            "invoice_id": inv["id"],
            "company_id": c["id"],
            "company_name": c.get("name", ""),
            "amount": amount,
            "currency": currency,
        })
    return created


@router.post("/superadmin/saas-auto-invoice/run")
async def run_saas_auto_invoice(user: dict = Depends(_superadmin)):
    """Handmatige trigger voor de SaaS auto-invoice cyclus."""
    created = await saas_auto_invoice_tick()
    return {"ok": True, "created": len(created), "invoices": created}


# =====================================================================
# SaaS Kasregister — companies overview voor de superadmin-kiosk
# =====================================================================


@router.get("/superadmin/kasregister")
async def superadmin_kasregister(user: dict = Depends(_superadmin)):
    """Kasregister view: per bedrijf de totale schuld, openstaande facturen,
    laatste betaling en betaalstatus. Optimaal voor het SaaS-kasregister
    (superadmin kiosk) waar de eigenaar snel per bedrijf kan zien wie moet
    betalen."""
    db = _deps.db
    companies = await db.companies.find({}, {"_id": 0}).to_list(1000)
    # Aggregeer facturen per company
    invoices_by_cid: dict[str, list[dict]] = {}
    async for inv in db.subscription_invoices.find(
        {"merged_into_invoice_id": {"$exists": False}}, {"_id": 0},
    ).sort("created_at", -1):
        invoices_by_cid.setdefault(inv["company_id"], []).append(inv)
    payments_by_cid: dict[str, list[dict]] = {}
    async for pmt in db.subscription_payments.find({}, {"_id": 0}).sort("paid_at", -1):
        if pmt.get("company_id"):
            payments_by_cid.setdefault(pmt["company_id"], []).append(pmt)

    now = _deps.now_utc()
    rows = []
    for c in companies:
        cid = c["id"]
        invs = invoices_by_cid.get(cid, [])
        pmts = payments_by_cid.get(cid, [])
        open_invs = [i for i in invs if i.get("status") in {"open", "overdue"}]
        overdue = 0
        outstanding_by_cur: dict[str, float] = {}
        for i in open_invs:
            cur = (i.get("currency") or "SRD").upper()
            balance_due = float(i.get("balance_due", float(i.get("amount") or 0) - float(i.get("paid_amount") or 0)))
            outstanding_by_cur[cur] = outstanding_by_cur.get(cur, 0.0) + balance_due
            try:
                pe = datetime.fromisoformat(str(i.get("period_end") or "").replace("Z", "+00:00"))
                if pe < now:
                    overdue += 1
            except Exception:
                pass
        last_pmt = pmts[0] if pmts else None
        summary = await _deps.billing_summary(c)
        # Bepaal status voor kasregister
        if overdue > 0:
            status = "overdue"
        elif len(open_invs) > 0:
            status = "open"
        elif summary["billing_status"] == "trial":
            status = "trial"
        elif summary["billing_status"] in {"expired", "past_due"}:
            status = "overdue"
        elif not invs:
            status = "unbilled"
        else:
            status = "paid"
        rows.append({
            "id": cid,
            "name": c.get("name", ""),
            "slug": c.get("slug"),
            "plan": c.get("plan"),
            "billing_status": summary["billing_status"],
            "monthly_amount": summary.get("monthly_amount"),
            "currency": summary.get("currency") or "SRD",
            "plan_interval": summary.get("plan_interval") or "month",
            "open_count": len(open_invs),
            "overdue_count": overdue,
            "outstanding_by_currency": outstanding_by_cur,
            "paid_count": sum(1 for i in invs if i.get("status") == "paid"),
            "total_invoices": len(invs),
            "last_payment": last_pmt,
            "status": status,
            "subscription_renews_at": c.get("subscription_renews_at"),
        })
    # Sorteer: achterstand > open > betaald
    order = {"overdue": 0, "open": 1, "paid": 2}
    rows.sort(key=lambda r: (order.get(r["status"], 3), r["name"].lower()))
    return {
        "companies": rows,
        "checked_at": _deps.iso(now),
        "totals": {
            "overdue": sum(1 for r in rows if r["status"] == "overdue"),
            "open": sum(1 for r in rows if r["status"] == "open"),
            "paid": sum(1 for r in rows if r["status"] == "paid"),
            "trial": sum(1 for r in rows if r["status"] == "trial"),
            "unbilled": sum(1 for r in rows if r["status"] == "unbilled"),
        },
    }


# =====================================================================
# SaaS Betalingsregelingen (Payment Plans op SaaS-invoice niveau)
# =====================================================================


class SaasPlanIn(BaseModel):
    company_id: str
    invoice_id: Optional[str] = None    # optionele bron-factuur; zo niet -> vrij
    total_amount: float = Field(..., gt=0)
    currency: Literal["SRD", "USD", "EUR"] = "SRD"
    installments: int = Field(..., ge=2, le=24)
    interval_days: int = Field(30, ge=1, le=90)
    start_date: Optional[str] = None    # ISO; default = today
    note: Optional[str] = ""


@router.post("/superadmin/saas-payment-plans")
async def create_saas_payment_plan(body: SaasPlanIn,
                                    user: dict = Depends(_superadmin)):
    """Adds a payment schedule to the company's persistent master invoice."""
    db = _deps.db
    c = await db.companies.find_one({"id": body.company_id}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Bedrijf niet gevonden")
    try:
        master_invoice = await consolidate_company_invoices(db, body.company_id)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    if master_invoice:
        active_plans = await db.saas_payment_plans.find(
            {"invoice_id": master_invoice["id"]}, {"_id": 0, "schedule": 1},
        ).to_list(1000)
        if any(
            term.get("status") != "paid"
            and float(term.get("paid_amount") or 0) < float(term.get("amount") or 0)
            for plan in active_plans for term in (plan.get("schedule") or [])
        ):
            raise HTTPException(status_code=409, detail="Er staat al een open betalingsregeling op deze factuur")
    source_invoice = None
    if body.invoice_id:
        source_invoice = await db.subscription_invoices.find_one(
            {"id": body.invoice_id, "company_id": body.company_id}, {"_id": 0},
        )
        if source_invoice and source_invoice.get("merged_into_invoice_id"):
            source_invoice = await db.subscription_invoices.find_one(
                {"id": source_invoice["merged_into_invoice_id"], "company_id": body.company_id},
                {"_id": 0},
            )
        if source_invoice and source_invoice.get("id") != (master_invoice or {}).get("id"):
            source_invoice = None
        if not source_invoice:
            raise HTTPException(status_code=404, detail="Bronfactuur niet gevonden voor dit bedrijf")
        if source_invoice.get("status") not in {"open", "overdue"}:
            raise HTTPException(status_code=409, detail="Alleen een open factuur kan worden omgezet naar een betalingsregeling")
        balance_due = float(source_invoice.get(
            "balance_due",
            float(source_invoice.get("amount") or 0) - float(source_invoice.get("paid_amount") or 0),
        ))
        if abs(balance_due - body.total_amount) > 0.005:
            raise HTTPException(status_code=400, detail=f"Het regelingbedrag moet overeenkomen met het openstaande saldo: {balance_due:.2f}")
        if (source_invoice.get("currency") or "SRD").upper() != body.currency:
            raise HTTPException(status_code=400, detail="De valuta van de regeling moet overeenkomen met de factuur")
    now = _deps.now_utc()
    start = datetime.fromisoformat(body.start_date) if body.start_date else now
    plan_id = _deps.new_id()
    per_amount = round(body.total_amount / body.installments, 2)
    if per_amount <= 0:
        raise HTTPException(status_code=400, detail="Het totaalbedrag is te laag om over termijnen te verdelen")
    # Correctie op laatste termijn zodat som = totaal
    amounts = [per_amount] * (body.installments - 1)
    amounts.append(round(body.total_amount - per_amount * (body.installments - 1), 2))

    schedule = []
    for i, amt in enumerate(amounts):
        due = start + timedelta(days=body.interval_days * i)
        schedule.append({
            "seq": i + 1,
            "amount": amt,
            "status": "open",
            "paid_amount": 0,
            "due_date": due.date().isoformat(),
            "period_end": _deps.iso(due + timedelta(days=body.interval_days)),
        })
    if source_invoice:
        invoice = source_invoice
    else:
        try:
            invoice, _ = await append_company_invoice_charge(db, {
                "id": _deps.new_id(),
                "company_id": body.company_id,
                "company_name": c.get("name", ""),
                "plan": c.get("plan"),
                "amount": body.total_amount,
                "currency": body.currency,
                "status": "open",
                "kind": "subscription",
                "period_start": _deps.iso(start),
                "period_end": _deps.iso(start + timedelta(days=body.interval_days * body.installments)),
                "due_date": schedule[0]["due_date"],
                "created_at": _deps.iso(now),
                "created_by": user.get("email", "superadmin"),
                "note": body.note or "",
            }, f"payment-plan:{plan_id}")
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc))

    plan_doc = {
        "id": plan_id,
        "company_id": body.company_id,
        "company_name": c.get("name", ""),
        "total_amount": body.total_amount,
        "currency": body.currency,
        "installments": body.installments,
        "interval_days": body.interval_days,
        "start_date": _deps.iso(start),
        "created_at": _deps.iso(now),
        "created_by": user.get("email", "superadmin"),
        "note": body.note or "",
        "source_invoice_id": invoice["id"] if source_invoice else None,
        "invoice_id": invoice["id"],
        "schedule": schedule,
    }
    await db.saas_payment_plans.insert_one(plan_doc)
    plan_doc.pop("_id", None)
    return {"plan": plan_doc, "invoices": schedule}


@router.get("/superadmin/saas-payment-plans")
async def list_saas_payment_plans(user: dict = Depends(_superadmin)):
    """Combineert echte plans + bedrijven met 2+ open facturen (implicit plans)."""
    db = _deps.db
    plans = await db.saas_payment_plans.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    plan_ids = [p["id"] for p in plans]
    # Legacy term invoices are migrated into the schedule during startup consolidation.
    plan_map: dict[str, dict] = {p["id"]: {**p, "invoices": [], "paid": 0} for p in plans}
    for plan in plans:
        schedule = plan.get("schedule") or []
        plan_map[plan["id"]]["invoices"] = [
            {
                **term,
                "id": f"{plan['id']}:{term.get('seq')}",
                "installment_seq": term.get("seq"),
                "installment_total": plan.get("installments"),
                "currency": plan.get("currency"),
                "invoice_id": plan.get("invoice_id"),
            }
            for term in schedule
        ]
        plan_map[plan["id"]]["paid"] = sum(
            float(term.get("paid_amount") or 0) for term in schedule
        )
    return list(plan_map.values())


# Silence unused-import warnings (timedelta reserved voor toekomstige endpoints).
_ = timedelta
_ = Response
_ = io


# =====================================================================
# Kasregister — Detail per bedrijf (facturen + betaalhistorie)
# =====================================================================


@router.get("/superadmin/kasregister/{company_id}")
async def kasregister_detail(company_id: str, user: dict = Depends(_superadmin)):
    db = _deps.db
    c = await db.companies.find_one({"id": company_id}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Bedrijf niet gevonden")
    invoices = await db.subscription_invoices.find(
        {"company_id": company_id, "merged_into_invoice_id": {"$exists": False},
         "status": {"$nin": ["merged", "superseded"]}}, {"_id": 0},
    ).sort("created_at", -1).to_list(500)
    payments = await db.subscription_payments.find(
        {"company_id": company_id, "merged_into_invoice_id": {"$exists": False}}, {"_id": 0},
    ).sort("paid_at", -1).to_list(500)
    plans = await db.saas_payment_plans.find(
        {"company_id": company_id}, {"_id": 0},
    ).sort("created_at", -1).to_list(100)
    summary = await _deps.billing_summary(c)

    outstanding: dict[str, float] = {}
    for iv in invoices:
        if iv.get("status") in {"paid", "superseded", "merged"}:
            continue
        cur = (iv.get("currency") or "SRD").upper()
        balance_due = float(iv.get("balance_due", float(iv.get("amount") or 0) - float(iv.get("paid_amount") or 0)))
        outstanding[cur] = outstanding.get(cur, 0.0) + balance_due
    return {
        "company": {
            "id": c["id"], "name": c.get("name"), "slug": c.get("slug"),
            "plan": c.get("plan"), "owner_email": c.get("owner_email"),
            "owner_name": c.get("owner_name"), "country": c.get("country"),
            "billing_status": summary["billing_status"],
            "monthly_amount": summary.get("monthly_amount"),
            "currency": summary.get("currency") or "SRD",
            "plan_interval": summary.get("plan_interval") or "month",
            "trial_ends_at": c.get("trial_ends_at"),
            "subscription_renews_at": c.get("subscription_renews_at"),
        },
        "invoices": invoices,
        "payments": payments,
        "plans": plans,
        "outstanding_by_currency": outstanding,
    }


# =====================================================================
# PDF factuur — download + versturen per e-mail
# =====================================================================


@router.get("/superadmin/subscription-invoices/{inv_id}/pdf")
async def download_invoice_pdf(inv_id: str, user: dict = Depends(_superadmin)):
    db = _deps.db
    inv = await db.subscription_invoices.find_one({"id": inv_id}, {"_id": 0})
    if not inv:
        raise HTTPException(status_code=404, detail="Factuur niet gevonden")
    c = await db.companies.find_one({"id": inv["company_id"]}, {"_id": 0}) or {}
    saas = await db.saas_settings.find_one({"id": "_saas_settings"}, {"_id": 0}) or {}
    from pdf_gen import saas_invoice_pdf
    pdf_bytes = saas_invoice_pdf(inv, c, saas.get("company_info") if saas else None)
    filename = f"factuur-{inv['id'][:8].upper()}.pdf"
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f"inline; filename={filename}"},
    )


class EmailInvoiceIn(BaseModel):
    to_email: Optional[str] = None    # override; default = company.owner_email
    subject: Optional[str] = None
    body_html: Optional[str] = None


@router.post("/superadmin/subscription-invoices/{inv_id}/email")
async def email_invoice(inv_id: str, body: EmailInvoiceIn,
                         user: dict = Depends(_superadmin)):
    db = _deps.db
    inv = await db.subscription_invoices.find_one({"id": inv_id}, {"_id": 0})
    if not inv:
        raise HTTPException(status_code=404, detail="Factuur niet gevonden")
    c = await db.companies.find_one({"id": inv["company_id"]}, {"_id": 0}) or {}
    to = body.to_email or c.get("owner_email")
    if not to:
        raise HTTPException(status_code=400, detail="Geen e-mailadres beschikbaar voor dit bedrijf")

    saas = await db.saas_settings.find_one({"id": "_saas_settings"}, {"_id": 0}) or {}
    from pdf_gen import saas_invoice_pdf
    pdf_bytes = saas_invoice_pdf(inv, c, saas.get("company_info") if saas else None)
    filename = f"factuur-{inv['id'][:8].upper()}.pdf"

    subject = body.subject or f"SaaS Factuur {inv['id'][:8].upper()} — {c.get('name', '')}"
    body_html = body.body_html or (
        f"<p>Beste {c.get('owner_name') or 'beheerder'},</p>"
        f"<p>Bijgevoegd vindt u de factuur voor uw abonnement "
        f"<strong>{inv.get('plan', '')}</strong> ({inv.get('currency', 'SRD')} "
        f"{float(inv.get('amount') or 0):.2f}).</p>"
        f"<p>Gelieve dit bedrag binnen 14 dagen te voldoen.</p>"
        f"<p>Met vriendelijke groet,<br/>Het SuriRent team</p>"
    )

    ok = await _deps.saas_email(
        to_email=to, subject=subject, body_html=body_html,
        attachments=[(filename, pdf_bytes, "application/pdf")],
    )
    # Registreer in email-log op de factuur
    await db.subscription_invoices.update_one(
        {"id": inv_id},
        {"$push": {"email_log": {
            "sent_to": to, "sent_at": _deps.iso(_deps.now_utc()),
            "ok": bool(ok), "sent_by": user.get("email", "superadmin"),
        }}},
    )
    if not ok:
        raise HTTPException(status_code=502, detail="E-mail kon niet verstuurd worden (SMTP faalde)")
    return {"ok": True, "sent_to": to}


# =====================================================================
# Betaal-herinneringen — 3 dagen na vervaldatum
# =====================================================================


async def check_invoice_reminders() -> list[dict]:
    """Stuur herinnering naar bedrijven van wie een factuur >=3 dagen
    vervallen is. Idempotent via `sent_invoice_reminders` collectie (dedup
    per (invoice_id, days_bucket) — één herinnering per drempel-passage)."""
    db = _deps.db
    if db is None or _deps.saas_email is None:
        return []
    now = _deps.now_utc()
    threshold = now - timedelta(days=3)
    sent: list[dict] = []

    cursor = db.subscription_invoices.find({
        "status": {"$in": ["open", "overdue"]},
    }, {"_id": 0})
    async for inv in cursor:
        due_raw = inv.get("due_date")
        due_display = None
        try:
            if due_raw:
                due_day = datetime.fromisoformat(str(due_raw)[:10]).date()
                due_display = due_day
                pe = datetime.combine(due_day + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)
            else:
                pe_raw = inv.get("period_end")
                if not pe_raw:
                    continue
                pe = datetime.fromisoformat(str(pe_raw).replace("Z", "+00:00"))
                if pe.tzinfo is None:
                    pe = pe.replace(tzinfo=timezone.utc)
                due_display = pe.date()
        except (TypeError, ValueError):
            continue
        if pe <= now and inv.get("status") == "open":
            await db.subscription_invoices.update_one(
                {"id": inv["id"], "status": "open"},
                {"$set": {"status": "overdue"}},
            )
            inv["status"] = "overdue"
        if pe > threshold:
            continue  # nog niet vervallen genoeg

        # Alleen 1 herinnering per factuur (voor nu)
        marker = await db.sent_invoice_reminders.find_one({"invoice_id": inv["id"]}, {"_id": 0})
        if marker:
            continue

        c = await db.companies.find_one({"id": inv["company_id"]}, {"_id": 0})
        if not c or not c.get("owner_email"):
            continue

        days_overdue = max(1, int((now - pe).total_seconds() // 86400))
        subject = f"Herinnering: factuur {days_overdue} dagen vervallen"
        body_html = (
            f"<p>Beste {c.get('owner_name') or 'beheerder'},</p>"
            f"<p>Uw SaaS-factuur voor <strong>{c.get('name', '')}</strong> is "
            f"<strong>{days_overdue} dagen vervallen</strong>.</p>"
            f"<p>Bedrag: <strong>{inv.get('currency', 'SRD')} "
            f"{float(inv.get('amount') or 0):.2f}</strong><br/>"
            f"Vervaldatum: {(due_display or pe.date()).strftime('%d-%m-%Y')}</p>"
            f"<p>Gelieve dit bedrag zo spoedig mogelijk te voldoen om onderbreking "
            f"te voorkomen.</p>"
            f"<p>Met vriendelijke groet,<br/>Het SuriRent team</p>"
        )
        # Attach PDF factuur automatisch mee.
        try:
            saas = await db.saas_settings.find_one({"id": "_saas_settings"}, {"_id": 0}) or {}
            from pdf_gen import saas_invoice_pdf
            pdf_bytes = saas_invoice_pdf(inv, c, saas.get("company_info") if saas else None)
            attachments = [(f"factuur-{inv['id'][:8].upper()}.pdf", pdf_bytes, "application/pdf")]
        except Exception:
            attachments = None

        ok = await _deps.saas_email(
            to_email=c["owner_email"], subject=subject, body_html=body_html,
            attachments=attachments,
        )
        await db.sent_invoice_reminders.insert_one({
            "invoice_id": inv["id"],
            "company_id": c["id"],
            "company_name": c.get("name", ""),
            "owner_email": c["owner_email"],
            "days_overdue": days_overdue,
            "sent_at": _deps.iso(now),
            "sent_ok": bool(ok),
        })
        # Markeer factuur als overdue (voor UI)
        if inv.get("status") == "open":
            await db.subscription_invoices.update_one(
                {"id": inv["id"]},
                {"$set": {"status": "overdue"}},
            )
        sent.append({
            "invoice_id": inv["id"], "company_name": c.get("name", ""),
            "owner_email": c["owner_email"], "days_overdue": days_overdue,
            "sent_ok": bool(ok),
        })
    return sent


@router.post("/superadmin/invoice-reminders/run")
async def run_invoice_reminders(user: dict = Depends(_superadmin)):
    sent = await check_invoice_reminders()
    return {"ok": True, "count": len(sent), "sent": sent}
