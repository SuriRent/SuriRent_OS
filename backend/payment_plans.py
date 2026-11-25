"""Payment Plans (Betalingsregelingen) — admin creates a multi-installment
plan for a tenant who has overdue invoices, tenant pays per termijn via
operator kiosk or huurder kiosk. We register this as a separate FastAPI
router and mount it from server.py.

Data model:
  payment_plans:
    id, company_id, tenant_id, tenant_name (snapshot),
    invoice_ids[], total_amount, currency,
    notes, status: 'active'|'completed'|'cancelled',
    created_by, created_at, completed_at, cancelled_at

  payment_plan_installments:
    id, plan_id, sequence (1-based), due_date (yyyy-mm-dd), amount,
    status: 'pending'|'paid'|'cancelled', paid_at, payment_id

Termijn-betaling registreert een normale Payment doc met category=
'betalingsregeling' + metadata.plan_id + metadata.installment_seq.
"""
import asyncio
import logging
import math
import secrets
from typing import List, Optional, Literal
from datetime import datetime, date as date_t, timedelta
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sms_payment_attempts import PaymentAttemptConflict
from tenant_payment_guard import acquire_payment_guard, release_payment_guard


async def guarded_plan_change(db, *, company_id, tenant_id, plan_id, change):
    owner = secrets.token_urlsafe(24)
    try:
        await acquire_payment_guard(
            db, company_id=company_id, tenant_id=tenant_id, kind="legacy", owner=owner,
            operation="payment_plan_change", operation_id=plan_id,
        )
    except PaymentAttemptConflict as exc:
        raise HTTPException(status_code=409, detail="Een andere betaling voor deze huurder wordt verwerkt.") from exc
    try:
        result = await change()
        await release_payment_guard(db, company_id=company_id, tenant_id=tenant_id, kind="legacy", owner=owner)
    except Exception as exc:
        logging.getLogger(__name__).exception("Payment plan change requires review: %s", plan_id)
        raise HTTPException(
            status_code=500, detail="De regeling is mogelijk gedeeltelijk gewijzigd. Controleer deze voordat u opnieuw probeert.",
        ) from exc
    if isinstance(result, HTTPException):
        raise result
    return result


def make_router(db, helpers):
    """Return APIRouter wired to a Motor DB + helper functions imported
    from server.py. We pass helpers as a dict so we don't depend on
    circular imports.
    """
    new_id = helpers["new_id"]
    iso = helpers["iso"]
    now_utc = helpers["now_utc"]
    scope = helpers["scope"]
    company_id_of = helpers["company_id_of"]
    get_current_user = helpers["get_current_user"]
    require_role = helpers["require_role"]

    router = APIRouter(prefix="/payment-plans", tags=["payment-plans"])

    # ---------- Pydantic schemas ----------
    class InstallmentIn(BaseModel):
        sequence: int = Field(ge=1)
        due_date: str  # yyyy-mm-dd
        amount: float = Field(gt=0)

    class PlanCreateIn(BaseModel):
        tenant_id: str
        invoice_ids: List[str] = Field(default_factory=list)
        total_amount: float = Field(gt=0)
        currency: str
        notes: Optional[str] = ""
        # Generator: óf installments expliciet meegeven (custom dates) óf
        # num_installments + start_date + frequency='monthly' (automatisch).
        installments: Optional[List[InstallmentIn]] = None
        num_installments: Optional[int] = None
        start_date: Optional[str] = None  # yyyy-mm-dd
        frequency: Optional[Literal["monthly", "custom"]] = "monthly"

    class InstallmentOut(BaseModel):
        sequence: int
        due_date: str
        amount: float
        status: str
        paid_at: Optional[str] = None
        payment_id: Optional[str] = None

    class PlanOut(BaseModel):
        id: str
        tenant_id: str
        tenant_name: Optional[str] = ""
        apartment_number: Optional[str] = ""
        invoice_ids: List[str] = []
        total_amount: float
        paid_amount: float = 0
        remaining_amount: float = 0
        currency: str
        status: str
        notes: Optional[str] = ""
        created_at: str
        completed_at: Optional[str] = None
        cancelled_at: Optional[str] = None
        installments: List[InstallmentOut] = []
        # Quick computed flags
        next_due_date: Optional[str] = None
        next_due_amount: Optional[float] = None
        overdue_count: int = 0
        # True wanneer de linked invoice minder open heeft dan de som van
        # openstaande termijnen — dan is remaining_amount al bijgesteld en
        # is next_due_amount evt. lager dan het geplande termijnbedrag.
        overpayment_adjustment: bool = False
        linked_invoice_open: Optional[float] = None

    class PaidIn(BaseModel):
        method: Literal["contant", "bank"] = "contant"
        note: Optional[str] = ""
        # Bedrag is optioneel — als leeg gebruiken we het installment-bedrag.
        amount: Optional[float] = None

    # ---------- Helpers ----------
    def _add_months(d: date_t, months: int) -> date_t:
        # Eenvoudige maand-optelling met clip naar 28/29/30 wanneer doel
        # maand minder dagen heeft.
        y = d.year + (d.month - 1 + months) // 12
        m = (d.month - 1 + months) % 12 + 1
        last_day = [31, 29 if (y % 4 == 0 and (y % 100 != 0 or y % 400 == 0)) else 28,
                    31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]
        day = min(d.day, last_day)
        return date_t(y, m, day)

    def _round2(x: float) -> float:
        return round(float(x) + 1e-9, 2)

    async def _linked_invoice_open_sum(invoice_ids: list) -> float:
        """Som van openstaande (nog niet betaalde) bedragen op de gekoppelde
        facturen. Wordt gebruikt om plan.remaining_amount + next_due te
        cappen zodat de regeling nooit meer laat betalen dan er nog echt
        openstaat op de factuur (bv. wanneer buiten de regeling om al een
        extra deelbetaling is geregistreerd).
        """
        if not invoice_ids:
            return 0.0
        total = 0.0
        async for inv in db.invoices.find(
            {"id": {"$in": list(invoice_ids)}},
            {"_id": 0, "amount": 1, "paid_amount": 1},
        ):
            amt = float(inv.get("amount") or 0)
            paid = float(inv.get("paid_amount") or 0)
            total += max(0.0, amt - paid)
        return round(total + 1e-9, 2)

    async def _prefetch_plans(plans: list) -> dict:
        """Batch-data voor _enrich_plan zodat een lijst geen N+1 queries doet."""
        tids = list({p["tenant_id"] for p in plans if p.get("tenant_id")})
        pids = [p["id"] for p in plans]
        iids = list({i for p in plans for i in (p.get("invoice_ids") or [])})
        tenants, insts, invs = await asyncio.gather(
            db.tenants.find({"id": {"$in": tids}}, {"_id": 0, "id": 1, "name": 1, "apartment_id": 1}).to_list(None),
            db.payment_plan_installments.find({"plan_id": {"$in": pids}}, {"_id": 0}).sort("sequence", 1).to_list(None),
            db.invoices.find({"id": {"$in": iids}}, {"_id": 0, "id": 1, "amount": 1, "paid_amount": 1}).to_list(None),
        )
        aids = list({t["apartment_id"] for t in tenants if t.get("apartment_id")})
        apts = await db.apartments.find({"id": {"$in": aids}}, {"_id": 0, "id": 1, "number": 1}).to_list(None)
        by_plan: dict = {}
        for it in insts:
            by_plan.setdefault(it["plan_id"], []).append(it)
        return {"t": {t["id"]: t for t in tenants}, "a": {a["id"]: a for a in apts},
                "inst": by_plan, "inv": {i["id"]: i for i in invs}}

    async def _enrich_plan(plan: dict, pre: Optional[dict] = None) -> dict:
        # tenant + apartment naam ophalen voor UI gemak.
        tenant_name = plan.get("tenant_name") or ""
        apt_number = plan.get("apartment_number") or ""
        if plan.get("tenant_id") and not tenant_name:
            if pre is not None:
                t = pre["t"].get(plan["tenant_id"])
            else:
                t = await db.tenants.find_one({"id": plan["tenant_id"]}, {"_id": 0, "name": 1, "apartment_id": 1})
            if t:
                tenant_name = t.get("name") or ""
                if t.get("apartment_id"):
                    if pre is not None:
                        a = pre["a"].get(t["apartment_id"])
                    else:
                        a = await db.apartments.find_one({"id": t["apartment_id"]}, {"_id": 0, "number": 1})
                    if a:
                        apt_number = a.get("number") or ""
        installments = []
        if pre is not None:
            raw_insts = pre["inst"].get(plan["id"], [])
        else:
            raw_insts = await db.payment_plan_installments.find(
                {"plan_id": plan["id"]}, {"_id": 0}).sort("sequence", 1).to_list(None)
        for inst in raw_insts:
            installments.append({
                "sequence": inst.get("sequence"),
                "due_date": inst.get("due_date"),
                "amount": _round2(inst.get("amount", 0)),
                "status": inst.get("status", "pending"),
                "paid_at": inst.get("paid_at"),
                "payment_id": inst.get("payment_id"),
            })
        paid_amount = sum(i["amount"] for i in installments if i["status"] == "paid")
        installments_remaining = _round2(plan.get("total_amount", 0) - paid_amount)
        # Cap tegen wat er ECHT nog open staat op de gekoppelde factuur.
        if pre is not None:
            invoice_open = round(sum(max(0.0, float(i.get("amount") or 0) - float(i.get("paid_amount") or 0))
                                     for i in (pre["inv"].get(x) for x in set(plan.get("invoice_ids") or [])) if i) + 1e-9, 2)
        else:
            invoice_open = await _linked_invoice_open_sum(plan.get("invoice_ids") or [])
        # Als de plan-restant groter is dan wat er nog openstaat op de
        # factuur (bijv. omdat er buiten de regeling om al een deelbetaling
        # is gedaan), dan is de "echte" restant het factuur-openstaande.
        if plan.get("invoice_ids"):
            remaining = min(installments_remaining, invoice_open)
        else:
            remaining = installments_remaining
        remaining = _round2(remaining)
        overpayment_adjustment = _round2(installments_remaining - remaining) > 0.01
        # Next due + overdue count
        today = now_utc().date().isoformat()
        next_due = None
        next_due_amt = None
        overdue_count = 0
        for i in installments:
            if i["status"] != "pending":
                continue
            if i["due_date"] < today:
                overdue_count += 1
            if next_due is None:
                next_due = i["due_date"]
                # Cap volgende termijn-bedrag ook aan wat er nog echt open
                # staat op de factuur — zodat de UI en Markeer-betaald-flow
                # niet meer suggereren dan werkelijk verschuldigd is.
                if plan.get("invoice_ids"):
                    next_due_amt = _round2(min(i["amount"], max(0.0, remaining)))
                else:
                    next_due_amt = i["amount"]
        return {
            "id": plan["id"],
            "tenant_id": plan["tenant_id"],
            "tenant_name": tenant_name,
            "apartment_number": apt_number,
            "invoice_ids": plan.get("invoice_ids") or [],
            "total_amount": _round2(plan.get("total_amount", 0)),
            "paid_amount": _round2(paid_amount),
            "remaining_amount": remaining,
            "currency": plan.get("currency", "SRD"),
            "status": plan.get("status", "active"),
            "notes": plan.get("notes") or "",
            "created_at": plan.get("created_at"),
            "completed_at": plan.get("completed_at"),
            "cancelled_at": plan.get("cancelled_at"),
            "installments": installments,
            "next_due_date": next_due,
            "next_due_amount": next_due_amt,
            "overdue_count": overdue_count,
            "overpayment_adjustment": overpayment_adjustment,
            "linked_invoice_open": invoice_open,
        }

    # ---------- Endpoints ----------
    @router.post("", response_model=PlanOut)
    async def create_plan(body: PlanCreateIn, user=Depends(require_role("admin"))):
        cid = company_id_of(user)
        if not cid:
            raise HTTPException(status_code=400, detail="Geen bedrijfscontext")

        # Tenant validate
        tenant = await db.tenants.find_one({"id": body.tenant_id, "company_id": cid}, {"_id": 0})
        if not tenant:
            raise HTTPException(status_code=404, detail="Huurder niet gevonden")

        # Build installments
        installments: list = []
        if body.installments:
            # Custom — gebruiker bepaalt zelf data + bedragen
            for it in sorted(body.installments, key=lambda x: x.sequence):
                installments.append({
                    "sequence": it.sequence,
                    "due_date": it.due_date,
                    "amount": _round2(it.amount),
                    "status": "pending",
                })
        else:
            n = int(body.num_installments or 0)
            if n < 2:
                raise HTTPException(status_code=400, detail="Minimaal 2 termijnen of geef installments mee")
            start = body.start_date or now_utc().date().isoformat()
            try:
                start_d = date_t.fromisoformat(start)
            except ValueError:
                raise HTTPException(status_code=400, detail="Ongeldige startdatum (yyyy-mm-dd)")
            per = _round2(body.total_amount / n)
            # Laatste termijn vangt eventueel afrondingsverschil op
            running = 0.0
            for i in range(n):
                due = _add_months(start_d, i) if body.frequency == "monthly" else start_d + timedelta(days=30 * i)
                amt = per if i < n - 1 else _round2(body.total_amount - running)
                running += per
                installments.append({
                    "sequence": i + 1,
                    "due_date": due.isoformat(),
                    "amount": amt,
                    "status": "pending",
                })

        # Bedragen-totaal validate
        total_inst = _round2(sum(i["amount"] for i in installments))
        if abs(total_inst - _round2(body.total_amount)) > 0.05:
            raise HTTPException(status_code=400, detail=f"Som van termijnen ({total_inst}) komt niet overeen met totaal ({body.total_amount})")

        plan_id = new_id()
        now_iso = iso(now_utc())
        plan_doc = {
            "id": plan_id,
            "company_id": cid,
            "tenant_id": body.tenant_id,
            "tenant_name": tenant.get("name") or "",
            "invoice_ids": body.invoice_ids,
            "total_amount": _round2(body.total_amount),
            "currency": body.currency,
            "notes": body.notes or "",
            "status": "active",
            "created_by": user.get("id"),
            "created_at": now_iso,
        }
        async def create():
            await db.payment_plans.insert_one({**plan_doc})
            for it in installments:
                await db.payment_plan_installments.insert_one({
                    "id": new_id(), "plan_id": plan_id, "company_id": cid, **it,
                })

        await guarded_plan_change(db, company_id=cid, tenant_id=body.tenant_id, plan_id=plan_id, change=create)
        try:
            from routes import _deps as _pd
            await _pd.notify_kiosk_employees(
                cid, "Nieuwe betalingsregeling",
                f"{plan_doc['tenant_name'] or 'Huurder'} — {plan_doc['currency']} {plan_doc['total_amount']:,.2f}",
                {"kind": "payment_plan"}, "plans")
        except Exception as e:  # noqa: BLE001
            print(f"[push] plan employee notify failed: {e}")
        return await _enrich_plan(plan_doc)

    @router.get("", response_model=List[PlanOut])
    async def list_plans(status: Optional[str] = None, tenant_id: Optional[str] = None,
                         user=Depends(get_current_user)):
        q = {**scope(user)}
        if status:
            q["status"] = status
        if tenant_id:
            q["tenant_id"] = tenant_id
        plans = await db.payment_plans.find(q, {"_id": 0}).sort("created_at", -1).to_list(2000)
        pre = await _prefetch_plans(plans)
        return [await _enrich_plan(p, pre) for p in plans]

    @router.get("/{plan_id}", response_model=PlanOut)
    async def get_plan(plan_id: str, user=Depends(get_current_user)):
        p = await db.payment_plans.find_one({"id": plan_id, **scope(user)}, {"_id": 0})
        if not p:
            raise HTTPException(status_code=404, detail="Regeling niet gevonden")
        return await _enrich_plan(p)

    @router.post("/{plan_id}/cancel", response_model=PlanOut)
    async def cancel_plan(plan_id: str, user=Depends(require_role("admin"))):
        p = await db.payment_plans.find_one({"id": plan_id, **scope(user)}, {"_id": 0})
        if not p:
            raise HTTPException(status_code=404, detail="Regeling niet gevonden")
        cid, tenant_id = p.get("company_id"), p.get("tenant_id")
        if not cid or not tenant_id:
            raise HTTPException(status_code=409, detail="Regelingsgegevens zijn onvolledig")

        async def cancel():
            current = await db.payment_plans.find_one(
                {"id": plan_id, "company_id": cid, "tenant_id": tenant_id}, {"_id": 0},
            )
            if not current:
                return HTTPException(status_code=404, detail="Regeling niet gevonden")
            if current.get("status") != "active":
                return HTTPException(status_code=400, detail="Regeling is niet actief")
            updated = await db.payment_plans.update_one(
                {"id": plan_id, "company_id": cid, "tenant_id": tenant_id, "status": "active"},
                {"$set": {"status": "cancelled", "cancelled_at": iso(now_utc())}},
            )
            if updated.matched_count != 1:
                raise RuntimeError("Regeling is tijdens het annuleren gewijzigd")
            await db.payment_plan_installments.update_many(
                {"plan_id": plan_id, "company_id": cid, "status": "pending"},
                {"$set": {"status": "cancelled"}},
            )
            return await db.payment_plans.find_one({"id": plan_id, "company_id": cid}, {"_id": 0})

        p = await guarded_plan_change(db, company_id=cid, tenant_id=tenant_id, plan_id=plan_id, change=cancel)
        return await _enrich_plan(p)

    # Stand-alone core (gedeeld met tenant-portal & kiosk via server.py)
    core = _build_pay_core(db, helpers)
    _enrich_plan = core["enrich_plan"]  # noqa: F811 — vervangt lokaal _enrich_plan

    @router.post("/{plan_id}/installments/{seq}/pay", response_model=PlanOut)
    async def pay_installment(plan_id: str, seq: int, body: PaidIn,
                              user=Depends(require_role("admin"))):
        plan = await db.payment_plans.find_one({"id": plan_id, **scope(user)}, {"_id": 0})
        if not plan:
            raise HTTPException(status_code=404, detail="Regeling niet gevonden")
        return await core["pay_installment_for"](
            plan, seq,
            method=body.method, amount=body.amount, note=body.note or "",
            received_by=user.get("name") or "",
            approved_by_label=user.get("name") or "",
            status="approved",
        )

    return router


def _build_pay_core(db, helpers):
    """Stand-alone helper builder — returned by `make_payment_plan_helpers`
    zodat server.py een gedeelde core kan hergebruiken voor tenant-portal en
    kiosk endpoints zonder dat we de admin-route deps verstoren.
    """
    new_id = helpers["new_id"]
    iso = helpers["iso"]
    now_utc = helpers["now_utc"]
    next_receipt_number = helpers["next_receipt_number"]
    # Optioneel: allocator-callback om termijnbetaling op de gelinkte
    # facturen toe te passen. Server.py geeft `_allocate_payment_to_invoices`
    # door bij init zodat partial-betalingen ook hier de factuur bijwerken.
    allocate_to_invoices = helpers.get("allocate_to_invoices")
    notify_tenant_paid = helpers.get("notify_tenant_paid")

    def _round2(x): return round(float(x) + 1e-9, 2)

    async def _linked_invoice_open_sum(invoice_ids: list) -> float:
        if not invoice_ids:
            return 0.0
        total = 0.0
        async for inv in db.invoices.find(
            {"id": {"$in": list(invoice_ids)}},
            {"_id": 0, "amount": 1, "paid_amount": 1},
        ):
            amt = float(inv.get("amount") or 0)
            paid = float(inv.get("paid_amount") or 0)
            total += max(0.0, amt - paid)
        return round(total + 1e-9, 2)

    async def enrich_plan(plan: dict, pre: Optional[dict] = None) -> dict:
        # `pre` = batch-data uit _prefetch_plans (lijst-endpoint, geen N+1).
        tenant_name = plan.get("tenant_name") or ""
        apt_number = ""
        if pre is not None:
            t = pre["t"].get(plan.get("tenant_id"))
        else:
            t = await db.tenants.find_one(
                {"id": plan.get("tenant_id")}, {"_id": 0, "name": 1, "apartment_id": 1}
            ) if plan.get("tenant_id") else None
        if t:
            tenant_name = tenant_name or (t.get("name") or "")
            if t.get("apartment_id"):
                if pre is not None:
                    a = pre["a"].get(t["apartment_id"])
                else:
                    a = await db.apartments.find_one({"id": t["apartment_id"]}, {"_id": 0, "number": 1})
                if a:
                    apt_number = a.get("number") or ""
        installments = []
        if pre is not None:
            raw_insts = pre["inst"].get(plan["id"], [])
        else:
            raw_insts = await db.payment_plan_installments.find(
                {"plan_id": plan["id"]}, {"_id": 0}).sort("sequence", 1).to_list(None)
        for inst in raw_insts:
            installments.append({
                "sequence": inst.get("sequence"),
                "due_date": inst.get("due_date"),
                "amount": _round2(inst.get("amount", 0)),
                "status": inst.get("status", "pending"),
                "paid_at": inst.get("paid_at"),
                "payment_id": inst.get("payment_id"),
            })
        paid_amount = sum(i["amount"] for i in installments if i["status"] == "paid")
        installments_remaining = _round2(plan.get("total_amount", 0) - paid_amount)
        if pre is not None:
            invoice_open = round(sum(max(0.0, float(i.get("amount") or 0) - float(i.get("paid_amount") or 0))
                                     for i in (pre["inv"].get(x) for x in set(plan.get("invoice_ids") or [])) if i) + 1e-9, 2)
        else:
            invoice_open = await _linked_invoice_open_sum(plan.get("invoice_ids") or [])
        if plan.get("invoice_ids"):
            remaining = _round2(min(installments_remaining, invoice_open))
        else:
            remaining = installments_remaining
        overpayment_adjustment = _round2(installments_remaining - remaining) > 0.01
        today = now_utc().date().isoformat()
        next_due, next_due_amt, overdue_count = None, None, 0
        for i in installments:
            if i["status"] != "pending":
                continue
            if i["due_date"] < today:
                overdue_count += 1
            if next_due is None:
                next_due = i["due_date"]
                if plan.get("invoice_ids"):
                    next_due_amt = _round2(min(i["amount"], max(0.0, remaining)))
                else:
                    next_due_amt = i["amount"]
        return {
            "id": plan["id"],
            "tenant_id": plan["tenant_id"],
            "tenant_name": tenant_name,
            "apartment_number": apt_number,
            "invoice_ids": plan.get("invoice_ids") or [],
            "total_amount": _round2(plan.get("total_amount", 0)),
            "paid_amount": _round2(paid_amount),
            "remaining_amount": remaining,
            "currency": plan.get("currency", "SRD"),
            "status": plan.get("status", "active"),
            "notes": plan.get("notes") or "",
            "created_at": plan.get("created_at"),
            "completed_at": plan.get("completed_at"),
            "cancelled_at": plan.get("cancelled_at"),
            "installments": installments,
            "next_due_date": next_due,
            "next_due_amount": next_due_amt,
            "overdue_count": overdue_count,
            "overpayment_adjustment": overpayment_adjustment,
            "linked_invoice_open": invoice_open,
        }

    async def pay_installment_for(
        plan: dict, seq: int,
        *, method: str = "contant", amount=None, note: str = "",
        stripe_payment_intent_id: Optional[str] = None,
        mope_payment_request_id: Optional[str] = None,
        received_by: str = "", approved_by_label: str = "",
        status: str = "approved", kiosk_employee_id=None, kiosk_employee_name=None,
        consume_provider=None,
    ) -> dict:
        cid, tenant_id = plan.get("company_id"), plan.get("tenant_id")
        if not all(isinstance(value, str) and value for value in (cid, tenant_id, plan.get("id"))):
            raise HTTPException(status_code=409, detail="Regelingsgegevens zijn onvolledig; controleer de regeling.")
        provider = "stripe" if stripe_payment_intent_id else ("mope" if mope_payment_request_id else None)
        reference = stripe_payment_intent_id or mope_payment_request_id or None
        payment_id, owner = new_id(), secrets.token_urlsafe(24)
        try:
            await acquire_payment_guard(
                db, company_id=cid, tenant_id=tenant_id, kind="legacy", owner=owner,
                operation="installment_payment", operation_id=payment_id,
                provider=provider, provider_reference=reference,
            )
        except PaymentAttemptConflict as exc:
            raise HTTPException(status_code=409, detail="Een andere betaling voor deze huurder wordt verwerkt.") from exc
        try:
            result = await _pay_installment_locked(
                plan["id"], cid, tenant_id, seq, payment_id=payment_id,
                method=method, amount=amount, note=note,
                stripe_payment_intent_id=stripe_payment_intent_id,
                mope_payment_request_id=mope_payment_request_id,
                received_by=received_by, approved_by_label=approved_by_label, status=status,
                kiosk_employee_id=kiosk_employee_id, kiosk_employee_name=kiosk_employee_name,
                consume_provider=consume_provider,
            )
            await release_payment_guard(db, company_id=cid, tenant_id=tenant_id, kind="legacy", owner=owner)
        except Exception as exc:
            logging.getLogger(__name__).exception("Installment payment requires review: %s", payment_id)
            raise HTTPException(
                status_code=500,
                detail="De termijnbetaling is mogelijk gedeeltelijk verwerkt. Controleer deze voordat u opnieuw boekt.",
            ) from exc
        if isinstance(result, HTTPException):
            raise result
        if status == "approved" and notify_tenant_paid:
            asyncio.create_task(notify_tenant_paid(plan["id"], seq))
        return result

    async def _pay_installment_locked(
        plan_id: str, cid: str, tenant_id: str, seq: int, *, payment_id: str,
        method: str, amount, note: str, stripe_payment_intent_id: Optional[str],
        mope_payment_request_id: Optional[str], received_by: str, approved_by_label: str,
        status: str, kiosk_employee_id, kiosk_employee_name, consume_provider,
    ):
        plan = await db.payment_plans.find_one(
            {"id": plan_id, "company_id": cid, "tenant_id": tenant_id}, {"_id": 0},
        )
        if not plan:
            return HTTPException(status_code=404, detail="Regeling niet gevonden")
        if plan.get("status") != "active":
            return HTTPException(status_code=400, detail="Regeling is niet actief")
        inst = await db.payment_plan_installments.find_one(
            {"plan_id": plan_id, "company_id": cid, "sequence": seq}, {"_id": 0}
        )
        if not inst:
            return HTTPException(status_code=404, detail="Termijn niet gevonden")
        if inst.get("status") != "pending":
            return HTTPException(status_code=409, detail="Termijn is al betaald of wordt verwerkt")

        # Cap het bedrag aan wat er nog ECHT openstaat op de gekoppelde
        # facturen. Voorkomt over-betaling wanneer buiten de regeling om al
        # een deelbetaling is gedaan.
        try:
            raw_amt = _round2(amount if amount is not None else inst["amount"])
        except (TypeError, ValueError, OverflowError):
            return HTTPException(status_code=400, detail="Ongeldig termijnbedrag")
        if not math.isfinite(raw_amt) or raw_amt <= 0:
            return HTTPException(status_code=400, detail="Ongeldig termijnbedrag")
        invoice_open = 0.0
        if plan.get("invoice_ids"):
            ids = plan["invoice_ids"]
            if not isinstance(ids, list) or not all(isinstance(i, str) and i for i in ids) or len(set(ids)) != len(ids):
                return HTTPException(status_code=409, detail="Facturen in de regeling zijn ongeldig")
            invoices = await db.invoices.find(
                {"id": {"$in": ids}, "company_id": cid, "tenant_id": tenant_id}, {"_id": 0},
            ).to_list(None)
            if len(invoices) != len(ids) or any(
                inv.get("status") in ("cancelled", "archived") or inv.get("archived") is True
                or (inv.get("currency") or "SRD") != (plan.get("currency") or "SRD")
                for inv in invoices
            ):
                return HTTPException(status_code=409, detail="Gekoppelde facturen moeten eerst worden gecontroleerd")
            if not allocate_to_invoices:
                return HTTPException(status_code=409, detail="Factuurallocatie is niet beschikbaar")
            invoice_open = 0.0
            for inv in invoices:
                paid_value = inv.get("paid_amount")
                if paid_value is None:
                    if inv.get("status") != "open":
                        return HTTPException(status_code=409, detail="Factuursaldo moet eerst worden gecontroleerd")
                    for field in ("invoice_id", "invoice_ids", "allocations.invoice_id"):
                        if await db.payments.find_one({"status": "approved", field: inv["id"]}, {"_id": 0, "id": 1}):
                            return HTTPException(status_code=409, detail="Factuursaldo moet eerst worden gecontroleerd")
                    paid_value = 0
                try:
                    total, paid = float(inv["amount"]), float(paid_value)
                except (KeyError, TypeError, ValueError, OverflowError):
                    return HTTPException(status_code=409, detail="Factuursaldo moet eerst worden gecontroleerd")
                if (not math.isfinite(total) or not math.isfinite(paid) or total < 0 or paid < 0
                        or paid > total or (inv.get("status") == "paid" and paid != total)):
                    return HTTPException(status_code=409, detail="Factuursaldo moet eerst worden gecontroleerd")
                invoice_open += total - paid
            invoice_open = round(invoice_open, 2)
            if invoice_open <= 0.01:
                return HTTPException(
                    status_code=400,
                    detail="Gekoppelde factuur is al volledig betaald — regeling wordt afgesloten.",
                )
            amt = _round2(min(raw_amt, invoice_open))
        else:
            amt = raw_amt
        if consume_provider:
            await consume_provider(amt, plan.get("currency") or "SRD")
        receipt = await next_receipt_number()
        company = await db.companies.find_one({"id": cid}, {"_id": 0, "name": 1}) or {}
        tenant = await db.tenants.find_one(
            {"id": plan["tenant_id"]}, {"_id": 0, "name": 1, "apartment_id": 1}
        ) or {}
        now_iso = iso(now_utc())
        payment_doc = {
            "id": payment_id,
            "company_id": cid,
            "tenant_id": plan["tenant_id"],
            "apartment_id": tenant.get("apartment_id"),
            "amount": amt,
            "currency": plan.get("currency", "SRD"),
            "category": "betalingsregeling",
            "method": method,
            "stripe_payment_intent_id": stripe_payment_intent_id,
            "mope_payment_request_id": mope_payment_request_id,
            "status": status,  # approved by default; kiosk-pending-flow can pass 'pending_approval'
            "paid_at": now_iso,
            "receipt_number": receipt,
            "note": (note or "") + f" — Betalingsregeling termijn {seq}/{plan['id'][:8]}",
            "approved_by": approved_by_label or company.get("name") or "Beheerder",
            "received_by": received_by or tenant.get("name") or "",
            "kiosk_employee_id": kiosk_employee_id,
            "kiosk_employee_name": kiosk_employee_name,
            "metadata": {
                "plan_id": plan["id"],
                "installment_seq": seq,
            },
        }
        await db.payments.insert_one({**payment_doc})

        # Only mark as paid when status is approved. For pending_approval we
        # still mark it as paid because the installment is tied to the
        # specific payment_id — admin's approval/decline will update both.
        inst_update = {
            "status": "paid" if status == "approved" else "pending_payment",
            "paid_at": now_iso,
            "payment_id": payment_doc["id"],
        }
        # Als het termijnbedrag naar beneden bijgesteld is (want factuur
        # heeft minder open dan gepland), leggen we dat vast zodat de UI
        # en historie correct blijven. Overschrijf `original_amount` niet
        # als redistributie dat al gezet heeft.
        if _round2(amt) != _round2(inst.get("amount") or 0):
            inst_update["amount"] = amt
            if inst.get("original_amount") is None:
                inst_update["original_amount"] = _round2(inst.get("amount") or 0)
        claimed = await db.payment_plan_installments.update_one(
            {"plan_id": plan["id"], "company_id": cid, "sequence": seq, "status": "pending"},
            {"$set": inst_update},
        )
        if claimed.matched_count != 1:
            raise RuntimeError("Termijn is tijdens de betaling gewijzigd")

        if status == "approved":
            # Termijnbetaling alloceren op de gelinkte facturen (FIFO).
            if allocate_to_invoices and plan.get("invoice_ids"):
                allocated = await allocate_to_invoices(
                    plan.get("invoice_ids") or [], amt,
                    payment_id=payment_doc["id"], paid_at=now_iso,
                    method=method, receipt_number=receipt, strict=True,
                )
                if abs(allocated - amt) > 0.005:
                    raise RuntimeError("Termijnbetaling is niet volledig aan facturen toegewezen")
            # Als de factuur na deze betaling volledig gedekt is, cancel
            # eventuele nog openstaande termijnen — anders blijft de UI
            # "Markeer betaald" tonen terwijl er niets meer verschuldigd is.
            new_invoice_open = 0.0
            if plan.get("invoice_ids"):
                new_invoice_open = await _linked_invoice_open_sum(
                    plan.get("invoice_ids") or [],
                )
            if new_invoice_open <= 0.01 and plan.get("invoice_ids"):
                await db.payment_plan_installments.update_many(
                    {"plan_id": plan["id"], "status": "pending"},
                    {"$set": {"status": "cancelled", "cancelled_at": now_iso,
                              "cancelled_reason": "invoice_fully_paid"}},
                )
            remaining_pending = await db.payment_plan_installments.count_documents(
                {"plan_id": plan["id"], "status": {"$in": ["pending"]}}
            )
            if remaining_pending == 0:
                completed = await db.payment_plans.update_one(
                    {"id": plan["id"], "company_id": cid, "tenant_id": tenant_id, "status": "active"},
                    {"$set": {"status": "completed", "completed_at": now_iso}},
                )
                if completed.matched_count != 1:
                    already_completed = await db.payment_plans.find_one({
                        "id": plan["id"], "company_id": cid, "tenant_id": tenant_id, "status": "completed",
                    })
                    if not already_completed:
                        raise RuntimeError("Regeling kon niet worden afgerond")

        p = await db.payment_plans.find_one({"id": plan["id"]}, {"_id": 0})
        return await enrich_plan(p)

    async def list_plans_for_tenant(tenant_id: str, company_id: str, status: str = "active"):
        q = {"tenant_id": tenant_id, "company_id": company_id}
        if status and status != "all":
            q["status"] = status
        out = []
        async for p in db.payment_plans.find(q, {"_id": 0}).sort("created_at", -1):
            out.append(await enrich_plan(p))
        return out

    return {
        "enrich_plan": enrich_plan,
        "pay_installment_for": pay_installment_for,
        "list_plans_for_tenant": list_plans_for_tenant,
    }
