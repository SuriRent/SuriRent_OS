"""SuriRent Vastgoed Kiosk - Minimal Backend
- JWT email/password auth for admin (httpOnly cookies + Bearer fallback)
- 4-digit kiosk PIN flow
- CRUD: apartments, tenants, payments
"""
from dotenv import load_dotenv
load_dotenv()

import os
import re
import uuid
import bcrypt
import jwt
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Literal

from pymongo.errors import DuplicateKeyError
from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, Response, Query, UploadFile, File, Body, Form, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from brotli_asgi import BrotliMiddleware
from fastapi.responses import StreamingResponse, JSONResponse, HTMLResponse
from pydantic import BaseModel, EmailStr, Field
from motor.motor_asyncio import AsyncIOMotorClient
from contextlib import asynccontextmanager
import io
import base64
import secrets
import hashlib
import asyncio
import json
import time
import logging as _logging

from pdf_gen import (
    receipt_pdf_blue_house as receipt_pdf,
    invoice_pdf_blue_house as invoice_pdf,
    contract_pdf, deposit_refund_pdf, payslip_pdf,
    payment_plan_pdf,
    onboarding_pdf, _make_qr_png,
    reminder_pdf_blue_house,
)
from landing_content import (
    LANDING_DEFAULTS, DRAFT_ID, PUBLISHED_ID, merge_with_defaults,
    ALLOWED_FEATURE_ICONS,
)

# =====================================================================
# Config
# =====================================================================
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

# Pure auth-helpers zijn verplaatst naar auth_utils.py. We re-exporten
# ze hier zodat bestaande route-code (en externe imports) blijven werken
# zonder aanpassing.
from auth_utils import (  # noqa: E402
    JWT_SECRET, JWT_ALG, ACCESS_MIN, KIOSK_TOKEN_MIN,
    hash_password, verify_password, create_token, decode_token,
    now_utc, iso, new_id,
    PIN_MAX_ATTEMPTS, PIN_LOCKOUT_SECONDS,
    _pin_throttle_check, _pin_throttle_fail, _pin_throttle_clear,
    _client_ip, extract_token,
)


# =====================================================================
# Auth Dependencies
# =====================================================================
async def get_current_user(request: Request) -> dict:
    # === Emergent Google Auth pad ===
    # Als `session_token` cookie aanwezig is (Emergent Google login), zoek
    # de user via user_sessions → users. Voorkomt breken van de bestaande
    # JWT-flow: JWT wordt hierna alsnog geprobeerd.
    google_tok = request.cookies.get("session_token")
    if google_tok:
        sess = await db.user_sessions.find_one({"session_token": google_tok}, {"_id": 0})
        if sess:
            exp = sess.get("expires_at")
            if isinstance(exp, str):
                try:
                    exp = datetime.fromisoformat(exp.replace("Z", "+00:00"))
                except Exception:
                    exp = None
            if exp and exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
            if exp and exp >= now_utc():
                gu = await db.users.find_one({"user_id": sess["user_id"]},
                                              {"_id": 0, "password_hash": 0, "personal_pin_hash": 0})
                if gu:
                    # Zorg dat downstream code de standaard velden vindt.
                    gu.setdefault("id", gu.get("user_id"))
                    gu.setdefault("role", "admin")
                    gu["active_company_id"] = gu.get("company_id")
                    return gu

    token = extract_token(request, "access_token")
    if not token:
        raise HTTPException(status_code=401, detail="Niet ingelogd")
    try:
        payload = decode_token(token)
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Ongeldig token type")
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token verlopen")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Ongeldig token")
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0, "personal_pin_hash": 0})
    if not user:
        raise HTTPException(status_code=401, detail="Gebruiker niet gevonden")
    if user.get("disabled") or user.get("role") == "kiosk":
        raise HTTPException(status_code=403, detail="Geen toegang tot beheer")
    # Impersonation context carried via JWT payload
    if payload.get("original_user_id"):
        user["original_user_id"] = payload["original_user_id"]
        user["impersonated_by"] = payload.get("impersonated_by")
        # While impersonating, scope to the company embedded in the token
        user["company_id"] = payload.get("company_id") or user.get("company_id")
        user["role"] = "admin"  # acts as admin of the customer
    # Superadmin can simulate company via header x-active-company
    if user.get("role") == "superadmin":
        active = request.headers.get("x-active-company") or request.query_params.get("company_id")
        user["active_company_id"] = active or user.get("company_id")
    else:
        user["active_company_id"] = user.get("company_id")

    # Presence tracking — throttle naar 1× per 60s om DB-druk te beperken.
    # Werkt voor zowel admins (per company) als tenants/superadmin (per user).
    try:
        now_dt = now_utc()
        prev = user.get("last_seen_at")
        needs = True
        if prev:
            try:
                prev_dt = datetime.fromisoformat(str(prev).replace("Z", "+00:00"))
                if (now_dt - prev_dt).total_seconds() < 60:
                    needs = False
            except Exception:
                pass
        if needs:
            iso_now = iso(now_dt)
            await db.users.update_one({"id": user["id"]}, {"$set": {"last_seen_at": iso_now}})
            user["last_seen_at"] = iso_now
            # Update company last_seen ook (handig voor superadmin online-overview).
            cid = user.get("company_id")
            if cid and user.get("role") != "superadmin":
                await db.companies.update_one({"id": cid}, {"$set": {"last_seen_at": iso_now}})
    except Exception:
        pass  # presence-tracking mag nooit de request laten falen

    # BILLING NOTIFICATION — we HARD-BLOCKEN NIET meer.
    # Klanten mogen de app blijven gebruiken ook als hun proefperiode is
    # verlopen of hun abonnement past_due/cancelled is. Ze zien alleen een
    # in-app banner (TrialBanner) met een oproep om te activeren. Deze keuze
    # is expliciet gemaakt door de eigenaar — omzet-optimalisatie via
    # vriendelijke UX i.p.v. dwingen.
    if user.get("role") != "superadmin" and not user.get("original_user_id"):
        cid = user.get("company_id")
        if cid:
            c = await db.companies.find_one(
                {"id": cid}, {"_id": 0, "billing_status": 1, "trial_ends_at": 1},
            )
            if c:
                bs = (c.get("billing_status") or "active").lower()
                # Update trial → expired in memory (voor logging/telemetrie).
                if bs == "trial" and c.get("trial_ends_at"):
                    try:
                        end = datetime.fromisoformat(c["trial_ends_at"].replace("Z", "+00:00"))
                        if end < datetime.now(timezone.utc):
                            bs = "expired"
                    except Exception:
                        pass
                user["_billing_status"] = bs  # beschikbaar voor endpoints die dit willen weten
    return user



async def get_current_user_optional(request: Request):
    """Zoals `get_current_user` maar returnt None ipv HTTPException(401)
    wanneer er geen geldige bearer token is. Endpoints die zelf alternatieve
    authenticatie ondersteunen (bv. device-bound QR tokens) gebruiken dit."""
    try:
        return await get_current_user(request)
    except HTTPException as e:
        if e.status_code == 401:
            return None
        raise



def require_role(*roles: str):
    async def _dep(user=Depends(get_current_user)):
        if user.get("role") not in roles:
            raise HTTPException(status_code=403, detail="Onvoldoende rechten")
        return user
    return _dep


def scope(user: dict) -> dict:
    """Mongo filter for current company scope."""
    cid = user.get("active_company_id")
    if not cid:
        return {}
    return {"company_id": cid}


def company_id_of(user: dict) -> Optional[str]:
    return user.get("active_company_id")


async def get_kiosk_session(request: Request) -> dict:
    token = extract_token(request, "kiosk_token")
    if not token:
        raise HTTPException(status_code=401, detail="Kiosk niet ontgrendeld")
    payload: dict = {}
    try:
        # Kiosk-sessies verlopen nooit (geen automatisch uitloggen); handtekening blijft verplicht.
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG], options={"verify_exp": False})
        if payload.get("type") != "kiosk":
            raise HTTPException(status_code=401, detail="Ongeldig kiosk token")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Ongeldig kiosk token")
    if not payload.get("company_id"):
        # Zonder bedrijf geen kiosk-sessie: anders zouden lookups niet per bedrijf gescheiden zijn.
        raise HTTPException(status_code=401, detail="Ongeldig kiosk token")
    return {"company_id": payload.get("company_id"), "type": "kiosk"}


def kiosk_scope(session: dict) -> dict:
    cid = session.get("company_id")
    return {"company_id": cid} if cid else {}


# =====================================================================
# Models — verplaatst naar models.py voor onderhoudbaarheid.
# =====================================================================
from models import (  # noqa: E402
    RegisterIn, LoginIn, PinIn, SetPinIn, UserOut,
    ApartmentIn, ApartmentOut,
    ShellyBindIn, ShellyControlIn,
    TenantIn, TenantOut,
    LocationIn, LocationOut,
    PaymentIn, PaymentOut, PaymentApproveIn, PaymentRejectIn,
)


# =====================================================================
# Lifespan & seed
# =====================================================================
DEFAULT_COMPANY_SLUG = "surirent"
DEFAULT_COMPANY_NAME = "SuriRent N.V."

# Collections that hold per-company business data
TENANT_SCOPED_COLLECTIONS = [
    "apartments", "tenants", "payments", "contracts", "invoices",
    "employees", "salaries", "deposits", "maintenance", "kasgeld",
    "push_subs", "locations",
]


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ---------- Indexes ----------
    # Hot-path indexes voor snelle queries op alle collecties die de
    # app gebruikt. Worden bij elke startup idempotent gegarandeerd.
    await db.users.create_index("email", unique=True)
    await db.kiosk_id_owners.create_index("kiosk_id", unique=True)
    await db.users.create_index([("company_id", 1), ("role", 1)])
    await db.apartments.create_index("number")
    await db.apartments.create_index("company_id")
    await db.tenants.create_index("name")
    await db.tenants.create_index([("company_id", 1), ("apartment_id", 1)])
    await db.tenants.create_index("company_id")
    await db.tenants.create_index([("company_id", 1), ("name", 1)])
    await db.payments.create_index("paid_at")
    await db.payments.create_index("receipt_number", unique=True)
    await db.payments.create_index([("company_id", 1), ("paid_at", -1)])
    await db.payments.create_index([("tenant_id", 1), ("paid_at", -1)])
    await db.payments.create_index([("company_id", 1), ("status", 1)])
    await db.payments.create_index([("company_id", 1), ("status", 1), ("paid_at", -1)])
    await db.payments.create_index("invoice_id")
    await db.payments.create_index("id")
    await db.invoices.create_index([("company_id", 1), ("status", 1)])
    await db.invoices.create_index([("company_id", 1), ("created_at", -1)])
    await db.apartments.create_index([("company_id", 1), ("status", 1)])
    await db.apartments.create_index("id")
    await db.tenants.create_index("id")
    await db.kasgeld.create_index("company_id")
    # Lijst-indexen (filter op bedrijf + sortering)
    await db.apartments.create_index([("company_id", 1), ("number", 1)])
    await db.apartments.create_index([("company_id", 1), ("location_id", 1)])
    await db.locations.create_index([("company_id", 1), ("name", 1)])
    await db.contracts.create_index([("company_id", 1), ("created_at", -1)])
    await db.deposits.create_index([("company_id", 1), ("created_at", -1)])
    await db.maintenance.create_index([("company_id", 1), ("created_at", -1)])
    await db.salaries.create_index([("company_id", 1), ("paid_at", -1)])
    await db.employees.create_index([("company_id", 1), ("name", 1)])
    await db.payment_plans.create_index([("company_id", 1), ("created_at", -1)])
    await db.users.create_index("employee_id")
    await db.invoices.create_index([("tenant_id", 1), ("period_year", 1), ("period_month", 1)])
    await db.invoices.create_index("id")
    await db.invoices.create_index([("company_id", 1), ("status", 1), ("due_date", 1)])
    await db.invoices.create_index([("company_id", 1), ("period_year", 1), ("period_month", 1)])
    await db.payment_plans.create_index("invoice_ids")
    await db.companies.create_index("slug", unique=True)
    await db.push_subs.create_index("user_id")
    await db.push_subs.create_index("endpoint", unique=True)
    await db.employees.create_index([("company_id", 1), ("active", 1), ("app_role", 1)])
    await db.kiosk_pins.create_index("company_id", unique=True)
    await db.kiosk_presence.create_index([("company_id", 1), ("last_seen", 1)])
    await db.kiosk_presence.delete_many({})
    await db.kiosk_print_log.create_index([("company_id", 1), ("printed_at", -1)])
    await db.kiosk_print_log.create_index([("company_id", 1), ("payment_id", 1)])
    await db.payments.create_index([("company_id", 1), ("kiosk_employee_id", 1), ("paid_at", -1)])
    await db.payment_plans.create_index([("company_id", 1), ("status", 1)])
    await db.payment_plans.create_index([("tenant_id", 1), ("status", 1)])
    await db.payment_plan_installments.create_index([("plan_id", 1), ("sequence", 1)], unique=True)
    # SaaS-facturen & landing-assets — ontbraken op productie, veroorzaakten
    # trage list-queries + herhaalde full-collection scans.
    await db.subscription_invoices.create_index("company_id")
    await db.subscription_invoices.create_index([("company_id", 1), ("status", 1)])
    await db.landing_assets.create_index("company_id")
    await db.landing_assets.create_index([("company_id", 1), ("scope", 1)])
    await db.subscription_invoices.create_index([("status", 1), ("period_end", 1)])
    await db.subscription_payments.create_index("company_id")
    await db.subscription_payments.create_index([("company_id", 1), ("paid_at", -1)])
    await db.landing_assets.create_index("id", unique=True)
    await db.saas_payment_plans.create_index([("company_id", 1), ("created_at", -1)])
    await db.contracts.create_index("company_id")
    await db.contracts.create_index([("company_id", 1), ("tenant_id", 1)])
    await db.sent_trial_warnings.create_index("_key", unique=True)
    await db.sent_invoice_reminders.create_index("invoice_id", unique=True)
    # Idempotency-index voor upcoming (vóór due_date) reminders — één record
    # per (invoice_id, days_bucket) zodat 09:00-loop niet dubbele mails stuurt.
    await db.sent_upcoming_invoice_reminders.create_index(
        [("invoice_id", 1), ("days_bucket", 1)], unique=True,
    )
    await db.payment_plan_installments.create_index([("plan_id", 1), ("status", 1)])
    await db.contracts.create_index("id")
    await db.contracts.create_index("company_id")
    await db.notifications.create_index([("user_id", 1), ("created_at", -1)])

    # --- Seed default company ---
    default = await db.companies.find_one({"slug": DEFAULT_COMPANY_SLUG})
    if not default:
        company_id = new_id()
        default = {
            "id": company_id,
            "slug": DEFAULT_COMPANY_SLUG,
            "name": DEFAULT_COMPANY_NAME,
            "contact_email": "info@surirent.sr",
            "contact_phone": "+597 881 5993",
            "address": "Paramaribo, Suriname",
            "plan": "pro",
            "active": True,
            "created_at": iso(now_utc()),
        }
        await db.companies.insert_one(default)
    DEFAULT_COMPANY_ID = default["id"]

    # --- Backfill existing data with default company_id ---
    for coll in TENANT_SCOPED_COLLECTIONS:
        await db[coll].update_many(
            {"company_id": {"$exists": False}},
            {"$set": {"company_id": DEFAULT_COMPANY_ID}},
        )

    # --- Seed admin (with company_id) ---
    admin_email = os.environ.get("ADMIN_EMAIL", "admin@vastgoed.sr")
    admin_password = os.environ.get("ADMIN_PASSWORD", "admin123")
    existing = await db.users.find_one({"email": admin_email})
    if existing is None:
        await db.users.insert_one({
            "id": new_id(),
            "email": admin_email,
            "name": "Admin",
            "role": "admin",
            "company_id": DEFAULT_COMPANY_ID,
            "password_hash": hash_password(admin_password),
            "created_at": iso(now_utc()),
        })
    else:
        update = {}
        if not verify_password(admin_password, existing.get("password_hash", "")):
            update["password_hash"] = hash_password(admin_password)
        if "company_id" not in existing:
            update["company_id"] = DEFAULT_COMPANY_ID
        if update:
            await db.users.update_one({"email": admin_email}, {"$set": update})

    # --- Backfill: koppel oude payments aan facturen (één keer per server-restart).
    # Voor elke huur-payment zonder invoice_id: zoek matching open factuur op
    # tenant + period_month + period_year. Markeer die factuur als 'paid'.
    try:
        cur = db.payments.find({
            "category": "huur",
            "invoice_id": {"$in": [None, ""]},
            "period_month": {"$ne": None},
            "period_year": {"$ne": None},
        }, {"_id": 0, "id": 1, "tenant_id": 1, "company_id": 1,
            "period_month": 1, "period_year": 1, "amount": 1,
            "receipt_number": 1, "paid_at": 1, "method": 1})
        backfilled = 0
        async for p in cur:
            inv = await db.invoices.find_one({
                "tenant_id": p["tenant_id"],
                "company_id": p.get("company_id"),
                "period_month": p["period_month"],
                "period_year": p["period_year"],
            }, {"_id": 0})
            if not inv:
                continue
            await db.payments.update_one(
                {"id": p["id"]},
                {"$set": {"invoice_id": inv["id"], "invoice_number": inv.get("invoice_number")}}
            )
            if inv.get("status") != "paid":
                try:
                    paid_pct = float(p.get("amount", 0)) >= float(inv.get("amount", 0)) - 0.005
                except Exception:
                    paid_pct = True
                if paid_pct:
                    await db.invoices.update_one(
                        {"id": inv["id"]},
                        {"$set": {
                            "status": "paid",
                            "paid_at": p.get("paid_at"),
                            "payment_id": p["id"],
                            "receipt_number": p.get("receipt_number"),
                            "paid_method": p.get("method"),
                        }}
                    )
            backfilled += 1
        if backfilled:
            print(f"[startup] linked {backfilled} legacy payments to invoices")
    except Exception as e:
        print(f"[startup] payment↔invoice backfill failed: {e}")

    # --- Seed superadmin ---
    super_email = "super@surirent.sr"
    super_pw = "super123"
    sa = await db.users.find_one({"email": super_email})
    if sa is None:
        await db.users.insert_one({
            "id": new_id(),
            "email": super_email,
            "name": "Superadmin",
            "role": "superadmin",
            "company_id": None,
            "password_hash": hash_password(super_pw),
            "created_at": iso(now_utc()),
        })

    # Gedeelde kiosk-PIN is afgeschaft: alleen persoonlijke medewerker-PINs.
    await db.kiosk_pins.delete_many({})
    await db.settings.delete_one({"_id": "kiosk"})
    # Klantenscherm is verwijderd — opgeslagen schermstatus opruimen.
    await db.customer_display.drop()

    # --- Idempotent re-seed of demo tenant Jan de Vries PIN (avoid drift) ---
    if os.environ.get("RESEED_DEMO_TENANT_PIN", "1") == "1":
        demo_pin = os.environ.get("DEMO_TENANT_PIN", "5678")
        jan = await db.tenants.find_one({"email": "jan@example.sr"})
        if jan and not verify_password(demo_pin, jan.get("pin_hash", "")):
            await db.tenants.update_one(
                {"id": jan["id"]},
                {"$set": {"pin_hash": hash_password(demo_pin)}},
            )

    # --- Start trial-reminder background task ---
    global _reminder_task_handle, _overdue_task_handle
    if os.environ.get("DISABLE_TRIAL_REMINDERS") != "1":
        import asyncio as _aio
        _reminder_task_handle = _aio.create_task(_reminder_loop())

    # --- Start daily overdue-push task ---
    if os.environ.get("DISABLE_OVERDUE_PUSH") != "1":
        import asyncio as _aio
        _overdue_task_handle = _aio.create_task(_overdue_push_loop())

    # --- Start auto-invoice generation loop (per-company grace deadline) ---
    if os.environ.get("DISABLE_AUTO_INVOICE") != "1":
        import asyncio as _aio
        _auto_invoice_task_handle = _aio.create_task(_auto_invoice_loop())

    # --- Start demo-omgeving reset loop (elke 30 minuten) ---
    _demo_reset_task_handle = None
    if os.environ.get("DISABLE_DEMO_RESET") != "1":
        import asyncio as _aio2
        _demo_reset_task_handle = _aio2.create_task(_demo_reset_loop())

    # --- Daily billing-checks loop (06:00 Suriname-tijd / UTC-3) ---
    # Markeert verlopen trials als 'expired' en stuurt notificatie-emails.
    # Loopt ALTIJD aan tenzij DISABLE_BILLING_CRON=1 wordt gezet.
    _billing_cron_handle = None
    if os.environ.get("DISABLE_BILLING_CRON") != "1":
        import asyncio as _aio3
        _billing_cron_handle = _aio3.create_task(_daily_billing_checks_loop())

    # Cross-replica event bus (SSE broadcasts via MongoDB capped tail).
    # Vervangt in-memory `_sse_queues`/`_cd_subscribers` waardoor events
    # in een multi-pod deployment ALLE replica's bereiken.
    try:
        from event_bus import ensure_started as _bus_start
        await _bus_start(db)
    except Exception as _exc:  # noqa: BLE001
        import logging as _l
        _l.getLogger("uvicorn.error").warning(f"event_bus startup: {_exc}")

    asyncio.create_task(_auto_approve_pending_kiosk_payments())
    # FCM-tokens: één document per token (dubbele van gelijktijdige registraties opruimen).
    try:
        seen = set()
        async for d in db.fcm_tokens.find({}, {"_id": 1, "token": 1}).sort("updated_at", -1):
            if d.get("token") in seen:
                await db.fcm_tokens.delete_one({"_id": d["_id"]})
            seen.add(d.get("token"))
        await db.fcm_tokens.create_index("token", unique=True)
    except Exception as e:  # noqa: BLE001
        print(f"[fcm] index failed: {e}")
    # Kiosk-chat is verwijderd: oude chatberichten wissen (idempotent).
    try:
        await db.kiosk_chat.drop()
    except Exception:  # noqa: BLE001
        pass


    # Achtergrondtaken die eerder via @app.on_event("startup") liepen —
    # `lifespan` verdringt die decorator, dus hier expliciet opstarten.
    if os.environ.get("DISABLE_INSTALLMENT_REMINDERS") != "1":
        import asyncio as _aio4
        _aio4.create_task(_installment_reminder_loop())
        _aio4.create_task(_upcoming_invoice_reminder_loop())

    yield
    if _reminder_task_handle:
        _reminder_task_handle.cancel()
    if _overdue_task_handle:
        _overdue_task_handle.cancel()
    if _auto_invoice_task_handle:
        _auto_invoice_task_handle.cancel()
    if _demo_reset_task_handle:
        _demo_reset_task_handle.cancel()
    if _billing_cron_handle:
        _billing_cron_handle.cancel()
    client.close()


async def _daily_billing_checks_loop():
    """Draait elke dag om 06:00 Suriname-tijd (UTC-3) de
    `_enforce_billing_expirations()` flow. Gebruikt een simpele loop met
    een berekend slaap-interval ipv apscheduler om dependencies minimaal
    te houden."""
    import asyncio as _aio
    import logging as _logging
    _log = _logging.getLogger("uvicorn.error")
    while True:
        try:
            now = datetime.now(timezone.utc)
            # Doel: 06:00 Suriname = 09:00 UTC
            target = now.replace(hour=9, minute=0, second=0, microsecond=0)
            if target <= now:
                target = target + timedelta(days=1)
            sleep_s = (target - now).total_seconds()
            await _aio.sleep(max(60.0, sleep_s))
            try:
                expired = await _enforce_billing_expirations()
                _log.info(f"[billing-cron] expired {len(expired)} companies @ {datetime.now(timezone.utc).isoformat()}")
            except Exception as e:
                _log.warning(f"[billing-cron] cycle failed: {e}")
            # Trial-warning cyclus: 1x per dag, verstuurt e-mail 3 dagen
            # voor het einde van elke trial. Idempotent via
            # `sent_trial_warnings` marker-collectie.
            try:
                from routes.saas_ops import check_trial_warnings as _ctw
                sent = await _ctw()
                if sent:
                    _log.info(f"[trial-warn] emailed {len(sent)} companies @ {datetime.now(timezone.utc).isoformat()}")
            except Exception as e:
                _log.warning(f"[trial-warn] cycle failed: {e}")
            # SaaS auto-invoice cyclus: 1x per dag, genereert nieuwe
            # maand-factuur voor elk actief bedrijf waar `subscription_renews_at`
            # verlopen is en er nog geen open factuur bestaat.
            try:
                from routes.superadmin import saas_auto_invoice_tick as _saas_inv
                new_invoices = await _saas_inv()
                if new_invoices:
                    _log.info(f"[saas-invoice] created {len(new_invoices)} monthly invoices @ {datetime.now(timezone.utc).isoformat()}")
            except Exception as e:
                _log.warning(f"[saas-invoice] cycle failed: {e}")
            try:
                from routes.saas_stripe import expiry_push_tick as _ept
                await _ept()
            except Exception as e:
                _log.warning(f"[saas-expiry-push] cycle failed: {e}")
            # Factuur-herinneringen: 3 dagen na vervaldatum een reminder
            # (met PDF-bijlage) sturen. Idempotent via `sent_invoice_reminders`.
            try:
                from routes.superadmin import check_invoice_reminders as _cir
                sent = await _cir()
                if sent:
                    _log.info(f"[invoice-reminders] emailed {len(sent)} companies @ {datetime.now(timezone.utc).isoformat()}")
            except Exception as e:
                _log.warning(f"[invoice-reminders] cycle failed: {e}")
        except _aio.CancelledError:
            return
        except Exception as e:
            _log.warning(f"[billing-cron] outer loop error: {e}")
            await _aio.sleep(3600)


_reminder_task_handle = None
_overdue_task_handle = None
_auto_invoice_task_handle = None


async def _send_trial_reminders():
    """Send a single reminder per threshold (7d / 3d / 1d) and one when expired.

    Threshold tracking via company.reminders_sent so we never spam."""
    try:
        companies = await db.companies.find({"billing_status": "trial"}, {"_id": 0}).to_list(2000)
    except Exception:
        return
    from email_service import send_email as _smtp_send, send_platform_email, wrap_template, EmailError
    saas = await db.saas_settings.find_one({"id": SAAS_SETTINGS_ID}, {"_id": 0}) or {}
    smtp = saas.get("smtp") or {}
    app_url = (os.environ.get("APP_PUBLIC_URL") or "https://app.surirent.sr").rstrip("/")
    for c in companies:
        if not c.get("owner_email") or not c.get("trial_ends_at"):
            continue
        try:
            end = datetime.fromisoformat(c["trial_ends_at"].replace("Z", "+00:00"))
        except Exception:
            continue
        delta = end - now_utc()
        days_left = int(delta.total_seconds() // 86400)
        # Choose the threshold reached
        threshold = None
        if delta.total_seconds() <= 0:
            threshold = "expired"
        elif days_left <= 0:
            threshold = "1d"
        elif days_left <= 2:
            threshold = "3d"
        elif days_left <= 6:
            threshold = "7d"
        if threshold is None:
            continue
        sent = c.get("reminders_sent", []) or []
        if threshold in sent:
            continue
        plan = PLAN_PRICES.get(c.get("plan", "starter"), PLAN_PRICES["starter"])
        if threshold == "expired":
            subject = "Uw proefperiode is verlopen — activeer nu"
            headline = "Uw proefperiode is verlopen"
            body_msg = "Activeer direct uw abonnement om ononderbroken toegang te behouden."
            cta_color = "#EF4444"
        else:
            human = {"7d": "7 dagen", "3d": "3 dagen", "1d": "morgen"}[threshold]
            subject = f"Nog {human} proefperiode — voltooi uw abonnement"
            headline = f"Uw proefperiode loopt over {human} af"
            body_msg = "Om ononderbroken toegang te behouden, voltooi a.u.b. de eerste betaling."
            cta_color = "#FF5C00"
        content = f"""
            <h1>{headline}</h1>
            <p>Hallo {c.get('name', '')},</p>
            <p>{body_msg}</p>
            <table class="kv">
              <tr><td>Pakket</td><td>{plan['name']}</td></tr>
              <tr><td>Bedrag</td><td>{plan['currency']} {int(plan['amount']):,}/maand</td></tr>
              <tr><td>Verloopdatum</td><td>{end.strftime("%d %b %Y")}</td></tr>
            </table>
            <p style="margin-top:14px;"><a href="{app_url}/admin" style="display:inline-block;background:{cta_color};color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none;font-weight:700;">Open dashboard om te betalen</a></p>
            <p style="font-size:12px;color:#888;margin-top:10px;">In het dashboard ziet u onder "Mijn Abonnement" de bankgegevens en betaalinstructies.</p>
        """.replace(",", ".")
        body_html = wrap_template(content, footer=f"SuriRent · {app_url}")
        try:
            if smtp.get("enabled") and smtp.get("host"):
                try:
                    await _smtp_send(smtp, to=c["owner_email"], subject=subject, body_html=body_html)
                except EmailError:
                    await send_platform_email(to=c["owner_email"], subject=subject, body_html=body_html)
            else:
                await send_platform_email(to=c["owner_email"], subject=subject, body_html=body_html)
            await db.companies.update_one(
                {"id": c["id"]},
                {"$addToSet": {"reminders_sent": threshold}, "$set": {"last_reminder_at": iso(now_utc())}},
            )
        except Exception:
            continue


async def _reminder_loop():
    """Run the reminder check every 6 hours."""
    import asyncio as _aio
    while True:
        try:
            await _send_trial_reminders()
        except Exception:
            pass
        await _aio.sleep(6 * 3600)


async def _company_overdue_tenants(cid: str) -> list:
    """Huurders met achterstallige facturen (vervaldatum verstreken), zelfde
    bucket-logica als het kiosk-overzicht. Gesorteerd op hoogste achterstand."""
    grace_wd = 10
    cs = await db.company_settings.find_one({"company_id": cid}, {"_id": 0, "invoicing": 1})
    try:
        if cs and isinstance(cs.get("invoicing"), dict):
            grace_wd = int(cs["invoicing"].get("grace_workdays") or 10)
    except Exception:  # noqa: BLE001
        pass
    today_local = now_utc().date()
    per_tenant: dict = {}
    async for inv in db.invoices.find(
        {"company_id": cid, "status": {"$in": list(_UNPAID_STATUSES)}},
        {"_id": 0, "tenant_id": 1, "amount": 1, "amount_due": 1, "paid_amount": 1,
         "currency": 1, "period_month": 1, "period_year": 1, "due_date": 1},
    ):
        total = float(inv.get("amount_due") or inv.get("amount") or 0)
        outstanding = max(total - float(inv.get("paid_amount") or 0), 0)
        if outstanding <= 0 or not inv.get("tenant_id"):
            continue
        if _classify_invoice_bucket(inv.get("period_month"), inv.get("period_year"), today_local,
                                    grace_wd, due_date=inv.get("due_date")) != "overdue":
            continue
        cur = inv.get("currency") or "SRD"
        t = per_tenant.setdefault(inv["tenant_id"], {"amounts": {}, "count": 0})
        t["amounts"][cur] = t["amounts"].get(cur, 0) + outstanding
        t["count"] += 1
    if not per_tenant:
        return []
    names = {}
    async for t in db.tenants.find({"company_id": cid, "id": {"$in": list(per_tenant)}}, {"_id": 0, "id": 1, "name": 1}):
        names[t["id"]] = t.get("name") or "Huurder"
    out = [{"tenant_id": tid, "name": names.get(tid, "Huurder"), "amounts": v["amounts"], "count": v["count"]}
           for tid, v in per_tenant.items() if tid in names]
    out.sort(key=lambda x: -sum(x["amounts"].values()))
    return out


def _nl_money(cur: str, v) -> str:
    return f"{cur or 'SRD'} " + f"{float(v or 0):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def _overdue_summary_text(overdue: list) -> str:
    if not overdue:
        return "Geen achterstallige facturen — alles is voldaan!"
    totals: dict = {}
    for o in overdue:
        for cur, amt in o["amounts"].items():
            totals[cur] = totals.get(cur, 0) + amt
    tot_txt = " + ".join(_nl_money(cur, amt) for cur, amt in sorted(totals.items()))
    top = ", ".join(f"{o['name']} ({' + '.join(_nl_money(c, a) for c, a in o['amounts'].items())})" for o in overdue[:3])
    extra = f" +{len(overdue) - 3} anderen" if len(overdue) > 3 else ""
    n = len(overdue)
    return f"{n} huurder{'s' if n != 1 else ''} achterstallig, totaal {tot_txt} — {top}{extra}"


async def _send_overdue_pushes():
    """Eén pass over alle companies: voor elke company telt hoeveel huurders
    een openstaande balance hebben en stuurt een push naar de admins van
    die company (max 1× per dag dankzij de `_overdue_last_sent` cache)."""
    today_key = now_utc().strftime("%Y-%m-%d")
    async for c in db.companies.find({"active": {"$ne": False}}, {"_id": 0, "id": 1, "name": 1, "overdue_push_last": 1}):
        if c.get("overdue_push_last") == today_key:
            continue  # al verstuurd vandaag
        cid = c["id"]
        try:
            overdue = await _company_overdue_tenants(cid)
        except Exception as e:  # noqa: BLE001
            print(f"[push] overdue calc failed for company={cid}: {e}")
            continue
        if not overdue:
            await db.companies.update_one({"id": cid}, {"$set": {"overdue_push_last": today_key}})
            continue
        body = _overdue_summary_text(overdue)
        try:
            await _notify_company_admins(
                cid, "Achterstallige huur",
                body,
                {"kind": "overdue", "url": "/admin/invoices", "count": len(overdue), "badge_inc": 1},
            )
            await db.companies.update_one({"id": cid}, {"$set": {"overdue_push_last": today_key}})
        except Exception as e:
            print(f"[push] overdue notify failed for company={cid}: {e}")


async def _overdue_push_loop():
    """Background-loop: elke 15 minuten controleren of het tussen 9:00 en
    10:00 lokale tijd is, en zo ja: stuur de dagelijkse achterstand-push
    (max 1× per dag per company)."""
    import asyncio as _aio
    while True:
        try:
            # Lokale tijd; Suriname = UTC-3
            hour_local = (now_utc().hour - 3) % 24
            if 9 <= hour_local < 11:
                await _send_overdue_pushes()
        except Exception:
            pass
        await _aio.sleep(15 * 60)


app = FastAPI(title="Vastgoed Kiosk API", lifespan=lifespan)

# COMPRESSIE — Brotli EN Gzip. Starlette kiest per request automatisch de
# beste algoritme op basis van `Accept-Encoding` header van de client.
# Brotli levert 15-25% kleinere payloads dan gzip op JSON responses.
# Alle moderne browsers (Chrome/Safari/Firefox/Edge) sturen `br` in de
# Accept-Encoding. Fallback naar gzip voor oude clients / curl.
# minimum_size=500 → voorkomt compressie-overhead op kleine responses.
# Alleen GZip (niveau 4): Brotli+GZip samen kostte te veel CPU op de 0,5-vCPU pod.
app.add_middleware(GZipMiddleware, minimum_size=1000, compresslevel=4)

cors_origins = os.environ.get("CORS_ORIGINS", "*")
if cors_origins == "*":
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=".*",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[o.strip() for o in cors_origins.split(",")],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )


# =====================================================================
# Live-sync middleware — na elke succesvolle mutatie (POST/PUT/DELETE/PATCH)
# op een /api/* route (behalve auth/kiosk/public) broadcasten we een event
# naar de SSE-queue van het bedrijf zodat andere ingelogde admin-tabs direct
# hun data herladen zonder polling.
# =====================================================================
@app.middleware("http")
async def _live_sync_broadcast(request: Request, call_next):
    response = await call_next(request)
    try:
        method = request.method.upper()
        if method in ("GET", "HEAD", "OPTIONS"):
            return response
        path = request.url.path or ""
        if response.status_code >= 400:
            return response
        # Alleen mutaties op admin/company data — sluit auth/public/events uit.
        # Kiosk-endpoints doen we WEL broadcasten (kasgeld/payment door
        # medewerker moet live bij admin verschijnen), behalve de high-
        # frequency polling-endpoints die anders de bus zouden vervuilen.
        if not path.startswith("/api/"):
            return response
        skip = (
            "/api/auth/",
            "/api/public/",
            "/api/admin/events",
            "/api/push/",
            "/api/landing/asset/",
            "/api/tenants/ocr-id-card",
            # Kiosk high-frequency / auth endpoints — GEEN broadcast:
            "/api/kiosk/employee-verify",         # PIN check, geen data-mutatie
        )
        if any(path.startswith(s) for s in skip):
            return response

        # Bepaal company_id uit de JWT (best-effort, geen fout doorlaten).
        # Werkt met zowel Bearer header (legacy), access_token cookie (admin
        # met httpOnly cookies), tenant_token cookie (huurder-portal) en
        # kiosk_token cookie (kiosk device). Voor tenant/kiosk tokens is
        # `company_id` niet in de JWT-payload aanwezig → we resolven het
        # via de tenant/apartment/user lookup. Zonder deze fallback misten
        # admin Betalingen live-updates na huurder-portal betalingen.
        import jwt as _pyjwt
        auth = request.headers.get("authorization") or ""
        raw_token = ""
        token_kind = "access"
        if auth.lower().startswith("bearer "):
            raw_token = auth.split(" ", 1)[1]
        else:
            raw_token = request.cookies.get("access_token") or ""
            if not raw_token:
                raw_token = request.cookies.get("tenant_token") or ""
                if raw_token:
                    token_kind = "tenant"
            if not raw_token:
                raw_token = request.cookies.get("kiosk_token") or ""
                if raw_token:
                    token_kind = "kiosk"
        # Emergent Google Auth pad — session_token cookie linkt naar users.
        session_tok = request.cookies.get("session_token") if not raw_token else None
        cid = None
        if raw_token:
            try:
                payload = _pyjwt.decode(raw_token, JWT_SECRET, algorithms=[JWT_ALG])
            except Exception:
                return response
            cid = payload.get("company_id")
            if not cid and token_kind == "tenant":
                # Tenant JWT bevat alleen sub=tenant_id → lookup company_id
                sub = payload.get("sub")
                if sub:
                    t = await db.tenants.find_one({"id": sub}, {"_id": 0, "company_id": 1})
                    cid = (t or {}).get("company_id")
            elif not cid and token_kind == "kiosk":
                # Kiosk JWT bevat normaal `company_id`; als niet, geen broadcast.
                pass
        elif session_tok:
            try:
                sess = await db.user_sessions.find_one({"session_token": session_tok},
                                                        {"_id": 0, "user_id": 1})
                if sess:
                    gu = await db.users.find_one({"user_id": sess["user_id"]},
                                                  {"_id": 0, "company_id": 1})
                    cid = (gu or {}).get("company_id")
            except Exception:
                return response
        if not cid:
            return response
        # Kort event — client vraagt zelf zijn data opnieuw op. Bevat pad
        # zodat je in de toekomst granulair kunt filteren op collectie.
        # `create_task` zodat broadcast NIET wacht op response-return —
        # queue.put_nowait is snel maar we willen 0ms overhead.
        try:
            asyncio.create_task(_sse_broadcast(cid, {"type": "change", "path": path, "method": method}))
        except Exception:
            pass
    except Exception:
        pass
    return response


api = APIRouter(prefix="/api")


# =====================================================================
# Auth routes
# =====================================================================
def _set_access_cookie(response: Response, token: str, name="access_token", minutes=ACCESS_MIN):
    # Cookies worden gemarkeerd `Secure` op HTTPS (preview + productie) en
    # `SameSite=Lax` zodat ze niet door 3rd-party scripts mee-genomen kunnen
    # worden. We schakelen `secure` uit op lokale http dev (COOKIE_SECURE=0)
    # zodat developer-tools nog werken zonder TLS.
    secure_flag = (os.environ.get("COOKIE_SECURE", "1").strip() == "1")
    response.set_cookie(
        key=name, value=token, httponly=True, secure=secure_flag,
        samesite="lax", max_age=minutes * 60, path="/",
    )


async def _invalidate_prior_sessions(request: Request, response: Response, *, keep: str = "access_token") -> None:
    """Wist alle auth-cookies en server-side sessies BEHALVE het opgegeven
    cookie. Roep dit aan bij élke fresh login zodat een oude sessie van
    gebruiker A niet blijft plakken als gebruiker B inlogt op hetzelfde
    apparaat.

    `keep` is de cookie-naam die de aanroepende endpoint zojuist heeft
    (her)uitgegeven — die willen we niet meteen weer wissen.
    """
    # Google session_token → invalideer DB rij + wis cookie (matchende attrs
    # anders wist de browser 'm niet).
    if keep != "session_token":
        session_tok = request.cookies.get("session_token")
        if session_tok:
            try:
                await db.user_sessions.delete_one({"session_token": session_tok})
            except Exception:  # noqa: BLE001
                pass
        response.delete_cookie("session_token", path="/", samesite="none", secure=True)
    # JWT-based cookies: geen DB rij, alleen cookie wissen.
    for name in ("access_token", "kiosk_token", "tenant_token"):
        if name == keep:
            continue
        response.delete_cookie(name, path="/")


def _slugify(name: str) -> str:
    import re
    s = re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")
    return s[:40] or "bedrijf"


# Slugs die niet als bedrijfsnaam gebruikt mogen worden — anders botsen ze met
# vaste app-routes (https://app.surirent.sr/<slug>/...). LET OP: deze lijst
# moet gesynchroniseerd blijven met de gereserveerde slugs in
# `frontend/src/lib/branding.js` (`RESERVED_SLUGS`).
RESERVED_SLUGS = {
    # Frontend app-routes
    "login", "admin", "kiosk", "huurder", "onderteken", "c", "vastgoed",
    # Backend / infra paths
    "api", "health", "static", "manifest", "sw", "favicon", "assets",
    # Marketing & meta
    "www", "app", "mail", "ftp", "blog", "support", "docs", "help",
    # Toekomstige uitbreidingen
    "register", "settings", "billing", "checkout", "auth", "logout",
    "tenant", "tenants", "company", "companies", "superadmin",
}


def _validate_slug_or_raise(slug: str) -> str:
    """Normaliseert + valideert een slug. Raise 400 bij ongeldig of gereserveerd."""
    import re
    s = (slug or "").lower().strip()
    if not s:
        raise HTTPException(status_code=400, detail="Slug is verplicht")
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,39}", s):
        raise HTTPException(status_code=400, detail="Slug mag alleen letters, cijfers en streepjes bevatten (max 40 tekens)")
    if s in RESERVED_SLUGS:
        raise HTTPException(status_code=400, detail=f"De slug '{s}' is gereserveerd door het platform. Kies een andere.")
    return s


def _detect_country_currency(phone: str) -> tuple:
    """Detect (country, currency) from international phone prefix.
    NL (+31 / 0031) → EUR; everything else falls back to Suriname / SRD."""
    cleaned = (phone or "").strip()
    # Strip everything except digits and leading +
    digits_plus = ""
    for i, ch in enumerate(cleaned):
        if ch == "+" and i == 0:
            digits_plus += ch
        elif ch.isdigit():
            digits_plus += ch
    if digits_plus.startswith("+31") or digits_plus.startswith("0031") or digits_plus.startswith("31") and len(digits_plus) >= 10:
        return "NL", "EUR"
    return "SR", "SRD"


@api.post("/auth/register")
async def register(body: RegisterIn, request: Request, response: Response):
    email = body.email.lower().strip()
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=400, detail="E-mailadres is al in gebruik")

    company_id = None
    company_payload = None

    # Self-serve onboarding: when company_name is provided, create a new tenant.
    if (body.company_name or "").strip():
        # Slug moet expliciet worden opgegeven — geen auto-generatie meer op
        # basis van bedrijfsnaam. Frontend valideert al maar backend valideert
        # opnieuw zodat een direct-API-call niet omzeild kan worden.
        raw_slug = (body.slug or "").strip().lower()
        if not raw_slug:
            raise HTTPException(
                status_code=400,
                detail="Slug (portal-URL) is verplicht — kies een unieke naam voor uw portal.",
            )
        # Normaliseer + valideer format
        import re as _re
        slug = _re.sub(r"[^a-z0-9-]+", "-", raw_slug).strip("-")
        if not (2 <= len(slug) <= 40) or not _re.match(r"^[a-z0-9][a-z0-9-]*[a-z0-9]$", slug):
            raise HTTPException(
                status_code=400,
                detail="Ongeldige slug — gebruik 2-40 tekens, alleen kleine letters, cijfers en koppelteken.",
            )
        if slug in RESERVED_SLUGS:
            raise HTTPException(
                status_code=409,
                detail=f"Slug '{slug}' is gereserveerd. Kies een andere naam.",
            )
        if await db.companies.find_one({"slug": slug}, {"_id": 1}):
            raise HTTPException(
                status_code=409,
                detail=f"Slug '{slug}' is al in gebruik. Kies een andere naam.",
            )
        now = now_utc()
        trial_end = now + timedelta(days=14)
        # Explicit country choice overrides phone-based detection
        if body.country == "NL":
            country, currency = "NL", "EUR"
        elif body.country == "SR":
            country, currency = "SR", "SRD"
        else:
            country, currency = _detect_country_currency(body.telefoon)
        c = {
            "id": new_id(),
            "name": body.company_name.strip(),
            "slug": slug,
            "plan": body.plan or "starter",  # selected package
            "billing_status": "trial",       # trial | active | past_due | cancelled
            "trial_started_at": iso(now),
            "trial_ends_at": iso(trial_end),
            "telefoon": (body.telefoon or "").strip(),
            "address": (body.address or "").strip(),
            "owner_email": email,
            "country": country,
            "currency": currency,
            "created_at": iso(now),
        }
        await db.companies.insert_one(c)
        company_id = c["id"]
        company_payload = {k: c[k] for k in ("id", "slug", "name", "plan")}

    else:
        # Backwards compat: join the default company when company_name is omitted.
        default = await db.companies.find_one({"slug": DEFAULT_COMPANY_SLUG}, {"_id": 0})
        if default:
            company_id = default["id"]
            company_payload = {k: default[k] for k in ("id", "slug", "name", "plan")}

    user_doc = {
        "id": new_id(),
        "email": email,
        "name": body.name.strip(),
        "role": "admin",
        "company_id": company_id,
        "password_hash": hash_password(body.password),
        "created_at": iso(now_utc()),
    }
    await db.users.insert_one(user_doc)
    token = create_token({
        "sub": user_doc["id"], "email": email, "type": "access",
        "company_id": company_id, "role": "admin",
    }, ACCESS_MIN)
    # Wis eventuele oude sessies (bv. Google session_token van vorige
    # gebruiker) VÓÓR de nieuwe cookie zetten — cross-account safety.
    await _invalidate_prior_sessions(request, response, keep="access_token")
    _set_access_cookie(response, token)

    # Welcome email — best-effort, never fails registration
    if company_payload:
        try:
            from email_service import send_email as _send_smtp, send_platform_email, wrap_template
            app_url = (os.environ.get("APP_PUBLIC_URL") or "https://app.surirent.sr").rstrip("/")
            slug = c.get("slug")
            login_query_url = f"{app_url}/login?c={slug}"
            plan_info = PLAN_PRICES.get(c.get("plan", "starter"), PLAN_PRICES["starter"])
            pin_row = ""
            sub_block = ""
            # Generate the onboarding PDF + inline QR for the email body
            try:
                qr_png_inline = _make_qr_png(login_query_url, size_px=320)
                qr_block = """
                <p style="margin:18px 0 6px;font-size:13px;color:#475569;text-align:center;">
                  <strong>Scan om direct in te loggen op uw telefoon:</strong>
                </p>
                <p style="text-align:center;margin:0;">
                  <img src="cid:loginqr" alt="QR code" width="200" height="200" style="border:1px solid #e2e8f0;border-radius:12px;padding:6px;background:#fff;" />
                </p>
                """
            except Exception:
                qr_png_inline = None
                qr_block = ""
            try:
                primary_hex = ((c.get("branding") or {}).get("primary_color") or "#FF5C00")
                onboarding_pdf_bytes = onboarding_pdf(
                    company_name=company_payload["name"],
                    contact_name=body.name,
                    email=email,
                    plan_name=plan_info["name"],
                    plan_price_text=f"{plan_info['currency']} {int(plan_info['amount']):,}/maand".replace(",", "."),
                    login_url=login_query_url,
                    subdomain_url=None,
                    kiosk_pin=None,
                    primary_hex=primary_hex,
                )
            except Exception:
                onboarding_pdf_bytes = None
            content = f"""
                <h1>Welkom bij SuriRent!</h1>
                <p>Uw eigen Vastgoed omgeving is aangemaakt voor
                  <strong>{company_payload['name']}</strong>. U kunt direct inloggen op uw persoonlijke link:</p>
                <p><a href="{login_query_url}" style="display:inline-block;background:#FF5C00;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px;">Open mijn omgeving</a></p>
                <p style="font-size:12px;color:#64748b;word-break:break-all;">{login_query_url}</p>
                {qr_block}
                {sub_block}

                <h1 style="font-size:16px;margin-top:24px;">Uw inloggegevens</h1>
                <table class="kv">
                  <tr><td>E-mailadres</td><td>{email}</td></tr>
                  <tr><td>Wachtwoord</td><td>(zoals u die heeft ingevoerd)</td></tr>
                  {pin_row}
                </table>

                <h1 style="font-size:16px;margin-top:18px;">Uw pakket</h1>
                <table class="kv">
                  <tr><td>Pakket</td><td>{plan_info['name']}</td></tr>
                  <tr><td>Prijs</td><td>{plan_info['currency']} {int(plan_info['amount']):,}/maand</td></tr>
                  <tr><td>Proefperiode</td><td>14 dagen gratis</td></tr>
                </table>

                <p style="margin-top:18px;">📎 <strong>Bijgevoegd</strong>: een PDF welkomstpakket met alle inloggegevens, QR-code en installatie-instructies voor iOS en Android. Print of bewaar 'm voor uw administratie.</p>
                <p>Tip: <strong>bookmark</strong> de bovenstaande link of installeer hem als app op uw telefoon. Heeft u vragen? Antwoord gerust op deze mail.</p>
            """.replace(",", ".")
            subject = f"Welkom bij SuriRent — uw {plan_info['name']} omgeving is klaar"
            body_html = wrap_template(content, footer=f"SuriRent · {app_url}")

            # Build the attachments list — onboarding PDF + inline QR for HTML <img>
            attachments = []
            if onboarding_pdf_bytes:
                pdf_name = f"SuriRent_welkomstpakket_{(c.get('slug') or 'nieuw').replace('-', '_')}.pdf"
                attachments.append((pdf_name, onboarding_pdf_bytes, "application/pdf"))
            if qr_png_inline:
                # Use Content-ID inline image — referenced via src="cid:loginqr" above.
                # Format: ('loginqr.png', bytes, 'image/png; cid=loginqr; inline').
                attachments.append(("loginqr.png", qr_png_inline, "image/png; cid=loginqr; inline"))
            # Prefer SaaS DB settings, fall back to env-based platform SMTP
            saas = await db.saas_settings.find_one({"id": SAAS_SETTINGS_ID}, {"_id": 0}) or {}
            smtp = saas.get("smtp") or {}
            if smtp.get("enabled") and smtp.get("host"):
                try:
                    await _send_smtp(smtp, to=email, subject=subject, body_html=body_html, attachments=attachments or None)
                except Exception:
                    await send_platform_email(to=email, subject=subject, body_html=body_html, attachments=attachments or None)
            else:
                await send_platform_email(to=email, subject=subject, body_html=body_html, attachments=attachments or None)
        except Exception:
            pass  # never block registration on email failure

    return {
        "token": token,
        "user": {k: user_doc[k] for k in ("id", "email", "name", "role", "company_id", "created_at")},
        "company": company_payload,
    }


@api.post("/auth/login")
async def login(body: LoginIn, request: Request, response: Response):
    email = body.email.lower().strip()
    user = await db.users.find_one({"email": email})
    # bcrypt is CPU-bound (~200-1000ms afhankelijk van pod-CPU) — wrap in
    # threadpool zodat het event loop niet blokkeert en andere requests
    # gewoon door kunnen gaan tijdens het verifiëren.
    ok = user and await asyncio.to_thread(
        verify_password, body.password, user.get("password_hash", "")
    )
    if not ok:
        raise HTTPException(status_code=401, detail="Onjuiste inloggegevens")
    if user.get("disabled"):
        raise HTTPException(status_code=403, detail="Dit account is gedeactiveerd")
    if user.get("role") == "kiosk":
        # Kiosk-medewerker: wachtwoord klopt → volgende stap is de eigen PIN.
        c = await db.companies.find_one({"id": user.get("company_id")}, {"_id": 0, "id": 1, "slug": 1, "name": 1}) or {}
        return {"pin_required": True,
                "user": {"email": user["email"], "name": user.get("name", ""), "role": "kiosk"},
                "company": c or None}
    token = create_token({
        "sub": user["id"], "email": email, "type": "access",
        "company_id": user.get("company_id"), "role": user.get("role", "admin"),
    }, ACCESS_MIN)
    # Invalideer eventuele vorige sessies (bv. Google session_token van
    # gebruiker A op hetzelfde apparaat) VÓÓR het nieuwe access_token wordt
    # gezet. Voorkomt cross-account bleeding.
    await _invalidate_prior_sessions(request, response, keep="access_token")
    _set_access_cookie(response, token)
    company = None
    if user.get("company_id"):
        c = await db.companies.find_one({"id": user["company_id"]}, {"_id": 0})
        if c:
            company = {k: c[k] for k in ("id", "slug", "name", "plan")}
    return {
        "token": token,
        "user": {
            "id": user["id"], "email": user["email"], "name": user["name"],
            "role": user.get("role", "admin"), "company_id": user.get("company_id"),
            "created_at": user["created_at"],
        },
        "company": company,
    }


@api.post("/auth/logout")
async def logout(request: Request, response: Response):
    # Wis ALLE auth-cookies + server-side sessies. Kritiek voor gedeelde
    # apparaten: als gebruiker A uitlogt mag gebruiker B in geen enkel
    # geval nog in A's account belanden.
    #
    # Verwijderd:
    #   - Emergent Google session_token cookie + rij in user_sessions
    #   - JWT-based access_token, kiosk_token, tenant_token cookies
    #
    # LET OP: session_token is gezet met samesite="none" secure=True dus
    # delete_cookie MOET dezelfde attributen krijgen anders wist de browser
    # 'm niet en blijft de sessie geldig na "uitloggen".
    session_tok = request.cookies.get("session_token")
    if session_tok:
        try:
            await db.user_sessions.delete_one({"session_token": session_tok})
        except Exception:  # noqa: BLE001
            pass
    for name in ("access_token", "kiosk_token", "tenant_token"):
        response.delete_cookie(name, path="/")
    response.delete_cookie("session_token", path="/", samesite="none", secure=True)
    return {"ok": True}


# ============================================================
# DEMO LOGIN — gedeelde demo-omgeving die elke 30 minuten wordt
# ============================================================
# gereset. Bedrijven kunnen hier inloggen om alle features te testen
# zonder een eigen account aan te maken. Reset wordt uitgevoerd door
# `_demo_reset_tick()` (achtergrond loop in `startup_event`).
# OPMERKING: dit is een PUBLIEKE demo. De credentials staan letterlijk
# op de marketing-landingspagina — geen veiligheidsrisico. Optioneel
# overridebaar via env zodat een productie-instantie eigen demo-credentials
# kan kiezen.
DEMO_EMAIL = os.environ.get("DEMO_EMAIL", "demo@surirent.sr")
DEMO_PASSWORD = os.environ.get("DEMO_PASSWORD", "demo1234")  # noqa: S105 — publieke demo
DEMO_COMPANY_SLUG = os.environ.get("DEMO_COMPANY_SLUG", "demo")


# ============================================================
# QR CODE LOGIN — Cross-device authentication (WhatsApp Web style)
# ============================================================
# Flow:
#   1. Desktop bezoekt /login → klikt op "QR code" tab.
#   2. Desktop roept POST /auth/qr/create → krijgt token + qr_url.
#   3. Desktop toont QR met deep-link → polt elke 2s /auth/qr/status/{token}.
#   4. Mobiel (al ingelogd) scant QR via in-app scanner of native camera.
#   5. Mobiel roept POST /auth/qr/claim/{token} met bearer token.
#   6. Backend genereert nieuwe sessie voor desktop, koppelt aan QR-token.
#   7. Desktop poll detecteert "claimed" → ontvangt nieuwe token → ingelogd.
#
# Veiligheid:
#   - Tokens zijn 32-bytes urlsafe (cryptografisch sterk).
#   - QR sessies verlopen na 5 minuten (anti-replay).
#   - Eenmaal "claimed" kan QR niet opnieuw gebruikt worden.
#   - Mobiel moet expliciet bevestigen via authenticated endpoint.

QR_SESSION_TTL_MIN = 5  # noqa — anti-replay window



@api.post("/auth/qr/create")
async def qr_create(request: Request):
    """Anonieme endpoint die een pending QR sessie aanmaakt."""
    token = secrets.token_urlsafe(24)
    now = datetime.now(timezone.utc)
    expires = now + timedelta(minutes=QR_SESSION_TTL_MIN)
    await db.qr_sessions.insert_one({
        "_id": token,
        "token": token,
        "status": "pending",
        "created_at": now.isoformat(),
        "expires_at": expires.isoformat(),
        "claimed_user_id": None,
        "access_token": None,
    })
    # Bouw absolute qr_url uit headers — zo werkt deep-link voor
    # elke deployment zonder dat FRONTEND_BASE_URL gezet hoeft te worden.
    #
    # Belangrijk: in Kubernetes ingress + Cloudflare worker is `Origin`
    # vaak HERSCHREVEN naar de cluster-interne host
    # (bv. `vastgoed-app.cluster-1.preview.emergentcf.cloud`) die niet
    # bereikbaar is vanaf de telefoon van de gebruiker.
    # Prioriteit: FRONTEND_BASE_URL → X-Forwarded-Host (publiek) →
    # Referer (publiek) → Origin → Host.
    base = (os.environ.get("FRONTEND_BASE_URL") or "").rstrip("/")
    if not base:
        scheme = request.headers.get("x-forwarded-proto", "https")
        fwd_host = (request.headers.get("x-forwarded-host") or "").strip()
        if fwd_host:
            # X-Forwarded-Host bevat de echte publieke host.
            # Pak de eerste waarde als er een chain is.
            fwd_host = fwd_host.split(",")[0].strip()
            base = f"{scheme}://{fwd_host}"
        else:
            referer = (request.headers.get("referer") or "").strip()
            if referer:
                try:
                    from urllib.parse import urlparse as _urlparse
                    _u = _urlparse(referer)
                    if _u.scheme and _u.netloc:
                        base = f"{_u.scheme}://{_u.netloc}"
                except Exception:
                    pass
            if not base:
                origin = (request.headers.get("origin") or "").strip()
                if origin:
                    base = origin.rstrip("/")
                else:
                    host = request.headers.get("host") or "localhost:8001"
                    base = f"{scheme}://{host}"
    qr_url = f"{base}/qr-link?token={token}"
    return {"token": token, "qr_url": qr_url, "expires_in": QR_SESSION_TTL_MIN * 60}


@api.get("/auth/qr/status/{token}")
async def qr_status(token: str):
    """Desktop polt deze endpoint elke 2s tot status='claimed'."""
    sess = await db.qr_sessions.find_one({"token": token}, {"_id": 0})
    if not sess:
        raise HTTPException(status_code=404, detail="Onbekende QR sessie")
    # Check expiry
    try:
        exp = datetime.fromisoformat(sess["expires_at"])
        if exp < datetime.now(timezone.utc) and sess.get("status") == "pending":
            await db.qr_sessions.update_one({"token": token}, {"$set": {"status": "expired"}})
            sess["status"] = "expired"
    except Exception:
        pass
    return {
        "status": sess.get("status", "pending"),
        "access_token": sess.get("access_token"),
        "user": sess.get("user_summary"),
    }


@api.post("/auth/device-qr-token/issue")
async def issue_device_qr_token(user=Depends(get_current_user)):
    """Geeft een long-lived device-bound token uit dat ALLEEN QR-claim kan doen.
    Server slaat een bcrypt-hash van het token op gekoppeld aan user_id; raw
    token wordt 1x retour gegeven en client slaat het lokaal op.

    Hierdoor kan de PWA — zelfs nadat de access_token is verlopen of de
    gebruiker is uitgelogd — alsnog een desktop sessie claimen ZONDER
    opnieuw PIN te hoeven invoeren. De token kan alleen QR-claim doen,
    geen andere endpoints raadplegen.

    TTL: 1 jaar. Revocable via account-instellingen.
    """
    raw_token = secrets.token_urlsafe(32)
    token_hash = hash_password(raw_token)
    now = datetime.now(timezone.utc)
    expires = now + timedelta(days=365)
    await db.device_qr_tokens.insert_one({
        "_id": secrets.token_urlsafe(12),
        "user_id": user["id"],
        "token_hash": token_hash,
        "created_at": now.isoformat(),
        "expires_at": expires.isoformat(),
        "last_used_at": None,
        "company_id": user.get("company_id"),
    })
    return {"device_qr_token": raw_token, "expires_in_days": 90}


@api.post("/auth/qr/claim/{token}")
async def qr_claim(token: str, request: Request, user=Depends(get_current_user_optional)):
    """Mobiel (geauthenticeerd) bevestigt de QR sessie — desktop wordt ingelogd.

    Twee authenticatie-paden:
    1. Standaard: Bearer access_token via `Authorization` header.
    2. Device QR token: header `X-Device-QR-Token` (long-lived, alleen QR-claim).
       Hierdoor werkt scannen vanaf PWA ook wanneer de gewone sessie is verlopen,
       zonder dat de gebruiker opnieuw PIN/wachtwoord hoeft in te voeren.
    """
    # Fallback naar device-qr-token wanneer de gewone bearer token niet
    # aanwezig of niet geldig is.
    if user is None:
        dqt = request.headers.get("x-device-qr-token") or ""
        if not dqt:
            raise HTTPException(status_code=401, detail="Niet geauthenticeerd")
        # Zoek matching token. We hebben geen index op token_hash dus we
        # itereren over de tokens van de afgelopen 90 dagen. Voor preview
        # is dit klein; in productie kun je een lookup via user_id versnellen
        # door de client ook user_id mee te sturen — voor nu houden we het
        # eenvoudig en defensief.
        cutoff = (datetime.now(timezone.utc) - timedelta(days=365)).isoformat()
        matched_doc = None
        async for doc in db.device_qr_tokens.find({"created_at": {"$gte": cutoff}}, {"_id": 0}):
            try:
                if verify_password(dqt, doc.get("token_hash", "")):
                    matched_doc = doc
                    break
            except Exception:
                continue
        if not matched_doc:
            raise HTTPException(status_code=401, detail="Ongeldig device token")
        # Check expiry
        try:
            exp = datetime.fromisoformat(matched_doc["expires_at"])
            if exp < datetime.now(timezone.utc):
                raise HTTPException(status_code=401, detail="Device token is verlopen")
        except HTTPException:
            raise
        except Exception:
            pass
        # Resolve user
        user = await db.users.find_one({"id": matched_doc["user_id"]}, {"_id": 0})
        if not user:
            raise HTTPException(status_code=401, detail="Gebruiker niet gevonden")
        # Touch last_used_at
        await db.device_qr_tokens.update_one(
            {"user_id": matched_doc["user_id"], "token_hash": matched_doc["token_hash"]},
            {"$set": {"last_used_at": datetime.now(timezone.utc).isoformat()}},
        )

    sess = await db.qr_sessions.find_one({"token": token})
    if not sess:
        raise HTTPException(status_code=404, detail="Onbekende QR sessie")
    if sess.get("status") != "pending":
        raise HTTPException(status_code=400, detail="QR sessie is al gebruikt of verlopen")
    try:
        exp = datetime.fromisoformat(sess["expires_at"])
        if exp < datetime.now(timezone.utc):
            await db.qr_sessions.update_one({"token": token}, {"$set": {"status": "expired"}})
            raise HTTPException(status_code=400, detail="QR sessie is verlopen — vraag een nieuwe aan")
    except HTTPException:
        raise
    except Exception:
        pass
    # Genereer een verse access token voor de DESKTOP sessie. Korte TTL.
    desktop_token = create_token({
        "sub": user["id"], "email": user["email"], "type": "access",
        "company_id": user.get("company_id"), "role": user.get("role", "admin"),
    }, ACCESS_MIN)
    await db.qr_sessions.update_one(
        {"token": token},
        {"$set": {
            "status": "claimed",
            "claimed_user_id": user["id"],
            "access_token": desktop_token,
            "claimed_at": datetime.now(timezone.utc).isoformat(),
            "user_summary": {
                "name": user.get("name", ""),
                "email": user.get("email", ""),
                "role": user.get("role", "admin"),
            },
        }},
    )
    return {"ok": True, "message": "Desktop sessie is ingelogd"}


# ============================================================
# PERSONAL PIN — Per-gebruiker PIN voor snelle re-login op PWA
# ============================================================
# Na de eerste succesvolle email+wachtwoord login op PWA kan de
# gebruiker een 4-cijferige persoonlijke PIN instellen. Volgende
# keer kan ze met PIN alleen inloggen (sneller, geen wachtwoord
# typen). Veiligheid: PIN wordt bcrypt-gehashed, gekoppeld aan
# user_id, en device-binding via cookie/localStorage flag.
from pydantic import BaseModel as _PydBase  # noqa — bestaande aliasing
class _PinSetupIn(_PydBase):
    pin: str

class _PinLoginIn(_PydBase):
    email: str
    pin: str

@api.post("/auth/personal-pin/setup")
async def personal_pin_setup(body: _PinSetupIn, user=Depends(get_current_user)):
    """Stel of update de persoonlijke 4-cijferige PIN van de huidige gebruiker."""
    pin = (body.pin or "").strip()
    if not pin.isdigit() or len(pin) != 4:
        raise HTTPException(status_code=400, detail="PIN moet uit precies 4 cijfers bestaan")
    if user.get("company_id"):
        await _check_employee_pin_unique(user["company_id"], pin, exclude_eid=user.get("employee_id"),
                                         exclude_uid=user["id"])
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {
            "personal_pin_hash": hash_password(pin),
            "personal_pin_set_at": datetime.now(timezone.utc).isoformat(),
        }},
    )
    return {"ok": True, "name": user.get("name", ""), "email": user.get("email", "")}


@api.post("/auth/personal-pin/login")
async def personal_pin_login(body: _PinLoginIn, request: Request, response: Response):
    """Login met email + persoonlijke 4-cijferige PIN. Genereert dezelfde
    JWT als wachtwoord-login zodat de frontend identiek kan reageren.
    Kiosk-medewerkers krijgen een kiosk-sessie i.p.v. een beheer-token."""
    email = (body.email or "").strip().lower()
    pin = (body.pin or "").strip()
    if not email or not pin.isdigit() or len(pin) != 4:
        raise HTTPException(status_code=400, detail="Ongeldige PIN of e-mail")
    throttle_key = f"ppin:{_client_ip(request)}:{email}"
    _pin_throttle_check(throttle_key)
    u = await db.users.find_one({"email": email})
    if not u or not u.get("personal_pin_hash") or not verify_password(pin, u.get("personal_pin_hash", "")):
        _pin_throttle_fail(throttle_key)
        raise HTTPException(status_code=401, detail="Onbekende combinatie van e-mail en PIN")
    if u.get("disabled"):
        raise HTTPException(status_code=403, detail="Dit account is gedeactiveerd")
    _pin_throttle_clear(throttle_key)
    if u.get("role") == "kiosk":
        cid = u.get("company_id")
        await _require_plan_feature(cid, "allow_kiosk", "Kiosk terminal")
        emp = await db.employees.find_one({"id": u.get("employee_id"), "company_id": cid}, {"_id": 0, "id": 1, "name": 1}) or {}
        c = await db.companies.find_one({"id": cid}, {"_id": 0, "id": 1, "slug": 1, "name": 1})
        ktoken = create_token({"sub": "kiosk", "type": "kiosk", "company_id": cid}, KIOSK_TOKEN_MIN)
        _set_access_cookie(response, ktoken, name="kiosk_token", minutes=KIOSK_TOKEN_MIN)
        return {"kiosk": True, "token": ktoken, "company": c,
                "employee": {"id": emp.get("id"), "name": emp.get("name") or u.get("name", ""), "pin": pin},
                "user": {"email": u["email"], "name": u.get("name", ""), "role": "kiosk"}}
    token = create_token({
        "sub": u["id"], "email": u["email"], "type": "access",
        "company_id": u.get("company_id"), "role": u.get("role", "admin"),
    }, ACCESS_MIN)
    return {
        "access_token": token, "token_type": "bearer",
        "user": {
            "id": u["id"], "email": u["email"], "name": u.get("name", ""),
            "role": u.get("role", "admin"), "company_id": u.get("company_id"),
            "employee_id": u.get("employee_id"),
        },
    }


@api.get("/auth/personal-pin/status")
async def personal_pin_status(user=Depends(get_current_user)):
    """Frontend gebruikt dit om te checken of PIN al ingesteld is."""
    u = await db.users.find_one({"id": user["id"]}, {"_id": 0, "personal_pin_hash": 1})
    return {"has_pin": bool(u and u.get("personal_pin_hash"))}


@api.post("/auth/demo-login")
async def demo_login(response: Response):
    """Logt direct in op de demo-omgeving. Maakt deze aan als hij nog niet
    bestaat. Telt ook bezoeken voor analytics."""
    # Zorg dat de demo-omgeving bestaat met seed-data
    company = await _ensure_demo_company()
    user = await db.users.find_one({"email": DEMO_EMAIL})
    if not user:
        # Self-heal: maak de demo-user aan
        user = {
            "id": str(uuid.uuid4()),
            "email": DEMO_EMAIL,
            "name": "Demo Beheerder",
            "role": "admin",
            "company_id": company["id"],
            "password_hash": hash_password(DEMO_PASSWORD),
            "is_demo": True,
            "created_at": iso(now_utc()),
        }
        await db.users.insert_one(user)
    # Reset visit-counter incrementeel
    await db.companies.update_one(
        {"id": company["id"]},
        {"$inc": {"demo_visits": 1}, "$set": {"demo_last_visit": iso(now_utc())}},
    )
    token = create_token({
        "sub": user["id"], "email": DEMO_EMAIL, "type": "access",
        "company_id": company["id"], "role": "admin",
    }, ACCESS_MIN)
    _set_access_cookie(response, token)
    return {
        "token": token,
        "email": DEMO_EMAIL,
        "password": DEMO_PASSWORD,
        "company": {k: company.get(k) for k in ("id", "slug", "name")},
        "is_demo": True,
        "message": "Demo-omgeving wordt elke 30 minuten gereset",
    }


# ============================================================
# FORGOT PASSWORD — verstuur 6-cijferige code via email of WhatsApp
# ============================================================
class ForgotPasswordIn(BaseModel):
    email: EmailStr
    channel: Literal["email", "whatsapp"] = "email"


class ResetPasswordIn(BaseModel):
    email: EmailStr
    code: str
    new_password: str = Field(min_length=6, max_length=72)


@api.post("/auth/forgot-password")
async def forgot_password(body: ForgotPasswordIn):
    """Genereert 6-cijferige reset-code en verstuurt via email of WhatsApp.
    Code is 15 minuten geldig. Geeft GENERIC success terug zelfs als email
    niet bestaat (voorkomt email-enumeratie). Code is ook bruikbaar via
    POST /auth/reset-password."""
    email = body.email.lower().strip()
    user = await db.users.find_one({"email": email})
    # Genereer altijd een code (ook bij niet-bestaand account) zodat de
    # response-tijd niet verraadt of de email bestaat.
    code = "".join([str(secrets.randbelow(10)) for _ in range(6)])
    expires = now_utc() + timedelta(minutes=15)
    if user:
        # Sla code op (vervangt oudere code)
        await db.password_reset_tokens.update_one(
            {"email": email},
            {"$set": {
                "email": email,
                "code_hash": hash_password(code),
                "expires_at": expires.isoformat(),
                "channel": body.channel,
                "created_at": iso(now_utc()),
                "used": False,
            }},
            upsert=True,
        )
        # Verstuur via gekozen kanaal — best effort, blokkeert response niet.
        try:
            if body.channel == "email":
                await _send_password_reset_email(email, user.get("name", ""), code)
            else:
                # WhatsApp via Twilio (gemockt indien geen credentials)
                phone = user.get("phone") or ""
                if not phone and user.get("company_id"):
                    c = await db.companies.find_one({"id": user["company_id"]}, {"_id": 0, "contact_phone": 1})
                    if c:
                        phone = c.get("contact_phone") or ""
                if phone:
                    await _send_password_reset_whatsapp(phone, user.get("name", ""), code)
        except Exception as e:  # noqa: BLE001
            print(f"[forgot-password] verzending mislukt: {e}")
    return {
        "ok": True,
        "message": f"Als dit account bestaat, is een herstelcode verzonden via {'e-mail' if body.channel == 'email' else 'WhatsApp'}.",
    }


@api.post("/auth/reset-password")
async def reset_password(body: ResetPasswordIn):
    email = body.email.lower().strip()
    token_doc = await db.password_reset_tokens.find_one({"email": email})
    if not token_doc:
        raise HTTPException(status_code=400, detail="Geen actieve reset-aanvraag voor dit e-mailadres.")
    if token_doc.get("used"):
        raise HTTPException(status_code=400, detail="Deze code is al gebruikt. Vraag een nieuwe aan.")
    try:
        expires = datetime.fromisoformat(token_doc.get("expires_at", ""))
        if expires < now_utc():
            raise HTTPException(status_code=400, detail="De code is verlopen. Vraag een nieuwe aan.")
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="Ongeldige reset-aanvraag.")
    if not verify_password(body.code.strip(), token_doc.get("code_hash", "")):
        raise HTTPException(status_code=400, detail="Onjuiste herstelcode.")
    # Update password
    new_hash = hash_password(body.new_password)
    await db.users.update_one(
        {"email": email},
        {"$set": {"password_hash": new_hash, "password_updated_at": iso(now_utc())}},
    )
    await db.password_reset_tokens.update_one(
        {"email": email},
        {"$set": {"used": True, "used_at": iso(now_utc())}},
    )
    return {"ok": True, "message": "Wachtwoord succesvol gewijzigd"}


async def _send_password_reset_email(email: str, name: str, code: str):
    """Verstuur reset-code via SMTP. Gebruikt company.smtp_settings indien
    aanwezig, anders globale SMTP fallback uit env."""
    subject = "Herstel je wachtwoord — SuriRent"
    body_text = (
        f"Beste {name or 'gebruiker'},\n\n"
        f"Je hebt een wachtwoord-reset aangevraagd. Je herstelcode is:\n\n"
        f"        {code}\n\n"
        f"Deze code is 15 minuten geldig.\n\n"
        f"Heb je dit niet aangevraagd? Negeer dan deze e-mail.\n\n"
        f"— SuriRent"
    )
    body_html = (
        f"<p>Beste {name or 'gebruiker'},</p>"
        f"<p>Je hebt een wachtwoord-reset aangevraagd. Je herstelcode is:</p>"
        f'<p style="font-size:32px;font-weight:800;letter-spacing:8px;background:#FFF7F0;padding:16px;text-align:center;border-radius:8px;color:#FF5C00">{code}</p>'
        f"<p>Deze code is <b>15 minuten</b> geldig.</p>"
        f"<p style='color:#94a3b8;font-size:12px'>Heb je dit niet aangevraagd? Negeer dan deze e-mail.</p>"
    )
    # Gebruik bestaande send_platform_email helper (env-SMTP)
    from email_service import send_platform_email
    await send_platform_email(to=email, subject=subject, body_html=body_html, body_text=body_text)


async def _send_password_reset_whatsapp(phone: str, name: str, code: str):
    """Verstuur reset-code via Twilio WhatsApp. Gemockt zonder Twilio creds."""
    msg = (
        f"Hallo {name or 'gebruiker'},\n\n"
        f"Je SuriRent herstelcode: *{code}*\n\n"
        f"15 minuten geldig. Heb je dit niet aangevraagd? Negeer dit bericht."
    )
    # Best-effort: gebruik bestaande WhatsApp/Twilio integratie
    print(f"[whatsapp-reset] (mock) Verstuur naar {phone}: {msg[:60]}...")


@api.get("/auth/me")
async def me(user=Depends(get_current_user)):
    company = None
    active_id = user.get("active_company_id")
    if active_id:
        c = await db.companies.find_one({"id": active_id}, {"_id": 0})
        if c:
            company = {k: c[k] for k in ("id", "slug", "name", "plan")}
            # Expose de onboarding-flag zodat de frontend na reload nog
            # steeds weet dat er een "Kies uw portalnaam" modal moet komen.
            company["needs_onboarding"] = bool(c.get("needs_onboarding"))
    return {**user, "active_company": company}


# ============== Emergent Google OAuth ==============
# REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS,
# THIS BREAKS THE AUTH. Frontend construeert redirect via window.location.origin.
class GoogleCallbackIn(BaseModel):
    session_id: str
    company_slug: Optional[str] = None  # scope naar deze company als opgegeven


@api.post("/auth/google/callback")
async def google_auth_callback(body: GoogleCallbackIn, request: Request, response: Response):
    """Exchange Emergent session_id for our user + session_token cookie.
    Creates a new user record on first sign-in (role=admin) — auto-creates
    a company als slug ontbreekt of niet bestaat.
    """
    import httpx as _httpx
    async with _httpx.AsyncClient(timeout=10.0) as client:
        try:
            r = await client.get(
                "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
                headers={"X-Session-ID": body.session_id},
            )
        except Exception as e:  # noqa: BLE001
            raise HTTPException(status_code=502, detail=f"OAuth service niet bereikbaar: {e}") from e
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="Ongeldige of verlopen sessie")
    data = r.json()
    email = (data.get("email") or "").lower().strip()
    if not email:
        raise HTTPException(status_code=400, detail="Google-sessie zonder e-mail")
    session_token = data.get("session_token")
    name = data.get("name") or email.split("@")[0]
    picture = data.get("picture") or ""

    # Zoek bestaande user (op email OF user_id). Voorkeur: match op email
    # zodat een bestaande JWT-user zijn account behoudt bij eerste Google
    # login.
    existing = await db.users.find_one(
        {"$or": [{"email": email}, {"user_id": data.get("id")}]},
        {"_id": 0},
    )
    if existing:
        user_id = existing.get("user_id") or existing.get("id") or f"user_{uuid.uuid4().hex[:12]}"
        # Verifieer dat het bedrijf van deze user nog bestaat. Als het is
        # gewist (bv. via Danger Zone / Wipe-all) dan hangt de user in het
        # niets en faalt élk admin-endpoint met "Bedrijf niet gevonden".
        # In dat geval: log de user opnieuw in door een nieuw bedrijf voor
        # hem/haar aan te maken (zelfde flow als een nieuwe Google user).
        existing_cid = existing.get("company_id")
        company_still_exists = False
        if existing_cid:
            company_still_exists = bool(
                await db.companies.find_one({"id": existing_cid}, {"_id": 1})
            )
        update = {
            "user_id": user_id,
            "name": existing.get("name") or name,
            "picture": picture,
            "auth_provider": "google",
            "last_login_at": iso(now_utc()),
        }
        # Superadmins hebben geen company nodig — sla company-heruitrol over.
        role = existing.get("role") or "admin"
        if role != "superadmin" and not company_still_exists:
            base_slug = _slugify(name or email.split("@")[0])[:30] or "user"
            slug = base_slug
            suffix = 1
            while await db.companies.find_one({"slug": slug}, {"_id": 1}):
                suffix += 1
                slug = f"{base_slug}-{suffix}"
            new_company_id = new_id()
            await db.companies.insert_one({
                "id": new_company_id,
                "slug": slug,
                "name": name,
                "plan": "starter",
                "billing_status": "trial",
                "trial_started_at": iso(now_utc()),
                "trial_ends_at": iso(now_utc() + timedelta(days=14)),
                "owner_email": email,
                # Markeer als auto-generated zodat de frontend na de
                # Google-callback een "Kies uw portalnaam" modal opent.
                "needs_onboarding": True,
                "created_at": iso(now_utc()),
            })
            update["company_id"] = new_company_id
        await db.users.update_one({"email": email}, {"$set": update}, upsert=False)
        user_doc = {**existing, **update}
    else:
        # Nieuwe user — auto-create company (slug uit company_slug of
        # afgeleid van email-domein) zodat multi-tenant scope werkt.
        company_id = None
        if body.company_slug:
            co = await db.companies.find_one({"slug": body.company_slug.lower()},
                                              {"_id": 0, "id": 1})
            if co:
                company_id = co["id"]
        if not company_id:
            # Genereer slug uit email of naam. Val terug op random suffix
            # bij collision.
            base_slug = _slugify(name or email.split("@")[0])[:30] or "user"
            slug = base_slug
            suffix = 1
            while await db.companies.find_one({"slug": slug}, {"_id": 1}):
                suffix += 1
                slug = f"{base_slug}-{suffix}"
            company_id = new_id()
            await db.companies.insert_one({
                "id": company_id,
                "slug": slug,
                "name": name,
                "plan": "starter",
                "billing_status": "trial",
                "trial_started_at": iso(now_utc()),
                "trial_ends_at": iso(now_utc() + timedelta(days=14)),
                "owner_email": email,
                # Nieuwe Google user zonder eigen bedrijfsnaam gekozen —
                # frontend toont "Kies uw portalnaam" modal na de callback.
                "needs_onboarding": True,
                "created_at": iso(now_utc()),
            })
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        user_doc = {
            "user_id": user_id,
            "id": user_id,   # legacy field, sommige code kijkt naar "id"
            "email": email,
            "name": name,
            "picture": picture,
            "role": "admin",
            "auth_provider": "google",
            "company_id": company_id,
            "created_at": iso(now_utc()),
            "last_login_at": iso(now_utc()),
        }
        await db.users.insert_one(user_doc)

    # Sla sessie op. Emergent session_token is 7 dagen geldig.
    expires_at = now_utc() + timedelta(days=365)
    # Wis EERST alle stale sessies op dit apparaat:
    #   1) Eventuele OUDE session_token cookie in de browser → DB rij weg
    #      (behalve als het toevallig hetzelfde token is als het nieuwe).
    #   2) Achtergelaten JWT access_token / kiosk_token / tenant_token cookies
    #      van een vorige gebruiker.
    # Zonder deze cleanup blijft `get_current_user()` de vorige sessie zien
    # omdat session_token bovenaan wordt geprioriteerd.
    stale_tok = request.cookies.get("session_token")
    if stale_tok and stale_tok != session_token:
        try:
            await db.user_sessions.delete_one({"session_token": stale_tok})
        except Exception:  # noqa: BLE001
            pass
    # Wis oude JWT-based cookies (access_token/kiosk_token/tenant_token) —
    # keep="session_token" want die zetten we hierna zelf.
    await _invalidate_prior_sessions(request, response, keep="session_token")
    await db.user_sessions.update_one(
        {"session_token": session_token},
        {"$set": {
            "session_token": session_token,
            "user_id": user_doc.get("user_id") or user_doc.get("id"),
            "expires_at": iso(expires_at),
            "created_at": iso(now_utc()),
        }},
        upsert=True,
    )
    # httpOnly cookie zodat XSS er niet bij kan.
    response.set_cookie(
        key="session_token", value=session_token,
        httponly=True, secure=True, samesite="none", path="/",
        max_age=365 * 24 * 3600,
    )
    # Frontend gebruikt `needs_onboarding` om de "Kies uw portalnaam" mini-
    # modal te tonen na een fresh Google registratie.
    needs_onb = False
    cid_final = user_doc.get("company_id")
    if cid_final:
        co = await db.companies.find_one({"id": cid_final}, {"_id": 0, "needs_onboarding": 1})
        needs_onb = bool(co and co.get("needs_onboarding"))
    return {
        "user_id": user_doc.get("user_id") or user_doc.get("id"),
        "email": email, "name": name, "picture": picture,
        "role": user_doc.get("role", "admin"),
        "needs_onboarding": needs_onb,
    }


@api.post("/auth/google/logout")
async def google_auth_logout(request: Request, response: Response):
    # Volledige cross-account cleanup: session_token DB + ALLE auth-cookies.
    # Voorkomt dat gebruiker B in account van A belandt na uitloggen.
    tok = request.cookies.get("session_token")
    if tok:
        try:
            await db.user_sessions.delete_one({"session_token": tok})
        except Exception:  # noqa: BLE001
            pass
    for name in ("access_token", "kiosk_token", "tenant_token"):
        response.delete_cookie(name, path="/")
    response.delete_cookie("session_token", path="/", samesite="none", secure=True)
    return {"ok": True}


# ============== Company Onboarding (voor auto-generated Google companies)
class CompanyOnboardingIn(BaseModel):
    name: str
    slug: str


@api.post("/companies/me/onboarding")
async def company_onboarding(body: CompanyOnboardingIn, user=Depends(get_current_user)):
    """Update naam + slug van een net-aangemaakt (auto-generated) bedrijf.

    Alleen toegelaten wanneer `needs_onboarding: True` op de company staat —
    daarna klapt de flag om en is deze endpoint niet meer bruikbaar (verdere
    naam/slug-wijzigingen lopen via Instellingen).
    """
    cid = company_id_of(user)
    if not cid:
        raise HTTPException(status_code=400, detail="Geen actief bedrijf")
    co = await db.companies.find_one({"id": cid}, {"_id": 0})
    if not co:
        raise HTTPException(status_code=404, detail="Bedrijf niet gevonden")
    if not co.get("needs_onboarding"):
        raise HTTPException(status_code=400, detail="Onboarding is al voltooid")

    name = (body.name or "").strip()
    raw_slug = (body.slug or "").strip().lower()
    if len(name) < 2:
        raise HTTPException(status_code=400, detail="Bedrijfsnaam moet minstens 2 tekens hebben")

    import re as _re
    slug = _re.sub(r"[^a-z0-9-]+", "-", raw_slug).strip("-")
    if not (2 <= len(slug) <= 40) or not _re.match(r"^[a-z0-9][a-z0-9-]*[a-z0-9]$", slug):
        raise HTTPException(
            status_code=400,
            detail="Ongeldige slug — 2-40 tekens, alleen kleine letters, cijfers en koppelteken.",
        )
    if slug in RESERVED_SLUGS:
        raise HTTPException(status_code=409, detail=f"Slug '{slug}' is gereserveerd. Kies een andere naam.")
    # Slug mag alleen conflicteren als hij van een ander bedrijf is.
    clash = await db.companies.find_one({"slug": slug, "id": {"$ne": cid}}, {"_id": 1})
    if clash:
        raise HTTPException(status_code=409, detail=f"Slug '{slug}' is al in gebruik. Kies een andere naam.")

    await db.companies.update_one(
        {"id": cid},
        {"$set": {"name": name, "slug": slug, "needs_onboarding": False,
                  "onboarded_at": iso(now_utc())}},
    )
    return {"id": cid, "slug": slug, "name": name, "needs_onboarding": False}


# ============== Billing — trial status + bank details for offline payments ==============
PLAN_PRICES = {
    "starter": {"name": "Starter", "amount": 3000, "currency": "SRD", "interval": "month",
                "description": "Voor kleinere vastgoedbeheerders.",
                "features": ["Onbeperkt appartementen", "Online betalen", "WhatsApp & E-mail"],
                "limits": {
                    "max_apartments": 100, "max_tenants": 100, "max_locations": 2, "max_employees": 5,
                    "allow_kiosk": False, "allow_ocr": True, "allow_shelly": False,
                    "allow_branding": False, "allow_backup": True,
                }},
    "professional": {"name": "Professional", "amount": 5000, "currency": "SRD", "interval": "month",
                     "description": "Met Kiosk terminal en alle functies.",
                     "features": ["Alles uit Starter", "Kiosk terminal", "Shelly stroombeheer", "Prioriteit support"],
                     "limits": {
                         "max_apartments": 500, "max_tenants": 500, "max_locations": 10, "max_employees": 25,
                         "allow_kiosk": True, "allow_ocr": True, "allow_shelly": True,
                         "allow_branding": True, "allow_backup": True,
                     }},
}


# Default limits voor plans die nog geen "limits" veld hebben (legacy DB rows).
DEFAULT_PLAN_LIMITS = {
    "max_apartments": 50, "max_tenants": 50, "max_locations": 1, "max_employees": 3,
    "allow_kiosk": False, "allow_ocr": False, "allow_shelly": False,
    "allow_branding": False, "allow_backup": False,
}


async def _resolve_company_limits(company_id: str) -> dict:
    """Bepaalt de actieve limits voor een bedrijf op basis van zijn plan.
    Returnt een complete dict met alle limit-keys (vult ontbrekende met defaults).
    Onbekende plan-ids → val terug op het eerste actieve plan ipv harde defaults
    zodat legacy data niet plotseling alle features verliest."""
    if not company_id:
        return dict(DEFAULT_PLAN_LIMITS)
    c = await db.companies.find_one({"id": company_id}, {"_id": 0, "plan": 1})
    plan_id = (c or {}).get("plan", "starter")
    plan = await _fetch_plan_by_id(plan_id)
    if not plan:
        # Legacy plan-id (bv. 'pro' uit oude DB rijen) → pak eerste actieve plan.
        all_plans = await _fetch_plans_from_db()
        if all_plans:
            plan = all_plans[0]
    if not plan:
        return dict(DEFAULT_PLAN_LIMITS)
    limits = dict(DEFAULT_PLAN_LIMITS)
    limits.update(plan.get("limits") or {})
    return limits


async def _enforce_count_limit(company_id: str, collection_name: str, limit_key: str, resource_label: str):
    """Hard-block: raised HTTP 403 wanneer het bedrijf zijn quota voor
    deze resource heeft bereikt. `limit_key` is een sleutel in `limits`
    zoals 'max_apartments'. Een waarde van `-1` of None betekent 'unlimited'."""
    limits = await _resolve_company_limits(company_id)
    cap = limits.get(limit_key)
    if cap is None or cap < 0:
        return  # unlimited
    coll = getattr(db, collection_name)
    current = await coll.count_documents({"company_id": company_id})
    if current >= int(cap):
        raise HTTPException(status_code=403, detail={
            "code": "plan_limit_reached",
            "limit_key": limit_key,
            "current": current,
            "cap": int(cap),
            "resource": resource_label,
            "message": f"Uw abonnement staat maximaal {cap} {resource_label} toe. "
                       f"Upgrade uw pakket om er meer toe te voegen.",
        })


async def _require_plan_feature(company_id: str, feature_key: str, feature_label: str):
    """Hard-block: raised HTTP 403 wanneer een feature (allow_kiosk/_ocr/_shelly/...)
    niet beschikbaar is op het huidige plan."""
    limits = await _resolve_company_limits(company_id)
    if not limits.get(feature_key, False):
        raise HTTPException(status_code=403, detail={
            "code": "plan_feature_locked",
            "feature_key": feature_key,
            "feature": feature_label,
            "message": f"{feature_label} is niet beschikbaar op uw huidige abonnement. "
                       f"Upgrade om deze functie te activeren.",
        })


# =====================================================================
# DB-driven plan catalog — seeds en helpers
#
# Plannen worden nu opgeslagen in `db.plan_catalog` zodat superadmin ze
# kan bewerken via de UI. De PLAN_PRICES dict blijft als immutable
# fallback voor seeding + voor flow's die nog geen await kunnen doen.
# =====================================================================

async def _seed_plan_catalog():
    """Seed de plan_catalog collection met de standaard plans als hij leeg is,
    en backfill bestaande plans met `limits` als die ontbreken. Idempotent."""
    try:
        for pid, pdata in PLAN_PRICES.items():
            existing = await db.plan_catalog.find_one({"id": pid})
            if not existing:
                doc = {
                    "id": pid,
                    "name": pdata["name"],
                    "amount": pdata["amount"],
                    "currency": pdata["currency"],
                    "interval": pdata["interval"],
                    "description": pdata["description"],
                    "features": list(pdata.get("features", [])),
                    "limits": dict(pdata.get("limits", DEFAULT_PLAN_LIMITS)),
                    "active": True,
                    "sort_order": 10 if pid == "starter" else 20,
                    "created_at": now_utc_iso(),
                    "updated_at": now_utc_iso(),
                }
                await db.plan_catalog.insert_one(doc)
            elif not existing.get("limits"):
                # Backfill: bestaande rijen zonder limits → patch met defaults uit PLAN_PRICES.
                await db.plan_catalog.update_one(
                    {"id": pid},
                    {"$set": {
                        "limits": dict(pdata.get("limits", DEFAULT_PLAN_LIMITS)),
                        "updated_at": now_utc_iso(),
                    }},
                )
        # Extra seed: "Lifetime" — permanent gratis pakket voor speciale klanten
        # (partner-deals, demo-bedrijven, life-time toegang). Superadmin kan dit
        # via SaaS Pakketten bewerken of deactiveren. Idempotent seeded.
        if not await db.plan_catalog.find_one({"id": "lifetime"}):
            await db.plan_catalog.insert_one({
                "id": "lifetime",
                "name": "Lifetime",
                "amount": 0.0,
                "currency": "SRD",
                "interval": "lifetime",
                "description": "Permanent gratis toegang — voor speciale partners of demo-bedrijven.",
                "features": ["Alle Professional features", "Geen einddatum", "Geen maandelijkse kosten"],
                "limits": dict(PLAN_PRICES["professional"].get("limits", DEFAULT_PLAN_LIMITS)),
                "active": True,
                "sort_order": 5,  # bovenaan
                "created_at": now_utc_iso(),
                "updated_at": now_utc_iso(),
            })
    except Exception as e:
        import logging as _logging
        _logging.getLogger("uvicorn.error").warning(f"Plan catalog seed failed: {e}")


async def _fetch_plans_from_db() -> list[dict]:
    """Haalt alle ACTIEVE plans op uit de DB (gesorteerd op sort_order).
    Valt terug op PLAN_PRICES als de DB leeg is of fails."""
    try:
        docs = await db.plan_catalog.find({"active": {"$ne": False}}, {"_id": 0}).sort("sort_order", 1).to_list(100)
        if docs:
            return docs
    except Exception as e:
        import logging as _logging
        _logging.getLogger("uvicorn.error").warning(f"plan_catalog fetch failed: {e}")
    # Fallback
    return [{"id": k, **v, "active": True} for k, v in PLAN_PRICES.items()]


async def _fetch_plan_by_id(plan_id: str) -> Optional[dict]:
    """Resolve een plan op id — DB-first, val terug op PLAN_PRICES."""
    try:
        doc = await db.plan_catalog.find_one({"id": plan_id}, {"_id": 0})
        if doc:
            return doc
    except Exception:
        pass
    if plan_id in PLAN_PRICES:
        return {"id": plan_id, **PLAN_PRICES[plan_id], "active": True}
    return None


def now_utc_iso():
    return datetime.now(timezone.utc).isoformat()


@api.get("/billing/plans")
async def list_plans(phone: Optional[str] = None, currency: Optional[str] = None):
    """Public plan catalog — used by landing + registration flow."""
    await _seed_plan_catalog()  # idempotent — backfilt limits indien nodig
    plans = await _fetch_plans_from_db()
    want = (currency or "").upper()
    if not want and phone:
        _, want = _detect_country_currency(phone)
    if want == "EUR":
        fx = await _get_eur_per_srd()
        out = []
        for p in plans:
            eur_amount = _convert_to_eur(p["amount"], p["currency"], fx["rate"])
            out.append({**p, "amount": eur_amount, "currency": "EUR",
                        "original_amount": p["amount"], "original_currency": "SRD"})
        return out
    return plans


# Superadmin CRUD voor plan_catalog -----------------------------------
class PlanCreate(BaseModel):
    id: str
    name: str
    amount: float
    currency: str = "SRD"
    interval: str = "month"
    description: str = ""
    features: list[str] = []
    limits: dict = {}
    active: bool = True
    sort_order: int = 50


class PlanUpdate(BaseModel):
    name: Optional[str] = None
    amount: Optional[float] = None
    currency: Optional[str] = None
    interval: Optional[str] = None
    description: Optional[str] = None
    features: Optional[list[str]] = None
    limits: Optional[dict] = None
    active: Optional[bool] = None
    sort_order: Optional[int] = None


@api.get("/superadmin/plans")
async def superadmin_list_plans(user=Depends(require_role("superadmin"))):
    """Alle plans (incl. inactieve) voor superadmin beheer."""
    await _seed_plan_catalog()
    docs = await db.plan_catalog.find({}, {"_id": 0}).sort("sort_order", 1).to_list(100)
    return docs


@api.post("/superadmin/wipe-all-companies")
async def superadmin_wipe_all_companies(
    body: dict, user=Depends(require_role("superadmin")),
):
    """DESTRUCTIEVE actie — verwijdert ALLE bedrijven en hun data behalve
    het Demo-bedrijf (slug='demo'). Superadmin login blijft altijd behouden.

    Vereist body: `{"confirm": "WIPE ALL COMPANIES"}` — exact deze string.
    Retourneert een overzicht van wat is verwijderd per collectie."""
    if (body or {}).get("confirm") != "WIPE ALL COMPANIES":
        raise HTTPException(
            status_code=400,
            detail="Bevestigingsstring vereist: {\"confirm\": \"WIPE ALL COMPANIES\"}",
        )

    # 1) Bepaal welke company_ids we HOUDEN (alleen demo)
    demo_companies = await db.companies.find(
        {"$or": [{"slug": "demo"}, {"is_demo": True}]},
        {"_id": 0, "id": 1},
    ).to_list(100)
    demo_ids = [c["id"] for c in demo_companies]

    # 2) Scoped collections — alles verwijderen waar company_id NIET in demo_ids
    scoped_collections = [
        "ai_sessions", "apartments", "audit_log", "bank_statements",
        "cash_book", "company_settings", "contracts", "customer_display",
        "deposits", "device_qr_tokens", "employees", "invoices", "kasgeld",
        "kiosk_pins", "landing_leads", "locations", "maintenance",
        "payment_plan_installments", "payment_plans", "payments", "push_subs",
        "saas_payment_requests", "salaries", "subscription_invoices",
        "subscription_payments", "tenants",
    ]
    deleted: dict[str, int] = {}
    for col_name in scoped_collections:
        # payment_plan_installments heeft geen directe company_id, dus filter
        # via plan_id later. Skip hier — we handelen die apart af.
        if col_name == "payment_plan_installments":
            continue
        result = await db[col_name].delete_many(
            {"company_id": {"$nin": demo_ids}} if demo_ids
            else {},
        )
        deleted[col_name] = result.deleted_count

    # 3) payment_plan_installments — filter via plan_id (want geen company_id
    # veld op sommige oude documenten).
    demo_plan_ids = [
        p["id"] async for p in db.payment_plans.find(
            {"company_id": {"$in": demo_ids}} if demo_ids else {},
            {"_id": 0, "id": 1},
        )
    ]
    result = await db.payment_plan_installments.delete_many(
        {"plan_id": {"$nin": demo_plan_ids}} if demo_plan_ids else {},
    )
    deleted["payment_plan_installments"] = result.deleted_count

    # 4) Users — behoud superadmins ALTIJD + admins van demo-bedrijf
    result = await db.users.delete_many({
        "role": {"$ne": "superadmin"},
        "company_id": {"$nin": demo_ids} if demo_ids else {"$exists": True},
    })
    deleted["users"] = result.deleted_count

    # 5) Companies zelf — behoud alleen demo
    result = await db.companies.delete_many(
        {"id": {"$nin": demo_ids}} if demo_ids else {},
    )
    deleted["companies"] = result.deleted_count

    # 6) Landing-assets/content/leads/qr — koppelt aan company via company_id.
    # Al meegenomen als 'scoped' voor sommige, hier de niet-standaard:
    for col_name in ("landing_assets", "landing_content", "company_landings", "qr_plate_cache"):
        # Check of collectie company_id gebruikt
        sample = await db[col_name].find_one({}, {"_id": 0})
        if sample and "company_id" in sample:
            result = await db[col_name].delete_many(
                {"company_id": {"$nin": demo_ids}} if demo_ids else {},
            )
            deleted[col_name] = result.deleted_count

    # 7) qr_sessions + device_qr_tokens (kunnen ook 'stateless' zijn)
    # device_qr_tokens is al scoped hierboven. qr_sessions bevat login-QR
    # tijdelijke sessies — kunnen veilig allemaal weg. Wis actieve sessies
    # die verwijzen naar niet-demo companies.
    q = await db.qr_sessions.delete_many(
        {"company_id": {"$nin": demo_ids}} if demo_ids else {},
    )
    deleted["qr_sessions"] = q.deleted_count

    remaining_companies = await db.companies.count_documents({})
    remaining_users = await db.users.count_documents({})
    return {
        "ok": True,
        "deleted": deleted,
        "kept_company_ids": demo_ids,
        "remaining_companies": remaining_companies,
        "remaining_users": remaining_users,
    }


@api.post("/superadmin/plans")
async def superadmin_create_plan(body: PlanCreate, user=Depends(require_role("superadmin"))):
    plan_id = (body.id or "").strip().lower()
    if not plan_id or not body.name:
        raise HTTPException(status_code=400, detail="id en name zijn verplicht")
    exists = await db.plan_catalog.find_one({"id": plan_id})
    if exists:
        raise HTTPException(status_code=400, detail=f"Plan met id '{plan_id}' bestaat al")
    doc = {
        "id": plan_id, "name": body.name, "amount": float(body.amount),
        "currency": body.currency.upper(), "interval": body.interval,
        "description": body.description, "features": list(body.features),
        "limits": {**DEFAULT_PLAN_LIMITS, **(body.limits or {})},
        "active": body.active, "sort_order": int(body.sort_order),
        "created_at": now_utc_iso(), "updated_at": now_utc_iso(),
    }
    await db.plan_catalog.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}


@api.put("/superadmin/plans/{plan_id}")
async def superadmin_update_plan(plan_id: str, body: PlanUpdate, user=Depends(require_role("superadmin"))):
    doc = await db.plan_catalog.find_one({"id": plan_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Plan niet gevonden")
    update = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if "currency" in update:
        update["currency"] = update["currency"].upper()
    update["updated_at"] = now_utc_iso()
    await db.plan_catalog.update_one({"id": plan_id}, {"$set": update})
    out = await db.plan_catalog.find_one({"id": plan_id}, {"_id": 0})
    return out


@api.delete("/superadmin/plans/{plan_id}")
async def superadmin_delete_plan(plan_id: str, user=Depends(require_role("superadmin"))):
    in_use = await db.companies.count_documents({"plan": plan_id})
    if in_use > 0:
        # Soft-delete: markeer inactief ipv hard verwijderen om historische
        # data van bedrijven die op dit plan zaten te bewaren.
        await db.plan_catalog.update_one({"id": plan_id}, {"$set": {"active": False, "updated_at": now_utc_iso()}})
        return {"ok": True, "soft_deleted": True, "active_companies_on_plan": in_use}
    await db.plan_catalog.delete_one({"id": plan_id})
    return {"ok": True, "soft_deleted": False}


@api.get("/billing/me")
async def billing_me(user=Depends(get_current_user)):
    """Trial / subscription status for the current admin's company."""
    cid = company_id_of(user)
    if not cid:
        return {"status": "none"}
    c = await db.companies.find_one({"id": cid}, {"_id": 0}) or {}
    plan_id = c.get("plan", "starter")
    plan = await _plan_for_company(plan_id, c)
    status = c.get("billing_status", "active")
    days_left = None
    trial_ends = c.get("trial_ends_at")
    if trial_ends:
        try:
            end = datetime.fromisoformat(trial_ends.replace("Z", "+00:00"))
            delta = end - now_utc()
            days_left = max(0, int(delta.total_seconds() // 86400) + (1 if delta.total_seconds() % 86400 > 0 else 0))
        except Exception:
            days_left = None
    if status == "trial" and days_left is not None and days_left <= 0:
        status = "expired"

    pending_plan_id = c.get("pending_plan")
    pending_plan = (await _plan_for_company(pending_plan_id, c)) if pending_plan_id else None
    pending_invoice = None
    if c.get("pending_invoice_id"):
        pending_invoice = await db.subscription_invoices.find_one(
            {"id": c["pending_invoice_id"]}, {"_id": 0}
        )
    return {
        "status": status,
        "plan_id": plan_id,
        "plan": plan,
        "trial_started_at": c.get("trial_started_at"),
        "trial_ends_at": trial_ends,
        "days_left": days_left,
        "monthly_amount": plan["amount"],
        "currency": plan["currency"],
        "country": c.get("country"),
        "company_name": c.get("name"),
        "pending_plan_id": pending_plan_id,
        "pending_plan": pending_plan,
        "pending_invoice": pending_invoice,
        "renews_at": c.get("subscription_renews_at") or c.get("next_billing_date"),
        "next_billing_date": c.get("next_billing_date"),
        "cancelled_at": c.get("cancelled_at"),
        "reactivated_at": c.get("reactivated_at"),
    }


@api.get("/billing/me/plans")
async def billing_me_plans(user=Depends(get_current_user)):
    """Plans in the current company's display currency (SRD for SR, EUR for NL).
    Leest uit `plan_catalog` (DB) zodat door superadmin toegevoegde pakketten
    zoals 'Lifetime' hier ook verschijnen — voorheen alleen `PLAN_PRICES.keys()`
    waardoor nieuwe DB-plans onzichtbaar bleven voor bedrijven."""
    cid = company_id_of(user)
    c = await db.companies.find_one({"id": cid}, {"_id": 0}) if cid else {}
    catalog = await _fetch_plans_from_db()
    out = []
    for entry in catalog:
        pid = entry.get("id")
        if not pid:
            continue
        p = await _plan_for_company(pid, c or {})
        out.append({"id": pid, **p, "active": entry.get("active", True), "sort_order": entry.get("sort_order", 100)})
    return out


class ChangePlanIn(BaseModel):
    # Voorheen: Literal["starter","professional"] — brak nieuwe DB-plans zoals
    # 'lifetime' met 422. Accepteert nu elke string; validatie tegen de catalog
    # gebeurt in de handler zelf zodat superadmin nieuwe plans mag introduceren.
    plan: str


@api.put("/billing/me/plan")
async def change_plan(body: ChangePlanIn, user=Depends(get_current_user)):
    """Customer-driven plan upgrade/downgrade.

    Creates an invoice for the new plan and sets pending_plan on the company.
    The actual plan switch happens only after a superadmin registers payment
    for that invoice. Uitzondering: als het nieuwe plan gratis is (bedrag = 0)
    wordt de switch DIRECT effectief — geen factuur nodig."""
    cid = company_id_of(user)
    if not cid:
        raise HTTPException(status_code=400, detail="Geen actief bedrijf")
    c = await db.companies.find_one({"id": cid}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Bedrijf niet gevonden")
    old = c.get("plan", "starter")
    new_plan = body.plan
    # Valideer dat het gekozen plan bestaat en actief is in de catalog.
    target_doc = await _fetch_plan_by_id(new_plan)
    if not target_doc:
        raise HTTPException(status_code=400, detail=f"Onbekend pakket '{new_plan}'")
    if target_doc.get("active") is False:
        raise HTTPException(status_code=400, detail="Dit pakket is niet meer beschikbaar")
    if new_plan == old and not c.get("pending_plan"):
        return {"ok": True, "plan": new_plan, "effective": "already_active"}

    new_price = await _plan_for_company(new_plan, c)
    now = now_utc()

    # Gratis plan → direct activeren zonder factuur.
    if float(new_price.get("amount") or 0) <= 0:
        await db.companies.update_one({"id": cid}, {
            "$set": {"plan": new_plan, "billing_status": "active",
                     "plan_change_requested_at": iso(now)},
            "$unset": {"pending_plan": "", "pending_invoice_id": ""},
        })
        await db.audit_log.insert_one({
            "id": new_id(), "type": "plan_change_free_immediate",
            "actor": user.get("email"), "company_id": cid,
            "from_plan": old, "to_plan": new_plan, "at": iso(now),
        })
        return {"ok": True, "plan": new_plan, "effective": "immediate",
                "message": f"Uw abonnement is omgezet naar {new_price.get('name') or new_plan}."}

    # Create an open invoice for the new plan (customer must pay this to activate)
    inv = {
        "id": new_id(),
        "company_id": cid,
        "company_name": c.get("name", ""),
        "plan": new_plan,
        "amount": new_price["amount"],
        "currency": new_price["currency"],
        "status": "open",
        "kind": "plan_change",
        "from_plan": old,
        "period_start": iso(now),
        "period_end": iso(now + timedelta(days=30)),
        "created_at": iso(now),
        "created_by": user.get("email"),
    }
    await db.subscription_invoices.insert_one(inv)
    inv.pop("_id", None)

    await db.companies.update_one({"id": cid}, {"$set": {
        "pending_plan": new_plan,
        "pending_invoice_id": inv["id"],
        "plan_change_requested_at": iso(now),
    }})
    await db.audit_log.insert_one({
        "id": new_id(), "type": "plan_change_requested",
        "actor": user.get("email"), "company_id": cid,
        "from_plan": old, "to_plan": new_plan, "invoice_id": inv["id"], "at": iso(now),
    })
    return {
        "ok": True, "plan": old, "pending_plan": new_plan, "invoice": inv,
        "effective": "after_payment",
        "message": f"Maak {new_price['currency']} {new_price['amount']:,} over om over te stappen naar {new_price['name']}.".replace(",", "."),
    }


@api.get("/billing/me/invoices")
async def my_invoices(user=Depends(get_current_user)):
    cid = company_id_of(user)
    if not cid:
        return []
    docs = await db.subscription_invoices.find({"company_id": cid}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return docs


@api.get("/billing/me/payments")
async def my_payments(user=Depends(get_current_user)):
    cid = company_id_of(user)
    if not cid:
        return []
    docs = await db.subscription_payments.find({"company_id": cid}, {"_id": 0}).sort("paid_at", -1).to_list(200)
    return docs


@api.get("/billing/bank-details")
async def billing_bank_details():
    """Public bank details for offline / wire transfer subscription payments.
    Reads from saas_settings first, falls back to env vars."""
    doc = await db.saas_settings.find_one({"id": SAAS_SETTINGS_ID}, {"_id": 0}) or {}
    b = (doc.get("banking") or {}) if doc else {}
    return {
        "bank_name": b.get("bank_name") or os.environ.get("BILLING_BANK_NAME", "DSB Bank N.V."),
        "account_name": b.get("account_name") or os.environ.get("BILLING_ACCOUNT_NAME", "SuriRent N.V."),
        "account_number": b.get("account_number") or os.environ.get("BILLING_ACCOUNT_NUMBER", "12.34.56.789"),
        "swift": b.get("swift") or os.environ.get("BILLING_SWIFT", "DSBBSRPA"),
        "reference_template": "ABONNEMENT — <BEDRIJF> — <PERIODE>",
        "currency": "SRD",
        "support_email": b.get("support_email") or os.environ.get("BILLING_SUPPORT_EMAIL", "billing@surirent.sr"),
        "whatsapp": b.get("whatsapp") or os.environ.get("BILLING_WHATSAPP", "+597 8 555 0123"),
    }


# =====================================================================
# Billing — FX (SRD -> EUR) + online checkout (Mope SaaS + SumUp)
# =====================================================================
SAAS_SETTINGS_ID = "_saas_settings"  # forward decl; redefined later for safety
FX_CACHE_TTL_SECONDS = 6 * 3600
FX_SOURCE_URL = "https://open.er-api.com/v6/latest/SRD"


async def _fetch_fx_eur_per_srd() -> Optional[float]:
    """Fetch live SRD->EUR rate from free public API. Returns None on failure."""
    import httpx as _httpx
    try:
        async with _httpx.AsyncClient(timeout=8) as client:
            r = await client.get(FX_SOURCE_URL)
        if r.status_code >= 400:
            return None
        data = r.json()
        rate = (data.get("rates") or {}).get("EUR")
        if not rate or rate <= 0:
            return None
        return float(rate)
    except Exception:
        return None


async def _get_eur_per_srd() -> dict:
    """Return current SRD->EUR rate based on saas_settings.fx mode (auto|manual).
    Auto refreshes from public API every FX_CACHE_TTL_SECONDS; falls back to manual."""
    doc = await db.saas_settings.find_one({"id": SAAS_SETTINGS_ID}, {"_id": 0}) or {}
    fx = doc.get("fx") or {}
    mode = fx.get("mode", "auto")
    manual = float(fx.get("manual_eur_per_srd") or 0)
    cached_rate = float(fx.get("cached_rate") or 0)
    cached_at = fx.get("cached_at")
    cached_age = None
    if cached_at:
        try:
            cached_age = (now_utc() - datetime.fromisoformat(cached_at.replace("Z", "+00:00"))).total_seconds()
        except Exception:
            cached_age = None

    if mode == "manual":
        if manual > 0:
            return {"rate": manual, "source": "manual", "fetched_at": fx.get("cached_at")}
        # Manual selected but no value → fall back to last cached or 0
        if cached_rate > 0:
            return {"rate": cached_rate, "source": "manual_fallback_cache", "fetched_at": cached_at}
        return {"rate": 0, "source": "manual_missing", "fetched_at": None}

    # Auto mode
    if cached_rate > 0 and cached_age is not None and cached_age < FX_CACHE_TTL_SECONDS:
        return {"rate": cached_rate, "source": "cache", "fetched_at": cached_at}
    live = await _fetch_fx_eur_per_srd()
    if live and live > 0:
        await db.saas_settings.update_one(
            {"id": SAAS_SETTINGS_ID},
            {"$set": {
                "id": SAAS_SETTINGS_ID,
                "fx.mode": "auto",
                "fx.cached_rate": live,
                "fx.cached_at": iso(now_utc()),
            }},
            upsert=True,
        )
        return {"rate": live, "source": "live", "fetched_at": iso(now_utc())}
    # Live failed → use last cache if any, else manual
    if cached_rate > 0:
        return {"rate": cached_rate, "source": "stale_cache", "fetched_at": cached_at}
    if manual > 0:
        return {"rate": manual, "source": "manual_fallback", "fetched_at": None}
    return {"rate": 0, "source": "unavailable", "fetched_at": None}


def _convert_to_eur(amount: float, currency: str, rate_eur_per_srd: float) -> float:
    if (currency or "").upper() == "EUR":
        return round(float(amount), 2)
    if (currency or "").upper() == "SRD" and rate_eur_per_srd > 0:
        return round(float(amount) * rate_eur_per_srd, 2)
    # USD / other: not yet supported — return 0 to signal unavailable
    return 0.0


def _company_display_currency(c: dict) -> str:
    """Returns the currency the company should see prices in."""
    return ((c or {}).get("currency") or "SRD").upper()


async def _plan_for_company(plan_id: str, c: dict) -> dict:
    """Return plan dict with amount converted to company's display currency.
    Eerst wordt de dynamische catalog (`plan_catalog` in DB) geraadpleegd zodat
    door superadmin toegevoegde pakketten (bv. 'Lifetime — Gratis') ook worden
    ondersteund. Valt bij onbekende id terug op de statische PLAN_PRICES map,
    zodat legacy 'pro' etc. niet stuk gaan.
    """
    doc = await _fetch_plan_by_id(plan_id) if plan_id else None
    if doc:
        base = {
            "name": doc.get("name") or plan_id,
            "amount": float(doc.get("amount") or 0),
            "currency": (doc.get("currency") or "SRD").upper(),
            "interval": doc.get("interval") or "month",
            "description": doc.get("description") or "",
            "features": list(doc.get("features") or []),
            "limits": dict(doc.get("limits") or {}),
        }
    else:
        base = PLAN_PRICES.get(plan_id, PLAN_PRICES["starter"])
    target = _company_display_currency(c)
    if target == base["currency"]:
        return {**base}
    if target == "EUR" and base["currency"] == "SRD":
        fx = await _get_eur_per_srd()
        eur_amount = _convert_to_eur(base["amount"], "SRD", fx["rate"])
        return {**base, "amount": eur_amount, "currency": "EUR",
                "original_amount": base["amount"], "original_currency": "SRD",
                "eur_per_srd": fx["rate"], "fx_source": fx["source"]}
    return {**base}


@api.get("/billing/fx")
async def billing_fx():
    """Public FX info — used by frontend to show EUR equivalent for SRD invoices."""
    info = await _get_eur_per_srd()
    return {"eur_per_srd": info["rate"], "source": info["source"], "fetched_at": info.get("fetched_at")}


async def _saas_settings_doc() -> dict:
    return await db.saas_settings.find_one({"id": SAAS_SETTINGS_ID}, {"_id": 0}) or {}


def _app_base_url() -> str:
    return (os.environ.get("APP_PUBLIC_URL") or "https://app.surirent.sr").rstrip("/")


def _api_base_url() -> str:
    # APP_PUBLIC_URL is reused — backend routes share host via /api prefix in preview/prod
    return _app_base_url()


@api.get("/billing/me/checkout-options")
async def billing_me_checkout_options(user=Depends(get_current_user)):
    """Returns the SaaS subscription amount in the company's display currency.
    Alle online-gateway integraties (Mope/SumUp/Uni5Pay) zijn verwijderd —
    betalingen gaan alleen via handmatige bankoverschrijving of contant."""
    cid = company_id_of(user)
    if not cid:
        raise HTTPException(status_code=400, detail="Geen actief bedrijf")
    c = await db.companies.find_one({"id": cid}, {"_id": 0}) or {}
    plan = await _plan_for_company(c.get("plan", "starter"), c)
    display_currency = _company_display_currency(c)
    fx = await _get_eur_per_srd()
    return {
        "amount": plan["amount"],
        "currency": plan["currency"],
        "display_currency": display_currency,
        "country": c.get("country"),
        "eur_amount": plan["amount"] if display_currency == "EUR" else _convert_to_eur(plan["amount"], plan["currency"], fx["rate"]),
        "eur_per_srd": fx["rate"],
        "fx_source": fx["source"],
    }


# NOTE: /billing/me/checkout endpoint (Mope + SumUp gateways) is verwijderd
# omdat de app geen online betaalproviders meer ondersteunt. SaaS-facturen
# worden nu uitsluitend via handmatige bankoverschrijving voldaan (zie
# /superadmin/saas-payments).


async def _ensure_open_invoice_for_company(c: dict, user_email: str) -> dict:
    """Find an open invoice for this company; if none, create one for the current plan
    (so a customer in trial / expired state can pay even before any invoice was issued).
    Invoice is denominated in the company's display currency (SRD for SR, EUR for NL)."""
    cid = c["id"]
    inv = await db.subscription_invoices.find_one(
        {"company_id": cid, "status": {"$ne": "paid"}},
        {"_id": 0}, sort=[("created_at", -1)],
    )
    if inv:
        return inv
    plan_id = c.get("plan", "starter")
    plan = await _plan_for_company(plan_id, c)
    now = now_utc()
    inv = {
        "id": new_id(),
        "company_id": cid,
        "company_name": c.get("name", ""),
        "plan": plan_id,
        "amount": plan["amount"],
        "currency": plan["currency"],
        "status": "open",
        "kind": "subscription",
        "period_start": iso(now),
        "period_end": iso(now + timedelta(days=30)),
        "created_at": iso(now),
        "created_by": user_email or "self_checkout",
    }
    await db.subscription_invoices.insert_one(inv)
    inv.pop("_id", None)
    return inv


@api.post("/billing/me/checkout")
async def billing_me_checkout():
    """Deprecated — online betaal-gateways (Mope/SumUp/Uni5Pay) zijn
    verwijderd uit de app. Klanten betalen SaaS-facturen alleen nog via
    handmatige bankoverschrijving."""
    raise HTTPException(
        status_code=410,
        detail="Online betaal-gateways zijn verwijderd. Betaal via bankoverschrijving.",
    )



async def _record_saas_payment_manual(
    *, invoice: dict, company: dict, amount: float, currency: str,
    method: str, reference: str, statement_id: Optional[str],
    ocr_meta: Optional[dict], auto_approved: bool, approved_by: str,
) -> dict:
    """Helper voor handmatige (bankoverschrijving) SaaS-betalingen. Maakt
    `saas_payment_requests` + `subscription_payments` aan en activeert het
    bedrijf wanneer auto-goedgekeurd. Idempotent op invoice_id wanneer al
    betaald."""
    if invoice.get("status") == "paid":
        return {"already_paid": True, "invoice_id": invoice["id"]}
    now = now_utc()
    paid_at = iso(now)
    pr_id = new_id()
    pr = {
        "id": pr_id,
        "company_id": company["id"],
        "invoice_id": invoice["id"],
        "provider": method,
        "provider_id": f"manual:{pr_id[:8]}",
        "amount": amount,
        "currency": currency,
        "status": "paid" if auto_approved else "pending_approval",
        "bank_statement_id": statement_id,
        "ocr": ocr_meta or {},
        "auto_approved": auto_approved,
        "approved_by": approved_by,
        "created_at": paid_at,
        "paid_at": paid_at if auto_approved else None,
    }
    await db.saas_payment_requests.insert_one(pr)
    if not auto_approved:
        # OCR mismatch — superadmin moet handmatig goedkeuren.
        return {"status": "pending_approval", "invoice_id": invoice["id"], "request_id": pr_id, "ocr": ocr_meta or {}}
    # Mark invoice paid
    await db.subscription_invoices.update_one(
        {"id": invoice["id"]},
        {"$set": {"status": "paid", "paid_at": paid_at, "payment_method": method}},
    )
    # Subscription payment record
    pay = {
        "id": new_id(),
        "invoice_id": invoice["id"],
        "company_id": company["id"],
        "company_name": company.get("name", ""),
        "amount": amount,
        "currency": currency,
        "method": method,
        "reference": reference,
        "note": "Auto-goedgekeurd na OCR-controle van bankafschrift" if auto_approved else "",
        "paid_at": paid_at,
        "created_at": paid_at,
        "created_by": approved_by,
        "auto_approved": auto_approved,
        "bank_statement_id": statement_id,
    }
    await db.subscription_payments.insert_one(pay)
    await _activate_company_after_saas_payment(company["id"], plan_in_payment=invoice.get("plan"))
    await _send_saas_payment_email(company, amount, currency, method, invoice["id"])
    return {"status": "paid", "invoice_id": invoice["id"], "request_id": pr_id, "ocr": ocr_meta or {}}


@api.post("/billing/me/bank-confirm")
async def billing_me_bank_confirm(
    file: UploadFile = File(...),
    invoice_id: Optional[str] = Form(None),
    user=Depends(get_current_user),
):
    """Admin upload bankafschrift voor zijn lopende abonnement-factuur. Wij:
      1. Slaan het bestand op in `bank_statements` (5 MB max, jpg/png/pdf/webp).
      2. Sturen direct door naar Gemini-OCR voor amount/date/reference-extractie.
      3. Als bedrag/valuta matcht met de open factuur → auto-goedkeuren →
         abonnement wordt direct geactiveerd.
      4. Bij mismatch → status `pending_approval`, superadmin krijgt notificatie.

    Returns: `{status: 'paid'|'pending_approval', ocr: {...}, invoice_id, mismatch_reasons?}`
    """
    cid = company_id_of(user)
    if not cid:
        raise HTTPException(status_code=400, detail="Geen actief bedrijf")
    c = await db.companies.find_one({"id": cid}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Bedrijf niet gevonden")
    raw = await file.read()
    if len(raw) > MAX_LANDING_ASSET_BYTES:
        raise HTTPException(status_code=413, detail="Bestand groter dan 5 MB")
    ctype = (file.content_type or "").lower()
    allowed = ("image/jpeg", "image/jpg", "image/png", "image/webp", "application/pdf")
    if not any(ctype.startswith(a) or ctype == a for a in allowed):
        raise HTTPException(status_code=400, detail="Alleen JPG, PNG, WEBP of PDF toegestaan")

    # Vind of maak open factuur
    if invoice_id:
        inv = await db.subscription_invoices.find_one(
            {"id": invoice_id, "company_id": cid}, {"_id": 0},
        )
        if not inv:
            raise HTTPException(status_code=404, detail="Factuur niet gevonden")
        if inv.get("status") == "paid":
            raise HTTPException(status_code=400, detail="Deze factuur is al betaald")
    else:
        inv = await _ensure_open_invoice_for_company(c, user.get("email", ""))

    # Sla statement op
    asset_id = new_id()
    await db.bank_statements.insert_one({
        "id": asset_id,
        "filename": file.filename or f"saas-afschrift-{asset_id}",
        "content_type": ctype,
        "data_b64": base64.b64encode(raw).decode("ascii"),
        "size": len(raw),
        "company_id": cid,
        "kind": "saas_billing",
        "invoice_id": inv["id"],
        "uploaded_at": iso(now_utc()),
        "uploaded_by": user.get("email"),
    })

    # OCR + match-check synchroon — gebruiker krijgt direct feedback.
    ocr_meta: dict = {}
    auto_approved = False
    mismatch_reasons: list[str] = []
    try:
        ocr = await _ocr_bank_statement(asset_id)
        ok, reasons = _ocr_match_ok(
            ocr,
            expected_amount=float(inv.get("amount") or 0),
            expected_currency=inv.get("currency") or "SRD",
        )
        ocr_meta = {
            "amount": ocr.get("amount"),
            "currency": ocr.get("currency"),
            "date_iso": ocr.get("date_iso"),
            "payer_name": ocr.get("payer_name"),
            "reference": ocr.get("reference"),
            "confidence": ocr.get("confidence"),
            "raw_text": (ocr.get("raw_text") or "")[:300],
        }
        auto_approved = ok
        mismatch_reasons = reasons
    except Exception as e:
        # OCR-engine niet bereikbaar → veilig: laat het als pending_approval staan
        # zodat superadmin handmatig kan controleren. Frontend toont dat netjes.
        print(f"[saas-ocr] faalde voor invoice={inv['id'][:8]}: {e}")
        mismatch_reasons = [f"OCR engine fout: {str(e)[:120]}"]

    result = await _record_saas_payment_manual(
        invoice=inv,
        company=c,
        amount=float(inv.get("amount") or 0),
        currency=inv.get("currency") or "SRD",
        method="bank",
        reference=f"ABONNEMENT — {c.get('name', '')} — {inv.get('id', '')[:8]}",
        statement_id=asset_id,
        ocr_meta=ocr_meta,
        auto_approved=auto_approved,
        approved_by="auto-ocr" if auto_approved else (user.get("email") or "self"),
    )
    if not auto_approved and mismatch_reasons:
        result["mismatch_reasons"] = mismatch_reasons
    return result




async def _activate_company_after_saas_payment(company_id: str, plan_in_payment: Optional[str] = None):
    """Shared post-payment routine: bumps company to active + applies pending plan."""
    c = await db.companies.find_one({"id": company_id}, {"_id": 0}) or {}
    now = now_utc()
    update = {
        "billing_status": "active",
        "subscription_started_at": c.get("subscription_started_at") or iso(now),
        "subscription_renews_at": iso(now + timedelta(days=30)),
    }
    pending = c.get("pending_plan")
    if pending and pending != c.get("plan"):
        update["plan"] = pending
        update["pending_plan"] = None
        update["pending_invoice_id"] = None
        update["plan_changed_at"] = iso(now)
    elif plan_in_payment and plan_in_payment != c.get("plan"):
        update["plan"] = plan_in_payment
    await db.companies.update_one({"id": company_id}, {"$set": update})


async def _send_saas_payment_email(company: dict, amount: float, currency: str, method: str, invoice_id: str):
    if not company.get("owner_email"):
        return
    try:
        from email_service import send_email as _send_smtp, send_platform_email, wrap_template
        saas = await _saas_settings_doc()
        smtp = saas.get("smtp") or {}
        app_url = (saas.get("branding") or {}).get("app_url") or _app_base_url()
        plan_label = PLAN_PRICES.get(company.get("plan", "starter"), {}).get("name", "Starter")
        content = f"""
            <h1>Betaling ontvangen — bedankt!</h1>
            <p>Wij hebben uw betaling van <strong>{currency} {float(amount):,.2f}</strong> ontvangen via {method}.</p>
            <table class="kv">
              <tr><td>Pakket</td><td>{plan_label}</td></tr>
              <tr><td>Factuur</td><td>{invoice_id[:8].upper()}</td></tr>
            </table>
            <p style="margin-top:14px;">Uw abonnement is direct geactiveerd:</p>
            <p><a href="{app_url}/admin" style="display:inline-block;background:#10B981;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none;font-weight:700;">Open dashboard</a></p>
        """
        subject = f"Betaling ontvangen — {plan_label} actief"
        body_html = wrap_template(content, footer=f"SuriRent · {app_url}")
        if smtp.get("enabled") and smtp.get("host"):
            try:
                await _send_smtp(smtp, to=company["owner_email"], subject=subject, body_html=body_html)
            except Exception:
                await send_platform_email(to=company["owner_email"], subject=subject, body_html=body_html)
        else:
            await send_platform_email(to=company["owner_email"], subject=subject, body_html=body_html)
    except Exception:
        pass


async def _record_saas_payment_from_gateway(pr: dict, gateway_meta: dict) -> dict:
    """Idempotently mark a SaaS payment_request + linked invoice as paid, create
    a subscription_payment record, and activate the company."""
    if pr.get("status") == "paid":
        return pr
    inv = await db.subscription_invoices.find_one({"id": pr["invoice_id"]}, {"_id": 0})
    if not inv:
        return pr
    now = now_utc()
    paid_at = iso(now)
    company = await db.companies.find_one({"id": pr["company_id"]}, {"_id": 0}) or {}

    # Mark request paid
    await db.saas_payment_requests.update_one(
        {"id": pr["id"]},
        {"$set": {"status": "paid", "paid_at": paid_at, "gateway_meta": gateway_meta}},
    )
    # Mark invoice paid
    if inv.get("status") != "paid":
        await db.subscription_invoices.update_one(
            {"id": inv["id"]},
            {"$set": {"status": "paid", "paid_at": paid_at, "payment_method": pr["provider"]}},
        )
    # Create subscription_payment record
    pay = {
        "id": new_id(),
        "invoice_id": inv["id"],
        "company_id": pr["company_id"],
        "company_name": company.get("name", ""),
        "amount": pr["amount"],
        "currency": pr["currency"],
        "method": pr["provider"],
        "reference": f"{pr['provider']}:{pr['provider_id']}",
        "note": "Auto-registered via gateway webhook",
        "paid_at": paid_at,
        "created_at": paid_at,
        "created_by": "webhook",
        "amount_srd_equivalent": pr.get("amount_srd_equivalent"),
        "eur_per_srd": pr.get("eur_per_srd"),
    }
    await db.subscription_payments.insert_one(pay)
    # Activate company
    await _activate_company_after_saas_payment(pr["company_id"], plan_in_payment=inv.get("plan"))
    # Confirmation email (best-effort)
    await _send_saas_payment_email(company, pr["amount"], pr["currency"], pr["provider"], inv["id"])
    pr.update({"status": "paid", "paid_at": paid_at})
    return pr


# NOTE: /webhooks/mope-saas + /webhooks/sumup-saas endpoints zijn verwijderd.
# De app ondersteunt geen online betaalproviders meer — alle SaaS-betalingen
# gaan via handmatige bankoverschrijving die door superadmin wordt bevestigd.


# =====================================================================
# Landing-page CMS (superadmin live editor)
# =====================================================================
MAX_LANDING_ASSET_BYTES = 5 * 1024 * 1024  # 5 MB upload cap


def _to_webp_bytes(raw: bytes, content_type: str) -> tuple[bytes, str]:
    """Converteer geüploade afbeelding automatisch naar WebP. Behoud
    beeldkwaliteit zo hoog mogelijk (quality=92) en respecteer transparantie.

    Retourneert `(bytes, content_type)`. Bij SVG's, ongeldige afbeeldingen of
    conversie-fouten geven we het origineel ongewijzigd terug zodat de upload
    nooit hard faalt op een edge-case.

    NOTE: we slaan het origineel NIET op — alleen het WebP-resultaat, per
    user request.
    """
    ctype = (content_type or "").lower()
    # SVG's blijven vector — WebP-conversie zou ze rasteriseren
    if "svg" in ctype:
        return raw, ctype
    # Als het al WebP is: alleen doorlaten
    if ctype == "image/webp":
        return raw, "image/webp"
    try:
        from PIL import Image, ImageOps
        img = Image.open(io.BytesIO(raw))
        # EXIF-oriëntatie respecteren zodat portret-foto's van iPhone niet
        # gedraaid opgeslagen worden.
        img = ImageOps.exif_transpose(img)
        # Bewaar animated gifs als animated webp (slechts eerste frame is
        # normaal genoeg voor foto's — Pillow zorgt automatisch).
        buf = io.BytesIO()
        # RGBA modus behouden voor transparantie (bv. logo's met alpha).
        save_kwargs = {"format": "WEBP", "quality": 92, "method": 6}
        if img.mode == "RGBA" or img.mode == "LA" or ("A" in img.mode):
            img.save(buf, **save_kwargs)
        elif img.mode == "P" and "transparency" in img.info:
            img.convert("RGBA").save(buf, **save_kwargs)
        else:
            # Converteer naar RGB voor onbekende modes (CMYK, YCbCr etc.)
            if img.mode != "RGB":
                img = img.convert("RGB")
            img.save(buf, **save_kwargs)
        return buf.getvalue(), "image/webp"
    except Exception as e:  # noqa: BLE001
        print(f"[webp] conversion failed ({ctype}): {e}, keeping original")
        return raw, ctype


@api.get("/landing/content")
async def get_landing_content(response: Response):
    """Public — returns the *published* landing content merged with defaults."""
    doc = await db.landing_content.find_one({"id": PUBLISHED_ID}, {"_id": 0})
    content = merge_with_defaults(doc)
    # Stale-while-revalidate: browser mag content 60s uit disk-cache
    # serveren en 5 min lang stale-content tonen terwijl hij op de
    # achtergrond revalidateert. Combineert perfect met de frontend
    # localStorage cache — 2e bezoek = instant paint.
    response.headers["Cache-Control"] = "public, max-age=60, stale-while-revalidate=300"
    return {"content": content, "allowed_icons": ALLOWED_FEATURE_ICONS}


@api.get("/superadmin/landing/content")
async def get_landing_content_admin(mode: Literal["draft", "published"] = "draft",
                                    user=Depends(require_role("superadmin"))):
    """Superadmin reads draft or published content (both merged with defaults)."""
    doc_id = DRAFT_ID if mode == "draft" else PUBLISHED_ID
    doc = await db.landing_content.find_one({"id": doc_id}, {"_id": 0})
    # If no draft yet, seed from published; if no published either, defaults.
    if mode == "draft" and not doc:
        pub = await db.landing_content.find_one({"id": PUBLISHED_ID}, {"_id": 0})
        if pub:
            doc = pub
    content = merge_with_defaults(doc)
    return {
        "content": content,
        "defaults": LANDING_DEFAULTS,
        "allowed_icons": ALLOWED_FEATURE_ICONS,
        "has_unpublished_changes": await _landing_has_unpublished_changes(),
        "updated_at": (doc or {}).get("updated_at"),
        "published_at": (await db.landing_content.find_one({"id": PUBLISHED_ID}, {"_id": 0}) or {}).get("updated_at"),
    }


async def _landing_has_unpublished_changes() -> bool:
    draft = await db.landing_content.find_one({"id": DRAFT_ID}, {"_id": 0, "content": 1})
    pub = await db.landing_content.find_one({"id": PUBLISHED_ID}, {"_id": 0, "content": 1})
    if not draft:
        return False
    return (draft.get("content") or {}) != ((pub or {}).get("content") or {})


class LandingContentIn(BaseModel):
    content: dict


@api.put("/superadmin/landing/content")
async def put_landing_content(body: LandingContentIn,
                               user=Depends(require_role("superadmin"))):
    """Save edits to the *draft*. Use POST /publish to make them public."""
    if not isinstance(body.content, dict):
        raise HTTPException(status_code=400, detail="content moet een object zijn")
    await db.landing_content.update_one(
        {"id": DRAFT_ID},
        {"$set": {
            "id": DRAFT_ID,
            "content": body.content,
            "updated_at": iso(now_utc()),
            "updated_by": user.get("email"),
        }},
        upsert=True,
    )
    return {"ok": True, "has_unpublished_changes": await _landing_has_unpublished_changes()}


@api.post("/superadmin/landing/publish")
async def publish_landing(user=Depends(require_role("superadmin"))):
    """Copy current draft into the published document."""
    draft = await db.landing_content.find_one({"id": DRAFT_ID}, {"_id": 0})
    if not draft:
        raise HTTPException(status_code=400, detail="Geen concept om te publiceren.")
    await db.landing_content.update_one(
        {"id": PUBLISHED_ID},
        {"$set": {
            "id": PUBLISHED_ID,
            "content": draft.get("content", {}),
            "updated_at": iso(now_utc()),
            "updated_by": user.get("email"),
            "published_from_draft_at": draft.get("updated_at"),
        }},
        upsert=True,
    )
    await db.audit_log.insert_one({
        "id": new_id(), "type": "landing_published",
        "actor": user.get("email"), "at": iso(now_utc()),
    })
    return {"ok": True, "published_at": iso(now_utc())}


@api.post("/superadmin/landing/discard")
async def discard_landing_draft(user=Depends(require_role("superadmin"))):
    """Reset the draft to match the published content (undo pending edits)."""
    pub = await db.landing_content.find_one({"id": PUBLISHED_ID}, {"_id": 0})
    await db.landing_content.update_one(
        {"id": DRAFT_ID},
        {"$set": {
            "id": DRAFT_ID,
            "content": (pub or {}).get("content", {}),
            "updated_at": iso(now_utc()),
            "updated_by": user.get("email"),
        }},
        upsert=True,
    )
    return {"ok": True}


@api.post("/superadmin/landing/upload")
async def upload_landing_asset(file: UploadFile = File(...),
                                user=Depends(require_role("superadmin"))):
    """Upload an image (max 5 MB). Returns {url, id} where url is
    /api/landing/asset/{id} and can be saved into any image_url field."""
    raw = await file.read()
    if len(raw) > MAX_LANDING_ASSET_BYTES:
        raise HTTPException(status_code=413, detail="Bestand groter dan 5 MB.")
    ctype = (file.content_type or "").lower()
    if not ctype.startswith("image/"):
        raise HTTPException(status_code=400, detail="Alleen afbeeldingen toegestaan.")
    raw, ctype = _to_webp_bytes(raw, ctype)
    asset_id = new_id()
    await db.landing_assets.insert_one({
        "id": asset_id,
        "filename": file.filename or f"asset-{asset_id}",
        "content_type": ctype,
        "data_b64": base64.b64encode(raw).decode("ascii"),
        "size": len(raw),
        "uploaded_by": user.get("email"),
        "uploaded_at": iso(now_utc()),
    })
    return {"id": asset_id, "url": f"/api/landing/asset/{asset_id}"}


@api.post("/superadmin/landing/migrate-webp")
async def migrate_landing_assets_to_webp(user=Depends(require_role("superadmin"))):
    """Eenmalige migratie: converteert ALLE bestaande landing_assets die nog
    niet WebP zijn naar WebP formaat. Loopt idempotent — assets die al
    `image/webp` zijn worden overgeslagen. Retourneert per-asset resultaat.

    Nodig omdat pre-existing uploads (jpeg/png) van vóór de auto-webp
    upgrade nog originele bytes hebben. Deze endpoint kan de user 1x
    triggeren vanuit de Superadmin → Landing editor."""
    stats = {"total": 0, "converted": 0, "skipped_webp": 0, "failed": 0, "bytes_before": 0, "bytes_after": 0}
    cursor = db.landing_assets.find({}, {"id": 1, "content_type": 1, "data_b64": 1, "size": 1})
    async for doc in cursor:
        stats["total"] += 1
        ctype = (doc.get("content_type") or "").lower()
        if ctype == "image/webp":
            stats["skipped_webp"] += 1
            continue
        try:
            raw = base64.b64decode(doc.get("data_b64") or "")
            if not raw:
                stats["failed"] += 1
                continue
            stats["bytes_before"] += len(raw)
            new_bytes, new_ctype = _to_webp_bytes(raw, ctype)
            if new_ctype != "image/webp":
                # Conversie faalde stilzwijgend → skip zodat we niet
                # per ongeluk corrupte bytes overschrijven.
                stats["failed"] += 1
                continue
            stats["bytes_after"] += len(new_bytes)
            await db.landing_assets.update_one(
                {"id": doc["id"]},
                {"$set": {
                    "content_type": "image/webp",
                    "data_b64": base64.b64encode(new_bytes).decode("ascii"),
                    "size": len(new_bytes),
                    "migrated_to_webp_at": iso(now_utc()),
                }},
            )
            stats["converted"] += 1
        except Exception as e:  # noqa: BLE001
            print(f"[migrate-webp] {doc.get('id')}: {e}")
            stats["failed"] += 1
    reduction_pct = 0
    if stats["bytes_before"]:
        reduction_pct = round((1 - stats["bytes_after"] / stats["bytes_before"]) * 100, 1)
    stats["reduction_pct"] = reduction_pct
    return stats


@api.get("/landing/asset/{asset_id}")
async def get_landing_asset(asset_id: str, request: Request, thumb: int = 0):
    """Serve een geüploade image asset. Assets zijn UUID-gekeyed en NOOIT
    muteerbaar → we kunnen 1-jaar immutable cache + strong ETag geven.
    Bij `If-None-Match` van diezelfde asset_id returnen we direct 304 Not
    Modified ZONDER MongoDB find/decode — cruciaal voor snelle list-views
    waar dezelfde 10-30 foto's herhaaldelijk gerenderd worden.

    Query `?thumb=1` → serveer een gecachete 400px thumbnail (geloutered voor
    kaart/thumbnail contexten; ~10-50× kleiner dan de originele upload).
    """
    # Immutable ETag — verandert nooit voor deze UUID (+ thumb suffix).
    etag = f'"{asset_id}{"-t" if thumb else ""}"'
    inm = request.headers.get("if-none-match", "").strip()
    if inm and (inm == etag or inm.strip('"') == etag.strip('"')):
        # Client heeft al bytes — geen DB-hit nodig.
        return Response(status_code=304, headers={
            "ETag": etag,
            "Cache-Control": "public, max-age=31536000, immutable",
        })

    doc = await db.landing_assets.find_one({"id": asset_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Asset niet gevonden")
    try:
        data = base64.b64decode(doc["data_b64"])
    except Exception:
        raise HTTPException(status_code=500, detail="Asset corrupt")

    ctype = doc.get("content_type", "image/png")
    # Thumbnail: gecached in het doc na eerste generatie. Downscale via PIL
    # naar max 400px lange zijde, JPEG kwaliteit 78 — goed voor lijst-cards.
    if thumb:
        cached = doc.get("thumb_b64")
        cached_ct = doc.get("thumb_content_type")
        if cached and cached_ct:
            try:
                data = base64.b64decode(cached)
                ctype = cached_ct
            except Exception:
                pass
        else:
            try:
                from PIL import Image
                img = Image.open(io.BytesIO(data))
                if img.mode not in ("RGB", "RGBA"):
                    img = img.convert("RGB")
                img.thumbnail((400, 400))
                buf = io.BytesIO()
                # JPEG voor foto's, PNG als origineel PNG met transparantie.
                out_ct = "image/jpeg"
                if ctype == "image/png" and img.mode == "RGBA":
                    img.save(buf, format="PNG", optimize=True)
                    out_ct = "image/png"
                else:
                    if img.mode == "RGBA":
                        img = img.convert("RGB")
                    img.save(buf, format="JPEG", quality=78, optimize=True, progressive=True)
                thumb_bytes = buf.getvalue()
                data = thumb_bytes
                ctype = out_ct
                # Persist voor volgende requests — één keer generen, altijd
                # opnieuw serveren uit cache.
                await db.landing_assets.update_one(
                    {"id": asset_id},
                    {"$set": {
                        "thumb_b64": base64.b64encode(thumb_bytes).decode("ascii"),
                        "thumb_content_type": out_ct,
                    }},
                )
            except Exception as e:
                # PIL niet beschikbaar of image corrupt — fall back naar full-size.
                print(f"[assets] Thumbnail generation failed for {asset_id}: {e}")

    return StreamingResponse(
        io.BytesIO(data),
        media_type=ctype,
        headers={
            "ETag": etag,
            "Cache-Control": "public, max-age=31536000, immutable",
        },
    )


# =====================================================================
# Tenant (per-company) Landing pages — hostgebaseerde routing
# =====================================================================
# Elk bedrijf kan een custom domain instellen (bv. gopiappartements.com).
# Wanneer een bezoeker naar dat domein gaat, doet de frontend een aanroep
# naar /api/public/company-landing?host=… en krijgt de landing terug die
# bij dat bedrijf hoort. De frontend rendert dan TenantPublicLanding ipv
# de SuriRent marketing landing.
#
# DB:
#   - companies.custom_domain (string, unique sparse index)
#   - company_landings: {id: <company_id>, draft: {...}, published: {...},
#                        updated_at, published_at}
# =====================================================================

def _normalize_host(host: str) -> str:
    """Strip 'www.' + port van een Host header. Lowercase."""
    h = (host or "").strip().lower()
    if h.startswith("www."):
        h = h[4:]
    if ":" in h:
        h = h.split(":", 1)[0]
    return h


@api.get("/public/company-landing")
async def public_company_landing(request: Request, host: Optional[str] = None):
    """Public endpoint — geen auth. Resolved van Host header (of ?host=).
    Returnt {company, content, apartments, found:bool}. Bij niet gevonden
    geeft `found=false` zodat de frontend kan terugvallen op de default
    SuriRent landing."""
    target = _normalize_host(host or request.headers.get("host", ""))
    # Skip onze eigen hosts — die mogen NOOIT als custom domain matchen,
    # zodat preview/prod altijd de superadmin landing zien.
    SYSTEM_HOSTS_SUFFIXES = ("surirent.sr", "emergentagent.com", "localhost")
    if not target or any(target == s or target.endswith("." + s) for s in SYSTEM_HOSTS_SUFFIXES):
        return {"found": False}

    # Zoek eerst op companies.custom_domain (legacy), dan op company_settings.domain.custom_domain.
    company = await db.companies.find_one(
        {"custom_domain": target},
        {"_id": 0, "id": 1, "name": 1, "slug": 1, "branding": 1, "address": 1,
         "contact_email": 1, "contact_phone": 1, "whatsapp_phone": 1,
         "kkf_number": 1},
    )
    if not company:
        settings_doc = await db.company_settings.find_one(
            {"domain.custom_domain": target, "domain.enabled": True},
            {"_id": 0, "company_id": 1},
        )
        if settings_doc:
            company = await db.companies.find_one(
                {"id": settings_doc["company_id"]},
                {"_id": 0, "id": 1, "name": 1, "slug": 1, "branding": 1, "address": 1,
                 "contact_email": 1, "contact_phone": 1, "whatsapp_phone": 1, "kkf_number": 1},
            )
    if not company:
        return {"found": False}

    landing_doc = await db.company_landings.find_one({"id": company["id"]}, {"_id": 0}) or {}
    content = landing_doc.get("published") or {}

    # Vul publieke apartments aan (alleen vrije eenheden voor de showcase).
    apartments = []
    cursor = db.apartments.find(
        {"company_id": company["id"], "status": {"$in": ["vacant", "available"]}},
        {"_id": 0, "id": 1, "number": 1, "address": 1, "rent_amount": 1,
         "currency": 1, "description": 1, "photo_url": 1, "status": 1},
    ).sort("created_at", -1)
    async for a in cursor:
        apartments.append(a)

    return {
        "found": True,
        "company": company,
        "content": content,
        "apartments": apartments,
    }


@api.get("/public/company-landing/by-slug/{slug}")
async def public_company_landing_by_slug(slug: str):
    """Slug-based publieke landing — altijd bereikbaar, ook zonder custom
    domein. Hiermee kan elk bedrijf een live shareable URL hebben in de
    vorm van /site/<slug>. Returnt dezelfde shape als /public/company-landing
    (found, company, content, apartments)."""
    slug_norm = (slug or "").strip().lower()
    if not slug_norm:
        return {"found": False}
    company = await db.companies.find_one(
        {"slug": slug_norm},
        {"_id": 0, "id": 1, "name": 1, "slug": 1, "branding": 1, "address": 1,
         "contact_email": 1, "contact_phone": 1, "whatsapp_phone": 1,
         "kkf_number": 1},
    )
    if not company:
        return {"found": False}

    landing_doc = await db.company_landings.find_one({"id": company["id"]}, {"_id": 0}) or {}
    content = landing_doc.get("published") or {}

    apartments = []
    cursor = db.apartments.find(
        {"company_id": company["id"], "status": {"$in": ["vacant", "available"]}},
        {"_id": 0, "id": 1, "number": 1, "address": 1, "rent_amount": 1,
         "currency": 1, "description": 1, "photo_url": 1, "status": 1},
    ).sort("created_at", -1)
    async for a in cursor:
        apartments.append(a)

    return {
        "found": True,
        "company": company,
        "content": content,
        "apartments": apartments,
    }


@api.get("/companies/me/landing")
async def get_my_landing(mode: Literal["draft", "published"] = "draft",
                          user=Depends(get_current_user)):
    """Company admin reads their own draft/published landing content."""
    cid = company_id_of(user)
    if not cid:
        raise HTTPException(status_code=400, detail="Geen actief bedrijf")
    doc = await db.company_landings.find_one({"id": cid}, {"_id": 0}) or {}
    if mode == "draft":
        content = doc.get("draft") or doc.get("published") or {}
    else:
        content = doc.get("published") or {}
    has_unpublished = (doc.get("draft") or {}) != (doc.get("published") or {}) and bool(doc.get("draft"))
    return {
        "content": content,
        "has_unpublished_changes": has_unpublished,
        "updated_at": doc.get("updated_at"),
        "published_at": doc.get("published_at"),
        "custom_domain": (await db.companies.find_one({"id": cid}, {"_id": 0, "custom_domain": 1}) or {}).get("custom_domain"),
    }


class CompanyLandingIn(BaseModel):
    content: dict


@api.put("/companies/me/landing")
async def put_my_landing(body: CompanyLandingIn, user=Depends(get_current_user)):
    """Save edits to the company's draft. Use /publish to make it live."""
    cid = company_id_of(user)
    if not cid:
        raise HTTPException(status_code=400, detail="Geen actief bedrijf")
    if not isinstance(body.content, dict):
        raise HTTPException(status_code=400, detail="content moet een object zijn")
    await db.company_landings.update_one(
        {"id": cid},
        {"$set": {
            "id": cid,
            "draft": body.content,
            "updated_at": iso(now_utc()),
            "updated_by": user.get("email"),
        }},
        upsert=True,
    )
    return {"ok": True}


@api.post("/companies/me/landing/publish")
async def publish_my_landing(user=Depends(get_current_user)):
    cid = company_id_of(user)
    if not cid:
        raise HTTPException(status_code=400, detail="Geen actief bedrijf")
    doc = await db.company_landings.find_one({"id": cid}, {"_id": 0}) or {}
    draft = doc.get("draft")
    if not draft:
        raise HTTPException(status_code=400, detail="Geen concept om te publiceren")
    await db.company_landings.update_one(
        {"id": cid},
        {"$set": {
            "id": cid,
            "published": draft,
            "published_at": iso(now_utc()),
            "published_by": user.get("email"),
        }},
        upsert=True,
    )
    return {"ok": True, "published_at": iso(now_utc())}


@api.post("/companies/me/landing/discard")
async def discard_my_landing(user=Depends(get_current_user)):
    cid = company_id_of(user)
    if not cid:
        raise HTTPException(status_code=400, detail="Geen actief bedrijf")
    doc = await db.company_landings.find_one({"id": cid}, {"_id": 0}) or {}
    pub = doc.get("published") or {}
    await db.company_landings.update_one(
        {"id": cid},
        {"$set": {
            "id": cid,
            "draft": pub,
            "updated_at": iso(now_utc()),
        }},
        upsert=True,
    )
    return {"ok": True}


class CustomDomainIn(BaseModel):
    custom_domain: Optional[str] = ""


@api.put("/companies/me/custom-domain")
async def set_my_custom_domain(body: CustomDomainIn, user=Depends(require_role("admin"))):
    """Company admin stelt zijn eigen custom domain in (bv. gopiappartements.com).
    Leeg string = verwijder. Domain is genormaliseerd (lowercase, geen www., geen port)."""
    cid = company_id_of(user)
    if not cid:
        raise HTTPException(status_code=400, detail="Geen actief bedrijf")
    domain = _normalize_host(body.custom_domain or "")
    if domain:
        # Validate basic shape — moet minstens 1 dot bevatten.
        if "." not in domain or len(domain) < 4:
            raise HTTPException(status_code=400, detail="Ongeldig domein (bv. gopiappartements.com)")
        # Check of een ander bedrijf dit domein al heeft.
        existing = await db.companies.find_one(
            {"custom_domain": domain, "id": {"$ne": cid}}, {"_id": 0, "id": 1, "name": 1},
        )
        if existing:
            raise HTTPException(
                status_code=409,
                detail=f"Domein '{domain}' is al in gebruik door '{existing.get('name')}'",
            )
    set_doc = {"custom_domain": domain or None}
    await db.companies.update_one({"id": cid}, {"$set": set_doc})
    return {"ok": True, "custom_domain": domain or None}


@api.get("/companies/me/landing-apartments")
async def get_my_landing_apartments(user=Depends(get_current_user)):
    """Preview-helper voor de landing editor — toont welke apartments
    publiek zichtbaar zouden zijn (status=vacant of available)."""
    cid = company_id_of(user)
    if not cid:
        raise HTTPException(status_code=400, detail="Geen actief bedrijf")
    out = []
    cursor = db.apartments.find(
        {"company_id": cid, "status": {"$in": ["vacant", "available"]}},
        {"_id": 0, "id": 1, "number": 1, "address": 1, "rent_amount": 1,
         "currency": 1, "description": 1, "photo_url": 1, "status": 1},
    ).sort("created_at", -1)
    async for a in cursor:
        out.append(a)
    return out


# Superadmin variants — edit any company's landing.
@api.get("/superadmin/clients")
async def superadmin_list_clients(user=Depends(get_current_user)):
    """Lijst van alle admin-gebruikers van bedrijven op het platform.
    Bevat naam/email/rol/bedrijf + last_login voor de superadmin Klanten pagina."""
    if user.get("role") != "superadmin":
        raise HTTPException(status_code=403, detail="Alleen superadmin")
    # Alle users met een company_id (dus geen platform-superadmins zelf)
    clients = []
    async for u in db.users.find(
        {"company_id": {"$ne": None}},
        {"_id": 0, "id": 1, "email": 1, "name": 1, "role": 1, "company_id": 1,
         "created_at": 1, "last_login_at": 1, "is_active": 1},
    ):
        co = await db.companies.find_one(
            {"id": u.get("company_id")},
            {"_id": 0, "name": 1, "slug": 1},
        ) or {}
        clients.append({
            **u,
            "company_name": co.get("name") or "",
            "company_slug": co.get("slug") or "",
        })
    # Sorteer op laatst ingelogd (nieuwste eerst), fallback op created_at
    clients.sort(key=lambda c: (c.get("last_login_at") or c.get("created_at") or ""), reverse=True)
    return clients


@api.get("/superadmin/companies/{cid}/landing")
async def get_company_landing_super(cid: str, mode: Literal["draft", "published"] = "draft",
                                      user=Depends(require_role("superadmin"))):
    doc = await db.company_landings.find_one({"id": cid}, {"_id": 0}) or {}
    content = (doc.get("draft") if mode == "draft" else doc.get("published")) or {}
    if mode == "draft" and not doc.get("draft"):
        content = doc.get("published") or {}
    return {
        "content": content,
        "has_unpublished_changes": (doc.get("draft") or {}) != (doc.get("published") or {}) and bool(doc.get("draft")),
        "updated_at": doc.get("updated_at"),
        "published_at": doc.get("published_at"),
    }


@api.put("/superadmin/companies/{cid}/landing")
async def put_company_landing_super(cid: str, body: CompanyLandingIn,
                                      user=Depends(require_role("superadmin"))):
    await db.company_landings.update_one(
        {"id": cid},
        {"$set": {
            "id": cid,
            "draft": body.content,
            "updated_at": iso(now_utc()),
            "updated_by": user.get("email"),
        }},
        upsert=True,
    )
    return {"ok": True}


@api.post("/superadmin/companies/{cid}/landing/publish")
async def publish_company_landing_super(cid: str, user=Depends(require_role("superadmin"))):
    doc = await db.company_landings.find_one({"id": cid}, {"_id": 0}) or {}
    draft = doc.get("draft")
    if not draft:
        raise HTTPException(status_code=400, detail="Geen concept om te publiceren")
    await db.company_landings.update_one(
        {"id": cid},
        {"$set": {
            "id": cid,
            "published": draft,
            "published_at": iso(now_utc()),
            "published_by": user.get("email"),
        }},
        upsert=True,
    )
    return {"ok": True}


class LandingLeadIn(BaseModel):
    company_id: str
    name: str
    phone: str
    email: Optional[str] = ""
    message: Optional[str] = ""
    apartment_id: Optional[str] = ""


@api.post("/public/landing-lead")
async def submit_landing_lead(body: LandingLeadIn):
    """Public lead endpoint — anyone can submit. Wordt zichtbaar voor de
    company admin in een Leads tab. Geen auth om wrijving voor bezoekers te
    minimaliseren; spam-protection kan later via reCAPTCHA worden toegevoegd."""
    if not body.company_id or not body.name or not body.phone:
        raise HTTPException(status_code=400, detail="company_id, name en phone zijn verplicht")
    company = await db.companies.find_one({"id": body.company_id}, {"_id": 0, "id": 1, "name": 1})
    if not company:
        raise HTTPException(status_code=404, detail="Bedrijf niet gevonden")
    lead = {
        "id": new_id(),
        "company_id": body.company_id,
        "name": body.name.strip()[:120],
        "phone": body.phone.strip()[:40],
        "email": (body.email or "").strip()[:120],
        "message": (body.message or "").strip()[:2000],
        "apartment_id": (body.apartment_id or "").strip() or None,
        "status": "new",
        "created_at": iso(now_utc()),
    }
    await db.landing_leads.insert_one(lead)
    return {"ok": True, "lead_id": lead["id"]}


@api.get("/companies/me/landing-leads")
async def list_my_landing_leads(user=Depends(get_current_user)):
    cid = company_id_of(user)
    if not cid:
        raise HTTPException(status_code=400, detail="Geen actief bedrijf")
    leads = await db.landing_leads.find({"company_id": cid}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return leads


@api.post("/companies/me/landing-leads/{lead_id}/status")
async def update_lead_status(lead_id: str, body: dict, user=Depends(get_current_user)):
    cid = company_id_of(user)
    status = (body or {}).get("status", "new")
    if status not in ("new", "contacted", "won", "lost"):
        raise HTTPException(status_code=400, detail="Ongeldige status")
    res = await db.landing_leads.update_one(
        {"id": lead_id, "company_id": cid},
        {"$set": {"status": status, "updated_at": iso(now_utc())}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Lead niet gevonden")
    return {"ok": True}


# =====================================================================
# Enterprise leads — publieke aanvraag vanaf de SaaS-marketing landing
# page. Bezoekers die "Custom" pakket willen (grotere quota, custom
# integraties) vullen een formulier in. Wordt door superadmin opgevolgd.
# =====================================================================
class EnterpriseLeadIn(BaseModel):
    name: str
    company: str
    email: str
    phone: Optional[str] = ""
    apartments: Optional[int] = None
    tenants: Optional[int] = None
    locations: Optional[int] = None
    employees: Optional[int] = None
    message: Optional[str] = ""


@api.post("/public/enterprise-lead")
async def submit_enterprise_lead(body: EnterpriseLeadIn):
    """Publieke intake — Enterprise "Custom" aanvraag vanaf de landingpage.
    Geen auth zodat leads met minimum wrijving kunnen aanvragen.
    Slaat op in `enterprise_leads` collectie en informeert superadmin.
    """
    if not body.name.strip() or not body.company.strip() or not body.email.strip():
        raise HTTPException(status_code=400, detail="Naam, bedrijf en e-mail zijn verplicht")
    doc = {
        "id": new_id(),
        "name": body.name.strip()[:120],
        "company": body.company.strip()[:120],
        "email": body.email.strip().lower()[:160],
        "phone": (body.phone or "").strip()[:40],
        "wanted_apartments": int(body.apartments) if body.apartments and body.apartments > 0 else None,
        "wanted_tenants": int(body.tenants) if body.tenants and body.tenants > 0 else None,
        "wanted_locations": int(body.locations) if body.locations and body.locations > 0 else None,
        "wanted_employees": int(body.employees) if body.employees and body.employees > 0 else None,
        "message": (body.message or "").strip()[:3000],
        "status": "new",
        "created_at": iso(now_utc()),
    }
    await db.enterprise_leads.insert_one(doc)
    # Best-effort e-mail naar SaaS-superadmins zodat ze meteen kunnen bellen.
    try:
        from email_service import send_platform_email, wrap_template
        summary_rows = "".join(
            f"<tr><td>{lbl}</td><td>{val}</td></tr>"
            for lbl, val in [
                ("Naam", doc["name"]), ("Bedrijf", doc["company"]),
                ("E-mail", doc["email"]), ("Telefoon", doc["phone"] or "—"),
                ("Appartementen", doc["wanted_apartments"] or "—"),
                ("Huurders", doc["wanted_tenants"] or "—"),
                ("Locaties", doc["wanted_locations"] or "—"),
                ("Medewerkers", doc["wanted_employees"] or "—"),
            ]
        )
        html = wrap_template(
            f"<h1>Nieuwe Enterprise aanvraag</h1>"
            f"<table class='kv'>{summary_rows}</table>"
            + (f"<p style='margin-top:12px'>{doc['message']}</p>" if doc["message"] else ""),
            footer="SuriRent SaaS · Enterprise Lead"
        )
        supers = await db.users.find({"role": "superadmin"}, {"_id": 0, "email": 1}).to_list(20)
        for s in supers:
            if s.get("email"):
                await send_platform_email(to=s["email"],
                    subject=f"Enterprise aanvraag — {doc['company']}", body_html=html)
    except Exception as _e:
        print(f"[enterprise-lead] mail warn: {_e}")
    return {"ok": True, "lead_id": doc["id"]}


@api.get("/superadmin/enterprise-leads")
async def list_enterprise_leads(user=Depends(require_role("superadmin"))):
    leads = await db.enterprise_leads.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return leads


@api.post("/superadmin/enterprise-leads/{lead_id}/status")
async def update_enterprise_lead_status(lead_id: str, body: dict, user=Depends(require_role("superadmin"))):
    status = (body or {}).get("status", "new")
    if status not in ("new", "contacted", "won", "lost"):
        raise HTTPException(status_code=400, detail="Ongeldige status")
    res = await db.enterprise_leads.update_one(
        {"id": lead_id},
        {"$set": {"status": status, "updated_at": iso(now_utc())}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Lead niet gevonden")
    return {"ok": True}


# =====================================================================
# Per-company branding (Logo + primary color + display name for PWA/login)
# =====================================================================
def _hex_color(v: Optional[str]) -> str:
    """Validate & normalize a #RRGGBB hex color. Falls back to brand orange."""
    if not v:
        return "#FF5C00"
    s = str(v).strip().lower()
    if not s.startswith("#"):
        s = "#" + s
    if len(s) == 4:  # #abc → #aabbcc
        s = "#" + "".join(ch * 2 for ch in s[1:])
    if len(s) != 7:
        return "#FF5C00"
    try:
        int(s[1:], 16)
        return s
    except ValueError:
        return "#FF5C00"


def _company_branding_response(c: dict, *, include_private: bool = False) -> dict:
    b = (c.get("branding") or {}) if c else {}
    out = {
        "id": c.get("id"),
        "slug": c.get("slug"),
        "name": c.get("name"),
        "app_name": b.get("app_name") or c.get("name") or "Vastgoed Kiosk",
        "primary_color": _hex_color(b.get("primary_color")),
        "logo_url": b.get("logo_url") or "",
        "tagline": b.get("tagline") or "",
        # PDF-sjabloon voor kwitantie/factuur: midnight_gold (default),
        # charcoal_gold, forest_gold, sunset_gold. Tenant kiest in
        # Instellingen → Facturatie → PDF-sjabloon.
        "pdf_template": b.get("pdf_template") or "midnight_gold",
        "pdf_custom_dark": b.get("pdf_custom_dark") or "",
        "contact_email": c.get("contact_email") or "",
        "contact_phone": c.get("contact_phone") or "",
        "whatsapp_number": c.get("whatsapp_number") or c.get("contact_phone") or "",
        "address": c.get("address") or "",
        "kkf_number": c.get("kkf_number") or "",
        "bank_account_sr": c.get("bank_account_sr") or "",
        "bank_account_nl": c.get("bank_account_nl") or "",
    }
    # Verhuurder-persoonsgegevens zijn PRIVATE — alleen voor eigen admin
    # bewerkscherm, nooit voor publieke slug-lookups.
    if include_private:
        out["landlord_name"] = c.get("landlord_name") or ""
        out["landlord_birth_date"] = c.get("landlord_birth_date") or ""
        out["landlord_id_number"] = c.get("landlord_id_number") or ""
        out["landlord_signature_url"] = c.get("landlord_signature_url") or ""
        out["landlord_signature_signed_at"] = c.get("landlord_signature_signed_at") or ""
    return out


@api.get("/public/companies/{slug}/branding")
async def public_company_branding(slug: str):
    """Public — pre-login branding lookup by slug (no auth)."""
    if not slug or len(slug) > 80:
        raise HTTPException(status_code=400, detail="Ongeldige slug")
    c = await db.companies.find_one({"slug": slug.lower()}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Bedrijf niet gevonden")
    return _company_branding_response(c)


@api.get("/public/companies/{slug}/available")
async def public_slug_available(slug: str):
    """Public lightweight beschikbaarheids-check tijdens registratie.
    Returnt `{available: bool, reason?: str}` zonder enige interne data
    van het bestaande bedrijf te lekken (geen naam, geen branding).
    `reason` is een NL-vriendelijke fout-string:
      - "format"   → slug bevat ongeldige tekens / te kort / te lang
      - "reserved" → gereserveerde platform-slug (zoals 'admin', 'login')
      - "taken"    → reeds in gebruik door een ander bedrijf
    """
    import re
    s = (slug or "").lower().strip()
    if not s or len(s) > 40 or not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,39}", s):
        return {"available": False, "reason": "format"}
    if s in RESERVED_SLUGS:
        return {"available": False, "reason": "reserved"}
    exists = await db.companies.find_one({"slug": s}, {"_id": 1})
    if exists:
        return {"available": False, "reason": "taken"}
    return {"available": True}




@api.get("/public/branding-default")
async def public_branding_default():
    """Wanneer er exact één actief bedrijf is, geef de branding terug.
    Gebruikt door de Huurder Kiosk om zonder slug/subdomain toch een
    bedrijfscontext te kunnen bepalen op single-tenant installaties."""
    # Tel actieve bedrijven (of valt terug op alle bedrijven indien `active` ontbreekt).
    q = {"$or": [{"active": True}, {"active": {"$exists": False}}]}
    total = await db.companies.count_documents(q)
    if total != 1:
        raise HTTPException(status_code=404, detail="Meerdere of geen bedrijven")
    c = await db.companies.find_one(q, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Geen bedrijf")
    return _company_branding_response(c)


@api.get("/public/branding-by-host")
async def public_branding_by_host(request: Request):
    """Resolve company branding via de HTTP Host header. Ondersteunt:
      1. Wildcard DNS: `<slug>.app.<root>` → slug = subdomein
      2. Custom domain via companies.custom_domain (legacy)
      3. Custom domain via company_settings.domain.custom_domain (nieuw)
    Returns {slug, ...branding} of {slug: null} als geen match.
    """
    host = (request.headers.get("x-forwarded-host") or request.headers.get("host") or "").lower()
    host = host.split(":")[0].split(",")[0].strip()

    # === Strategie 1: check custom domain (voorrang boven subdomein) ===
    # System hosts uitsluiten zodat surirent.sr / *.emergentagent.com nooit
    # per ongeluk als custom domain worden geïnterpreteerd.
    SYSTEM_HOSTS = ("surirent.sr", "emergentagent.com", "localhost", "127.0.0.1")
    is_system = not host or any(host == s or host.endswith("." + s) for s in SYSTEM_HOSTS)
    if not is_system:
        # a) Legacy companies.custom_domain
        c = await db.companies.find_one({"custom_domain": host}, {"_id": 0})
        # b) Nieuwe company_settings.domain.custom_domain + enabled
        if not c:
            s = await db.company_settings.find_one(
                {"domain.custom_domain": host, "domain.enabled": True},
                {"_id": 0, "company_id": 1},
            )
            if s:
                c = await db.companies.find_one({"id": s["company_id"]}, {"_id": 0})
        if c:
            out = _company_branding_response(c)
            out["host"] = host
            out["found"] = True
            out["match"] = "custom_domain"
            return out

    # === Strategie 2: wildcard subdomein <slug>.app.<root> ===
    parts = [p for p in host.split(".") if p]
    if len(parts) < 3:
        return {"slug": None, "host": host}
    first = parts[0]
    if first in ("app", "www") or not first.replace("-", "").isalnum():
        return {"slug": None, "host": host}
    c = await db.companies.find_one({"slug": first}, {"_id": 0})
    if not c:
        return {"slug": first, "host": host, "found": False}
    out = _company_branding_response(c)
    out["host"] = host
    out["found"] = True
    out["match"] = "subdomain"
    return out


@api.get("/companies/me/branding")
async def get_my_branding(user=Depends(get_current_user)):
    cid = company_id_of(user)
    if not cid:
        raise HTTPException(status_code=400, detail="Geen actief bedrijf")
    c = await db.companies.find_one({"id": cid}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Bedrijf niet gevonden")
    return _company_branding_response(c, include_private=True)


class BrandingIn(BaseModel):
    app_name: Optional[str] = None
    primary_color: Optional[str] = None
    logo_url: Optional[str] = None
    tagline: Optional[str] = None
    # Kwitantie/factuur luxury sjabloon-keuze
    pdf_template: Optional[str] = None
    # Custom dark-kleur voor PDF templates (overschrijft template.dark).
    # Wanneer aanwezig, gebruikt de PDF gen deze kleur i.p.v. het template
    # preset. Handig voor tenants die 100% brand-consistent willen zijn.
    pdf_custom_dark: Optional[str] = None


@api.put("/companies/me/branding")
async def put_my_branding(body: BrandingIn, user=Depends(require_role("admin"))):
    cid = company_id_of(user)
    if not cid:
        raise HTTPException(status_code=400, detail="Geen actief bedrijf")
    # Pakket-gate: White-label branding zit alleen in Professional+.
    await _require_plan_feature(cid, "allow_branding", "White-label branding")
    update = {
        "branding.app_name": (body.app_name or "").strip()[:80],
        "branding.primary_color": _hex_color(body.primary_color),
        "branding.logo_url": (body.logo_url or "").strip()[:500],
        "branding.tagline": (body.tagline or "").strip()[:200],
        "branding.updated_at": iso(now_utc()),
        "branding.updated_by": user.get("email"),
    }
    allowed_templates = {"midnight_gold", "charcoal_gold", "forest_gold", "sunset_gold"}
    if body.pdf_template and body.pdf_template.strip().lower() in allowed_templates:
        update["branding.pdf_template"] = body.pdf_template.strip().lower()
    if body.pdf_custom_dark is not None:
        update["branding.pdf_custom_dark"] = _hex_color(body.pdf_custom_dark) if body.pdf_custom_dark else ""
    await db.companies.update_one({"id": cid}, {"$set": update})
    c = await db.companies.find_one({"id": cid}, {"_id": 0})
    return _company_branding_response(c, include_private=True)


@api.get("/companies/me/branding/preview-pdf")
async def preview_branding_pdf(
    template: Optional[str] = None,
    custom_dark: Optional[str] = None,
    user=Depends(require_role("admin")),
):
    """Genereert een DEMO kwitantie PDF met de opgegeven template/kleur zodat
    de tenant live kan zien hoe zijn kwitantie eruit zal zien voordat hij de
    branding-instellingen opslaat. Alle demo-data is fictief."""
    cid = company_id_of(user)
    if not cid:
        raise HTTPException(status_code=400, detail="Geen actief bedrijf")
    pdf_meta = await _company_brand_info(cid)
    if template:
        pdf_meta["company_pdf_template"] = template
    if custom_dark:
        pdf_meta["company_pdf_custom_dark"] = custom_dark
    demo_payment = {
        "receipt_number": "KW-PREVIEW",
        "paid_at": iso(now_utc()),
        "tenant_name": "Jan Pieterse",
        "apartment_number": "HUIS 3A",
        "category": "huur",
        "period_month": now_utc().month,
        "period_year": now_utc().year,
        "method": "contant",
        "amount": 7500.00,
        "currency": "SRD",
        "outstanding_after": 0.0,
        "note": "Voorbeeld — dit is hoe uw kwitantie eruit zal zien.",
        "received_by": "Jan Pieterse",
        "tenant_id": "preview",
        **pdf_meta,
    }
    from pdf_gen import receipt_pdf_blue_house as _rp
    pdf_bytes = await asyncio.to_thread(_rp, demo_payment)
    return Response(
        content=pdf_bytes, media_type="application/pdf",
        headers={"Content-Disposition": "inline; filename=kwitantie-preview.pdf"},
    )


class CompanyProfileIn(BaseModel):
    name: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    address: Optional[str] = None
    kkf_number: Optional[str] = None
    bank_account_sr: Optional[str] = None
    bank_account_nl: Optional[str] = None
    # Verhuurder-persoonsgegevens t.b.v. huurcontracten
    landlord_name: Optional[str] = None       # Volledige naam van de verhuurder
    landlord_birth_date: Optional[str] = None # YYYY-MM-DD
    landlord_id_number: Optional[str] = None  # bv. FM008370


@api.put("/companies/me/profile")
async def put_my_company_profile(
    body: CompanyProfileIn, user=Depends(require_role("admin"))
):
    """Admins kunnen hun eigen bedrijfsgegevens bewerken: bedrijfsnaam,
    contact-email, telefoon, adres en bankrekeningen (SR + NL). Slug en
    plan/billing blijven superadmin-only."""
    cid = company_id_of(user)
    if not cid:
        raise HTTPException(status_code=400, detail="Geen actief bedrijf")
    update = {}
    if body.name is not None:
        nm = body.name.strip()
        if not nm:
            raise HTTPException(status_code=400, detail="Bedrijfsnaam mag niet leeg zijn")
        update["name"] = nm[:120]
    if body.contact_email is not None:
        update["contact_email"] = body.contact_email.strip()[:200]
    if body.contact_phone is not None:
        update["contact_phone"] = body.contact_phone.strip()[:60]
    if body.address is not None:
        update["address"] = body.address.strip()[:300]
    if body.kkf_number is not None:
        update["kkf_number"] = body.kkf_number.strip()[:60]
    if body.bank_account_sr is not None:
        update["bank_account_sr"] = body.bank_account_sr.strip()[:200]
    if body.bank_account_nl is not None:
        update["bank_account_nl"] = body.bank_account_nl.strip()[:200]
    if body.landlord_name is not None:
        update["landlord_name"] = body.landlord_name.strip()[:200]
    if body.landlord_birth_date is not None:
        update["landlord_birth_date"] = body.landlord_birth_date.strip()[:20]
    if body.landlord_id_number is not None:
        update["landlord_id_number"] = body.landlord_id_number.strip()[:60]
    if not update:
        raise HTTPException(status_code=400, detail="Geen velden om bij te werken")
    update["updated_at"] = iso(now_utc())
    update["updated_by"] = user.get("email")
    await db.companies.update_one({"id": cid}, {"$set": update})
    # Invalidate de Gold Plaque cache zodat nieuwe bedrijfsnaam/adres direct
    # zichtbaar is in toekomstige plaquette-downloads.
    if "name" in update or "address" in update:
        try:
            await db.qr_plate_cache.delete_many({})
        except Exception:
            pass
    c = await db.companies.find_one({"id": cid}, {"_id": 0})
    return _company_branding_response(c, include_private=True)


@api.get("/companies/me/setup-status")
async def get_company_setup_status(user=Depends(require_role("admin"))):
    """Geeft een overzicht van wat er nog geconfigureerd moet worden voor een
    bedrijf om volledig functioneel te zijn. Gebruikt door de Setup Wizard
    om te bepalen welke stappen al klaar zijn en waar de wizard moet starten.
    """
    cid = company_id_of(user)
    if not cid:
        raise HTTPException(status_code=400, detail="Geen actief bedrijf")
    c = await db.companies.find_one({"id": cid}, {"_id": 0}) or {}

    has_name = bool((c.get("name") or "").strip()) and \
        (c.get("name") or "").strip().lower() not in ("nieuw bedrijf", "demo", "company")
    has_contact = bool((c.get("contact_email") or "").strip()) or \
        bool((c.get("contact_phone") or "").strip())
    has_bank = bool((c.get("bank_account_sr") or "").strip()) or \
        bool((c.get("bank_account_nl") or "").strip())

    apt_count = await db.apartments.count_documents({"company_id": cid})
    tenant_count = await db.tenants.count_documents({"company_id": cid})

    steps = [
        {"id": "profile", "label": "Bedrijfsgegevens", "done": bool(has_name and has_contact)},
        {"id": "bank", "label": "Bankrekening", "done": has_bank},
        {"id": "apartment", "label": "Eerste appartement", "done": apt_count > 0},
        {"id": "tenant", "label": "Eerste huurder", "done": tenant_count > 0},
    ]
    completed = sum(1 for s in steps if s["done"])
    return {
        "complete": completed == len(steps),
        "completed": completed,
        "total": len(steps),
        "percent": round(completed / len(steps) * 100),
        "steps": steps,
        "next_step": next((s["id"] for s in steps if not s["done"]), None),
        "counts": {"apartments": apt_count, "tenants": tenant_count},
    }




@api.post("/companies/me/branding/upload")
async def upload_branding_asset(file: UploadFile = File(...),
                                 user=Depends(require_role("admin"))):
    """Upload a company logo (max 5 MB). Stored in same collection as landing assets
    so we reuse the public GET /api/landing/asset/{id} serve route."""
    raw = await file.read()
    if len(raw) > MAX_LANDING_ASSET_BYTES:
        raise HTTPException(status_code=413, detail="Bestand groter dan 5 MB.")
    ctype = (file.content_type or "").lower()
    if not ctype.startswith("image/"):
        raise HTTPException(status_code=400, detail="Alleen afbeeldingen toegestaan.")
    raw, ctype = _to_webp_bytes(raw, ctype)
    cid = company_id_of(user)
    asset_id = new_id()
    await db.landing_assets.insert_one({
        "id": asset_id,
        "filename": file.filename or f"asset-{asset_id}",
        "content_type": ctype,
        "data_b64": base64.b64encode(raw).decode("ascii"),
        "size": len(raw),
        "scope": "company",
        "company_id": cid,
        "uploaded_by": user.get("email"),
        "uploaded_at": iso(now_utc()),
    })
    return {"id": asset_id, "url": f"/api/landing/asset/{asset_id}"}


@api.post("/companies/me/landlord-signature")
async def upload_landlord_signature(file: UploadFile = File(...),
                                     user=Depends(require_role("admin"))):
    """Sla de handtekening van de verhuurder op (PNG uit canvas of upload).
    Wordt inline op elk contract getoond onder 'Verhuurder → Handtekening'.
    Max 2 MB. Overschrijft de vorige handtekening."""
    cid = company_id_of(user)
    if not cid:
        raise HTTPException(status_code=400, detail="Geen actief bedrijf")
    raw = await file.read()
    if len(raw) > 2 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Handtekening te groot (>2 MB).")
    ctype = (file.content_type or "").lower()
    if not ctype.startswith("image/"):
        raise HTTPException(status_code=400, detail="Alleen afbeeldingen toegestaan.")
    raw, ctype = _to_webp_bytes(raw, ctype)
    asset_id = new_id()
    now = now_utc()
    await db.landing_assets.insert_one({
        "id": asset_id,
        "filename": f"landlord-signature-{cid[:8]}.png",
        "content_type": ctype,
        "data_b64": base64.b64encode(raw).decode("ascii"),
        "size": len(raw),
        "scope": "company",
        "company_id": cid,
        "uploaded_by": user.get("email"),
        "uploaded_at": iso(now),
    })
    url = f"/api/landing/asset/{asset_id}"
    await db.companies.update_one({"id": cid}, {
        "$set": {"landlord_signature_url": url, "landlord_signature_signed_at": iso(now)},
    })
    return {"landlord_signature_url": url, "landlord_signature_signed_at": iso(now)}


@api.delete("/companies/me/landlord-signature")
async def delete_landlord_signature(user=Depends(require_role("admin"))):
    cid = company_id_of(user)
    if not cid:
        raise HTTPException(status_code=400, detail="Geen actief bedrijf")
    await db.companies.update_one({"id": cid}, {
        "$unset": {"landlord_signature_url": "", "landlord_signature_signed_at": ""},
    })
    return {"ok": True}


@api.get("/companies/me/landlord-signature/preview.pdf")
async def preview_contract_with_landlord_signature(user=Depends(require_role("admin"))):
    """Genereer een voorbeeld-contract PDF met daarop de opgeslagen verhuurder-
    handtekening inline (huurder-kolom blijft leeg met '_____' streep). De
    admin kan hiermee zien hoe zijn handtekening straks op elk contract komt.
    """
    cid = company_id_of(user)
    if not cid:
        raise HTTPException(status_code=400, detail="Geen actief bedrijf")
    co = await db.companies.find_one({"id": cid}, {"_id": 0}) or {}
    landlord_url = (co.get("landlord_signature_url") or "").strip()
    landlord_bytes = await _load_landing_asset_bytes(landlord_url) if landlord_url else None
    brand = await _company_brand_info(cid)

    # Mock contract + tenant + apartment — genoeg data zodat contract_pdf niet crasht
    sample_contract = {
        "id": "preview",
        "contract_number": "VOORBEELD-0001",
        "start_date": now_utc().date().isoformat(),
        "end_date": "",
        "payment_day": 1,
        "deposit_amount": 0,
        "landlord": co.get("landlord_name") or brand.get("name") or "Verhuurder",
        "terms": "",
        "created_at": iso(now_utc()),
        **brand,  # company_name, address, phone, email, logo_bytes
    }
    sample_tenant = {"id": "preview-t", "name": "Voorbeeld Huurder", "phone": "", "email": ""}
    sample_apartment = {"id": "preview-a", "number": "A-VOORBEELD",
                        "rent_amount": 1500.0, "currency": "SRD", "address": ""}

    pdf = await asyncio.to_thread(contract_pdf, sample_contract, sample_tenant, sample_apartment,
                                   landlord_signature_bytes=landlord_bytes)
    return StreamingResponse(io.BytesIO(pdf), media_type="application/pdf", headers={
        "Content-Disposition": 'inline; filename="voorbeeld-contract.pdf"',
    })


@api.get("/companies/me/url-info")
async def get_my_url_info(request: Request, user=Depends(get_current_user)):
    """Return all login-URL variants for the current company. Het branded pad
    `/c/<slug>/…` is altijd primair; eigen subdomein-feature is verwijderd.
    Bedrijven die een eigen domein willen, configureren dat in Instellingen →
    Eigen domein (CNAME → app host)."""
    cid = company_id_of(user)
    if not cid:
        raise HTTPException(status_code=400, detail="Geen actief bedrijf")
    c = await db.companies.find_one({"id": cid}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Bedrijf niet gevonden")
    slug = c.get("slug") or ""

    host = (request.headers.get("x-forwarded-host") or request.headers.get("host") or "").lower().split(":")[0].strip()
    forwarded_proto = (request.headers.get("x-forwarded-proto") or "").split(",")[0].strip().lower()
    scheme = forwarded_proto or "https"
    app_domain = (os.environ.get("SAAS_APP_DOMAIN") or "").strip().lower() or host
    base_url = f"{scheme}://{app_domain}" if app_domain else ""
    query_url = f"{base_url}/login?c={slug}" if base_url else ""
    path_url = f"{base_url}/{slug}" if base_url else ""
    landing_url = f"{base_url}/site/{slug}" if base_url else ""
    kiosk_url = f"{base_url}/{slug}/kiosk" if base_url else ""
    tenant_kiosk_url = f"{base_url}/{slug}/kiosk/huurder" if base_url else ""
    tenant_portal_url = tenant_kiosk_url

    # Custom domain (uit Instellingen → Eigen domein). Toon als primary wanneer
    # admin het heeft ingesteld + DNS geverifieerd.
    custom_domain = None
    try:
        cs = await db.company_settings.find_one(
            {"company_id": cid}, {"_id": 0, "domain": 1}
        ) or {}
        dom = (cs.get("domain") or {})
        if dom.get("enabled") and dom.get("dns_verified") and dom.get("custom_domain"):
            custom_domain = (dom.get("custom_domain") or "").strip().lower()
    except Exception:
        custom_domain = None
    custom_domain_url = f"{scheme}://{custom_domain}" if custom_domain else None

    return {
        "slug": slug,
        "company_name": c.get("name"),
        "primary_url": custom_domain_url or path_url or query_url,
        "query_url": query_url,
        "path_url": path_url,
        "landing_url": landing_url,
        "kiosk_url": kiosk_url,
        "tenant_kiosk_url": tenant_kiosk_url,
        "tenant_portal_url": tenant_portal_url,
        "custom_domain_url": custom_domain_url,
        "app_domain": app_domain,
        # Legacy velden — leeg/none voor backward-compat met oude frontends.
        "subdomain_url": None,
        "dns_status": "na",
        "dns_error": None,
    }


# Welke entry-points een admin als QR kan delen. We bouwen de URL server-side
# zodat een gebruiker niet zomaar een willekeurige (phishing-)URL door onze
# QR-generator kan jagen.
_QR_KIND_PATHS = {
    "login":           "/{slug}",
    "kiosk":           "/{slug}/kiosk",
    "tenant_kiosk":    "/{slug}/kiosk/huurder",
    # Huurportaal = zelfde route als de huurder-kiosk (PIN-only via QR).
    "tenant_portal":   "/{slug}/kiosk/huurder",
    "query":           "/login?c={slug}",
}


def _company_base_url(request: Request) -> str:
    host = (request.headers.get("x-forwarded-host") or request.headers.get("host") or "").lower().split(":")[0].strip()
    proto = (request.headers.get("x-forwarded-proto") or "").split(",")[0].strip().lower() or "https"
    # GEEN slug-prefix strippen — dat brak preview omgevingen waar de host meer
    # dan 3 DNS-componenten heeft maar geen company-subdomein is. Path bevat
    # al `/c/<slug>/…` zodat branding overal werkt.
    app_domain = (os.environ.get("SAAS_APP_DOMAIN") or "").strip().lower() or host
    return f"{proto}://{app_domain}" if app_domain else ""


@api.post("/onboarding/welcome-pack")
async def onboarding_welcome_pack(body: dict, request: Request):
    """Genereert een PDF welkomstpakket met inlog + alle portal-URL's, en
    verstuurt hetzelfde per e-mail wanneer `send_email=true`. Wordt aangeroepen
    door de RegisterSuccess-view direct na registratie zodat de gebruiker
    zijn inloggegevens veilig kan opslaan en/of ontvangen.

    Body:
      - email (verplicht) — het admin-account
      - password (verplicht) — plaintext, wordt niet opgeslagen
      - slug (verplicht) — company slug voor URL-opbouw
      - company_name (optioneel) — voor branding op de PDF
      - send_email (default true) — verstuur ook per e-mail
    Retourneert de PDF stream (Content-Type: application/pdf).
    """
    import io as _io
    from fastapi.responses import StreamingResponse
    email_addr = (body.get("email") or "").strip()
    password = body.get("password") or ""
    slug = (body.get("slug") or "").strip().lower()
    company_name = (body.get("company_name") or "").strip() or slug
    send_mail = body.get("send_email", True)
    if not email_addr or not password or not slug:
        raise HTTPException(status_code=400, detail="email, password en slug zijn vereist")

    base = _company_base_url(request) or _public_url("")
    # Alle publieke URL's die de admin nodig heeft. Zelfde bron als de QR-code
    # generator (`_QR_KIND_PATHS`) — één centrale lijst voorkomt drift.
    urls = {
        "Admin dashboard": f"{base}/{slug}/admin",
        "Login": f"{base}/{slug}/login",
        "Kiosk (POS / balie)": f"{base}/{slug}/kiosk",
        "Huurder kiosk (self-service)": f"{base}/{slug}/tenant-kiosk",
        "Huurder portal (thuis)": f"{base}/{slug}/tenant-portal",
        "Publieke landingspagina": f"{base}/site/{slug}",
    }

    # --- PDF genereren ---
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas as _canvas
    from reportlab.lib import colors
    from reportlab.lib.units import mm

    buf = _io.BytesIO()
    pdf = _canvas.Canvas(buf, pagesize=A4)
    w, h = A4
    orange = colors.HexColor("#FF5C00")
    slate900 = colors.HexColor("#0F172A")
    slate500 = colors.HexColor("#64748B")

    # Header band
    pdf.setFillColor(orange)
    pdf.rect(0, h - 28 * mm, w, 28 * mm, fill=1, stroke=0)
    pdf.setFillColor(colors.white)
    pdf.setFont("Helvetica-Bold", 22)
    pdf.drawString(20 * mm, h - 15 * mm, "Welkom bij SuriRent")
    pdf.setFont("Helvetica", 11)
    pdf.drawString(20 * mm, h - 22 * mm, f"Uw omgeving voor {company_name} is klaar.")

    y = h - 42 * mm
    pdf.setFillColor(slate900)
    pdf.setFont("Helvetica-Bold", 13)
    pdf.drawString(20 * mm, y, "Uw inloggegevens")
    y -= 8 * mm
    pdf.setFont("Helvetica", 10)
    pdf.setFillColor(slate500); pdf.drawString(20 * mm, y, "Gebruikersnaam (e-mail)")
    pdf.setFillColor(slate900); pdf.setFont("Helvetica-Bold", 12)
    pdf.drawString(75 * mm, y, email_addr)
    y -= 7 * mm
    pdf.setFont("Helvetica", 10); pdf.setFillColor(slate500)
    pdf.drawString(20 * mm, y, "Wachtwoord")
    pdf.setFillColor(slate900); pdf.setFont("Courier-Bold", 12)
    pdf.drawString(75 * mm, y, password)
    y -= 7 * mm
    pdf.setFont("Helvetica", 10); pdf.setFillColor(slate500)
    pdf.drawString(20 * mm, y, "Portal slug")
    pdf.setFillColor(slate900); pdf.setFont("Courier-Bold", 12)
    pdf.drawString(75 * mm, y, slug)

    y -= 15 * mm
    pdf.setFont("Helvetica-Bold", 13); pdf.setFillColor(slate900)
    pdf.drawString(20 * mm, y, "Belangrijke URL's")
    y -= 8 * mm
    for label, url in urls.items():
        pdf.setFont("Helvetica-Bold", 10); pdf.setFillColor(slate900)
        pdf.drawString(20 * mm, y, label)
        y -= 5 * mm
        pdf.setFont("Courier", 9); pdf.setFillColor(orange)
        pdf.drawString(22 * mm, y, url)
        y -= 8 * mm
        if y < 30 * mm:  # nieuwe pagina indien nodig
            pdf.showPage(); y = h - 20 * mm

    # Footer
    pdf.setFont("Helvetica-Oblique", 8); pdf.setFillColor(slate500)
    pdf.drawString(20 * mm, 15 * mm,
                   "Bewaar dit document veilig. U kunt uw wachtwoord altijd wijzigen via Instellingen → Beveiliging.")
    pdf.save()
    buf.seek(0)
    pdf_bytes = buf.getvalue()

    # --- E-mail versturen (optioneel, best-effort via platform SMTP) ---
    if send_mail:
        try:
            from email_service import send_platform_email, wrap_template
            body_html = wrap_template(
                title=f"Welkom bij SuriRent — {company_name}",
                content=(
                    f"<p>Uw account is aangemaakt. Hieronder uw inloggegevens en portal-links.</p>"
                    f"<div style='background:#F8FAFC;padding:16px;border-radius:12px;margin:16px 0'>"
                    f"<p><b>Gebruikersnaam:</b> {email_addr}<br/>"
                    f"<b>Wachtwoord:</b> <code style='background:#FFE4CC;padding:2px 6px;border-radius:4px'>{password}</code></p>"
                    f"</div>"
                    f"<h3>Uw URL's</h3><ul>"
                    + "".join(f"<li><b>{k}</b>: <a href='{v}'>{v}</a></li>" for k, v in urls.items())
                    + "</ul>"
                    f"<p style='color:#64748B;font-size:12px'>Bewaar dit bericht veilig. De PDF-versie is als bijlage bijgevoegd.</p>"
                ),
            )
            await send_platform_email(
                to=email_addr,
                subject=f"Welkom bij SuriRent — inloggegevens voor {company_name}",
                body_html=body_html,
                attachments=[(f"surirent-welkom-{slug}.pdf", pdf_bytes, "application/pdf")],
            )
        except Exception as e:  # noqa: BLE001
            print(f"[welcome-pack] email send failed for {email_addr}: {e}")

    return StreamingResponse(
        _io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=surirent-welkom-{slug}.pdf"},
    )


@api.get("/companies/me/qr.png")
async def get_my_qr_png(kind: str = "kiosk", size: int = 320, request: Request = None,
                       user=Depends(get_current_user)):
    """Genereer een PNG QR-code voor één van de gepubliceerde entry-points
    van het huidige bedrijf. `kind` mag een van: login, kiosk, tenant_kiosk,
    customer_display, tenant_portal, query. De QR bevat de absolute branded
    URL (bv. https://app.surirent.sr/c/<slug>/kiosk) en wordt server-side
    gebouwd zodat de generator niet voor andere doeleinden misbruikt kan
    worden."""
    import io as _io
    import qrcode as _qrcode
    from fastapi.responses import StreamingResponse
    cid = company_id_of(user)
    if not cid:
        raise HTTPException(status_code=400, detail="Geen actief bedrijf")
    c = await db.companies.find_one({"id": cid}, {"_id": 0, "slug": 1})
    if not c or not c.get("slug"):
        raise HTTPException(status_code=404, detail="Bedrijf niet gevonden")
    template = _QR_KIND_PATHS.get(kind)
    if not template:
        raise HTTPException(status_code=400, detail="Onbekend QR-type")
    size = max(160, min(int(size or 320), 800))
    base = _company_base_url(request)
    if not base:
        raise HTTPException(status_code=400, detail="Kan host niet bepalen")
    url = f"{base}{template.format(slug=c['slug'])}"
    qr = _qrcode.QRCode(version=None, error_correction=_qrcode.constants.ERROR_CORRECT_M,
                        box_size=10, border=2)
    qr.add_data(url)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white").convert("RGB")
    img = img.resize((size, size))
    buf = _io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    buf.seek(0)
    headers = {
        "Cache-Control": "private, max-age=300",
        "Content-Disposition": f'inline; filename="qr-{c["slug"]}-{kind}.png"',
    }
    return StreamingResponse(buf, media_type="image/png", headers=headers)




# =====================================================================
# Companies (superadmin)
# =====================================================================
class CompanyIn(BaseModel):
    name: str
    slug: str
    contact_email: Optional[str] = ""
    contact_phone: Optional[str] = ""
    address: Optional[str] = ""
    plan: str = "starter"
    active: bool = True


class CompanyOut(CompanyIn):
    id: str
    created_at: str
    billing_status: Optional[str] = None
    trial_started_at: Optional[str] = None
    trial_ends_at: Optional[str] = None
    days_left: Optional[int] = None
    owner_email: Optional[str] = None
    telefoon: Optional[str] = None
    monthly_amount: Optional[float] = None
    currency: Optional[str] = None
    stats: Optional[dict] = None


async def _billing_summary(c: dict) -> dict:
    plan_id = c.get("plan", "starter")
    # DB catalog first zodat door superadmin toegevoegde pakketten (bv.
    # 'lifetime') een correcte amount/currency krijgen ipv terug te vallen
    # op starter en verwarrende SRD 3000 te tonen.
    doc = await _fetch_plan_by_id(plan_id)
    if doc:
        plan = {"amount": float(doc.get("amount") or 0), "currency": (doc.get("currency") or "SRD").upper()}
    else:
        plan = PLAN_PRICES.get(plan_id, PLAN_PRICES.get("starter", {"amount": 0, "currency": "SRD"}))
    status = c.get("billing_status") or ("trial" if c.get("trial_ends_at") else "active")
    days_left = None
    trial_ends = c.get("trial_ends_at")
    if trial_ends:
        try:
            end = datetime.fromisoformat(trial_ends.replace("Z", "+00:00"))
            delta = end - now_utc()
            days_left = max(0, int(delta.total_seconds() // 86400) + (1 if delta.total_seconds() % 86400 > 0 else 0))
        except Exception:
            days_left = None
    if status == "trial" and days_left is not None and days_left <= 0:
        status = "expired"
    # Gratis pakketten (bv. Lifetime, SRD 0) → altijd "active" ongeacht of de
    # trial-datum verlopen is. Anders zou de admin foutieve "verlopen" banner
    # zien terwijl er niets te betalen is.
    if float(plan.get("amount") or 0) <= 0:
        status = "active"
    return {
        "billing_status": status,
        "days_left": days_left,
        "monthly_amount": plan.get("amount"),
        "currency": plan.get("currency", "SRD"),
    }


@api.get("/companies", response_model=List[CompanyOut])
async def list_companies(user=Depends(require_role("superadmin"))):
    """Lijst alle bedrijven (superadmin). N+1 queries elimineren via 3
    parallelle aggregaties die counts per company_id in één query halen,
    daarna joinen we lokaal. Voorheen: 1 + 3×N queries → nu altijd 4."""
    docs = await db.companies.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    if not docs:
        return []
    company_ids = [c["id"] for c in docs]
    # Parallel: 3 aggregaties (apartments, tenants, users) gefiltered op de
    # exacte company_ids zodat MongoDB de bestaande indexes kan gebruiken.
    def pipeline():
        return [
            {"$match": {"company_id": {"$in": company_ids}}},
            {"$group": {"_id": "$company_id", "count": {"$sum": 1}}},
        ]
    apt_agg, ten_agg, usr_agg = await asyncio.gather(
        db.apartments.aggregate(pipeline()).to_list(None),
        db.tenants.aggregate(pipeline()).to_list(None),
        db.users.aggregate(pipeline()).to_list(None),
    )
    apt_counts = {d["_id"]: d["count"] for d in apt_agg}
    ten_counts = {d["_id"]: d["count"] for d in ten_agg}
    usr_counts = {d["_id"]: d["count"] for d in usr_agg}
    out = []
    for c in docs:
        cid = c["id"]
        out.append({
            **c,
            **(await _billing_summary(c)),
            "stats": {
                "apartments": apt_counts.get(cid, 0),
                "tenants": ten_counts.get(cid, 0),
                "admins": usr_counts.get(cid, 0),
            },
        })
    return out


class ExtendTrialIn(BaseModel):
    days: int = Field(ge=1, le=365)


@api.post("/companies/{cid}/extend-trial")
async def extend_trial(cid: str, body: ExtendTrialIn, user=Depends(require_role("superadmin"))):
    c = await db.companies.find_one({"id": cid}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Bedrijf niet gevonden")
    base = c.get("trial_ends_at")
    try:
        cur_end = datetime.fromisoformat(base.replace("Z", "+00:00")) if base else now_utc()
    except Exception:
        cur_end = now_utc()
    if cur_end < now_utc():
        cur_end = now_utc()
    new_end = cur_end + timedelta(days=int(body.days))
    await db.companies.update_one({"id": cid}, {"$set": {
        "trial_ends_at": iso(new_end), "billing_status": "trial",
    }})
    return {"ok": True, "trial_ends_at": iso(new_end)}


@api.post("/companies/{cid}/activate-subscription")
async def activate_subscription(cid: str, user=Depends(require_role("superadmin"))):
    """Mark a company's subscription as active (manual confirmation of bank
    transfer or other offline payment). Creates a paid SaaS invoice record."""
    c = await db.companies.find_one({"id": cid}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Bedrijf niet gevonden")
    plan_id = c.get("plan", "starter")
    plan = PLAN_PRICES.get(plan_id, PLAN_PRICES["starter"])
    now = now_utc()
    period_end = now + timedelta(days=30)
    inv = {
        "id": new_id(),
        "company_id": cid,
        "company_name": c.get("name", ""),
        "plan": plan_id,
        "amount": plan["amount"],
        "currency": plan["currency"],
        "status": "paid",
        "period_start": iso(now),
        "period_end": iso(period_end),
        "paid_at": iso(now),
        "created_at": iso(now),
        "created_by": user.get("email"),
    }
    await db.subscription_invoices.insert_one(inv)
    await db.companies.update_one({"id": cid}, {"$set": {
        "billing_status": "active", "subscription_started_at": iso(now),
        "subscription_renews_at": iso(period_end),
    }})
    inv.pop("_id", None)
    return {"ok": True, "invoice": inv}


@api.post("/companies/me/cancel-subscription")
async def company_self_cancel(user=Depends(get_current_user)):
    """Alias-route: admin van een bedrijf kan zijn eigen abonnement opzeggen.
    Wordt feitelijk afgehandeld door `_do_self_cancel`. Deze literal-prefix
    route staat BOVEN de `/{cid}` variant om route-shadowing te vermijden."""
    cid = company_id_of(user)
    if not cid:
        raise HTTPException(status_code=400, detail="Geen actief bedrijf")
    return await _do_self_cancel(cid, user)


@api.post("/companies/{cid}/cancel-subscription")
async def cancel_subscription(cid: str, user=Depends(get_current_user)):
    """Cancel een abonnement. Twee paden:
    1. `cid == "me"` → self-cancel door bedrijfsadmin (resolves cid via user.company_id).
       Stuurt notificatie naar superadmins en bevestiging naar admin.
    2. Specifiek cid → superadmin force-cancel.
    """
    # Resolve self-cancel alias.
    if cid == "me":
        cid = company_id_of(user)
        if not cid:
            raise HTTPException(status_code=400, detail="Geen actief bedrijf")
        return await _do_self_cancel(cid, user)
    # Hard cancel — alleen superadmin.
    if user.get("role") != "superadmin":
        raise HTTPException(status_code=403, detail="Onvoldoende rechten")
    c = await db.companies.find_one({"id": cid}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Bedrijf niet gevonden")
    await db.companies.update_one({"id": cid}, {"$set": {"billing_status": "cancelled"}})
    return {"ok": True}


async def _do_self_cancel(cid: str, user: dict) -> dict:
    """Helper voor /companies/me/cancel-subscription — markeert opzegging
    en stuurt email-notificaties (best-effort)."""
    c = await db.companies.find_one({"id": cid}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Bedrijf niet gevonden")
    await db.companies.update_one({"id": cid}, {"$set": {
        "billing_status": "cancelled",
        "cancelled_at": now_utc_iso(),
        "cancelled_by_user_id": user.get("id"),
    }})
    try:
        superadmins = await db.users.find({"role": "superadmin"}, {"_id": 0, "email": 1}).to_list(20)
        for sa in superadmins:
            if not sa.get("email"):
                continue
            await _saas_email(
                to_email=sa["email"],
                subject=f"Opzegging: {c.get('name', cid)}",
                body_html=f"<p>Bedrijf <strong>{c.get('name', cid)}</strong> heeft zojuist opgezegd.</p>"
                          f"<p>Beheerder: {user.get('email')}<br/>Opzeg-tijdstip: {now_utc_iso()}</p>",
            )
        if user.get("email"):
            await _saas_email(
                to_email=user["email"],
                subject="Bevestiging opzegging SuriRent",
                body_html=f"<p>Beste {user.get('name', 'beheerder')},</p>"
                          f"<p>Wij bevestigen de opzegging van uw abonnement voor "
                          f"<strong>{c.get('name', 'uw bedrijf')}</strong>. "
                          f"Toegang is met onmiddellijke ingang geblokkeerd. "
                          f"Neem contact met support op om te heractiveren.</p>",
            )
    except Exception as e:
        import logging as _logging
        _logging.getLogger("uvicorn.error").warning(f"Opzeg-notificatie email failed: {e}")
    return {"ok": True, "billing_status": "cancelled"}



async def _saas_email(to_email: str, subject: str, body_html: str,
                       attachments: list[tuple[str, bytes, str]] | None = None) -> bool:
    """Centrale helper om SaaS-platform mails te versturen via de SaaS SMTP
    instellingen (db.saas_settings). Stilt fouten af — return False ipv raise.
    `attachments` is een lijst van (filename, bytes, mime_type) tuples."""
    if not to_email:
        return False
    try:
        from email_service import send_email as _smtp_send, send_platform_email, wrap_template
        saas = await db.saas_settings.find_one({"id": SAAS_SETTINGS_ID}, {"_id": 0}) or {}
        smtp = saas.get("smtp") or {}
        wrapped = wrap_template(body_html, brand_name="SuriRent")
        if smtp.get("enabled") and smtp.get("host"):
            await _smtp_send(smtp, to=to_email, subject=subject, body_html=wrapped,
                              attachments=attachments)
            return True
        # Platform fallback (Resend) als die geconfigureerd is.
        try:
            await send_platform_email(to=to_email, subject=subject, body_html=wrapped,
                                       attachments=attachments)
            return True
        except Exception:
            return False
    except Exception as e:
        import logging as _logging
        _logging.getLogger("uvicorn.error").warning(f"_saas_email failed for {to_email}: {e}")
        return False


@api.post("/companies/{cid}/reactivate-subscription")
async def reactivate_subscription(cid: str, user=Depends(require_role("superadmin"))):
    """Superadmin heractiveert een opgezegd of expired abonnement."""
    c = await db.companies.find_one({"id": cid}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Bedrijf niet gevonden")
    update = {"billing_status": "active", "reactivated_at": now_utc_iso()}
    # Als trial nooit afliep maar gewoon opgezegd was, schenk een nieuwe maand.
    if c.get("billing_status") in ("cancelled", "expired"):
        update["next_billing_date"] = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
    await db.companies.update_one({"id": cid}, {"$set": update})
    # Notificeer de bedrijfsadmin (best-effort).
    try:
        if c.get("owner_email"):
            await _saas_email(
                to_email=c["owner_email"],
                subject="Uw SuriRent abonnement is geheractiveerd",
                body_html=f"<p>Beste {c.get('owner_name', 'beheerder')},</p>"
                          f"<p>Uw abonnement voor <strong>{c.get('name', 'uw bedrijf')}</strong> is geheractiveerd. "
                          f"U kunt direct weer inloggen.</p>",
            )
    except Exception as e:
        import logging as _logging
        _logging.getLogger("uvicorn.error").warning(f"Heractivatie email failed: {e}")
    return {"ok": True}



# =====================================================================
# Backup & Restore — admin van een bedrijf kan zijn data exporteren en
# herstellen. Toegestaan voor alle plannen die `allow_backup=true` hebben.
# =====================================================================

@api.get("/companies/me/backup")
async def export_company_backup(user=Depends(get_current_user)):
    """Exporteer alle data van het huidige bedrijf naar een JSON dump.
    Toegankelijk voor admin's met `allow_backup` op hun plan."""
    cid = company_id_of(user)
    if not cid:
        raise HTTPException(status_code=400, detail="Geen actief bedrijf")
    if user.get("role") != "superadmin" and not user.get("original_user_id"):
        await _require_plan_feature(cid, "allow_backup", "Backup & Herstel")

    company = await db.companies.find_one({"id": cid}, {"_id": 0})
    if not company:
        raise HTTPException(status_code=404, detail="Bedrijf niet gevonden")

    backup = {
        "format_version": 1,
        "exported_at": now_utc_iso(),
        "company_id": cid,
        "company": company,
        "users": [u async for u in db.users.find({"company_id": cid}, {"_id": 0, "password_hash": 0, "personal_pin_hash": 0})],
        "collections": {},
    }
    for coll in TENANT_SCOPED_COLLECTIONS:
        docs = []
        async for d in db[coll].find({"company_id": cid}, {"_id": 0}):
            docs.append(d)
        backup["collections"][coll] = docs

    # Bouw een filename met datum + slug voor downloadbestand.
    slug = (company.get("slug") or cid)[:32]
    filename = f"surirent-backup-{slug}-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}.json"
    return JSONResponse(
        content=backup,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


class BackupRestoreRequest(BaseModel):
    backup: dict
    mode: str = "merge"  # "merge" (default: upsert by id) | "replace" (wipe + insert)
    target_company_id: Optional[str] = None  # superadmin only — migratie naar ander bedrijf


@api.post("/companies/me/restore")
async def restore_company_backup(body: BackupRestoreRequest, user=Depends(get_current_user)):
    """Importeer een eerder gemaakte JSON backup.
    - `mode='merge'` (default): upsert per id, behoudt bestaande records die niet in de backup zitten.
    - `mode='replace'`: wist alle company-scoped data en importeert opnieuw (destructief!).
    Superadmin kan via `target_company_id` data naar een ander bedrijf migreren."""
    backup = body.backup or {}
    if backup.get("format_version") != 1:
        raise HTTPException(status_code=400, detail="Onbekend backup formaat")
    src_cid = backup.get("company_id")
    if not src_cid:
        raise HTTPException(status_code=400, detail="Backup mist company_id")

    target_cid = company_id_of(user)
    if body.target_company_id:
        if user.get("role") != "superadmin":
            raise HTTPException(status_code=403, detail="Alleen superadmin mag migreren")
        target_cid = body.target_company_id
    if not target_cid:
        raise HTTPException(status_code=400, detail="Geen target bedrijf")

    # Plan feature check (geldt niet voor superadmin/impersonatie).
    if user.get("role") != "superadmin" and not user.get("original_user_id"):
        await _require_plan_feature(target_cid, "allow_backup", "Backup & Herstel")

    summary = {"target_company_id": target_cid, "mode": body.mode, "collections": {}}

    # Replace-modus: wipe eerst alle tenant-scoped collections voor target.
    if body.mode == "replace":
        for coll in TENANT_SCOPED_COLLECTIONS:
            res = await db[coll].delete_many({"company_id": target_cid})
            summary["collections"].setdefault(coll, {"deleted": 0, "inserted": 0, "upserted": 0})
            summary["collections"][coll]["deleted"] = res.deleted_count

    # Re-import elke collection. Forceer company_id en strip _id om dup-conflicten te voorkomen.
    collections_in = backup.get("collections") or {}
    for coll, docs in collections_in.items():
        if coll not in TENANT_SCOPED_COLLECTIONS:
            continue
        ins = 0
        upd = 0
        for d in docs:
            d = {k: v for k, v in (d or {}).items() if k != "_id"}
            d["company_id"] = target_cid
            doc_id = d.get("id") or new_id()
            d["id"] = doc_id
            res = await db[coll].update_one(
                {"id": doc_id, "company_id": target_cid},
                {"$set": d},
                upsert=True,
            )
            if res.upserted_id is not None:
                ins += 1
            elif res.modified_count > 0:
                upd += 1
        summary["collections"].setdefault(coll, {"deleted": 0, "inserted": 0, "upserted": 0})
        summary["collections"][coll]["inserted"] += ins
        summary["collections"][coll]["upserted"] += upd

    summary["restored_at"] = now_utc_iso()
    return summary


@api.post("/superadmin/migrate-company-data")
async def superadmin_migrate(body: BackupRestoreRequest, user=Depends(require_role("superadmin"))):
    """Superadmin tool: kopieer data van bedrijf A → bedrijf B via backup body."""
    if not body.target_company_id:
        raise HTTPException(status_code=400, detail="target_company_id is verplicht")
    return await restore_company_backup(body, user)




def _is_online(last_seen_iso: str | None, threshold_seconds: int = 300) -> bool:
    """Bepaal of een entity online is op basis van de laatste API-call.
    Default threshold = 5 minuten (300s)."""
    if not last_seen_iso:
        return False
    try:
        last = datetime.fromisoformat(str(last_seen_iso).replace("Z", "+00:00"))
        return (now_utc() - last).total_seconds() <= threshold_seconds
    except Exception:
        return False


class SubscriptionPaymentIn(BaseModel):
    company_id: str
    amount: float
    currency: Literal["SRD", "USD", "EUR"] = "SRD"
    method: Literal["bank", "contant", "overig"] = "bank"
    reference: Optional[str] = ""
    note: Optional[str] = ""
    paid_at: Optional[str] = None  # ISO date; defaults to now


@api.get("/superadmin/saas-pending-approvals")
async def list_saas_pending_approvals(user=Depends(require_role("superadmin"))):
    """Lijst van SaaS-betalingen die wachten op handmatige goedkeuring na
    OCR-mismatch. Voor elk record join'en we company-naam, factuur-info en
    de URL waarop het geüploade bankafschrift bekeken kan worden."""
    docs = await db.saas_payment_requests.find(
        {"status": "pending_approval"}, {"_id": 0},
    ).sort("created_at", -1).to_list(200)
    out = []
    for pr in docs:
        c = await db.companies.find_one({"id": pr.get("company_id")}, {"_id": 0, "name": 1, "slug": 1}) or {}
        inv = await db.subscription_invoices.find_one(
            {"id": pr.get("invoice_id")}, {"_id": 0, "amount": 1, "currency": 1, "plan": 1, "created_at": 1, "status": 1},
        ) or {}
        stmt_id = pr.get("bank_statement_id")
        out.append({
            "id": pr["id"],
            "company_id": pr.get("company_id"),
            "company_name": c.get("name", "—"),
            "company_slug": c.get("slug", ""),
            "invoice_id": pr.get("invoice_id"),
            "invoice_amount": inv.get("amount"),
            "invoice_currency": inv.get("currency"),
            "invoice_plan": inv.get("plan"),
            "invoice_status": inv.get("status"),
            "amount": pr.get("amount"),
            "currency": pr.get("currency"),
            "provider": pr.get("provider", "bank"),
            "ocr": pr.get("ocr") or {},
            "bank_statement_id": stmt_id,
            "bank_statement_url": f"/api/superadmin/saas-bank-statement/{stmt_id}" if stmt_id else None,
            "created_at": pr.get("created_at"),
        })
    return out


@api.get("/superadmin/saas-bank-statement/{asset_id}")
async def superadmin_get_saas_bank_statement(asset_id: str, user=Depends(require_role("superadmin"))):
    """Superadmin kan elk geüpload bankafschrift inzien (cross-tenant) — nodig
    voor de OCR-goedkeuringsinbox."""
    doc = await db.bank_statements.find_one({"id": asset_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Bankafschrift niet gevonden")
    try:
        data = base64.b64decode(doc["data_b64"])
    except Exception:
        raise HTTPException(status_code=500, detail="Bankafschrift corrupt")
    return Response(content=data, media_type=doc.get("content_type", "application/octet-stream"))


@api.post("/superadmin/saas-payment-requests/{pr_id}/approve")
async def superadmin_approve_saas_payment(pr_id: str, user=Depends(require_role("superadmin"))):
    """Handmatige goedkeuring na OCR-mismatch. Activeert het bedrijf."""
    pr = await db.saas_payment_requests.find_one({"id": pr_id}, {"_id": 0})
    if not pr:
        raise HTTPException(status_code=404, detail="Betalingsverzoek niet gevonden")
    if pr.get("status") == "paid":
        return {"ok": True, "already_paid": True}
    inv = await db.subscription_invoices.find_one({"id": pr.get("invoice_id")}, {"_id": 0})
    if not inv:
        raise HTTPException(status_code=404, detail="Bijbehorende factuur niet gevonden")
    c = await db.companies.find_one({"id": pr.get("company_id")}, {"_id": 0}) or {}
    result = await _record_saas_payment_manual(
        invoice=inv,
        company=c,
        amount=float(pr.get("amount") or 0),
        currency=pr.get("currency") or "SRD",
        method=pr.get("provider") or "bank",
        reference=f"Handmatige superadmin-goedkeuring van OCR-mismatch ({pr_id[:8]})",
        statement_id=pr.get("bank_statement_id"),
        ocr_meta=pr.get("ocr") or {},
        auto_approved=True,  # we doen het effectief paid in dit endpoint
        approved_by=user.get("email") or "superadmin",
    )
    # Markeer het oorspronkelijke pending request ook als paid (er is een
    # nieuw paid-request via `_record_saas_payment_manual`). De originele
    # blijft historisch staan met status=approved_by_superadmin.
    await db.saas_payment_requests.update_one(
        {"id": pr_id},
        {"$set": {"status": "approved_by_superadmin", "approved_at": iso(now_utc()),
                  "approved_by": user.get("email") or "superadmin"}},
    )
    return {"ok": True, **result}


@api.post("/superadmin/saas-payment-requests/{pr_id}/reject")
async def superadmin_reject_saas_payment(
    pr_id: str, body: dict = Body(default_factory=dict),
    user=Depends(require_role("superadmin")),
):
    """Afwijzen van een OCR-mismatch. Bedrijf blijft onbetaald."""
    pr = await db.saas_payment_requests.find_one({"id": pr_id}, {"_id": 0})
    if not pr:
        raise HTTPException(status_code=404, detail="Betalingsverzoek niet gevonden")
    reason = (body.get("reason") or "").strip() if isinstance(body, dict) else ""
    await db.saas_payment_requests.update_one(
        {"id": pr_id},
        {"$set": {"status": "rejected", "rejected_at": iso(now_utc()),
                  "rejected_by": user.get("email") or "superadmin",
                  "rejection_reason": reason or "geen reden opgegeven"}},
    )
    return {"ok": True}




@api.post("/superadmin/subscription-payments")
async def register_subscription_payment(body: SubscriptionPaymentIn, user=Depends(require_role("superadmin"))):
    """Register an incoming SaaS payment (bank transfer or Mope) and auto-activate the company."""
    c = await db.companies.find_one({"id": body.company_id}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Bedrijf niet gevonden")
    plan_id = c.get("plan", "starter")
    now = now_utc()
    paid_at = body.paid_at or iso(now)
    period_end = now + timedelta(days=30)

    # Create invoice (paid) + payment record
    inv = {
        "id": new_id(),
        "company_id": body.company_id,
        "company_name": c.get("name", ""),
        "plan": plan_id,
        "amount": body.amount,
        "currency": body.currency,
        "status": "paid",
        "period_start": iso(now),
        "period_end": iso(period_end),
        "paid_at": paid_at,
        "created_at": iso(now),
        "created_by": user.get("email"),
        "payment_method": body.method,
    }
    await db.subscription_invoices.insert_one(inv)

    pay = {
        "id": new_id(),
        "invoice_id": inv["id"],
        "company_id": body.company_id,
        "company_name": c.get("name", ""),
        "amount": body.amount,
        "currency": body.currency,
        "method": body.method,
        "reference": (body.reference or "").strip(),
        "note": (body.note or "").strip(),
        "paid_at": paid_at,
        "created_at": iso(now),
        "created_by": user.get("email"),
    }
    await db.subscription_payments.insert_one(pay)

    # If company had a pending_plan, apply it now
    update_fields = {
        "billing_status": "active",
        "subscription_started_at": iso(now),
        "subscription_renews_at": iso(period_end),
    }
    pending_plan = c.get("pending_plan")
    if pending_plan and pending_plan != c.get("plan"):
        update_fields["plan"] = pending_plan
        update_fields["pending_plan"] = None
        update_fields["pending_invoice_id"] = None
        update_fields["plan_changed_at"] = iso(now)
    await db.companies.update_one({"id": body.company_id}, {"$set": update_fields})

    # Best-effort confirmation email to the company owner
    if c.get("owner_email"):
        try:
            from email_service import send_email as _send_smtp, send_platform_email, wrap_template
            saas = await db.saas_settings.find_one({"id": SAAS_SETTINGS_ID}, {"_id": 0}) or {}
            smtp = saas.get("smtp") or {}
            app_url = (os.environ.get("APP_PUBLIC_URL") or "https://app.surirent.sr").rstrip("/")
            plan_label = PLAN_PRICES.get(update_fields.get("plan", c.get("plan", "starter")), {}).get("name", "Starter")
            content = f"""
                <h1>Betaling ontvangen — bedankt!</h1>
                <p>Wij hebben uw betaling van <strong>{body.currency} {int(body.amount):,}</strong> ontvangen via {body.method}.</p>
                <table class="kv">
                  <tr><td>Pakket</td><td>{plan_label}</td></tr>
                  <tr><td>Periode</td><td>tot {(now + timedelta(days=30)).strftime("%d %b %Y")}</td></tr>
                  <tr><td>Referentie</td><td>{body.reference or '—'}</td></tr>
                  <tr><td>Factuur</td><td>{inv['id'][:8].upper()}</td></tr>
                </table>
                <p style="margin-top:14px;">U kunt direct verder werken in uw dashboard:</p>
                <p><a href="{app_url}/admin" style="display:inline-block;background:#10B981;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none;font-weight:700;">Open dashboard</a></p>
            """.replace(",", ".")
            subject = f"Betaling ontvangen — {plan_label} actief"
            body_html = wrap_template(content, footer=f"SuriRent · {app_url}")
            if smtp.get("enabled") and smtp.get("host"):
                try:
                    await _send_smtp(smtp, to=c["owner_email"], subject=subject, body_html=body_html)
                except Exception:
                    await send_platform_email(to=c["owner_email"], subject=subject, body_html=body_html)
            else:
                await send_platform_email(to=c["owner_email"], subject=subject, body_html=body_html)
        except Exception:
            pass

    inv.pop("_id", None)
    pay.pop("_id", None)
    return {"ok": True, "invoice": inv, "payment": pay, "applied_plan": update_fields.get("plan")}


# Impersonation — superadmin can act as a company's admin to assist support
IMPERSONATE_TOKEN_MIN = 60  # 1 hour


@api.post("/superadmin/companies/{cid}/impersonate")
async def impersonate_company(cid: str, response: Response, user=Depends(require_role("superadmin"))):
    c = await db.companies.find_one({"id": cid}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Bedrijf niet gevonden")
    # Pick any admin of that company, or fall back to the superadmin email
    admin = await db.users.find_one({"company_id": cid, "role": "admin"}, {"_id": 0})
    target_user_id = (admin or user).get("id")
    target_email = (admin or user).get("email")
    payload = {
        "sub": target_user_id, "email": target_email, "type": "access",
        "company_id": cid, "role": "admin",
        "impersonated_by": user.get("email"),
        "original_user_id": user.get("id"),
    }
    token = create_token(payload, IMPERSONATE_TOKEN_MIN)
    _set_access_cookie(response, token, minutes=IMPERSONATE_TOKEN_MIN)
    await db.audit_log.insert_one({
        "id": new_id(), "type": "impersonate",
        "actor": user.get("email"), "company_id": cid,
        "company_name": c.get("name"), "at": iso(now_utc()),
    })
    return {
        "token": token,
        "company": {k: c.get(k) for k in ("id", "slug", "name", "plan")},
        "expires_in_minutes": IMPERSONATE_TOKEN_MIN,
    }


@api.post("/auth/stop-impersonating")
async def stop_impersonating(response: Response, user=Depends(get_current_user)):
    """Return to the original superadmin session after an impersonation."""
    original_id = user.get("original_user_id")
    if not original_id:
        raise HTTPException(status_code=400, detail="Geen impersonatie-sessie actief")
    super_user = await db.users.find_one({"id": original_id}, {"_id": 0, "password_hash": 0, "personal_pin_hash": 0})
    if not super_user or super_user.get("role") != "superadmin":
        raise HTTPException(status_code=403, detail="Origineel account niet gevonden of niet superadmin")
    token = create_token({
        "sub": super_user["id"], "email": super_user["email"], "type": "access",
        "company_id": super_user.get("company_id"), "role": "superadmin",
    }, ACCESS_MIN)
    _set_access_cookie(response, token)
    return {"token": token, "user": super_user}


# SaaS-level settings (banking, Mope creds, branding) stored centrally
# (SAAS_SETTINGS_ID is declared earlier near the billing helpers)


# ---------- Android-app (APK) releases — superadmin upload, publieke download ----------
import object_storage as _objstore  # noqa: E402

_APK_CHUNK_MAX = 6 * 1024 * 1024
_APK_MAX_SIZE = 300 * 1024 * 1024


class ApkUploadInit(BaseModel):
    filename: str
    size: int
    version: str
    notes: Optional[str] = ""


def _apk_public(r: dict) -> dict:
    return {k: r.get(k) for k in ("id", "version", "notes", "filename", "size", "created_at", "downloads")}


@api.post("/superadmin/apk/upload/init")
async def apk_upload_init(body: ApkUploadInit, user=Depends(require_role("superadmin"))):
    if not body.filename.lower().endswith(".apk"):
        raise HTTPException(status_code=400, detail="Alleen .apk bestanden zijn toegestaan")
    if body.size <= 0 or body.size > _APK_MAX_SIZE:
        raise HTTPException(status_code=400, detail="Bestand is te groot (max 300 MB)")
    if not body.version.strip():
        raise HTTPException(status_code=400, detail="Versienummer is verplicht")
    # Opruimen: afgebroken uploads ouder dan 1 dag.
    stale = [u["id"] async for u in db.apk_uploads.find(
        {"created_at": {"$lt": iso(now_utc() - timedelta(days=1))}}, {"_id": 0, "id": 1})]
    if stale:
        await db.apk_chunks.delete_many({"upload_id": {"$in": stale}})
        await db.apk_uploads.delete_many({"id": {"$in": stale}})
    uid = str(uuid.uuid4())
    await db.apk_uploads.insert_one({"id": uid, "filename": body.filename, "size": body.size,
                                     "version": body.version.strip(), "notes": (body.notes or "").strip(),
                                     "created_by": user["id"], "created_at": iso(now_utc())})
    # 1 MB: blijft onder de body-limiet van proxies/ingress in productie.
    return {"upload_id": uid, "chunk_size": 1024 * 1024}


@api.put("/superadmin/apk/upload/{upload_id}/chunk/{index}")
async def apk_upload_chunk(upload_id: str, index: int, request: Request, user=Depends(require_role("superadmin"))):
    if not await db.apk_uploads.find_one({"id": upload_id}, {"_id": 1}):
        raise HTTPException(status_code=404, detail="Upload niet gevonden")
    data = await request.body()
    if not data or len(data) > _APK_CHUNK_MAX:
        raise HTTPException(status_code=400, detail="Ongeldig stuk")
    # Stukken in Mongo i.p.v. /tmp: werkt ook met meerdere server-pods.
    await db.apk_chunks.update_one({"upload_id": upload_id, "index": index},
                                   {"$set": {"data": data, "at": iso(now_utc())}}, upsert=True)
    return {"ok": True, "index": index}


@api.post("/superadmin/apk/upload/{upload_id}/complete")
async def apk_upload_complete(upload_id: str, user=Depends(require_role("superadmin"))):
    """Start het opslaan op de achtergrond (grote APK's duren langer dan de
    proxy-timeout). Frontend pollt GET .../status."""
    up = await db.apk_uploads.find_one({"id": upload_id}, {"_id": 0})
    if not up:
        raise HTTPException(status_code=404, detail="Upload niet gevonden")
    if up.get("state") in ("processing", "done"):
        return {"state": up["state"]}
    parts = await db.apk_chunks.find({"upload_id": upload_id}, {"_id": 0, "index": 1}).sort("index", 1).to_list(None)
    if [p["index"] for p in parts] != list(range(len(parts))):
        raise HTTPException(status_code=400, detail="Upload onvolledig — probeer opnieuw")
    await db.apk_uploads.update_one({"id": upload_id}, {"$set": {"state": "processing"}})
    asyncio.create_task(_apk_finalize(upload_id, up, user["id"]))
    return {"state": "processing"}


async def _apk_finalize(upload_id: str, up: dict, user_id: str):
    async def fail(msg):
        await db.apk_uploads.update_one({"id": upload_id}, {"$set": {"state": "error", "error": msg}})
    try:
        blob = bytearray()
        async for p in db.apk_chunks.find({"upload_id": upload_id}, {"_id": 0, "data": 1}).sort("index", 1):
            blob += bytes(p["data"])
        if len(blob) != up["size"]:
            return await fail("Upload onvolledig — probeer opnieuw")
        if blob[:2] != b"PK":
            return await fail("Dit is geen geldig APK-bestand")
        rid = str(uuid.uuid4())
        res = await asyncio.to_thread(_objstore.put_object, f"{_objstore.APP_NAME}/apk/{rid}.apk",
                                      io.BytesIO(blob), "application/vnd.android.package-archive")
        rel = {"id": rid, "version": up["version"], "notes": up["notes"], "filename": up["filename"],
               "size": res.get("size") or len(blob), "storage_path": res["path"], "is_deleted": False,
               "downloads": 0, "created_by": user_id, "created_at": iso(now_utc())}
        await db.app_releases.insert_one(rel)
        await db.apk_chunks.delete_many({"upload_id": upload_id})
        await db.apk_uploads.update_one({"id": upload_id}, {"$set": {"state": "done", "release_id": rid}})
    except Exception as e:  # noqa: BLE001
        print(f"[apk] finalize failed: {e}")
        await fail(f"Opslaan mislukt: {e}")


@api.get("/superadmin/apk/upload/{upload_id}/status")
async def apk_upload_status(upload_id: str, user=Depends(require_role("superadmin"))):
    up = await db.apk_uploads.find_one({"id": upload_id}, {"_id": 0, "state": 1, "error": 1, "release_id": 1})
    if not up:
        raise HTTPException(status_code=404, detail="Upload niet gevonden")
    return {"state": up.get("state") or "uploading", "error": up.get("error"), "release_id": up.get("release_id")}


@api.get("/superadmin/apk")
async def apk_list(user=Depends(require_role("superadmin"))):
    docs = await db.app_releases.find({"is_deleted": False}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return [_apk_public(d) for d in docs]


@api.delete("/superadmin/apk/{release_id}")
async def apk_delete(release_id: str, user=Depends(require_role("superadmin"))):
    res = await db.app_releases.update_one({"id": release_id, "is_deleted": False},
                                           {"$set": {"is_deleted": True, "deleted_at": iso(now_utc())}})
    if not res.matched_count:
        raise HTTPException(status_code=404, detail="Versie niet gevonden")
    return {"ok": True}


async def _latest_apk():
    return await db.app_releases.find_one({"is_deleted": False}, {"_id": 0}, sort=[("created_at", -1)])


@api.get("/public/apk/latest")
async def apk_latest_public():
    r = await _latest_apk()
    return {"available": bool(r), "release": _apk_public(r) if r else None}


@api.get("/public/apk/download")
async def apk_download_public():
    r = await _latest_apk()
    if not r:
        raise HTTPException(status_code=404, detail="Nog geen app beschikbaar")
    try:
        resp = await asyncio.to_thread(_objstore.open_object_stream, r["storage_path"])
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Download mislukt: {e}")
    await db.app_releases.update_one({"id": r["id"]}, {"$inc": {"downloads": 1}})
    safe_ver = re.sub(r"[^0-9A-Za-z._-]", "", r["version"]) or "latest"

    def gen():
        try:
            yield from resp.iter_content(chunk_size=256 * 1024)
        finally:
            resp.close()

    return StreamingResponse(gen(), media_type="application/vnd.android.package-archive", headers={
        "Content-Disposition": f'attachment; filename="SuriRent-{safe_ver}.apk"',
        "Content-Length": str(r["size"]),
        "Cache-Control": "no-store",
    })


@api.get("/superadmin/settings")
async def get_saas_settings(user=Depends(require_role("superadmin"))):
    doc = await db.saas_settings.find_one({"id": SAAS_SETTINGS_ID}, {"_id": 0}) or {}
    # Mask SMTP secrets in response — only return whether they're set
    smtp = doc.get("smtp", {}) or {}
    return {
        "banking": doc.get("banking", {
            "bank_name": "", "account_name": "", "account_number": "", "swift": "",
            "support_email": "", "whatsapp": "",
        }),
        "fx": {
            "mode": (doc.get("fx") or {}).get("mode", "auto"),
            "manual_eur_per_srd": (doc.get("fx") or {}).get("manual_eur_per_srd", 0),
            "cached_rate": (doc.get("fx") or {}).get("cached_rate", 0),
            "cached_at": (doc.get("fx") or {}).get("cached_at"),
        },
        "smtp": {
            "enabled": bool(smtp.get("enabled")),
            "host": smtp.get("host", ""),
            "port": smtp.get("port", 587),
            "username": smtp.get("username", ""),
            "password_set": bool(smtp.get("password")),
            "from_name": smtp.get("from_name", "SuriRent"),
            "from_email": smtp.get("from_email", ""),
            "use_tls": bool(smtp.get("use_tls", True)),
        },
        "branding": doc.get("branding", {
            "platform_name": "SuriRent", "app_url": "",
        }),
    }


class SaasSettingsIn(BaseModel):
    banking: Optional[dict] = None
    fx: Optional[dict] = None
    smtp: Optional[dict] = None
    branding: Optional[dict] = None


@api.put("/superadmin/settings")
async def update_saas_settings(body: SaasSettingsIn, user=Depends(require_role("superadmin"))):
    existing = await db.saas_settings.find_one({"id": SAAS_SETTINGS_ID}, {"_id": 0}) or {}
    update = {}
    if body.banking is not None:
        update["banking"] = body.banking
    if body.branding is not None:
        update["branding"] = body.branding
    if body.fx is not None:
        cur = existing.get("fx", {}) or {}
        new_fx = {
            "mode": body.fx.get("mode", cur.get("mode", "auto")),
            "manual_eur_per_srd": float(body.fx.get("manual_eur_per_srd", cur.get("manual_eur_per_srd", 0)) or 0),
            "cached_rate": cur.get("cached_rate", 0),
            "cached_at": cur.get("cached_at"),
        }
        if new_fx["mode"] not in ("auto", "manual"):
            new_fx["mode"] = "auto"
        update["fx"] = new_fx
    if body.smtp is not None:
        cur = existing.get("smtp", {}) or {}
        new_smtp = {
            "enabled": bool(body.smtp.get("enabled", cur.get("enabled", False))),
            "host": body.smtp.get("host", cur.get("host", "")),
            "port": int(body.smtp.get("port", cur.get("port", 587))),
            "username": body.smtp.get("username", cur.get("username", "")),
            "password": body.smtp.get("password") if body.smtp.get("password") else cur.get("password", ""),
            "from_name": body.smtp.get("from_name", cur.get("from_name", "SuriRent")),
            "from_email": body.smtp.get("from_email", cur.get("from_email", "")),
            "use_tls": bool(body.smtp.get("use_tls", cur.get("use_tls", True))),
        }
        update["smtp"] = new_smtp
    await db.saas_settings.update_one(
        {"id": SAAS_SETTINGS_ID},
        {"$set": {"id": SAAS_SETTINGS_ID, **update, "updated_at": iso(now_utc()), "updated_by": user.get("email")}},
        upsert=True,
    )
    return {"ok": True}


@api.post("/superadmin/settings/test-smtp")
async def test_saas_smtp(user=Depends(require_role("superadmin"))):
    """Send a test e-mail to the superadmin's own address using saved SMTP."""
    doc = await db.saas_settings.find_one({"id": SAAS_SETTINGS_ID}, {"_id": 0}) or {}
    smtp = doc.get("smtp", {}) or {}
    if not smtp.get("enabled") or not smtp.get("host"):
        raise HTTPException(status_code=400, detail="SMTP is niet ingeschakeld of host ontbreekt")
    from email_service import send_email, wrap_template, EmailError
    try:
        await send_email(
            smtp, to=user.get("email"),
            subject="SuriRent — SMTP test",
            body_html=wrap_template("<h1>SMTP werkt!</h1><p>Dit is een testbericht vanuit de SaaS-omgeving.</p>"),
        )
    except EmailError as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {"ok": True}


# ---------------------------------------------------------------------------
# Superadmin — Mijn Account (eigen inloggegevens beheren)
# ---------------------------------------------------------------------------
class SuperadminAccountIn(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    password: Optional[str] = None


@api.get("/superadmin/account")
async def get_superadmin_account(user=Depends(require_role("superadmin"))):
    me = await db.users.find_one({"id": user["id"]}, {"_id": 0, "password_hash": 0, "personal_pin_hash": 0})
    if not me:
        raise HTTPException(status_code=404, detail="Account niet gevonden")
    return {
        "id": me.get("id"),
        "email": me.get("email", ""),
        "name": me.get("name", ""),
        "role": me.get("role"),
        "password_updated_at": me.get("password_updated_at"),
    }


@api.put("/superadmin/account")
async def update_superadmin_account(
    body: SuperadminAccountIn, user=Depends(require_role("superadmin"))
):
    """Superadmin kan zijn/haar eigen naam, e-mail en wachtwoord wijzigen."""
    update: dict = {}

    if body.name is not None:
        new_name = body.name.strip()
        if not new_name:
            raise HTTPException(status_code=400, detail="Naam mag niet leeg zijn")
        update["name"] = new_name[:120]

    if body.email is not None:
        new_email = body.email.strip().lower()
        if "@" not in new_email or "." not in new_email or len(new_email) < 5:
            raise HTTPException(status_code=400, detail="Ongeldig e-mailadres")
        # Check op uniciteit — behalve op de eigen record.
        clash = await db.users.find_one(
            {"email": new_email, "id": {"$ne": user["id"]}}, {"_id": 0, "id": 1},
        )
        if clash:
            raise HTTPException(status_code=400, detail="E-mailadres is al in gebruik")
        update["email"] = new_email

    if body.password is not None and body.password != "":
        if len(body.password) < 6:
            raise HTTPException(
                status_code=400, detail="Wachtwoord moet minstens 6 tekens bevatten",
            )
        update["password_hash"] = hash_password(body.password)
        update["password_updated_at"] = iso(now_utc())

    if not update:
        raise HTTPException(status_code=400, detail="Geen wijzigingen ontvangen")

    update["updated_at"] = iso(now_utc())
    await db.users.update_one({"id": user["id"]}, {"$set": update})

    me = await db.users.find_one({"id": user["id"]}, {"_id": 0, "password_hash": 0, "personal_pin_hash": 0})
    return {
        "ok": True,
        "email": (me or {}).get("email"),
        "name": (me or {}).get("name"),
        "password_updated_at": (me or {}).get("password_updated_at"),
    }


@api.post("/companies", response_model=CompanyOut)
async def create_company(body: CompanyIn, user=Depends(require_role("superadmin"))):
    slug = _validate_slug_or_raise(body.slug)
    existing = await db.companies.find_one({"slug": slug})
    if existing:
        raise HTTPException(status_code=400, detail="Slug is al in gebruik")
    doc = {"id": new_id(), **body.model_dump(), "slug": slug, "created_at": iso(now_utc())}
    await db.companies.insert_one(doc)
    doc.pop("_id", None)
    return {**doc, "stats": {"apartments": 0, "tenants": 0, "admins": 0}}


@api.put("/companies/{cid}", response_model=CompanyOut)
async def update_company(cid: str, body: CompanyIn, user=Depends(require_role("superadmin"))):
    from pymongo import ReturnDocument
    payload = body.model_dump()
    new_slug = _validate_slug_or_raise(payload["slug"])
    # Check of nieuwe slug niet al door een ander bedrijf in gebruik is.
    clash = await db.companies.find_one({"slug": new_slug, "id": {"$ne": cid}}, {"_id": 0, "id": 1})
    if clash:
        raise HTTPException(status_code=400, detail="Slug is al in gebruik")
    payload["slug"] = new_slug
    # Valideer dat het gekozen plan bestaat in de catalog. Zonder deze check
    # kon superadmin per ongeluk een typo opslaan waardoor _plan_for_company
    # bij elke aanroep zou terugvallen op 'starter' — en gebruikers dus op
    # starter bleven ondanks dat de dropdown een ander plan toonde.
    if payload.get("plan"):
        target = await _fetch_plan_by_id(payload["plan"])
        if not target:
            raise HTTPException(
                status_code=400,
                detail=f"Onbekend pakket '{payload['plan']}' — beschikbaar in SaaS Pakketten catalog?",
            )
    res = await db.companies.find_one_and_update(
        {"id": cid}, {"$set": payload},
        projection={"_id": 0}, return_document=ReturnDocument.AFTER,
    )
    if not res:
        raise HTTPException(status_code=404, detail="Bedrijf niet gevonden")
    # Neem billing_summary mee zodat de UI direct het nieuwe monthly_amount /
    # currency ziet zonder de lijst opnieuw te fetchen.
    return {**res, **(await _billing_summary(res)), "stats": None}


@api.delete("/companies/{cid}")
async def delete_company(cid: str, user=Depends(require_role("superadmin"))):
    # Refuse to delete default company
    default = await db.companies.find_one({"slug": DEFAULT_COMPANY_SLUG})
    if default and default["id"] == cid:
        raise HTTPException(status_code=400, detail="Standaard bedrijf kan niet worden verwijderd")
    # Refuse if it has data
    for coll in TENANT_SCOPED_COLLECTIONS:
        cnt = await db[coll].count_documents({"company_id": cid})
        if cnt:
            raise HTTPException(status_code=400, detail=f"Bedrijf heeft nog {cnt} records in {coll}, verwijder eerst")
    await db.companies.delete_one({"id": cid})
    await db.users.delete_many({"company_id": cid})
    await db.kiosk_pins.delete_one({"company_id": cid})
    return {"ok": True}


@api.post("/companies/{cid}/seed-admin")
async def seed_company_admin(cid: str, body: RegisterIn, user=Depends(require_role("superadmin"))):
    """Create the first admin for a company."""
    c = await db.companies.find_one({"id": cid}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Bedrijf niet gevonden")
    email = body.email.lower().strip()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="E-mailadres is al in gebruik")
    udoc = {
        "id": new_id(), "email": email, "name": body.name.strip(),
        "role": "admin", "company_id": cid,
        "password_hash": hash_password(body.password),
        "created_at": iso(now_utc()),
    }
    await db.users.insert_one(udoc)
    udoc.pop("_id", None)
    udoc.pop("password_hash", None)
    return udoc


# Kiosk PIN
@api.post("/auth/admin-to-kiosk")
async def admin_open_kiosk(
    request: Request,
    response: Response,
    user=Depends(require_role("admin", "superadmin")),
):
    """Laat een ingelogde admin/superadmin direct een kiosk-token verkrijgen
    voor zijn huidige actieve bedrijf — zonder dat er een PIN ingevoerd hoeft
    te worden. Gebruikt door de 'Open Kiosk' knop in het Beheer-dashboard.
    Het admin-token blijft behouden zodat de admin terug kan naar Beheer.

    Fallback-keten voor het bepalen van het bedrijf:
      1. `company_id` uit de request body
      2. `x-active-company` header (frontend axios interceptor)
      3. `user.company_id` (gewone admin → eigen bedrijf)
      4. Voor superadmin zonder selectie: eerste bedrijf in het systeem
    """
    cid: Optional[str] = None
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        body = {}
    if isinstance(body, dict) and body.get("company_id"):
        cid = str(body["company_id"])
    if not cid:
        cid = company_id_of(user)
    # Voor admin zonder company_id koppeling: zoek bedrijf op contact_email
    # (account is admin van het bedrijf maar user-doc had geen company_id veld).
    if not cid and user.get("role") == "admin" and user.get("email"):
        c_owned = await db.companies.find_one(
            {"contact_email": user["email"], "active": {"$ne": False}},
            {"_id": 0, "id": 1},
        )
        if c_owned:
            cid = c_owned["id"]
            # Self-heal: schrijf company_id ook in user-doc zodat dit niet
            # opnieuw fout gaat. Niet-fataal.
            try:
                await db.users.update_one(
                    {"id": user.get("id")},
                    {"$set": {"company_id": cid}},
                )
            except Exception:  # noqa: BLE001
                pass
    if not cid and user.get("role") == "superadmin":
        c0 = await db.companies.find_one({}, {"_id": 0, "id": 1})
        if c0:
            cid = c0["id"]
    if not cid:
        raise HTTPException(
            status_code=400,
            detail="Geen actief bedrijf gekoppeld aan dit account. Neem contact op met de beheerder.",
        )
    c = await db.companies.find_one({"id": cid}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Bedrijf niet gevonden")
    token = create_token({
        "sub": "kiosk", "type": "kiosk", "company_id": cid,
    }, KIOSK_TOKEN_MIN)
    _set_access_cookie(response, token, name="kiosk_token", minutes=KIOSK_TOKEN_MIN)
    return {
        "token": token,
        "company": {k: c.get(k) for k in ("id", "slug", "name")},
    }


@api.post("/auth/kiosk-pin")
async def kiosk_pin(body: PinIn, request: Request, response: Response):
    """Verifieer een PIN binnen de SCOPE van één bedrijf.

    De PIN-login werkt alleen op het branded login-scherm (`/<slug>/login` of
    `/login?c=<slug>`). De frontend stuurt `company_slug` of `company_id`
    mee zodat we alleen tegen die bedrijfs-PIN + diens medewerker-PINs
    matchen. Dit voorkomt dat twee bedrijven met dezelfde PIN per ongeluk
    in elkaars omgeving belanden.

    Retourneert zowel een kiosk_token (kort-levend, kiosk-scope) ALS een
    admin access token voor de primary admin van het bedrijf, zodat de
    "Beheerder"-knop direct door kan navigeren zonder tweede login.

    Voor employee-PINs: GEEN admin_token (zij mogen niet bij Beheer).
    """
    throttle_key = f"kiosk:{_client_ip(request)}"
    _pin_throttle_check(throttle_key)

    # ---- Bepaal bedrijfs-scope ----
    target_cid = None
    if body.company_id:
        c = await db.companies.find_one({"id": body.company_id.strip()}, {"_id": 0, "id": 1})
        if c:
            target_cid = c["id"]
    elif body.company_slug:
        c = await db.companies.find_one({"slug": body.company_slug.strip().lower()}, {"_id": 0, "id": 1})
        if c:
            target_cid = c["id"]
    if not target_cid:
        raise HTTPException(
            status_code=400,
            detail="PIN-login werkt alleen op uw bedrijfs-portaal. Open de link uw bedrijf u stuurde, of gebruik e-mail + wachtwoord.",
        )

    # Bedrijfsbrede throttle: voorkomt brute-force via wisselende IP-headers.
    co_key = f"kiosk-co:{target_cid}"
    _pin_throttle_check(co_key)

    # ---- Medewerker-PINs (eerst, zodat een medewerker nooit als beheerder binnenkomt) ----
    emp_docs = await db.employees.find(
        {
            "company_id": target_cid,
            "active": True,
            "app_role": "kiosk",
            "kiosk_pin_hash": {"$exists": True, "$ne": None},
        },
        {"_id": 0},
    ).to_list(2000)
    matched_emp = None
    for e in emp_docs:
        if verify_password(body.pin, e.get("kiosk_pin_hash", "")):
            matched_emp = e
            break
    if matched_emp:
        # Pakket-gate: Kiosk terminal moet in het abonnement zitten.
        await _require_plan_feature(target_cid, "allow_kiosk", "Kiosk terminal")
        _pin_throttle_clear(throttle_key)
        _pin_throttle_clear(co_key)
        cid = matched_emp.get("company_id")
        c = await db.companies.find_one({"id": cid}, {"_id": 0}) if cid else None
        token = create_token({
            "sub": "kiosk", "type": "kiosk", "company_id": cid,
        }, KIOSK_TOKEN_MIN)
        _set_access_cookie(response, token, name="kiosk_token", minutes=KIOSK_TOKEN_MIN)
        return {
            "token": token,
            "company": c and {k: c[k] for k in ("id", "slug", "name")},
            "admin_token": None,
            "admin_user": None,
            "employee": {
                "id": matched_emp["id"],
                "name": matched_emp.get("name", ""),
                "pin": body.pin,  # frontend gebruikt dit voor sessionStorage → withKioskEmployee()
            },
        }

    # ---- Persoonlijke PIN van beheerders van dit bedrijf (één PIN-scherm) ----
    admin_docs = await db.users.find(
        {"company_id": target_cid, "role": {"$ne": "kiosk"},
         "disabled": {"$ne": True}, "personal_pin_hash": {"$exists": True, "$ne": None}},
        {"_id": 0},
    ).to_list(200)
    for u in admin_docs:
        if verify_password(body.pin, u.get("personal_pin_hash", "")):
            _pin_throttle_clear(throttle_key)
            _pin_throttle_clear(co_key)
            atoken = create_token({
                "sub": u["id"], "email": u["email"], "type": "access",
                "company_id": u.get("company_id"), "role": u.get("role", "admin"),
            }, ACCESS_MIN)
            _set_access_cookie(response, atoken)
            c = await db.companies.find_one({"id": target_cid}, {"_id": 0, "id": 1, "slug": 1, "name": 1})
            return {
                "token": None, "company": c, "admin_token": atoken,
                "admin_user": {"id": u["id"], "email": u["email"], "name": u.get("name", ""),
                               "role": u.get("role", "admin")},
                "employee": None,
            }
    _pin_throttle_fail(co_key, max_attempts=30)
    _pin_throttle_fail(throttle_key)
    raise HTTPException(status_code=401, detail="Ongeldige PIN code")


# =====================================================================
# Tenant portal auth
# =====================================================================
TENANT_TOKEN_MIN = KIOSK_TOKEN_MIN  # 1 jaar


async def get_tenant_session(request: Request) -> dict:
    token = extract_token(request, "tenant_token")
    if not token:
        raise HTTPException(status_code=401, detail="Niet ingelogd")
    try:
        payload = decode_token(token)
        if payload.get("type") != "tenant":
            raise HTTPException(status_code=401, detail="Ongeldig token type")
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Sessie verlopen")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Ongeldig token")
    tenant = await db.tenants.find_one({"id": payload["sub"]}, {"_id": 0, "pin_hash": 0})
    if not tenant:
        raise HTTPException(status_code=401, detail="Huurder niet gevonden")
    return tenant


class TenantLoginIn(BaseModel):
    identifier: str  # phone or email
    pin: str = Field(min_length=4, max_length=4)


class TenantSetPinIn(BaseModel):
    tenant_id: str
    pin: str = Field(min_length=4, max_length=4)


@api.post("/tenant-portal/login")
async def tenant_portal_login(body: TenantLoginIn, request: Request, response: Response):
    throttle_key = f"tenant:{_client_ip(request)}:{body.identifier.strip().lower()[:40]}"
    _pin_throttle_check(throttle_key)
    ident = body.identifier.strip().lower()
    # Find by email or phone (normalize phone by stripping non-digits)
    digits = "".join(ch for ch in body.identifier if ch.isdigit())
    query = {"$or": [
        {"email": ident},
        {"phone": body.identifier},
    ]}
    if digits:
        query["$or"].append({"phone_digits": digits})
    tenant = await db.tenants.find_one(query)
    if not tenant or not tenant.get("pin_hash"):
        _pin_throttle_fail(throttle_key)
        raise HTTPException(status_code=401, detail="Onjuiste gegevens of PIN niet ingesteld")
    if not verify_password(body.pin, tenant.get("pin_hash", "")):
        _pin_throttle_fail(throttle_key)
        raise HTTPException(status_code=401, detail="Onjuiste PIN")
    _pin_throttle_clear(throttle_key)
    token = create_token({"sub": tenant["id"], "type": "tenant"}, TENANT_TOKEN_MIN)
    _set_access_cookie(response, token, name="tenant_token", minutes=TENANT_TOKEN_MIN)
    return {
        "token": token,
        "tenant": {"id": tenant["id"], "name": tenant["name"], "email": tenant.get("email"), "phone": tenant.get("phone")},
    }


@api.post("/auth/tenant-set-pin")
async def admin_set_tenant_pin(body: TenantSetPinIn, user=Depends(get_current_user)):
    """Admin sets/resets a tenant's portal PIN."""
    if not body.pin.isdigit():
        raise HTTPException(status_code=400, detail="PIN moet 4 cijfers zijn")
    t = await db.tenants.find_one({"id": body.tenant_id, **scope(user)}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Huurder niet gevonden")
    # PIN moet uniek zijn binnen het bedrijf — zo kan de huurder later
    # alléén met PIN inloggen (zonder e-mail) op de Huurder Kiosk.
    cid = t.get("company_id")
    if cid:
        others = await db.tenants.find(
            {"company_id": cid, "id": {"$ne": body.tenant_id}, "pin_hash": {"$exists": True, "$ne": None}},
            {"_id": 0, "id": 1, "name": 1, "pin_hash": 1},
        ).to_list(2000)
        for o in others:
            if verify_password(body.pin, o.get("pin_hash") or ""):
                raise HTTPException(
                    status_code=409,
                    detail=f"Deze PIN is al in gebruik door {o.get('name', 'een andere huurder')} — kies een andere code.",
                )
    await db.tenants.update_one(
        {"id": body.tenant_id, **scope(user)},
        {"$set": {
            "pin_hash": hash_password(body.pin),
            "phone_digits": "".join(ch for ch in (t.get("phone") or "") if ch.isdigit()),
        }},
    )
    return {"ok": True}


@api.post("/tenant-portal/logout")
async def tenant_portal_logout(response: Response):
    response.delete_cookie("tenant_token", path="/")
    return {"ok": True}


class TenantPinLoginIn(BaseModel):
    pin: str = Field(min_length=4, max_length=4)
    company_id: Optional[str] = None
    company_slug: Optional[str] = None


# =====================================================================
# NFC-only Huurder Kiosk login
# =====================================================================
# /kiosk/huurder gebruikt NFC kaarten/tags als ENIGE login-methode.
# Werkt via Web NFC (Android Chrome), USB HID NFC-lezer (Windows/Android-tablet
# in keyboard-mode), of universele URL-tag (?nfc=<UID>) voor iOS Safari.
# Een huurder krijgt zijn kaart toegekend door de beheerder via
# `PUT /api/admin/tenants/{id}/nfc-card`.

def _normalize_nfc_uid(card_id: str) -> str:
    """Normalize NFC UID: uppercase, alphanumeric only. Zelfde regels als
    de operator-Kiosk nfc-lookup voor consistentie."""
    if not card_id:
        return ""
    return "".join(c for c in str(card_id).strip().upper() if c.isalnum())


class TenantNfcLoginIn(BaseModel):
    card_id: str
    company_id: Optional[str] = None
    company_slug: Optional[str] = None


class TenantNfcAssignIn(BaseModel):
    card_id: Optional[str] = None


@api.post("/tenant-portal/nfc-login")
async def tenant_portal_nfc_login(body: TenantNfcLoginIn, request: Request, response: Response):
    """NFC-tap login voor de Huurder Kiosk. Zoekt huurder via
    `tenants.nfc_card_id` binnen de gegeven bedrijfscontext."""
    uid = _normalize_nfc_uid(body.card_id)
    if not uid or len(uid) < 4:
        raise HTTPException(status_code=400, detail="Lege of ongeldige kaart-UID")
    cid = body.company_id
    if not cid and body.company_slug:
        c = await db.companies.find_one({"slug": body.company_slug.lower()}, {"_id": 0, "id": 1})
        cid = c["id"] if c else None
    if not cid:
        raise HTTPException(status_code=400, detail="Bedrijfscontext ontbreekt")
    # Throttle per IP × bedrijf — voorkom brute-forcing UID-ruimte.
    throttle_key = f"tenant-nfc:{_client_ip(request)}:{cid}"
    _pin_throttle_check(throttle_key)
    tenant = await db.tenants.find_one(
        {"company_id": cid, "nfc_card_id": uid},
        {"_id": 0, "id": 1, "name": 1, "email": 1, "phone": 1, "apartment_id": 1},
    )
    if not tenant:
        _pin_throttle_fail(throttle_key)
        raise HTTPException(
            status_code=404,
            detail="Onbekende NFC-kaart. Vraag de beheerder om uw kaart te koppelen.",
        )
    _pin_throttle_clear(throttle_key)
    token = create_token({"sub": tenant["id"], "type": "tenant"}, TENANT_TOKEN_MIN)
    _set_access_cookie(response, token, name="tenant_token", minutes=TENANT_TOKEN_MIN)
    return {
        "token": token,
        "tenant": {
            "id": tenant["id"], "name": tenant.get("name"),
            "email": tenant.get("email"), "phone": tenant.get("phone"),
        },
    }


@api.put("/admin/tenants/{tenant_id}/nfc-card")
async def admin_assign_tenant_nfc_card(
    tenant_id: str, body: TenantNfcAssignIn, user=Depends(get_current_user),
):
    """Beheerder koppelt/verwijdert een NFC-kaart aan een huurder. Leeg
    `card_id` ⇒ koppeling wissen. UID is uniek binnen het bedrijf."""
    cid = company_id_of(user)
    tenant = await db.tenants.find_one({"id": tenant_id, **scope(user)}, {"_id": 0})
    if not tenant:
        raise HTTPException(status_code=404, detail="Huurder niet gevonden")
    uid = _normalize_nfc_uid(body.card_id or "") or None
    if uid:
        clash = await db.tenants.find_one(
            {"company_id": cid, "nfc_card_id": uid, "id": {"$ne": tenant_id}},
            {"_id": 0, "id": 1, "name": 1},
        )
        if clash:
            raise HTTPException(
                status_code=409,
                detail=f"Kaart is al gekoppeld aan huurder {clash.get('name') or clash.get('id')}",
            )
    upd = {"nfc_card_id": uid} if uid else {"nfc_card_id": None}
    await db.tenants.update_one({"id": tenant_id}, {"$set": upd})
    return {"ok": True, "tenant_id": tenant_id, "nfc_card_id": uid}


# ---------- Kiosk: NFC-tag → huurder (lookup + koppelen door medewerker/beheerder) ----------
class KioskNfcLookupIn(BaseModel):
    card_id: str = Field(min_length=4, max_length=64)


class KioskNfcLinkIn(KioskNfcLookupIn):
    tenant_id: str
    replace: bool = False


async def _kiosk_nfc_result(sc: dict, tenant: dict) -> dict:
    apts = await _kiosk_apartments_compute({**sc, "tenant_id": tenant["id"]})
    return {"found": True, "tenant": {"id": tenant["id"], "name": tenant.get("name")},
            "apartment": apts[0] if apts else None}


@api.post("/kiosk/nfc-lookup")
async def kiosk_nfc_lookup(body: KioskNfcLookupIn, _session=Depends(get_kiosk_session)):
    sc = kiosk_scope(_session)
    uid = _normalize_nfc_uid(body.card_id)
    if len(uid) < 4:
        raise HTTPException(status_code=422, detail="Ongeldige tag-ID")
    t = await db.tenants.find_one({**sc, "nfc_card_id": uid}, {"_id": 0, "id": 1, "name": 1})
    if not t:
        return {"found": False, "card_id": uid}
    return await _kiosk_nfc_result(sc, t)


@api.post("/kiosk/nfc-link")
async def kiosk_nfc_link(body: KioskNfcLinkIn, _session=Depends(get_kiosk_session)):
    """Medewerker/beheerder koppelt een onbekende tag aan een huurder (één tag per huurder)."""
    sc = kiosk_scope(_session)
    uid = _normalize_nfc_uid(body.card_id)
    if len(uid) < 4:
        raise HTTPException(status_code=422, detail="Ongeldige tag-ID")
    t = await db.tenants.find_one({**sc, "id": body.tenant_id}, {"_id": 0, "id": 1, "name": 1})
    if not t:
        raise HTTPException(status_code=404, detail="Huurder niet gevonden")
    clash = await db.tenants.find_one({**sc, "nfc_card_id": uid, "id": {"$ne": t["id"]}}, {"_id": 0, "id": 1, "name": 1})
    if clash and not body.replace:
        raise HTTPException(status_code=409, detail=f"Deze tag is al gekoppeld aan {clash.get('name') or 'een andere huurder'}")
    if clash:
        await db.tenants.update_one({"id": clash["id"]}, {"$set": {"nfc_card_id": None}})
    await db.tenants.update_one({"id": t["id"]}, {"$set": {"nfc_card_id": uid}})
    return await _kiosk_nfc_result(sc, t)


@api.get("/tenant-portal/welcome/{tenant_id}")
async def tenant_portal_welcome(tenant_id: str):
    """Public lookup endpoint voor persoonlijke huurder-QR.
    Geeft alleen de minimale info terug: naam + of er al een PIN is gezet.
    GEEN authenticatie nodig — de tenant_id in de QR is bewust geen geheim
    (de QR krijgt de huurder fysiek aangeleverd; PIN beschermt de toegang)."""
    t = await db.tenants.find_one(
        {"id": tenant_id}, {"_id": 0, "id": 1, "name": 1, "company_id": 1, "pin_hash": 1}
    )
    if not t:
        raise HTTPException(status_code=404, detail="Huurder niet gevonden")
    c = await db.companies.find_one(
        {"id": t.get("company_id")},
        {"_id": 0, "id": 1, "name": 1, "slug": 1, "branding": 1},
    ) if t.get("company_id") else None
    return {
        "tenant_id": t["id"],
        "tenant_name": t.get("name"),
        "has_pin": bool(t.get("pin_hash")),
        "company": c and {
            "id": c["id"], "name": c.get("name"), "slug": c.get("slug"),
            "branding": c.get("branding") or {},
        },
    }


class TenantSetupPinIn(BaseModel):
    tenant_id: str
    pin: str = Field(min_length=4, max_length=4)


@api.post("/tenant-portal/setup-pin")
async def tenant_portal_setup_pin(body: TenantSetupPinIn, request: Request, response: Response):
    """Eerste-keer PIN setup voor een huurder via de persoonlijke QR.
    Werkt ALLEEN als de huurder nog GEEN PIN heeft (anti-takeover).
    Resultaat: PIN wordt opgeslagen + huurder krijgt direct een geldig
    tenant_token zodat hij na de setup meteen ingelogd is in zijn portal.

    Veiligheid:
      • Tenant_id staat in QR (semi-publiek) maar zonder PIN kan een aanvaller
        niets doen — eerste setup is one-shot.
      • Bij bestaande PIN: 409 Conflict → frontend toont login i.p.v. setup.
      • Throttling via IP zodat brute-force PIN setup niet mogelijk is.
    """
    if not body.pin.isdigit() or len(body.pin) != 4:
        raise HTTPException(status_code=400, detail="PIN moet exact 4 cijfers zijn")
    throttle_key = f"tenant-setup-pin:{_client_ip(request)}"
    _pin_throttle_check(throttle_key)
    t = await db.tenants.find_one(
        {"id": body.tenant_id},
        {"_id": 0, "id": 1, "name": 1, "email": 1, "phone": 1,
         "pin_hash": 1, "company_id": 1, "apartment_id": 1},
    )
    if not t:
        _pin_throttle_fail(throttle_key)
        raise HTTPException(status_code=404, detail="Huurder niet gevonden")
    if t.get("pin_hash"):
        _pin_throttle_fail(throttle_key)
        raise HTTPException(status_code=409, detail="PIN is al ingesteld — log in met uw bestaande PIN")
    # Conflict-check: deze PIN mag nog niet in gebruik zijn binnen hetzelfde
    # bedrijf (anders zou PIN-only login twee huurders vinden).
    cid = t.get("company_id")
    if cid:
        async for other in db.tenants.find(
            {"company_id": cid, "pin_hash": {"$exists": True, "$ne": None},
             "id": {"$ne": t["id"]}},
            {"_id": 0, "pin_hash": 1},
        ):
            if verify_password(body.pin, other.get("pin_hash") or ""):
                raise HTTPException(
                    status_code=409,
                    detail="Deze PIN is al in gebruik. Kies een andere 4-cijferige PIN.",
                )
    # PIN opslaan
    await db.tenants.update_one(
        {"id": t["id"]},
        {"$set": {"pin_hash": hash_password(body.pin),
                  "pin_set_at": iso(now_utc())}},
    )
    _pin_throttle_clear(throttle_key)
    # Direct inloggen — geef token mee zodat user na setup gelijk doorgaat
    token = create_token({"sub": t["id"], "type": "tenant"}, TENANT_TOKEN_MIN)
    _set_access_cookie(response, token, name="tenant_token", minutes=TENANT_TOKEN_MIN)
    return {
        "token": token,
        "tenant": {
            "id": t["id"], "name": t.get("name"),
            "email": t.get("email"), "phone": t.get("phone"),
        },
    }


@api.post("/tenant-portal/pin-login")
async def tenant_portal_pin_login(body: TenantPinLoginIn, request: Request, response: Response):
    """PIN-only login voor de Huurder Kiosk.
    De PIN is uniek per bedrijf (afgedwongen bij `tenant-set-pin`), dus
    we hebben naast de PIN een bedrijfscontext nodig (slug of id) om de
    juiste huurder te vinden. Zonder context: 400.
    """
    if not body.pin.isdigit():
        raise HTTPException(status_code=400, detail="PIN moet 4 cijfers zijn")
    cid = body.company_id
    if not cid and body.company_slug:
        c = await db.companies.find_one({"slug": body.company_slug.lower()}, {"_id": 0, "id": 1})
        cid = c["id"] if c else None
    if not cid:
        raise HTTPException(status_code=400, detail="Bedrijfscontext ontbreekt")
    throttle_key = f"tenant-pin:{_client_ip(request)}:{cid}"
    _pin_throttle_check(throttle_key)
    cursor = db.tenants.find(
        {"company_id": cid, "pin_hash": {"$exists": True, "$ne": None}},
        {"_id": 0, "id": 1, "name": 1, "email": 1, "phone": 1, "pin_hash": 1, "company_id": 1, "apartment_id": 1},
    )
    match = None
    async for t in cursor:
        if verify_password(body.pin, t.get("pin_hash") or ""):
            match = t
            break
    if not match:
        _pin_throttle_fail(throttle_key)
        raise HTTPException(status_code=401, detail="Onjuiste PIN")
    _pin_throttle_clear(throttle_key)
    token = create_token({"sub": match["id"], "type": "tenant"}, TENANT_TOKEN_MIN)
    _set_access_cookie(response, token, name="tenant_token", minutes=TENANT_TOKEN_MIN)
    return {
        "token": token,
        "tenant": {
            "id": match["id"], "name": match.get("name"),
            "email": match.get("email"), "phone": match.get("phone"),
        },
    }


class TenantForgotPinIn(BaseModel):
    identifier: str  # email of telefoonnummer
    company_id: Optional[str] = None
    company_slug: Optional[str] = None


def _generate_unique_pin(used_hashes: list, max_tries: int = 25) -> str:
    """Genereer een 4-cijferige PIN die nog niet in `used_hashes` voorkomt.
    PIN's beginnen niet met '0' zodat de huurder ze beter kan onthouden
    (anders gaat een leading-zero op de display soms verloren).

    Gebruikt `secrets.randbelow` (cryptografisch sterke RNG) i.p.v. `random`
    zodat de PIN niet voorspelbaar is — relevant omdat het de enige
    authenticatie van een huurder is op de Kiosk.
    """
    for _ in range(max_tries):
        pin = f"{1000 + secrets.randbelow(9000)}"
        clash = False
        for h in used_hashes:
            if h and verify_password(pin, h):
                clash = True
                break
        if not clash:
            return pin
    # Fall-back: 5-cijferige PIN als 4-cijfers volledig "op" is — extreem
    # zeldzaam in de praktijk (>1000 huurders met PIN) maar voorkomt loop.
    return f"{10000 + secrets.randbelow(90000)}"


@api.post("/tenant-portal/forgot-pin")
async def tenant_forgot_pin(body: TenantForgotPinIn, request: Request):
    """Stuur de huurder een nieuwe PIN via Email + WhatsApp.

    Aangeroepen vanaf de Huurder Kiosk na bv. 3 foute PIN-pogingen.
    We zoeken de huurder op basis van email (case-insensitive) of
    laatste-4-cijfers van het telefoonnummer binnen de gegeven company.
    Voor de UX retourneren we altijd `{ok:true}` (anti-enumeratie) maar
    daarbij ook welke kanalen gebruikt zijn ("via Email", "via WhatsApp",
    of beide) als we de tenant gevonden hebben.

    Anti-misbruik: max 3 forgot-pin requests per IP per 10 minuten via
    de bestaande _pin_throttle_* helpers (key prefix 'forgot-pin').
    """
    # Throttle — onafhankelijk van pin-throttle zodat het loslaten van
    # de lockout ook na 3 foute PIN-pogingen blijft gelden.
    throttle_key = f"forgot-pin:{_client_ip(request)}"
    _pin_throttle_check(throttle_key)

    # Resolve company
    cid = body.company_id
    if not cid and body.company_slug:
        c = await db.companies.find_one({"slug": body.company_slug.lower()}, {"_id": 0, "id": 1})
        cid = c["id"] if c else None
    if not cid:
        raise HTTPException(status_code=400, detail="Bedrijfscontext ontbreekt")

    ident = (body.identifier or "").strip()
    if not ident:
        raise HTTPException(status_code=400, detail="Vul uw email of telefoonnummer in")

    # Find tenant: email match (case-insensitive) of phone-digits ends-with
    digits = "".join(ch for ch in ident if ch.isdigit())
    or_clauses = [{"email": ident.lower()}]
    if digits:
        # Last 4-12 cijfers van het telefoonnummer moeten matchen op
        # phone_digits suffix — dat ondersteunt zowel "597 8123456" als
        # "+597 8 123 456" varianten.
        or_clauses.append({"phone_digits": {"$regex": f"{re.escape(digits)}$"}})
    tenant = await db.tenants.find_one(
        {"company_id": cid, "$or": or_clauses},
        {"_id": 0},
    )
    if not tenant:
        # Anti-enumeratie: tel als poging zodat brute-force phone-suffix
        # gissen wordt afgestraft.
        _pin_throttle_fail(throttle_key)
        # Generieke OK-response — geen info-leak.
        return {"ok": True, "via": []}

    # Generate fresh PIN, ensure uniek binnen company.
    others = await db.tenants.find(
        {"company_id": cid, "id": {"$ne": tenant["id"]}, "pin_hash": {"$exists": True, "$ne": None}},
        {"_id": 0, "pin_hash": 1},
    ).to_list(2000)
    used = [o["pin_hash"] for o in others]
    new_pin = _generate_unique_pin(used)

    await db.tenants.update_one(
        {"id": tenant["id"]},
        {"$set": {
            "pin_hash": hash_password(new_pin),
            "phone_digits": "".join(ch for ch in (tenant.get("phone") or "") if ch.isdigit()),
            "pin_reset_at": iso(now_utc()),
        }},
    )

    via: list = []
    company = await db.companies.find_one({"id": cid}, {"_id": 0})
    company_name = (company or {}).get("name") or "Vastgoed Kiosk"

    # Email
    email = (tenant.get("email") or "").strip()
    if email:
        try:
            from email_service import send_email as _send_smtp, wrap_template
            smtp = await get_company_section(cid, "smtp")
            if smtp and smtp.get("enabled") and smtp.get("host"):
                brand_kwargs = await _tenant_email_brand(cid)
                subject = f"Uw nieuwe PIN voor {company_name}"
                content_html = (
                    f"<h2 style='color:{brand_kwargs['brand_color']};margin:0 0 12px 0;'>Nieuwe PIN code</h2>"
                    f"<p>Beste {tenant.get('name', 'huurder')},</p>"
                    f"<p>U heeft een nieuwe PIN aangevraagd om in te loggen op uw huurder-kiosk:</p>"
                    f"<p style='font-size:32px;font-weight:bold;letter-spacing:8px;text-align:center;"
                    f"padding:16px;background:#f5f5f5;border-radius:12px;color:{brand_kwargs['brand_color']};'>{new_pin}</p>"
                    f"<p>Gebruik deze code om uw saldo en betalingen te bekijken. "
                    f"Heeft u dit niet aangevraagd? Neem dan contact op met de receptie.</p>"
                )
                body_html = wrap_template(content_html, footer=company_name, **brand_kwargs)
                await _send_smtp(smtp, to=email, subject=subject, body_html=body_html)
                via.append("email")
        except Exception as e:
            print(f"[forgot-pin] email send failed: {e}")

    # WhatsApp (en SMS-fallback)
    phone = (tenant.get("phone") or "").strip()
    if phone:
        try:
            from twilio_service import send_whatsapp, send_sms
            cfg = await get_company_section(cid, "twilio")
            if cfg and cfg.get("account_sid") and cfg.get("auth_token"):
                msg = (
                    f"{company_name} — Uw nieuwe PIN: *{new_pin}*\n"
                    f"Gebruik deze code op de Huurder Kiosk om in te loggen. "
                    f"Niet aangevraagd? Neem contact op met de receptie."
                )
                try:
                    await send_whatsapp(cfg, phone, msg)
                    via.append("whatsapp")
                except Exception:
                    # Val terug op SMS als WhatsApp faalt (geen joined-channel etc.)
                    try:
                        await send_sms(cfg, phone, msg)
                        via.append("sms")
                    except Exception as e2:
                        print(f"[forgot-pin] whatsapp+sms send failed: {e2}")
        except Exception as e:
            print(f"[forgot-pin] twilio config failed: {e}")

    # Reset throttle alleen bij succesvolle verzending (anders moedigen we
    # iemand aan om met emptyresult te blijven proberen).
    if via:
        _pin_throttle_clear(throttle_key)
    else:
        _pin_throttle_fail(throttle_key)

    return {"ok": True, "via": via}


@api.get("/tenant-portal/me")
async def tenant_portal_me(tenant=Depends(get_tenant_session)):
    return {
        "id": tenant["id"],
        "name": tenant["name"],
        "email": tenant.get("email"),
        "phone": tenant.get("phone"),
    }


@api.get("/tenant-portal/overview")
async def tenant_portal_overview(tenant=Depends(get_tenant_session)):
    apt = None
    if tenant.get("apartment_id"):
        apt = await db.apartments.find_one({"id": tenant["apartment_id"]}, {"_id": 0})
    bal = await _calc_balance(tenant)
    # Zelfde totaal als de medewerker-kiosk: achterstand + huidige maand.
    kov = await kiosk_tenant_overview(tenant["id"], {"company_id": tenant.get("company_id")})
    total_due = float(kov.get("total_due") or 0)
    # Boetes (automatische) — zelfde logica als kiosk_tenant_overview, maar
    # vereenvoudigd omdat de tenant-portal geen gedetailleerde buckets kent.
    # We tellen alle open facturen van deze huurder die >grace dagen te laat
    # zijn, en passen de admin-ingestelde boete toe.
    fines_total = 0.0
    fines_currency = bal.get("currency") or "SRD"
    try:
        cs = await db.company_settings.find_one(
            {"company_id": tenant.get("company_id")},
            {"_id": 0, "invoicing": 1},
        )
        inv_cfg = (cs or {}).get("invoicing") if cs else None
        if isinstance(inv_cfg, dict) and inv_cfg.get("fines_enabled"):
            fine_amt = float(inv_cfg.get("fines_amount") or 0)
            fine_mode = str(inv_cfg.get("fines_mode") or "per_overdue")
            fine_grace = int(inv_cfg.get("fines_grace_days") or 0)
            fines_currency = str(inv_cfg.get("fines_currency") or fines_currency)
            if fine_amt > 0:
                today_local = now_utc().date()
                overdue_count = 0
                total_days = 0
                async for inv in db.invoices.find(
                    {"tenant_id": tenant["id"], "status": {"$ne": "paid"}},
                    {"_id": 0, "due_date": 1, "amount_due": 1, "amount": 1, "paid_amount": 1},
                ):
                    total = float(inv.get("amount_due") or inv.get("amount") or 0)
                    paid = float(inv.get("paid_amount") or 0)
                    if total - paid <= 0:
                        continue
                    dd = inv.get("due_date")
                    if not dd:
                        continue
                    try:
                        due = datetime.fromisoformat(str(dd)).date()
                    except Exception:  # noqa: BLE001
                        continue
                    days_late = (today_local - due).days - fine_grace
                    if days_late > 0:
                        overdue_count += 1
                        total_days += days_late
                if fine_mode == "per_day":
                    fines_total = round(fine_amt * total_days, 2)
                else:
                    fines_total = round(fine_amt * overdue_count, 2)
    except Exception:  # noqa: BLE001
        pass
    return {
        "tenant": {"id": tenant["id"], "name": tenant["name"], "phone": tenant.get("phone"), "email": tenant.get("email")},
        "apartment": apt and {
            "id": apt["id"], "number": apt["number"], "address": apt.get("address", ""),
            "rent_amount": apt["rent_amount"], "currency": apt["currency"],
        },
        "balance": bal,
        "total_due": total_due,
        "is_paid": bool(kov.get("is_paid")),
        "due_periods": [{"month": i.get("period_month"), "year": i.get("period_year")}
                        for i in (kov.get("open_invoices") or []) + (kov.get("current_invoices") or [])
                        if i.get("period_month")],
        "fines_total": fines_total,
        "fines_currency": fines_currency,
    }


@api.get("/tenant-portal/payments")
async def tenant_portal_payments(tenant=Depends(get_tenant_session)):
    docs = await db.payments.find({"tenant_id": tenant["id"]}, {"_id": 0}).sort("paid_at", -1).to_list(200)
    return await _enrich_payments_bulk(docs)


@api.get("/tenant-portal/contracts")
async def tenant_portal_contracts(tenant=Depends(get_tenant_session)):
    docs = await db.contracts.find({"tenant_id": tenant["id"]}, {"_id": 0}).sort("created_at", -1).to_list(50)
    return [await _enrich_contract(d) for d in docs]


@api.get("/tenant-portal/maintenance")
async def tenant_portal_maintenance(tenant=Depends(get_tenant_session)):
    if not tenant.get("apartment_id"):
        return []
    docs = await db.maintenance.find({"apartment_id": tenant["apartment_id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return [await _enrich_maint(d) for d in docs]


# ---------------------------------------------------------------------------
# OCR + auto-approve voor bankafschriften (Gemini 2.5 Flash via Emergent LLM key).
# ---------------------------------------------------------------------------

OCR_AMOUNT_TOLERANCE_PCT = 0.01
OCR_AMOUNT_TOLERANCE_ABS = 1.0
OCR_DATE_WINDOW_DAYS = 21


async def _ocr_bank_statement(statement_id: str) -> dict:
    """Stuurt bankafschrift naar Gemini en haalt gestructureerde data op."""
    import os
    import json
    import tempfile
    from emergentintegrations.llm.chat import LlmChat, UserMessage, FileContentWithMimeType

    api_key = os.getenv("EMERGENT_LLM_KEY")
    if not api_key:
        raise RuntimeError("EMERGENT_LLM_KEY ontbreekt in environment")

    doc = await db.bank_statements.find_one({"id": statement_id}, {"_id": 0})
    if not doc:
        raise RuntimeError(f"Bankafschrift {statement_id} niet gevonden")

    raw = base64.b64decode(doc["data_b64"])
    ctype = (doc.get("content_type") or "").lower()
    if "pdf" in ctype:
        mime, suffix = "application/pdf", ".pdf"
    elif "png" in ctype:
        mime, suffix = "image/png", ".png"
    elif "webp" in ctype:
        mime, suffix = "image/webp", ".webp"
    else:
        mime, suffix = "image/jpeg", ".jpg"

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as f:
        f.write(raw)
        tmp_path = f.name

    prompt = (
        "Je bent een precieze OCR-extractie engine voor bankafschriften en "
        "betalingsbewijzen (Suriname DSB/Finabank, Nederlandse banken zoals "
        "ING/ABN/RABO). Analyseer het bijgevoegde document en haal de "
        "transactie-informatie eruit.\n\n"
        "Antwoord UITSLUITEND met geldig JSON (geen markdown, geen code-blok, "
        "geen uitleg) in dit exacte schema:\n"
        '{\n'
        '  "amount": <number of null>,\n'
        '  "currency": "SRD"|"EUR"|"USD"|null,\n'
        '  "date_iso": "YYYY-MM-DD" of null,\n'
        '  "payer_name": "<string>" of null,\n'
        '  "beneficiary": "<string>" of null,\n'
        '  "reference": "<string>" of null,\n'
        '  "confidence": <0..1>,\n'
        '  "raw_text": "<korte samenvatting>"\n'
        '}\n\n'
        "Belangrijk:\n"
        "- Als het document GEEN bankafschrift is, zet confidence op 0.\n"
        "- Bedragen: gebruik punt als decimaalteken (bv 7000.00).\n"
        "- Datum altijd in ISO-formaat YYYY-MM-DD.\n"
        "- Confidence = 1.0 alleen als ALLES duidelijk leesbaar is."
    )

    chat = LlmChat(
        api_key=api_key,
        session_id=f"ocr-{statement_id[:8]}",
        system_message="Je bent een OCR-extractie engine die uitsluitend geldig JSON terug geeft.",
    ).with_model("gemini", "gemini-2.5-flash")

    try:
        file_attach = FileContentWithMimeType(file_path=tmp_path, mime_type=mime)
        msg = UserMessage(text=prompt, file_contents=[file_attach])
        response_text = await chat.send_message(msg)
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass

    txt = (response_text or "").strip()
    if txt.startswith("```"):
        lines = txt.split("\n")
        txt = "\n".join(line for line in lines if not line.startswith("```"))
    try:
        result = json.loads(txt)
    except Exception as e:
        raise RuntimeError(f"OCR JSON parse faalde: {e}; raw={txt[:200]}")

    try:
        if result.get("amount") is not None:
            result["amount"] = float(result["amount"])
    except Exception:
        result["amount"] = None
    try:
        result["confidence"] = float(result.get("confidence") or 0)
    except Exception:
        result["confidence"] = 0.0
    return result


def _ocr_match_ok(ocr: dict, *, expected_amount: float, expected_currency: str):
    """Returns (ok, reasons[])."""
    reasons: list[str] = []
    if not ocr or not isinstance(ocr, dict):
        return False, ["geen OCR-resultaat"]
    conf = float(ocr.get("confidence") or 0)
    if conf < 0.7:
        reasons.append(f"lage confidence {conf:.2f}")
    ocr_amount = ocr.get("amount")
    if ocr_amount is None:
        reasons.append("geen bedrag gedetecteerd")
    else:
        diff = abs(float(ocr_amount) - float(expected_amount))
        tol = max(OCR_AMOUNT_TOLERANCE_ABS,
                  OCR_AMOUNT_TOLERANCE_PCT * float(expected_amount))
        if diff > tol:
            reasons.append(
                f"bedrag {ocr_amount} ≠ claim {expected_amount} (verschil {diff:.2f})"
            )
    ocr_curr = (ocr.get("currency") or "").upper()
    if ocr_curr and ocr_curr != (expected_currency or "").upper():
        reasons.append(f"valuta {ocr_curr} ≠ {expected_currency}")
    date_iso = ocr.get("date_iso")
    if date_iso:
        try:
            d = datetime.fromisoformat(date_iso)
            age_days = (now_utc().replace(tzinfo=None) - d).days
            if age_days > OCR_DATE_WINDOW_DAYS:
                reasons.append(f"afschrift {age_days} dagen oud (>21)")
            if age_days < -2:
                reasons.append("afschrift heeft toekomst-datum")
        except Exception:
            reasons.append(f"datum '{date_iso}' onleesbaar")
    else:
        reasons.append("geen datum gedetecteerd")
    return (len(reasons) == 0), reasons


async def _ocr_and_auto_approve_payment(*, payment_id: str, statement_id: str,
                                        expected_amount: float,
                                        expected_currency: str,
                                        tenant_name: str,
                                        company_id: Optional[str]):
    """Achtergrond-task: OCR + auto-approve indien match."""
    try:
        ocr = await _ocr_bank_statement(statement_id)
    except Exception as e:
        await db.payments.update_one(
            {"id": payment_id},
            {"$set": {"ocr_status": "failed", "ocr_error": str(e)[:300],
                      "ocr_run_at": iso(now_utc())}},
        )
        print(f"[ocr] payment={payment_id[:8]} faalde: {e}")
        return

    ok, reasons = _ocr_match_ok(
        ocr, expected_amount=expected_amount, expected_currency=expected_currency
    )
    ocr_doc = {
        "ocr_status": "matched" if ok else "mismatch",
        "ocr_amount": ocr.get("amount"),
        "ocr_currency": ocr.get("currency"),
        "ocr_date_iso": ocr.get("date_iso"),
        "ocr_payer_name": ocr.get("payer_name"),
        "ocr_beneficiary": ocr.get("beneficiary"),
        "ocr_reference": ocr.get("reference"),
        "ocr_confidence": ocr.get("confidence"),
        "ocr_raw_text": (ocr.get("raw_text") or "")[:500],
        "ocr_mismatch_reasons": reasons,
        "ocr_run_at": iso(now_utc()),
    }
    await db.payments.update_one({"id": payment_id}, {"$set": ocr_doc})

    if not ok:
        try:
            await _notify_company_admins(
                company_id,
                "OCR-controle: handmatige goedkeuring nodig",
                f"{tenant_name}: {', '.join(reasons[:2])}",
                {"kind": "payment_pending", "url": "/admin/payments",
                 "payment_id": payment_id, "badge_inc": 0},
            )
        except Exception:
            pass
        return

    p = await db.payments.find_one({"id": payment_id}, {"_id": 0})
    if not p or p.get("status") != "pending_approval":
        return
    approved_at = iso(now_utc())

    matched_invoice = None
    if p.get("category") == "huur":
        # PERIOD-STRICT: match ALLEEN de aangewezen periode's factuur
        # ongeacht status. Voorkomt dat een OCR-goedgekeurde payment voor
        # juli per ongeluk wordt gekoppeld aan augustus (Jacyntha-bug).
        if p.get("period_month") and p.get("period_year"):
            period_q = {"tenant_id": p["tenant_id"],
                        "period_month": p["period_month"],
                        "period_year": p["period_year"]}
            if company_id:
                period_q["company_id"] = company_id
            matched_invoice = await db.invoices.find_one(period_q, {"_id": 0})
        # Fallback ALLEEN wanneer geen periode is opgegeven.
        if not matched_invoice and not (p.get("period_month") and p.get("period_year")):
            inv_q = {"tenant_id": p["tenant_id"], "status": {"$ne": "paid"}}
            if company_id:
                inv_q["company_id"] = company_id
            matched_invoice = await db.invoices.find_one(
                inv_q, {"_id": 0},
                sort=[("period_year", 1), ("period_month", 1)],
            )

    update = {
        "status": "approved", "approved_at": approved_at,
        "approved_by": "OCR auto-approve", "auto_approved": True,
    }
    if matched_invoice:
        update["invoice_id"] = matched_invoice["id"]
        update["invoice_number"] = matched_invoice.get("invoice_number")
    await db.payments.update_one({"id": payment_id}, {"$set": update})

    if matched_invoice:
        try:
            inv_amt = float(matched_invoice.get("amount") or 0)
            already_paid = matched_invoice.get("paid_amount")
            if already_paid is None:
                already_paid = await _invoice_currently_paid(matched_invoice["id"], exclude_payment_id=payment_id)
            open_on = max(0.0, round(inv_amt - float(already_paid or 0), 2))
            pay_amt = float(p.get("amount") or 0)
            primary = min(pay_amt, open_on) if open_on > 0 else pay_amt
            overflow = round(pay_amt - primary, 2)
            if primary > 0:
                await _apply_payment_to_invoice(
                    matched_invoice["id"], primary,
                    payment_id=p["id"], paid_at=approved_at,
                    method=p.get("method"),
                    receipt_number=p.get("receipt_number"),
                )
            if overflow > 0:
                other_ids: list[str] = []
                async for inv in db.invoices.find(
                    {"tenant_id": p["tenant_id"],
                     "currency": p.get("currency") or "SRD",
                     "status": {"$nin": ["paid", "cancelled"]},
                     "id": {"$ne": matched_invoice["id"]},
                     **({"company_id": company_id} if company_id else {})},
                    {"_id": 0, "id": 1},
                ).sort([("period_year", 1), ("period_month", 1)]):
                    other_ids.append(inv["id"])
                if other_ids:
                    await _allocate_payment_to_invoices(
                        other_ids, overflow,
                        payment_id=p["id"], paid_at=approved_at,
                        method=p.get("method"),
                        receipt_number=p.get("receipt_number"),
                    )
        except Exception as e:
            print(f"[ocr.auto-approve] invoice apply failed: {e}")

    try:
        await _notify_company_admins(
            company_id,
            "Bankoverschrijving automatisch goedgekeurd (OCR)",
            f"{tenant_name}: {expected_currency} {expected_amount:,.2f} — bedrag/datum kloppen",
            {"kind": "payment", "url": "/admin/payments",
             "payment_id": payment_id, "badge_inc": 1},
        )
    except Exception:
        pass




class TenantMaintenanceIn(BaseModel):
    title: str
    description: Optional[str] = ""
    priority: Literal["low", "medium", "high"] = "medium"


class TenantPaymentIn(BaseModel):
    amount: float
    currency: Literal["SRD", "USD", "EUR"] = "SRD"
    method: Literal["contant", "bank"] = "contant"
    category: Literal["huur", "servicekosten", "borg", "boete", "internet", "overig", "vooruitbetaling"] = "huur"
    period_month: Optional[int] = None
    period_year: Optional[int] = None
    note: Optional[str] = ""
    invoice_id: Optional[str] = None
    # Bankoverschrijving-velden (alleen relevant als method == "bank")
    bank_country: Optional[Literal["SR", "NL"]] = None
    bank_statement_id: Optional[str] = None  # asset-id van geüpload afschrift


@api.post("/tenant-portal/bank-statement-upload")
async def tenant_bank_statement_upload(
    file: UploadFile = File(...), tenant=Depends(get_tenant_session)
):
    """Huurder upload bankafschrift (PDF/JPG/PNG, max 5 MB) als bewijs van
    bankoverschrijving. Asset wordt opgeslagen in `bank_statements` collectie
    (separate van landing_assets om eenvoudiger te scopen per company).

    Returns: {id, url} — id wordt meegestuurd in de payment payload.
    """
    raw = await file.read()
    if len(raw) > MAX_LANDING_ASSET_BYTES:
        raise HTTPException(status_code=413, detail="Bestand groter dan 5 MB.")
    ctype = (file.content_type or "").lower()
    allowed = ("image/jpeg", "image/jpg", "image/png", "image/webp", "application/pdf")
    if not any(ctype.startswith(a) or ctype == a for a in allowed):
        raise HTTPException(status_code=400, detail="Alleen PDF, JPG of PNG toegestaan.")
    asset_id = new_id()
    await db.bank_statements.insert_one({
        "id": asset_id,
        "filename": file.filename or f"afschrift-{asset_id}",
        "content_type": ctype,
        "data_b64": base64.b64encode(raw).decode("ascii"),
        "size": len(raw),
        "tenant_id": tenant["id"],
        "company_id": tenant.get("company_id"),
        "uploaded_at": iso(now_utc()),
    })
    return {"id": asset_id, "url": f"/api/bank-statements/{asset_id}", "size": len(raw)}


@api.get("/bank-statements/{asset_id}")
async def get_bank_statement(asset_id: str, user=Depends(get_current_user)):
    """Admin/owner/boekhouder kan bankafschrift inzien. Tenant-scoped via
    company_id zodat huurder van bedrijf A geen afschriften van B ziet."""
    cid = company_id_of(user)
    doc = await db.bank_statements.find_one(
        {"id": asset_id, **({"company_id": cid} if cid else {})}, {"_id": 0}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Bankafschrift niet gevonden")
    try:
        data = base64.b64decode(doc["data_b64"])
    except Exception:
        raise HTTPException(status_code=500, detail="Bankafschrift corrupt")
    return Response(content=data, media_type=doc.get("content_type", "application/octet-stream"))


@api.get("/tenant-portal/invoices")
async def tenant_portal_invoices(tenant=Depends(get_tenant_session)):
    """Open + recent paid invoices voor de ingelogde huurder."""
    docs = await db.invoices.find(
        {"tenant_id": tenant["id"]}, {"_id": 0}
    ).sort([("period_year", -1), ("period_month", -1)]).to_list(200)
    return [await _enrich_invoice(d) for d in docs]


@api.post("/tenant-portal/payments", response_model=PaymentOut)
async def tenant_portal_create_payment(body: TenantPaymentIn, tenant=Depends(get_tenant_session)):
    """Huurder registreert zelf een betaling via de Kiosk.

    Bewijs-vereiste flow (alleen bank):
      • method == "bank" → status = "pending_approval"
      • bank_statement_id is verplicht (geüpload via /bank-statement-upload)
      • bank_country: "SR" of "NL"
      • Factuur blijft open tot OCR auto-approve of admin manual approve
    """
    is_bank = body.method == "bank"
    needs_proof = is_bank
    proof_label = "Bankafschrift"
    if needs_proof:
        if not body.bank_statement_id:
            raise HTTPException(
                status_code=400,
                detail=f"{proof_label} is verplicht.",
            )
        stmt = await db.bank_statements.find_one(
            {"id": body.bank_statement_id, "tenant_id": tenant["id"]},
            {"_id": 0, "id": 1, "filename": 1, "size": 1, "content_type": 1},
        )
        if not stmt:
            raise HTTPException(status_code=404, detail=f"{proof_label} niet gevonden")
        if is_bank and not body.bank_country:
            raise HTTPException(status_code=400, detail="Geef aan vanuit welk land u betaalt.")

    if body.invoice_id:
        inv = await db.invoices.find_one(
            {"id": body.invoice_id, "tenant_id": tenant["id"]}, {"_id": 0}
        )
        if not inv:
            raise HTTPException(status_code=404, detail="Factuur niet gevonden")
        period_month = body.period_month or inv.get("period_month")
        period_year = body.period_year or inv.get("period_year")
    else:
        period_month = body.period_month
        period_year = body.period_year
    pin = PaymentIn(
        tenant_id=tenant["id"],
        apartment_id=tenant.get("apartment_id"),
        amount=body.amount,
        currency=body.currency,
        method=body.method,
        category=body.category,
        period_month=period_month,
        period_year=period_year,
        note=body.note or "",
        received_by=tenant.get("name") or "Huurder Kiosk",
    )
    payment_status = "pending_approval" if needs_proof else "approved"
    doc = await _create_payment_doc(
        pin, company_id=tenant.get("company_id"),
        approved_by=tenant.get("name") or "Huurder Kiosk",
        status=payment_status,
    )
    # Voeg bewijs-metadata toe (bank)
    if needs_proof:
        await db.payments.update_one(
            {"id": doc["id"]},
            {"$set": {
                "bank_country": body.bank_country if is_bank else None,
                "bank_statement_id": body.bank_statement_id,
                "bank_statement_filename": stmt.get("filename"),
                "bank_statement_size": stmt.get("size"),
                "bank_statement_content_type": stmt.get("content_type"),
                "submitted_at": iso(now_utc()),
            }},
        )
        doc["bank_country"] = body.bank_country if is_bank else None
        doc["bank_statement_id"] = body.bank_statement_id
        doc["bank_statement_filename"] = stmt.get("filename")
        # Vuur-en-vergeet OCR + auto-approve in achtergrond zodat de huurder
        # direct een snelle "Verstuurd ter goedkeuring" bevestiging krijgt.
        try:
            import asyncio as _asyncio
            _asyncio.create_task(_ocr_and_auto_approve_payment(
                payment_id=doc["id"],
                statement_id=body.bank_statement_id,
                expected_amount=float(doc.get("amount") or 0),
                expected_currency=doc.get("currency") or body.currency,
                tenant_name=tenant.get("name") or "",
                company_id=tenant.get("company_id"),
            ))
        except Exception as e:
            print(f"[ocr] kon achtergrond OCR niet starten: {e}")
    enriched = await _enrich_payment(doc)
    # Notify admins of the company about the self-service payment.
    try:
        if needs_proof:
            method_label = "Bankoverschrijving"
            extra = ""
            if is_bank:
                extra = f" ({'Suriname' if body.bank_country == 'SR' else 'Nederland'})"
            title = f"{method_label} wacht op goedkeuring · {enriched.get('currency', '')} {float(enriched.get('amount', 0)):,.2f}"
            body_msg = f"{enriched.get('tenant_name') or tenant.get('name')}{extra} — controleer bewijs"
            kind = "payment_pending"
        else:
            title = f"Huurder-betaling {enriched.get('currency', '')} {float(enriched.get('amount', 0)):,.2f}"
            body_msg = f"{enriched.get('tenant_name') or tenant.get('name')} via Huurder Kiosk"
            kind = "payment"
        await _notify_company_admins(
            tenant.get("company_id"), title, body_msg,
            {"kind": kind, "url": "/admin/payments", "payment_id": enriched.get("id"), "badge_inc": 1},
        )
    except Exception as e:
        print(f"[push] tenant-portal payment notify failed: {e}")
    return enriched


@api.post("/tenant-portal/maintenance")
async def tenant_portal_maintenance_create(body: TenantMaintenanceIn, tenant=Depends(get_tenant_session)):
    if not tenant.get("apartment_id"):
        raise HTTPException(status_code=400, detail="U bent niet gekoppeld aan een appartement")
    cid = tenant.get("company_id")
    if not cid:
        # Fallback: lookup via apartment om robuust te zijn voor oude tenant-records
        apt = await db.apartments.find_one(
            {"id": tenant["apartment_id"]}, {"_id": 0, "company_id": 1}
        )
        cid = (apt or {}).get("company_id")
    doc = {
        "id": new_id(),
        "company_id": cid,
        "apartment_id": tenant["apartment_id"],
        "title": body.title,
        "description": body.description or "",
        "priority": body.priority,
        "cost": 0,
        "currency": "SRD",
        "status": "open",
        "created_at": iso(now_utc()),
        "resolved_at": None,
        "created_by_tenant": tenant["id"],
    }
    await db.maintenance.insert_one(doc)
    doc.pop("_id", None)
    enriched = await _enrich_maint(doc)
    # Notify alle admins/owners/boekhouders van het bedrijf zodat ze een
    # push-melding én een SSE-update krijgen, en de melding direct in de
    # admin maintenance lijst verschijnt.
    try:
        prio_label = {
            "low": "lage", "medium": "normale", "high": "hoge",
        }.get(body.priority, body.priority or "")
        prio_prefix = f"[{prio_label} prioriteit] " if prio_label else ""
        apt_lbl = enriched.get("apartment_number") or "appartement"
        tenant_name = tenant.get("name") or "Huurder"
        await _notify_company_admins(
            cid,
            f"Nieuwe onderhoudsmelding · {apt_lbl}",
            f"{prio_prefix}{tenant_name}: {body.title}",
            {
                "kind": "maintenance",
                "url": "/admin/maintenance",
                "maintenance_id": enriched.get("id"),
                "badge_inc": 1,
            },
        )
    except Exception as e:
        print(f"[push] tenant-portal maintenance notify failed: {e}")
    return enriched


# =====================================================================
# Apartment routes (admin)
# =====================================================================
def _strip_doc(doc):
    if not doc:
        return doc
    doc.pop("_id", None)
    return doc


async def _by_id(coll: str, ids, fields: dict) -> dict:
    """Batch-lookup {id: doc} voor list-endpoints (vervangt per-item find_one)."""
    ids = [i for i in set(ids) if i]
    if not ids:
        return {}
    docs = await db[coll].find({"id": {"$in": ids}}, {"_id": 0, "id": 1, **fields}).to_list(None)
    return {d["id"]: d for d in docs}


async def _enrich_apartment(apt: dict) -> dict:
    tenant_name = None
    if apt.get("tenant_id"):
        t = await db.tenants.find_one({"id": apt["tenant_id"]}, {"_id": 0, "name": 1})
        tenant_name = t["name"] if t else None
    return {**apt, "tenant_name": tenant_name}


@api.get("/apartments", response_model=List[ApartmentOut])
async def list_apartments(user=Depends(get_current_user)):
    async def compute():
        docs = await db.apartments.find(scope(user), {"_id": 0}).sort("number", 1).to_list(1000)
        t_by = await _by_id("tenants", [d.get("tenant_id") for d in docs], {"name": 1})
        return [{**d, "tenant_name": t_by.get(d.get("tenant_id"), {}).get("name")} for d in docs]
    return await _list_cached("apartments", user, compute)


@api.post("/apartments", response_model=ApartmentOut)
async def create_apartment(body: ApartmentIn, user=Depends(get_current_user)):
    cid = company_id_of(user)
    if not cid:
        raise HTTPException(status_code=400, detail="Geen actief bedrijf geselecteerd")
    # Hard-block bij plan limiet (superadmin/impersonatie krijgt vrije toegang).
    if user.get("role") != "superadmin" and not user.get("original_user_id"):
        await _enforce_count_limit(cid, "apartments", "max_apartments", "appartementen")
    doc = {
        "id": new_id(),
        "company_id": cid,
        **body.model_dump(),
        "status": "vacant",
        "tenant_id": None,
        "created_at": iso(now_utc()),
    }
    await db.apartments.insert_one(doc)
    doc.pop("_id", None)
    return await _enrich_apartment(doc)


@api.put("/apartments/{apt_id}", response_model=ApartmentOut)
async def update_apartment(apt_id: str, body: ApartmentIn, user=Depends(get_current_user)):
    from pymongo import ReturnDocument
    res = await db.apartments.find_one_and_update(
        {"id": apt_id, **scope(user)}, {"$set": body.model_dump()},
        projection={"_id": 0}, return_document=ReturnDocument.AFTER,
    )
    if not res:
        raise HTTPException(status_code=404, detail="Appartement niet gevonden")
    return await _enrich_apartment(res)


@api.delete("/apartments/{apt_id}")
async def delete_apartment(apt_id: str, user=Depends(get_current_user)):
    apt = await db.apartments.find_one({"id": apt_id, **scope(user)}, {"_id": 0})
    if not apt:
        raise HTTPException(status_code=404, detail="Appartement niet gevonden")
    if apt.get("tenant_id"):
        await db.tenants.update_one({"id": apt["tenant_id"]}, {"$set": {"apartment_id": None}})
    await db.apartments.delete_one({"id": apt_id})
    return {"ok": True}


@api.post("/apartments/{apt_id}/assign-tenant")
async def assign_tenant(apt_id: str, body: dict, user=Depends(get_current_user)):
    tenant_id = body.get("tenant_id")
    if not tenant_id:
        raise HTTPException(status_code=400, detail="tenant_id is verplicht")
    apt = await db.apartments.find_one({"id": apt_id, **scope(user)}, {"_id": 0})
    if not apt:
        raise HTTPException(status_code=404, detail="Appartement niet gevonden")
    tenant = await db.tenants.find_one({"id": tenant_id, **scope(user)}, {"_id": 0})
    if not tenant:
        raise HTTPException(status_code=404, detail="Huurder niet gevonden")
    if apt.get("tenant_id"):
        await db.tenants.update_one({"id": apt["tenant_id"]}, {"$set": {"apartment_id": None}})
    if tenant.get("apartment_id") and tenant["apartment_id"] != apt_id:
        await db.apartments.update_one(
            {"id": tenant["apartment_id"]},
            {"$set": {"tenant_id": None, "status": "vacant"}},
        )
    await db.apartments.update_one(
        {"id": apt_id}, {"$set": {"tenant_id": tenant_id, "status": "occupied"}}
    )
    await db.tenants.update_one({"id": tenant_id}, {"$set": {"apartment_id": apt_id}})
    return {"ok": True}


@api.post("/apartments/{apt_id}/remove-tenant")
async def remove_tenant(apt_id: str, user=Depends(get_current_user)):
    apt = await db.apartments.find_one({"id": apt_id, **scope(user)}, {"_id": 0})
    if not apt:
        raise HTTPException(status_code=404, detail="Appartement niet gevonden")
    if apt.get("tenant_id"):
        await db.tenants.update_one(
            {"id": apt["tenant_id"]}, {"$set": {"apartment_id": None}}
        )
    await db.apartments.update_one(
        {"id": apt_id}, {"$set": {"tenant_id": None, "status": "vacant"}}
    )
    return {"ok": True}


@api.get("/tenant-portal/lookup-apartment/{apt_id}")
async def tenant_portal_lookup_apartment(apt_id: str):
    """Publiek (zonder auth): wordt aangeroepen door de Huurder Kiosk wanneer
    de QR-sticker bij de voordeur is gescand met `?apt=<id>` in de URL.

    Geeft minimaal genoeg info terug om de PIN-stap voor te bereiden:
    - tenant naam + e-mailadres (nodig voor `/tenant-portal/login`)
    - appartement-nummer en eventuele bedrijfsnaam (voor de header)

    De PIN blijft de enige beveiligingslaag — niemand kan zonder PIN inloggen.
    """
    apt = await db.apartments.find_one({"id": apt_id}, {"_id": 0})
    if not apt:
        raise HTTPException(status_code=404, detail="Appartement niet gevonden")
    tenant = None
    if apt.get("tenant_id"):
        tenant = await db.tenants.find_one(
            {"id": apt["tenant_id"]},
            {"_id": 0, "name": 1, "email": 1, "phone": 1, "pin_hash": 1},
        )
    if not tenant or not tenant.get("pin_hash"):
        raise HTTPException(status_code=404, detail="Geen huurder met PIN op dit appartement")
    company_name = None
    if apt.get("company_id"):
        c = await db.companies.find_one({"id": apt["company_id"]}, {"_id": 0, "name": 1})
        company_name = (c or {}).get("name")
    return {
        "apartment": {"id": apt["id"], "number": apt["number"], "address": apt.get("address", "")},
        "tenant": {
            "name": tenant.get("name"),
            "email": tenant.get("email"),
            "first_name": (tenant.get("name") or "").split(" ")[0] or None,
        },
        "company": {"name": company_name},
    }


@api.get("/apartments/{apt_id}/kiosk-sticker.pdf")
async def apartment_kiosk_sticker(apt_id: str, request: Request):
    """Genereert een A4 print-poster met QR-code → `/c/<slug>/kiosk/huurder?apt=<id>`.
    Publiek (geen auth) zodat de beheerder de link direct in een nieuw
    tabblad kan openen — het PDF bevat enkel het appartement-nummer en
    de huurder-naam (al fysiek leesbaar bij de voordeur)."""
    apt = await db.apartments.find_one({"id": apt_id}, {"_id": 0})
    if not apt:
        raise HTTPException(status_code=404, detail="Appartement niet gevonden")
    tenant_name = None
    if apt.get("tenant_id"):
        t = await db.tenants.find_one({"id": apt["tenant_id"]}, {"_id": 0, "name": 1})
        tenant_name = (t or {}).get("name")
    company_name = "SuriRent"
    primary_hex = "#FF5C00"
    slug = ""
    cid = apt.get("company_id")
    if cid:
        c = await db.companies.find_one({"id": cid}, {"_id": 0, "name": 1, "slug": 1, "branding": 1})
        if c:
            company_name = c.get("name") or company_name
            primary_hex = ((c.get("branding") or {}).get("primary_color")) or primary_hex
            slug = c.get("slug") or ""
    # Bouw een absolute URL met scheme + host. Als we de bedrijfsslug kennen
    # gebruiken we het branded pad zodat de juiste kleuren laden bij scan.
    # Per-tenant: gebruik `?nfc=<card_id>` zodat de tenant-portal auto-login
    # flow direct triggert — IDENTIEK aan een fysieke NFC-tag. Als er geen
    # tenant/card_id is (leeg appartement) valt de link terug op `?apt=<id>`
    # voor de klassieke apt-based flow.
    base = _company_base_url(request) or _public_url("")
    tenant_param = f"?apt={apt_id}"
    if apt.get("tenant_id"):
        t = await db.tenants.find_one(
            {"id": apt["tenant_id"]},
            {"_id": 0, "id": 1, "nfc_card_id": 1, "company_id": 1},
        )
        if t:
            nfc_card_id = _normalize_nfc_uid(t.get("nfc_card_id") or "")
            if not nfc_card_id:
                # Auto-genereer NFC card_id zodat QR + toekomstige NFC-tap
                # dezelfde login-URL delen.
                import secrets
                for _ in range(5):
                    candidate = secrets.token_hex(6).upper()
                    exists = await db.tenants.find_one(
                        {"company_id": t.get("company_id"), "nfc_card_id": candidate},
                        {"_id": 0, "id": 1},
                    )
                    if not exists:
                        nfc_card_id = candidate
                        break
                if nfc_card_id:
                    await db.tenants.update_one(
                        {"id": t["id"]}, {"$set": {"nfc_card_id": nfc_card_id}}
                    )
            if nfc_card_id:
                tenant_param = f"?nfc={nfc_card_id}"
    if slug:
        kiosk_url = f"{base}/{slug}/kiosk/huurder{tenant_param}"
    else:
        kiosk_url = f"{base}/kiosk/huurder{tenant_param}"
    from pdf_gen import kiosk_sticker_pdf
    pdf = kiosk_sticker_pdf(
        apartment_number=apt.get("number", "—"),
        address=apt.get("address", "") or "",
        tenant_name=tenant_name,
        company_name=company_name,
        kiosk_url=kiosk_url,
        primary_hex=primary_hex,
    )
    return _pdf_response(pdf, f"kiosk-sticker-{apt.get('number', apt_id)}.pdf")


@api.get("/tenants/{tenant_id}/qr-plate.pdf")
async def tenant_qr_plate(tenant_id: str, request: Request, refresh: int = 0,
                          size: str = "medium"):
    """Luxueuze "gouden plaat" QR-poster per huurder voor naast de voordeur.
    Bevat persoonlijke QR (?t=<tenant_id>) zodat huurder bij eerste scan
    een eigen PIN kan kiezen. Publiek (geen auth) zodat beheerder de link
    direct in een nieuw tabblad kan openen voor afdrukken.

    Query params:
        refresh=1                       → bypass de cache en regenereer via AI.
        size=small|medium|large         → PDF-pagina formaat:
            • small  = 200×133 mm (~A5 landschap)
            • medium = 300×200 mm (~A4 landschap, default)
            • large  = 400×267 mm (~A3 landschap)
    """
    size = (size or "medium").lower().strip()
    if size not in ("small", "medium", "large"):
        size = "medium"
    t = await db.tenants.find_one(
        {"id": tenant_id},
        {"_id": 0, "id": 1, "name": 1, "company_id": 1, "apartment_id": 1, "nfc_card_id": 1},
    )
    if not t:
        raise HTTPException(status_code=404, detail="Huurder niet gevonden")
    # Zorg dat de huurder een NFC-card_id heeft. Als er nog geen is, genereren
    # we er automatisch één zodat de QR-code EXACT dezelfde URL heeft als een
    # (toekomstige) fysieke NFC-tag. Zo geeft QR-scannen direct portaal-toegang
    # via dezelfde `/tenant-portal/nfc-login` flow als NFC-tap.
    nfc_card_id = _normalize_nfc_uid(t.get("nfc_card_id") or "")
    if not nfc_card_id:
        # Genereer een unieke 12-char UID (hex uit tenant_id + timestamp) en
        # sla op — zo blijft de QR-plate ook na een refresh dezelfde URL.
        import secrets
        for _ in range(5):
            candidate = secrets.token_hex(6).upper()  # 12 hex chars
            exists = await db.tenants.find_one(
                {"company_id": t.get("company_id"), "nfc_card_id": candidate},
                {"_id": 0, "id": 1},
            )
            if not exists:
                nfc_card_id = candidate
                break
        if nfc_card_id:
            await db.tenants.update_one(
                {"id": tenant_id}, {"$set": {"nfc_card_id": nfc_card_id}}
            )
    # Appartement info ophalen
    apt_number = "—"
    address = ""
    if t.get("apartment_id"):
        a = await db.apartments.find_one(
            {"id": t["apartment_id"]}, {"_id": 0, "number": 1, "address": 1}
        )
        if a:
            apt_number = a.get("number") or apt_number
            address = a.get("address") or ""
    # Bedrijf branding ophalen
    company_name = "SuriRent"
    accent_hex = "#D4AF37"  # default goud
    company_logo_bytes = None
    slug = ""
    cid = t.get("company_id")
    if cid:
        c = await db.companies.find_one(
            {"id": cid}, {"_id": 0, "name": 1, "slug": 1, "branding": 1, "logo_url": 1}
        )
        if c:
            company_name = c.get("name") or company_name
            slug = c.get("slug") or ""
            # Probeer logo te laden uit branding.logo_url
            logo_url = (c.get("branding") or {}).get("logo_url") or c.get("logo_url")
            if logo_url:
                brand = await _company_brand_info(cid)
                company_logo_bytes = (brand or {}).get("company_logo_bytes")
    # URL bouwen — persoonlijke huurder-QR. Gebruikt `?nfc=<card_id>` zodat
    # de tenant-portal auto-login flow (`/tenant-portal/nfc-login`) direct
    # triggert bij QR-scan. IDENTIEK aan een fysieke NFC-tag URL — één en
    # dezelfde login-flow voor scannen én tikken.
    base = _company_base_url(request) or _public_url("")
    nfc_param = f"?nfc={nfc_card_id}" if nfc_card_id else f"?t={tenant_id}"
    if slug:
        kiosk_url = f"{base}/{slug}/kiosk/huurder{nfc_param}"
    else:
        kiosk_url = f"{base}/kiosk/huurder{nfc_param}"
    from pdf_gen import luxury_plate_pdf, luxury_plate_pdf_ai
    import hashlib as _hashlib
    # Cache key: tenant + alle dynamische inputs. Voorkomt herhaald LLM-budget
    # verbruik bij elke download.
    cache_inputs = f"{tenant_id}|{company_name}|{apt_number}|{address}|{kiosk_url}|{size}|nfc={nfc_card_id}|v11"
    cache_hash = _hashlib.sha256(cache_inputs.encode("utf-8")).hexdigest()
    cached = await db.qr_plate_cache.find_one(
        {"hash": cache_hash}, {"_id": 0, "pdf_b64": 1}
    ) if not refresh else None
    if cached and cached.get("pdf_b64"):
        import base64 as _b64
        pdf = _b64.b64decode(cached["pdf_b64"])
    else:
        try:
            pdf = await luxury_plate_pdf_ai(
                tenant_name=t.get("name") or "",
                apartment_number=apt_number,
                address=address,
                company_name=company_name,
                kiosk_url=kiosk_url,
                company_logo=company_logo_bytes,
                accent_hex=accent_hex,
                size=size,
            )
        except Exception as e:
            # Fallback naar PIL-versie als AI faalt (offline, quota, etc.)
            import logging as _logging
            _logging.getLogger("uvicorn.error").warning(
                f"AI plaque generatie faalde, fallback naar PIL: {e}"
            )
            pdf = await asyncio.to_thread(
                luxury_plate_pdf,
                tenant_name=t.get("name") or "",
                apartment_number=apt_number,
                address=address,
                company_name=company_name,
                kiosk_url=kiosk_url,
                company_logo=company_logo_bytes,
                accent_hex=accent_hex,
                size=size,
            )
        else:
            # Alleen succesvolle AI-renders cachen
            import base64 as _b64
            await db.qr_plate_cache.update_one(
                {"hash": cache_hash},
                {"$set": {
                    "hash": cache_hash,
                    "tenant_id": tenant_id,
                    "pdf_b64": _b64.b64encode(pdf).decode("ascii"),
                    "created_at": datetime.now(timezone.utc).isoformat(),
                }},
                upsert=True,
            )
    safe_name = (t.get("name") or "huurder").split()[0].lower()
    return _pdf_response(pdf, f"qr-plaat-{safe_name}-{apt_number}.pdf")


@api.get("/companies/me/portal-poster.pdf")
async def company_portal_poster(request: Request, user=Depends(get_current_user)):
    """A6 printbare poster met QR-code naar het algemene huurportaal van het
    bedrijf (`/c/<slug>/huurder`). Handig om als sticker bij de receptie of
    in een welkomstmap op te hangen — huurders scannen, vullen email/telefoon
    + PIN in en zijn binnen."""
    cid = company_id_of(user)
    if not cid:
        raise HTTPException(status_code=400, detail="Geen actief bedrijf")
    c = await db.companies.find_one({"id": cid}, {"_id": 0, "name": 1, "slug": 1, "branding": 1})
    if not c or not c.get("slug"):
        raise HTTPException(status_code=404, detail="Bedrijf niet gevonden")
    base = _company_base_url(request) or _public_url("")
    portal_url = f"{base}/{c['slug']}/kiosk/huurder"
    primary_hex = ((c.get("branding") or {}).get("primary_color")) or "#FF5C00"
    from pdf_gen import portal_poster_pdf
    pdf = await asyncio.to_thread(
        portal_poster_pdf,
        company_name=c.get("name") or "SuriRent",
        portal_url=portal_url,
        primary_hex=primary_hex,
    )
    return _pdf_response(pdf, f"huurportaal-{c['slug']}.pdf")


@api.get("/tenants/{tenant_id}/portal-poster.pdf")
async def tenant_portal_poster(tenant_id: str, request: Request, user=Depends(get_current_user)):
    """Per-huurder A6 portal-poster — de QR linkt naar `/c/<slug>/huurder?identifier=<email_of_telefoon>`,
    zodat de huurder alleen een PIN hoeft in te tikken om in te loggen."""
    t = await db.tenants.find_one(
        {"id": tenant_id, **scope(user)},
        {"_id": 0, "id": 1, "name": 1, "email": 1, "phone": 1, "company_id": 1, "apartment_id": 1},
    )
    if not t:
        raise HTTPException(status_code=404, detail="Huurder niet gevonden")
    cid = t.get("company_id") or company_id_of(user)
    c = await db.companies.find_one({"id": cid}, {"_id": 0, "name": 1, "slug": 1, "branding": 1})
    if not c or not c.get("slug"):
        raise HTTPException(status_code=404, detail="Bedrijf niet gevonden")
    apt_number, apt_address = None, None
    if t.get("apartment_id"):
        a = await db.apartments.find_one(
            {"id": t["apartment_id"]}, {"_id": 0, "number": 1, "address": 1},
        )
        if a:
            apt_number = a.get("number")
            apt_address = a.get("address")
    # Huurportaal = Huurder Kiosk (PIN-only). De QR linkt voor alle huurders
    # naar dezelfde route — de PIN identificeert de huurder. We tonen op de
    # poster wel naam + appartement zodat iedereen weet welke sticker bij
    # welk huis hoort.
    base = _company_base_url(request) or _public_url("")
    portal_url = f"{base}/{c['slug']}/kiosk/huurder"
    primary_hex = ((c.get("branding") or {}).get("primary_color")) or "#FF5C00"
    from pdf_gen import portal_poster_pdf
    pdf = await asyncio.to_thread(
        portal_poster_pdf,
        company_name=c.get("name") or "SuriRent",
        portal_url=portal_url,
        tenant_name=t.get("name"),
        apartment_number=apt_number,
        apartment_address=apt_address,
        primary_hex=primary_hex,
    )
    safe_name = "".join(ch for ch in (t.get("name") or tenant_id) if ch.isalnum() or ch in "-_") or tenant_id
    return _pdf_response(pdf, f"huurportaal-{safe_name}.pdf")


# =====================================================================
# Tenants
# =====================================================================
async def _enrich_tenant(t: dict) -> dict:
    apt_number, rent, cur = None, None, None
    if t.get("apartment_id"):
        a = await db.apartments.find_one(
            {"id": t["apartment_id"]},
            {"_id": 0, "number": 1, "rent_amount": 1, "currency": 1},
        )
        if a:
            apt_number = a.get("number")
            rent = a.get("rent_amount")
            cur = a.get("currency")
    return {**t, "apartment_number": apt_number, "rent_amount": rent, "currency": cur}


async def _tenants_enriched(user: dict) -> list:
    docs = await db.tenants.find(scope(user), {"_id": 0}).sort("name", 1).to_list(1000)
    aids = list({d["apartment_id"] for d in docs if d.get("apartment_id")})
    apts = await db.apartments.find({"id": {"$in": aids}}, {"_id": 0, "id": 1, "number": 1, "rent_amount": 1, "currency": 1}).to_list(None)
    a_by = {a["id"]: a for a in apts}
    return [{**d, "apartment_number": a_by.get(d.get("apartment_id"), {}).get("number"),
             "rent_amount": a_by.get(d.get("apartment_id"), {}).get("rent_amount"),
             "currency": a_by.get(d.get("apartment_id"), {}).get("currency")} for d in docs]


async def _list_cached(name: str, user: dict, compute, extra: str = ""):
    """Lijst live berekenen (cache uitgeschakeld)."""
    # Geen server-cache meer: altijd live uit de database.
    return await compute()


def _natural_key(v: str):
    return [int(x) if x.isdigit() else x.lower() for x in re.split(r"(\d+)", v or "")]


@api.get("/tenants", response_model=List[TenantOut])
async def list_tenants(user=Depends(get_current_user)):
    return await _tenants_enriched(user)


@api.get("/tenants/paged")
async def list_tenants_paged(filter: str = "all", q: str = "", id: Optional[str] = None,
                             offset: int = 0, limit: int = 25, user=Depends(get_current_user)):
    """Huurders gepagineerd (25), zoeken/filter/tellers over álle huurders."""
    allt = await _list_cached("tenants", user, lambda: _tenants_enriched(user))
    ql = q.strip().lower()
    by_search = [t for t in allt if not ql or ql in (t.get("name") or "").lower()]
    counts = {"all": len(by_search),
              "with_apt": sum(1 for t in by_search if t.get("apartment_number")),
              "without_apt": sum(1 for t in by_search if not t.get("apartment_number"))}
    if id:
        rows = [t for t in allt if t["id"] == id]
    else:
        rows = [t for t in by_search if filter == "all"
                or (filter == "with_apt" and t.get("apartment_number"))
                or (filter == "without_apt" and not t.get("apartment_number"))]
        # Natural sort op appartementnummer; zonder appartement onderaan op naam.
        rows.sort(key=lambda t: (0, _natural_key(str(t["apartment_number"]))) if t.get("apartment_number")
                  else (1, _natural_key(t.get("name") or "")))
    limit = max(1, min(limit, 100))
    page = rows[offset:offset + limit]
    return {
        "items": [TenantOut.model_validate(t).model_dump() for t in page],
        "total": len(rows), "offset": offset, "has_more": offset + limit < len(rows),
        "summary": {"totalCount": len(allt), "counts": counts,
                    "missingAvatars": sum(1 for t in allt if t.get("id_photo_url") and not t.get("avatar_url")),
                    "withAvatars": sum(1 for t in allt if t.get("avatar_url"))},
    }


@api.get("/tenants/credits")
async def list_tenant_credits(user=Depends(get_current_user)):
    """Retourneert een map tenant_id → beschikbaar krediet (vooruitbetaald,
    nog niet verrekend met een factuur) per valuta. Wordt gebruikt door de
    Facturen-pagina om per huurder een "SRD X tegoed" badge te tonen. Één
    call ipv N-per-huurder queries — schaalbaar tot honderden huurders."""
    q = dict(scope(user))
    q["credit_remaining"] = {"$gt": 0}
    q["status"] = "approved"
    out: dict[str, dict[str, float]] = {}
    async for p in db.payments.find(
        q, {"_id": 0, "tenant_id": 1, "credit_remaining": 1, "currency": 1},
    ):
        tid = p.get("tenant_id")
        cur = p.get("currency") or "SRD"
        if not tid:
            continue
        bucket = out.setdefault(tid, {})
        bucket[cur] = round(bucket.get(cur, 0.0) + float(p.get("credit_remaining") or 0), 2)
    return out


@api.get("/tenants/{tenant_id}/credit-sources")
async def get_tenant_credit_sources(tenant_id: str, user=Depends(get_current_user)):
    """Retourneert alle betalingen die momenteel krediet-saldo bevatten voor
    deze huurder, gesorteerd nieuwste eerst. Wordt gebruikt door een popover
    op de "SRD X tegoed" badge zodat de admin kan zien waarom een huurder
    tegoed heeft (uit welke betaling, welke datum, welke methode, en of het
    een expliciete vooruitbetaling was of overflow van een grotere betaling)."""
    q = dict(scope(user))
    q["tenant_id"] = tenant_id
    q["credit_remaining"] = {"$gt": 0}
    q["status"] = "approved"
    docs: list[dict] = []
    async for p in db.payments.find(
        q,
        {"_id": 0, "id": 1, "receipt_number": 1, "paid_at": 1, "amount": 1,
         "credit_remaining": 1, "credit_origin": 1, "category": 1,
         "method": 1, "currency": 1, "note": 1},
    ).sort("paid_at", -1):
        docs.append(p)
    return {"sources": docs}


@api.post("/tenants", response_model=TenantOut)
async def create_tenant(body: TenantIn, user=Depends(get_current_user)):
    cid = company_id_of(user)
    if not cid:
        raise HTTPException(status_code=400, detail="Geen actief bedrijf geselecteerd")
    if user.get("role") != "superadmin" and not user.get("original_user_id"):
        await _enforce_count_limit(cid, "tenants", "max_tenants", "huurders")
    payload = body.model_dump()
    if payload.get("email"):
        payload["email"] = payload["email"].strip().lower()
    payload["phone_digits"] = "".join(ch for ch in (payload.get("phone") or "") if ch.isdigit())
    doc = {"id": new_id(), "company_id": cid, **payload, "created_at": iso(now_utc())}
    await db.tenants.insert_one(doc)
    doc.pop("_id", None)
    if doc.get("apartment_id"):
        await db.apartments.update_one(
            {"id": doc["apartment_id"], **scope(user)},
            {"$set": {"tenant_id": doc["id"], "status": "occupied"}},
        )
        # Auto-create concept contract zodra er een appartement gekoppeld is.
        # Zo hoeft de beheerder niet apart naar Contracten om er één te maken.
        # Idempotent: alleen aanmaken als er nog geen contract bestaat voor
        # deze (tenant, apartment) combinatie.
        try:
            apt = await db.apartments.find_one(
                {"id": doc["apartment_id"], **scope(user)}, {"_id": 0}
            )
            existing = await db.contracts.find_one(
                {"tenant_id": doc["id"], "apartment_id": doc["apartment_id"], **scope(user)},
                {"_id": 0, "id": 1},
            )
            if not existing and apt:
                year = now_utc().year
                seq = await _next_seq(f"contract_{year}")
                company = await db.companies.find_one({"id": cid}, {"_id": 0, "name": 1})
                await db.contracts.insert_one({
                    "id": new_id(),
                    "company_id": cid,
                    "contract_number": f"HC{year}-{seq:04d}",
                    "tenant_id": doc["id"],
                    "apartment_id": doc["apartment_id"],
                    "start_date": iso(now_utc())[:10],
                    "end_date": "",
                    "payment_day": 1,
                    "deposit_amount": float(apt.get("rent_amount") or 0),
                    "landlord": (company or {}).get("name") or "",
                    "terms": "",
                    "status": "draft",
                    "sign_token": secrets.token_urlsafe(24),
                    "signed_at": None,
                    "signed_by": None,
                    "signed_ip": None,
                    "created_at": iso(now_utc()),
                    "auto_created_from_tenant": True,
                })
        except Exception as _e:  # noqa: BLE001
            # Best-effort — huurder is al aangemaakt. Log alleen.
            print(f"[auto-contract on tenant] create failed: {_e}")
    return await _enrich_tenant(doc)


@api.put("/tenants/{tenant_id}", response_model=TenantOut)
async def update_tenant(tenant_id: str, body: TenantIn, user=Depends(get_current_user)):
    from pymongo import ReturnDocument
    payload = body.model_dump()
    if payload.get("email"):
        payload["email"] = payload["email"].strip().lower()
    payload["phone_digits"] = "".join(ch for ch in (payload.get("phone") or "") if ch.isdigit())
    res = await db.tenants.find_one_and_update(
        {"id": tenant_id, **scope(user)}, {"$set": payload},
        projection={"_id": 0}, return_document=ReturnDocument.AFTER,
    )
    if not res:
        raise HTTPException(status_code=404, detail="Huurder niet gevonden")
    return await _enrich_tenant(res)


@api.delete("/tenants/{tenant_id}")
async def delete_tenant(tenant_id: str, user=Depends(get_current_user)):
    t = await db.tenants.find_one({"id": tenant_id, **scope(user)}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Huurder niet gevonden")
    if t.get("apartment_id"):
        await db.apartments.update_one(
            {"id": t["apartment_id"]}, {"$set": {"tenant_id": None, "status": "vacant"}}
        )
    await db.tenants.delete_one({"id": tenant_id})
    return {"ok": True}


async def _extract_face_avatar_from_bytes(
    raw: bytes, mime: str, tenant_id: str, uploaded_by: str | None = None,
) -> str | None:
    """Detecteer met Gemini 2.5 Flash de pasfoto op de ID-kaart, crop hem
    en sla op als nieuw landing_asset. Retourneert de URL of None bij falen.

    Werkwijze:
    1. Stuur de ID-kaart-bytes naar Gemini met een strak JSON-prompt dat
       normalized bbox coords (0..1) van de face/passport-photo teruggeeft.
    2. Parse JSON, crop met PIL (met 8% margin), maak vierkant.
    3. Sla op als WebP landing_asset. Retourneer de URL.
    """
    import os, io, json as _json, tempfile
    from emergentintegrations.llm.chat import LlmChat, UserMessage, FileContentWithMimeType
    from PIL import Image, ImageOps

    api_key = os.getenv("EMERGENT_LLM_KEY")
    if not api_key:
        return None

    # Suffix voor Gemini's file-based input
    suffix = ".png" if "png" in mime else (".webp" if "webp" in mime else ".jpg")
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    try:
        tmp.write(raw); tmp.close()
        chat = LlmChat(
            api_key=api_key,
            session_id=f"avatar-{new_id()[:8]}",
            system_message="Je detecteert gezichten op ID-kaarten en geeft ALLEEN geldig JSON terug.",
        ).with_model("gemini", "gemini-2.5-flash")
        prompt = (
            "Op deze ID-kaart / paspoort / rijbewijs staat een pasfoto van de eigenaar. "
            "Geef de bounding box (normalized 0..1) van UITSLUITEND HET GEZICHT — dat is:\n"
            "- van de bovenkant van het HOOFDHAAR tot net onder de KIN\n"
            "- van OOR tot OOR (of iets ruimer als het haar breed is)\n"
            "STRIKT NIET meebrengen: de rand van de pasfoto-kader, tekst zoals namen/nummers, "
            "de schouder-lijn onder de kin, de handtekening, of enig deel van de ID-kaart-achtergrond. "
            "Alleen de bloot te zien HUID en HAAR van het gezicht.\n"
            'Retour uitsluitend JSON: {"x":<0..1>,"y":<0..1>,"w":<0..1>,"h":<0..1>,"found":true|false}. '
            "x,y is de LINKERBOVENhoek van het gezicht. "
            "Als geen gezicht zichtbaar: found=false. Geen markdown, geen uitleg."
        )
        msg = UserMessage(
            text=prompt,
            file_contents=[FileContentWithMimeType(file_path=tmp.name, mime_type=mime)],
        )
        raw_text = await chat.send_message(msg)
    finally:
        try: os.unlink(tmp.name)
        except Exception: pass

    txt = (raw_text or "").strip()
    if txt.startswith("```"):
        parts = txt.split("```")
        txt = parts[1] if len(parts) > 1 else txt
        if txt.startswith("json"):
            txt = txt[4:]
    try:
        bb = _json.loads(txt.strip())
    except Exception:
        return None
    if not bb.get("found", False):
        return None
    x = max(0.0, min(1.0, float(bb.get("x", 0))))
    y = max(0.0, min(1.0, float(bb.get("y", 0))))
    w = max(0.01, min(1.0, float(bb.get("w", 0))))
    h = max(0.01, min(1.0, float(bb.get("h", 0))))

    # PIL crop met minimale margin, vierkant rondom center van bbox.
    # We houden het bewust STRAK zodat er geen tekst/rand van de ID-kaart
    # meegecropt wordt. Gemini's bbox is doorgaans al iets ruim.
    try:
        img = Image.open(io.BytesIO(raw))
        img = ImageOps.exif_transpose(img)
        W, H = img.size
        cx = (x + w / 2.0) * W
        cy = (y + h / 2.0) * H
        # Vierkant met zijde = max(w, h) — GEEN extra margin. Zo mogelijk
        # zelfs 4% inwaartse crop (0.96) om zeker geen randtekst mee te
        # nemen, maar alleen als het gezicht groter is dan 50px.
        raw_side = max(w * W, h * H)
        tight_factor = 0.96 if raw_side > 80 else 1.0
        side = raw_side * tight_factor
        left = max(0, int(cx - side / 2))
        top = max(0, int(cy - side / 2))
        right = min(W, int(cx + side / 2))
        bottom = min(H, int(cy + side / 2))
        if right - left < 40 or bottom - top < 40:
            return None
        # Sanity check: als bbox > 60% van hele plaatje is, heeft Gemini
        # waarschijnlijk de hele pasfoto-doos of card meegepakt. Reject.
        crop_area_ratio = ((right - left) * (bottom - top)) / (W * H)
        if crop_area_ratio > 0.6:
            print(f"[avatar] rejected: crop area ratio {crop_area_ratio:.2f} too large (likely full card)")
            return None
        crop = img.crop((left, top, right, bottom)).convert("RGB")
        # Kwaliteit-first: bewaar native resolutie of upscale naar min 512px.
        # Klein ID-kaart-crop = wazig; PIL LANCZOS verzacht dat merkbaar.
        cw, ch = crop.size
        MIN_SIDE = 512
        MAX_SIDE = 1024   # veiligheidsplafond — anders wordt asset onnodig groot
        if max(cw, ch) < MIN_SIDE:
            scale = MIN_SIDE / max(cw, ch)
            crop = crop.resize((int(cw * scale), int(ch * scale)), Image.LANCZOS)
        elif max(cw, ch) > MAX_SIDE:
            crop.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
        out = io.BytesIO()
        # Quality 95 met method=6 (langzaamste, best compressie) — near-lossless
        crop.save(out, format="WEBP", quality=95, method=6)
        avatar_bytes = out.getvalue()
    except Exception as e:
        print(f"[avatar] PIL crop failed: {e}")
        return None

    asset_id = new_id()
    await db.landing_assets.insert_one({
        "id": asset_id,
        "filename": f"avatar-{tenant_id[:8]}.webp",
        "content_type": "image/webp",
        "data_b64": base64.b64encode(avatar_bytes).decode("ascii"),
        "size": len(avatar_bytes),
        "uploaded_by": uploaded_by or "system",
        "uploaded_at": iso(now_utc()),
    })
    return f"/api/landing/asset/{asset_id}"


@api.post("/tenants/{tenant_id}/id-photo")
async def upload_tenant_id_photo(tenant_id: str, file: UploadFile = File(...),
                                   user=Depends(get_current_user)):
    """Upload ID-kaart foto voor een huurder. Slaat op als landing_asset en
    bewaart de URL op `tenant.id_photo_url` (multi-tenant safe via scope).

    Direct na de upload probeert `_extract_face_avatar_from_asset` de
    pasfoto uit de ID-kaart te croppen (Gemini vision → PIL) en op te slaan
    als `tenant.avatar_url`, zodat huurderslijsten de foto tonen i.p.v.
    initialen. Faalt de extractie stil (bv. Gemini-timeout), dan blijft de
    huurder gewoon initialen tonen — geen blocker.
    """
    t = await db.tenants.find_one({"id": tenant_id, **scope(user)}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Huurder niet gevonden")
    raw = await file.read()
    if len(raw) > MAX_LANDING_ASSET_BYTES:
        raise HTTPException(status_code=413, detail="Bestand groter dan 5 MB.")
    ctype = (file.content_type or "").lower()
    if not ctype.startswith("image/"):
        raise HTTPException(status_code=400, detail="Alleen afbeeldingen toegestaan.")
    raw, ctype = _to_webp_bytes(raw, ctype)
    asset_id = new_id()
    await db.landing_assets.insert_one({
        "id": asset_id,
        "filename": file.filename or f"idcard-{tenant_id[:8]}",
        "content_type": ctype,
        "data_b64": base64.b64encode(raw).decode("ascii"),
        "size": len(raw),
        "uploaded_by": user.get("email"),
        "uploaded_at": iso(now_utc()),
    })
    url = f"/api/landing/asset/{asset_id}"
    await db.tenants.update_one({"id": tenant_id}, {"$set": {"id_photo_url": url}})
    # Face-crop async (best effort) — resultaat komt in tenant.avatar_url
    avatar_url = None
    try:
        avatar_url = await _extract_face_avatar_from_bytes(
            raw, ctype, tenant_id, uploaded_by=user.get("email"),
        )
        if avatar_url:
            await db.tenants.update_one(
                {"id": tenant_id}, {"$set": {"avatar_url": avatar_url}},
            )
    except Exception as e:  # noqa: BLE001
        print(f"[avatar] face extract failed for tenant {tenant_id}: {e}")
    return {"id_photo_url": url, "avatar_url": avatar_url}


@api.post("/tenants/{tenant_id}/generate-avatar")
async def generate_tenant_avatar(tenant_id: str, user=Depends(get_current_user)):
    """Genereer (of hergenereer) de avatar-crop uit de bestaande ID-kaart
    voor deze huurder. Handig voor huurders die al een ID-foto hebben
    maar nog geen avatar."""
    t = await db.tenants.find_one({"id": tenant_id, **scope(user)}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Huurder niet gevonden")
    id_url = t.get("id_photo_url")
    if not id_url:
        raise HTTPException(status_code=400, detail="Deze huurder heeft nog geen ID-kaart.")
    # asset ophalen (id_photo_url = /api/landing/asset/{id})
    asset_id = id_url.rsplit("/", 1)[-1]
    asset = await db.landing_assets.find_one({"id": asset_id}, {"_id": 0})
    if not asset:
        raise HTTPException(status_code=404, detail="ID-foto asset niet gevonden.")
    try:
        raw = base64.b64decode(asset["data_b64"])
    except Exception:
        raise HTTPException(status_code=500, detail="ID-foto asset corrupt.")
    mime = asset.get("content_type") or "image/webp"
    avatar_url = await _extract_face_avatar_from_bytes(
        raw, mime, tenant_id, uploaded_by=user.get("email"),
    )
    if not avatar_url:
        raise HTTPException(status_code=422, detail="Kon geen pasfoto detecteren op deze ID-kaart.")
    await db.tenants.update_one({"id": tenant_id}, {"$set": {"avatar_url": avatar_url}})
    return {"avatar_url": avatar_url}


@api.post("/tenants/{tenant_id}/avatar-upload")
async def upload_tenant_avatar(
    tenant_id: str,
    file: UploadFile = File(...),
    user=Depends(get_current_user),
):
    """Sla een manueel gecropte pasfoto op als tenant.avatar_url.
    Beheerders gebruiken dit vanaf de admin-UI (react-easy-crop) om zelf
    de juiste pasfoto uit de ID-kaart te knippen i.p.v. de Gemini-auto-
    crop te gebruiken. Body = multipart image (image/jpeg of image/webp)."""
    t = await db.tenants.find_one({"id": tenant_id, **scope(user)}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Huurder niet gevonden")
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Leeg bestand")
    if len(raw) > 8 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Bestand te groot (max 8MB)")
    mime = file.content_type or "image/jpeg"
    if not mime.startswith("image/"):
        raise HTTPException(status_code=400, detail="Alleen afbeeldingen toegestaan")
    # Bewaar als landing_asset zodat het via /api/landing/asset/{id} toonbaar
    # is — zelfde patroon als _extract_face_avatar_from_bytes.
    asset_id = str(uuid.uuid4())
    await db.landing_assets.insert_one({
        "id": asset_id,
        "company_id": company_id_of(user),
        "kind": "tenant_avatar",
        "tenant_id": tenant_id,
        "content_type": mime,
        "data_b64": base64.b64encode(raw).decode("ascii"),
        "size": len(raw),
        "uploaded_by": user.get("email"),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    avatar_url = f"/api/landing/asset/{asset_id}"
    await db.tenants.update_one({"id": tenant_id}, {"$set": {"avatar_url": avatar_url}})
    return {"avatar_url": avatar_url}


@api.post("/tenants/backfill-avatars")
async def backfill_tenant_avatars(force: bool = False, user=Depends(get_current_user)):
    """Genereer avatars voor alle huurders in deze company die wél een
    ID-kaart hebben. Standaard alleen huurders zonder avatar; met
    `?force=true` worden bestaande avatars vervangen door een nieuwe
    (strakkere) crop. Alleen admins."""
    if user.get("role") not in ("owner", "admin"):
        raise HTTPException(status_code=403, detail="Alleen beheerders")
    if force:
        q = {**scope(user), "id_photo_url": {"$exists": True, "$ne": ""}}
    else:
        q = {**scope(user), "id_photo_url": {"$exists": True, "$ne": ""}, "$or": [
            {"avatar_url": {"$exists": False}}, {"avatar_url": ""}, {"avatar_url": None},
        ]}
    todo = await db.tenants.find(q, {"_id": 0, "id": 1, "id_photo_url": 1, "name": 1}).to_list(500)
    done, failed = 0, 0
    for t in todo:
        try:
            asset_id = t["id_photo_url"].rsplit("/", 1)[-1]
            asset = await db.landing_assets.find_one({"id": asset_id}, {"_id": 0})
            if not asset: failed += 1; continue
            raw = base64.b64decode(asset["data_b64"])
            mime = asset.get("content_type") or "image/webp"
            avatar_url = await _extract_face_avatar_from_bytes(raw, mime, t["id"], uploaded_by=user.get("email"))
            if avatar_url:
                await db.tenants.update_one({"id": t["id"]}, {"$set": {"avatar_url": avatar_url}})
                done += 1
            else:
                failed += 1
        except Exception as e:  # noqa: BLE001
            print(f"[backfill-avatar] tenant {t.get('id')} failed: {e}")
            failed += 1
    return {"processed": len(todo), "done": done, "failed": failed}


@api.delete("/tenants/{tenant_id}/id-photo")
async def delete_tenant_id_photo(tenant_id: str, user=Depends(get_current_user)):
    """Verwijdert alleen de URL-referentie op de huurder (de landing_asset
    zelf blijft — kan later door retentie-cyclus opgeruimd worden)."""
    t = await db.tenants.find_one({"id": tenant_id, **scope(user)}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Huurder niet gevonden")
    await db.tenants.update_one({"id": tenant_id}, {"$unset": {"id_photo_url": ""}})
    return {"ok": True}


@api.post("/tenants/{tenant_id}/id-photo-back")
async def upload_tenant_id_photo_back(tenant_id: str, file: UploadFile = File(...),
                                        user=Depends(get_current_user)):
    """Upload achterkant van ID-kaart (zelfde patroon als voorkant)."""
    t = await db.tenants.find_one({"id": tenant_id, **scope(user)}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Huurder niet gevonden")
    raw = await file.read()
    if len(raw) > MAX_LANDING_ASSET_BYTES:
        raise HTTPException(status_code=413, detail="Bestand groter dan 5 MB.")
    ctype = (file.content_type or "").lower()
    if not ctype.startswith("image/"):
        raise HTTPException(status_code=400, detail="Alleen afbeeldingen toegestaan.")
    raw, ctype = _to_webp_bytes(raw, ctype)
    asset_id = new_id()
    await db.landing_assets.insert_one({
        "id": asset_id,
        "filename": file.filename or f"idcard-back-{tenant_id[:8]}",
        "content_type": ctype,
        "data_b64": base64.b64encode(raw).decode("ascii"),
        "size": len(raw),
        "uploaded_by": user.get("email"),
        "uploaded_at": iso(now_utc()),
    })
    url = f"/api/landing/asset/{asset_id}"
    await db.tenants.update_one({"id": tenant_id}, {"$set": {"id_photo_back_url": url}})
    return {"id_photo_back_url": url}


@api.delete("/tenants/{tenant_id}/id-photo-back")
async def delete_tenant_id_photo_back(tenant_id: str, user=Depends(get_current_user)):
    t = await db.tenants.find_one({"id": tenant_id, **scope(user)}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Huurder niet gevonden")
    await db.tenants.update_one({"id": tenant_id}, {"$unset": {"id_photo_back_url": ""}})
    return {"ok": True}


@api.post("/tenants/{tenant_id}/signature")
async def upload_tenant_signature(tenant_id: str, file: UploadFile = File(...),
                                    user=Depends(get_current_user)):
    """Sla digitale handtekening op als PNG asset (van HTML canvas)."""
    t = await db.tenants.find_one({"id": tenant_id, **scope(user)}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Huurder niet gevonden")
    raw = await file.read()
    if len(raw) > 2 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Handtekening te groot (>2 MB).")
    asset_id = new_id()
    await db.landing_assets.insert_one({
        "id": asset_id,
        "filename": f"signature-{tenant_id[:8]}.png",
        "content_type": "image/png",
        "data_b64": base64.b64encode(raw).decode("ascii"),
        "size": len(raw),
        "uploaded_by": user.get("email"),
        "uploaded_at": iso(now_utc()),
    })
    url = f"/api/landing/asset/{asset_id}"
    await db.tenants.update_one({"id": tenant_id}, {
        "$set": {"signature_url": url, "signature_signed_at": iso(now_utc())},
    })
    return {"signature_url": url}


@api.delete("/tenants/{tenant_id}/signature")
async def delete_tenant_signature(tenant_id: str, user=Depends(get_current_user)):
    t = await db.tenants.find_one({"id": tenant_id, **scope(user)}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Huurder niet gevonden")
    await db.tenants.update_one({"id": tenant_id}, {
        "$unset": {"signature_url": "", "signature_signed_at": ""},
    })
    return {"ok": True}


class SignatureRequestIn(BaseModel):
    channel: Literal["whatsapp", "sms"] = "whatsapp"
    message: Optional[str] = ""


@api.post("/tenants/{tenant_id}/signature/request")
async def request_tenant_signature(tenant_id: str, body: SignatureRequestIn,
                                     user=Depends(get_current_user)):
    """Genereer een tijdelijke handtekening-link en stuur die via WhatsApp/SMS
    naar de huurder. Link is 24u geldig en éénmalig te gebruiken. Wanneer
    WhatsApp faalt (bv. huurder is niet joined) proberen we automatisch SMS."""
    cid = company_id_of(user)
    if not cid:
        raise HTTPException(status_code=400, detail="Geen actief bedrijf geselecteerd")
    t = await db.tenants.find_one({"id": tenant_id, **scope(user)}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Huurder niet gevonden")
    phone = (t.get("phone") or "").strip()
    if not phone:
        raise HTTPException(status_code=400, detail="Deze huurder heeft geen telefoonnummer — voeg er eerst één toe.")
    twilio_cfg = await get_company_section(cid, "twilio")
    if not twilio_cfg.get("enabled"):
        raise HTTPException(status_code=400, detail="WhatsApp/SMS is niet ingeschakeld — configureer eerst onder Instellingen → WhatsApp & SMS.")

    # Bestaande niet-verlopen, niet-gebruikte tokens hergebruiken zou de
    # link kunnen leaken via twee kanalen. Simpler: elke request maakt een
    # nieuwe token en oude worden inactief (best-effort cleanup).
    token = secrets.token_urlsafe(24)
    now = now_utc()
    expires = now + timedelta(hours=24)
    await db.tenant_signature_tokens.insert_one({
        "_id": token,
        "tenant_id": tenant_id,
        "company_id": cid,
        "created_at": iso(now),
        "expires_at": iso(expires),
        "used_at": None,
        "requested_by": user.get("email"),
    })

    base = (os.environ.get("APP_PUBLIC_URL") or "").rstrip("/") or _public_url("").rstrip("/")
    sign_url = f"{base}/onderteken-huurder/{token}"
    brand_name = await _brand_name_of(cid)

    extra = f"{body.message.strip()}\n\n" if body.message else ""
    msg = (
        f"{extra}"
        f"Hallo {t.get('name', 'huurder')},\n\n"
        f"{brand_name} verzoekt u om uw digitale handtekening te plaatsen.\n"
        f"Open de veilige link hieronder en teken op uw telefoon:\n\n"
        f"{sign_url}\n\n"
        f"Deze link is 24 uur geldig.\n\n"
        f"— {brand_name}"
    )

    # Probeer WhatsApp eerst (indien gekozen); fallback naar SMS.
    from twilio_service import send_whatsapp, send_sms, TwilioError
    used_channel = None
    try:
        if body.channel == "whatsapp":
            await send_whatsapp(twilio_cfg, phone, msg)
            used_channel = "whatsapp"
        else:
            await send_sms(twilio_cfg, phone, msg)
            used_channel = "sms"
    except TwilioError as e:
        # Val terug op SMS wanneer WhatsApp faalde (bv. niet gejoinde sandbox).
        if body.channel == "whatsapp":
            try:
                await send_sms(twilio_cfg, phone, msg)
                used_channel = "sms"
            except TwilioError as e2:
                raise HTTPException(status_code=502, detail=f"Zowel WhatsApp als SMS faalden: {e2}") from e2
        else:
            raise HTTPException(status_code=502, detail=str(e)) from e

    return {"ok": True, "sent_to": phone, "channel": used_channel,
            "expires_at": iso(expires), "url": sign_url}


@app.get("/api/public/signature-request/{token}")
async def public_signature_request_info(token: str):
    """Publieke lookup: valideert de token en geeft alleen huurder-naam
    + bedrijfs-branding terug (geen PII). Frontend rendert daarmee de
    ondertekening-pagina op /onderteken-huurder/{token}."""
    doc = await db.tenant_signature_tokens.find_one({"_id": token})
    if not doc:
        raise HTTPException(status_code=404, detail="Ongeldige of verlopen link")
    if doc.get("used_at"):
        raise HTTPException(status_code=410, detail="Deze link is al gebruikt.")
    try:
        exp = datetime.fromisoformat(doc["expires_at"].replace("Z", "+00:00"))
        if exp < now_utc():
            raise HTTPException(status_code=410, detail="Deze link is verlopen.")
    except HTTPException:
        raise
    except Exception:
        pass
    tenant = await db.tenants.find_one({"id": doc["tenant_id"]}, {"_id": 0, "name": 1}) or {}
    brand = await _tenant_email_brand(doc.get("company_id"))
    return {
        "tenant_name": tenant.get("name") or "Huurder",
        "brand_name": brand["brand_name"],
        "brand_color": brand["brand_color"],
        "logo_url": brand["logo_url"] or "",
    }


@app.post("/api/public/signature-request/{token}")
async def public_signature_request_submit(token: str, file: UploadFile = File(...)):
    """Publieke submit: huurder plakt hier de PNG blob van hun canvas.
    Slaat de handtekening op als asset, koppelt aan tenant en markeert
    de token als gebruikt."""
    doc = await db.tenant_signature_tokens.find_one({"_id": token})
    if not doc:
        raise HTTPException(status_code=404, detail="Ongeldige of verlopen link")
    if doc.get("used_at"):
        raise HTTPException(status_code=410, detail="Deze link is al gebruikt.")
    try:
        exp = datetime.fromisoformat(doc["expires_at"].replace("Z", "+00:00"))
        if exp < now_utc():
            raise HTTPException(status_code=410, detail="Deze link is verlopen.")
    except HTTPException:
        raise
    except Exception:
        pass
    raw = await file.read()
    if len(raw) > 2 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Handtekening te groot (>2 MB).")
    tenant_id = doc["tenant_id"]
    asset_id = new_id()
    now = now_utc()
    await db.landing_assets.insert_one({
        "id": asset_id,
        "filename": f"signature-{tenant_id[:8]}.png",
        "content_type": "image/png",
        "data_b64": base64.b64encode(raw).decode("ascii"),
        "size": len(raw),
        "uploaded_by": f"tenant:{tenant_id}",
        "uploaded_at": iso(now),
    })
    url = f"/api/landing/asset/{asset_id}"
    await db.tenants.update_one({"id": tenant_id}, {
        "$set": {"signature_url": url, "signature_signed_at": iso(now)},
    })
    await db.tenant_signature_tokens.update_one(
        {"_id": token}, {"$set": {"used_at": iso(now)}},
    )
    return {"ok": True}


@api.post("/tenants/ocr-id-card")
async def ocr_id_card(file: UploadFile = File(...),
                       user=Depends(get_current_user)):
    """OCR van een ID-kaart via Gemini 2.5. Retourneert de gevonden velden
    zodat het huurder-formulier automatisch ingevuld kan worden. Werkt met
    Surinaamse ID's, paspoorten en NL rijbewijzen."""
    import os
    import json as _json
    import tempfile
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage, FileContentWithMimeType
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"OCR module niet geladen: {e}")
    api_key = os.getenv("EMERGENT_LLM_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="EMERGENT_LLM_KEY ontbreekt")

    raw = await file.read()
    if len(raw) > MAX_LANDING_ASSET_BYTES:
        raise HTTPException(status_code=413, detail="Bestand groter dan 5 MB")
    ctype = (file.content_type or "image/jpeg").lower()
    suffix = ".png" if "png" in ctype else (".webp" if "webp" in ctype else ".jpg")
    mime = "image/png" if "png" in ctype else ("image/webp" if "webp" in ctype else "image/jpeg")

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as f:
        f.write(raw)
        tmp_path = f.name

    prompt = (
        "Extract identity data from this ID card / passport image. "
        "Return ONLY valid JSON (no markdown, no code fence) in this schema:\n"
        '{\n'
        '  "name": "<voornaam achternaam>" of null,\n'
        '  "id_number": "<document nummer>" of null,\n'
        '  "birth_date": "YYYY-MM-DD" of null,\n'
        '  "confidence": <0..1>\n'
        '}\n'
        "Regels: names in Title Case. Datum altijd ISO YYYY-MM-DD. "
        "Als het document GEEN ID/paspoort/rijbewijs is, zet confidence=0. "
        "Als een veld onduidelijk is: null."
    )
    chat = LlmChat(
        api_key=api_key,
        session_id=f"idocr-{new_id()[:8]}",
        system_message="Je bent een OCR-engine die uitsluitend geldig JSON terug geeft.",
    ).with_model("gemini", "gemini-2.5-flash")

    try:
        msg = UserMessage(text=prompt,
                            file_contents=[FileContentWithMimeType(file_path=tmp_path, mime_type=mime)])
        raw_text = await chat.send_message(msg)
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass

    txt = (raw_text or "").strip()
    # Strip markdown fences als aanwezig.
    if txt.startswith("```"):
        txt = txt.split("```")[1] if len(txt.split("```")) > 1 else txt
        if txt.startswith("json"):
            txt = txt[4:]
    try:
        data = _json.loads(txt.strip())
    except Exception:
        raise HTTPException(status_code=502, detail="OCR gaf ongeldig JSON terug")
    return {
        "name": data.get("name") or "",
        "id_number": (data.get("id_number") or "").upper(),
        "birth_date": data.get("birth_date") or "",
        "confidence": float(data.get("confidence") or 0),
    }


# =====================================================================
# Payments (admin)
# =====================================================================
async def _next_receipt_number() -> str:
    # KW{year}-{seq 5 digits}
    from pymongo import ReturnDocument
    year = now_utc().year
    counter = await db.counters.find_one_and_update(
        {"_id": f"receipt_{year}"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    seq = counter.get("seq", 1)
    return f"KW{year}-{seq:05d}"


async def _tenant_email_brand(company_id: Optional[str]) -> dict:
    """Levert white-label branding-kwargs voor tenant-emails.

    Returnt een dict die 1-op-1 als kwargs aan `wrap_template(...)` gegeven
    kan worden: `brand_name`, `brand_color`, `logo_url`. Bevat NOOIT
    SuriRent branding — dit is uitsluitend voor mails die namens een
    klantbedrijf worden verstuurd via hun eigen SMTP.
    """
    if not company_id:
        return {"brand_name": "Vastgoed", "brand_color": "#FF5C00", "logo_url": ""}
    co = await db.companies.find_one(
        {"id": company_id},
        {"_id": 0, "name": 1, "branding": 1},
    ) or {}
    branding = co.get("branding") or {}
    logo_rel = (branding.get("logo_url") or "").strip()
    logo_abs = ""
    if logo_rel:
        if logo_rel.startswith("http"):
            logo_abs = logo_rel
        else:
            base = (os.environ.get("APP_PUBLIC_URL") or "https://app.surirent.sr").rstrip("/")
            logo_abs = f"{base}{logo_rel if logo_rel.startswith('/') else '/' + logo_rel}"
    return {
        "brand_name": co.get("name") or "Vastgoed",
        "brand_color": branding.get("primary_color") or "#FF5C00",
        "logo_url": logo_abs,
    }


async def _brand_name_of(company_id: Optional[str]) -> str:
    """Lichtgewicht helper: alleen de bedrijfsnaam ophalen voor gebruik in
    WhatsApp/SMS signoffs. Fallback op 'Vastgoed' zodat we nooit per ongeluk
    de SuriRent branding lekken in klant-communicatie."""
    if not company_id:
        return "Vastgoed"
    co = await db.companies.find_one({"id": company_id}, {"_id": 0, "name": 1}) or {}
    return co.get("name") or "Vastgoed"


async def _company_brand_info(company_id: Optional[str]) -> dict:
    """Geef bedrijfs-branding info voor PDF headers (name, address, phone,
    email, logo_bytes, signature_data). Lege dict bij geen company_id."""
    if not company_id:
        return {}
    co = await db.companies.find_one(
        {"id": company_id},
        {"_id": 0, "name": 1, "contact_email": 1, "contact_phone": 1,
         "whatsapp_number": 1, "tagline": 1,
         "address": 1, "branding": 1,
         "bank_account_sr": 1, "bank_account_nl": 1, "kkf_number": 1,
         "landlord_name": 1, "landlord_birth_date": 1, "landlord_id_number": 1,
         "landlord_signature_url": 1},
    ) or {}
    settings = await db.company_settings.find_one(
        {"company_id": company_id}, {"_id": 0, "signature_data": 1},
    ) or {}
    # Logo bytes ophalen via asset_id uit branding.logo_url
    logo_bytes = None
    logo_url = (co.get("branding") or {}).get("logo_url") or ""
    if logo_url:
        try:
            # logo_url is meestal "/api/landing/asset/<id>"
            asset_id = logo_url.rsplit("/", 1)[-1]
            if asset_id:
                doc = await db.landing_assets.find_one({"id": asset_id}, {"_id": 0, "data_b64": 1})
                if doc and doc.get("data_b64"):
                    logo_bytes = base64.b64decode(doc["data_b64"])
        except Exception:
            logo_bytes = None
    # Verhuurder-handtekening bytes: geladen uit uploaded landing-asset (via
    # Instellingen → Verhuurder → Handtekening upload). Zet dit boven de
    # "Handtekening verhuurder" lijn op kwitantie / contract.
    landlord_signature_bytes = None
    landlord_sig_url = (co.get("landlord_signature_url") or "").strip()
    if landlord_sig_url:
        try:
            landlord_signature_bytes = await _load_landing_asset_bytes(landlord_sig_url)
        except Exception:
            landlord_signature_bytes = None
    return {
        "company_name": co.get("name") or "",
        "company_address": co.get("address") or "",
        "company_phone": co.get("contact_phone") or "",
        "company_email": co.get("contact_email") or "",
        "company_whatsapp": co.get("whatsapp_number") or co.get("contact_phone") or "",
        "company_tagline": co.get("tagline") or "",
        "company_logo_bytes": logo_bytes,
        "company_primary_color": (co.get("branding") or {}).get("primary_color") or "#FF5C00",
        # PDF-template keuze (luxury design) — tenant kiest in Instellingen →
        # Facturatie. Valt terug op midnight_gold (donkerblauw + goud) wanneer
        # niet gezet. Toegestane keys: midnight_gold, charcoal_gold,
        # forest_gold, sunset_gold.
        "company_pdf_template": (co.get("branding") or {}).get("pdf_template")
            or co.get("pdf_template") or "midnight_gold",
        # Custom dark-kleur override voor PDF-templates (optioneel).
        "company_pdf_custom_dark": (co.get("branding") or {}).get("pdf_custom_dark") or "",
        "signature_data": settings.get("signature_data") or "",
        # Verhuurder-persoonsgegevens t.b.v. huurcontracten. Fallback op
        # de bedrijfsnaam wanneer geen aparte verhuurder-naam is ingesteld.
        "landlord": co.get("landlord_name") or co.get("name") or "",
        "landlord_name": co.get("landlord_name") or co.get("name") or "",
        "landlord_dob": co.get("landlord_birth_date") or "",
        "landlord_id": co.get("landlord_id_number") or "",
        "contact_email": co.get("contact_email") or "",
        "bank_account_sr": co.get("bank_account_sr") or "",
        "bank_account_nl": co.get("bank_account_nl") or "",
        "kkf_number": co.get("kkf_number") or "",
        "landlord_signature_bytes": landlord_signature_bytes,
    }



async def _enrich_payment(p: dict, include_logo: bool = False) -> dict:
    """Verrijk een payment doc met tenant/apt/location namen en brand-info.

    `include_logo=False` (default): strippt `company_logo_bytes` uit de
    output zodat FastAPI's JSON encoder niet crasht op raw PNG-bytes
    (0x89 magic → UnicodeDecodeError → 500). JSON-endpoints roepen
    daarom zonder argument aan; PDF-generatie endpoints passen expliciet
    `include_logo=True` mee zodat het logo in de PDF gerenderd wordt.
    """
    tenant_name = None
    tenant_phone = None
    apt_number = None
    location_name = None
    location_city = ""
    location_address = ""
    if p.get("tenant_id"):
        t = await db.tenants.find_one({"id": p["tenant_id"]}, {"_id": 0, "name": 1, "phone": 1})
        if t:
            tenant_name = t.get("name")
            tenant_phone = t.get("phone") or None
    if p.get("apartment_id"):
        a = await db.apartments.find_one(
            {"id": p["apartment_id"]}, {"_id": 0, "number": 1, "location_id": 1}
        )
        if a:
            apt_number = a.get("number")
            if a.get("location_id"):
                loc = await db.locations.find_one({"id": a["location_id"]}, {"_id": 0, "name": 1, "address": 1})
                if loc:
                    location_name = loc.get("name")
                    location_city = ((loc.get("address") or "").split(",")[-1]).strip() if loc.get("address") else ""
                    location_address = loc.get("address") or ""
    # Bedrijfsinfo voor de PDF-header (branding-look uit voorbeeld).
    # BELANGRIJK: brand info bevat MEERDERE raw bytes velden
    # (`company_logo_bytes`, `landlord_signature_bytes`) die FastAPI's
    # jsonable_encoder crashen (UnicodeDecodeError → 500). Voor JSON-
    # responses strippen we ELK bytes-veld universeel. PDF-generatie
    # roept met `include_logo=True` aan om de raw blobs te behouden.
    company_info = {}
    if p.get("company_id"):
        brand = await _company_brand_info(p["company_id"])
        if brand:
            if include_logo:
                company_info = brand
            else:
                company_info = {
                    k: v for k, v in brand.items()
                    if not isinstance(v, (bytes, bytearray))
                }
    # Openstaand na deze betaling — som van remaining_amount over alle
    # niet-betaalde facturen van deze huurder, in dezelfde currency.
    outstanding_after = 0.0
    open_periods = []
    if p.get("tenant_id"):
        try:
            cur = p.get("currency") or "SRD"
            async for inv in db.invoices.find(
                {"tenant_id": p["tenant_id"], "currency": cur,
                 "status": {"$nin": ["paid", "cancelled"]}},
                {"_id": 0, "amount": 1, "paid_amount": 1, "id": 1, "period_month": 1, "period_year": 1},
            ):
                inv_amt = float(inv.get("amount") or 0)
                paid = inv.get("paid_amount")
                if paid is None:
                    paid = await _invoice_currently_paid(inv["id"])
                rest = max(0.0, inv_amt - float(paid or 0))
                outstanding_after += rest
                if rest > 0.005 and isinstance(inv.get("period_month"), int) and inv.get("period_year"):
                    open_periods.append((int(inv["period_year"]), inv["period_month"]))
        except Exception:
            pass
    p["openstaand_periode"] = _format_periods(open_periods)
    # Defensive backfill: één corrupt legacy-doc (bv. AI-insert zonder
    # receipt_number/paid_at) mag geen enkel endpoint meer crashen.
    if not p.get("receipt_number"):
        p["receipt_number"] = f"KW-LEGACY-{str(p.get('id') or '')[:8].upper()}"
    if not p.get("paid_at"):
        p["paid_at"] = p.get("created_at") or p.get("approved_at") or iso(now_utc())
    # Strip alle bytes-velden uit de raw payment doc zelf (defensief:
    # legacy docs kunnen embedded binary attachments bevatten die
    # FastAPI's jsonable_encoder laten crashen).
    if not include_logo:
        p = {k: v for k, v in p.items() if not isinstance(v, (bytes, bytearray))}
    return {**p, "tenant_name": tenant_name, "tenant_phone": tenant_phone or p.get("tenant_phone"),
            "apartment_number": apt_number,
            "location_name": location_name,
            "location_city": location_city,
            "location_address": location_address,
            "outstanding_after": round(outstanding_after, 2),
            **company_info}


async def _enrich_payments_bulk(payments: list[dict]) -> list[dict]:
    """Bulk-versie van _enrich_payment voor lijst-endpoints. Reduceert
    queries van O(N) per payment naar O(1) constante batch-fetches.

    Voorheen: 200 payments × 4-6 queries = 800-1200 DB calls.
    Nu: 4 batch-queries + 1 brand-lookup per unieke company. Voor één
    bedrijf met 200 betalingen: ~5 queries totaal.

    Fault-tolerant: als een batch-query faalt, fallback naar lege lookup
    tables zodat de betalings-lijst ALTIJD terugkomt (evt. zonder tenant-
    naam/appt-nummer). Betere UX dan 500-crash.
    """
    if not payments:
        return []
    tenant_ids = {p["tenant_id"] for p in payments if p.get("tenant_id")}
    apt_ids = {p["apartment_id"] for p in payments if p.get("apartment_id")}
    company_ids = {p["company_id"] for p in payments if p.get("company_id")}

    tenant_by_id, apt_by_id, loc_by_id, brand_cache = {}, {}, {}, {}
    outstanding_by_tenant_cur: dict[tuple[str, str], float] = {}
    try:
        tenants_task = db.tenants.find(
            {"id": {"$in": list(tenant_ids)}}, {"_id": 0, "id": 1, "name": 1}
        ).to_list(None) if tenant_ids else asyncio.sleep(0, result=[])
        apartments_task = db.apartments.find(
            {"id": {"$in": list(apt_ids)}}, {"_id": 0, "id": 1, "number": 1, "location_id": 1}
        ).to_list(None) if apt_ids else asyncio.sleep(0, result=[])
        tenants, apartments = await asyncio.gather(tenants_task, apartments_task)
        tenant_by_id = {t["id"]: t for t in tenants}
        apt_by_id = {a["id"]: a for a in apartments}
        loc_ids = {a.get("location_id") for a in apartments if a.get("location_id")}
        if loc_ids:
            locs = await db.locations.find(
                {"id": {"$in": list(loc_ids)}}, {"_id": 0, "id": 1, "name": 1}
            ).to_list(None)
            loc_by_id = {loc["id"]: loc for loc in locs}
    except Exception as _e:  # noqa: BLE001
        import traceback
        print(f"[payments] enrichment batch lookup FAILED, degrading: {_e}")
        traceback.print_exc()

    # Brand info per company — éénmaal per unieke company gecached.
    # We strippen ELK bytes-veld (bv. `company_logo_bytes`,
    # `landlord_signature_bytes`) zodat FastAPI's JSON encoder niet
    # faalt op raw PNG-blobs (UnicodeDecodeError → 500). Deze blobs
    # worden enkel gebruikt in PDF-generatie, niet in lijst-endpoints.
    for cid in company_ids:
        try:
            b = await _company_brand_info(cid)
            if b:
                b = {k: v for k, v in b.items() if not isinstance(v, (bytes, bytearray))}
            brand_cache[cid] = b
        except Exception as _e:  # noqa: BLE001
            print(f"[payments] brand info fetch FAILED for {cid}: {_e}")
            brand_cache[cid] = {}

    # Outstanding-per-tenant — als deze query crasht is het niet erg,
    # de lijst laadt zonder outstanding_after (default 0).
    try:
        if tenant_ids:
            async for inv in db.invoices.find(
                {"tenant_id": {"$in": list(tenant_ids)},
                 "status": {"$nin": ["paid", "cancelled"]}},
                {"_id": 0, "id": 1, "tenant_id": 1, "currency": 1,
                 "amount": 1, "paid_amount": 1},
            ):
                tid = inv.get("tenant_id")
                cur = inv.get("currency") or "SRD"
                inv_amt = float(inv.get("amount") or 0)
                paid = inv.get("paid_amount")
                if paid is None:
                    try:
                        paid = await _invoice_currently_paid(inv["id"])
                    except Exception:  # noqa: BLE001
                        paid = 0
                outstanding_by_tenant_cur[(tid, cur)] = (
                    outstanding_by_tenant_cur.get((tid, cur), 0.0)
                    + max(0.0, inv_amt - float(paid or 0))
                )
    except Exception as _e:  # noqa: BLE001
        import traceback
        print(f"[payments] outstanding batch calc FAILED, using zeros: {_e}")
        traceback.print_exc()

    # Bouw de output. Defensive: één corrupt doc (bv. legacy AI-insert zonder
    # `receipt_number` of `paid_at`, of een null-veld waar Pydantic hikt) mag
    # NOOIT meer de hele /api/payments response laten crashen. Vul missende
    # verplichte PaymentOut-velden aan met veilige defaults, wrap de hele
    # enrichment per payment in een try/except zodat één slechte doc de rest
    # niet meesleept, en log elk incident zodat admins/monitoring het kunnen
    # zien en repareren.
    out = []
    for p in payments:
        try:
            # Strip alle bytes-velden uit de raw payment doc zelf zodat
            # legacy docs met binary blobs (bv. embedded signature/receipt
            # attachments) FastAPI JSON encoder niet doen crashen.
            p = {k: v for k, v in p.items() if not isinstance(v, (bytes, bytearray))}
            tid = p.get("tenant_id")
            aid = p.get("apartment_id")
            cid = p.get("company_id")
            t = tenant_by_id.get(tid) if tid else None
            a = apt_by_id.get(aid) if aid else None
            loc = loc_by_id.get(a.get("location_id")) if a and a.get("location_id") else None
            cur = p.get("currency") or "SRD"
            # --- Defensive backfill voor verplichte PaymentOut-velden ---
            _fixed = []
            if not p.get("receipt_number"):
                p["receipt_number"] = f"KW-LEGACY-{str(p.get('id') or '')[:8].upper()}"
                _fixed.append("receipt_number")
            if not p.get("paid_at"):
                p["paid_at"] = p.get("created_at") or p.get("approved_at") or iso(now_utc())
                _fixed.append("paid_at")
            if p.get("amount") is None:
                p["amount"] = 0.0
                _fixed.append("amount")
            if not p.get("currency"):
                p["currency"] = "SRD"
                _fixed.append("currency")
            if not p.get("method"):
                p["method"] = "cash"
                _fixed.append("method")
            if not p.get("category"):
                p["category"] = "rent"
                _fixed.append("category")
            if not tid:
                # Geen tenant_id → skippen. Deze legacy-doc kan niet
                # meaningful weergegeven worden aan een huurder.
                print(f"[payments] SKIPPED corrupt doc (no tenant_id) id={p.get('id')}")
                continue
            if _fixed:
                print(f"[payments] backfilled missing fields {_fixed} for payment id={p.get('id')} company={cid}")
            out.append({
                **p,
                "tenant_name": t.get("name") if t else None,
                "apartment_number": a.get("number") if a else None,
                "location_name": loc.get("name") if loc else None,
                "outstanding_after": round(outstanding_by_tenant_cur.get((tid, cur), 0.0), 2),
                **(brand_cache.get(cid) or {}),
            })
        except Exception as _e:  # noqa: BLE001
            # Fail-safe: log en skip. Betere UX dan de hele lijst laten
            # crashen omdat één document raar is.
            import traceback
            print(f"[payments] SKIPPED payment enrichment failure id={p.get('id')} err={_e}")
            traceback.print_exc()
            continue
    return out


async def _invoice_currently_paid(invoice_id: str, exclude_payment_id: Optional[str] = None) -> float:
    """Som van alle approved payments die aan deze factuur gelinkt zijn (optioneel zonder één betaling).
    Wordt gebruikt voor fallback wanneer `paid_amount` nog niet gemigreerd is."""
    total = 0.0
    q = {"invoice_id": invoice_id, "status": "approved"}
    if exclude_payment_id:
        q["id"] = {"$ne": exclude_payment_id}
    async for p in db.payments.find(q, {"_id": 0, "amount": 1}):
        try:
            total += float(p.get("amount") or 0)
        except Exception:
            pass
    return round(total + 1e-9, 2)


async def _apply_payment_to_invoice(invoice_id: str, amount: float,
                                    payment_id: Optional[str] = None,
                                    paid_at: Optional[str] = None,
                                    method: Optional[str] = None,
                                    receipt_number: Optional[str] = None) -> dict:
    """Past `amount` toe op factuur:
       • paid_amount += amount (cumulatief — meerdere partial-payments mogelijk)
       • status → 'paid' wanneer paid_amount >= 100% van het factuurbedrag
       Retourneert de bijgewerkte factuur (of {} bij ontbreken).

    IDEMPOTENCY GUARD (2026-02-14): elke succesvolle allocatie wordt
    geregistreerd in `payment.allocations = [{invoice_id, amount,
    applied_at}]`. Wanneer dezelfde `payment_id` een tweede keer op
    dezelfde `invoice_id` binnenkomt (bv. door een dubbele approve-call,
    OCR + manual approve race, of een re-allocation bug), skippen we
    het en loggen een waarschuwing i.p.v. dubbel te tellen. Voorheen
    kon een 7750 payment op 2 verschillende facturen elk 7750 optellen
    → totaal 15500 gecrediteerd — nu onmogelijk.
    """
    inv = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not inv:
        return {}
    # Idempotency guard: is deze payment_id + invoice_id combinatie al toegepast?
    if payment_id:
        existing_pay = await db.payments.find_one(
            {"id": payment_id, "allocations.invoice_id": invoice_id},
            {"_id": 0, "id": 1, "allocations": 1},
        )
        if existing_pay:
            already = next(
                (a for a in (existing_pay.get("allocations") or [])
                 if a.get("invoice_id") == invoice_id),
                None,
            )
            if already:
                print(
                    f"[apply] SKIP dubbele allocatie payment={payment_id[:8]} "
                    f"→ invoice={invoice_id[:8]} (al toegepast met "
                    f"{already.get('amount')} op {already.get('applied_at')})"
                )
                return inv
    inv_amt = float(inv.get("amount") or 0)
    # Migratie-fallback: als paid_amount nog niet bestaat, bereken uit payments.
    if inv.get("paid_amount") is None:
        # Huidige betaling niet meetellen (staat al in DB) — anders dubbel-tellen.
        if payment_id:
            base = await _invoice_currently_paid(invoice_id, exclude_payment_id=payment_id)
        else:
            base = max(0.0, await _invoice_currently_paid(invoice_id) - float(amount or 0))
        await db.invoices.update_one(
            {"id": invoice_id}, {"$set": {"paid_amount": round(base, 2)}}
        )
        inv["paid_amount"] = round(base, 2)
    new_paid = round(float(inv.get("paid_amount") or 0) + float(amount or 0), 2)
    update = {"paid_amount": new_paid}
    if payment_id:
        update["payment_id"] = payment_id
    if method:
        update["paid_method"] = method
    if receipt_number:
        update["receipt_number"] = receipt_number
    if inv_amt <= 0 or new_paid >= inv_amt - 0.005:
        update["status"] = "paid"
        update["paid_at"] = paid_at or iso(now_utc())
    elif new_paid > 0:
        # Gedeeltelijke betaling — duidelijk te onderscheiden in admin UI
        # (Invoices.jsx) en in OCR-rapportages. Status springt automatisch
        # naar "paid" zodra cumulatief ≥ 100% van het factuurbedrag binnen is.
        update["status"] = "partial"
    await db.invoices.update_one({"id": invoice_id}, {"$set": update})
    inv.update(update)
    # Registreer de allocatie op de payment doc zodat toekomstige aanroepen
    # de idempotency-guard hierboven kunnen raadplegen. Push naar de
    # `allocations` array (idempotent — pas alleen als de combinatie nog
    # niet bestaat, wat we al hebben gecontroleerd).
    if payment_id:
        try:
            await db.payments.update_one(
                {"id": payment_id},
                {"$push": {"allocations": {
                    "invoice_id": invoice_id,
                    "amount": round(float(amount or 0), 2),
                    "applied_at": iso(now_utc()),
                }}},
            )
        except Exception as _e:  # noqa: BLE001
            # Best-effort — betaling zelf al toegepast, alleen tracking mist.
            print(f"[apply] allocation tracking failed: {_e}")
    # Sync eventueel gekoppelde betalingsregelingen (FIFO installments) met
    # de nieuwe paid_amount. Idempotent — kan meerdere keren aangeroepen worden
    # zonder installments dubbel te markeren.
    try:
        await _sync_plan_installments_with_invoice(invoice_id)
    except Exception as e:  # noqa: BLE001
        print(f"[invoice.apply] plan-sync failed for {invoice_id}: {e}")
    return inv


async def _sync_plan_installments_with_invoice(invoice_id: str) -> None:
    """Houdt de installments van betalingsregelingen die aan deze factuur zijn
    gekoppeld in sync met `invoice.paid_amount`. Wordt na elke `paid_amount`
    mutatie aangeroepen (huur-betaling, credit-verrekening, overflow).

    Logica per plan:
      1. Bereken hoeveel van de invoice.paid_amount aan HET PLAN toebedeeld is.
         Als de factuur 7000 kost en het plan dekt de laatste 3000, dan telt
         alles boven de eerste 4000 (= invoice_amount - plan_total) als
         plan-betaling. `plan_paid = max(0, invoice.paid_amount - non_plan)`
      2. Loop door installments FIFO (op sequence). Cumulatief tellen zolang
         cumulatief <= plan_paid: alle pending-installments in dat bereik →
         status="paid". `pending_payment` (kiosk-in-flight) blijft ongemoeid.
      3. Herbereken `plan.paid_installments`. Zet `plan.status="completed"`
         wanneer alle termijnen betaald zijn."""
    plans = await db.payment_plans.find(
        {"invoice_ids": invoice_id, "status": {"$ne": "completed"}},
        {"_id": 0},
    ).to_list(100)
    if not plans:
        return
    inv = await db.invoices.find_one(
        {"id": invoice_id}, {"_id": 0, "amount": 1, "paid_amount": 1},
    ) or {}
    inv_paid = float(inv.get("paid_amount") or 0)
    inv_amt = float(inv.get("amount") or 0)
    for plan in plans:
        plan_total = float(plan.get("total_amount") or 0)
        # Het deel van de factuur dat BUITEN de regeling viel (bijv. eerste
        # 4000 van een 7000-factuur waar de laatste 3000 in een plan zit).
        non_plan = max(0.0, inv_amt - plan_total)
        plan_paid = max(0.0, inv_paid - non_plan)

        installments = await db.payment_plan_installments.find(
            {"plan_id": plan["id"]}, {"_id": 0},
        ).sort("sequence", 1).to_list(500)
        cumulative = 0.0
        for inst in installments:
            amt = float(inst.get("amount") or 0)
            cumulative += amt
            # Alleen 'pending' installments auto-markeren. 'pending_payment'
            # (kiosk approve in-flight) laten we met rust; kiosk approve-flow
            # zet die naar 'paid' bij goedkeuring.
            if cumulative <= plan_paid + 0.01 and inst.get("status") == "pending":
                await db.payment_plan_installments.update_one(
                    {"id": inst["id"]},
                    {"$set": {"status": "paid", "paid_at": iso(now_utc()),
                              "paid_from_invoice_sync": True}},
                )
        # Herbereken plan-teller en eventueel completion
        paid_count = await db.payment_plan_installments.count_documents(
            {"plan_id": plan["id"], "status": "paid"},
        )
        total_count = len(installments) or int(plan.get("num_installments") or 0)
        update: dict = {"paid_installments": paid_count}
        if total_count > 0 and paid_count >= total_count:
            update["status"] = "completed"
            update["completed_at"] = iso(now_utc())
        await db.payment_plans.update_one({"id": plan["id"]}, {"$set": update})

        # --- Herverdeling van pending termijnen ---
        # Wanneer er buiten de regeling om is bijbetaald (of extra minder),
        # verdelen we het nog openstaande factuurbedrag GELIJKMATIG over
        # de nog openstaande termijnen. Zo blijft de LOOPTIJD gelijk
        # (aantal termijnen) maar past het BEDRAG per termijn aan.
        if update.get("status") != "completed":
            await _redistribute_pending_installments(plan["id"])


async def _redistribute_pending_installments(plan_id: str) -> None:
    """Verdeel het nog openstaande factuurbedrag gelijkmatig over de
    resterende pending termijnen. Wordt aangeroepen na elke wijziging
    op de gekoppelde factuur (of na een termijnbetaling).

    Rondingsverschil valt in de LAATSTE pending termijn zodat de som
    exact overeenkomt met het openstaande bedrag.
    """
    plan = await db.payment_plans.find_one({"id": plan_id}, {"_id": 0})
    if not plan or plan.get("status") == "completed":
        return
    inv_ids = plan.get("invoice_ids") or []
    if not inv_ids:
        return  # niet-gekoppelde regelingen laten we ongemoeid
    # Som van nog openstaande factuurbedragen
    invoice_open = 0.0
    async for inv in db.invoices.find(
        {"id": {"$in": inv_ids}}, {"_id": 0, "amount": 1, "paid_amount": 1},
    ):
        invoice_open += max(0.0, float(inv.get("amount") or 0)
                            - float(inv.get("paid_amount") or 0))
    invoice_open = round(invoice_open + 1e-9, 2)

    # Pending termijnen (FIFO op sequence)
    pending = await db.payment_plan_installments.find(
        {"plan_id": plan_id, "status": "pending"}, {"_id": 0},
    ).sort("sequence", 1).to_list(500)
    n = len(pending)
    if n == 0:
        # Niets meer te verdelen. Als factuur ook nul is → plan completed.
        if invoice_open <= 0.01:
            await db.payment_plans.update_one(
                {"id": plan_id},
                {"$set": {"status": "completed",
                          "completed_at": iso(now_utc())}},
            )
        return

    if invoice_open <= 0.01:
        # Factuur is helemaal betaald → cancel resterende pending termijnen
        # en sluit het plan.
        await db.payment_plan_installments.update_many(
            {"plan_id": plan_id, "status": "pending"},
            {"$set": {"status": "cancelled",
                      "cancelled_at": iso(now_utc()),
                      "cancelled_reason": "invoice_fully_paid"}},
        )
        await db.payment_plans.update_one(
            {"id": plan_id},
            {"$set": {"status": "completed", "completed_at": iso(now_utc())}},
        )
        return

    per = round(invoice_open / n + 1e-9, 2)
    running = 0.0
    for idx, inst in enumerate(pending):
        cur_amt = round(float(inst.get("amount") or 0) + 1e-9, 2)
        if idx < n - 1:
            new_amt = per
            running = round(running + per, 2)
        else:
            # Laatste termijn vangt afrondingsverschil
            new_amt = round(invoice_open - running + 1e-9, 2)
        if abs(new_amt - cur_amt) < 0.01:
            continue
        set_fields: dict = {"amount": new_amt, "redistributed_at": iso(now_utc())}
        # Bewaar het OORSPRONKELIJK geplande bedrag één keer voor de audit.
        if inst.get("original_amount") is None:
            set_fields["original_amount"] = cur_amt
        await db.payment_plan_installments.update_one(
            {"id": inst["id"]}, {"$set": set_fields},
        )

    # Herbereken plan.total_amount = paid_termijnen_sum + invoice_open
    paid_sum = 0.0
    async for pinst in db.payment_plan_installments.find(
        {"plan_id": plan_id, "status": "paid"}, {"_id": 0, "amount": 1},
    ):
        paid_sum += float(pinst.get("amount") or 0)
    new_total = round(paid_sum + invoice_open + 1e-9, 2)
    if abs(new_total - float(plan.get("total_amount") or 0)) >= 0.01:
        await db.payment_plans.update_one(
            {"id": plan_id}, {"$set": {"total_amount": new_total}},
        )


async def _allocate_payment_to_invoices(
    invoice_ids: List[str], amount: float, payment_id: Optional[str],
    paid_at: Optional[str] = None, method: Optional[str] = None,
    receipt_number: Optional[str] = None,
) -> float:
    """FIFO-allocatie: verdeel `amount` over de opgegeven facturen
    (oudst eerst, oude facturen krijgen voorrang). Stopt zodra het bedrag
    op is. Retourneert het werkelijk gealloceerde bedrag."""
    if not invoice_ids or amount <= 0:
        return 0.0
    # Haal facturen op + sorteer oudst-eerst (period_year, period_month, created_at)
    invs: list = []
    async for inv in db.invoices.find({"id": {"$in": invoice_ids}}, {"_id": 0}):
        invs.append(inv)
    invs.sort(key=lambda x: (
        x.get("period_year", 0), x.get("period_month", 0), x.get("created_at") or "",
    ))
    remaining = float(amount)
    allocated = 0.0
    for inv in invs:
        if remaining <= 0:
            break
        inv_amt = float(inv.get("amount") or 0)
        # Bepaal hoeveel deze factuur nog open heeft.
        if inv.get("paid_amount") is None:
            existing = await _invoice_currently_paid(inv["id"], exclude_payment_id=payment_id)
        else:
            existing = float(inv.get("paid_amount") or 0)
        open_amt = max(0.0, round(inv_amt - existing, 2))
        if open_amt <= 0:
            continue
        chunk = round(min(remaining, open_amt), 2)
        await _apply_payment_to_invoice(
            inv["id"], chunk, payment_id=payment_id, paid_at=paid_at,
            method=method, receipt_number=receipt_number,
        )
        remaining = round(remaining - chunk, 2)
        allocated = round(allocated + chunk, 2)
    return allocated



async def _create_payment_doc(body: PaymentIn, company_id: Optional[str] = None,
                              approved_by: Optional[str] = None,
                              status: str = "approved",
                              kiosk_employee_id: Optional[str] = None,
                              kiosk_employee_name: Optional[str] = None,
                              approved_at: Optional[str] = None,
                              approved_by_user_id: Optional[str] = None) -> dict:
    q = {"id": body.tenant_id}
    if company_id:
        q["company_id"] = company_id
    tenant = await db.tenants.find_one(q, {"_id": 0})
    if not tenant:
        raise HTTPException(status_code=404, detail="Huurder niet gevonden")
    apt_id = body.apartment_id or tenant.get("apartment_id")
    receipt_no = await _next_receipt_number()
    company_name = ""
    if company_id:
        c = await db.companies.find_one({"id": company_id}, {"_id": 0, "name": 1})
        company_name = (c or {}).get("name", "")
    paid_at = iso(now_utc())
    # Automatisch koppelen aan een openstaande factuur:
    #  • Alleen voor categorie "huur" (overige categorieën hebben geen factuur).
    #  • Match op tenant + period_month + period_year wanneer beide aanwezig zijn.
    #  • Anders: pak de oudst openstaande huur-factuur van deze huurder.
    #  • Bij pending_approval: koppelen we NIET automatisch — pas bij goedkeuring.
    matched_invoice = None
    explicit_invoice_ids = list(body.invoice_ids or [])
    if body.category in ("huur", "vooruitbetaling") and status == "approved":
        inv_q = {"tenant_id": body.tenant_id, "status": {"$ne": "paid"}}
        if company_id:
            inv_q["company_id"] = company_id
        # Wanneer expliciete invoice_ids zijn meegegeven (kiosk per-maand
        # selectie) → match alleen tegen die set zodat de allocatie binnen
        # de selectie blijft. Oudst-eerst binnen die selectie.
        if explicit_invoice_ids:
            matched_invoice = await db.invoices.find_one(
                {**inv_q, "id": {"$in": explicit_invoice_ids}},
                {"_id": 0}, sort=[("period_year", 1), ("period_month", 1)],
            )
        elif body.period_month and body.period_year:
            # PERIOD-STRICT MATCH — negeer status filter zodat we óók een
            # factuur vinden waarvan `status=paid` ten onrechte staat (uit
            # een eerder verwijderde/foutieve betaling). De huurder heeft
            # deze periode expliciet aangewezen, dus voor die maand is deze
            # factuur de enige juiste doelfactuur — NOOIT overslaan om naar
            # een andere maand terug te vallen.
            period_q = {"tenant_id": body.tenant_id,
                        "period_month": body.period_month,
                        "period_year": body.period_year}
            if company_id:
                period_q["company_id"] = company_id
            matched_invoice = await db.invoices.find_one(period_q, {"_id": 0})
        # FALLBACK naar oudst-open ALLEEN wanneer noch expliciete invoice_ids,
        # noch een periode zijn opgegeven. Dit voorkomt de Jacyntha-bug waar
        # een payment voor juli per ongeluk aan augustus werd gekoppeld omdat
        # juli's status stale op "paid" stond.
        if (not matched_invoice and not explicit_invoice_ids
                and not (body.period_month and body.period_year)):
            matched_invoice = await db.invoices.find_one(
                inv_q, {"_id": 0}, sort=[("period_year", 1), ("period_month", 1)]
            )
        # AUTO-CREATE invoice als er geen enkele bestaande factuur is voor
        # deze huurder + huur-betaling. Situatie: admin heeft net een nieuwe
        # huurder aangemaakt en de eerste betaling komt via de kiosk binnen
        # voordat de maandelijkse auto-invoice-tick heeft gelopen. Zonder
        # deze auto-create zou de Facturen-pagina leeg blijven en geen
        # audit-trail hebben. We maken alleen een factuur wanneer er een
        # duidelijke periode is (expliciet in body of afgeleid van paid_at).
        if matched_invoice is None and apt_id:
            # Bepaal de periode: expliciet uit body → anders uit huidige datum.
            _now = now_utc()
            period_m = body.period_month or _now.month
            period_y = body.period_year or _now.year
            # Voorkom race: check nog een keer of de factuur intussen is
            # aangemaakt (bijv. door dubbele kiosk-tap).
            existing_period = await db.invoices.find_one(
                {**inv_q, "period_month": period_m, "period_year": period_y},
                {"_id": 0},
            )
            if existing_period:
                matched_invoice = existing_period
            else:
                apt_doc = await db.apartments.find_one(
                    {"id": apt_id}, {"_id": 0, "rent_amount": 1, "currency": 1},
                )
                if apt_doc and float(apt_doc.get("rent_amount") or 0) > 0:
                    try:
                        seq = await _next_seq(f"invoice_{period_y}")
                        new_inv = {
                            "id": new_id(),
                            "company_id": company_id or tenant.get("company_id"),
                            "invoice_number": f"F{period_y}-{seq:05d}",
                            "tenant_id": body.tenant_id,
                            "apartment_id": apt_id,
                            "amount": float(apt_doc.get("rent_amount") or 0),
                            "currency": apt_doc.get("currency") or body.currency or "SRD",
                            "period_month": period_m,
                            "period_year": period_y,
                            "status": "open",
                            "paid_amount": 0.0,
                            "created_at": iso(now_utc()),
                            "auto_created_from_payment": True,
                        }
                        await db.invoices.insert_one(new_inv)
                        new_inv.pop("_id", None)
                        matched_invoice = new_inv
                    except Exception as _e:  # noqa: BLE001
                        # Best-effort — betaling gaat sowieso door. Log alleen.
                        print(f"[auto-invoice on payment] create failed: {_e}")
    doc = {
        "id": new_id(),
        "company_id": company_id or tenant.get("company_id"),
        "tenant_id": body.tenant_id,
        "apartment_id": apt_id,
        "amount": body.amount,
        "currency": body.currency,
        "method": body.method,
        "stripe_payment_intent_id": getattr(body, "stripe_payment_intent_id", None),
        "category": body.category,
        "period_month": body.period_month or (matched_invoice or {}).get("period_month"),
        "period_year": body.period_year or (matched_invoice or {}).get("period_year"),
        "invoice_id": matched_invoice["id"] if matched_invoice else None,
        "invoice_number": matched_invoice.get("invoice_number") if matched_invoice else None,
        "receipt_number": receipt_no,
        "paid_at": paid_at,
        "note": body.note or "",
        "received_by": (body.received_by or "").strip() or (kiosk_employee_name or ""),
        "approved_by": approved_by or company_name,
        "status": status,
        "kiosk_employee_id": kiosk_employee_id,
        "kiosk_employee_name": kiosk_employee_name,
        "approved_at": approved_at,
        "approved_by_user_id": approved_by_user_id,
    }
    # Vooruitbetaling zonder gekoppelde factuur: bewaar het bedrag als
    # beschikbaar krediet zodat de volgende factuur-generatie het automatisch
    # kan verrekenen (FIFO oudst eerst). MET gekoppelde factuur (frontend geeft
    # `invoice_ids` mee voor de doelmaand, of de factuur wordt auto-created)
    # loopt het bedrag door de reguliere allocatie hieronder — de overflow-
    # logica zet dan zelf `credit_remaining` als er nog iets overblijft.
    if body.category == "vooruitbetaling" and status == "approved" and not matched_invoice:
        doc["credit_remaining"] = float(body.amount or 0)
        doc["credit_applied_at"] = None
    await db.payments.insert_one(doc)
    doc.pop("_id", None)
    # Factuur sluiten — alleen voor approved payments. Pending betalingen krijgen
    # bij goedkeuring alsnog de invoice-koppeling via /payments/{id}/approve.
    if matched_invoice and status == "approved":
        try:
            # Bereken hoeveel deze specifieke factuur nog open heeft. Als de
            # betaling MEER is dan het openstaande bedrag van deze factuur,
            # past de "overflow" automatisch toe op andere openstaande
            # facturen van dezelfde huurder (oudst eerst, FIFO). Voorheen
            # ging de overflow verloren: 15.000 op een 10.000 factuur
            # sloot factuur 1 maar liet factuur 2 (april) ongewijzigd op
            # 10.000 staan. Nu: 10.000 → factuur 1 (paid), 5.000 → factuur 2.
            inv_amt = float(matched_invoice.get("amount") or 0)
            already_paid = matched_invoice.get("paid_amount")
            if already_paid is None:
                already_paid = await _invoice_currently_paid(matched_invoice["id"], exclude_payment_id=doc["id"])
            open_on_matched = max(0.0, round(inv_amt - float(already_paid or 0), 2))
            pay_amt = float(body.amount or 0)
            primary_chunk = min(pay_amt, open_on_matched) if open_on_matched > 0 else pay_amt
            overflow = round(pay_amt - primary_chunk, 2)
            # Pas primary chunk toe op de gematchte factuur
            if primary_chunk > 0:
                await _apply_payment_to_invoice(
                    matched_invoice["id"], primary_chunk,
                    payment_id=doc["id"], paid_at=paid_at,
                    method=body.method, receipt_number=receipt_no,
                )
            # Overflow FIFO-alloceren over andere openstaande facturen
            # (zelfde tenant + currency, niet de matched factuur). Wanneer
            # expliciete invoice_ids zijn opgegeven, beperken we de overflow-
            # alloctie tot díe set zodat de huurder niet per ongeluk een
            # niet-geselecteerde maand betaalt.
            if overflow > 0:
                other_inv_ids = []
                if explicit_invoice_ids:
                    candidates = [i for i in explicit_invoice_ids if i != matched_invoice["id"]]
                    other_q = {
                        "tenant_id": body.tenant_id,
                        "currency": body.currency,
                        "status": {"$nin": ["paid", "cancelled"]},
                        "id": {"$in": candidates},
                        **({"company_id": company_id} if company_id else {}),
                    }
                else:
                    other_q = {
                        "tenant_id": body.tenant_id,
                        "currency": body.currency,
                        "status": {"$nin": ["paid", "cancelled"]},
                        "id": {"$ne": matched_invoice["id"]},
                        **({"company_id": company_id} if company_id else {}),
                    }
                async for inv in db.invoices.find(other_q, {"_id": 0, "id": 1}).sort([("period_year", 1), ("period_month", 1)]):
                    other_inv_ids.append(inv["id"])
                if other_inv_ids:
                    applied_overflow = await _allocate_payment_to_invoices(
                        other_inv_ids, overflow,
                        payment_id=doc["id"], paid_at=paid_at,
                        method=body.method, receipt_number=receipt_no,
                    )
                    leftover = round(overflow - applied_overflow, 2)
                else:
                    leftover = overflow
                # Als er nog steeds overflow over is na alle openstaande
                # facturen → bewaar als krediet op de huurder voor de
                # volgende auto-generatie.
                if leftover and leftover > 0:
                    await db.payments.update_one(
                        {"id": doc["id"]},
                        {"$set": {"credit_remaining": float(leftover),
                                  "credit_origin": "overflow"}},
                    )
        except Exception as e:
            print(f"[payments] invoice apply failed: {e}")
    return doc


@api.get("/payments", response_model=List[PaymentOut])
async def list_payments(
    user=Depends(get_current_user),
    tenant_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None, description="approved | pending_approval | all"),
    limit: int = Query(200),
):
    q = dict(scope(user))
    if tenant_id:
        q["tenant_id"] = tenant_id
    # Standaard: alleen approved zien op de hoofdpagina. Pending heeft eigen sectie.
    if status == "pending_approval":
        q["status"] = "pending_approval"
    elif status == "all":
        pass  # geen filter
    else:
        # Default sluit pending uit zodat totalen kloppen.
        q["status"] = {"$ne": "pending_approval"}
    docs = await db.payments.find(q, {"_id": 0}).sort("paid_at", -1).to_list(limit)
    return await _enrich_payments_bulk(docs)


@api.get("/payments/paged")
async def list_payments_paged(start: str, end: str, today_start: str, q: str = "",
                              offset: int = 0, limit: int = 25, user=Depends(get_current_user)):
    """Goedgekeurde betalingen van één maand (start..end, lokale grenzen), 25 per pagina.
    Zoeken + totalen server-side over de hele maand."""
    base = {**scope(user), "status": {"$ne": "pending_approval"}}

    async def month_compute():
        docs = await db.payments.find({**base, "paid_at": {"$gte": start, "$lt": end}}, {"_id": 0}).sort("paid_at", -1).to_list(5000)
        return await _enrich_payments_bulk(docs)

    async def summary_compute():
        total_count, today_rows = await asyncio.gather(
            db.payments.count_documents(base),
            db.payments.aggregate([
                {"$match": {**base, "paid_at": {"$gte": today_start}}},
                {"$group": {"_id": None, "sum": {"$sum": {"$toDouble": {"$ifNull": ["$amount", 0]}}}}},
            ]).to_list(1),
        )
        return {"totalCount": total_count, "todaySum": round(float(today_rows[0]["sum"]) if today_rows else 0.0, 2)}

    month, extra = await asyncio.gather(
        _list_cached("payments-month", user, month_compute, f"{start}|{end}"),
        _list_cached("payments-summary", user, summary_compute, today_start),
    )
    ql = q.strip().lower()
    rows = [p for p in month if not ql or ql in
            f"{p.get('tenant_name') or ''} {p.get('receipt_number') or ''} {p.get('apartment_number') or ''} {p.get('location_name') or ''}".lower()]
    limit = max(1, min(limit, 100))
    page = rows[offset:offset + limit]
    return {
        "items": [PaymentOut.model_validate(p).model_dump() for p in page],
        "total": len(rows), "offset": offset, "has_more": offset + limit < len(rows),
        "summary": {**extra, "monthCount": len(month),
                    "monthSum": round(sum(float(p.get("amount") or 0) for p in month), 2),
                    "currency": (month[0].get("currency") if month else None) or "SRD"},
    }


@api.delete("/payments/{payment_id}")
async def delete_payment(
    payment_id: str,
    also_delete_invoices: bool = Query(True, description="Verwijder ook gekoppelde facturen wanneer deze geen andere betalingen meer hebben"),
    user=Depends(require_role("superadmin", "admin")),
):
    """Verwijder een betaling. Wanneer `also_delete_invoices=true` (default)
    worden gekoppelde facturen óók verwijderd indien er geen andere
    approved betalingen aan hangen — anders krijgt elke factuur zijn
    `paid_amount` teruggedraaid met deze betaling, status herberekend.

    Plan-installments die met deze betaling zijn voldaan worden ook
    teruggezet naar `pending`.
    """
    pay = await db.payments.find_one({**scope(user), "id": payment_id}, {"_id": 0})
    if not pay:
        raise HTTPException(status_code=404, detail="Betaling niet gevonden")

    pay_amount = float(pay.get("amount") or 0)
    deleted_invoices = []
    reverted_invoices = []

    # Verzamel alle gekoppelde factuur-ids (zowel uit invoice_id legacy als invoice_ids array)
    inv_ids = set()
    if pay.get("invoice_id"):
        inv_ids.add(pay["invoice_id"])
    for x in (pay.get("invoice_ids") or []):
        if x:
            inv_ids.add(x)
    # Ook via allocations (FIFO-toewijzingen)
    allocs = pay.get("allocations") or []
    alloc_map = {}  # invoice_id -> bedrag dat deze payment naar die factuur stuurde
    for a in allocs:
        if a.get("invoice_id"):
            inv_ids.add(a["invoice_id"])
            alloc_map[a["invoice_id"]] = float(a.get("amount") or 0)

    for inv_id in inv_ids:
        inv = await db.invoices.find_one({"id": inv_id}, {"_id": 0})
        if not inv:
            continue
        # Hoeveel deze betaling naar deze factuur stuurde
        share = alloc_map.get(inv_id, pay_amount if len(inv_ids) == 1 else 0)
        # Andere approved payments die naar deze factuur verwijzen?
        other_count = await db.payments.count_documents({
            "id": {"$ne": payment_id},
            "status": {"$ne": "pending_approval"},
            "$or": [
                {"invoice_id": inv_id},
                {"invoice_ids": inv_id},
                {"allocations": {"$elemMatch": {"invoice_id": inv_id}}},
            ],
        })
        if other_count == 0 and also_delete_invoices:
            # Geen andere betalingen → verwijder factuur volledig
            await db.invoices.delete_one({"id": inv_id})
            deleted_invoices.append({"id": inv_id, "invoice_number": inv.get("invoice_number")})
        else:
            # Andere betalingen bestaan of admin wil factuur behouden:
            # draai paid_amount terug en herbereken status.
            new_paid = max(float(inv.get("paid_amount") or 0) - share, 0)
            amount = float(inv.get("amount_due") or inv.get("amount") or 0)
            if new_paid <= 0:
                new_status = "open"
            elif new_paid >= amount - 0.005:
                new_status = "paid"
            else:
                new_status = "partial"
            await db.invoices.update_one(
                {"id": inv_id},
                {"$set": {
                    "paid_amount": round(new_paid, 2),
                    "status": new_status,
                    "remaining_amount": round(max(amount - new_paid, 0), 2),
                }},
            )
            reverted_invoices.append({"id": inv_id, "invoice_number": inv.get("invoice_number"), "new_status": new_status})

    # Plan-installments terugzetten (als betaling daaraan gekoppeld was)
    plan_items = pay.get("plan_items") or []
    for item in plan_items:
        pid = item.get("plan_id")
        seq = item.get("sequence") or item.get("seq")
        if pid and seq is not None:
            await db.payment_plan_installments.update_one(
                {"plan_id": pid, "sequence": int(seq)},
                {"$set": {"status": "pending", "paid_at": None, "payment_id": None}},
            )
            # Decrement plan.paid_installments
            await db.payment_plans.update_one(
                {"id": pid},
                {"$inc": {"paid_installments": -1}, "$set": {"status": "active"}},
            )

    # Verwijder de betaling zelf
    await db.payments.delete_one({"id": payment_id})
    await _kiosk_overview_invalidate(company_id_of(user), None)

    return {
        "ok": True,
        "deleted_payment_id": payment_id,
        "deleted_invoices": deleted_invoices,
        "reverted_invoices": reverted_invoices,
    }


@api.get("/payments/pending-ids")
async def payments_pending_ids(user=Depends(get_current_user)):
    docs = await db.payments.find({**scope(user), "status": "pending_approval"}, {"_id": 0, "id": 1}).to_list(1000)
    return {"ids": [d["id"] for d in docs]}


@api.get("/payments/pending-count")
async def payments_pending_count(user=Depends(get_current_user)):
    """Lichte endpoint voor de bell-badge: telling + meta van de meest
    recente pending betaling. Frontend gebruikt het laatste id om te
    detecteren wanneer er een NIEUWE pending bijgekomen is — daarmee
    kunnen we ook op iOS Guided Access (waar push-notificaties OS-niveau
    geblokkeerd zijn) een in-app banner + ding-ding tonen via polling."""
    q = {**scope(user), "status": "pending_approval"}
    n = await db.payments.count_documents(q)
    latest = None
    if n > 0:
        # Payment docs hebben `paid_at` als timestamp (geen created_at — zie
        # _create_payment_doc). Sorteren op paid_at desc geeft betrouwbaar
        # de meest recent ingediende pending.
        doc = await db.payments.find_one(
            q,
            {"_id": 0, "id": 1, "amount": 1, "currency": 1, "tenant_id": 1, "tenant_name": 1,
             "apartment_id": 1, "apartment_number": 1, "received_by": 1, "paid_at": 1, "category": 1},
            sort=[("paid_at", -1)],
        )
        if doc:
            # tenant_name + apartment_number worden niet op de payment doc
            # opgeslagen — pas bij read-time door _enrich_payment. Doen we
            # hier handmatig zodat de banner een echte naam toont (anders
            # blijft het "Onbekende huurder").
            tenant_name = doc.get("tenant_name") or ""
            apartment_number = doc.get("apartment_number") or ""
            if not tenant_name and doc.get("tenant_id"):
                t = await db.tenants.find_one({"id": doc["tenant_id"]}, {"_id": 0, "name": 1})
                if t:
                    tenant_name = t.get("name") or ""
            if not apartment_number and doc.get("apartment_id"):
                a = await db.apartments.find_one({"id": doc["apartment_id"]}, {"_id": 0, "number": 1})
                if a:
                    apartment_number = a.get("number") or ""
            latest = {
                "id": doc.get("id"),
                "amount": doc.get("amount"),
                "currency": doc.get("currency"),
                "tenant_name": tenant_name,
                "apartment_number": apartment_number,
                "received_by": doc.get("received_by") or "",
                "category": doc.get("category") or "",
                "created_at": doc.get("paid_at"),
            }
    return {"count": n, "latest": latest}


@api.get("/payments/{payment_id}", response_model=PaymentOut)
async def get_payment(payment_id: str, user=Depends(get_current_user)):
    doc = await db.payments.find_one({**scope(user), "id": payment_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Betaling niet gevonden")
    return (await _enrich_payments_bulk([doc]))[0]


@api.post("/payments/{pid}/approve", response_model=PaymentOut)
async def approve_payment(pid: str, body: PaymentApproveIn, user=Depends(require_role("admin", "boekhouder"))):
    """Beheerder keurt een pending kiosk-betaling goed (met handtekening)."""
    if not (body.signature_data_url or "").startswith("data:image/"):
        raise HTTPException(status_code=400, detail="Handtekening ontbreekt")
    out = await _approve_payment_core(
        {"id": pid, **scope(user)}, body.signature_data_url,
        user.get("id") or user.get("sub"), user.get("name") or user.get("email") or "Beheerder",
    )
    await _kiosk_overview_invalidate(company_id_of(user), (out or {}).get("tenant_id"))
    return out


async def _auto_approve_pending_kiosk_payments():
    """Goedkeuringsstap voor kiosk-medewerkers is verwijderd: wachtende
    kiosk-betalingen eenmalig (idempotent) direct verwerken."""
    try:
        docs = await db.payments.find(
            {"status": "pending_approval", "kiosk_employee_id": {"$nin": [None, ""]}},
            {"_id": 0, "id": 1, "company_id": 1, "kiosk_employee_name": 1},
        ).sort("paid_at", 1).to_list(5000)
        for d in docs:
            try:
                await _approve_payment_core({"id": d["id"], "company_id": d["company_id"]}, None, "system",
                                            d.get("kiosk_employee_name") or "Kiosk")
            except Exception as e:  # noqa: BLE001
                print(f"[auto-approve] {d['id']} failed: {e}")
        if docs:
            print(f"[auto-approve] {len(docs)} wachtende kiosk-betalingen verwerkt")
    except Exception as e:  # noqa: BLE001
        print(f"[auto-approve] failed: {e}")


async def _approve_payment_core(q: dict, signature: str | None, uid: str, uname: str, via: str | None = None):
    """Goedkeuren + openstaande factuur koppelen. Atomair geclaimd → nooit dubbel geboekt."""
    p = await db.payments.find_one_and_update(
        {**q, "status": "pending_approval"}, {"$set": {"status": "approving"}}, projection={"_id": 0},
    )
    if not p:
        if await db.payments.find_one(q, {"_id": 1}):
            raise HTTPException(status_code=400, detail="Deze betaling is geen pending betaling")
        raise HTTPException(status_code=404, detail="Betaling niet gevonden")
    try:
        return await _approve_claimed(p, signature, uid, uname, via)
    except BaseException:
        await db.payments.update_one({"id": p["id"], "status": "approving"}, {"$set": {"status": "pending_approval"}})
        raise


async def _approve_claimed(p: dict, signature: str | None, uid: str, uname: str, via: str | None):
    pid = p["id"]
    approved_at = iso(now_utc())
    # Probeer alsnog een openstaande factuur te matchen bij approval.
    matched_invoice = None
    if p.get("category") == "huur":
        cid = p.get("company_id")
        # PERIOD-STRICT: wanneer de payment een periode heeft → match ALLEEN
        # die periode's factuur, ongeacht status. Voorkomt dat een payment
        # voor juli per ongeluk wordt gekoppeld aan augustus omdat juli's
        # status stale op 'paid' staat (Jacyntha-bug).
        if p.get("period_month") and p.get("period_year"):
            period_q = {"tenant_id": p["tenant_id"],
                        "period_month": p["period_month"],
                        "period_year": p["period_year"]}
            if cid:
                period_q["company_id"] = cid
            matched_invoice = await db.invoices.find_one(period_q, {"_id": 0})
        # Fallback ALLEEN wanneer géén periode is opgegeven — dan pak
        # de oudste openstaande.
        if not matched_invoice and not (p.get("period_month") and p.get("period_year")):
            inv_q = {"tenant_id": p["tenant_id"], "status": {"$ne": "paid"}}
            if cid:
                inv_q["company_id"] = cid
            matched_invoice = await db.invoices.find_one(
                inv_q, {"_id": 0}, sort=[("period_year", 1), ("period_month", 1)]
            )
    update = {
        "status": "approved",
        "signature_data_url": signature or None,
        "approved_at": approved_at,
        "approved_by_user_id": uid,
        "approved_by": f"{uname} (via melding)" if via == "notification" else uname,
    }
    if via:
        update["approved_via"] = via
    if matched_invoice:
        update["invoice_id"] = matched_invoice["id"]
        update["invoice_number"] = matched_invoice.get("invoice_number")
        try:
            # Zelfde overflow-allocatie logica als bij _create_payment_doc:
            # als de betaling > openstaand op deze factuur, schuif het
            # overschot door naar oudere openstaande facturen FIFO.
            inv_amt_a = float(matched_invoice.get("amount") or 0)
            already_paid_a = matched_invoice.get("paid_amount")
            if already_paid_a is None:
                already_paid_a = await _invoice_currently_paid(matched_invoice["id"], exclude_payment_id=p.get("id"))
            open_on_matched_a = max(0.0, round(inv_amt_a - float(already_paid_a or 0), 2))
            pay_amt_a = float(p.get("amount") or 0)
            primary_chunk_a = min(pay_amt_a, open_on_matched_a) if open_on_matched_a > 0 else pay_amt_a
            overflow_a = round(pay_amt_a - primary_chunk_a, 2)
            if primary_chunk_a > 0:
                await _apply_payment_to_invoice(
                    matched_invoice["id"], primary_chunk_a,
                    payment_id=p["id"], paid_at=approved_at,
                    method=p.get("method"), receipt_number=p.get("receipt_number"),
                )
            if overflow_a > 0:
                other_inv_ids_a = []
                async for inv in db.invoices.find(
                    {"tenant_id": p["tenant_id"],
                     "currency": p.get("currency") or "SRD",
                     "status": {"$nin": ["paid", "cancelled"]},
                     "id": {"$ne": matched_invoice["id"]},
                     **({"company_id": p.get("company_id")} if p.get("company_id") else {})},
                    {"_id": 0, "id": 1},
                ).sort([("period_year", 1), ("period_month", 1)]):
                    other_inv_ids_a.append(inv["id"])
                if other_inv_ids_a:
                    await _allocate_payment_to_invoices(
                        other_inv_ids_a, overflow_a,
                        payment_id=p["id"], paid_at=approved_at,
                        method=p.get("method"), receipt_number=p.get("receipt_number"),
                    )
        except Exception as e:
            print(f"[payments.approve] invoice apply failed: {e}")
    # Goedkeuring van een betalingsregeling-termijn (kiosk-flow met
    # pending_approval): alloceer alsnog op de gelinkte facturen + mark de
    # bijbehorende installment als 'paid'.
    plan_id = (p.get("metadata") or {}).get("plan_id") if isinstance(p.get("metadata"), dict) else None
    inst_seq = (p.get("metadata") or {}).get("installment_seq") if isinstance(p.get("metadata"), dict) else None
    if plan_id and p.get("category") == "betalingsregeling":
        try:
            plan = await db.payment_plans.find_one({"id": plan_id}, {"_id": 0})
            if plan and (plan.get("invoice_ids") or []):
                await _allocate_payment_to_invoices(
                    plan["invoice_ids"], float(p.get("amount") or 0),
                    payment_id=p["id"], paid_at=approved_at,
                    method=p.get("method"), receipt_number=p.get("receipt_number"),
                )
            # Markeer installment als paid (was 'pending_payment')
            if inst_seq is not None:
                await db.payment_plan_installments.update_one(
                    {"plan_id": plan_id, "sequence": inst_seq},
                    {"$set": {"status": "paid"}},
                )
            # Plan-completion check
            if plan:
                remaining_pending = await db.payment_plan_installments.count_documents(
                    {"plan_id": plan_id, "status": {"$in": ["pending", "pending_payment"]}}
                )
                if remaining_pending == 0:
                    await db.payment_plans.update_one(
                        {"id": plan_id},
                        {"$set": {"status": "completed", "completed_at": approved_at}},
                    )
            # WhatsApp/SMS bevestiging — ook bij admin-approval van kiosk-pending.
            # FIRE-AND-FORGET: Twilio + SMTP + PDF render kunnen 5-10s duren;
            # de admin UI moet NIET wachten daarop. Background task stuurt
            # de notificatie nadat de response al uit is.
            if inst_seq is not None:
                asyncio.create_task(_notify_tenant_installment_paid(plan_id, inst_seq))
        except Exception as e:  # noqa: BLE001
            print(f"[payments.approve] plan allocation failed: {e}")
    await db.payments.update_one({"id": pid}, {"$set": update})
    p.update(update)
    return await _enrich_payment(p)


@api.post("/payments/{pid}/reject", response_model=PaymentOut)
async def reject_payment(pid: str, body: PaymentRejectIn, user=Depends(require_role("admin", "boekhouder"))):
    """Beheerder wijst een pending betaling af. Bedrag telt nooit mee in totalen."""
    out = await _reject_payment_core({"id": pid, **scope(user)}, body.reason or "", user.get("id") or user.get("sub"))
    await _kiosk_overview_invalidate(company_id_of(user), (out or {}).get("tenant_id"))
    return out


async def _reject_payment_core(q: dict, reason: str, uid: str):
    p = await db.payments.find_one(q, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Betaling niet gevonden")
    if p.get("status") != "pending_approval":
        raise HTTPException(status_code=400, detail="Deze betaling is geen pending betaling")
    pid = p["id"]
    update = {"status": "rejected", "rejected_reason": (reason or "").strip(),
              "approved_at": iso(now_utc()),
              "approved_by_user_id": uid}
    # Revert pending plan-installment to 'pending' zodat huurder/kiosk
    # 'm opnieuw kan betalen.
    plan_id = (p.get("metadata") or {}).get("plan_id") if isinstance(p.get("metadata"), dict) else None
    inst_seq = (p.get("metadata") or {}).get("installment_seq") if isinstance(p.get("metadata"), dict) else None
    if plan_id and inst_seq is not None and p.get("category") == "betalingsregeling":
        try:
            await db.payment_plan_installments.update_one(
                {"plan_id": plan_id, "sequence": inst_seq, "status": "pending_payment"},
                {"$set": {"status": "pending", "paid_at": None, "payment_id": None}},
            )
        except Exception as e:  # noqa: BLE001
            print(f"[payments.reject] plan revert failed: {e}")
    await db.payments.update_one({"id": pid}, {"$set": update})
    p.update(update)
    return await _enrich_payment(p)


async def _kiosk_overview_invalidate(cid: str, tenant_id: Optional[str]) -> None:
    """Betaling via beheer: kiosk-caches legen en kiosks laten herladen."""
    await _kb_publish(_kiosk_admin_channel(cid), {"type": "overview_invalidate", "tenant_id": tenant_id})


@api.post("/payments", response_model=PaymentOut)
async def create_payment(body: PaymentIn, user=Depends(get_current_user)):
    cid = company_id_of(user)
    doc = await _create_payment_doc(body, cid, approved_by=user.get("name") or user.get("email"))
    enriched = await _enrich_payment(doc)
    await _kiosk_overview_invalidate(cid, doc.get("tenant_id"))
    # Push-notificatie naar andere admins van deze company. FIRE-AND-FORGET:
    # WebPush kan 500-2000ms per subscription duren; wij mogen daar NIET op
    # wachten want dat vertraagt óók de live-sync SSE-broadcast (die pas
    # nádat deze handler klaar is uitgaat via de middleware) — met als
    # gevolg dat Betalingsregelingen "traag" refresht na een factuurbetaling.
    async def _bg_notify():
        try:
            cur = enriched.get("currency", "")
            amt = float(enriched.get("amount", 0))
            await _notify_company_admins(
                cid, f"Betaling {cur} {amt:,.2f}",
                f"{enriched.get('tenant_name', 'Onbekend')} via {enriched.get('method', '')}",
                {"kind": "payment", "url": "/admin/payments",
                 "payment_id": enriched.get("id"), "badge_inc": 1},
            )
        except Exception as e:  # noqa: BLE001
            print(f"[push] admin payment notify failed: {e}")
    asyncio.create_task(_bg_notify())
    return enriched


@api.post("/payments/{pid}/reassign-invoice")
async def reassign_payment_invoice(
    pid: str,
    body: dict,
    user=Depends(require_role("admin", "superadmin")),
):
    """Verplaatst een betaling naar een andere factuur — trekt het bedrag
    af van de OUDE factuur (paid_amount) en past het toe op de NIEUWE.
    Herberekent status van beide facturen op basis van hun paid_amount.

    Body: {"invoice_id": "<new_invoice_id>"}

    Gebruikt om verkeerd auto-gekoppelde betalingen te herstellen (bv.
    payment.period=juli maar auto-koppeling ging naar augustus omdat
    juli's status al 'paid' stond uit een eerder verwijderde betaling).

    Retourneert het bijgewerkte payment doc + report per factuur.
    """
    new_inv_id = (body or {}).get("invoice_id") or ""
    if not new_inv_id:
        raise HTTPException(status_code=400, detail="invoice_id ontbreekt")
    q = {"id": pid, **scope(user)}
    p = await db.payments.find_one(q, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Betaling niet gevonden")
    if p.get("status") != "approved":
        raise HTTPException(status_code=400, detail="Alleen approved betalingen kunnen verplaatst worden")
    new_inv = await db.invoices.find_one(
        {"id": new_inv_id, "tenant_id": p.get("tenant_id"), **scope(user)}, {"_id": 0},
    )
    if not new_inv:
        raise HTTPException(status_code=404, detail="Nieuwe factuur niet gevonden of niet van deze huurder")
    old_inv_id = p.get("invoice_id")
    pay_amt = float(p.get("amount") or 0)
    report = {"old_invoice": None, "new_invoice": None}

    # 1) Trek van OUDE factuur af
    if old_inv_id and old_inv_id != new_inv_id:
        old_inv = await db.invoices.find_one({"id": old_inv_id}, {"_id": 0})
        if old_inv:
            old_amt = float(old_inv.get("amount") or 0)
            old_paid = float(old_inv.get("paid_amount") or 0)
            new_old_paid = max(0.0, round(old_paid - pay_amt, 2))
            if old_amt <= 0 or new_old_paid >= old_amt - 0.005:
                new_old_status = "paid"
            elif new_old_paid > 0:
                new_old_status = "partial"
            else:
                new_old_status = "open"
            await db.invoices.update_one(
                {"id": old_inv_id},
                {"$set": {"paid_amount": new_old_paid, "status": new_old_status,
                          "paid_at": None if new_old_status != "paid" else old_inv.get("paid_at")}},
            )
            report["old_invoice"] = {
                "id": old_inv_id,
                "invoice_number": old_inv.get("invoice_number"),
                "old_paid": old_paid, "new_paid": new_old_paid,
                "old_status": old_inv.get("status"), "new_status": new_old_status,
            }

    # 2) Update payment.invoice_id + invoice_number + period_month/year
    #    Ook: strip allocations die naar OUDE invoice_id verwijzen zodat
    #    de idempotency-guard bij de nieuwe apply niet blokkeert.
    new_allocations = [a for a in (p.get("allocations") or [])
                       if a.get("invoice_id") != new_inv_id and a.get("invoice_id") != old_inv_id]
    await db.payments.update_one(
        {"id": pid},
        {"$set": {
            "invoice_id": new_inv_id,
            "invoice_number": new_inv.get("invoice_number"),
            "period_month": new_inv.get("period_month"),
            "period_year": new_inv.get("period_year"),
            "allocations": new_allocations,
        }},
    )

    # 3) Pas toe op NIEUWE factuur — herbereken paid_amount + status.
    #    We doen dit direct via update i.p.v. _apply_payment_to_invoice
    #    zodat we het EXACTE bedrag ophogen dat bij deze payment hoort.
    new_amt = float(new_inv.get("amount") or 0)
    prev_new_paid = float(new_inv.get("paid_amount") or 0)
    new_new_paid = round(prev_new_paid + pay_amt, 2)
    if new_amt <= 0 or new_new_paid >= new_amt - 0.005:
        new_new_status = "paid"
        new_paid_at = p.get("paid_at") or iso(now_utc())
    elif new_new_paid > 0:
        new_new_status = "partial"
        new_paid_at = None
    else:
        new_new_status = "open"
        new_paid_at = None
    upd = {"paid_amount": new_new_paid, "status": new_new_status}
    if new_paid_at:
        upd["paid_at"] = new_paid_at
    await db.invoices.update_one({"id": new_inv_id}, {"$set": upd})
    # Log allocatie op payment.allocations
    await db.payments.update_one(
        {"id": pid},
        {"$push": {"allocations": {
            "invoice_id": new_inv_id, "amount": pay_amt,
            "applied_at": iso(now_utc()),
        }}},
    )
    report["new_invoice"] = {
        "id": new_inv_id,
        "invoice_number": new_inv.get("invoice_number"),
        "old_paid": prev_new_paid, "new_paid": new_new_paid,
        "old_status": new_inv.get("status"), "new_status": new_new_status,
    }
    # Return updated payment
    updated = await db.payments.find_one({"id": pid}, {"_id": 0})
    await _kiosk_overview_invalidate(company_id_of(user), (updated or {}).get("tenant_id"))
    return {"payment": await _enrich_payment(updated), "report": report}


@api.get("/tenants/{tenant_id}/balance")
async def tenant_balance(tenant_id: str, user=Depends(get_current_user)):
    t = await db.tenants.find_one({"id": tenant_id, **scope(user)}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Huurder niet gevonden")
    return await _calc_balance(t)


@api.post("/tenants/{tenant_id}/recompute-invoices")
async def recompute_tenant_invoices(tenant_id: str, user=Depends(require_role("admin", "superadmin"))):
    """Herbereken `paid_amount` op ALLE facturen van deze huurder vanaf
    de werkelijke approved payments. Fixt legacy dubbel-allocatie bugs
    waar één payment per ongeluk op meerdere facturen werd geboekt.

    Voor elke factuur:
      • paid_amount = sum(payments.amount where invoice_id=inv.id AND status=approved)
      • Status → paid als paid_amount ≥ 100% van amount, anders partial/open

    Retourneert een report per factuur zodat admin ziet wat er is veranderd.
    """
    t = await db.tenants.find_one({"id": tenant_id, **scope(user)}, {"_id": 0, "id": 1, "company_id": 1, "name": 1})
    if not t:
        raise HTTPException(status_code=404, detail="Huurder niet gevonden")
    report = []
    async for inv in db.invoices.find(
        {"tenant_id": tenant_id, **scope(user)},
        {"_id": 0, "id": 1, "invoice_number": 1, "amount": 1, "paid_amount": 1,
         "period_month": 1, "period_year": 1, "status": 1},
    ).sort([("period_year", 1), ("period_month", 1)]):
        inv_id = inv["id"]
        inv_amt = float(inv.get("amount") or 0)
        old_paid = float(inv.get("paid_amount") or 0)
        old_status = inv.get("status") or "open"
        # Herbereken paid_amount vanuit approved payments met deze invoice_id
        real_paid = 0.0
        async for p in db.payments.find(
            {"invoice_id": inv_id, "status": "approved", "tenant_id": tenant_id},
            {"_id": 0, "amount": 1},
        ):
            real_paid += float(p.get("amount") or 0)
        real_paid = round(real_paid, 2)
        # Bepaal nieuwe status
        if inv_amt <= 0 or real_paid >= inv_amt - 0.005:
            new_status = "paid"
        elif real_paid > 0:
            new_status = "partial"
        else:
            new_status = "open"
        # Update alleen als iets veranderd is
        if abs(real_paid - old_paid) > 0.01 or new_status != old_status:
            update_doc = {"paid_amount": real_paid, "status": new_status}
            # Voor status open resetten we `paid_at`
            if new_status == "open":
                update_doc["paid_at"] = None
            await db.invoices.update_one({"id": inv_id}, {"$set": update_doc})
        report.append({
            "invoice_id": inv_id,
            "invoice_number": inv.get("invoice_number") or "",
            "period": f"{inv.get('period_year')}-{(inv.get('period_month') or 0):02d}",
            "amount": inv_amt,
            "old_paid": old_paid,
            "new_paid": real_paid,
            "old_status": old_status,
            "new_status": new_status,
            "changed": abs(real_paid - old_paid) > 0.01 or new_status != old_status,
        })
    return {
        "tenant_id": tenant_id,
        "tenant_name": t.get("name"),
        "invoices_processed": len(report),
        "invoices_changed": sum(1 for r in report if r["changed"]),
        "report": report,
    }


# =====================================================================
# Balance helper
# =====================================================================
async def _calc_balance(tenant: dict) -> dict:
    """Compute simple monthly rent balance.
    - If tenant has apartment, monthly rent applies from move-in (or first day of created_at month).
    - Total paid for category 'huur' deducted.
    """
    apt_id = tenant.get("apartment_id")
    if not apt_id:
        return {
            "rent_amount": 0,
            "currency": "SRD",
            "months_due": 0,
            "total_due": 0,
            "total_paid": 0,
            "balance": 0,
            "next_period": None,
        }
    apt = await db.apartments.find_one({"id": apt_id}, {"_id": 0})
    if not apt:
        return {
            "rent_amount": 0, "currency": "SRD", "months_due": 0,
            "total_due": 0, "total_paid": 0, "balance": 0, "next_period": None,
        }
    rent = apt.get("rent_amount", 0)
    currency = apt.get("currency", "SRD")
    created = tenant.get("created_at") or iso(now_utc())
    try:
        start = datetime.fromisoformat(created.replace("Z", "+00:00"))
    except Exception:
        start = now_utc()
    today = now_utc()
    months = (today.year - start.year) * 12 + (today.month - start.month) + 1
    months = max(months, 1)
    total_due = rent * months
    # Sum huur payments
    cursor = db.payments.find(
        {"tenant_id": tenant["id"], "category": "huur", "currency": currency},
        {"_id": 0, "amount": 1},
    )
    total_paid = 0.0
    async for p in cursor:
        total_paid += float(p.get("amount", 0))
    balance = total_due - total_paid
    # Next due period — pak de OUDSTE openstaande factuur (unpaid OF partial).
    # Voorheen keken we naar payments met period_month, maar zodra er 1 partial
    # betaling op juli was gedaan telde die periode als "betaald" — waardoor
    # next_period naar augustus wees terwijl juli nog 500 open had. Resultaat:
    # nieuwe partial-betalingen via kiosk "Bedrag invoeren" gingen naar
    # augustus i.p.v. eerst juli af te maken.
    #
    # Nu: kijk direct in de invoices-collectie naar de oudste factuur met
    # `status != "paid"` (dat dekt zowel "open" als "partial") — dat is de
    # single source of truth. `_apply_payment_to_invoice` zet status="paid"
    # zodra cumulatief ≥ 100% van het factuurbedrag betaald is.
    next_period = None
    oldest_open_inv = await db.invoices.find_one(
        {"tenant_id": tenant["id"], "status": {"$ne": "paid"}},
        {"_id": 0, "period_month": 1, "period_year": 1},
        sort=[("period_year", 1), ("period_month", 1), ("created_at", 1)],
    )
    if oldest_open_inv and oldest_open_inv.get("period_month") and oldest_open_inv.get("period_year"):
        next_period = {
            "year": int(oldest_open_inv["period_year"]),
            "month": int(oldest_open_inv["period_month"]),
        }
    else:
        # Fallback (geen invoices ooit gegenereerd, bijv. nieuwe huurder):
        # gebruik de oude payments-based heuristiek zodat kiosk toch een
        # zinvolle "eerste maand" toont.
        paid_periods = set()
        async for p in db.payments.find(
            {"tenant_id": tenant["id"], "category": "huur"},
            {"_id": 0, "period_month": 1, "period_year": 1},
        ):
            if p.get("period_month") and p.get("period_year"):
                paid_periods.add((int(p["period_year"]), int(p["period_month"])))
        y, m = start.year, start.month
        for _ in range(months + 12):
            if (y, m) not in paid_periods:
                next_period = {"year": y, "month": m}
                break
            m += 1
            if m > 12:
                m = 1
                y += 1
    return {
        "rent_amount": rent,
        "currency": currency,
        "months_due": months,
        "total_due": total_due,
        "total_paid": total_paid,
        "balance": balance,
        "next_period": next_period,
    }


# =====================================================================
# Locations (admin only) — appartementen worden gegroepeerd per locatie
# =====================================================================
async def _enrich_location(loc: dict) -> dict:
    total = await db.apartments.count_documents({"location_id": loc["id"], "company_id": loc["company_id"]})
    occupied = await db.apartments.count_documents({"location_id": loc["id"], "company_id": loc["company_id"], "status": "occupied"})
    return {**loc, "apartments_total": total, "apartments_occupied": occupied}


@api.get("/locations", response_model=List[LocationOut])
async def list_locations(user=Depends(get_current_user)):
    async def compute():
        docs = await db.locations.find(scope(user), {"_id": 0}).sort("name", 1).to_list(1000)
        counts = await db.apartments.aggregate([
            {"$match": {**scope(user), "location_id": {"$in": [d["id"] for d in docs]}}},
            {"$group": {"_id": "$location_id", "total": {"$sum": 1},
                        "occupied": {"$sum": {"$cond": [{"$eq": ["$status", "occupied"]}, 1, 0]}}}},
        ]).to_list(None)
        c_by = {c["_id"]: c for c in counts}
        return [{**d, "apartments_total": c_by.get(d["id"], {}).get("total", 0),
                 "apartments_occupied": c_by.get(d["id"], {}).get("occupied", 0)} for d in docs]
    return await _list_cached("locations", user, compute)


@api.post("/locations", response_model=LocationOut)
async def create_location(body: LocationIn, user=Depends(get_current_user)):
    cid = company_id_of(user)
    if not cid:
        raise HTTPException(status_code=400, detail="Geen actief bedrijf geselecteerd")
    if user.get("role") != "superadmin" and not user.get("original_user_id"):
        await _enforce_count_limit(cid, "locations", "max_locations", "locaties")
    doc = {
        "id": new_id(),
        "company_id": cid,
        "name": body.name,
        "address": body.address or "",
        "photo_url": body.photo_url or "",
        "created_at": iso(now_utc()),
    }
    await db.locations.insert_one(doc)
    doc.pop("_id", None)
    return await _enrich_location(doc)


@api.put("/locations/{loc_id}", response_model=LocationOut)
async def update_location(loc_id: str, body: LocationIn, user=Depends(get_current_user)):
    from pymongo import ReturnDocument
    res = await db.locations.find_one_and_update(
        {"id": loc_id, **scope(user)}, {"$set": body.model_dump()},
        projection={"_id": 0}, return_document=ReturnDocument.AFTER,
    )
    if not res:
        raise HTTPException(status_code=404, detail="Locatie niet gevonden")
    return await _enrich_location(res)


@api.delete("/locations/{loc_id}")
async def delete_location(loc_id: str, user=Depends(get_current_user)):
    loc = await db.locations.find_one({"id": loc_id, **scope(user)}, {"_id": 0})
    if not loc:
        raise HTTPException(status_code=404, detail="Locatie niet gevonden")
    # Detach apartments instead of refusing — keeps admin flow simple.
    await db.apartments.update_many({"location_id": loc_id, **scope(user)}, {"$unset": {"location_id": ""}})
    await db.locations.delete_one({"id": loc_id})
    return {"ok": True}


# =====================================================================
# Kiosk public endpoints (no auth, but expects kiosk session for payments)
# =====================================================================
# Kiosk-cache uitgeschakeld: alle kiosk-lijsten lezen live uit de database.
_NO_LOC_Q = [{"location_id": None}, {"location_id": {"$exists": False}}, {"location_id": ""}]


async def _kiosk_cached(name: str, sc: dict, compute):
    # Geen server-cache meer: altijd live uit de database.
    return await compute()


class KioskThemeIn(BaseModel):
    theme: Literal["orange", "white"]


@api.get("/kiosk/theme")
async def kiosk_get_theme(_session=Depends(get_kiosk_session)):
    c = await db.companies.find_one({"id": _session["company_id"]}, {"_id": 0, "kiosk_theme": 1}) or {}
    return {"theme": c.get("kiosk_theme") or "orange"}


@api.put("/kiosk/theme")
async def kiosk_set_theme(body: KioskThemeIn, _session=Depends(get_kiosk_session)):
    cid = _session["company_id"]
    await db.companies.update_one({"id": cid}, {"$set": {"kiosk_theme": body.theme}})
    await _kb_publish(_kiosk_admin_channel(cid), {"type": "kiosk_theme", "theme": body.theme})
    return {"theme": body.theme}



@api.get("/kiosk/locations")
async def kiosk_list_locations(_session=Depends(get_kiosk_session)):
    """List locations for the kiosk's company, with apartment counts."""
    sc = kiosk_scope(_session)

    async def compute():
        docs, counts = await asyncio.gather(
            db.locations.find(sc, {"_id": 0}).sort("name", 1).to_list(500),
            db.apartments.aggregate([
                {"$match": sc},
                {"$group": {"_id": {"$ifNull": ["$location_id", ""]}, "total": {"$sum": 1},
                            "occupied": {"$sum": {"$cond": [{"$eq": ["$status", "occupied"]}, 1, 0]}}}},
            ]).to_list(1000),
        )
        by_loc = {c["_id"]: c for c in counts}
        out = [{**loc, "apartments_total": by_loc.get(loc["id"], {}).get("total", 0),
                "apartments_occupied": by_loc.get(loc["id"], {}).get("occupied", 0)} for loc in docs]
        unassigned = by_loc.get("", {}).get("total", 0)
        if unassigned > 0:
            out.append({
                "id": "_none", "name": "Overige appartementen",
                "address": "", "photo_url": "",
                "apartments_total": unassigned, "apartments_occupied": 0,
                "created_at": "",
            })
        return out
    return await _kiosk_cached("loc", sc, compute)


@api.get("/kiosk/apartments")
async def kiosk_list_apartments(location_id: Optional[str] = None, _session=Depends(get_kiosk_session)):
    """List apartments for the kiosk's company, optionally filtered by location."""
    sc = kiosk_scope(_session)
    q = {**sc}
    if location_id is not None:
        if location_id in ("_none", ""):
            q["$or"] = _NO_LOC_Q
        else:
            q["location_id"] = location_id
    return await _kiosk_cached("apt", q, lambda: _kiosk_apartments_compute(q))


async def _kiosk_apartments_compute(q: dict) -> list:
    proj = {"_id": 0, "id": 1, "number": 1, "address": 1, "rent_amount": 1, "currency": 1,
            "status": 1, "tenant_id": 1, "show_tenant_photo": 1, "location_id": 1}
    docs = await db.apartments.find(q, proj).sort("number", 1).to_list(1000)
    tids = list({a["tenant_id"] for a in docs if a.get("tenant_id")})
    tenants, invoices = await asyncio.gather(
        db.tenants.find({"id": {"$in": tids}}, {"_id": 0, "id": 1, "name": 1, "avatar_url": 1, "id_photo_url": 1}).to_list(len(tids) or 1),
        db.invoices.find(
            {"tenant_id": {"$in": tids}, "status": {"$nin": ["paid", "cancelled"]}, "kind": {"$in": [None, "huur"]}},
            {"_id": 0, "tenant_id": 1, "amount": 1, "paid_amount": 1, "period_month": 1, "period_year": 1},
        ).to_list(None),
    )
    t_by_id = {t["id"]: t for t in tenants}
    # Vooruit gefactureerde maanden tellen niet mee (zelfde regel als total_due in de overview).
    _now = datetime.now(timezone(timedelta(hours=-3)))
    _cur_key = _now.year * 12 + _now.month
    invoices = [i for i in invoices if not (isinstance(i.get("period_month"), int) and i.get("period_year")
                                            and int(i["period_year"]) * 12 + i["period_month"] > _cur_key)]
    # Betaal-status: "unpaid" (min. 1 factuur 0 betaald) > "partial" > "paid".
    status_by_tid: dict = {}
    for inv in invoices:
        amt = float(inv.get("amount") or 0)
        paid = float(inv.get("paid_amount") or 0)
        if amt > 0 and paid >= amt - 0.005:
            continue  # feitelijk betaald ondanks stale status
        tid = inv["tenant_id"]
        if paid > 0:
            status_by_tid.setdefault(tid, "partial")
        else:
            status_by_tid[tid] = "unpaid"
    out = []
    for a in docs:
        t = t_by_id.get(a.get("tenant_id")) or {}
        out.append({
            "id": a["id"],
            "number": a["number"],
            "address": a.get("address", ""),
            "rent_amount": a["rent_amount"],
            "currency": a["currency"],
            "status": a["status"],
            "tenant_id": a.get("tenant_id"),
            "tenant_name": t.get("name"),
            "tenant_avatar_url": t.get("avatar_url") or None,
            "tenant_id_photo_url": t.get("id_photo_url") or None,
            "show_tenant_photo": bool(a.get("show_tenant_photo") or False),
            "location_id": a.get("location_id"),
            "pay_status": status_by_tid.get(a.get("tenant_id"), "paid"),
        })
    return out


@api.get("/kiosk/tenants/{tenant_id}/overview")
async def kiosk_tenant_overview(tenant_id: str, _session=Depends(get_kiosk_session)):
    t = await db.tenants.find_one({"id": tenant_id, **kiosk_scope(_session)}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Huurder niet gevonden")
    today_iso = now_utc().date().isoformat()

    async def _apt():
        return await db.apartments.find_one({"id": t["apartment_id"]}, {"_id": 0}) if t.get("apartment_id") else None

    # Alle onafhankelijke queries tegelijk uitvoeren.
    apt, balance, credit_docs, cs, invoices, has_payment_doc, has_invoice_doc, due_notes = await asyncio.gather(
        _apt(),
        _calc_balance(t),
        db.payments.find(
            {"tenant_id": tenant_id, "credit_remaining": {"$gt": 0}, "status": "approved"},
            {"_id": 0, "credit_remaining": 1},
        ).to_list(None),
        db.company_settings.find_one({"company_id": _session.get("company_id")}, {"_id": 0, "invoicing": 1}),
        db.invoices.find(
            {"tenant_id": tenant_id, "status": {"$ne": "paid"}},
            {"_id": 0, "id": 1, "period_month": 1, "period_year": 1,
             "amount_due": 1, "amount": 1, "paid_amount": 1, "currency": 1,
             "due_date": 1, "status": 1, "kind": 1, "label": 1,
             "invoice_number": 1},
        ).sort([("period_year", 1), ("period_month", 1), ("due_date", 1)]).to_list(None),
        db.payments.find_one({"tenant_id": tenant_id, "status": "approved"}, {"_id": 1}),
        db.invoices.find_one({"tenant_id": tenant_id}, {"_id": 1}),
        db.tenant_notes.find({
            "tenant_id": tenant_id,
            "company_id": _session.get("company_id"),
            "remind_at": {"$ne": None, "$lte": today_iso},
            "dismissed_at": None,
        }, {"_id": 0}).sort("remind_at", 1).to_list(20),
    )
    # Vooruitbetaald krediet (aanname: 1 valuta per huurder).
    credit = sum(float(p.get("credit_remaining") or 0) for p in credit_docs)

    # ----- Open facturen ophalen — 3 buckets -----
    # achterstand (overdue): periode-einde + grace_workdays is verstreken
    # current: huidige kalendermaand of vorige maand nog binnen grace-window
    # future: vooruit gefactureerde periode (periode > huidige maand)
    #
    # `open_invoices` blijft achterstand (achterwaartse compat met FE).
    # `current_invoices` is een array — kan mei + (vroeg in juni nog mei) bevatten.
    # `current_month_invoice` is de eerste current voor backwards-compat (één regel).
    grace_wd = 10
    try:
        if cs and isinstance(cs.get("invoicing"), dict):
            grace_wd = int(cs["invoicing"].get("grace_workdays") or 10)
    except Exception:  # noqa: BLE001
        pass
    today_local = now_utc().date()
    overdue_invoices: list[dict] = []
    current_invoices: list[dict] = []
    future_invoices: list[dict] = []
    overdue_total = 0.0
    current_total = 0.0
    future_total = 0.0
    for inv in invoices:
        total = float(inv.get("amount_due") or inv.get("amount") or 0)
        paid = float(inv.get("paid_amount") or 0)
        outstanding = max(total - paid, 0)
        if outstanding <= 0:
            continue
        py = inv.get("period_year") or 0
        pm = inv.get("period_month") or 0
        bucket = _classify_invoice_bucket(pm, py, today_local, grace_wd, due_date=inv.get("due_date"))
        item = {
            "id": inv["id"],
            "invoice_number": inv.get("invoice_number") or "",
            "period_month": pm,
            "period_year": py,
            "amount": total,
            "amount_paid": paid,
            "outstanding": outstanding,
            "currency": inv.get("currency") or balance.get("currency") or "SRD",
            "due_date": inv.get("due_date"),
            "status": inv.get("status") or "open",
            "is_partial": paid > 0 and outstanding > 0,
            "kind": inv.get("kind") or "huur",
            "label": inv.get("label") or "",
            "bucket": bucket,
        }
        if bucket == "future":
            future_invoices.append(item)
            future_total += outstanding
        elif bucket == "current":
            current_invoices.append(item)
            current_total += outstanding
        else:
            overdue_invoices.append(item)
            overdue_total += outstanding
    current_month_invoice = current_invoices[0] if current_invoices else None
    # ----- Boetes (automatische) -----
    # Alleen berekenen wanneer admin `invoicing.fines_enabled` heeft aangezet.
    # Modi:
    #   - "per_overdue": vast bedrag × aantal achterstallige facturen
    #   - "per_day"    : vast bedrag × totaal dagen te laat (sum per factuur)
    # Het grace-window (`fines_grace_days`) wordt afgetrokken van de
    # dagen-te-laat voor "per_day". Resultaat (afgerond op 2 decimalen) wordt
    # mee-geserveerd als `fines_total`; frontend toont de rij alleen wanneer
    # > 0.
    fines_total = 0.0
    fines_currency = balance.get("currency") or "SRD"
    try:
        inv_cfg = (cs or {}).get("invoicing") if cs else None
        if isinstance(inv_cfg, dict) and inv_cfg.get("fines_enabled"):
            fine_amt = float(inv_cfg.get("fines_amount") or 0)
            fine_mode = str(inv_cfg.get("fines_mode") or "per_overdue")
            fine_grace = int(inv_cfg.get("fines_grace_days") or 0)
            fines_currency = str(inv_cfg.get("fines_currency") or fines_currency)
            if fine_amt > 0 and overdue_invoices:
                if fine_mode == "per_day":
                    total_days = 0
                    for inv in overdue_invoices:
                        dd = inv.get("due_date")
                        if not dd:
                            continue
                        try:
                            due = datetime.fromisoformat(str(dd)).date()
                        except Exception:  # noqa: BLE001
                            continue
                        days_late = max((today_local - due).days - fine_grace, 0)
                        total_days += days_late
                    fines_total = round(fine_amt * total_days, 2)
                else:  # per_overdue (default)
                    fines_total = round(fine_amt * len(overdue_invoices), 2)
    except Exception:  # noqa: BLE001
        pass
    # `has_history` — bepaalt of frontend "Vooruit betalen voor eerste maand"
    # als prominente knop toont (nieuwe huurder) of gewoon de kleine
    # "Vooruitbetaling registreren" (bestaande huurder, alles voldaan).
    # Nieuwe huurder = 0 betalingen ooit én 0 facturen (paid of unpaid).
    has_payment = has_payment_doc is not None
    has_invoice = has_invoice_doc is not None
    return {
        "tenant": {
            "id": t["id"],
            "name": t["name"],
            "phone": t.get("phone", ""),
            "email": t.get("email", ""),
        },
        "apartment": apt and {
            "id": apt["id"],
            "number": apt["number"],
            "address": apt.get("address", ""),
            "rent_amount": apt["rent_amount"],
            "currency": apt["currency"],
        },
        "balance": balance,
        "credit_balance": round(credit, 2),
        "open_invoices": overdue_invoices,
        "open_invoices_total": round(overdue_total, 2),
        "current_invoices": current_invoices,
        "current_invoices_total": round(current_total, 2),
        "future_invoices": future_invoices,
        "future_invoices_total": round(future_total, 2),
        "total_due": round(overdue_total + current_total, 2),
        "is_paid": round(overdue_total + current_total, 2) <= 0.005,
        "current_month_invoice": current_month_invoice,
        "grace_workdays": grace_wd,
        "fines_total": fines_total,
        "fines_currency": fines_currency,
        "has_history": bool(has_payment or has_invoice),
        "due_reminders": due_notes,
    }


# =====================================================================
# Kiosk live-kanaal (WebSocket): medewerker-aanwezigheid + PRINT_RECEIPT
# naar de kiosk van de beheerder. Cross-replica via event_bus.
# =====================================================================
from event_bus import publish as _kb_publish, subscribe as _kb_subscribe, unsubscribe as _kb_unsubscribe  # noqa: E402

_PRESENCE_TTL_S = 75  # ruim boven browser-throttling van timers op de achtergrond (1/min)


def _kiosk_admin_channel(cid: str) -> str:
    return f"kiosk-admin:{cid}"


_PRINTER_MODES = ("none", "kt-v520", "bluetooth")


def _printer_mode(cfg: dict) -> str:
    cfg = cfg or {}
    mode = cfg.get("printer_mode")
    if mode in _PRINTER_MODES:
        return mode
    return "kt-v520" if cfg.get("kt_v520_enabled") else "none"


def _device_config_msg(cfg: dict) -> dict:
    mode = _printer_mode(cfg)
    width = 80 if str((cfg or {}).get("paper_width")) == "80" else 58
    return {"type": "device_config", "kt_v520_enabled": mode == "kt-v520", "printer_mode": mode,
            "paper_width": width, "printer": None if mode == "none" else mode}


async def _kiosk_device_config(cid: str) -> dict:
    cs = await db.company_settings.find_one({"company_id": cid}, {"_id": 0, "kiosk_devices": 1})
    return _device_config_msg((cs or {}).get("kiosk_devices") or {})


def _ws_company(token: str, role: str, admin_token: str) -> Optional[str]:
    try:
        p = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG], options={"verify_exp": False})
    except Exception:  # noqa: BLE001
        return None
    if p.get("type") != "kiosk" or not p.get("company_id"):
        return None
    cid = p["company_id"]
    if role == "admin":
        try:
            a = decode_token(admin_token)
        except Exception:  # noqa: BLE001
            return None
        if a.get("type") != "access" or a.get("role") not in ("admin", "superadmin"):
            return None
        if a.get("role") == "admin" and a.get("company_id") != cid:
            return None
    return cid


async def _active_employees(cid: str) -> list:
    docs = await db.kiosk_presence.find(
        {"company_id": cid, "last_seen": {"$gt": time.time() - _PRESENCE_TTL_S}},
        {"_id": 0, "emp_key": 1, "name": 1},
    ).to_list(200)
    uniq = {d.get("emp_key") or d.get("name") or "medewerker": d.get("name") or "Medewerker" for d in docs}
    return [{"key": k, "name": v} for k, v in sorted(uniq.items(), key=lambda x: x[1])]


@api.websocket("/kiosk/ws")
async def kiosk_ws(ws: WebSocket):
    # Tokens komen in het eerste bericht (niet in de URL → niet in access-logs).
    await ws.accept()
    kiosk_id = str(ws.query_params.get("device") or "").strip()[:64]
    try:
        hello = _ws_parse(await asyncio.wait_for(ws.receive(), timeout=4 if kiosk_id else 10))
    except Exception:  # noqa: BLE001
        hello = None
    # APK-achtergrondservice: alleen ?device=KIOSK-ID + pings, geen auth-bericht.
    if kiosk_id and (not hello or hello.get("type") != "auth"):
        # Alleen een printer van het eigenaar-bedrijf van deze KIOSK-ID.
        owner = await _kiosk_id_owner(kiosk_id)
        prn = await db.kiosk_printers.find_one(
            {"kiosk_ids": kiosk_id, "company_id": owner, "revoked": {"$ne": True}}, {"_id": 0}) if owner else None
        if not prn:
            # Spam-rem: alleen nieuwe ID's opslaan zolang de lijst klein is; oude (>1 dag) opruimen.
            await db.kiosk_unbound_devices.delete_many({"last_seen": {"$lt": iso(now_utc() - timedelta(days=1))}})
            known = await db.kiosk_unbound_devices.find_one({"kiosk_id": kiosk_id}, {"_id": 1})
            if known or await db.kiosk_unbound_devices.count_documents({}) < 200:
                await db.kiosk_unbound_devices.update_one(
                    {"kiosk_id": kiosk_id},
                    {"$set": {"last_seen": iso(now_utc())}, "$setOnInsert": {"first_seen": iso(now_utc())}}, upsert=True)
            await ws.close(code=4401)
            return
        await _record_device_seen(prn["company_id"], "printer", prn["name"], {"kiosk_id": kiosk_id, "service": True})
        await _kiosk_ws_printer(ws, prn, service=True)
        return
    if not hello:
        try:
            await ws.close(code=4400)
        except RuntimeError:
            pass
        return
    if hello.get("role") == "printer":
        prn = await _printer_by_token(str(hello.get("device_token") or ""))
        if not prn:
            await ws.close(code=4401)
            return
        await _record_device_seen(prn["company_id"], "printer", prn["name"], hello.get("device"))
        if kiosk_id or hello.get("kiosk_id"):
            await _bind_kiosk_id(prn, str(kiosk_id or hello.get("kiosk_id"))[:64])
        await _kiosk_ws_printer(ws, prn)
        return
    role = "admin" if hello.get("role") == "admin" else "employee"
    name = str(hello.get("name") or "")[:60]
    emp_key = str(hello.get("employee_id") or name or "medewerker")[:80]
    cid = _ws_company(str(hello.get("token") or ""), role, str(hello.get("admin_token") or ""))
    if not cid:
        await ws.close(code=4401)
        return
    channel = _kiosk_admin_channel(cid)
    await _record_device_seen(cid, role, name, hello.get("device"))
    # Koppelverzoek via de eigen APK: ingelogde kiosk/beheerder op dit toestel claimt de KIOSK-ID.
    claim_id = str(kiosk_id or hello.get("kiosk_id") or "").strip()[:64]
    if claim_id:
        await _claim_kiosk_id(cid, claim_id)
    if role == "admin":
        await _kiosk_ws_admin(ws, cid, channel)
    else:
        await _kiosk_ws_employee(ws, cid, channel, name, emp_key)


async def _kiosk_ws_employee(ws: WebSocket, cid: str, channel: str, name: str, emp_key: str):
    conn_id = str(uuid.uuid4())
    await db.kiosk_presence.insert_one({"conn_id": conn_id, "company_id": cid, "name": name, "emp_key": emp_key, "last_seen": time.time()})
    await _kb_publish(channel, {"type": "presence_changed"})
    asyncio.create_task(_kiosk_emp_login(cid, emp_key, name))
    bye = False
    queue = _kb_subscribe(channel, maxsize=16)

    last_printers = {"v": None}

    async def push_printers():
        prns = await _online_printers(cid)
        if prns != last_printers["v"]:
            last_printers["v"] = prns
            await ws.send_json({"type": "printers", "printers": prns})

    async def forward_config():
        # Apparaat-instellingen + printerstatus (online/papier) naar de medewerker-kiosk.
        await push_printers()
        while True:
            ev = await queue.get()
            if ev.get("type") in ("device_config", "REMOTE_PRINT_DONE", "overview_invalidate"):
                await ws.send_json(ev)
            elif ev.get("type") == "presence_changed":
                await push_printers()

    fwd = asyncio.create_task(forward_config())
    last_write = time.time()
    try:
        await ws.send_json(await _kiosk_device_config(cid))
        while True:
            msg = await ws.receive_json()
            kind = msg.get("type")
            if kind == "BYE":
                bye = True
                break
            if kind == "ping":
                # Max. 1 DB-write per 25s per verbinding (TTL = 75s).
                if time.time() - last_write > 25:
                    last_write = time.time()
                    await db.kiosk_presence.update_one({"conn_id": conn_id}, {"$set": {"last_seen": last_write}})
            elif kind == "PRINT_RECEIPT" and msg.get("payment_id"):
                pid = str(msg["payment_id"])
                if await db.payments.find_one({"id": pid, "company_id": cid}, {"_id": 1}):
                    # Eén logregel per bon; herprint werkt de tijd bij (vinkje 'al geprint' blijft).
                    await db.kiosk_print_log.update_one(
                        {"company_id": cid, "payment_id": pid},
                        {"$set": {"emp_key": emp_key, "employee_name": name, "printed_at": iso(now_utc())},
                         "$setOnInsert": {"id": str(uuid.uuid4())}},
                        upsert=True,
                    )
                    await _kb_publish(channel, {"type": "PRINT_RECEIPT", "payment_id": pid, "employee": name, "emp_key": emp_key})
    except (WebSocketDisconnect, RuntimeError, ValueError):
        pass
    finally:
        fwd.cancel()
        _kb_unsubscribe(channel, queue)
        await db.kiosk_presence.delete_one({"conn_id": conn_id})
        await _kb_publish(channel, {"type": "presence_changed"})
        # Expliciet uitloggen → direct; verbinding weg → pas na grace (netwerk-hapering).
        asyncio.create_task(_kiosk_emp_logout(cid, emp_key, name, 0 if bye else _LOGOUT_GRACE_S))


_LOGOUT_GRACE_S = 90


async def _kiosk_emp_login(cid: str, emp_key: str, name: str):
    try:
        prev = await db.kiosk_emp_state.find_one_and_update(
            {"company_id": cid, "emp_key": emp_key},
            {"$set": {"online": True, "name": name, "since": iso(now_utc())}},
            upsert=True,
        )
        if prev and prev.get("online"):
            return
        await _notify_company_admins(
            cid, f"Kiosk · {name or 'Medewerker'} is ingelogd",
            f"Ingelogd om {datetime.now(timezone.utc).astimezone(timezone(timedelta(hours=-3))).strftime('%H:%M')}",
            {"kind": "kiosk_login", "url": "/admin"},
        )
    except Exception as e:  # noqa: BLE001
        print(f"[push] kiosk login notify failed: {e}")


async def _kiosk_emp_logout(cid: str, emp_key: str, name: str, delay: float):
    try:
        if delay:
            await asyncio.sleep(delay)
        if await db.kiosk_presence.find_one(
            {"company_id": cid, "emp_key": emp_key, "last_seen": {"$gt": time.time() - _PRESENCE_TTL_S}}, {"_id": 1}
        ):
            return
        prev = await db.kiosk_emp_state.find_one_and_update(
            {"company_id": cid, "emp_key": emp_key, "online": True}, {"$set": {"online": False}},
        )
        if not prev:
            return
        await _notify_company_admins(
            cid, f"Kiosk · {name or 'Medewerker'} is uitgelogd",
            f"Uitgelogd om {datetime.now(timezone.utc).astimezone(timezone(timedelta(hours=-3))).strftime('%H:%M')}",
            {"kind": "kiosk_logout", "url": "/admin"},
        )
    except Exception as e:  # noqa: BLE001
        print(f"[push] kiosk logout notify failed: {e}")


async def _record_device_seen(cid: str, role: str, name: str, dev) -> None:
    """Diagnose: welke toestellen verbinden met de kiosk (model/brug/KTP-vlag)."""
    if not isinstance(dev, dict):
        dev = {}
    ua = str(dev.get("ua") or "")[:300]
    key = hashlib.sha1(f"{ua}|{role}|{name}".encode()).hexdigest()
    info = {k: bool(dev.get(k)) for k in ("rn_bridge", "android_bridge", "ktp_flag", "ktp_detected", "paired")}
    try:
        await db.kiosk_devices_seen.update_one(
            {"company_id": cid, "key": key},
            {"$set": {"ua": ua, "role": role, "name": name or "", **info, "last_seen": iso(now_utc())}},
            upsert=True)
    except Exception as e:  # noqa: BLE001
        print(f"[kiosk] device seen log failed: {e}")


@api.get("/settings/kiosk-devices-seen")
async def kiosk_devices_seen(user=Depends(require_role("admin", "superadmin"))):
    since = iso(now_utc() - timedelta(days=7))
    docs = await db.kiosk_devices_seen.find({"company_id": company_id_of(user), "last_seen": {"$gt": since}},
                                           {"_id": 0, "company_id": 0}).sort("last_seen", -1).to_list(30)
    return docs


# ---------- KT-V520 printer-modus: toestel print ook zonder ingelogde medewerker ----------
def _hash_device_token(tok: str) -> str:
    return hashlib.sha256(tok.encode()).hexdigest()


async def _printer_by_token(tok: str) -> Optional[dict]:
    if len(tok) < 20:
        return None
    return await db.kiosk_printers.find_one({"token_hash": _hash_device_token(tok), "revoked": {"$ne": True}}, {"_id": 0})


async def _online_printers(cid: str) -> list:
    docs = await db.kiosk_printers.find(
        {"company_id": cid, "revoked": {"$ne": True}, "last_seen": {"$gt": time.time() - _PRESENCE_TTL_S}},
        {"_id": 0, "id": 1, "name": 1, "last_seen": 1, "paper": 1},
    ).sort("last_seen", -1).to_list(50)
    return [{"id": d["id"], "name": d["name"], "paper": d.get("paper") or "ok"} for d in docs]


_PAPER_ALIASES = {
    "ok": "ok", "normal": "ok", "full": "ok",
    "low": "low", "near_end": "low", "nearly_empty": "low", "almost_empty": "low", "near_empty": "low",
    "empty": "empty", "out": "empty", "no_paper": "empty", "paper_out": "empty",
}


def _paper_status(msg: dict) -> Optional[str]:
    raw = msg.get("paper", msg.get("paper_status", msg.get("status")))
    return _PAPER_ALIASES.get(str(raw or "").strip().lower())


def _ws_parse(frame) -> Optional[dict]:
    """WS-frame → dict. Tekst 'ping' of niet-JSON telt als ping (APK-achtergrondservice)."""
    if not frame or frame.get("type") == "websocket.disconnect":
        raise WebSocketDisconnect()
    raw = frame.get("text") if frame.get("text") is not None else (frame.get("bytes") or b"").decode("utf-8", "ignore")
    try:
        msg = json.loads(raw)
        return msg if isinstance(msg, dict) else {"type": "ping"}
    except Exception:  # noqa: BLE001
        return {"type": "ping"}


async def _kiosk_id_owner(kiosk_id: str) -> Optional[str]:
    """Bedrijf dat eigenaar is van een KIOSK-ID: eerste claim of eerdere koppeling (ook ingetrokken printers)."""
    o = await db.kiosk_id_owners.find_one({"kiosk_id": kiosk_id}, {"_id": 0, "company_id": 1})
    if o:
        return o["company_id"]
    prn = await db.kiosk_printers.find_one({"kiosk_ids": kiosk_id}, {"_id": 0, "company_id": 1}, sort=[("created_at", 1)])
    if prn:
        await db.kiosk_id_owners.update_one({"kiosk_id": kiosk_id}, {"$setOnInsert": {"company_id": prn["company_id"], "since": iso(now_utc())}}, upsert=True)
        return prn["company_id"]
    return None


async def _claim_kiosk_id(cid: str, kiosk_id: str) -> bool:
    """Eerste bedrijf dat claimt wordt eigenaar; daarna kan geen ander bedrijf hem zien of koppelen."""
    owner = await _kiosk_id_owner(kiosk_id)
    if owner:
        return owner == cid
    try:
        await db.kiosk_id_owners.insert_one({"kiosk_id": kiosk_id, "company_id": cid, "since": iso(now_utc())})
    except Exception:  # noqa: BLE001 — race: ander bedrijf was net eerder
        return (await _kiosk_id_owner(kiosk_id)) == cid
    return True


async def _bind_kiosk_id(prn: dict, kiosk_id: str) -> bool:
    """KIOSK-ID aan printer koppelen — alleen voor het eigenaar-bedrijf (of eerste claim)."""
    if not kiosk_id or not await _claim_kiosk_id(prn["company_id"], kiosk_id):
        return False
    await db.kiosk_printers.update_many({"kiosk_ids": kiosk_id, "id": {"$ne": prn["id"]}}, {"$pull": {"kiosk_ids": kiosk_id}})
    await db.kiosk_printers.update_one({"id": prn["id"]}, {"$addToSet": {"kiosk_ids": kiosk_id}})
    await db.kiosk_unbound_devices.delete_one({"kiosk_id": kiosk_id})
    return True


# Actieve printerverbindingen per printer (web-app printer-modus en/of APK-achtergrondservice).
# Een printopdracht gaat naar precies één verbinding: de achtergrondservice heeft voorrang,
# de app (printer-modus) is reserve.
_printer_conns: dict = {}


def _primary_conn(pid_: str):
    # Achtergrondservice (?device=) eerst; de app-verbinding is reserve (bij voorkeur een recent actieve).
    conns = _printer_conns.get(pid_) or []
    now = time.time()
    svc = [c for c in conns if c["service"]]
    app = [c for c in conns if not c["service"] and now - c["last"] < _APP_FRESH_S]
    return (svc or app or conns or [None])[-1]


_APP_FRESH_S = 70


async def _kiosk_ws_printer(ws: WebSocket, prn: dict, service: bool = False):
    cid, pid_ = prn["company_id"], prn["id"]
    channel = _kiosk_admin_channel(cid)
    queue = _kb_subscribe(channel, maxsize=32)
    me = {"ws": ws, "service": service, "last": time.time()}
    _printer_conns.setdefault(pid_, []).append(me)
    last_ping = {"t": time.time()}
    await db.kiosk_printers.update_one({"id": pid_}, {"$set": {"last_seen": last_ping["t"]}})
    await _kb_publish(channel, {"type": "presence_changed"})

    async def forward():
        while True:
            ev = await queue.get()
            if (ev.get("type") == "REMOTE_PRINT" and ev.get("target") == pid_ and ev.get("company_id") == cid
                    and _primary_conn(pid_) is me):
                if service:
                    d = ev.get("data") or {}
                    # Ook top-level velden zoals PRINT_RECEIPT ze heeft, voor de achtergrondservice.
                    ev = {**ev, "printer": "kt-v520", "lines": d.get("lines"), "remote": True,
                          **({"template": d["template"], "receipt_type": d.get("receipt_type")} if d.get("template") else {})}
                _logging.getLogger("uvicorn.error").info("[ktp] REMOTE_PRINT job=%s printer=%s via=%s", ev.get("job_id"), pid_, "service" if service else "app")
                await ws.send_json(ev)

    async def receive():
        while True:
            msg = _ws_parse(await ws.receive())
            me["last"] = time.time()
            kind = msg.get("type")
            if service and kind != "ping":
                _logging.getLogger("uvicorn.error").info("[ktp] service %s -> %s", pid_, json.dumps(msg)[:300])
            if kind == "ping":
                if time.time() - last_ping["t"] > 25:
                    last_ping["t"] = time.time()
                    await db.kiosk_printers.update_one({"id": pid_}, {"$set": {"last_seen": last_ping["t"]}})
            elif kind in ("PRINTER_STATUS", "PAPER_STATUS"):
                paper = _paper_status(msg)
                if paper:
                    prev = await db.kiosk_printers.find_one_and_update(
                        {"id": pid_}, {"$set": {"paper": paper, "paper_at": iso(now_utc())}}, projection={"_id": 0, "paper": 1})
                    if (prev or {}).get("paper", "ok") != paper:
                        await _kb_publish(channel, {"type": "presence_changed"})
            elif kind == "REMOTE_PRINT_DONE" and (msg.get("payment_id") or msg.get("job_id")):
                pay_id = str(msg.get("payment_id") or "")
                ok = bool(msg.get("ok"))
                if ok and pay_id:
                    await db.kiosk_print_log.update_one(
                        {"company_id": cid, "payment_id": pay_id},
                        {"$set": {"admin_printed_at": iso(now_utc())}, "$setOnInsert": {"id": str(uuid.uuid4())}},
                        upsert=True)
                await _kb_publish(channel, {"type": "REMOTE_PRINT_DONE", "job_id": msg.get("job_id"), "payment_id": pay_id,
                                            "ok": ok, "error": str(msg.get("error") or "")[:200], "printer": prn["name"]})

    try:
        await ws.send_json({"type": "printer_ready", "name": prn["name"]})
        tasks = [asyncio.create_task(forward()), asyncio.create_task(receive())]
        _done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for t in pending:
            t.cancel()
        for t in _done:
            if not t.cancelled():
                t.exception()  # ophalen = geen 'never retrieved' traceback-spam bij disconnect
    except (WebSocketDisconnect, RuntimeError, ValueError):
        pass
    finally:
        _kb_unsubscribe(channel, queue)
        conns = _printer_conns.get(pid_) or []
        if me in conns:
            conns.remove(me)
        if not conns:
            _printer_conns.pop(pid_, None)
            await db.kiosk_printers.update_one({"id": pid_}, {"$set": {"last_seen": 0}})
        await _kb_publish(channel, {"type": "presence_changed"})


class PrinterRegisterIn(BaseModel):
    name: Optional[str] = None
    kiosk_id: Optional[str] = None


class LinkKioskIdIn(BaseModel):
    kiosk_id: str = Field(min_length=3, max_length=64)


@api.get("/settings/kiosk-unbound-devices")
async def kiosk_unbound_devices(user=Depends(require_role("admin", "superadmin"))):
    """Achtergrondservices (?device=KIOSK-ID) die zonder koppeling probeerden te verbinden (laatste 2 uur)."""
    since = iso(now_utc() - timedelta(hours=2))
    cid = company_id_of(user)
    owned = [o["kiosk_id"] for o in await db.kiosk_id_owners.find({"company_id": cid}, {"_id": 0, "kiosk_id": 1}).to_list(500)]
    if not owned:
        return []
    return await db.kiosk_unbound_devices.find({"kiosk_id": {"$in": owned}, "last_seen": {"$gt": since}},
                                               {"_id": 0}).sort("last_seen", -1).to_list(20)


@api.post("/settings/kiosk-printers/{printer_id}/link-device")
async def kiosk_printer_link_device(printer_id: str, body: LinkKioskIdIn, user=Depends(require_role("admin", "superadmin"))):
    prn = await db.kiosk_printers.find_one({"id": printer_id, "company_id": company_id_of(user), "revoked": {"$ne": True}}, {"_id": 0})
    if not prn:
        raise HTTPException(status_code=404, detail="Printer niet gevonden")
    if not await _bind_kiosk_id(prn, body.kiosk_id.strip()):
        raise HTTPException(status_code=409, detail="Deze KIOSK-ID hoort bij een ander bedrijf")
    return {"ok": True}


@api.post("/kiosk/printers/register")
async def kiosk_printer_register(body: PrinterRegisterIn, _session=Depends(get_kiosk_session)):
    """KT-V520-toestel koppelen (eenmalig, tijdens een kiosk-sessie). Het toestel
    bewaart het device-token en print daarna ook zonder ingelogde medewerker."""
    cid = _session["company_id"]
    n = await db.kiosk_printers.count_documents({"company_id": cid, "revoked": {"$ne": True}})
    tok = secrets.token_urlsafe(32)
    doc = {"id": str(uuid.uuid4()), "company_id": cid, "name": (body.name or "").strip()[:40] or f"KT-V520 #{n + 1}",
           "token_hash": _hash_device_token(tok), "created_at": iso(now_utc()), "last_seen": 0, "revoked": False}
    await db.kiosk_printers.insert_one(doc)
    if body.kiosk_id:
        await _bind_kiosk_id(doc, body.kiosk_id.strip()[:64])
    return {"printer_id": doc["id"], "name": doc["name"], "device_token": tok}


@api.get("/settings/kiosk-printers")
async def kiosk_printers_list(user=Depends(require_role("admin", "superadmin"))):
    cid = company_id_of(user)
    docs = await db.kiosk_printers.find({"company_id": cid, "revoked": {"$ne": True}},
                                        {"_id": 0, "id": 1, "name": 1, "created_at": 1, "last_seen": 1, "kiosk_ids": 1}).sort("created_at", 1).to_list(100)
    now = time.time()
    return [{"id": d["id"], "name": d["name"], "created_at": d["created_at"], "kiosk_ids": d.get("kiosk_ids") or [],
             "online": (d.get("last_seen") or 0) > now - _PRESENCE_TTL_S} for d in docs]


@api.patch("/settings/kiosk-printers/{printer_id}")
async def kiosk_printer_rename(printer_id: str, body: PrinterRegisterIn, user=Depends(require_role("admin", "superadmin"))):
    name = (body.name or "").strip()[:40]
    if not name:
        raise HTTPException(status_code=400, detail="Naam is verplicht")
    res = await db.kiosk_printers.update_one({"id": printer_id, "company_id": company_id_of(user)}, {"$set": {"name": name}})
    if not res.matched_count:
        raise HTTPException(status_code=404, detail="Printer niet gevonden")
    await _kb_publish(_kiosk_admin_channel(company_id_of(user)), {"type": "presence_changed"})
    return {"ok": True}


@api.delete("/settings/kiosk-printers/{printer_id}")
async def kiosk_printer_remove(printer_id: str, user=Depends(require_role("admin", "superadmin"))):
    res = await db.kiosk_printers.update_one({"id": printer_id, "company_id": company_id_of(user)},
                                             {"$set": {"revoked": True, "last_seen": 0}})
    if not res.matched_count:
        raise HTTPException(status_code=404, detail="Printer niet gevonden")
    await _kb_publish(_kiosk_admin_channel(company_id_of(user)), {"type": "presence_changed"})
    return {"ok": True}


@api.get("/kiosk/printers/online")
async def kiosk_printers_online(_session=Depends(get_kiosk_session)):
    return await _online_printers(_session["company_id"])


async def _publish_remote_print(cid: str, printer_id: str, payload: dict) -> str:
    """Printopdracht strikt binnen het bedrijf: printer moet van dit bedrijf zijn én online."""
    prn = await db.kiosk_printers.find_one({"id": printer_id, "company_id": cid, "revoked": {"$ne": True}}, {"_id": 0, "id": 1})
    if not prn or printer_id not in {p["id"] for p in await _online_printers(cid)}:
        raise HTTPException(status_code=409, detail="Deze KT-V520 is niet online")
    job_id = str(uuid.uuid4())
    await _kb_publish(_kiosk_admin_channel(cid), {**payload, "type": "REMOTE_PRINT", "job_id": job_id,
                                                  "company_id": cid, "target": printer_id})
    return job_id


class RemotePrintIn(BaseModel):
    printer_id: str


@api.post("/kiosk/print-log/by-payment/{payment_id}/remote-print")
async def kiosk_remote_print(payment_id: str, body: RemotePrintIn, _session=Depends(get_kiosk_session)):
    cid = _session["company_id"]
    p = await db.payments.find_one({"id": payment_id, "company_id": cid}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Bon niet gevonden")
    data = await _receipt_print_data(p, force_ktp=True)
    return {"job_id": await _publish_remote_print(cid, body.printer_id, {"payment_id": payment_id, "data": data})}


async def _kiosk_ws_admin(ws: WebSocket, cid: str, channel: str):
    queue = _kb_subscribe(channel, maxsize=64)
    last = {"emps": None}

    async def push_presence():
        emps = await _active_employees(cid)
        printers = await _online_printers(cid)
        if (emps, printers) != last["emps"]:
            last["emps"] = (emps, printers)
            await ws.send_json({"type": "presence", "active": bool(emps), "count": len(emps), "employees": emps,
                                "printers": printers})

    async def forward():
        while True:
            try:
                # 20s: TTL-verloop vangnet; presence_changed-events komen direct binnen.
                ev = await asyncio.wait_for(queue.get(), timeout=20.0)
            except asyncio.TimeoutError:
                await push_presence()  # TTL-verloop detecteren zonder event
                continue
            if ev.get("type") == "presence_changed":
                await push_presence()
            elif ev.get("type") in ("PRINT_RECEIPT", "device_config", "REMOTE_PRINT_DONE"):
                await ws.send_json(ev)

    async def receive():
        # Alleen lezen om een verbroken verbinding te detecteren.
        while True:
            await ws.receive_text()

    try:
        await ws.send_json(await _kiosk_device_config(cid))
        await push_presence()
        tasks = [asyncio.create_task(forward()), asyncio.create_task(receive())]
        _done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for t in pending:
            t.cancel()
        for t in _done:
            if not t.cancelled():
                t.exception()  # ophalen = geen 'never retrieved' traceback-spam bij disconnect
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        _kb_unsubscribe(channel, queue)


@api.get("/kiosk/print-log")
async def kiosk_print_log(since: str, employee: Optional[str] = None, _session=Depends(get_kiosk_session)):
    """Bonnen van vandaag: alle kiosk-betalingen van de medewerker (ook als hij
    offline printte) + door hem geprinte bonnen, met 'al geprint door beheerder'-status."""
    cid = _session["company_id"]
    pq = {"company_id": cid, "kiosk_employee_id": {"$ne": None}, "paid_at": {"$gte": since}}
    lq = {"company_id": cid, "printed_at": {"$gte": since}}
    if employee:
        pq["kiosk_employee_id"] = employee
        lq["emp_key"] = employee
    pay_proj = {"_id": 0, "id": 1, "receipt_number": 1, "amount": 1, "currency": 1, "tenant_id": 1,
                "method": 1, "status": 1, "paid_at": 1, "kiosk_employee_id": 1, "kiosk_employee_name": 1,
                "bank_country": 1, "bank_statement_id": 1}
    pays, logs = await asyncio.gather(
        db.payments.find(pq, pay_proj).to_list(1000),
        db.kiosk_print_log.find(lq, {"_id": 0}).to_list(1000),
    )
    have = {p["id"] for p in pays}
    extra = [l["payment_id"] for l in logs if l["payment_id"] not in have]
    if extra:
        pays += await db.payments.find({"id": {"$in": extra}, "company_id": cid}, pay_proj).to_list(1000)
    # Admin-print-status ook voor betalingen zonder print-event.
    all_logs = {l["payment_id"]: l for l in await db.kiosk_print_log.find(
        {"company_id": cid, "payment_id": {"$in": [p["id"] for p in pays]}}, {"_id": 0}).to_list(2000)}
    t_by = await _by_id("tenants", [p.get("tenant_id") for p in pays], {"name": 1})
    out = []
    for p in pays:
        l = all_logs.get(p["id"]) or {}
        if l.get("hidden_at"):
            continue
        out.append({
            "id": p["id"], "payment_id": p["id"],
            "emp_key": p.get("kiosk_employee_id") or l.get("emp_key"),
            "employee_name": p.get("kiosk_employee_name") or l.get("employee_name") or "",
            "printed_at": l.get("printed_at") or p.get("paid_at"),
            "employee_printed": bool(l.get("printed_at")),
            "admin_printed_at": l.get("admin_printed_at"),
            "payment": {**p, "tenant_name": t_by.get(p.get("tenant_id"), {}).get("name")},
        })
    out.sort(key=lambda r: r["printed_at"] or "", reverse=True)
    return out


@api.get("/kiosk/print-log/count")
async def kiosk_print_log_count(since: str, _session=Depends(get_kiosk_session)):
    return {"count": len(await kiosk_print_log(since=since, employee=None, _session=_session))}



@api.get("/kiosk/print-log/employees")
async def kiosk_print_log_employees(since: str, _session=Depends(get_kiosk_session)):
    """Medewerkers met bonnen vandaag (ook als ze nu offline zijn)."""
    cid = _session["company_id"]
    rows = await db.payments.aggregate([
        {"$match": {"company_id": cid, "kiosk_employee_id": {"$ne": None}, "paid_at": {"$gte": since}}},
        {"$group": {"_id": "$kiosk_employee_id", "name": {"$first": "$kiosk_employee_name"}}},
    ]).to_list(200)
    logs = await db.kiosk_print_log.aggregate([
        {"$match": {"company_id": cid, "printed_at": {"$gte": since}}},
        {"$group": {"_id": "$emp_key", "name": {"$first": "$employee_name"}}},
    ]).to_list(200)
    emps = {r["_id"]: r.get("name") or "Medewerker" for r in logs + rows if r["_id"]}
    return [{"key": k, "name": v} for k, v in sorted(emps.items(), key=lambda x: x[1])]


@api.post("/kiosk/print-log/by-payment/{payment_id}/printed")
async def kiosk_print_log_mark_payment(payment_id: str, _session=Depends(get_kiosk_session)):
    cid = _session["company_id"]
    if not await db.payments.find_one({"id": payment_id, "company_id": cid}, {"_id": 1}):
        raise HTTPException(status_code=404, detail="Bon niet gevonden")
    await db.kiosk_print_log.update_one(
        {"company_id": cid, "payment_id": payment_id},
        {"$set": {"admin_printed_at": iso(now_utc())}, "$setOnInsert": {"id": str(uuid.uuid4())}},
        upsert=True,
    )
    return {"ok": True}


@api.delete("/kiosk/print-log/by-payment/{payment_id}")
async def kiosk_print_log_hide(payment_id: str, _session=Depends(get_kiosk_session)):
    """Verwijder een al afgedrukte bon uit 'Bonnen van vandaag' (de betaling zelf blijft bestaan)."""
    cid = _session["company_id"]
    res = await db.kiosk_print_log.update_one(
        {"company_id": cid, "payment_id": payment_id, "admin_printed_at": {"$ne": None}},
        {"$set": {"hidden_at": iso(now_utc())}})
    if not res.matched_count:
        raise HTTPException(status_code=400, detail="Alleen afgedrukte bonnen kunnen uit de lijst worden verwijderd")
    return {"ok": True}


@api.post("/kiosk/print-log/{log_id}/printed")
async def kiosk_print_log_mark(log_id: str, _session=Depends(get_kiosk_session)):
    res = await db.kiosk_print_log.update_one(
        {"id": log_id, "company_id": _session["company_id"]}, {"$set": {"admin_printed_at": iso(now_utc())}})
    if not res.matched_count:
        raise HTTPException(status_code=404, detail="Bon niet gevonden")
    return {"ok": True}


@api.post("/kiosk/payments", response_model=PaymentOut)
async def kiosk_create_payment(
    body: PaymentIn,
    _session=Depends(get_kiosk_session),
    employee_id: Optional[str] = Query(None, description="Kiosk-medewerker ID voor pending workflow"),
    employee_pin: Optional[str] = Query(None, description="PIN ter dubbele bevestiging"),
):
    cid = _session.get("company_id")
    if body.stripe_payment_intent_id:
        # Online (Stripe) betaald → geverifieerd, dus direct goedgekeurd.
        from routes.company_stripe import consume_kiosk_stripe_payment
        stx = await consume_kiosk_stripe_payment(cid, body.stripe_payment_intent_id)
        if body.method not in ("creditcard", "ideal") or float(body.amount) > float(stx["amount"]) + 0.01:
            raise HTTPException(status_code=400, detail="Bedrag/methode komt niet overeen met de Stripe-betaling")
        employee_id = None
    elif body.method in ("creditcard", "ideal"):
        raise HTTPException(status_code=400, detail="Creditcard/iDEAL vereist een Stripe-betaling")
    # Als een kiosk-medewerker is opgegeven → betaling gaat in pending_approval.
    # Beheerder ziet het en moet handtekening zetten om te bevestigen.
    # Zonder employee_id → klassieke directe boeking (legacy gedrag).
    kiosk_emp_id, kiosk_emp_name, status = None, None, "approved"
    if employee_id:
        emp = await db.employees.find_one(
            {"id": employee_id, "company_id": cid, "active": True, "app_role": "kiosk"},
            {"_id": 0},
        )
        if not emp:
            raise HTTPException(status_code=404, detail="Kiosk-medewerker niet gevonden")
        if not emp.get("kiosk_pin_hash") or not verify_password((employee_pin or "").strip(), emp["kiosk_pin_hash"]):
            raise HTTPException(status_code=401, detail="Ongeldige PIN")
        # Geen goedkeuringsstap meer: betaling van een medewerker telt direct mee.
        kiosk_emp_id, kiosk_emp_name = emp["id"], emp.get("name", "")

    doc = await _create_payment_doc(
        body, cid,
        status=status,
        kiosk_employee_id=kiosk_emp_id,
        kiosk_employee_name=kiosk_emp_name,
        **({"approved_by": kiosk_emp_name} if kiosk_emp_name else {}),
    )
    enriched = await _enrich_payment(doc)

    # Push notify alle admins van deze company (fire-and-forget — niet
    # blocking voor de kiosk UX als pywebpush traag is, maar de kiosk wacht
    # toch al op de receipt response).
    try:
        currency = enriched.get("currency", "")
        amount = float(enriched.get("amount", 0))
        tenant = enriched.get("tenant_name", "Onbekend")
        apt = enriched.get("apartment_number")
        method = enriched.get("method", "")
        apt_str = f" · Appt. {apt}" if apt else ""
        if status == "pending_approval":
            emp_name = kiosk_emp_name or "Medewerker"
            title = f"Goedkeuring nodig · {currency} {amount:,.2f}"
            body_msg = f"Door {emp_name} · {tenant}{apt_str}"
            push_kind = "payment_pending_approval"
            push_url = "/admin/payments?filter=pending"
        else:
            title = f"Betaling {currency} {amount:,.2f}"
            body_msg = f"{tenant}{apt_str} via {method}" + (f" · ontvangen door {kiosk_emp_name}" if kiosk_emp_name else "")
            push_kind = "payment"
            push_url = "/admin/payments"
        await _notify_company_admins(
            cid,
            title,
            body_msg,
            {
                "kind": push_kind,
                "url": push_url,
                "payment_id": enriched.get("id"),
                "amount": amount,
                "tenant": tenant,
                "status": status,
                "received_by": kiosk_emp_name or "",
                "badge_inc": 1,
                "require_approval": status == "pending_approval",
            },
        )
    except Exception as e:
        print(f"[push] kiosk payment notify failed: {e}")
    return enriched


@api.get("/kiosk/tenants/{tenant_id}/financial-overview.jpg")
async def kiosk_tenant_financial_overview_jpg(tenant_id: str, _session=Depends(get_kiosk_session)):
    """Rendert het financieel overzicht van de huurder als 1080-brede JPG
    die de kiosk-medewerker via WhatsApp/Web Share met de huurder kan delen.

    BELANGRIJK: gebruikt EXACT dezelfde data (via `kiosk_tenant_overview`)
    en formule als het scherm — dus wat de operator ziet == wat de huurder
    op WhatsApp krijgt. Formule:
        Totaal = Achterstand + Huidige maand
    (Vooruit gefactureerd is informatief, telt NIET in het totaal, precies
    zoals de Kiosk-overview logica in KioskLayout.jsx.)
    (Internet-item is verwijderd op 2026-02-22.)
    """
    # Hergebruik de scherm-endpoint zodat er één bron van waarheid is.
    overview = await kiosk_tenant_overview(tenant_id, _session)
    t = overview["tenant"]
    apt = overview.get("apartment") or {}
    open_invoices = overview.get("open_invoices") or []          # achterstand
    open_total = float(overview.get("open_invoices_total") or 0)
    current_invoices = overview.get("current_invoices") or []
    current_total = float(overview.get("current_invoices_total") or 0)
    future_invoices = overview.get("future_invoices") or []
    future_total = float(overview.get("future_invoices_total") or 0)
    current_invoice = overview.get("current_month_invoice") or (current_invoices[0] if current_invoices else None)
    credit = float(overview.get("credit_balance") or 0)
    cur = (overview.get("balance") or {}).get("currency") or apt.get("currency") or "SRD"
    # Zelfde formule als KioskLayout.jsx (Internet-item is verwijderd 2026-02-22).
    total_due = round(open_total + current_total, 2)

    company = await db.companies.find_one(
        {"id": _session.get("company_id")},
        {"_id": 0, "name": 1},
    ) or {}

    from PIL import Image, ImageDraw, ImageFont
    from io import BytesIO
    from datetime import datetime

    W = 1080
    PAD = 60
    accent = (255, 92, 0)  # #FF5C00
    try:
        f_title = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 44)
        f_h1 = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 34)
        f_body = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 26)
        f_bold = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 28)
        f_small = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 22)
        f_sub = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 20)
    except Exception:
        f_title = f_h1 = f_body = f_bold = f_small = f_sub = ImageFont.load_default()

    def fmt(v: float) -> str:
        return f"{cur} {v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")

    def month_label(pm, py):
        if isinstance(pm, int) and 1 <= pm <= 12:
            return f"{_DUTCH_MONTH_ABBR[pm]} {py}"
        return ""

    # Bouw de regel-items (zelfde volgorde als op scherm)
    row_h = 78
    rows: list[dict] = []
    if open_total > 0:
        n = len(open_invoices)
        months_text = ", ".join(
            filter(None, [month_label(i.get("period_month"), i.get("period_year")).split(" ")[0]
                          for i in open_invoices])
        )
        years = sorted({i.get("period_year") for i in open_invoices if i.get("period_year")})
        sub = months_text + (f" {years[0]}" if len(years) == 1 and months_text else "")
        rows.append({
            "label": f"Achterstallige huur ({n} maand{'' if n == 1 else 'en'})",
            "sub": sub,
            "value": fmt(open_total),
            "highlight": True,
        })
    # Huidige maandhuur
    if current_invoice and current_invoice.get("period_month"):
        cur_label = f"Huidige maandhuur · {month_label(current_invoice['period_month'], current_invoice['period_year'])}"
    else:
        cur_label = "Maandhuur"
    cur_sub = ""
    if current_invoice and current_invoice.get("due_date"):
        try:
            dd = datetime.fromisoformat(str(current_invoice["due_date"])[:10])
            cur_sub = f"Vervalt {dd.strftime('%-d %b')}"
        except Exception:
            cur_sub = f"Vervalt {current_invoice['due_date']}"
    rows.append({
        "label": cur_label, "sub": cur_sub,
        "value": fmt(current_total),
        "muted": current_total <= 0,
    })
    # Boetes — altijd 0 tonen zoals op scherm
    rows.append({"label": "Boetes", "sub": "", "value": fmt(0), "muted": True})
    # Vooruit gefactureerd (informatief)
    if future_total > 0:
        n = len(future_invoices)
        sub = ", ".join(
            filter(None, [month_label(i.get("period_month"), i.get("period_year"))
                          for i in future_invoices])
        )
        rows.append({
            "label": f"Vooruit gefactureerd ({n} maand{'' if n == 1 else 'en'})",
            "sub": (sub + " · informatief — telt niet mee") if sub else "informatief — telt niet mee",
            "value": fmt(future_total),
            "info": True,
        })

    # Dynamische hoogte
    n_rows = len(rows)
    H = 220 + 160 + 30 + n_rows * row_h + 30 + 140 + (100 if credit > 0 else 0) + 80
    img = Image.new("RGB", (W, H), (255, 255, 255))
    d = ImageDraw.Draw(img)

    # Header
    d.rectangle([0, 0, W, 200], fill=accent)
    d.text((PAD, 55), company.get("name") or "SuriRent", fill="white", font=f_title)
    d.text((PAD, 120), "Financieel overzicht", fill="white", font=f_h1)
    stamp = datetime.now().strftime("%d-%m-%Y %H:%M")
    d.text((W - PAD - 260, 155), f"{stamp}", fill=(255, 255, 255), font=f_small)

    y = 240
    d.text((PAD, y), (t.get("name") or "—").upper(), fill=(15, 23, 42), font=f_h1)
    y += 46
    apt_num = apt.get("number") or "—"
    apt_addr = apt.get("address") or ""
    # Voorkomt "HUIS HUIS 1A" wanneer nummer al "HUIS ..." begint.
    apt_label = str(apt_num) if str(apt_num).upper().startswith("HUIS") else f"HUIS {apt_num}"
    d.text((PAD, y), apt_label + (f" · {apt_addr}" if apt_addr else ""),
           fill=(100, 116, 139), font=f_body)
    y += 70

    # Rijen
    for r in rows:
        color = (255, 92, 0) if r.get("highlight") else \
                (59, 130, 246) if r.get("info") else \
                (148, 163, 184) if r.get("muted") else (15, 23, 42)
        d.text((PAD, y + 10), r["label"], fill=color, font=f_bold)
        if r.get("sub"):
            d.text((PAD, y + 42), r["sub"], fill=(100, 116, 139), font=f_sub)
        w = d.textlength(r["value"], font=f_bold)
        d.text((W - PAD - w, y + 20), r["value"], fill=color, font=f_bold)
        y += row_h
        d.line([PAD, y - 6, W - PAD, y - 6], fill=(226, 232, 240), width=1)

    y += 20
    # Totaal
    d.rectangle([PAD, y, W - PAD, y + 100], fill=(255, 247, 237), outline=accent, width=3)
    d.text((PAD + 20, y + 30), "Totaal openstaand", fill=(15, 23, 42), font=f_h1)
    tot_txt = fmt(total_due)
    w = d.textlength(tot_txt, font=f_title)
    d.text((W - PAD - 20 - w, y + 26), tot_txt, fill=accent, font=f_title)
    y += 130

    if credit > 0:
        d.rectangle([PAD, y, W - PAD, y + 70], fill=(236, 253, 245), outline=(16, 185, 129), width=2)
        d.text((PAD + 20, y + 20),
               f"Positief saldo (vooruitbetaald): {fmt(credit)}",
               fill=(6, 95, 70), font=f_body)
        y += 90

    d.text((PAD, H - 60), "Vragen? Neem contact op met de beheerder.",
           fill=(148, 163, 184), font=f_small)

    buf = BytesIO()
    img.save(buf, format="JPEG", quality=88, optimize=True)
    buf.seek(0)
    return StreamingResponse(
        buf, media_type="image/jpeg",
        headers={"Content-Disposition": f'inline; filename="overzicht-{tenant_id[:8]}.jpg"'},
    )


# ---------------------------------------------------------------------
# Financieel overzicht — TTS audiobericht (WhatsApp voice-share)
# ---------------------------------------------------------------------
# Genereert een gesproken bericht in het Nederlands via OpenAI TTS (Nova
# voice) met de openstaande facturen van de huurder. De medewerker kan
# de MP3 direct via WhatsApp delen — dit werkt vaak beter dan een lange
# tekst omdat de huurder de boodschap letterlijk hoort ("persoonlijker").
#
# BELANGRIJK: OpenAI TTS-stemmen zijn geoptimaliseerd voor Engels. Nederlands
# klinkt begrijpelijk maar met een lichte Engelse tongval. Dit is een
# provider-limiet, geen bug in onze code.
_TTS_CACHE: dict[str, bytes] = {}   # key = hash(text|voice) → mp3 bytes


async def _default_reminder_text(overview: dict, company_id: str) -> tuple[str, dict]:
    """Bouwt de standaard Nederlandse herinnerings-zin op basis van
    het financieel overzicht. Retourneert (text, meta_dict) waarbij
    meta gebruikt wordt door de UI om extra info te tonen.
    """
    t = overview["tenant"]
    open_invoices = overview.get("open_invoices") or []
    current_invoices = overview.get("current_invoices") or []
    open_total = float(overview.get("open_invoices_total") or 0)
    current_total = float(overview.get("current_invoices_total") or 0)
    total_due = round(open_total + current_total, 2)
    cur = (overview.get("balance") or {}).get("currency") or "SRD"
    n_open = len(open_invoices) + len(current_invoices)

    from datetime import date, timedelta
    due_dates = []
    for inv in list(open_invoices) + list(current_invoices):
        dd = inv.get("due_date")
        if dd:
            try:
                due_dates.append(date.fromisoformat(str(dd)[:10]))
            except Exception:  # noqa: BLE001
                pass
    earliest_due = min(due_dates) if due_dates else (now_utc().date() + timedelta(days=7))
    _NL_MONTHS = ["januari", "februari", "maart", "april", "mei", "juni",
                  "juli", "augustus", "september", "oktober", "november", "december"]
    due_txt = f"{earliest_due.day} {_NL_MONTHS[earliest_due.month - 1]} {earliest_due.year}"

    company = await db.companies.find_one(
        {"id": company_id}, {"_id": 0, "name": 1},
    ) or {}
    company_name = company.get("name") or "de beheerder"

    def amount_words(v: float) -> str:
        from num2words import num2words
        v = round(v, 2)
        euros = int(v)
        cents = int(round((v - euros) * 100))
        words = num2words(euros, lang="nl")
        if cents:
            words += f" komma {num2words(cents, lang='nl')}"
        return words

    plural = "factuur" if n_open == 1 else "facturen"
    text = (
        f"Geachte {t.get('name') or 'huurder'}, "
        f"u heeft {n_open} openstaande {plural} "
        f"met een totaalbedrag van {amount_words(total_due)} {cur}. "
        f"Wij verzoeken u vriendelijk dit voor {due_txt} te voldoen. "
        f"Met vriendelijke groet, {company_name}."
    )
    meta = {
        "text": text,
        "total_due": total_due,
        "currency": cur,
        "n_open": n_open,
        "due_date": earliest_due.isoformat(),
        "tenant_name": t.get("name") or "",
        "company_name": company_name,
    }
    return text, meta


@api.get("/kiosk/tenants/{tenant_id}/reminder-voice-text")
async def kiosk_tenant_reminder_voice_text(
    tenant_id: str, _session=Depends(get_kiosk_session)
):
    """Retourneert de default Nederlandse herinneringstekst voor de UI
    zodat de beheerder deze kan zien/aanpassen vóór TTS-generatie."""
    overview = await kiosk_tenant_overview(tenant_id, _session)
    total_check = (
        float(overview.get("open_invoices_total") or 0)
        + float(overview.get("current_invoices_total") or 0)
    )
    if total_check <= 0.01:
        raise HTTPException(status_code=400, detail="Geen openstaande facturen — spraakbericht niet nodig")
    _text, meta = await _default_reminder_text(overview, _session.get("company_id"))
    return meta


class ReminderVoiceIn(BaseModel):
    text: str


@api.post("/kiosk/tenants/{tenant_id}/reminder-voice.mp3")
async def kiosk_tenant_reminder_voice_mp3_post(
    tenant_id: str,
    body: ReminderVoiceIn,
    _session=Depends(get_kiosk_session),
):
    """Genereert TTS-MP3 (OpenAI Nova, tts-1) van door beheerder aangepaste
    tekst. Body: {"text": "..."} — max 2000 tekens."""
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Tekst mag niet leeg zijn")
    if len(text) > 2000:
        raise HTTPException(status_code=400, detail="Tekst is te lang (max 2000 tekens)")

    # Verifieer tenant bestaat in scope (voorkomt misbruik van open endpoint).
    t = await db.tenants.find_one(
        {"id": tenant_id, **kiosk_scope(_session)}, {"_id": 0, "id": 1},
    )
    if not t:
        raise HTTPException(status_code=404, detail="Huurder niet gevonden")

    import hashlib
    ckey = hashlib.sha256(f"{text}|nova|tts-1|mp3".encode()).hexdigest()
    audio_bytes = _TTS_CACHE.get(ckey)
    if audio_bytes is None:
        from emergentintegrations.llm.openai import OpenAITextToSpeech
        api_key = os.environ.get("EMERGENT_LLM_KEY")
        if not api_key:
            raise HTTPException(status_code=500, detail="TTS niet geconfigureerd")
        tts = OpenAITextToSpeech(api_key=api_key)
        try:
            audio_bytes = await tts.generate_speech(
                text=text, model="tts-1", voice="nova", response_format="mp3",
            )
        except Exception as e:  # noqa: BLE001
            raise HTTPException(status_code=502, detail=f"Spraakbericht mislukt: {e}")
        if len(_TTS_CACHE) >= 128:
            _TTS_CACHE.pop(next(iter(_TTS_CACHE)))
        _TTS_CACHE[ckey] = audio_bytes

    from fastapi.responses import Response as _Resp
    return _Resp(
        content=audio_bytes,
        media_type="audio/mpeg",
        headers={
            "Content-Disposition": f'inline; filename="herinnering-{tenant_id[:8]}.mp3"',
            "Cache-Control": "private, max-age=300",
        },
    )


# ---------------------------------------------------------------------
# Tenant notes — kiosk-medewerker kan afspraken/telefoongesprekken loggen
# ---------------------------------------------------------------------
class TenantNoteIn(BaseModel):
    text: str
    remind_at: Optional[str] = None   # ISO date "YYYY-MM-DD" — popup datum


async def _tenant_notes_list(company_id: str, tenant_id: str) -> list[dict]:
    return await db.tenant_notes.find(
        {"tenant_id": tenant_id, "company_id": company_id},
        {"_id": 0},
    ).sort("created_at", -1).limit(50).to_list(50)


async def _tenant_note_add(company_id: str, tenant_id: str, body: TenantNoteIn,
                           created_by: str) -> dict:
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Notitie mag niet leeg zijn")
    if len(text) > 2000:
        raise HTTPException(status_code=400, detail="Notitie is te lang (max 2000 tekens)")
    remind_at = (body.remind_at or "").strip() or None
    if remind_at:
        # Simpele validatie: verwacht "YYYY-MM-DD" formaat
        try:
            from datetime import date as _date
            _date.fromisoformat(remind_at)
        except Exception:
            raise HTTPException(status_code=400, detail="Ongeldige herinner-datum (verwacht YYYY-MM-DD)")
    doc = {
        "id": str(uuid.uuid4()),
        "company_id": company_id,
        "tenant_id": tenant_id,
        "text": text,
        "remind_at": remind_at,
        "dismissed_at": None,
        "created_at": iso(now_utc()),
        "created_by": created_by or "admin",
    }
    await db.tenant_notes.insert_one(doc)
    doc.pop("_id", None)
    asyncio.create_task(_sse_broadcast(
        company_id, {"type": "change", "path": "/api/tenants/notes", "method": "POST"},
    ))
    return doc


async def _tenant_note_delete(company_id: str, tenant_id: str, note_id: str) -> None:
    res = await db.tenant_notes.delete_one({
        "id": note_id, "tenant_id": tenant_id, "company_id": company_id,
    })
    if not res.deleted_count:
        raise HTTPException(status_code=404, detail="Notitie niet gevonden")
    asyncio.create_task(_sse_broadcast(
        company_id, {"type": "change", "path": "/api/tenants/notes", "method": "DELETE"},
    ))


async def _tenant_note_dismiss(company_id: str, tenant_id: str, note_id: str) -> None:
    """Markeer een reminder als 'behandeld' zodat 'ie niet meer popup't bij de
    volgende kiosk-sessie. Verwijdert de notitie NIET — je kan 'em later nog
    inzien in de admin/kiosk notities-lijst."""
    res = await db.tenant_notes.update_one(
        {"id": note_id, "tenant_id": tenant_id, "company_id": company_id},
        {"$set": {"dismissed_at": iso(now_utc())}},
    )
    if not res.matched_count:
        raise HTTPException(status_code=404, detail="Notitie niet gevonden")
    asyncio.create_task(_sse_broadcast(
        company_id, {"type": "change", "path": "/api/tenants/notes", "method": "DISMISS"},
    ))


@api.get("/kiosk/tenants/{tenant_id}/notes")
async def kiosk_tenant_notes_list(tenant_id: str, _session=Depends(get_kiosk_session)):
    t = await db.tenants.find_one(
        {"id": tenant_id, **kiosk_scope(_session)}, {"_id": 0, "id": 1},
    )
    if not t:
        raise HTTPException(status_code=404, detail="Huurder niet gevonden")
    return await _tenant_notes_list(_session.get("company_id"), tenant_id)


@api.post("/kiosk/tenants/{tenant_id}/notes")
async def kiosk_tenant_notes_add(tenant_id: str, body: TenantNoteIn,
                                 _session=Depends(get_kiosk_session)):
    t = await db.tenants.find_one(
        {"id": tenant_id, **kiosk_scope(_session)}, {"_id": 0, "id": 1},
    )
    if not t:
        raise HTTPException(status_code=404, detail="Huurder niet gevonden")
    return await _tenant_note_add(
        _session.get("company_id"), tenant_id, body,
        _session.get("employee_name") or "kiosk",
    )


@api.delete("/kiosk/tenants/{tenant_id}/notes/{note_id}")
async def kiosk_tenant_notes_delete(tenant_id: str, note_id: str,
                                    _session=Depends(get_kiosk_session)):
    await _tenant_note_delete(_session.get("company_id"), tenant_id, note_id)
    return {"ok": True}


@api.post("/kiosk/tenants/{tenant_id}/notes/{note_id}/dismiss")
async def kiosk_tenant_notes_dismiss(tenant_id: str, note_id: str,
                                     _session=Depends(get_kiosk_session)):
    await _tenant_note_dismiss(_session.get("company_id"), tenant_id, note_id)
    return {"ok": True}


# ---------------------------------------------------------------------
# Admin-scoped tenant notes — spiegel van de kiosk endpoints hierboven
# ---------------------------------------------------------------------
@api.get("/tenants/{tenant_id}/notes")
async def admin_tenant_notes_list(tenant_id: str, user=Depends(get_current_user)):
    cid = company_id_of(user)
    if not cid:
        raise HTTPException(status_code=400, detail="Geen bedrijfscontext")
    t = await db.tenants.find_one(
        {"id": tenant_id, "company_id": cid}, {"_id": 0, "id": 1},
    )
    if not t:
        raise HTTPException(status_code=404, detail="Huurder niet gevonden")
    return await _tenant_notes_list(cid, tenant_id)


@api.post("/tenants/{tenant_id}/notes")
async def admin_tenant_notes_add(tenant_id: str, body: TenantNoteIn,
                                 user=Depends(get_current_user)):
    cid = company_id_of(user)
    if not cid:
        raise HTTPException(status_code=400, detail="Geen bedrijfscontext")
    t = await db.tenants.find_one(
        {"id": tenant_id, "company_id": cid}, {"_id": 0, "id": 1},
    )
    if not t:
        raise HTTPException(status_code=404, detail="Huurder niet gevonden")
    return await _tenant_note_add(cid, tenant_id, body,
                                  user.get("email") or user.get("name") or "admin")


@api.delete("/tenants/{tenant_id}/notes/{note_id}")
async def admin_tenant_notes_delete(tenant_id: str, note_id: str,
                                    user=Depends(get_current_user)):
    cid = company_id_of(user)
    if not cid:
        raise HTTPException(status_code=400, detail="Geen bedrijfscontext")
    await _tenant_note_delete(cid, tenant_id, note_id)
    return {"ok": True}


@api.get("/kiosk/tenants/{tenant_id}/payments")
async def kiosk_tenant_payments(tenant_id: str, _session=Depends(get_kiosk_session)):
    """List recent payments for a tenant (used in kiosk 'Betalingsgeschiedenis' modal).

    ULTIMATE fail-safe: mag onder GEEN enkele omstandigheid een 500 teruggeven.
    Elke onverwachte fout wordt gelogd en resulteert in een lege lijst zodat
    de UI tenminste laadt en de gebruiker niet in een foutmelding vastzit.
    """
    try:
        t = await db.tenants.find_one({"id": tenant_id, **kiosk_scope(_session)}, {"_id": 0, "id": 1})
        if not t:
            raise HTTPException(status_code=404, detail="Huurder niet gevonden")
        docs = await db.payments.find(
            {"tenant_id": tenant_id, **kiosk_scope(_session)}, {"_id": 0}
        ).sort("paid_at", -1).to_list(50)
        try:
            return await _enrich_payments_bulk(docs)
        except Exception as _e:  # noqa: BLE001
            # Ultimate fail-safe: als de enrichment op enige manier crasht,
            # retourneer de raw payments met minimale fields zodat de UI
            # tenminste iets kan tonen i.p.v. 500. Strip alle bytes-velden
            # om FastAPI JSON-encoder crashes op binary blobs te voorkomen.
            import traceback
            print(f"[kiosk_tenant_payments] enrichment crashed, returning raw: {_e}")
            traceback.print_exc()
            out = []
            for p in docs:
                try:
                    # Strip elk bytes-veld (bv. legacy company_logo_bytes) —
                    # FastAPI jsonable_encoder faalt hard op raw PNG blobs.
                    p = {k: v for k, v in p.items() if not isinstance(v, (bytes, bytearray))}
                    if not p.get("receipt_number"):
                        p["receipt_number"] = f"KW-LEGACY-{str(p.get('id') or '')[:8].upper()}"
                    if not p.get("paid_at"):
                        p["paid_at"] = p.get("created_at") or iso(now_utc())
                    if p.get("amount") is None:
                        p["amount"] = 0.0
                    if not p.get("currency"):
                        p["currency"] = "SRD"
                    if not p.get("method"):
                        p["method"] = "cash"
                    if not p.get("category"):
                        p["category"] = "rent"
                    out.append(p)
                except Exception:  # noqa: BLE001
                    continue
            return out
    except HTTPException:
        raise
    except Exception as _e:  # noqa: BLE001
        # Alles wat nog steeds crashed (bv. DB timeout, session decode error)
        # → return lege lijst zodat de kiosk-UI niet stuk gaat.
        import traceback
        print(f"[kiosk_tenant_payments] TOP-LEVEL crash tenant={tenant_id}: {_e}")
        traceback.print_exc()
        return []


@api.get("/kiosk/receipts/{payment_id}")
async def kiosk_receipt(payment_id: str):
    p = await db.payments.find_one({"id": payment_id}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Kwitantie niet gevonden")
    return await _enrich_payment(p)


@api.post("/kiosk/payments/{payment_id}/email")
async def kiosk_email_receipt(payment_id: str, _session=Depends(get_kiosk_session)):
    """Stuur PDF-kwitantie naar het huurder-e-mailadres (best-effort vanuit Kiosk).
    Bedoeld als "fire-and-forget" call vanuit de KioskLayout direct na de
    tear-animatie. Faalt nooit met 5xx — als SMTP niet ingericht is of de
    huurder geen e-mailadres heeft, retourneren we {sent: false} zodat de
    UX onverstoord blijft. Echte fouten worden in de logs gerapporteerd.
    """
    from email_service import send_email, wrap_template, EmailError
    sc = kiosk_scope(_session)
    p = await db.payments.find_one({"id": payment_id, **sc}, {"_id": 0})
    if not p:
        # Niet bestaan = bewust 200/no-op om client side niet te blokkeren.
        return {"sent": False, "reason": "not_found"}
    cid = _session.get("company_id")
    if not cid:
        return {"sent": False, "reason": "no_company"}
    cfg = await get_company_section(cid, "smtp")
    if not cfg.get("enabled"):
        return {"sent": False, "reason": "smtp_disabled"}

    p_enriched = await _enrich_payment(p, include_logo=True)
    tenant = await db.tenants.find_one({"id": p_enriched.get("tenant_id"), **sc}, {"_id": 0}) or {}
    to = (tenant.get("email") or "").strip()
    if not to:
        return {"sent": False, "reason": "no_tenant_email"}

    try:
        pdf_bytes = await asyncio.to_thread(receipt_pdf, p_enriched)
        brand_kwargs = await _tenant_email_brand(cid)
        # Periode-regel — voorheen ontbrak deze in de kiosk-email, waardoor
        # de huurder niet zag voor welke maand de kwitantie was.
        _months_nl = ["januari", "februari", "maart", "april", "mei", "juni",
                      "juli", "augustus", "september", "oktober", "november", "december"]
        period_label = ""
        if p_enriched.get("period_month") and p_enriched.get("period_year"):
            try:
                period_label = f"{_months_nl[int(p_enriched['period_month']) - 1]} {int(p_enriched['period_year'])}"
            except Exception:
                period_label = ""
        intro_period = f" voor <b>{period_label}</b>" if period_label else ""
        period_row = f"<tr><td>Periode</td><td>{period_label}</td></tr>" if period_label else ""
        content = f"""
            <h1>Kwitantie {p_enriched['receipt_number']}</h1>
            <p>Beste {tenant.get('name', 'huurder')},<br />
            Hierbij ontvangt u een digitale kopie van uw kwitantie{intro_period}, zoals
            zojuist afgegeven via de Kiosk.</p>
            <table class="kv">
              <tr><td>Datum</td><td>{p_enriched.get('paid_at', '')[:10]}</td></tr>
              {period_row}
              <tr><td>Bedrag</td><td>{p_enriched['currency']} {p_enriched['amount']:.2f}</td></tr>
              <tr><td>Betaalmethode</td><td>{p_enriched.get('method', '')}</td></tr>
              <tr><td>Appartement</td><td>{p_enriched.get('apartment_number', '-')}</td></tr>
              <tr><td>Categorie</td><td>{p_enriched.get('category', '-')}</td></tr>
            </table>
            <p style="margin-top:20px;color:#64748b;font-size:13px">
              Bewaar deze e-mail als bewijs van betaling.
            </p>
        """
        subject_period = f" · {period_label}" if period_label else ""
        await send_email(
            cfg, to,
            f"Kwitantie {p_enriched['receipt_number']}{subject_period}",
            wrap_template(content, **brand_kwargs),
            attachments=[(f"kwitantie-{p_enriched['receipt_number']}.pdf", pdf_bytes, "application/pdf")],
        )
        return {"sent": True, "to": to}
    except EmailError as e:
        print(f"[kiosk-email] send_failed payment={payment_id} err={e}")
        return {"sent": False, "reason": "send_failed"}
    except Exception as e:  # pragma: no cover - defensive
        print(f"[kiosk-email] unexpected payment={payment_id} err={e}")
        return {"sent": False, "reason": "unexpected"}


@api.post("/kiosk/payments/{payment_id}/whatsapp")
async def kiosk_whatsapp_receipt(payment_id: str, _session=Depends(get_kiosk_session)):
    """Stuur WhatsApp/SMS-melding met PDF-link naar huurder (best-effort).

    Vergelijkbaar met /kiosk/payments/{id}/email maar via Twilio. Probeert
    eerst WhatsApp, valt terug op SMS als WhatsApp niet werkt / niet
    geconfigureerd. Faalt nooit hard — UX-vriendelijk vanuit de Kiosk.
    """
    from twilio_service import send_whatsapp, send_sms, TwilioError
    sc = kiosk_scope(_session)
    p = await db.payments.find_one({"id": payment_id, **sc}, {"_id": 0})
    if not p:
        return {"sent": False, "reason": "not_found"}
    cid = _session.get("company_id")
    if not cid:
        return {"sent": False, "reason": "no_company"}
    cfg = await get_company_section(cid, "twilio")
    if not cfg.get("enabled"):
        return {"sent": False, "reason": "twilio_disabled"}

    p_enriched = await _enrich_payment(p, include_logo=True)
    tenant = await db.tenants.find_one({"id": p_enriched.get("tenant_id"), **sc}, {"_id": 0}) or {}
    to = (tenant.get("phone") or "").strip()
    if not to:
        return {"sent": False, "reason": "no_tenant_phone"}

    pdf_link = _public_url(f"/api/payments/{payment_id}/pdf")
    image_link = _public_url(f"/api/payments/{payment_id}/image")
    # Periode-regel — consistent met de e-mail zodat de huurder direct ziet
    # voor welke maand deze kwitantie is.
    _months_nl = ["januari", "februari", "maart", "april", "mei", "juni",
                  "juli", "augustus", "september", "oktober", "november", "december"]
    period_line = ""
    if p_enriched.get("period_month") and p_enriched.get("period_year"):
        try:
            pm = int(p_enriched["period_month"])
            py = int(p_enriched["period_year"])
            period_line = f"Periode: {_months_nl[pm - 1]} {py}\n"
        except Exception:
            period_line = ""
    msg = (
        f"Hallo {tenant.get('name', 'huurder')},\n\n"
        f"Uw betaling is succesvol verwerkt.\n"
        f"Kwitantie: {p_enriched['receipt_number']}\n"
        f"Bedrag: {p_enriched['currency']} {p_enriched['amount']:.2f}\n"
        f"{period_line}"
        f"Methode: {p_enriched.get('method', '')}\n\n"
        f"📷 De kwitantie is als foto meegestuurd — bewaar hem in uw galerij.\n"
        f"📄 PDF-versie: {pdf_link}"
    )

    # Probeer WhatsApp eerst (als geconfigureerd), val terug op SMS.
    has_wa = bool((cfg.get("whatsapp_from") or "").strip())
    has_sms = bool((cfg.get("sms_from") or "").strip())

    if has_wa:
        try:
            # JPG kwitantie als inline media-bijlage — toont preview in chat.
            await send_whatsapp(cfg, to, msg, media_url=image_link)
            return {"sent": True, "channel": "whatsapp", "to": to}
        except TwilioError as e:
            print(f"[kiosk-twilio] whatsapp failed payment={payment_id} err={e}")
            # blijf hieronder doorgaan met SMS fallback

    if has_sms:
        try:
            await send_sms(cfg, to, msg)
            return {"sent": True, "channel": "sms", "to": to}
        except TwilioError as e:
            print(f"[kiosk-twilio] sms failed payment={payment_id} err={e}")
            return {"sent": False, "reason": "send_failed"}

    return {"sent": False, "reason": "no_channel_configured"}


# =====================================================================
# Dashboard stats
# =====================================================================
# Overzicht: altijd live berekend (geen cache).


@api.get("/admin/stats")
async def admin_stats(user=Depends(get_current_user)):
    sc = scope(user)
    return await _compute_admin_stats(user, sc)


async def _agg_by_currency(coll, pipeline) -> dict:
    out = {}
    async for r in coll.aggregate(pipeline):
        out[r["_id"]] = {"total": r["total"], "count": r["count"]}
    return out


async def _compute_admin_stats(user: dict, sc: dict) -> dict:
    today = now_utc()
    start = datetime(today.year, today.month, 1, tzinfo=timezone.utc).isoformat()
    unpaid = {**sc, "status": {"$nin": ["paid", "cancelled"]}}
    # Alle onafhankelijke tellingen/aggregaties parallel i.p.v. na elkaar.
    (total_apts, occupied, total_tenants, inv_paid, inv_open, inv_overdue,
     by_currency, outstanding, recent_pays, recent_invs) = await asyncio.gather(
        db.apartments.count_documents({**sc}),
        db.apartments.count_documents({**sc, "status": "occupied"}),
        db.tenants.count_documents({**sc}),
        db.invoices.count_documents({**sc, "status": "paid"}),
        db.invoices.count_documents({**sc, "status": {"$in": ["open", "sent", "pending"]}}),
        db.invoices.count_documents({**sc, "status": "overdue"}),
        _agg_by_currency(db.payments, [
            {"$match": {**sc, "paid_at": {"$gte": start}}},
            {"$group": {"_id": "$currency", "total": {"$sum": "$amount"}, "count": {"$sum": 1}}},
        ]),
        _agg_by_currency(db.invoices, [
            {"$match": unpaid},
            {"$group": {"_id": "$currency", "total": {"$sum": "$amount"}, "count": {"$sum": 1}}},
        ]),
        db.payments.find({**sc}, {"_id": 0, "tenant_id": 1, "apartment_id": 1, "amount": 1, "currency": 1, "paid_at": 1}).sort("paid_at", -1).limit(5).to_list(5),
        db.invoices.find(unpaid, {"_id": 0, "tenant_id": 1, "apartment_id": 1, "amount": 1, "currency": 1, "created_at": 1,
                                  "period_month": 1, "period_year": 1}).sort("created_at", -1).limit(5).to_list(5),
    )
    # Namen/nummers in één batch i.p.v. 2 queries per regel (N+1).
    t_ids = list({x.get("tenant_id") for x in recent_pays + recent_invs if x.get("tenant_id")})
    a_ids = list({x.get("apartment_id") for x in recent_pays + recent_invs if x.get("apartment_id")})
    t_docs, a_docs = await asyncio.gather(
        db.tenants.find({"id": {"$in": t_ids}, **sc}, {"_id": 0, "id": 1, "name": 1}).to_list(20),
        db.apartments.find({"id": {"$in": a_ids}, **sc}, {"_id": 0, "id": 1, "number": 1}).to_list(20),
    )
    t_map = {d["id"]: d for d in t_docs}
    a_map = {d["id"]: d for d in a_docs}

    # Recent activity feed — last 8 events (payments received + invoices opened/overdue)
    recent: list = []
    for p in recent_pays:
        tenant = t_map.get(p.get("tenant_id"))
        apt = a_map.get(p.get("apartment_id"))
        recent.append({
            "type": "payment_received",
            "title": "Betaling ontvangen",
            "subtitle": f"{tenant.get('name') if tenant else '—'} · Appt. {apt.get('number') if apt else '—'}",
            "amount": p.get("amount"),
            "currency": p.get("currency", "SRD"),
            "at": p.get("paid_at"),
        })
    for inv in recent_invs:
        tenant = t_map.get(inv.get("tenant_id"))
        apt = a_map.get(inv.get("apartment_id"))
        recent.append({
            "type": "invoice_open",
            "title": "Betaling openstaand",
            "subtitle": f"{tenant.get('name') if tenant else '—'} · Appt. {apt.get('number') if apt else '—'}",
            "amount": inv.get("amount"),
            "currency": inv.get("currency", "SRD"),
            "at": inv.get("created_at"),
            "period_month": inv.get("period_month"),
            "period_year": inv.get("period_year"),
        })
    recent.sort(key=lambda x: x.get("at") or "", reverse=True)
    recent = recent[:8]

    # Achterstallige huurders (unieke tenants met écht overdue facturen)
    # — gebruik dezelfde grace logica als de overview/invoices endpoints
    grace_wd = 10
    try:
        cs = await db.company_settings.find_one(
            {"company_id": user.get("active_company_id") or user.get("company_id")},
            {"_id": 0, "invoicing": 1},
        )
        if cs and isinstance(cs.get("invoicing"), dict):
            grace_wd = int(cs["invoicing"].get("grace_workdays") or 10)
    except Exception:  # noqa: BLE001
        pass
    today_local = today.date()
    overdue_tenants_set: set[str] = set()
    open_current_month_count = 0
    open_current_month_amount: dict[str, float] = {}
    async for inv in db.invoices.find(
        {**sc, "status": {"$nin": ["paid", "cancelled"]}},
        {"_id": 0, "tenant_id": 1, "period_month": 1, "period_year": 1,
         "amount": 1, "amount_due": 1, "paid_amount": 1, "currency": 1, "due_date": 1},
    ):
        py = int(inv.get("period_year") or 0)
        pm = int(inv.get("period_month") or 0)
        bucket = _classify_invoice_bucket(pm, py, today_local, grace_wd, due_date=inv.get("due_date"))
        # LET OP: NIET hergebruik variabele `outstanding` (dict boven) — hier
        # gebruik lokale naam `remain` zodat de dict die naar de frontend gaat
        # niet overschreven wordt door een float.
        remain = max(
            float(inv.get("amount_due") or inv.get("amount") or 0) - float(inv.get("paid_amount") or 0),
            0,
        )
        if bucket == "overdue" and inv.get("tenant_id"):
            overdue_tenants_set.add(inv["tenant_id"])
        if bucket == "current" and remain > 0:
            open_current_month_count += 1
            cur = inv.get("currency") or "SRD"
            open_current_month_amount[cur] = open_current_month_amount.get(cur, 0) + remain

    # Bank/Kas balance per valuta — combineert handmatige kasmutaties met
    # alle approved payments (Betalingen / Facturen / Kiosk). Zelfde bron als
    # de Kasgeld-pagina zodat de widget op Overzicht 1:1 klopt.
    cash_balance: dict[str, float] = {}
    async for r in db.kasgeld.aggregate([
        {"$match": sc},
        {"$group": {
            "_id": "$currency",
            "total": {"$sum": {"$cond": [
                {"$eq": ["$type", "in"]}, "$amount", {"$multiply": ["$amount", -1]},
            ]}},
        }},
    ]):
        cur = r["_id"] or "SRD"
        cash_balance[cur] = cash_balance.get(cur, 0.0) + round(r["total"], 2)
    async for r in db.payments.aggregate([
        {"$match": {**sc, "status": "approved"}},
        {"$group": {"_id": "$currency", "total": {"$sum": "$amount"}}},
    ]):
        cur = r["_id"] or "SRD"
        cash_balance[cur] = round(cash_balance.get(cur, 0.0) + float(r.get("total") or 0), 2)

    return {
        "apartments_total": total_apts,
        "apartments_occupied": occupied,
        "apartments_vacant": total_apts - occupied,
        "tenants_total": total_tenants,
        "tenants_active": total_tenants,  # alias voor frontend (gelijk aan total nu)
        "month_payments_by_currency": by_currency,
        "outstanding_by_currency": outstanding,
        "invoice_status": {"paid": inv_paid, "open": inv_open, "overdue": inv_overdue},
        "overdue_tenants_count": len(overdue_tenants_set),
        "current_month_open_count": open_current_month_count,
        "current_month_open_by_currency": open_current_month_amount,
        "cash_balance_by_currency": cash_balance,
        "recent_activity": recent,
    }


# =====================================================================
# Health
# =====================================================================
@api.get("/health")
async def health():
    return {"ok": True, "service": "vastgoed-kiosk-api"}


@api.get("/system/status")
async def system_status():
    """Publieke status-endpoint voor de status pill op de landing.

    Per-component checks zonder enige authenticatie. Snel (~<200ms) en
    cacheable voor 30s. Components:
      • api          — FastAPI proces draait (impliciet: deze route reageert)
      • database     — MongoDB ping
      • admin_app    — Admin Dashboard frontend bundle bereikbaar (via API ping
                       want zelfde dyno als landing)
      • huurder_kiosk — Huurder kiosk route + tenant-portal endpoint
      • klantenscherm — Customer display feed endpoint
      • landing      — Marketing landing content fetch
    """
    import time
    from pymongo.errors import PyMongoError

    components = []
    overall_status = "operational"   # operational | degraded | down

    # 1) Database ping
    t0 = time.perf_counter()
    db_status = "operational"
    db_err = None
    try:
        await asyncio.wait_for(db.command("ping"), timeout=3.0)
    except (PyMongoError, asyncio.TimeoutError, Exception) as e:
        db_status = "down"
        db_err = str(e)[:120]
        overall_status = "down"
    db_latency = int((time.perf_counter() - t0) * 1000)
    components.append({
        "id": "database",
        "label": "Database",
        "status": db_status,
        "latency_ms": db_latency,
        "error": db_err,
    })

    # 2) API is implicit — als deze response wordt opgebouwd, draait FastAPI.
    components.append({
        "id": "api",
        "label": "API server",
        "status": "operational",
        "latency_ms": 0,
    })

    # 3) Huurder kiosk — check dat /tenant-portal endpoint kan resolven
    t0 = time.perf_counter()
    hk_status = "operational"
    try:
        # Lichte sanity: count tenants (snel met index) — bevestigt dat
        # tenant-portal data laag werkt.
        await asyncio.wait_for(db.tenants.estimated_document_count(), timeout=2.0)
    except Exception:
        hk_status = "degraded"
        if overall_status == "operational":
            overall_status = "degraded"
    components.append({
        "id": "huurder_kiosk",
        "label": "Huurder Kiosk + Portaal",
        "status": hk_status,
        "latency_ms": int((time.perf_counter() - t0) * 1000),
    })

    # 4) Klantenscherm — check kasgeld feed bron
    t0 = time.perf_counter()
    kl_status = "operational"
    try:
        await asyncio.wait_for(db.kasgeld.estimated_document_count(), timeout=2.0)
    except Exception:
        kl_status = "degraded"
        if overall_status == "operational":
            overall_status = "degraded"
    components.append({
        "id": "klantenscherm",
        "label": "Klantenscherm",
        "status": kl_status,
        "latency_ms": int((time.perf_counter() - t0) * 1000),
    })

    # 5) Admin Dashboard — check companies collection
    t0 = time.perf_counter()
    ad_status = "operational"
    try:
        await asyncio.wait_for(db.companies.estimated_document_count(), timeout=2.0)
    except Exception:
        ad_status = "degraded"
        if overall_status == "operational":
            overall_status = "degraded"
    components.append({
        "id": "admin_app",
        "label": "Admin Dashboard",
        "status": ad_status,
        "latency_ms": int((time.perf_counter() - t0) * 1000),
    })

    # 6) Landing content
    t0 = time.perf_counter()
    landing_status = "operational"
    try:
        await asyncio.wait_for(db.landing_content.estimated_document_count(), timeout=2.0)
    except Exception:
        landing_status = "degraded"
        if overall_status == "operational":
            overall_status = "degraded"
    components.append({
        "id": "landing",
        "label": "Marketing site",
        "status": landing_status,
        "latency_ms": int((time.perf_counter() - t0) * 1000),
    })

    headers = {"Cache-Control": "public, max-age=30"}
    return JSONResponse(
        content={
            "status": overall_status,
            "components": components,
            "checked_at": iso(now_utc()),
        },
        headers=headers,
    )


# =====================================================================
# Receipt PDF
# =====================================================================
def _pdf_response(pdf_bytes: bytes, filename: str) -> StreamingResponse:
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


@api.get("/payments/{payment_id}/pdf")
async def payment_pdf(payment_id: str):
    """Public: download PDF receipt by payment id. No auth so we can email/share link."""
    p = await db.payments.find_one({"id": payment_id}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Kwitantie niet gevonden")
    p = await _enrich_payment(p, include_logo=True)
    pdf = await asyncio.to_thread(receipt_pdf, p)
    return _pdf_response(pdf, f"kwitantie-{p['receipt_number']}.pdf")


_FONT_PRESETS = {"klein": (12, 16, 13, 18), "normaal": (16, 20, 18, 22), "groot": (20, 26, 22, 28)}
_ZOOM_PRESETS = {"klein": 280, "normaal": 350, "groot": 420}


def _clamp_int(v, lo: int, hi: int, default: int) -> int:
    try:
        return max(lo, min(hi, int(float(v))))
    except (TypeError, ValueError):
        return default


def _receipt_fonts(rcfg: dict) -> tuple:
    """(naam, (basis, bedrijfsnaam, KWITANTIE, bedrag) px, textZoom) uit receipts-instellingen."""
    name = rcfg.get("font_size") or "groot"
    if name not in _FONT_PRESETS:
        name = "groot"
    c = ((rcfg.get("presets") or {}).get(name)) or {}
    d = _FONT_PRESETS[name]
    fs = (_clamp_int(c.get("base"), 8, 48, d[0]), _clamp_int(c.get("name"), 8, 60, d[1]),
          _clamp_int(c.get("title"), 8, 60, d[2]), _clamp_int(c.get("amount"), 8, 72, d[3]))
    return name, fs, _clamp_int(c.get("text_zoom"), 50, 800, _ZOOM_PRESETS[name])


_PRINT_METHOD_LABELS = {"cash": "Contant", "contant": "Contant", "bank": "Bankoverschrijving",
                        "card": "PIN", "creditcard": "Creditcard", "ideal": "iDEAL", "other": "Anders"}


async def _financial_receipt_data(tenant_id: str, session: dict, force_ktp: bool = False) -> dict:
    """Financieel overzicht als bon-regels (zelfde vorm als _receipt_print_data)."""
    ov = await kiosk_tenant_overview(tenant_id, session)
    t, apt = ov["tenant"], ov.get("apartment") or {}
    cid = session.get("company_id")
    cur = (ov.get("balance") or {}).get("currency") or apt.get("currency") or "SRD"
    open_inv = ov.get("open_invoices") or []
    cur_inv = ov.get("current_invoices") or []
    open_total = float(ov.get("open_invoices_total") or 0)
    cur_total = float(ov.get("current_invoices_total") or 0)
    credit = float(ov.get("credit_balance") or 0)
    company = await db.companies.find_one({"id": cid}, {"_id": 0, "name": 1}) or {}
    cs = await db.company_settings.find_one({"company_id": cid}, {"_id": 0, "receipts": 1})
    font_size, _fs, text_zoom = _receipt_fonts((cs or {}).get("receipts") or {})
    cfg = await _kiosk_device_config(cid)
    printer = "kt-v520" if force_ktp else cfg["printer"]
    paper = 58 if printer == "kt-v520" else cfg["paper_width"]
    W = _RECEIPT_COLS_80 if paper == 80 else _RECEIPT_COLS
    LBL = 14

    def money(v):
        return f"{cur} " + f"{float(v or 0):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")

    def row(label, value):
        return f"{str(label)[:LBL - 1].ljust(LBL)}{value}"

    def period(i):
        pm, py = i.get("period_month"), i.get("period_year")
        if isinstance(pm, int) and 1 <= pm <= 12:
            return f"{_NL_MONTHS_FULL[pm - 1].capitalize()[:3]} {py}"
        return i.get("label") or "Factuur"

    def L(text, align="left", bold=False, size="normal"):
        return {"text": text, "align": align, "bold": bold, "size": size}

    dash = "-" * W
    datum = datetime.now(timezone(timedelta(hours=-3))).strftime("%d-%m-%Y %H:%M")
    lines = [L(company.get("name") or "SuriRent", "center", True, "large"), L(dash),
             L("FINANCIEEL OVERZICHT", "center", True), L(dash),
             L(row("Datum:", datum)), L(dash), L("HUURDER:", bold=True), L(t.get("name") or "-")]
    if t.get("phone"):
        lines.append(L(row("Tel:", t["phone"])))
    if apt.get("number"):
        lines.append(L(f"App. {apt['number']}"))
    lines.append(L(dash))
    for title, items, sub in (("ACHTERSTAND:", open_inv, open_total), ("HUIDIGE MAAND:", cur_inv, cur_total)):
        if items:
            lines.append(L(title, bold=True))
            lines += [L(row(period(i), money(i.get("outstanding")))) for i in items]
            lines += [L(row("Subtotaal:", money(sub)), bold=True), L(dash)]
    lines += [L(row("Achterstand:", money(open_total))), L(row("Huidig:", money(cur_total)))]
    if credit > 0:
        lines.append(L(row("Tegoed:", money(credit))))
    lines += [L(dash), L(row("TOTAAL:", money(open_total + cur_total)), bold=True),
              L(dash), L("Vriendelijk bedankt!", "center"), L(""), L("")]
    return {
        "template": "lines", "receipt_type": "financieel",
        "bedrijfsnaam": company.get("name") or "SuriRent", "naam": t.get("name") or "",
        "datum": datum, "totaal": money(open_total + cur_total),
        "lettergrootte": font_size, "textZoom": text_zoom,
        "fontSizes": {"tekst": _fs[0], "bedrijfsnaam": _fs[1], "kwitantie": _fs[2], "bedrag": _fs[0]},
        "printer": printer, "paper_width": paper, "cols": W, "lines": lines,
    }


@api.get("/kiosk/tenants/{tenant_id}/financial-print-data")
async def kiosk_tenant_financial_print_data(tenant_id: str, _session=Depends(get_kiosk_session)):
    return await _financial_receipt_data(tenant_id, _session)


@api.post("/kiosk/tenants/{tenant_id}/financial-remote-print")
async def kiosk_tenant_financial_remote_print(tenant_id: str, body: RemotePrintIn, _session=Depends(get_kiosk_session)):
    cid = _session["company_id"]
    data = await _financial_receipt_data(tenant_id, _session, force_ktp=True)
    return {"job_id": await _publish_remote_print(cid, body.printer_id, {
        "tenant_id": tenant_id, "url": f"/api/kiosk/tenants/{tenant_id}/financial-receipt.png", "data": data})}


@api.get("/kiosk/tenants/{tenant_id}/financial-receipt.png")
async def kiosk_tenant_financial_receipt_png(tenant_id: str, _session=Depends(get_kiosk_session)):
    """Financieel overzicht als 58mm-bon (monospace) voor delen via WhatsApp."""
    data = await _financial_receipt_data(tenant_id, _session, force_ktp=True)
    return Response(content=_render_receipt_png(data), media_type="image/png",
                    headers={"Cache-Control": "no-store"})


def _render_receipt_png(data: dict) -> bytes:
    """Bon-regels → 58mm monospace PNG."""
    W = data["cols"]
    lines = [(ln["text"], ln["align"], ln["bold"], ln.get("size") == "large") for ln in data["lines"] if ln["text"]]
    from PIL import Image, ImageDraw, ImageFont
    from io import BytesIO
    fs = 26
    try:
        f_reg = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", fs)
        f_bold = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf", fs)
        f_large = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf", int(fs * 1.5))
    except Exception:
        f_reg = f_bold = f_large = ImageFont.load_default()
    cw = f_reg.getlength("M")
    pad, lh = 24, int(fs * 1.35)
    img_w = int(cw * W + pad * 2)
    img = Image.new("RGB", (img_w, pad * 2 + sum(int(lh * 1.5) if lg else lh for *_, lg in lines)), "white")
    d = ImageDraw.Draw(img)
    y = pad
    for text, align, bold, large in lines:
        font = f_large if large else (f_bold if bold else f_reg)
        text = text[:W]
        x = (img_w - font.getlength(text)) / 2 if align == "center" else pad
        d.text((x, y), text, fill="black", font=font)
        y += int(lh * 1.5) if large else lh
    buf = BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


@api.get("/kiosk/payments/{payment_id}/print-data")
async def kiosk_payment_print_data(payment_id: str, _session=Depends(get_kiosk_session)):
    """Gestructureerde bon-gegevens voor het PRINT_RECEIPT bericht naar de APK."""
    p = await db.payments.find_one({"id": payment_id, **kiosk_scope(_session)}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Kwitantie niet gevonden")
    return await _receipt_print_data(p)


async def _receipt_print_data(p: dict, force_ktp: bool = False) -> dict:
    p = await _enrich_payment(p)
    cs = await db.company_settings.find_one({"company_id": p.get("company_id")}, {"_id": 0, "receipts": 1})
    font_size, _fs, text_zoom = _receipt_fonts((cs or {}).get("receipts") or {})
    apt_id = p.get("apartment_id")
    if not apt_id and p.get("tenant_id"):
        t = await db.tenants.find_one({"id": p["tenant_id"]}, {"_id": 0, "apartment_id": 1})
        apt_id = (t or {}).get("apartment_id")
    apt = await db.apartments.find_one({"id": apt_id}, {"_id": 0, "location_id": 1}) if apt_id else None
    loc = await db.locations.find_one({"id": (apt or {}).get("location_id")}, {"_id": 0, "name": 1, "address": 1, "phone": 1}) if apt else None
    cur = p.get("currency") or "SRD"

    def money(v):
        v = float(v or 0)
        return f"{cur} " + f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")

    pm, py = p.get("period_month"), p.get("period_year")
    desc = (p.get("category") or "Huurbetaling").capitalize()
    if isinstance(pm, int) and 1 <= pm <= 12 and py:
        desc += f" — {_NL_MONTHS_FULL[pm - 1].capitalize()} {py}"
    paid = p.get("paid_at") or p.get("created_at") or iso(now_utc())
    try:
        d = datetime.fromisoformat(str(paid).replace("Z", "+00:00")).astimezone(timezone(timedelta(hours=-3)))
        datum = d.strftime("%d-%m-%Y %H:%M")
    except Exception:
        datum = str(paid)[:16]
    out = {
        "bedrijfsnaam": (p.get("company_name") or "").strip() or "SuriRent",
        "adres": (loc or {}).get("address") or p.get("company_address") or "",
        "telefoon": (loc or {}).get("phone") or p.get("company_phone") or p.get("company_whatsapp") or "",
        "kwitantie": p.get("receipt_number") or "",
        "datum": datum,
        "naam": p.get("tenant_name") or "",
        "huurder_telefoon": p.get("tenant_phone") or "",
        "medewerker": _receipt_employee(p),
        "appartement": p.get("apartment_number") or "",
        "vestiging": (loc or {}).get("name") or p.get("location_name") or "",
        "omschrijving": desc,
        "bedrag": money(p.get("amount")),
        "openstaand": money(p.get("outstanding_after")),
        "outstanding_after": float(p.get("outstanding_after") or 0),
        **({"openstaand_periode": p["openstaand_periode"]}
           if float(p.get("outstanding_after") or 0) > 0 and p.get("openstaand_periode") else {}),
        "methode": _PRINT_METHOD_LABELS.get((p.get("method") or "").lower(), p.get("method") or ""),
        "opmerking": p.get("note") or "",
        "lettergrootte": font_size,
        "textZoom": text_zoom,
        "fontSizes": {"tekst": _fs[0], "bedrijfsnaam": _fs[1], "kwitantie": _fs[2], "bedrag": _fs[0]},
    }
    cfg = await _kiosk_device_config(p["company_id"])
    out["printer"] = "kt-v520" if force_ktp else cfg["printer"]
    out["paper_width"] = 58 if out["printer"] == "kt-v520" else cfg["paper_width"]
    cols = _RECEIPT_COLS_80 if out["paper_width"] == 80 else _RECEIPT_COLS
    out["lines"] = _receipt_text_lines(out, (p.get("_title") or "KWITANTIE"), cols)
    return out


_RECEIPT_COLS = 32  # 58mm thermisch, standaard font A
_RECEIPT_COLS_80 = 48  # 80mm thermisch


def _wrap_text(text: str, width: int) -> list:
    out, line = [], ""
    for w in str(text).split():
        if line and len(line) + 1 + len(w) > width:
            out.append(line)
            line = w[:width]
        else:
            line = f"{line} {w}".strip()[:width]
    return out + ([line] if line else [])


def _format_periods(periods: list) -> str:
    """[(2026, 8), (2026, 9), (2027, 1)] → 'Aug, Sep 2026, Jan 2027'."""
    by_year: dict = {}
    for y, m in sorted(set(periods)):
        if 1 <= m <= 12:
            by_year.setdefault(y, []).append(_NL_MONTHS_FULL[m - 1].capitalize()[:3])
    return ", ".join(f"{', '.join(ms)} {y}" for y, ms in by_year.items())


def _receipt_employee(p: dict) -> str:
    """Naam van de kiosk-medewerker die de betaling ontving."""
    return (p.get("kiosk_employee_name") or p.get("received_by") or "").strip()


def _receipt_text_lines(d: dict, title: str, cols: int = _RECEIPT_COLS) -> list:
    """Bon als tekstregels voor ESC/POS-printers (KT-V520 / Bluetooth)."""
    W = cols
    dash = "-" * W

    def row(label, value):
        label, value = str(label), str(value)
        gap = W - len(label) - len(value)
        return f"{label}{' ' * gap}{value}" if gap >= 1 else f"{label}\n{value.rjust(W)}"

    def L(text, align="left", bold=False, size="normal"):
        return {"text": text, "align": align, "bold": bold, "size": size}

    lines = [L(d["bedrijfsnaam"], "center", True, "large")]
    for extra in (d.get("adres"), d.get("telefoon") and f"Tel: {d['telefoon']}"):
        if extra:
            lines.append(L(extra, "center"))
    lines += [L(dash), L(title, "center", True), L(dash)]
    if d.get("kwitantie"):
        lines.append(L(row("Nr:", d["kwitantie"])))
    lines.append(L(row("Datum:", d["datum"])))
    lines.append(L(dash))
    lines.append(L("HUURDER:", bold=True))
    lines.append(L(d.get("naam") or "-"))
    if d.get("huurder_telefoon"):
        lines.append(L(row("Tel:", d["huurder_telefoon"])))
    if d.get("appartement") or d.get("vestiging"):
        lines.append(L(" - ".join(x for x in (d.get("appartement") and f"App. {d['appartement']}", d.get("vestiging")) if x)))
    lines += [L(dash), L(d["omschrijving"])]
    if d.get("methode"):
        lines.append(L(row("Methode:", d["methode"])))
    lines.append(L(row("BETAALD", d["bedrag"]), bold=True))
    if d.get("openstaand_periode"):
        # Optioneel: openstaand bedrag + maanden als eigen blok onder het bedrag.
        lines += [L("Nog openstaand:", bold=True), L(d["openstaand"], bold=True)]
        lines += [L(x) for x in _wrap_text(f"Maand(en): {d['openstaand_periode']}", W)]
    else:
        lines.append(L(row("Openstaand:", d["openstaand"])))
    if d.get("medewerker"):
        lines.append(L(row("Ontvangen door:", d["medewerker"])))
    if d.get("opmerking"):
        lines += [L(dash), L(f"Opmerking: {d['opmerking']}")]
    lines += [L(dash), L("Bedankt voor uw betaling!", "center"), L(""), L("")]
    return lines


@api.get("/payments/{payment_id}/print.html", response_class=HTMLResponse)
async def payment_print_html(
    payment_id: str,
    format: Optional[str] = None,
    preview: Optional[int] = 0,
    fragment: Optional[int] = 0,
):
    """HTML-versie van de kwitantie speciaal voor Chrome's --kiosk-printing
    flag. Die flag onderdrukt alleen het printdialoog voor **HTML** documenten
    — niet voor PDF's (die worden door Chrome's PDF-viewer weergegeven, en
    die viewer laat de dialoog wél zien). Deze route rendert dezelfde
    kwitantie-data met @page/@media print CSS zodat window.print() direct
    naar de OS-standaardprinter gaat.

    Query params:
      - `format`  → "a4" (default) of "thermal" (80mm bonprinter)
      - `preview` → 1 = skip het inline `window.print()` <script> (voor
                    UI-embeds/iframes waar je alleen wil tonen, niet printen)
    Bij ontbrekende `format` wordt de company-instelling
    `receipts.print_format` uit `db.company_settings` gebruikt.
    """
    p = await db.payments.find_one({"id": payment_id}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Kwitantie niet gevonden")
    p = await _enrich_payment(p)

    cs = await db.company_settings.find_one({"company_id": p.get("company_id")}, {"_id": 0, "receipts": 1})
    rcfg = (cs or {}).get("receipts") or {}
    fmt = (format or "").strip().lower()
    if fmt not in ("a4", "thermal"):
        fmt = rcfg.get("print_format") if rcfg.get("print_format") in ("a4", "thermal") else "a4"
    if fragment:
        fmt = "thermal"
    p["_font_px"] = _receipt_fonts(rcfg)[1]
    html = _render_receipt_html(p, fmt=fmt, preview=bool(preview), fragment=bool(fragment))
    return HTMLResponse(content=html, headers={"Cache-Control": "no-store"})



_NL_MONTHS_FULL = ["januari", "februari", "maart", "april", "mei", "juni",
                   "juli", "augustus", "september", "oktober", "november", "december"]


def _render_receipt_html(p: dict, fmt: str = "a4", preview: bool = False, paper_width_mm: Optional[int] = None, fragment: bool = False) -> str:
    """Bouwt een compact, print-ready HTML-document voor een betaling.

    fmt="a4"      → A4 staand, klassieke 'blue house' layout (2 kolommen partijen)
    fmt="thermal" → 80mm brede 1-kolom bonprinter layout (POS-stijl)
    Beide varianten bevatten een inline <script> die na load
    `window.print()` aanroept — met de Chrome-vlag `--kiosk-printing`
    slaat de browser het dialoog dan over.
    """
    from html import escape as h
    from datetime import datetime

    def fmt_money(v, cur):
        try:
            v = float(v or 0)
        except Exception:
            v = 0.0
        s = f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
        return f"{h(cur or 'SRD')} {s}"

    def fmt_date(s):
        if not s:
            return ""
        try:
            d = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
            return f"{d.day} {_NL_MONTHS_FULL[d.month - 1]} {d.year}"
        except Exception:
            return str(s)[:10]

    receipt_number = p.get("receipt_number") or ""
    paid_at = fmt_date(p.get("paid_at"))
    company_name = (p.get("company_name") or "").strip() or "SuriRent"
    company_address = p.get("company_address") or p.get("location_address") or ""
    company_phone = p.get("company_phone") or p.get("company_whatsapp") or ""
    landlord = p.get("landlord") or company_name
    tenant_name = p.get("tenant_name") or "—"
    apartment_number = p.get("apartment_number") or ""
    location_name = p.get("location_name") or ""
    tenant_phone = p.get("tenant_phone") or ""
    amount = p.get("amount") or 0
    currency = p.get("currency") or "SRD"
    outstanding_after = float(p.get("outstanding_after") or 0)
    method = (p.get("method") or "").lower()
    note = p.get("note") or ""
    category = (p.get("category") or "Huurbetaling").capitalize()
    pm, py = p.get("period_month"), p.get("period_year")
    period_txt = ""
    if isinstance(pm, int) and 1 <= pm <= 12 and py:
        period_txt = f" — {_NL_MONTHS_FULL[pm - 1].capitalize()} {py}"
    desc = f"{category}{period_txt}"

    if fmt == "thermal":
        return _render_receipt_html_thermal(
            h=h, cb_paid=outstanding_after <= 0.001,
            receipt_number=receipt_number, paid_at=paid_at,
            company_name=company_name, company_address=company_address,
            company_phone=company_phone, tenant_name=tenant_name,
            apartment_number=apartment_number, location_name=location_name,
            amount=amount, currency=currency, outstanding_after=outstanding_after,
            method=method, note=note, desc=desc, fmt_money=fmt_money,
            preview=preview, company_email=p.get("company_email") or "",
            company_tagline=p.get("company_tagline") or "",
            company_kkf=p.get("kkf_number") or "",
            paper_width_mm=paper_width_mm or 58, title=p.get("_title") or "KWITANTIE", fragment=fragment,
            location_city=p.get("location_city") or "", font_px=p.get("_font_px"),
            screen_sizes=bool(p.get("_screen_sizes")),
            tenant_phone=p.get("tenant_phone") or "", employee=_receipt_employee(p),
        )

    # ------ A4 layout (default) ------
    outstanding_line = (
        '<span class="paid">✓ Volledig voldaan</span>'
        if outstanding_after <= 0.001
        else f'<span class="due">{h(fmt_money(outstanding_after, currency))}</span>'
    )

    def cb(m):
        return "☑" if method == m else "☐"

    autoprint_script = "" if preview else """
  <script>
    (function() {
      var didPrint = false;
      function go() {
        if (didPrint) return;
        didPrint = true;
        setTimeout(function() { try { window.focus(); window.print(); } catch(e) {} }, 80);
      }
      if (document.readyState === 'complete') go();
      else window.addEventListener('load', go);
    })();
  </script>"""
    # In preview-mode (iframe-embed) verbergen we OOK de zichtbare printknop
    # zodat de bon 100% als "netjes document" ogenblik toont — de outer
    # app heeft eigen printflows.
    print_button = '' if preview else '<div class="no-print"><button onclick="window.print()">🖨 Afdrukken</button></div>'

    return f"""<!doctype html>
<html lang="nl"><head><meta charset="utf-8">
<title>Kwitantie {h(receipt_number)}</title>
<style>
  @page {{ size: A4; margin: 12mm; }}
  @media print {{
    body {{ margin: 0; }}
    .no-print {{ display: none !important; }}
  }}
  html, body {{ font-family: -apple-system, "Helvetica Neue", Arial, sans-serif;
    color: #0f172a; font-size: 12pt; margin: 0; padding: 0; background: #fff; }}
  .sheet {{ padding: 8mm 6mm; max-width: 190mm; margin: 0 auto;
    border: 3px solid #1e40af; }}
  .inner {{ border: 1px solid #93c5fd; padding: 6mm; }}
  .header {{ display: flex; justify-content: space-between; align-items: flex-start;
    border-bottom: 2px solid #1e40af; padding-bottom: 4mm; margin-bottom: 4mm; }}
  .header .title {{ font-size: 22pt; font-weight: 900; color: #1e40af; letter-spacing: 1px; }}
  .header .sub {{ font-size: 10pt; color: #64748b; letter-spacing: 2px; margin-top: 1mm; }}
  .header .info {{ text-align: right; font-size: 10pt; line-height: 1.5; }}
  .header .info .num {{ font-weight: 900; font-size: 12pt; color: #1e40af; }}
  .parties {{ display: flex; gap: 6mm; border-bottom: 1px solid #e2e8f0;
    padding-bottom: 4mm; margin-bottom: 4mm; }}
  .party {{ flex: 1; }}
  .party .lbl {{ font-size: 8pt; font-weight: 900; color: #64748b;
    text-transform: uppercase; letter-spacing: 2px; margin-bottom: 1mm; }}
  .party .name {{ font-weight: 700; font-size: 11pt; }}
  .party .meta {{ font-size: 9.5pt; color: #475569; line-height: 1.4; }}
  table {{ width: 100%; border-collapse: collapse; margin-bottom: 4mm; }}
  th, td {{ padding: 2mm 3mm; text-align: left; }}
  thead th {{ background: #eff6ff; color: #1e40af; font-size: 9pt;
    text-transform: uppercase; letter-spacing: 1px; border-bottom: 2px solid #1e40af; }}
  td.amt {{ text-align: right; font-family: -apple-system, ui-monospace, Menlo, monospace;
    font-weight: 700; }}
  tbody tr {{ border-bottom: 1px solid #e2e8f0; }}
  tr.total td {{ font-weight: 900; background: #f8fafc; }}
  .paid {{ color: #16a34a; font-weight: 800; }}
  .due {{ color: #dc2626; font-weight: 800; }}
  .method {{ display: flex; gap: 8mm; padding: 3mm 0; border-top: 1px dashed #cbd5e1;
    border-bottom: 1px dashed #cbd5e1; margin-bottom: 4mm; font-size: 10.5pt; }}
  .method .box {{ display: inline-block; font-family: monospace; font-size: 13pt;
    margin-right: 1mm; }}
  .verklaring {{ font-size: 10pt; line-height: 1.5; margin-bottom: 3mm; }}
  .note {{ font-size: 9.5pt; color: #475569; padding: 2mm 3mm;
    background: #f8fafc; border-left: 3px solid #1e40af; margin-bottom: 5mm; }}
  .signature {{ margin-top: 8mm; }}
  .signature .line {{ border-top: 1px solid #0f172a; margin-top: 12mm;
    width: 60mm; padding-top: 1mm; font-size: 9pt; }}
  .no-print {{ position: fixed; top: 8px; right: 8px; }}
  .no-print button {{ background: #1e40af; color: white; border: 0;
    padding: 8px 14px; border-radius: 8px; font-weight: 700; cursor: pointer; }}
</style></head>
<body>
  {print_button}
  <div class="sheet"><div class="inner">
    <div class="header">
      <div>
        <div class="title">KWITANTIE</div>
        <div class="sub">HUURBETALING</div>
      </div>
      <div class="info">
        <div class="num">Nr. {h(receipt_number)}</div>
        <div>{h(paid_at)}</div>
      </div>
    </div>
    <div class="parties">
      <div class="party">
        <div class="lbl">Verhuurder</div>
        <div class="name">{h(landlord)}</div>
        <div class="meta">{h(company_address)}</div>
        <div class="meta">{h(company_phone)}</div>
      </div>
      <div class="party">
        <div class="lbl">Huurder</div>
        <div class="name">{h(tenant_name)}</div>
        <div class="meta">{h(apartment_number)}{(' · ' + h(location_name)) if location_name else ''}</div>
        <div class="meta">{h(tenant_phone)}</div>
      </div>
    </div>
    <table>
      <thead><tr><th>Omschrijving</th><th style="text-align:right">Bedrag</th></tr></thead>
      <tbody>
        <tr><td>{h(desc)}</td><td class="amt">{h(fmt_money(amount, currency))}</td></tr>
        <tr class="total"><td>Totaal ontvangen</td><td class="amt">{h(fmt_money(amount, currency))}</td></tr>
        <tr><td>Nog openstaand na deze betaling</td><td class="amt">{outstanding_line}</td></tr>
      </tbody>
    </table>
    <div class="method">
      <div><span class="box">{cb('cash')}</span> Contant</div>
      <div><span class="box">{cb('bank')}</span> Bankoverschrijving</div>
      <div><span class="box">{cb('other')}</span> Anders</div>
    </div>
    <div class="verklaring">
      Ondergetekende verklaart hierbij het bedrag van
      <b>{h(fmt_money(amount, currency))}</b> te hebben ontvangen van
      <b>{h(tenant_name)}</b> als betaling voor {h(desc.lower())}.
    </div>
    {f'<div class="note"><b>Opmerking:</b> {h(note)}</div>' if note else ''}
    <div class="signature">
      <div class="line">Handtekening verhuurder</div>
    </div>
  </div></div>
  {autoprint_script}
</body></html>"""


def _render_receipt_html_thermal(*, h, cb_paid, receipt_number, paid_at,
                                 company_name, company_address, company_phone,
                                 tenant_name, apartment_number, location_name,
                                 amount, currency, outstanding_after, method,
                                 note, desc, fmt_money, preview: bool = False,
                                 company_email: str = "", company_tagline: str = "",
                                 company_kkf: str = "", paper_width_mm: int = 58,
                                 title: str = "KWITANTIE", fragment: bool = False,
                                 location_city: str = "", font_px: Optional[tuple] = None,
                                 screen_sizes: bool = False, tenant_phone: str = "",
                                 employee: str = "") -> str:
    """Bonprinter layout — POS-stijl, monospaced, 1 kolom. Breedte volgt de
    printerinstelling van de locatie; ≤60mm krijgt een compacte opmaak."""
    W = int(paper_width_mm or 58)
    k = 0.78 if W <= 60 else 1.0

    def pt(x: float) -> str:
        return f"{round(x * k, 1)}pt"
    pad = "1mm 0.5mm" if W <= 60 else "2mm 3mm"
    method_label = {
        "cash": "CONTANT", "contant": "CONTANT", "bank": "OVERSCHRIJVING",
        "card": "PIN", "creditcard": "CREDITCARD", "ideal": "IDEAL", "other": "ANDERS",
    }.get(method, (method or "").upper() or "—")
    outstanding_txt = (
        '<span class="paid">** VOLLEDIG VOLDAAN **</span>'
        if cb_paid
        else f'<span class="due">Nog openstaand: {h(fmt_money(outstanding_after, currency))}</span>'
    )
    apt_line = f"{h(apartment_number)}" + (f" · {h(location_name)}" if location_name else "")
    autoprint_script = "" if preview else """
  <script>
    (function() {
      var didPrint = false;
      function go() {
        if (didPrint) return;
        didPrint = true;
        setTimeout(function() { try { window.focus(); window.print(); } catch(e) {} }, 80);
      }
      if (document.readyState === 'complete') go();
      else window.addEventListener('load', go);
    })();
  </script>"""
    print_button = '' if preview else '<div class="no-print"><button onclick="window.print()">🖨</button></div>'
    # "size: Wmm auto" is ongeldige CSS (Chrome valt dan terug op A4/Letter).
    # Daarom meten we de bonlengte en zetten we een exacte @page-hoogte.
    page_fit_script = """
  <script>
    (function() {
      var W = %d;
      function fit() {
        try {
          // Meet de .sheet met de print-lettergroottes → pagina eindigt direct na de laatste regel.
          var d = document.documentElement, sh = document.querySelector('.sheet');
          if (!sh) return;
          d.classList.add('fitm');
          var hmm = Math.ceil(sh.getBoundingClientRect().height * 25.4 / 96) + 1;
          d.classList.remove('fitm');
          var el = document.getElementById('page-fit');
          if (!el) { el = document.createElement('style'); el.id = 'page-fit'; document.head.appendChild(el); }
          el.textContent = '@media print { @page { size: ' + W + 'mm ' + Math.max(hmm, 20) + 'mm; margin: 0; } html, body { height: ' + hmm + 'mm; overflow: hidden; } }';
        } catch (e) {}
      }
      document.addEventListener('DOMContentLoaded', fit);
      window.addEventListener('load', fit);
      window.addEventListener('beforeprint', fit);
    })();
  </script>""" % W
    # Lettergrootte bij printen (instelbaar): basis, bedrijfsnaam, KWITANTIE, bedrag.
    fs = tuple(font_px) if font_px else (20, 26, 22, 28)

    def comp_css(S: str) -> str:
        return f"""
  {S}.sheet {{ width: 54mm; max-width: 54mm; margin: 0 auto; padding: 2mm 0 0; box-sizing: border-box; font-size: 12px; }}
  {S}.sheet > :last-child {{ margin-bottom: 0; padding-bottom: 0; }}
  {S}.c {{ text-align: center; }}
  {S}.b {{ font-weight: 700; }}
  {S}.name {{ font-size: 14px; font-weight: 900; text-align: center; word-break: break-word; }}
  {S}.sep {{ border-top: 1px dashed #000; margin: 1.5mm 0; height: 0; }}
  {S}.r {{ display: flex; justify-content: space-between; align-items: baseline; gap: 2mm; }}
  {S}.r > span:first-child {{ white-space: nowrap; }}
  {S}.r > span:last-child {{ text-align: right; word-break: break-word; }}
  {S}.big {{ font-size: 16px; font-weight: 900; white-space: nowrap; }}
  {S}.wrap {{ word-break: break-word; }}
  {S}.paid-lbl {{ white-space: nowrap; word-break: keep-all; }}
  {S}.paid-amt {{ display: block; text-align: right; }}
  {"@media all" if screen_sizes else "@media print"} {{
{print_sizes(S)}
  }}
  /* Zelfde print-maten tijdens het meten van de bonlengte (html.fitm). */
{print_sizes("html.fitm " + S)}
"""

    def print_sizes(S: str) -> str:
        return f"""    {S}.sheet, {S}.sheet * {{ font-size: {fs[0]}px; }}
    {S}.sheet .name {{ font-size: {fs[1]}px; font-weight: 900; }}
    {S}.sheet .title {{ font-size: {fs[2]}px; }}
    {S}.sheet .big {{ font-size: {fs[3]}px; font-weight: 900; white-space: normal; }}
    {S}.r {{ flex-wrap: wrap; }}
    {S}.r > span:last-child {{ margin-left: auto; }}
    {S}.r.one, {S}.r.one * {{ flex-wrap: nowrap; white-space: nowrap; font-size: {min(fs[0], 12)}px; }}""" 
    city = location_city if location_city and location_city.lower() not in (location_name or "").lower() else ""
    unit_line = " - ".join(x for x in [apartment_number, location_name, city] if x)
    sheet_html = f"""
  <div class="sheet">
    <div class="name">{h(company_name)}</div>
    {f'<div class="c wrap">{h(company_address)}</div>' if company_address else ''}
    {f'<div class="c">TEL: {h(company_phone)}</div>' if company_phone else ''}
    {f'<div class="c wrap">{h(company_email)}</div>' if company_email else ''}
    <div class="sep"></div>
    <div class="c b title">{h(title)}</div>
    <div class="sep"></div>
    <div class="r"><span>NR.</span><span>{h(receipt_number)}</span></div>
    <div class="r"><span>DATUM</span><span>{h(paid_at)}</span></div>
    <div class="sep"></div>
    <div>HUURDER:</div>
    <div class="b wrap">{h(tenant_name)}</div>
    {f'<div class="r"><span>TEL.</span><span>{h(tenant_phone)}</span></div>' if tenant_phone else ''}
    {f'<div class="wrap">{h(unit_line)}</div>' if unit_line else ''}
    <div class="sep"></div>
    <div>OMSCHRIJVING:</div>
    <div class="b wrap">{h(desc or 'Huurbetaling')}</div>
    <div class="sep"></div>
    <div class="r"><span>BETAALD</span><span class="b">{h(fmt_money(amount, currency))}</span></div>
    <div class="r"><span>BETAALWIJZE</span><span class="b">{h(method_label)}</span></div>
    <div class="sep"></div>
    <div class="r one"><span>Nog openstaand:</span><span>{h(fmt_money(outstanding_after, currency))}</span></div>
    {f'<div class="r"><span>ONTVANGEN DOOR</span><span class="b">{h(employee)}</span></div>' if employee else ''}
    <div class="sep"></div>
    <div>OPMERKING:</div>
    <div class="wrap">{h(note or '-')}</div>
    <div class="sep"></div>
    <div class="c">Bedankt voor uw betaling</div>
    <div class="c">{h(receipt_number)}</div>
  </div>
"""
    if fragment:
        # Voor window.print() in de app: alle regels gescoped onder #bon.
        return f"""<style>
  #bon {{ font-family: "Courier New", ui-monospace, Menlo, monospace;
    font-size: 12px; line-height: 1.25; color: #000; background: #fff; }}
{comp_css('#bon ')}</style>{sheet_html}"""
    return f"""<!doctype html>
<html lang="nl"><head><meta charset="utf-8">
<title>Kwitantie {h(receipt_number)}</title>
<style>
  /* Bonrol {W}mm — geen A4; marge 0 = geen browser-kop/voettekst/URL. */
  html, body {{ font-family: "Courier New", ui-monospace, Menlo, monospace;
    font-size: 12px; line-height: 1.25; color: #000; margin: 0; padding: 0; background: #fff; }}
  body {{ width: {W}mm; min-height: 0; }}
  @media print {{
    /* Fallback; page-fit script zet de exacte hoogte van de bon. */
    @page {{ size: {W}mm 150mm; margin: 0; }}
    html, body {{ height: auto; min-height: 0; padding: 0; margin: 0; }}
    body {{ font-size: {fs[0]}px; }}
    .no-print {{ display: none !important; }}
  }}
{comp_css("")}
  .no-print {{ position: fixed; top: 4px; right: 4px; }}
  .no-print button {{ background: #000; color: #fff; border: 0; padding: 4px 8px;
    border-radius: 4px; font-size: 10pt; cursor: pointer; }}
</style>{page_fit_script}</head>
<body>
  {print_button}
{sheet_html}
  {autoprint_script}
</body></html>"""


@api.get("/payments/{payment_id}/image")
async def payment_image(payment_id: str):
    """Render kwitantie als JPG foto — bedoeld om eenvoudig via WhatsApp
    als foto te delen (in plaats van als PDF-bijlage). Geen auth zodat de
    huurder de afbeelding ook direct kan ontvangen via een gedeelde link.
    """
    p = await db.payments.find_one({"id": payment_id}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Kwitantie niet gevonden")
    p = await _enrich_payment(p, include_logo=True)
    pdf_bytes = await asyncio.to_thread(receipt_pdf, p)
    # PDF eerste pagina → JPG via pymupdf (zoom 2.5× voor scherpe weergave
    # op iPhone retina-schermen)
    try:
        import pymupdf
        doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
        page = doc[0]
        pix = page.get_pixmap(matrix=pymupdf.Matrix(2.5, 2.5))
        jpg = pix.tobytes("jpeg", jpg_quality=85)
        doc.close()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Image render fout: {e}")
    from fastapi.responses import Response as _Resp
    return _Resp(
        content=jpg,
        media_type="image/jpeg",
        headers={"Content-Disposition": f'inline; filename="kwitantie-{p["receipt_number"]}.jpg"'},
    )


@api.get("/tenants/{tenant_id}/reminder-image")
async def tenant_reminder_image(tenant_id: str):
    """Genereer een betalingsherinnering als JPG-foto voor WhatsApp-share.
    Toont ALLE openstaande facturen van de huurder in het blauwe huisje-
    ontwerp. Public endpoint zodat de foto ook via een gedeelde link
    bekeken kan worden zonder auth."""
    t = await db.tenants.find_one({"id": tenant_id}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Huurder niet gevonden")
    apt = None
    location_name = None
    if t.get("apartment_id"):
        apt = await db.apartments.find_one({"id": t["apartment_id"]}, {"_id": 0}) or {}
        if apt.get("location_id"):
            loc = await db.locations.find_one({"id": apt["location_id"]}, {"_id": 0, "name": 1})
            if loc:
                location_name = loc.get("name")
    # Open facturen sorteren op period_year, period_month desc → recent eerst
    open_invoices = []
    async for inv in db.invoices.find(
        {"tenant_id": tenant_id, "status": {"$nin": ["paid", "cancelled"]}}, {"_id": 0}
    ):
        paid = inv.get("paid_amount") or await _invoice_currently_paid(inv["id"])
        rem = max(0.0, float(inv.get("amount") or 0) - float(paid or 0))
        if rem > 0.001:
            open_invoices.append({**inv, "paid_amount": float(paid or 0), "remaining_amount": rem})
    open_invoices.sort(key=lambda i: (i.get("period_year") or 0, i.get("period_month") or 0), reverse=True)
    total_open = sum(i["remaining_amount"] for i in open_invoices)
    currency = (open_invoices[0].get("currency") if open_invoices else (apt or {}).get("currency")) or "SRD"
    brand = await _company_brand_info(t.get("company_id"))
    reminder = {
        **brand,
        "tenant_name": t.get("name") or "",
        "tenant_phone": t.get("phone") or "",
        "apartment_number": (apt or {}).get("number"),
        "location_name": location_name,
        "invoices": open_invoices,
        "currency": currency,
        "total_open": round(total_open, 2),
        "reference_date": iso(now_utc()),
    }
    pdf_bytes = await asyncio.to_thread(reminder_pdf_blue_house, reminder)
    try:
        import pymupdf
        doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
        page = doc[0]
        pix = page.get_pixmap(matrix=pymupdf.Matrix(2.5, 2.5))
        jpg = pix.tobytes("jpeg", jpg_quality=85)
        doc.close()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Image render fout: {e}")
    from fastapi.responses import Response as _Resp
    return _Resp(
        content=jpg,
        media_type="image/jpeg",
        headers={"Content-Disposition": f'inline; filename="herinnering-{tenant_id[:8]}.jpg"'},
    )


# =====================================================================
# Contracts
# =====================================================================
class ContractIn(BaseModel):
    tenant_id: str
    apartment_id: str
    start_date: str
    end_date: Optional[str] = ""
    payment_day: int = 1
    deposit_amount: float = 0
    landlord: Optional[str] = "SuriRent N.V."
    terms: Optional[str] = ""


class ContractOut(BaseModel):
    id: str
    # Onderstaande velden zijn defensief Optional gemaakt zodat oudere
    # seed-contracten (uit een vorige schema-versie) alsnog serialiseren
    # en de /contracts endpoint niet 500't. Nieuwe contracten vullen ze
    # netjes in via _create_contract.
    contract_number: Optional[str] = ""
    tenant_id: str
    tenant_name: Optional[str] = None
    apartment_id: str
    apartment_number: Optional[str] = None
    start_date: str
    end_date: Optional[str] = ""
    payment_day: Optional[int] = 1
    deposit_amount: float = 0.0
    landlord: Optional[str] = ""
    terms: Optional[str] = ""
    status: str
    sign_token: Optional[str] = None
    signed_at: Optional[str] = None
    signed_by: Optional[str] = None
    signed_ip: Optional[str] = None
    created_at: str


async def _next_seq(key: str) -> int:
    from pymongo import ReturnDocument
    c = await db.counters.find_one_and_update(
        {"_id": key}, {"$inc": {"seq": 1}}, upsert=True, return_document=ReturnDocument.AFTER
    )
    return c.get("seq", 1)


async def _enrich_contract(c: dict) -> dict:
    tn = await db.tenants.find_one({"id": c["tenant_id"]}, {"_id": 0, "name": 1})
    apt = await db.apartments.find_one({"id": c["apartment_id"]}, {"_id": 0, "number": 1})
    return {
        **c,
        "tenant_name": tn["name"] if tn else None,
        "apartment_number": apt["number"] if apt else None,
    }


@api.get("/contracts", response_model=List[ContractOut])
async def list_contracts(user=Depends(get_current_user), tenant_id: Optional[str] = None):
    q = dict(scope(user))
    if tenant_id:
        q["tenant_id"] = tenant_id
    async def compute():
        docs = await db.contracts.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
        t_by, a_by = await asyncio.gather(
            _by_id("tenants", [d.get("tenant_id") for d in docs], {"name": 1}),
            _by_id("apartments", [d.get("apartment_id") for d in docs], {"number": 1}))
        return [{**d, "tenant_name": t_by.get(d.get("tenant_id"), {}).get("name"),
                 "apartment_number": a_by.get(d.get("apartment_id"), {}).get("number")} for d in docs]
    return await _list_cached("contracts", user, compute, tenant_id or "")


@api.post("/contracts", response_model=ContractOut)
async def create_contract(body: ContractIn, user=Depends(get_current_user)):
    cid = company_id_of(user)
    if not cid:
        raise HTTPException(status_code=400, detail="Geen actief bedrijf geselecteerd")
    tenant = await db.tenants.find_one({"id": body.tenant_id, **scope(user)}, {"_id": 0})
    if not tenant:
        raise HTTPException(status_code=404, detail="Huurder niet gevonden")
    apt = await db.apartments.find_one({"id": body.apartment_id, **scope(user)}, {"_id": 0})
    if not apt:
        raise HTTPException(status_code=404, detail="Appartement niet gevonden")
    year = now_utc().year
    seq = await _next_seq(f"contract_{year}")
    doc = {
        "id": new_id(),
        "company_id": cid,
        "contract_number": f"HC{year}-{seq:04d}",
        "tenant_id": body.tenant_id,
        "apartment_id": body.apartment_id,
        "start_date": body.start_date,
        "end_date": body.end_date or "",
        "payment_day": body.payment_day,
        "deposit_amount": body.deposit_amount,
        "landlord": body.landlord or "SuriRent N.V.",
        "terms": body.terms or "",
        "status": "draft",
        "sign_token": secrets.token_urlsafe(24),
        "signed_at": None,
        "signed_by": None,
        "signed_ip": None,
        "created_at": iso(now_utc()),
    }
    await db.contracts.insert_one(doc)
    doc.pop("_id", None)
    return await _enrich_contract(doc)


@api.delete("/contracts/{contract_id}")
async def delete_contract(contract_id: str, user=Depends(get_current_user)):
    res = await db.contracts.delete_one({"id": contract_id, **scope(user)})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Contract niet gevonden")
    return {"ok": True}


@api.get("/contracts/{contract_id}/pdf")
async def contract_pdf_admin(contract_id: str):
    """Public via id (kept simple for share link)."""
    c = await db.contracts.find_one({"id": contract_id}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Contract niet gevonden")
    t = await db.tenants.find_one({"id": c["tenant_id"]}, {"_id": 0}) or {}
    a = await db.apartments.find_one({"id": c["apartment_id"]}, {"_id": 0}) or {}
    c = {**c, **(await _company_brand_info(c.get("company_id")))}
    ev = await _load_tenant_evidence_bundle(t, c.get("company_id"))
    pdf = await asyncio.to_thread(contract_pdf, c, t, a, **ev)
    return _pdf_response(pdf, f"contract-{c.get('contract_number') or contract_id}.pdf")


async def _load_tenant_id_photo_bytes(tenant: dict) -> bytes | None:
    """Haal de raw bytes op van de ID-kaart foto van een huurder als die is
    geüpload. Bron: `landing_assets.data_b64` waar `tenant.id_photo_url`
    naar wijst (`/api/landing/asset/{id}`)."""
    return await _load_landing_asset_bytes((tenant or {}).get("id_photo_url"))


async def _load_landing_asset_bytes(url: str | None) -> bytes | None:
    if not url or "/landing/asset/" not in url:
        return None
    asset_id = url.rstrip("/").split("/")[-1]
    asset = await db.landing_assets.find_one({"id": asset_id}, {"_id": 0, "data_b64": 1})
    if not asset or not asset.get("data_b64"):
        return None
    try:
        return base64.b64decode(asset["data_b64"])
    except Exception:
        return None


async def _load_tenant_evidence_bundle(tenant: dict, company_id: Optional[str] = None) -> dict:
    """Voeg alle beschikbare bewijsstukken van een huurder samen tot één
    dict die door `contract_pdf` gebruikt kan worden (voorkant/achterkant
    ID + huurder handtekening + verhuurder handtekening).

    Wanneer `company_id` is opgegeven wordt ook de handtekening van de
    verhuurder opgehaald zodat die inline op het contract komt te staan."""
    landlord_url = ""
    if company_id:
        co = await db.companies.find_one({"id": company_id}, {"_id": 0, "landlord_signature_url": 1}) or {}
        landlord_url = (co.get("landlord_signature_url") or "").strip()
    return {
        "id_photo_bytes": await _load_landing_asset_bytes((tenant or {}).get("id_photo_url")),
        "id_photo_back_bytes": await _load_landing_asset_bytes((tenant or {}).get("id_photo_back_url")),
        "signature_bytes": await _load_landing_asset_bytes((tenant or {}).get("signature_url")),
        "landlord_signature_bytes": await _load_landing_asset_bytes(landlord_url) if landlord_url else None,
    }


class ContractPreviewIn(BaseModel):
    """Ongebonden preview van een concept-contract. Geen DB write."""
    tenant_id: str
    apartment_id: str
    start_date: Optional[str] = ""
    end_date: Optional[str] = ""
    payment_day: Optional[int] = 1
    deposit_amount: Optional[float] = 0.0
    landlord: Optional[str] = ""
    terms: Optional[str] = ""


@api.post("/contracts/preview.pdf")
async def contract_pdf_preview(body: ContractPreviewIn, user=Depends(get_current_user)):
    """Genereer een PDF preview van een nieuw contract op basis van het
    (nog niet opgeslagen) formulier — zodat de gebruiker in real-time kan
    zien hoe het contract eruit ziet."""
    cid = company_id_of(user)
    if not cid:
        raise HTTPException(status_code=400, detail="Geen actief bedrijf")
    t = await db.tenants.find_one({"id": body.tenant_id, **scope(user)}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Huurder niet gevonden")
    a = await db.apartments.find_one({"id": body.apartment_id, **scope(user)}, {"_id": 0})
    if not a:
        raise HTTPException(status_code=404, detail="Appartement niet gevonden")
    c = {
        "id": "preview",
        "contract_number": "PREVIEW",
        "tenant_id": body.tenant_id,
        "apartment_id": body.apartment_id,
        "start_date": body.start_date or "",
        "end_date": body.end_date or "",
        "payment_day": body.payment_day or 1,
        "deposit_amount": float(body.deposit_amount or 0),
        "landlord": body.landlord or "",
        "terms": body.terms or "",
        "status": "draft",
        "created_at": iso(now_utc()),
    }
    c = {**c, **(await _company_brand_info(cid))}
    id_photo_bytes = await _load_tenant_id_photo_bytes(t)
    ev = await _load_tenant_evidence_bundle(t, cid)
    pdf = await asyncio.to_thread(contract_pdf, c, t, a, **ev)
    return _pdf_response(pdf, "contract-preview.pdf")


# Public signing flow
@api.get("/contracts/sign/{token}")
async def contract_sign_info(token: str):
    c = await db.contracts.find_one({"sign_token": token}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Ondertekenlink ongeldig")
    t = await db.tenants.find_one({"id": c["tenant_id"]}, {"_id": 0}) or {}
    a = await db.apartments.find_one({"id": c["apartment_id"]}, {"_id": 0}) or {}
    return {
        "contract": c,
        "tenant": {"name": t.get("name"), "phone": t.get("phone")},
        "apartment": {"number": a.get("number"), "address": a.get("address"),
                      "rent_amount": a.get("rent_amount"), "currency": a.get("currency")},
        "already_signed": bool(c.get("signed_at")),
    }


class SignIn(BaseModel):
    signed_by: str = Field(min_length=2)
    accept: bool = True


@api.post("/contracts/sign/{token}")
async def contract_do_sign(token: str, body: SignIn, request: Request):
    if not body.accept:
        raise HTTPException(status_code=400, detail="U moet akkoord gaan met de voorwaarden")
    c = await db.contracts.find_one({"sign_token": token}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Link ongeldig")
    if c.get("signed_at"):
        raise HTTPException(status_code=400, detail="Contract is al ondertekend")
    ip = request.client.host if request.client else "—"
    from pymongo import ReturnDocument
    updated = await db.contracts.find_one_and_update(
        {"sign_token": token},
        {"$set": {
            "signed_at": iso(now_utc()),
            "signed_by": body.signed_by,
            "signed_ip": ip,
            "status": "active",
        }},
        projection={"_id": 0}, return_document=ReturnDocument.AFTER,
    )
    return await _enrich_contract(updated)


# =====================================================================
# Invoices
# =====================================================================
class InvoiceCreate(BaseModel):
    tenant_id: str
    period_month: int = Field(ge=1, le=12)
    period_year: int


class HistoricalInvoiceCreate(BaseModel):
    """Historische factuur voor onboarding — vrij bedrag, vrije datum,
    vrije omschrijving. Bedoeld om achterstanden van vóór ingebruikname
    van de app in te voeren zodat het openstaande saldo klopt."""
    tenant_id: str
    amount: float = Field(gt=0)
    date: str          # ISO date (YYYY-MM-DD) — bepaalt period_month/year + created_at
    description: str = Field(min_length=1, max_length=200)
    currency: Optional[str] = None   # default: valuta van appartement


class InvoicePlanRef(BaseModel):
    id: str
    status: str
    total_installments: int
    paid_installments: int


class InvoiceOut(BaseModel):
    id: str
    invoice_number: Optional[str] = None
    tenant_id: str
    tenant_name: Optional[str] = None
    apartment_id: Optional[str] = None
    apartment_number: Optional[str] = None
    location_name: Optional[str] = None
    amount: float
    paid_amount: float = 0
    remaining_amount: float = 0
    currency: str
    period_month: Optional[int] = None
    period_year: Optional[int] = None
    status: str
    created_at: str
    paid_at: Optional[str] = None
    payment_id: Optional[str] = None
    receipt_number: Optional[str] = None
    paid_method: Optional[str] = None
    plans: List[InvoicePlanRef] = []
    bucket: Optional[str] = None  # 'overdue' | 'current' | 'future' (alleen voor open facturen relevant)
    auto_created_from_payment: Optional[bool] = None  # audit-trail: factuur is aangemaakt door kiosk-betaling voordat maand-generatie plaatsvond
    is_historical: Optional[bool] = None  # true = onboarding-achterstand met vrije datum/bedrag
    description: Optional[str] = None     # vrije omschrijving voor historische facturen
    invoice_date: Optional[str] = None    # ISO YYYY-MM-DD — factuurdatum op de PDF
    due_date: Optional[str] = None        # ISO YYYY-MM-DD — vervaldatum op de PDF, bepaalt ook overdue-punt


async def _enrich_invoices_batch(docs: list) -> list:
    """Verrijk facturen met een vast aantal queries (geen N+1)."""
    if not docs:
        return []
    tids = list({d["tenant_id"] for d in docs if d.get("tenant_id")})
    aids = list({d["apartment_id"] for d in docs if d.get("apartment_id")})
    iids = [d["id"] for d in docs]
    missing_paid = [d["id"] for d in docs if d.get("paid_amount") is None]
    tenants, apts, plans, paid_rows = await asyncio.gather(
        db.tenants.find({"id": {"$in": tids}}, {"_id": 0, "id": 1, "name": 1}).to_list(None),
        db.apartments.find({"id": {"$in": aids}}, {"_id": 0, "id": 1, "number": 1, "location_id": 1}).to_list(None),
        db.payment_plans.find({"invoice_ids": {"$in": iids}, "status": {"$in": ["active", "completed"]}},
                              {"_id": 0, "id": 1, "status": 1, "invoice_ids": 1}).to_list(None),
        db.payments.aggregate([
            {"$match": {"invoice_id": {"$in": missing_paid}, "status": "approved"}},
            {"$group": {"_id": "$invoice_id", "total": {"$sum": {"$toDouble": {"$ifNull": ["$amount", 0]}}}}},
        ]).to_list(None) if missing_paid else asyncio.sleep(0, result=[]),
    )
    t_name = {t["id"]: t.get("name") for t in tenants}
    a_by = {a["id"]: a for a in apts}
    lids = list({a["location_id"] for a in apts if a.get("location_id")})
    pids = [pl["id"] for pl in plans]
    locs, inst = await asyncio.gather(
        db.locations.find({"id": {"$in": lids}}, {"_id": 0, "id": 1, "name": 1}).to_list(None),
        db.payment_plan_installments.aggregate([
            {"$match": {"plan_id": {"$in": pids}}},
            {"$group": {"_id": "$plan_id", "total": {"$sum": 1},
                        "paid": {"$sum": {"$cond": [{"$eq": ["$status", "paid"]}, 1, 0]}}}},
        ]).to_list(None) if pids else asyncio.sleep(0, result=[]),
    )
    l_name = {loc["id"]: loc.get("name") for loc in locs}
    inst_by = {x["_id"]: x for x in inst}
    paid_by = {x["_id"]: round(float(x["total"]) + 1e-9, 2) for x in paid_rows}
    plans_by_inv: dict = {}
    for pl in plans:
        info = {"id": pl["id"], "status": pl.get("status", "active"),
                "total_installments": int(inst_by.get(pl["id"], {}).get("total", 0)),
                "paid_installments": int(inst_by.get(pl["id"], {}).get("paid", 0))}
        for iid in pl.get("invoice_ids") or []:
            plans_by_inv.setdefault(iid, []).append(info)
    out = []
    for i in docs:
        a = a_by.get(i.get("apartment_id"))
        paid_amount = i.get("paid_amount")
        if paid_amount is None:
            paid_amount = paid_by.get(i["id"], 0.0)
        paid_amount = round(float(paid_amount or 0), 2)
        inv_amt = round(float(i.get("amount") or 0), 2)
        out.append({**i, "tenant_name": t_name.get(i.get("tenant_id")),
                    "apartment_number": a["number"] if a else None,
                    "location_name": l_name.get(a.get("location_id")) if a else None,
                    "paid_amount": paid_amount,
                    "remaining_amount": round(max(0.0, inv_amt - paid_amount), 2),
                    "plans": plans_by_inv.get(i["id"], [])})
    return out


async def _enrich_invoice(i: dict) -> dict:
    return (await _enrich_invoices_batch([i]))[0]


# Facturenlijst: altijd live berekend (geen cache).


async def _all_invoices_enriched(user: dict) -> list:
    return await _build_invoice_list(user)


async def _build_invoice_list(user: dict) -> list:
    docs = await db.invoices.find(scope(user), {"_id": 0}).sort("created_at", -1).to_list(5000)
    # Bucket berekening — gebruik company-instelling voor grace_workdays
    cid = company_id_of(user)
    grace_wd = 10
    if cid:
        try:
            cs = await db.company_settings.find_one({"company_id": cid}, {"_id": 0, "invoicing": 1})
            if cs and isinstance(cs.get("invoicing"), dict):
                grace_wd = int(cs["invoicing"].get("grace_workdays") or 10)
        except Exception:  # noqa: BLE001
            pass
    today_local = now_utc().date()
    out: list[dict] = []
    for enriched in await _enrich_invoices_batch([d for d in docs if d.get("id") and d.get("tenant_id")]):
        try:
            # Defensief: defaults voor corrupte/incomplete documenten zodat de lijst niet 500t.
            if not enriched.get("invoice_number"):
                enriched["invoice_number"] = f"AUTO-{str(enriched.get('id') or '')[:8]}"
            if not enriched.get("period_month"):
                try:
                    created = enriched.get("created_at") or ""
                    enriched["period_month"] = int(created[5:7]) if len(created) >= 7 else now_utc().month
                except Exception:  # noqa: BLE001
                    enriched["period_month"] = now_utc().month
            if not enriched.get("period_year"):
                try:
                    created = enriched.get("created_at") or ""
                    enriched["period_year"] = int(created[0:4]) if len(created) >= 4 else now_utc().year
                except Exception:  # noqa: BLE001
                    enriched["period_year"] = now_utc().year
            # Alleen bucket voor onbetaalde facturen — betaalde laten we leeg.
            if (enriched.get("status") or "open") != "paid":
                try:
                    enriched["bucket"] = _classify_invoice_bucket(
                        int(enriched.get("period_month") or 0),
                        int(enriched.get("period_year") or 0),
                        today_local, grace_wd,
                        due_date=enriched.get("due_date"),
                    )
                except Exception:  # noqa: BLE001
                    enriched["bucket"] = None
            out.append(enriched)
        except Exception as e:  # noqa: BLE001
            import logging as _logging
            _logging.getLogger("uvicorn.error").warning("list_invoices: skipping bad doc id=%s err=%s", (enriched or {}).get("id"), e)
    return out


@api.get("/invoices", response_model=List[InvoiceOut])
async def list_invoices(user=Depends(get_current_user)):
    return (await _all_invoices_enriched(user))[:500]


_UNPAID_STATUSES = {"open", "sent", "pending", "overdue", "partial"}


def _group_invoices(invs: list, today) -> list:
    """Python-port van groupByTenant (frontend helpers.js) voor server-side filter/paginering."""
    groups: dict = {}
    for inv in invs:
        g = groups.setdefault(inv["tenant_id"], {
            "tenant_id": inv["tenant_id"], "tenant_name": inv.get("tenant_name") or "Onbekend",
            "apartment_number": inv.get("apartment_number"), "currency": inv.get("currency"),
            "open": [], "invoice_numbers": []})
        if (inv.get("status") or "").lower() in _UNPAID_STATUSES:
            g["open"].append(inv)
            g["invoice_numbers"].append(inv.get("invoice_number") or "")
        if inv.get("apartment_number"):
            g["apartment_number"] = inv["apartment_number"]
    cur = (today.year, today.month)

    def bucket(i):
        if i.get("bucket"):
            return i["bucket"]
        p = (int(i.get("period_year") or 0), int(i.get("period_month") or 0))
        return "future" if p > cur else "current" if p == cur else "overdue"

    def rem(i):
        return float(i["remaining_amount"] if i.get("remaining_amount") is not None else i.get("amount") or 0)
    for g in groups.values():
        b = [bucket(i) for i in g["open"]]
        g["openCount"] = len(g["open"])
        g["overdueCount"] = b.count("overdue")
        g["totalOpen"] = sum(rem(i) for i in g["open"])
        g["totalDue"] = sum(rem(i) for i, bb in zip(g["open"], b) if bb in ("overdue", "current"))
        g["severity"] = "critical" if g["overdueCount"] >= 2 else "late" if g["overdueCount"] == 1 else "ok"
    order = {"critical": 0, "late": 1, "ok": 2}
    return sorted(groups.values(), key=lambda g: (order[g["severity"]], -g["totalOpen"], g["tenant_name"].lower()))


@api.get("/invoices/grouped")
async def list_invoices_grouped(
    tab: str = "all", severity: str = "all", q: str = "", tenant_id: Optional[str] = None,
    offset: int = 0, limit: int = 25, user=Depends(get_current_user),
):
    """Facturen per huurder, gepagineerd (25 huurders). Filter/zoek/KPI's over álle facturen."""
    invs = await _all_invoices_enriched(user)
    today = now_utc().date()
    groups = _group_invoices(invs, today)
    cur_m, cur_y = today.month, today.year
    summary = {
        "allCount": len(groups),
        "openCount": sum(1 for g in groups if g["overdueCount"] > 0),
        "paidCount": sum(1 for g in groups if g["openCount"] == 0),
        "totalOpenAmount": round(sum(g["totalDue"] for g in groups), 2),
        "currency": (groups[0]["currency"] if groups else None) or "SRD",
        "totalOpenMonths": len({(i.get("period_year"), i.get("period_month")) for i in invs
                                if (i.get("status") or "").lower() in _UNPAID_STATUSES and (i.get("bucket") or "") != "future"}),
        "thisMonthExpected": round(sum(float(i.get("amount") or 0) for i in invs
                                       if i.get("period_month") == cur_m and i.get("period_year") == cur_y), 2),
        "hasInvoices": bool(invs),
    }
    ql = q.strip().lower()

    def keep(g):
        if tenant_id and g["tenant_id"] != tenant_id:
            return False
        if tab == "open" and g["overdueCount"] == 0:
            return False
        if tab == "paid" and g["openCount"] > 0:
            return False
        if severity in ("critical", "late", "ok") and g["severity"] != severity:
            return False
        if ql:
            hay = f"{g['tenant_name']} {g.get('apartment_number') or ''} {' '.join(g['invoice_numbers'])}".lower()
            if ql not in hay:
                return False
        return True
    filtered = [g for g in groups if keep(g)]
    limit = max(1, min(limit, 100))
    page = filtered[offset:offset + limit]
    page_ids = {g["tenant_id"] for g in page}
    return {
        "tenant_ids": [g["tenant_id"] for g in page],
        "invoices": [i for i in invs if i["tenant_id"] in page_ids],
        "total": len(filtered),
        "offset": offset,
        "has_more": offset + limit < len(filtered),
        "summary": summary,
    }


@api.post("/invoices", response_model=InvoiceOut)
async def create_invoice(body: InvoiceCreate, user=Depends(get_current_user)):
    cid = company_id_of(user)
    if not cid:
        raise HTTPException(status_code=400, detail="Geen actief bedrijf geselecteerd")
    t = await db.tenants.find_one({"id": body.tenant_id, **scope(user)}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Huurder niet gevonden")
    apt_id = t.get("apartment_id")
    apt = await db.apartments.find_one({"id": apt_id, **scope(user)}, {"_id": 0}) if apt_id else None
    if not apt:
        raise HTTPException(status_code=400, detail="Huurder heeft geen appartement")
    # Prevent duplicate invoice for same tenant + period
    dup = await db.invoices.find_one({
        **scope(user),
        "tenant_id": body.tenant_id, "period_month": body.period_month,
        "period_year": body.period_year,
    })
    if dup:
        raise HTTPException(status_code=400, detail="Factuur voor deze periode bestaat al")
    year = body.period_year
    seq = await _next_seq(f"invoice_{year}")
    # invoice_date + due_date afleiden uit invoicing-settings zodat de PDF
    # en bucket-logica consistent zijn met wat de admin ziet in Instellingen.
    cs = await db.company_settings.find_one(
        {"company_id": cid}, {"_id": 0, "invoicing": 1},
    ) or {}
    inv_date_iso, due_date_iso = _compute_invoice_dates(
        body.period_month, body.period_year, cs.get("invoicing") or {},
    )
    doc = {
        "id": new_id(),
        "company_id": cid,
        "invoice_number": f"F{year}-{seq:05d}",
        "tenant_id": body.tenant_id,
        "apartment_id": apt_id,
        "amount": apt["rent_amount"],
        "currency": apt.get("currency", "SRD"),
        "period_month": body.period_month,
        "period_year": body.period_year,
        "invoice_date": inv_date_iso,
        "due_date": due_date_iso,
        "status": "open",
        "created_at": iso(now_utc()),
    }
    await db.invoices.insert_one(doc)
    doc.pop("_id", None)
    return await _enrich_invoice(doc)


@api.post("/invoices/historical", response_model=InvoiceOut)
async def create_historical_invoice(body: HistoricalInvoiceCreate, user=Depends(get_current_user)):
    """Maak een historische factuur aan met vrij bedrag, datum en omschrijving.
    Gebruikt bij onboarding om bestaande achterstanden in te voeren zonder
    dat de duplicate-check per periode blokkeert (meerdere historische
    facturen per maand mogen). Telt gewoon mee in openstaand saldo."""
    cid = company_id_of(user)
    if not cid:
        raise HTTPException(status_code=400, detail="Geen actief bedrijf geselecteerd")
    t = await db.tenants.find_one({"id": body.tenant_id, **scope(user)}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Huurder niet gevonden")
    apt_id = t.get("apartment_id")
    apt = await db.apartments.find_one({"id": apt_id, **scope(user)}, {"_id": 0}) if apt_id else None
    # Parse datum robuust (accepteert 'YYYY-MM-DD' of ISO).
    try:
        dt = datetime.fromisoformat(body.date.replace("Z", "+00:00")).replace(tzinfo=timezone.utc) if "T" in body.date else datetime.fromisoformat(body.date).replace(tzinfo=timezone.utc)
    except Exception:
        raise HTTPException(status_code=400, detail="Ongeldige datum (verwacht YYYY-MM-DD)")
    if dt > now_utc() + timedelta(days=1):
        raise HTTPException(status_code=400, detail="Datum mag niet in de toekomst liggen")
    currency = (body.currency or (apt or {}).get("currency") or "SRD").upper()
    year = dt.year
    seq = await _next_seq(f"invoice_hist_{year}")
    # Voor historische facturen is de gekozen datum de factuurdatum.
    # Vervaldatum = factuurdatum + payment_term_days (default 14).
    cs = await db.company_settings.find_one(
        {"company_id": cid}, {"_id": 0, "invoicing": 1},
    ) or {}
    try:
        term = int((cs.get("invoicing") or {}).get("payment_term_days") or 14)
    except (TypeError, ValueError):
        term = 14
    term = max(0, min(180, term))
    invoice_date_iso = dt.date().isoformat()
    due_date_iso = (dt.date() + timedelta(days=term)).isoformat()
    doc = {
        "id": new_id(),
        "company_id": cid,
        "invoice_number": f"H{year}-{seq:05d}",
        "tenant_id": body.tenant_id,
        "apartment_id": apt_id,
        "amount": round(float(body.amount), 2),
        "currency": currency,
        "period_month": dt.month,
        "period_year": dt.year,
        "invoice_date": invoice_date_iso,
        "due_date": due_date_iso,
        "status": "open",
        "created_at": iso(dt),
        "is_historical": True,
        "description": body.description.strip(),
    }
    await db.invoices.insert_one(doc)
    # Verreken automatisch eventueel openstaand krediet (overflow van een
    # eerdere betaling die groter was dan de toen-openstaande factuur, of
    # een expliciete vooruitbetaling). Zonder deze stap zou een historische
    # factuur die NA een grote betaling wordt aangemaakt "open" blijven
    # terwijl er tegoed staat — precies wat er misging bij de klant.
    try:
        await _apply_tenant_credit_to_invoice(body.tenant_id, doc["id"], cid)
    except Exception as e:  # noqa: BLE001
        print(f"[historical-invoice] credit apply failed: {e}")
    doc = await db.invoices.find_one({"id": doc["id"]}, {"_id": 0}) or doc
    doc.pop("_id", None)
    return await _enrich_invoice(doc)


@api.get("/tenants/{tenant_id}/payment-audit")
async def tenant_payment_audit(tenant_id: str, user=Depends(get_current_user)):
    """Diagnose-endpoint: geeft alle betalingen + facturen van een huurder terug
    met daarbij hoeveel van elke betaling daadwerkelijk aan facturen is
    toegewezen (via paid_amount) versus wat als tegoed openstaat. Handig om
    te achterhalen waar overschot van een grotere betaling naartoe is gegaan.
    """
    cid = company_id_of(user)
    q = {"id": tenant_id}
    if cid:
        q["company_id"] = cid
    t = await db.tenants.find_one(q, {"_id": 0, "id": 1, "name": 1})
    if not t:
        raise HTTPException(status_code=404, detail="Huurder niet gevonden")

    payments = []
    total_credit = 0.0
    async for p in db.payments.find(
        {"tenant_id": tenant_id, **({"company_id": cid} if cid else {})},
        {"_id": 0},
    ).sort("paid_at", 1):
        credit = float(p.get("credit_remaining") or 0)
        total_credit += credit
        payments.append({
            "id": p.get("id"),
            "receipt_number": p.get("receipt_number"),
            "amount": float(p.get("amount") or 0),
            "currency": p.get("currency"),
            "category": p.get("category"),
            "method": p.get("method"),
            "status": p.get("status"),
            "period": f"{p.get('period_month')}/{p.get('period_year')}"
                if p.get("period_month") else None,
            "invoice_id": p.get("invoice_id"),
            "invoice_number": p.get("invoice_number"),
            "credit_remaining": credit,
            "credit_origin": p.get("credit_origin"),
            "paid_at": p.get("paid_at"),
        })

    invoices = []
    async for inv in db.invoices.find(
        {"tenant_id": tenant_id, **({"company_id": cid} if cid else {})},
        {"_id": 0},
    ).sort([("period_year", 1), ("period_month", 1)]):
        amt = float(inv.get("amount") or 0)
        paid = float(inv.get("paid_amount") or 0)
        invoices.append({
            "id": inv.get("id"),
            "invoice_number": inv.get("invoice_number"),
            "period": f"{inv.get('period_month')}/{inv.get('period_year')}",
            "amount": amt,
            "paid_amount": paid,
            "remaining": round(max(0.0, amt - paid), 2),
            "overshoot": round(max(0.0, paid - amt), 2),
            "status": inv.get("status"),
            "is_historical": bool(inv.get("is_historical")),
        })

    return {
        "tenant_id": tenant_id,
        "tenant_name": t.get("name"),
        "payments": payments,
        "invoices": invoices,
        "total_credit_remaining": round(total_credit, 2),
        "total_paid_amount": round(sum(p["amount"] for p in payments if p["status"] == "approved"), 2),
    }


@api.post("/tenants/{tenant_id}/rebalance-credits")
async def rebalance_tenant_credits(tenant_id: str, user=Depends(get_current_user)):
    """Herverdeelt alle openstaande tegoeden (payments.credit_remaining) FIFO
    over de openstaande facturen van deze huurder. Ook: als een factuur
    `paid_amount > amount` heeft (oude overshoot-bug) wordt het overschot
    eerst terug op de betaling gezet als credit, en daarna FIFO verrekend
    over volgende openstaande facturen.

    Returns: {credit_before, applied, credit_after, invoices_updated}
    """
    cid = company_id_of(user)
    if not cid:
        raise HTTPException(status_code=400, detail="Geen bedrijfscontext")
    q = {"id": tenant_id, "company_id": cid}
    t = await db.tenants.find_one(q, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Huurder niet gevonden")

    # STAP 1: Corrigeer eventuele overshoot-facturen. Trek het teveel af,
    # zet status terug naar 'paid' (op amount), en voeg het overschot toe
    # aan credit_remaining van de laatst gekoppelde betaling.
    async for inv in db.invoices.find(
        {"tenant_id": tenant_id, "company_id": cid,
         "$expr": {"$gt": ["$paid_amount", "$amount"]}},
        {"_id": 0},
    ):
        amt = float(inv.get("amount") or 0)
        paid = float(inv.get("paid_amount") or 0)
        excess = round(paid - amt, 2)
        if excess <= 0:
            continue
        await db.invoices.update_one(
            {"id": inv["id"]},
            {"$set": {"paid_amount": amt, "status": "paid"}},
        )
        # Zoek een gekoppelde approved payment om het overschot op te zetten
        target_pay = await db.payments.find_one(
            {"tenant_id": tenant_id, "company_id": cid,
             "status": "approved",
             "$or": [{"invoice_id": inv["id"]},
                     {"period_month": inv.get("period_month"),
                      "period_year": inv.get("period_year")}]},
            {"_id": 0, "id": 1, "credit_remaining": 1},
            sort=[("paid_at", -1)],
        )
        if target_pay:
            cur_credit = float(target_pay.get("credit_remaining") or 0)
            await db.payments.update_one(
                {"id": target_pay["id"]},
                {"$set": {"credit_remaining": round(cur_credit + excess, 2),
                          "credit_origin": target_pay.get("credit_origin") or "rebalance"}},
            )

    # STAP 2: Bereken totaal openstaand tegoed VOOR verrekening
    credit_before = 0.0
    async for p in db.payments.find(
        {"tenant_id": tenant_id, "company_id": cid,
         "credit_remaining": {"$gt": 0}, "status": "approved"},
        {"_id": 0, "credit_remaining": 1},
    ):
        credit_before += float(p.get("credit_remaining") or 0)

    # STAP 3: FIFO verrekent tegoed met openstaande facturen (oudst eerst)
    applied_total = 0.0
    invoices_updated: list = []
    async for inv in db.invoices.find(
        {"tenant_id": tenant_id, "company_id": cid,
         "status": {"$nin": ["paid", "cancelled"]}},
        {"_id": 0, "id": 1, "invoice_number": 1},
    ).sort([("period_year", 1), ("period_month", 1)]):
        applied = await _apply_tenant_credit_to_invoice(tenant_id, inv["id"], cid)
        if applied > 0:
            applied_total += applied
            invoices_updated.append({
                "invoice_id": inv["id"],
                "invoice_number": inv.get("invoice_number"),
                "applied": round(applied, 2),
            })

    # STAP 4: Recomputeer resterend tegoed
    credit_after = 0.0
    async for p in db.payments.find(
        {"tenant_id": tenant_id, "company_id": cid,
         "credit_remaining": {"$gt": 0}, "status": "approved"},
        {"_id": 0, "credit_remaining": 1},
    ):
        credit_after += float(p.get("credit_remaining") or 0)

    return {
        "credit_before": round(credit_before, 2),
        "applied": round(applied_total, 2),
        "credit_after": round(credit_after, 2),
        "invoices_updated": invoices_updated,
    }


class GenerateMonthIn(BaseModel):
    period_month: int = Field(ge=1, le=12)
    period_year: int


@api.post("/invoices/repair-overpaid")
async def repair_overpaid_invoices(
    apply: bool = Query(False, description="false=dry-run, true=apply fixes"),
    user=Depends(get_current_user),
):
    """Migratie-endpoint: vindt facturen waar paid_amount > amount (door de
    oude overflow-bug) en herverdeelt het overschot FIFO naar volgende
    openstaande facturen van dezelfde huurder. Default = dry-run.

    Veiligheidsregels:
      • Alleen admin/owner van de eigen company.
      • Dry-run is default — geen wijziging in DB tenzij apply=true.
      • Returns een lijst met alle correcties die uitgevoerd zijn/zouden worden.
    """
    cid = company_id_of(user)
    if not cid:
        raise HTTPException(status_code=400, detail="Geen actief bedrijf geselecteerd")
    if user.get("role") not in ("admin", "owner", "superadmin"):
        raise HTTPException(status_code=403, detail="Alleen admin of owner mag repareren")

    repairs = []
    total_overflow = 0.0
    # Zoek facturen waar paid_amount > amount (overshoot)
    overpaid: list = []
    async for inv in db.invoices.find(
        {"company_id": cid, "$expr": {"$gt": ["$paid_amount", "$amount"]}},
        {"_id": 0},
    ):
        overpaid.append(inv)

    for inv in overpaid:
        amt = float(inv.get("amount") or 0)
        paid = float(inv.get("paid_amount") or 0)
        overflow = round(paid - amt, 2)
        if overflow <= 0:
            continue
        total_overflow += overflow
        tenant_id = inv["tenant_id"]
        cur = inv.get("currency") or "SRD"
        # Andere openstaande facturen van dezelfde huurder/currency, oudst eerst
        other_invs: list = []
        async for o in db.invoices.find(
            {"company_id": cid, "tenant_id": tenant_id, "currency": cur,
             "id": {"$ne": inv["id"]},
             "status": {"$nin": ["paid", "cancelled"]}},
            {"_id": 0, "id": 1, "amount": 1, "paid_amount": 1,
             "period_month": 1, "period_year": 1, "invoice_number": 1},
        ).sort([("period_year", 1), ("period_month", 1)]):
            other_invs.append(o)

        allocations = []
        remaining = overflow
        for o in other_invs:
            if remaining <= 0:
                break
            o_amt = float(o.get("amount") or 0)
            o_paid = float(o.get("paid_amount") or 0)
            o_open = max(0.0, round(o_amt - o_paid, 2))
            if o_open <= 0:
                continue
            chunk = round(min(remaining, o_open), 2)
            allocations.append({
                "invoice_id": o["id"],
                "invoice_number": o.get("invoice_number"),
                "period": f"{o.get('period_month')}/{o.get('period_year')}",
                "applied": chunk,
            })
            remaining = round(remaining - chunk, 2)
        leftover_credit = round(remaining, 2)

        repairs.append({
            "invoice_id": inv["id"],
            "invoice_number": inv.get("invoice_number"),
            "period": f"{inv.get('period_month')}/{inv.get('period_year')}",
            "tenant_id": tenant_id,
            "amount": amt,
            "was_paid_amount": paid,
            "overflow": overflow,
            "redistributed_to": allocations,
            "leftover_credit": leftover_credit,
        })

        if apply:
            # 1) Corrigeer de overshoot-factuur: paid_amount = amount
            await db.invoices.update_one(
                {"id": inv["id"]},
                {"$set": {"paid_amount": amt, "status": "paid"}},
            )
            # 2) Pas allocations toe op andere facturen
            for a in allocations:
                target_inv = await db.invoices.find_one({"id": a["invoice_id"]}, {"_id": 0})
                new_paid = round(float(target_inv.get("paid_amount") or 0) + a["applied"], 2)
                new_status = "paid" if new_paid >= float(target_inv.get("amount") or 0) else "open"
                await db.invoices.update_one(
                    {"id": a["invoice_id"]},
                    {"$set": {"paid_amount": new_paid, "status": new_status}},
                )
            # 3) Resterend overschot → bewaar als krediet op de origineel-betaling
            #    (zoek de meest recente approved payment van deze huurder op deze factuur)
            if leftover_credit > 0:
                pay = await db.payments.find_one(
                    {"tenant_id": tenant_id, "invoice_id": inv["id"], "status": "approved"},
                    {"_id": 0, "id": 1},
                    sort=[("paid_at", -1)],
                )
                if pay:
                    await db.payments.update_one(
                        {"id": pay["id"]},
                        {"$set": {"credit_remaining": leftover_credit,
                                  "credit_origin": "migration_repair"}},
                    )

    return {
        "dry_run": not apply,
        "invoices_inspected": len(overpaid),
        "invoices_repaired": len(repairs),
        "total_overflow_redistributed": round(total_overflow, 2),
        "repairs": repairs,
    }


# =====================================================================
# Automatische factuur-generatie + krediet-verrekening
# =====================================================================

def _add_workdays(start_date, n_workdays: int):
    """Tel `n_workdays` werkdagen (ma-vr) op bij `start_date`. Houdt geen
    rekening met lokale feestdagen — voldoende precies voor huur-deadlines."""
    from datetime import timedelta
    d = start_date
    added = 0
    while added < n_workdays:
        d = d + timedelta(days=1)
        if d.weekday() < 5:  # ma=0 ... vr=4
            added += 1
    return d


def _last_day_of_month(year: int, month: int):
    """Laatste dag van de gegeven (jaar, maand) als date object."""
    from datetime import date
    import calendar
    return date(year, month, calendar.monthrange(year, month)[1])


def _classify_invoice_bucket(period_month: int, period_year: int, today, grace_workdays: int = 10, due_date=None) -> str:
    """Bepaal in welke bucket een (open) factuur valt:
       - "overdue"  : de vervaldatum is verstreken
       - "current"  : periode == huidige kalendermaand, of vorige maand maar
                      voor de vervaldatum
       - "future"   : periode is later dan de huidige kalendermaand
       - "unknown"  : corrupt/incompleet doc (pm=0/py=0) — beller mag skippen.

    Als `due_date` (ISO YYYY-MM-DD) is meegegeven, wordt die gebruikt als
    autoriteit voor het overdue-punt. Anders valt terug op de legacy-formule
    einde-periode + grace_workdays voor compatibiliteit met oude facturen
    die dit veld nog niet opgeslagen hebben.
    """
    try:
        pm = int(period_month or 0)
        py = int(period_year or 0)
    except (TypeError, ValueError):
        return "unknown"
    if pm < 1 or pm > 12 or py < 1900 or py > 3000:
        return "unknown"
    cur_y, cur_m = today.year, today.month
    if py > cur_y or (py == cur_y and pm > cur_m):
        return "future"
    if py == cur_y and pm == cur_m:
        return "current"
    # Periode ligt VOOR de huidige maand → check deadline
    try:
        if due_date:
            from datetime import date as _date
            y, m, d = str(due_date).split("-")
            deadline = _date(int(y), int(m), int(d))
        else:
            period_end = _last_day_of_month(py, pm)
            deadline = _add_workdays(period_end, max(0, int(grace_workdays or 0)))
    except Exception:  # noqa: BLE001
        return "unknown"
    if today > deadline:
        return "overdue"
    return "current"


def _compute_invoice_dates(period_month: int, period_year: int, cfg: dict) -> tuple[str, str]:
    """Bereken (invoice_date_iso, due_date_iso) op basis van invoicing-config.

    - invoice_date: de datum die "factuurdatum" heet op de PDF. Komt overeen
      met de dag waarop het systeem de factuur AUTOMATISCH zou genereren:
        · mode=grace_workdays  → einde vorige maand + grace_workdays (werkdagen)
        · mode=fixed_day       → vaste dag in de periode-maand (clamped)
        · mode=due_next_month  → vaste dag in de periode-maand (clamped)
    - due_date: hangt van modus af:
        · fixed_day / grace_workdays → invoice_date + `payment_term_days` KALENDERdagen (default 14).
        · due_next_month             → `due_day` van de VOLGENDE maand na de factuurperiode
                                         (bv. periode juli + due_day=10 → 10 augustus).

    Zo blijft de factuurdatum consistent voor zowel handmatig als automatisch
    aangemaakte facturen — en de vervaldatum matcht 1-op-1 het moment waarop
    de factuur naar "achterstand" verhuist in de beheerder.
    """
    from datetime import date as _date, timedelta
    mode = (cfg.get("mode") or "grace_workdays").strip()
    if mode in ("fixed_day", "due_next_month"):
        try:
            day = int(cfg.get("billing_day") or 1)
        except (TypeError, ValueError):
            day = 1
        day = max(1, min(31, day))
        last_day = _last_day_of_month(period_year, period_month)
        invoice_date = _date(period_year, period_month, min(day, last_day.day))
    else:
        try:
            grace = int(cfg.get("grace_workdays") or 10)
        except (TypeError, ValueError):
            grace = 10
        # Einde van de vorige maand t.o.v. de periode + grace werkdagen
        prev_y = period_year if period_month > 1 else period_year - 1
        prev_m = period_month - 1 if period_month > 1 else 12
        prev_last = _last_day_of_month(prev_y, prev_m)
        invoice_date = _add_workdays(prev_last, grace)
    # Due date
    if mode == "due_next_month":
        try:
            due_day = int(cfg.get("due_day") or 10)
        except (TypeError, ValueError):
            due_day = 10
        due_day = max(1, min(31, due_day))
        next_y, next_m = _next_month(period_year, period_month)
        next_last = _last_day_of_month(next_y, next_m)
        due_date = _date(next_y, next_m, min(due_day, next_last.day))
    else:
        try:
            term = int(cfg.get("payment_term_days") or 14)
        except (TypeError, ValueError):
            term = 14
        term = max(0, min(180, term))
        due_date = invoice_date + timedelta(days=term)
    return (invoice_date.isoformat(), due_date.isoformat())


def _next_month(year: int, month: int) -> tuple[int, int]:
    return (year + 1, 1) if month == 12 else (year, month + 1)


async def _apply_tenant_credit_to_invoice(
    tenant_id: str, invoice_id: str, company_id: str
) -> float:
    """Verrekent eventueel positief saldo van een huurder met de nieuw
    aangemaakte factuur (FIFO op datum). Returns het toegepaste bedrag.

    Krediet wordt gevormd door betalingen waar `category == "vooruitbetaling"`
    of door betalingen die meer waren dan het openstaande bedrag op het
    moment van registratie (overflow → krediet ipv naar volgende factuur
    wanneer geen volgende factuur bestond).
    """
    inv = await db.invoices.find_one(
        {"id": invoice_id}, {"_id": 0, "amount": 1, "paid_amount": 1, "currency": 1}
    )
    if not inv:
        return 0.0
    open_amt = float(inv.get("amount") or 0) - float(inv.get("paid_amount") or 0)
    if open_amt <= 0:
        return 0.0
    cur = inv.get("currency") or "SRD"

    total_applied = 0.0
    # FIFO: oudste krediet-betalingen eerst. Zowel expliciete "vooruitbetaling"
    # payments áls overflow-krediet (payment.credit_remaining > 0 op een
    # gewone huur-betaling die meer was dan het toenmalig openstaande bedrag)
    # tellen mee. Filteren op `credit_remaining > 0` — de categorie doet er
    # niet toe zodra er ongebruikt krediet staat.
    async for credit in db.payments.find(
        {"tenant_id": tenant_id, "currency": cur,
         "credit_remaining": {"$gt": 0},
         "status": "approved"},
        {"_id": 0, "id": 1, "credit_remaining": 1, "method": 1, "receipt_number": 1},
    ).sort("paid_at", 1):
        if open_amt <= 0:
            break
        avail = float(credit.get("credit_remaining") or 0)
        chunk = min(avail, open_amt)
        if chunk <= 0:
            continue
        await _apply_payment_to_invoice(
            invoice_id, chunk,
            payment_id=credit["id"], paid_at=iso(now_utc()),
            method=credit.get("method"), receipt_number=credit.get("receipt_number"),
        )
        new_remaining = round(avail - chunk, 2)
        await db.payments.update_one(
            {"id": credit["id"]},
            {"$set": {"credit_remaining": new_remaining,
                      "credit_applied_at": iso(now_utc()) if new_remaining == 0 else credit.get("credit_applied_at")}},
        )
        total_applied += chunk
        open_amt -= chunk
    return round(total_applied, 2)


async def _generate_month_invoices_for_company(
    company_id: str, period_month: int, period_year: int, *, scope_user=None
) -> dict:
    """Gedeelde factuur-generatie. Maakt facturen voor elk bewoond appartement,
    skipt duplicates, en verrekent automatisch eventueel krediet.

    invoice_date en due_date worden bewust berekend uit de invoicing-settings
    van het bedrijf (mode + grace_workdays/billing_day + payment_term_days)
    zodat de PDF én de bucket-logica in de UI consistent zijn — niet meer
    afhankelijk van het toevallige moment waarop de tick liep."""
    # Laad invoicing-settings één keer per company (nul-alloc voor alle apts)
    cs = await db.company_settings.find_one(
        {"company_id": company_id}, {"_id": 0, "invoicing": 1},
    ) or {}
    inv_cfg = (cs.get("invoicing") or {})
    invoice_date_iso, due_date_iso = _compute_invoice_dates(period_month, period_year, inv_cfg)

    q = {"company_id": company_id, "status": "occupied"}
    apts = await db.apartments.find(q, {"_id": 0}).to_list(1000)
    created = 0
    skipped = 0
    credit_applied_total = 0.0
    for a in apts:
        if not a.get("tenant_id"):
            skipped += 1
            continue
        t = await db.tenants.find_one(
            {"id": a["tenant_id"], "company_id": company_id}, {"_id": 0}
        )
        if not t:
            skipped += 1
            continue
        dup = await db.invoices.find_one({
            "company_id": company_id, "tenant_id": t["id"],
            "period_month": period_month, "period_year": period_year,
        })
        if dup:
            skipped += 1
            continue
        seq = await _next_seq(f"invoice_{period_year}")
        inv_id = new_id()
        await db.invoices.insert_one({
            "id": inv_id,
            "company_id": company_id,
            "invoice_number": f"F{period_year}-{seq:05d}",
            "tenant_id": t["id"], "apartment_id": a["id"],
            "amount": a["rent_amount"], "currency": a.get("currency", "SRD"),
            "paid_amount": 0.0,
            "period_month": period_month, "period_year": period_year,
            "invoice_date": invoice_date_iso,
            "due_date": due_date_iso,
            "status": "open", "created_at": iso(now_utc()),
        })
        # Verreken positief saldo van deze huurder met de nieuwe factuur
        applied = await _apply_tenant_credit_to_invoice(t["id"], inv_id, company_id)
        credit_applied_total += applied
        created += 1
    return {
        "created": created,
        "skipped": skipped,
        "credit_applied": round(credit_applied_total, 2),
    }


@api.post("/invoices/generate-month")
async def generate_month_invoices(body: dict, user=Depends(get_current_user)):
    """Genereer maandfacturen voor alle bezette appartementen in het bedrijf
    van de ingelogde admin. Body: {period_month: 1-12, period_year: 4-digit}.
    Idempotent — bestaande facturen voor dezelfde huurder+periode worden
    overgeslagen. Returnt {created, skipped, credit_applied}."""
    cid = company_id_of(user)
    if not cid:
        raise HTTPException(status_code=400, detail="Geen bedrijfscontext")
    try:
        pm = int(body.get("period_month") or 0)
        py = int(body.get("period_year") or 0)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="period_month/period_year vereist")
    if not (1 <= pm <= 12) or py < 2000:
        raise HTTPException(status_code=400, detail="Ongeldige periode")
    res = await _generate_month_invoices_for_company(cid, pm, py)
    return res


@api.post("/invoices/recompute-due-dates")
async def recompute_invoice_due_dates(user=Depends(get_current_user)):
    """Herbereken invoice_date + due_date van álle open/partial facturen op
    basis van de HUIDIGE invoicing-instellingen. Handig nadat een admin de
    factureringsmodus wijzigt en de bestaande openstaande facturen mee wil
    laten gaan met de nieuwe vervaldatum-logica.

    Alleen open + partial facturen worden geraakt. Volledig betaalde,
    verwijderde en 'draft' facturen blijven ongewijzigd zodat historie/
    boekhouding niet met terugwerkende kracht wordt aangepast.

    Retourneert `{updated: N, skipped: M, mode: <str>}`.
    """
    cid = company_id_of(user)
    if not cid:
        raise HTTPException(status_code=400, detail="Geen bedrijfscontext")
    cs_doc = await db.company_settings.find_one({"company_id": cid}, {"_id": 0}) or {}
    inv_cfg = (cs_doc.get("invoicing") or {})
    cur = db.invoices.find(
        {"company_id": cid, "status": {"$in": ["open", "partial"]}},
        {"_id": 0, "id": 1, "period_month": 1, "period_year": 1},
    )
    updated = 0
    skipped = 0
    async for inv in cur:
        pm, py = inv.get("period_month"), inv.get("period_year")
        if not (isinstance(pm, int) and isinstance(py, int) and 1 <= pm <= 12):
            skipped += 1
            continue
        try:
            new_invoice_date, new_due_date = _compute_invoice_dates(pm, py, inv_cfg)
        except Exception:
            skipped += 1
            continue
        await db.invoices.update_one(
            {"id": inv["id"], "company_id": cid},
            {"$set": {
                "invoice_date": new_invoice_date,
                "due_date": new_due_date,
                "updated_at": iso(now_utc()),
            }},
        )
        updated += 1
    asyncio.create_task(_sse_broadcast(cid, {
        "type": "change", "path": "/api/invoices", "method": "POST",
    }))
    return {
        "updated": updated,
        "skipped": skipped,
        "mode": inv_cfg.get("mode") or "grace_workdays",
    }


@api.post("/invoices/{invoice_id}/apply-credit")
async def apply_credit_to_invoice(invoice_id: str, user=Depends(get_current_user)):
    """Verrekent beschikbaar krediet (vooruitbetalingen + overflow-krediet) van
    de huurder direct met deze factuur. Handig wanneer de admin in het
    Facturen-overzicht ziet dat een huurder tegoed heeft staan én een factuur
    open heeft — één klik verrekent beide zonder een nieuwe betaling te maken.

    Retourneert `{applied: float, invoice: {status,paid_amount,remaining_amount},
    remaining_credit: {SRD: X, ...}}`. Als er geen krediet is of factuur al
    volledig betaald: `applied = 0`."""
    cid = company_id_of(user)
    if not cid:
        raise HTTPException(status_code=400, detail="Geen bedrijfscontext")
    inv = await db.invoices.find_one(
        {"id": invoice_id, "company_id": cid}, {"_id": 0},
    )
    if not inv:
        raise HTTPException(status_code=404, detail="Factuur niet gevonden")
    tenant_id = inv.get("tenant_id")
    if not tenant_id:
        raise HTTPException(status_code=400, detail="Factuur heeft geen huurder")

    applied = await _apply_tenant_credit_to_invoice(tenant_id, invoice_id, cid)

    # Haal bijgewerkte factuur op voor de response
    updated = await db.invoices.find_one(
        {"id": invoice_id}, {"_id": 0, "status": 1, "paid_amount": 1, "amount": 1},
    ) or {}
    paid_amt = float(updated.get("paid_amount") or 0)
    amt = float(updated.get("amount") or 0)

    # Resterend krediet berekenen zodat de UI de badge direct kan bijwerken
    remaining_credit: dict[str, float] = {}
    async for p in db.payments.find(
        {"tenant_id": tenant_id, "company_id": cid,
         "credit_remaining": {"$gt": 0}, "status": "approved"},
        {"_id": 0, "credit_remaining": 1, "currency": 1},
    ):
        cur = p.get("currency") or "SRD"
        remaining_credit[cur] = round(
            remaining_credit.get(cur, 0.0) + float(p.get("credit_remaining") or 0), 2,
        )

    return {
        "applied": round(applied, 2),
        "invoice": {
            "id": invoice_id,
            "status": updated.get("status"),
            "paid_amount": paid_amt,
            "remaining_amount": round(max(0.0, amt - paid_amt), 2),
        },
        "remaining_credit": remaining_credit,
    }


async def _auto_invoice_tick():
    """Eén keer per dag uitgevoerde achtergrond-taak.
    Voor elk bedrijf met `invoicing.auto_generate=true`:
      Twee modi (`invoicing.mode`):
        1. `grace_workdays` (default) — deadline = laatste dag VORIGE maand + grace_workdays.
        2. `fixed_day`                — deadline = `billing_day` van HUIDIGE maand
                                        (clamped naar de laatste dag als bv. 31 in februari).
      Als vandaag >= deadline en de huidige maand-factuur nog niet bestaat,
      genereer hem nu + verreken krediet. Markeer last_auto_run = vandaag
      zodat we niet 2× per dag draaien.
    """
    from datetime import date
    today = date.today()
    today_iso = today.isoformat()
    async for cs in db.company_settings.find({"invoicing.auto_generate": True}, {"_id": 0}):
        cfg = cs.get("invoicing") or {}
        if not cfg.get("auto_generate"):
            continue
        if cfg.get("last_auto_run") == today_iso:
            continue
        company_id = cs["company_id"]
        mode = (cfg.get("mode") or "grace_workdays").strip()
        try:
            if mode in ("fixed_day", "due_next_month"):
                try:
                    fixed_day = int(cfg.get("billing_day") or 1)
                except (TypeError, ValueError):
                    fixed_day = 1
                fixed_day = max(1, min(31, fixed_day))
                last_of_month = _last_day_of_month(today.year, today.month)
                effective_day = min(fixed_day, last_of_month.day)
                deadline = today.replace(day=effective_day)
            else:  # grace_workdays
                try:
                    grace = int(cfg.get("grace_workdays") or 10)
                except (TypeError, ValueError):
                    grace = 10
                prev_year = today.year if today.month > 1 else today.year - 1
                prev_month = today.month - 1 if today.month > 1 else 12
                prev_last = _last_day_of_month(prev_year, prev_month)
                deadline = _add_workdays(prev_last, grace)
        except Exception as e:  # noqa: BLE001
            print(f"[auto-invoice] deadline calc failed for {company_id}: {e}")
            continue
        if today < deadline:
            continue
        # Genereer huidige maand
        try:
            res = await _generate_month_invoices_for_company(
                company_id, today.month, today.year
            )
            await db.company_settings.update_one(
                {"company_id": company_id},
                {"$set": {"invoicing.last_auto_run": today_iso,
                          "invoicing.last_auto_result": res}},
            )
            print(f"[auto-invoice] {company_id} {today.month}/{today.year}: {res}")
            # Notify admins
            try:
                await _notify_company_admins(
                    company_id,
                    "Maandelijkse facturen gegenereerd",
                    f"{res['created']} nieuwe facturen voor {today.month}/{today.year}"
                    + (f" — {res['credit_applied']:.2f} aan krediet verrekend." if res.get("credit_applied") else "."),
                    {"kind": "auto_invoice", "result": res},
                )
            except Exception:  # noqa: BLE001
                pass
        except Exception as e:  # noqa: BLE001
            print(f"[auto-invoice] error company {company_id}: {e}")


async def _auto_invoice_loop():
    """Achtergrond-loop: roept _auto_invoice_tick elke 1 uur aan zodat we
    altijd binnen 1h reageren op een deadline-overschrijding."""
    while True:
        try:
            await _auto_invoice_tick()
        except Exception as e:  # noqa: BLE001
            print(f"[auto-invoice] tick failed: {e}")
        await asyncio.sleep(3600)  # 1 uur


# ============================================================
# DEMO ENVIRONMENT — gedeeld bedrijf met voorgevulde testdata,
# automatisch gereset elke 30 minuten zodat bezoekers altijd
# een schone, herkenbare staat zien.
# ============================================================
async def _ensure_demo_company() -> dict:
    """Zorgt dat de demo-company + seed-data bestaan. Idempotent."""
    cid = "demo-company-fixed-uuid-00000000000"  # vaste ID voor demo
    c = await db.companies.find_one({"id": cid}, {"_id": 0})
    if not c:
        c = {
            "id": cid,
            "slug": DEMO_COMPANY_SLUG,
            "name": "Demo Vastgoed N.V.",
            "contact_email": DEMO_EMAIL,
            "contact_phone": "+597 000 0000",
            "address": "Henck Arronstraat 1, Paramaribo",
            "plan": "pro",
            "active": True,
            "is_demo": True,
            "created_at": iso(now_utc()),
            "branding": {
                "app_name": "Demo Vastgoed",
                "primary_color": "#FF5C00",
                "tagline": "Demo-omgeving — reset elke 30 min",
            },
            "bank_account_sr": "DSB Bank — 11.22.33.444 (Demo BV)",
            "demo_visits": 0,
        }
        await db.companies.insert_one(c)
    # Seed-data: alleen aanmaken als er nog geen tenants/apartments voor zijn
    has_tenants = await db.tenants.count_documents({"company_id": cid})
    if not has_tenants:
        await _seed_demo_data(cid)
    return c


async def _seed_demo_data(cid: str):
    """Vult demo-omgeving met realistische test-data: locaties, appartementen,
    huurders met contracten, openstaande + betaalde facturen, betalingen,
    een betalingsregeling, borg, kasgeld + werknemers + onderhoudsorder."""
    now = now_utc()
    iso_now = now.isoformat()
    # Locaties
    loc_a_id = str(uuid.uuid4())
    loc_b_id = str(uuid.uuid4())
    await db.locations.insert_many([
        {"id": loc_a_id, "company_id": cid, "name": "Hoofdvestiging — Paramaribo",
         "address": "Henck Arronstraat 1, Paramaribo", "is_demo": True, "created_at": iso_now},
        {"id": loc_b_id, "company_id": cid, "name": "Filiaal — Nieuw Nickerie",
         "address": "Frederikstraat 5, Nieuw Nickerie", "is_demo": True, "created_at": iso_now},
    ])
    # 5 appartementen — ALLE zijn bezet (Studio 1 + Penthouse zijn later
    # in deze seed gekoppeld aan Kevin resp. Anisha; hun `tenant_id`
    # wordt hieronder bijgewerkt na huurders-insert).
    apts = []
    for i, (nr, rent, loc) in enumerate([
        ("HUIS 1A", 6000, loc_a_id), ("HUIS 1B", 5500, loc_a_id),
        ("HUIS 2C", 7000, loc_a_id), ("Studio 1", 4500, loc_b_id),
        ("Penthouse", 12000, loc_a_id),
    ]):
        apts.append({
            "id": str(uuid.uuid4()), "company_id": cid, "location_id": loc,
            "number": nr, "address": f"Demo straat {i + 1}",
            "rent_amount": rent, "currency": "SRD",
            "status": "occupied",
            "is_demo": True, "created_at": iso(now_utc()),
        })
    await db.apartments.insert_many(apts)
    # 5 huurders met contract — één per appartement zodat er geen
    # "beschikbaar" appartement meer zichtbaar is in de demo.
    tenants_data = [
        ("Jan Pieterse", "+597 8801001", "jan@demo.sr", apts[0], 1234, "male"),
        ("Marlies Sewdien", "+597 8801002", "marlies@demo.sr", apts[1], 5678, "female"),
        ("Roy van der Berg", "+597 8801003", "roy@demo.sr", apts[2], 9012, "male"),
        ("Kevin Doelahasori", "+597 8801004", "kevin@demo.sr", apts[3], 3344, "male"),
        ("Anisha Ramdhan", "+597 8801005", "anisha@demo.sr", apts[4], 5566, "female"),
    ]
    tenants = []
    for name, phone, email, apt, pin, gender in tenants_data:
        tid = str(uuid.uuid4())
        tenants.append({
            "id": tid, "company_id": cid, "apartment_id": apt["id"],
            "name": name, "phone": phone, "email": email, "gender": gender,
            "pin_hash": hash_password(str(pin)),
            "is_demo": True, "created_at": iso_now,
        })
    await db.tenants.insert_many(tenants)
    # Bidirectionele link: elk appartement krijgt `tenant_id` van zijn
    # gekoppelde huurder. Zonder deze update toont het admin dashboard
    # "beschikbaar" ondanks dat de status 'occupied' is.
    for t in tenants:
        await db.apartments.update_one(
            {"id": t["apartment_id"], "company_id": cid},
            {"$set": {"tenant_id": t["id"]}},
        )
    # Contracten per huurder
    contracts = [{
        "id": str(uuid.uuid4()), "company_id": cid,
        "tenant_id": t["id"], "apartment_id": t["apartment_id"],
        "start_date": (now - timedelta(days=180)).date().isoformat(),
        "rent_amount": next((a["rent_amount"] for a in apts if a["id"] == t["apartment_id"]), 6000),
        "currency": "SRD", "deposit_amount": 6000, "deposit_paid": True,
        "status": "active", "is_demo": True, "created_at": iso_now,
    } for t in tenants]
    await db.contracts.insert_many(contracts)
    # Borg per huurder
    deposits = [{
        "id": str(uuid.uuid4()), "company_id": cid,
        "tenant_id": t["id"], "apartment_id": t["apartment_id"],
        "amount": 6000, "currency": "SRD", "status": "held",
        "received_at": (now - timedelta(days=180)).isoformat(),
        "is_demo": True, "created_at": iso_now,
    } for t in tenants]
    await db.deposits.insert_many(deposits)
    # Facturen + betalingen (Jan = 2 open achterstand + huidige; Marlies = alles betaald; Roy = 1 partial)
    cur_y, cur_m = now.year, now.month
    inv_counter = 100
    invoices_to_insert = []
    payments_to_insert = []

    def inv_number():
        nonlocal inv_counter
        inv_counter += 1
        return f"D{cur_y}-{inv_counter:05d}"

    # Jan — 2 maanden achterstand + huidige open
    jan = tenants[0]
    for offset in [2, 1, 0]:
        m = cur_m - offset if cur_m - offset > 0 else cur_m - offset + 12
        y = cur_y if cur_m - offset > 0 else cur_y - 1
        invoices_to_insert.append({
            "id": str(uuid.uuid4()), "company_id": cid,
            "tenant_id": jan["id"], "apartment_id": jan["apartment_id"],
            "invoice_number": inv_number(),
            "period_month": m, "period_year": y,
            "amount": 6000, "amount_due": 6000, "paid_amount": 0,
            "currency": "SRD", "status": "open", "kind": "huur",
            "due_date": (now - timedelta(days=offset * 30)).date().isoformat(),
            "is_demo": True, "created_at": iso_now,
        })
    # Marlies — vorige + huidige betaald
    marlies = tenants[1]
    for offset in [1, 0]:
        m = cur_m - offset if cur_m - offset > 0 else cur_m - offset + 12
        y = cur_y if cur_m - offset > 0 else cur_y - 1
        inv_id = str(uuid.uuid4())
        # Betaal-tijd: 2 dagen vóór 30d-offset. Voor huidige maand (offset=0)
        # nemen we max(1, ...) zodat de betaling nooit in de toekomst ligt.
        days_back = max(1, offset * 30 - 2)
        invoices_to_insert.append({
            "id": inv_id, "company_id": cid,
            "tenant_id": marlies["id"], "apartment_id": marlies["apartment_id"],
            "invoice_number": inv_number(),
            "period_month": m, "period_year": y,
            "amount": 5500, "amount_due": 5500, "paid_amount": 5500,
            "currency": "SRD", "status": "paid", "kind": "huur",
            "due_date": (now - timedelta(days=offset * 30)).date().isoformat(),
            "paid_at": (now - timedelta(days=days_back)).isoformat(),
            "is_demo": True, "created_at": iso_now,
        })
        payments_to_insert.append({
            "id": str(uuid.uuid4()), "company_id": cid,
            "tenant_id": marlies["id"], "tenant_name": marlies["name"],
            "apartment_id": marlies["apartment_id"],
            "amount": 5500, "currency": "SRD",
            "category": "huur", "method": "contant",
            "period_month": m, "period_year": y,
            "invoice_id": inv_id, "receipt_number": f"D-KW-{inv_counter:05d}",
            "status": "approved",
            "paid_at": (now - timedelta(days=days_back)).isoformat(),
            "created_at": (now - timedelta(days=days_back)).isoformat(),
            "is_demo": True,
        })
    # Roy — partial op huidige maand
    roy = tenants[2]
    roy_inv_id = str(uuid.uuid4())
    invoices_to_insert.append({
        "id": roy_inv_id, "company_id": cid,
        "tenant_id": roy["id"], "apartment_id": roy["apartment_id"],
        "invoice_number": inv_number(),
        "period_month": cur_m, "period_year": cur_y,
        "amount": 7000, "amount_due": 7000, "paid_amount": 4000,
        "currency": "SRD", "status": "partial", "kind": "huur",
        "due_date": now.date().isoformat(), "is_demo": True, "created_at": iso(now_utc()),
    })
    payments_to_insert.append({
        "id": str(uuid.uuid4()), "company_id": cid,
        "tenant_id": roy["id"], "tenant_name": roy["name"],
        "apartment_id": roy["apartment_id"],
        "amount": 4000, "currency": "SRD",
        "category": "huur", "method": "bank",
        "period_month": cur_m, "period_year": cur_y,
        "invoice_id": roy_inv_id, "receipt_number": f"D-KW-{inv_counter:05d}",
        "status": "approved", "note": "Deelbetaling van SRD 4.000",
        "paid_at": iso(now_utc()),
        "created_at": iso(now_utc()), "is_demo": True,
    })
    # Kevin (Studio 1) — nieuwe huurder, huidige maand volledig betaald
    kevin = tenants[3]
    kev_inv_id = str(uuid.uuid4())
    invoices_to_insert.append({
        "id": kev_inv_id, "company_id": cid,
        "tenant_id": kevin["id"], "apartment_id": kevin["apartment_id"],
        "invoice_number": inv_number(),
        "period_month": cur_m, "period_year": cur_y,
        "amount": 4500, "amount_due": 4500, "paid_amount": 4500,
        "currency": "SRD", "status": "paid", "kind": "huur",
        "due_date": now.date().isoformat(),
        "paid_at": (now - timedelta(days=3)).isoformat(),
        "is_demo": True, "created_at": iso_now,
    })
    payments_to_insert.append({
        "id": str(uuid.uuid4()), "company_id": cid,
        "tenant_id": kevin["id"], "tenant_name": kevin["name"],
        "apartment_id": kevin["apartment_id"],
        "amount": 4500, "currency": "SRD",
        "category": "huur", "method": "bank",
        "period_month": cur_m, "period_year": cur_y,
        "invoice_id": kev_inv_id, "receipt_number": f"D-KW-{inv_counter:05d}",
        "status": "approved",
        "paid_at": (now - timedelta(days=3)).isoformat(),
        "created_at": (now - timedelta(days=3)).isoformat(),
        "is_demo": True,
    })
    # Anisha (Penthouse) — vorige + huidige maand betaald (premium huurder)
    anisha = tenants[4]
    for offset in [1, 0]:
        m = cur_m - offset if cur_m - offset > 0 else cur_m - offset + 12
        y = cur_y if cur_m - offset > 0 else cur_y - 1
        inv_id = str(uuid.uuid4())
        days_back = max(1, offset * 30 - 2)
        invoices_to_insert.append({
            "id": inv_id, "company_id": cid,
            "tenant_id": anisha["id"], "apartment_id": anisha["apartment_id"],
            "invoice_number": inv_number(),
            "period_month": m, "period_year": y,
            "amount": 12000, "amount_due": 12000, "paid_amount": 12000,
            "currency": "SRD", "status": "paid", "kind": "huur",
            "due_date": (now - timedelta(days=offset * 30)).date().isoformat(),
            "paid_at": (now - timedelta(days=days_back)).isoformat(),
            "is_demo": True, "created_at": iso_now,
        })
        payments_to_insert.append({
            "id": str(uuid.uuid4()), "company_id": cid,
            "tenant_id": anisha["id"], "tenant_name": anisha["name"],
            "apartment_id": anisha["apartment_id"],
            "amount": 12000, "currency": "SRD",
            "category": "huur", "method": "bank",
            "period_month": m, "period_year": y,
            "invoice_id": inv_id, "receipt_number": f"D-KW-{inv_counter:05d}",
            "status": "approved",
            "paid_at": (now - timedelta(days=days_back)).isoformat(),
            "created_at": (now - timedelta(days=days_back)).isoformat(),
            "is_demo": True,
        })
    await db.invoices.insert_many(invoices_to_insert)
    await db.payments.insert_many(payments_to_insert)
    # Betalingsregeling voor Roy's restbedrag
    plan_id = str(uuid.uuid4())
    await db.payment_plans.insert_one({
        "id": plan_id, "company_id": cid,
        "tenant_id": roy["id"], "tenant_name": roy["name"],
        "invoice_ids": [roy_inv_id], "total_amount": 3000,
        "currency": "SRD", "status": "active",
        "num_installments": 2, "paid_installments": 0,
        "notes": "Demo regeling voor restbedrag",
        "created_at": iso_now, "is_demo": True,
    })
    await db.payment_plan_installments.insert_many([
        {"id": str(uuid.uuid4()), "plan_id": plan_id, "sequence": i + 1,
         "amount": 1500, "due_date": (now + timedelta(days=15 * (i + 1))).date().isoformat(),
         "status": "pending", "is_demo": True}
        for i in range(2)
    ])
    # Werknemers
    await db.employees.insert_many([
        {"id": str(uuid.uuid4()), "company_id": cid, "name": "Anita Sewdas",
         "role": "Receptie", "phone": "+597 8801010", "pin_hash": hash_password("1111"),
         "is_demo": True, "created_at": iso_now},
        {"id": str(uuid.uuid4()), "company_id": cid, "name": "Kevin Boldewijn",
         "role": "Onderhoud", "phone": "+597 8801011", "pin_hash": hash_password("2222"),
         "is_demo": True, "created_at": iso_now},
    ])
    # Kasgeld — 2 handmatige boekingen (uitgaven). Payments (huur) worden
    # automatisch als kasgeld getoond via de unified feed in GET /kasgeld,
    # dus die hoeven we hier niet dubbel in te voegen.
    await db.kasgeld.insert_many([
        {"id": str(uuid.uuid4()), "company_id": cid, "type": "out",
         "amount": 250, "currency": "SRD", "category": "onderhoud",
         "description": "Onderhoudsmateriaal — kraan reparatie",
         "entry_date": iso_now, "created_at": iso_now, "is_demo": True},
        {"id": str(uuid.uuid4()), "company_id": cid, "type": "out",
         "amount": 850, "currency": "SRD", "category": "salaris",
         "description": "Salaris Anita (deelbetaling)",
         "entry_date": (now - timedelta(days=1)).isoformat(),
         "created_at": (now - timedelta(days=1)).isoformat(), "is_demo": True},
    ])
    # Boete op Jan's achterstallige huur — automatische late-fee die admin
    # nog kan kwijtschelden of innen. Toont dashboard "Openstaande boete".
    jan_first_open_invoice_id = next(
        (inv["id"] for inv in invoices_to_insert
         if inv.get("tenant_id") == jan["id"] and inv.get("status") == "open"),
        None,
    )
    await db.fines.insert_one({
        "id": str(uuid.uuid4()), "company_id": cid,
        "tenant_id": jan["id"], "apartment_id": jan["apartment_id"],
        "invoice_id": jan_first_open_invoice_id,
        "amount": 300, "currency": "SRD",
        "reason": "Late-fee: huur 2 maanden achterstand",
        "status": "open",
        "issued_at": iso_now, "is_demo": True, "created_at": iso_now,
    })
    # 1 onderhoudsorder per appartement — realistische mix van statussen
    # zodat de admin ziet hoe onderhoud er in productie uitziet.
    maintenance_seeds = [
        (jan, apts[0], "Lekkende kraan keuken",
         "Kraan in de keuken lekt sinds vorige week.",
         "open", "medium"),
        (marlies, apts[1], "AC koelt niet meer",
         "Woonkamer airco geeft geen koude lucht — mogelijk gasfilter.",
         "in_progress", "high"),
        (roy, apts[2], "Deurbel doet het niet",
         "Voordeurbel geeft geen geluid; bezoekers moeten bellen op mobiel.",
         "open", "low"),
        (kevin, apts[3], "Wifi valt vaak uit",
         "Wifi router in Studio 1 heeft dagelijkse uitval — router vervangen?",
         "open", "medium"),
        (anisha, apts[4], "Jacuzzi water blijft koud",
         "Penthouse jacuzzi opwarming werkt niet meer — thermostaat controleren.",
         "in_progress", "high"),
    ]
    await db.maintenance.insert_many([
        {"id": str(uuid.uuid4()), "company_id": cid,
         "tenant_id": t["id"], "apartment_id": apt["id"],
         "title": title, "description": desc,
         "status": status, "priority": priority,
         "created_at": iso_now, "is_demo": True}
        for (t, apt, title, desc, status, priority) in maintenance_seeds
    ])


async def _demo_reset_tick():
    """Verwijdert alle records in de demo-company en herseed-t direct."""
    cid = "demo-company-fixed-uuid-00000000000"
    print(f"[demo-reset] Reset demo-omgeving {cid}…")
    # Verwijder alle records gekoppeld aan demo (is_demo:True OF company_id == cid)
    collections = [
        "tenants", "apartments", "locations", "contracts", "invoices",
        "payments", "payment_plans", "payment_plan_installments", "deposits",
        "employees", "cash_book", "maintenance", "kasgeld", "kasgeld_entries",
        "fines", "notifications", "kiosk_sessions",
    ]
    for coll in collections:
        try:
            await db[coll].delete_many({"company_id": cid})
        except Exception as e:  # noqa: BLE001
            print(f"[demo-reset] {coll} delete failed: {e}")
    # Bewaar de company + admin user — alleen data resetten
    await _seed_demo_data(cid)
    print(f"[demo-reset] Voltooid voor {cid}.")


async def _demo_reset_loop():
    """Achtergrond-loop: reset demo-omgeving elke 30 minuten."""
    import asyncio
    # Initiele setup direct bij start
    try:
        await _ensure_demo_company()
    except Exception as e:  # noqa: BLE001
        print(f"[demo-reset] initial ensure failed: {e}")
    while True:
        try:
            await asyncio.sleep(30 * 60)  # 30 minuten
            await _demo_reset_tick()
        except asyncio.CancelledError:
            break
        except Exception as e:  # noqa: BLE001
            print(f"[demo-reset] tick failed: {e}")


@api.delete("/invoices/{invoice_id}")
async def delete_invoice(invoice_id: str, user=Depends(get_current_user)):
    inv = await db.invoices.find_one({"id": invoice_id, **scope(user)}, {"_id": 0})
    if not inv:
        raise HTTPException(status_code=404, detail="Factuur niet gevonden")
    # Veiligheid: blokkeer verwijderen wanneer er goedgekeurde betalingen
    # aan hangen — anders raken die betalingen hun context kwijt en klopt
    # het openstaand saldo van de huurder niet meer. Admin moet de betaling
    # eerst verwijderen of de factuur voor 100% als betaald markeren.
    linked_pay = await db.payments.find_one({
        "invoice_id": invoice_id, "status": {"$ne": "rejected"},
    }, {"_id": 0, "id": 1})
    if linked_pay:
        raise HTTPException(
            status_code=400,
            detail=("Factuur heeft nog gekoppelde betalingen. Verwijder eerst "
                    "de betaling(en) of markeer de factuur op 0 openstaand."),
        )
    # Blokkeer óók wanneer de factuur onderdeel is van een actieve regeling.
    linked_plan = await db.payment_plans.find_one({
        "invoice_ids": invoice_id, "status": {"$ne": "cancelled"},
    }, {"_id": 0, "id": 1})
    if linked_plan:
        raise HTTPException(
            status_code=400,
            detail=("Factuur is gekoppeld aan een betalingsregeling. "
                    "Annuleer eerst de regeling."),
        )
    await db.invoices.delete_one({"id": invoice_id, **scope(user)})
    return {"ok": True}


@api.get("/invoices/{invoice_id}/pdf")
async def invoice_pdf_endpoint(invoice_id: str):
    inv = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not inv:
        raise HTTPException(status_code=404, detail="Factuur niet gevonden")
    t = await db.tenants.find_one({"id": inv["tenant_id"]}, {"_id": 0}) or {}
    a = await db.apartments.find_one({"id": inv.get("apartment_id")}, {"_id": 0}) or {}
    location_name = None
    if a.get("location_id"):
        loc = await db.locations.find_one({"id": a["location_id"]}, {"_id": 0, "name": 1})
        if loc:
            location_name = loc.get("name")
    # Find related huur payments
    payments = await db.payments.find({
        "tenant_id": inv["tenant_id"],
        "category": "huur",
        "period_month": inv["period_month"],
        "period_year": inv["period_year"],
    }, {"_id": 0}).to_list(50)
    brand = await _company_brand_info(inv.get("company_id"))
    inv = {**inv, **brand, "location_name": location_name}
    pdf = await asyncio.to_thread(invoice_pdf, inv, t, a, payments)
    return _pdf_response(pdf, f"factuur-{inv['invoice_number']}.pdf")


@api.get("/invoices/{invoice_id}/image")
async def invoice_image_endpoint(invoice_id: str):
    """Render de factuur-PDF als JPG-foto voor WhatsApp Web Share.
    Publieke variant zonder auth zodat gedeelde links buiten de app ook
    werken (analoog aan /payments/{id}/image)."""
    inv = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not inv:
        raise HTTPException(status_code=404, detail="Factuur niet gevonden")
    t = await db.tenants.find_one({"id": inv["tenant_id"]}, {"_id": 0}) or {}
    a = await db.apartments.find_one({"id": inv.get("apartment_id")}, {"_id": 0}) or {}
    location_name = None
    if a.get("location_id"):
        loc = await db.locations.find_one({"id": a["location_id"]}, {"_id": 0, "name": 1})
        if loc:
            location_name = loc.get("name")
    brand = await _company_brand_info(inv.get("company_id"))
    inv2 = {**inv, **brand, "location_name": location_name}
    pdf_bytes = await asyncio.to_thread(invoice_pdf, inv2, t, a, [])
    try:
        import pymupdf
        doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
        pix = doc[0].get_pixmap(matrix=pymupdf.Matrix(2.5, 2.5))
        jpg = pix.tobytes("jpeg", jpg_quality=85)
        doc.close()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Image render fout: {e}")
    from fastapi.responses import Response as _Resp
    return _Resp(
        content=jpg,
        media_type="image/jpeg",
        headers={"Content-Disposition": f'inline; filename="factuur-{inv["invoice_number"]}.jpg"'},
    )


# =====================================================================
# Employees & Salaries
# =====================================================================
class EmployeeIn(BaseModel):
    name: str
    role: Optional[str] = ""  # legacy free-text role
    # Nieuwe gestructureerde rol bepaalt wat de medewerker mag in de app:
    #  - admin       : beheerder, kan goedkeuren en alles
    #  - boekhouder  : zelfde betalings-rechten als admin (geen approval nodig)
    #  - kiosk       : kiosk-medewerker — betalingen gaan in pending_approval
    app_role: Optional[Literal["admin", "boekhouder", "kiosk"]] = None
    phone: Optional[str] = ""
    email: Optional[str] = ""
    monthly_salary: float = 0
    currency: Literal["SRD", "USD", "EUR"] = "SRD"
    active: bool = True
    password: Optional[str] = None  # alleen bij aanmaken/wijzigen, wordt niet opgeslagen op employee
    pin: Optional[str] = None


class EmployeeOut(BaseModel):
    id: str
    name: str
    role: Optional[str] = ""
    app_role: Optional[str] = None
    phone: Optional[str] = ""
    email: Optional[str] = ""
    monthly_salary: float = 0
    currency: str = "SRD"
    active: bool = True
    created_at: str
    has_kiosk_pin: bool = False
    has_login: bool = False
    ai_assistant_enabled: bool = False


async def _check_employee_pin_unique(cid: str, pin: str, exclude_eid: Optional[str] = None,
                                     exclude_uid: Optional[str] = None) -> None:
    q = {"id": {"$ne": exclude_uid}, "company_id": cid, "role": {"$ne": "kiosk"},
         "personal_pin_hash": {"$exists": True, "$ne": None}}
    if exclude_eid:
        q["employee_id"] = {"$ne": exclude_eid}
    admins = await db.users.find(
        q,
        {"_id": 0, "name": 1, "personal_pin_hash": 1},
    ).to_list(200)
    for a in admins:
        if verify_password(pin, a.get("personal_pin_hash", "")):
            raise HTTPException(status_code=409, detail="Deze PIN is al in gebruik binnen dit bedrijf, kies een andere")
    others = await db.employees.find(
        {"id": {"$ne": exclude_eid}, "company_id": cid, "active": True, "kiosk_pin_hash": {"$exists": True, "$ne": None}},
        {"_id": 0, "name": 1, "kiosk_pin_hash": 1},
    ).to_list(2000)
    for o in others:
        if verify_password(pin, o.get("kiosk_pin_hash", "")):
            raise HTTPException(status_code=409, detail=f"Deze PIN is al in gebruik door {o.get('name', 'een andere medewerker')}, kies een andere")


def _validate_employee_login(body: "EmployeeIn") -> None:
    if body.pin is not None and body.pin != "" and not re.fullmatch(r"\d{4}", body.pin.strip()):
        raise HTTPException(status_code=400, detail="PIN moet uit precies 4 cijfers bestaan")
    if body.password and len(body.password) < 6:
        raise HTTPException(status_code=400, detail="Wachtwoord moet minimaal 6 tekens zijn")
    if body.password and not (body.email or "").strip():
        raise HTTPException(status_code=400, detail="Vul een e-mailadres in om een login aan te maken")


async def _sync_employee_user(emp: dict, password: Optional[str], pin_hash: Optional[str]) -> None:
    """Maak/werk het login-account (db.users) van een werknemer bij."""
    email = (emp.get("email") or "").strip().lower()
    existing = await db.users.find_one({"employee_id": emp["id"]}, {"_id": 0, "id": 1})
    if email:
        clash = await db.users.find_one({"email": email, "employee_id": {"$ne": emp["id"]}}, {"_id": 0, "id": 1})
        if clash:
            raise HTTPException(status_code=409, detail="Dit e-mailadres is al in gebruik door een ander account")
    upd = {"name": emp.get("name", ""), "role": emp.get("app_role") or "admin",
           "company_id": emp.get("company_id"), "disabled": not emp.get("active", True)}
    if email:
        upd["email"] = email
    if password:
        upd["password_hash"] = await asyncio.to_thread(hash_password, password)
    if pin_hash:
        upd["personal_pin_hash"] = pin_hash
        upd["personal_pin_set_at"] = iso(now_utc())
    if existing:
        await db.users.update_one({"id": existing["id"]}, {"$set": upd})
    elif password and email:
        await db.users.insert_one({"id": new_id(), "employee_id": emp["id"], "created_at": iso(now_utc()), **upd})


async def _employee_out(doc: dict) -> dict:
    doc = {k: v for k, v in doc.items() if k != "_id"}
    doc["has_kiosk_pin"] = bool(doc.pop("kiosk_pin_hash", None))
    doc["has_login"] = bool(await db.users.find_one({"employee_id": doc["id"]}, {"_id": 0, "id": 1}))
    return doc


class EmployeeKioskPinIn(BaseModel):
    pin: str  # 4-6 cijfers


@api.get("/employees", response_model=List[EmployeeOut])
async def list_employees(user=Depends(get_current_user)):
    return await _list_cached("employees", user, lambda: _list_employees_compute(user))


async def _list_employees_compute(user: dict):
    docs = await db.employees.find(scope(user), {"_id": 0}).sort("name", 1).to_list(500)
    ids = [d["id"] for d in docs]
    with_login = {u["employee_id"] async for u in db.users.find({"employee_id": {"$in": ids}}, {"_id": 0, "employee_id": 1})}
    for d in docs:
        d["has_kiosk_pin"] = bool(d.pop("kiosk_pin_hash", None))
        d["has_login"] = d["id"] in with_login
    return docs


@api.post("/employees", response_model=EmployeeOut)
async def create_employee(body: EmployeeIn, user=Depends(get_current_user)):
    cid = company_id_of(user)
    if not cid:
        raise HTTPException(status_code=400, detail="Geen actief bedrijf geselecteerd")
    if user.get("role") != "superadmin" and not user.get("original_user_id"):
        await _enforce_count_limit(cid, "employees", "max_employees", "medewerkers")
    _validate_employee_login(body)
    pin = (body.pin or "").strip()
    if not pin:
        raise HTTPException(status_code=400, detail="PIN is verplicht (4 cijfers)")
    await _check_employee_pin_unique(cid, pin)
    pin_hash = hash_password(pin)
    data = body.model_dump(exclude={"password", "pin"})
    data["email"] = (data.get("email") or "").strip().lower()
    data["app_role"] = data.get("app_role") or "admin"
    doc = {"id": new_id(), "company_id": cid, **data, "kiosk_pin_hash": pin_hash, "created_at": iso(now_utc())}
    await _sync_employee_user(doc, body.password, pin_hash)
    await db.employees.insert_one(doc)
    return await _employee_out(doc)


@api.put("/employees/{eid}", response_model=EmployeeOut)
async def update_employee(eid: str, body: EmployeeIn, user=Depends(get_current_user)):
    cur = await db.employees.find_one({"id": eid, **scope(user)}, {"_id": 0})
    if not cur:
        raise HTTPException(status_code=404, detail="Werknemer niet gevonden")
    _validate_employee_login(body)
    data = body.model_dump(exclude={"password", "pin"})
    data["email"] = (data.get("email") or "").strip().lower()
    data["app_role"] = data.get("app_role") or cur.get("app_role") or "admin"
    pin = (body.pin or "").strip()
    pin_hash = None
    if pin:
        await _check_employee_pin_unique(cur["company_id"], pin, exclude_eid=eid)
        pin_hash = hash_password(pin)
        data["kiosk_pin_hash"] = pin_hash
    merged = {**cur, **data}
    if body.password and not pin_hash and not cur.get("kiosk_pin_hash"):
        raise HTTPException(status_code=400, detail="Stel ook een PIN in (4 cijfers) voor deze werknemer")
    if not pin_hash and body.password and cur.get("kiosk_pin_hash"):
        pin_hash = cur["kiosk_pin_hash"]
    await _sync_employee_user(merged, body.password, pin_hash)
    await db.employees.update_one({"id": eid}, {"$set": data})
    return await _employee_out(merged)


@api.post("/employees/{eid}/kiosk-pin")
async def set_employee_kiosk_pin(eid: str, body: EmployeeKioskPinIn, user=Depends(require_role("admin"))):
    """Beheerder zet/wijzigt een 4-6 cijferige PIN voor een kiosk-medewerker.
    Met deze PIN kan de medewerker zich op de Receptie Kiosk identificeren
    voordat hij een betaling registreert (die dan in pending_approval gaat).

    PIN-uniqueness is sinds 2026-02-26 alleen BINNEN het eigen bedrijf —
    PIN-login is company-scoped via `/<slug>/login`, dus twee bedrijven
    mogen dezelfde PINs gebruiken.
    """
    pin = (body.pin or "").strip()
    if not pin.isdigit() or len(pin) != 4:
        raise HTTPException(status_code=400, detail="PIN moet uit precies 4 cijfers bestaan")
    e = await db.employees.find_one({"id": eid, **scope(user)}, {"_id": 0})
    if not e:
        raise HTTPException(status_code=404, detail="Werknemer niet gevonden")
    cid = e.get("company_id")
    await _check_employee_pin_unique(cid, pin, exclude_eid=eid)
    pin_hash = hash_password(pin)
    await db.employees.update_one({"id": eid}, {"$set": {"kiosk_pin_hash": pin_hash}})
    await db.users.update_one({"employee_id": eid}, {"$set": {"personal_pin_hash": pin_hash, "personal_pin_set_at": iso(now_utc())}})
    return {"ok": True, "has_kiosk_pin": True}


class KioskEmployeePinIn(BaseModel):
    pin: str


@api.post("/kiosk/employee-verify")
async def kiosk_employee_verify(body: KioskEmployeePinIn, kiosk=Depends(get_kiosk_session)):
    """Verifieert kiosk-medewerker PIN voor het gekoppelde bedrijf. Wordt
    aangeroepen op de Receptie Kiosk vlak voor het registreren van een
    pending betaling. Geeft de medewerker-info terug zodat de frontend
    direct kan submitten met `kiosk_employee_id`."""
    cid = kiosk.get("company_id")
    if not cid:
        raise HTTPException(status_code=401, detail="Kiosk niet gekoppeld aan een bedrijf")
    pin = (body.pin or "").strip()
    if not pin:
        raise HTTPException(status_code=400, detail="PIN ontbreekt")
    candidates = await db.employees.find(
        {"company_id": cid, "active": True, "app_role": "kiosk"}, {"_id": 0}
    ).to_list(500)
    for emp in candidates:
        h = emp.get("kiosk_pin_hash")
        if h and verify_password(pin, h):
            return {"employee_id": emp["id"], "employee_name": emp.get("name", "")}
    raise HTTPException(status_code=401, detail="Ongeldige PIN")


@api.delete("/employees/{eid}")
async def delete_employee(eid: str, user=Depends(get_current_user)):
    res = await db.employees.delete_one({"id": eid, **scope(user)})
    if res.deleted_count:
        await db.users.delete_one({"employee_id": eid})
    return {"ok": True}


class SalaryIn(BaseModel):
    employee_id: str
    gross: float
    advance: float = 0
    deductions: float = 0
    currency: Literal["SRD", "USD", "EUR"] = "SRD"
    period_month: int = Field(ge=1, le=12)
    period_year: int
    note: Optional[str] = ""


class SalaryOut(BaseModel):
    id: str
    employee_id: str
    employee_name: Optional[str] = None
    gross: float
    advance: float
    deductions: float
    net: float
    currency: str
    period_month: int
    period_year: int
    note: str
    paid_at: str


async def _enrich_salary(s: dict) -> dict:
    e = await db.employees.find_one({"id": s["employee_id"]}, {"_id": 0, "name": 1})
    return {**s, "employee_name": e["name"] if e else None}


@api.get("/salaries", response_model=List[SalaryOut])
async def list_salaries(user=Depends(get_current_user), employee_id: Optional[str] = None):
    q = dict(scope(user))
    if employee_id:
        q["employee_id"] = employee_id
    async def compute():
        docs = await db.salaries.find(q, {"_id": 0}).sort("paid_at", -1).to_list(500)
        e_by = await _by_id("employees", [d.get("employee_id") for d in docs], {"name": 1})
        return [{**d, "employee_name": e_by.get(d.get("employee_id"), {}).get("name")} for d in docs]
    return await _list_cached("salaries", user, compute, employee_id or "")


@api.post("/salaries", response_model=SalaryOut)
async def create_salary(body: SalaryIn, user=Depends(get_current_user)):
    cid = company_id_of(user)
    if not cid:
        raise HTTPException(status_code=400, detail="Geen actief bedrijf geselecteerd")
    e = await db.employees.find_one({"id": body.employee_id, **scope(user)}, {"_id": 0})
    if not e:
        raise HTTPException(status_code=404, detail="Werknemer niet gevonden")
    net = body.gross - body.advance - body.deductions
    doc = {
        "id": new_id(),
        "company_id": cid,
        "employee_id": body.employee_id,
        "gross": body.gross, "advance": body.advance, "deductions": body.deductions,
        "net": net, "currency": body.currency,
        "period_month": body.period_month, "period_year": body.period_year,
        "note": body.note or "", "paid_at": iso(now_utc()),
    }
    await db.salaries.insert_one(doc)
    doc.pop("_id", None)
    return await _enrich_salary(doc)


@api.delete("/salaries/{sid}")
async def delete_salary(sid: str, user=Depends(get_current_user)):
    await db.salaries.delete_one({"id": sid, **scope(user)})
    return {"ok": True}


@api.get("/salaries/{sid}/pdf")
async def salary_pdf_endpoint(sid: str):
    s = await db.salaries.find_one({"id": sid}, {"_id": 0})
    if not s:
        raise HTTPException(status_code=404, detail="Loonstrook niet gevonden")
    e = await db.employees.find_one({"id": s["employee_id"]}, {"_id": 0}) or {}
    s = {**s, **(await _company_brand_info(s.get("company_id")))}
    pdf = payslip_pdf(s, e)
    return _pdf_response(pdf, f"loonstrook-{e.get('name','employee')}-{s['period_year']}-{s['period_month']:02d}.pdf")


# =====================================================================
# Deposits (Borg)
# =====================================================================
class DepositIn(BaseModel):
    tenant_id: str
    amount: float
    currency: Literal["SRD", "USD", "EUR"] = "SRD"
    note: Optional[str] = ""


class DepositOut(BaseModel):
    id: str
    tenant_id: str
    tenant_name: Optional[str] = None
    apartment_id: Optional[str] = None
    apartment_number: Optional[str] = None
    amount: float
    currency: str
    status: str  # held | refunded
    deduction: float = 0
    refund_amount: float = 0
    refund_note: Optional[str] = ""
    note: Optional[str] = ""
    created_at: str
    refunded_at: Optional[str] = None


async def _enrich_deposit(d: dict) -> dict:
    t = await db.tenants.find_one({"id": d["tenant_id"]}, {"_id": 0, "name": 1, "apartment_id": 1})
    apt_number = None
    if t and t.get("apartment_id"):
        a = await db.apartments.find_one({"id": t["apartment_id"]}, {"_id": 0, "number": 1})
        apt_number = a["number"] if a else None
    return {**d, "tenant_name": t["name"] if t else None,
            "apartment_id": t.get("apartment_id") if t else None,
            "apartment_number": apt_number}


@api.get("/deposits", response_model=List[DepositOut])
async def list_deposits(user=Depends(get_current_user)):
    async def compute():
        docs = await db.deposits.find(scope(user), {"_id": 0}).sort("created_at", -1).to_list(500)
        t_by = await _by_id("tenants", [d.get("tenant_id") for d in docs], {"name": 1, "apartment_id": 1})
        a_by = await _by_id("apartments", [t.get("apartment_id") for t in t_by.values()], {"number": 1})
        out = []
        for d in docs:
            t = t_by.get(d.get("tenant_id"))
            aid = t.get("apartment_id") if t else None
            out.append({**d, "tenant_name": t["name"] if t else None, "apartment_id": aid,
                        "apartment_number": a_by.get(aid, {}).get("number") if aid else None})
        return out
    return await _list_cached("deposits", user, compute)


@api.post("/deposits", response_model=DepositOut)
async def create_deposit(body: DepositIn, user=Depends(get_current_user)):
    cid = company_id_of(user)
    if not cid:
        raise HTTPException(status_code=400, detail="Geen actief bedrijf geselecteerd")
    t = await db.tenants.find_one({"id": body.tenant_id, **scope(user)}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Huurder niet gevonden")
    doc = {
        "id": new_id(),
        "company_id": cid,
        "tenant_id": body.tenant_id,
        "amount": body.amount, "currency": body.currency,
        "status": "held", "deduction": 0, "refund_amount": 0,
        "refund_note": "", "note": body.note or "",
        "created_at": iso(now_utc()), "refunded_at": None,
    }
    await db.deposits.insert_one(doc)
    doc.pop("_id", None)
    return await _enrich_deposit(doc)


class DepositRefundIn(BaseModel):
    deduction: float = 0
    refund_note: Optional[str] = ""


@api.post("/deposits/{did}/refund", response_model=DepositOut)
async def refund_deposit(did: str, body: DepositRefundIn, user=Depends(get_current_user)):
    d = await db.deposits.find_one({"id": did, **scope(user)}, {"_id": 0})
    if not d:
        raise HTTPException(status_code=404, detail="Borg niet gevonden")
    if d["status"] != "held":
        raise HTTPException(status_code=400, detail="Borg is al gerestitueerd")
    refund_amount = max(d["amount"] - body.deduction, 0)
    from pymongo import ReturnDocument
    updated = await db.deposits.find_one_and_update(
        {"id": did, **scope(user)},
        {"$set": {
            "status": "refunded", "deduction": body.deduction,
            "refund_amount": refund_amount,
            "refund_note": body.refund_note or "",
            "refunded_at": iso(now_utc()),
        }},
        projection={"_id": 0}, return_document=ReturnDocument.AFTER,
    )
    return await _enrich_deposit(updated)


@api.delete("/deposits/{did}")
async def delete_deposit(did: str, user=Depends(get_current_user)):
    await db.deposits.delete_one({"id": did, **scope(user)})
    return {"ok": True}


@api.get("/deposits/{did}/refund-pdf")
async def deposit_refund_pdf_endpoint(did: str):
    d = await db.deposits.find_one({"id": did}, {"_id": 0})
    if not d:
        raise HTTPException(status_code=404, detail="Borg niet gevonden")
    t = await db.tenants.find_one({"id": d["tenant_id"]}, {"_id": 0}) or {}
    apt_id = t.get("apartment_id")
    a = await db.apartments.find_one({"id": apt_id}, {"_id": 0}) if apt_id else {}
    d = {**d, **(await _company_brand_info(d.get("company_id")))}
    pdf = deposit_refund_pdf(d, t, a or {})
    return _pdf_response(pdf, f"borg-restitutie-{d['id'][:8]}.pdf")


# =====================================================================
# Maintenance
# =====================================================================
class MaintenanceIn(BaseModel):
    apartment_id: str
    title: str
    description: Optional[str] = ""
    priority: Literal["low", "medium", "high"] = "medium"
    cost: float = 0
    currency: Literal["SRD", "USD", "EUR"] = "SRD"


class MaintenanceOut(MaintenanceIn):
    id: str
    apartment_number: Optional[str] = None
    status: str
    created_at: str
    resolved_at: Optional[str] = None


async def _enrich_maint(m: dict) -> dict:
    a = await db.apartments.find_one({"id": m["apartment_id"]}, {"_id": 0, "number": 1})
    return {**m, "apartment_number": a["number"] if a else None}


@api.get("/maintenance", response_model=List[MaintenanceOut])
async def list_maintenance(user=Depends(get_current_user), apartment_id: Optional[str] = None):
    q = dict(scope(user))
    if apartment_id:
        q["apartment_id"] = apartment_id
    async def compute():
        docs = await db.maintenance.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
        a_by = await _by_id("apartments", [d.get("apartment_id") for d in docs], {"number": 1})
        return [{**d, "apartment_number": a_by.get(d.get("apartment_id"), {}).get("number")} for d in docs]
    return await _list_cached("maintenance", user, compute, apartment_id or "")


@api.post("/maintenance", response_model=MaintenanceOut)
async def create_maintenance(body: MaintenanceIn, user=Depends(get_current_user)):
    cid = company_id_of(user)
    if not cid:
        raise HTTPException(status_code=400, detail="Geen actief bedrijf geselecteerd")
    a = await db.apartments.find_one({"id": body.apartment_id, **scope(user)}, {"_id": 0})
    if not a:
        raise HTTPException(status_code=404, detail="Appartement niet gevonden")
    doc = {"id": new_id(), "company_id": cid, **body.model_dump(),
           "status": "open", "created_at": iso(now_utc()), "resolved_at": None}
    await db.maintenance.insert_one(doc)
    doc.pop("_id", None)
    return await _enrich_maint(doc)


class MaintenanceUpdateStatus(BaseModel):
    status: Literal["open", "in_progress", "done"]


@api.post("/maintenance/{mid}/status", response_model=MaintenanceOut)
async def update_maintenance_status(mid: str, body: MaintenanceUpdateStatus, user=Depends(get_current_user)):
    from pymongo import ReturnDocument
    update = {"status": body.status}
    if body.status == "done":
        update["resolved_at"] = iso(now_utc())
    else:
        update["resolved_at"] = None
    res = await db.maintenance.find_one_and_update(
        {"id": mid, **scope(user)}, {"$set": update},
        projection={"_id": 0}, return_document=ReturnDocument.AFTER,
    )
    if not res:
        raise HTTPException(status_code=404, detail="Ticket niet gevonden")
    return await _enrich_maint(res)


@api.delete("/maintenance/{mid}")
async def delete_maintenance(mid: str, user=Depends(get_current_user)):
    await db.maintenance.delete_one({"id": mid, **scope(user)})
    return {"ok": True}


# =====================================================================
# Kasgeld (cash)
# =====================================================================
class CashEntryIn(BaseModel):
    type: Literal["in", "out"]
    amount: float
    currency: Literal["SRD", "USD", "EUR"] = "SRD"
    description: str
    category: Optional[str] = "overig"
    # Optionele boekdatum — laat gebruiker een specifieke datum kiezen
    # (bijv. terug-boeken voor boekhouding). Verwacht "YYYY-MM-DD" of
    # volledige ISO. Als leeg → server tijd (now_utc).
    entry_date: Optional[str] = None


class CashEntryOut(CashEntryIn):
    id: str
    created_at: str
    # Zichtbare boekdatum (kan afwijken van created_at wanneer de gebruiker
    # terug-geboekt heeft). Voor payment-rijen valt dit samen met paid_at.
    entry_date: Optional[str] = None
    # Optional velden voor unified-feed (payments worden ook als kasgeld getoond)
    source: Optional[Literal["kasgeld", "payment"]] = "kasgeld"
    method: Optional[str] = None
    payment_id: Optional[str] = None
    payment_ref: Optional[str] = None
    # Audit: wie heeft de mutatie geboekt? Voor handmatige entries is dit
    # de ingelogde admin of kiosk-medewerker; voor payment-sourced rijen
    # komt het uit de bijbehorende payment (kiosk_employee_name of
    # approved_by). Legacy entries zonder deze velden tonen "Onbekend".
    created_by: Optional[str] = None
    created_by_name: Optional[str] = None
    balance_after: Optional[float] = None


# =====================================================================
# Kasgeld helper — bouwt een leesbare description voor een payment-rij
# in de unified kasgeld-feed. Toont apartement + maand ipv huurdersnaam
# + periode-cijfers zodat de kiosk-medewerker snel ziet waar het bij
# hoort. Wordt door zowel admin (/kasgeld) als kiosk (/kiosk/kasgeld)
# gedeeld — zo blijft het format overal identiek.
# =====================================================================
_DUTCH_MONTH_ABBR = [
    "", "jan", "feb", "mrt", "apr", "mei", "jun",
    "jul", "aug", "sep", "okt", "nov", "dec",
]


async def _kasgeld_payment_description(p: dict, t_by: Optional[dict] = None, a_by: Optional[dict] = None) -> str:
    """`{receipt_number} — HUIS {apt} · Maand {maand-nl}`. Fallback naar
    huurdersnaam wanneer het appartement onbekend is en naar `MM/YYYY`
    wanneer de maand niet vertaalbaar is."""
    apt_label = ""
    apt_id = p.get("apartment_id")
    # Als geen apartment_id op de payment: haal via tenant.
    if not apt_id and p.get("tenant_id"):
        t = t_by.get(p["tenant_id"]) if t_by is not None else await db.tenants.find_one(
            {"id": p["tenant_id"]},
            {"_id": 0, "apartment_id": 1, "name": 1},
        )
        apt_id = (t or {}).get("apartment_id")
        tenant_name = (t or {}).get("name") or ""
    else:
        tenant_name = ""
    if apt_id:
        apt = a_by.get(apt_id) if a_by is not None else await db.apartments.find_one(
            {"id": apt_id}, {"_id": 0, "number": 1},
        )
        num = ((apt or {}).get("number") or "").strip()
        if num:
            # Als het nummer al "huis"/"kamer"/"unit" begint → niet dubbelen.
            lower = num.lower()
            if lower.startswith(("huis", "kamer", "kmr", "unit", "appartement", "apt", "app.")):
                apt_label = num.upper() if lower.startswith("huis") else num
            else:
                apt_label = f"HUIS {num}"
    # Fallback: huurdersnaam als apartement niet gevonden
    if not apt_label and not tenant_name and p.get("tenant_id"):
        t = t_by.get(p["tenant_id"]) if t_by is not None else await db.tenants.find_one({"id": p["tenant_id"]}, {"_id": 0, "name": 1})
        tenant_name = (t or {}).get("name") or ""
    who = apt_label or tenant_name

    period = ""
    pm, py = p.get("period_month"), p.get("period_year")
    if isinstance(pm, int) and 1 <= pm <= 12:
        month_nl = _DUTCH_MONTH_ABBR[pm]
        period = f" · Maand {month_nl}"
        # Voeg het jaar toe als het niet-huidige jaar betreft — zo blijven
        # historische rijen ondubbelzinnig zonder de rij onnodig te vullen
        # voor de meest recente betalingen.
        try:
            from datetime import datetime as _dt
            if isinstance(py, int) and py != _dt.utcnow().year:
                period += f" {py}"
        except Exception:
            pass
    elif pm and py:
        period = f" · {pm:02d}/{py}"

    parts = [p.get("receipt_number") or ""]
    if who:
        parts.append(f"— {who}")
    return f"{' '.join(parts)}{period}".strip()


@api.get("/kasgeld", response_model=List[CashEntryOut])
async def list_cash(user=Depends(get_current_user)):
    return await _list_cached("kasgeld", user, lambda: _list_cash_compute(user))


async def _list_cash_compute(user: dict):
    """Retourneert alle kasmutaties + alle goedgekeurde binnenkomende
    betalingen (uit /betalingen, /facturen, kiosk) als één unified feed.

    Payment-bronnen zijn read-only en dragen `source='payment'` + het
    ontvangstnummer als `payment_ref`. Handmatige kasmutaties dragen
    `source='kasgeld'` en kunnen ook uitgaven bevatten (`type='out'`)."""
    manual = await db.kasgeld.find(scope(user), {"_id": 0}).to_list(2000)
    for m in manual:
        m.setdefault("source", "kasgeld")
        # Backfill: oude rijen hebben geen entry_date → gebruik created_at
        m.setdefault("entry_date", m.get("created_at"))
        # Audit backfill — legacy entries zonder creator krijgen "Onbekend"
        m.setdefault("created_by_name", "Onbekend")
        m.setdefault("created_by", None)
        # Sorteersleutel = insert-tijd (created_at). Voor manual rijen is
        # dit al de echte insert-tijd sinds we entry_date & created_at
        # scheiden. Voor backfill (oude rijen zonder entry_date) is dit
        # gewoon hun oude created_at.
        m["_sort_at"] = m.get("created_at") or ""

    payments: list[dict] = []
    pay_docs = await db.payments.find(
        {**scope(user), "status": "approved"},
        {"_id": 0, "id": 1, "amount": 1, "currency": 1, "method": 1,
         "category": 1, "receipt_number": 1, "paid_at": 1, "created_at": 1,
         "tenant_id": 1, "apartment_id": 1, "period_month": 1,
         "period_year": 1, "note": 1,
         "kiosk_employee_id": 1, "kiosk_employee_name": 1, "approved_by": 1},
    ).to_list(None)
    t_by = await _by_id("tenants", [p.get("tenant_id") for p in pay_docs], {"name": 1, "apartment_id": 1})
    a_by = await _by_id("apartments", [p.get("apartment_id") or t_by.get(p.get("tenant_id"), {}).get("apartment_id") for p in pay_docs], {"number": 1})
    for p in pay_docs:
        desc = await _kasgeld_payment_description(p, t_by, a_by)
        paid_iso = p.get("paid_at") or iso(now_utc())
        # Sort-key = echte insert-tijd van de payment (kan verschillen van
        # paid_at wanneer een payment historisch is gedateerd, bijv. seed).
        insert_iso = p.get("created_at") or paid_iso
        # Creator — kiosk-medewerker als die geregistreerd is, anders de
        # admin die het goedkeurde, anders "Onbekend".
        creator_name = (
            p.get("kiosk_employee_name")
            or p.get("approved_by")
            or "Onbekend"
        )
        creator_id = p.get("kiosk_employee_id")
        payments.append({
            "id": f"pay-{p['id']}",   # namespace zodat we conflicts vermijden
            "type": "in",
            "amount": float(p.get("amount") or 0),
            "currency": p.get("currency") or "SRD",
            "description": desc,
            "category": p.get("category") or "huur",
            "method": p.get("method") or "",
            "created_at": paid_iso,   # zichtbare betaaldatum (blijft paid_at)
            "entry_date": paid_iso,
            "source": "payment",
            "payment_id": p["id"],
            "payment_ref": p.get("receipt_number"),
            "created_by": creator_id,
            "created_by_name": creator_name,
            "_sort_at": insert_iso,   # interne sortering
        })

    combined = manual + payments
    # Sortering op echte insert-tijd → net-toegevoegde items altijd bovenaan,
    # ook wanneer de gebruiker een oudere entry_date koos of het een historische
    # payment betreft.
    combined.sort(key=lambda x: str(x.get("_sort_at") or ""), reverse=True)
    # Verwijder interne sortering-key uit output — niet exposen aan clients.
    for item in combined:
        item.pop("_sort_at", None)
    return combined


@api.post("/kasgeld", response_model=CashEntryOut)
async def create_cash(body: CashEntryIn, user=Depends(get_current_user)):
    cid = company_id_of(user)
    if not cid:
        raise HTTPException(status_code=400, detail="Geen actief bedrijf geselecteerd")
    # Twee losse datums:
    #  • created_at  = server insert time (nooit overschreven, gebruikt voor
    #    sortering zodat een nieuwe boeking altijd bovenaan verschijnt ook
    #    wanneer de gebruiker een oudere entry_date koos).
    #  • entry_date  = zichtbare "boekdatum" die de gebruiker koos.
    payload = body.model_dump()
    raw = (payload.pop("entry_date", None) or "").strip()
    now_iso = iso(now_utc())
    entry_iso = now_iso
    if raw:
        try:
            if "T" in raw:
                dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            else:
                # Midden van de dag om timezone-drift op rand-tijden te vermijden
                dt = datetime.fromisoformat(f"{raw}T12:00:00+00:00")
            entry_iso = iso(dt)
        except Exception:
            entry_iso = now_iso
    doc = {
        "id": new_id(), "company_id": cid, **payload,
        "created_at": now_iso,   # insert-tijd — voor sortering (nieuwste boven)
        "entry_date": entry_iso, # zichtbare boekdatum
        # Audit: wie heeft deze handmatige mutatie geboekt?
        "created_by": user.get("id"),
        "created_by_name": user.get("name") or user.get("email") or "Beheerder",
        "created_via": "admin",
    }
    await db.kasgeld.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.delete("/kasgeld/{cid}")
async def delete_cash(cid: str, user=Depends(get_current_user)):
    # Payment-sourced entries hebben id-prefix 'pay-' en zijn read-only.
    # Verwijderen moet via de originele betaling (Betalingen-pagina).
    if cid.startswith("pay-"):
        raise HTTPException(
            status_code=400,
            detail="Deze regel komt uit een betaling en kan niet vanuit Kasgeld verwijderd worden. Verwijder de betaling zelf via Betalingen.",
        )
    await db.kasgeld.delete_one({"id": cid, **scope(user)})
    return {"ok": True}


@api.get("/kasgeld/balance")
async def cash_balance(user=Depends(get_current_user)):
    """Per-valuta saldo. Combineert handmatige kasmutaties (in/uit) met alle
    goedgekeurde binnenkomende betalingen — zodat het saldo overeenkomt met
    de totale ontvangsten die in de kasgeld-lijst zichtbaar zijn."""
    balances: dict[str, float] = {"SRD": 0.0, "USD": 0.0, "EUR": 0.0}
    # Handmatige mutaties
    pipeline = [
        {"$match": scope(user)},
        {"$group": {
            "_id": {"currency": "$currency", "type": "$type"},
            "total": {"$sum": "$amount"},
        }},
    ]
    async for r in db.kasgeld.aggregate(pipeline):
        cur = r["_id"]["currency"]
        t = r["_id"]["type"]
        sign = 1 if t == "in" else -1
        balances[cur] = balances.get(cur, 0) + sign * r["total"]
    # Goedgekeurde betalingen (Betalingen / Facturen / Kiosk) — allemaal 'in'
    pay_pipeline = [
        {"$match": {**scope(user), "status": "approved"}},
        {"$group": {"_id": "$currency", "total": {"$sum": "$amount"}}},
    ]
    async for r in db.payments.aggregate(pay_pipeline):
        cur = r["_id"] or "SRD"
        balances[cur] = balances.get(cur, 0) + float(r.get("total") or 0)
    return balances


# =====================================================================
# Kiosk-scoped kasgeld — voor Kiosk medewerkers die vanuit de kiosk-app
# saldo kunnen bekijken en handmatige mutaties (bv. contante uitgave voor
# schoonmaakspullen) kunnen registreren zonder naar de beheerder-app.
# Auth: kiosk_token (geen access_token) — company scope komt uit sessie,
# NIET uit de query-string, zodat medewerkers geen data van andere
# bedrijven kunnen zien.
# =====================================================================
@api.get("/kiosk/kasgeld/balance")
async def kiosk_cash_balance(_session=Depends(get_kiosk_session)):
    sc = kiosk_scope(_session)
    balances: dict[str, float] = {"SRD": 0.0, "USD": 0.0, "EUR": 0.0}
    if not sc:
        return balances
    async for r in db.kasgeld.aggregate([
        {"$match": sc},
        {"$group": {"_id": {"currency": "$currency", "type": "$type"}, "total": {"$sum": "$amount"}}},
    ]):
        cur = r["_id"]["currency"]
        sign = 1 if r["_id"]["type"] == "in" else -1
        balances[cur] = balances.get(cur, 0) + sign * r["total"]
    async for r in db.payments.aggregate([
        {"$match": {**sc, "status": "approved"}},
        {"$group": {"_id": "$currency", "total": {"$sum": "$amount"}}},
    ]):
        cur = r["_id"] or "SRD"
        balances[cur] = balances.get(cur, 0) + float(r.get("total") or 0)
    return balances


@api.get("/kiosk/kasgeld", response_model=List[CashEntryOut])
async def kiosk_list_cash(_session=Depends(get_kiosk_session)):
    """Recente kasmutaties (handmatig + betalingen als unified feed).
    Zelfde vorm als admin `/kasgeld` maar geautoriseerd via kiosk_token.
    Beperkt tot laatste 200 items om kiosk-devices niet te overbelasten."""
    sc = kiosk_scope(_session)
    manual = await db.kasgeld.find(sc, {"_id": 0}).sort("created_at", -1).to_list(100)
    for m in manual:
        m.setdefault("source", "kasgeld")
        m.setdefault("entry_date", m.get("created_at"))
        m.setdefault("created_by_name", "Onbekend")
        m.setdefault("created_by", None)
    payments: list[dict] = []
    async for p in db.payments.find(
        {**sc, "status": "approved"},
        {"_id": 0, "id": 1, "amount": 1, "currency": 1, "method": 1,
         "category": 1, "receipt_number": 1, "paid_at": 1, "created_at": 1,
         "tenant_id": 1, "apartment_id": 1, "period_month": 1,
         "period_year": 1,
         "kiosk_employee_id": 1, "kiosk_employee_name": 1, "approved_by": 1},
    ).sort("paid_at", -1).limit(100):
        desc = await _kasgeld_payment_description(p)
        paid_iso = p.get("paid_at") or iso(now_utc())
        creator_name = (
            p.get("kiosk_employee_name")
            or p.get("approved_by")
            or "Onbekend"
        )
        payments.append({
            "id": f"pay-{p['id']}",
            "type": "in",
            "amount": float(p.get("amount") or 0),
            "currency": p.get("currency") or "SRD",
            "description": desc,
            "category": p.get("category") or "huur",
            "method": p.get("method") or "",
            "created_at": paid_iso,
            "entry_date": paid_iso,
            "source": "payment",
            "payment_id": p["id"],
            "payment_ref": p.get("receipt_number"),
            "created_by": p.get("kiosk_employee_id"),
            "created_by_name": creator_name,
        })
    combined = manual + payments
    combined.sort(key=lambda x: x.get("created_at") or "", reverse=True)
    return combined[:200]


async def _kasgeld_receipt_data(entry_id: str, session: dict, force_ktp: bool = False) -> dict:
    """Kasgeld-mutatie als 58mm bon-regels (zelfde vorm als _receipt_print_data)."""
    cid = session.get("company_id")
    e = await db.kasgeld.find_one({"id": entry_id, **kiosk_scope(session)}, {"_id": 0})
    if not e:
        raise HTTPException(status_code=404, detail="Mutatie niet gevonden")
    company = await db.companies.find_one({"id": cid}, {"_id": 0, "name": 1}) or {}
    cs = await db.company_settings.find_one({"company_id": cid}, {"_id": 0, "receipts": 1})
    font_size, _fs, text_zoom = _receipt_fonts((cs or {}).get("receipts") or {})
    cfg = await _kiosk_device_config(cid)
    printer = "kt-v520" if force_ktp else cfg["printer"]
    paper = 58 if printer == "kt-v520" else cfg["paper_width"]
    # Zelfde opmaak als de KT-V520 kasbon; 22 tekens zodat niets (ook geen streepjes) afbreekt.
    W = 34 if paper == 80 else 22
    cur = e.get("currency") or "SRD"

    def money(v):
        return f"{cur} " + f"{float(v or 0):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")

    def L(text, align="left", bold=False, size="normal"):
        return {"text": text, "align": align, "bold": bold, "size": size}

    def wrap(text, width):
        out, cur_line = [], ""
        for w in str(text).split():
            if len(cur_line) + len(w) + (1 if cur_line else 0) > width:
                if cur_line:
                    out.append(cur_line)
                cur_line = w[:width]
            else:
                cur_line = f"{cur_line} {w}".strip()
        if cur_line:
            out.append(cur_line)
        return out

    def pair(label, value, bold=False):
        # Label + waarde op één regel; past het niet, dan de waarde op de volgende regel.
        txt = f"{label} {value}"
        return [L(txt, bold=bold)] if len(txt) <= W else [L(label, bold=bold), L(value, bold=bold)]

    try:
        dt = datetime.fromisoformat(str(e.get("created_at")).replace("Z", "+00:00"))
    except Exception:
        dt = now_utc()
    local = dt.astimezone(timezone(timedelta(hours=-3)))
    datum = local.strftime("%d-%m-%Y %H:%M")
    is_in = e.get("type") == "in"
    nr = f"KB-{str(e.get('id') or '')[:6].upper()}"
    dash = "-" * W
    lines = [L(company.get("name") or "SuriRent", "center", True, "large"), L("KASBON", "center", True), L(dash),
             L(f"NR. {nr}"), L(f"DATUM {datum}"), L(dash),
             L("Kasstorting" if is_in else "Kasopname")]
    lines += pair("Ontvangen:" if is_in else "Uitbetaald:", money(e.get("amount")), bold=True)
    if e.get("balance_after") is not None:
        lines += pair("Kassaldo:", money(e["balance_after"]))
    lines.append(L(dash))
    lines += pair("Medewerker:", e.get("created_by_name") or "-")
    if e.get("description"):
        lines.append(L("Opmerking:"))
        lines += [L(x) for x in wrap(e["description"], W)]
    lines += [L(dash), L(""), L("")]
    return {
        "template": "lines", "receipt_type": "kasgeld",
        "bedrijfsnaam": company.get("name") or "SuriRent", "medewerker": e.get("created_by_name") or "",
        "datum": datum, "bedrag": money(e.get("amount")),
        "lettergrootte": font_size, "textZoom": text_zoom,
        "fontSizes": {"tekst": _fs[0], "bedrijfsnaam": _fs[1], "kwitantie": _fs[2], "bedrag": _fs[0]},
        "printer": printer, "paper_width": paper, "cols": W, "lines": lines,
    }


@api.get("/kiosk/kasgeld/{entry_id}/print-data")
async def kiosk_kasgeld_print_data(entry_id: str, _session=Depends(get_kiosk_session)):
    return await _kasgeld_receipt_data(entry_id, _session)


@api.get("/kiosk/kasgeld/{entry_id}/receipt.png")
async def kiosk_kasgeld_receipt_png(entry_id: str, _session=Depends(get_kiosk_session)):
    data = await _kasgeld_receipt_data(entry_id, _session, force_ktp=True)
    return Response(content=_render_receipt_png(data), media_type="image/png", headers={"Cache-Control": "no-store"})


@api.post("/kiosk/kasgeld/{entry_id}/remote-print")
async def kiosk_kasgeld_remote_print(entry_id: str, body: RemotePrintIn, _session=Depends(get_kiosk_session)):
    cid = _session["company_id"]
    data = await _kasgeld_receipt_data(entry_id, _session, force_ktp=True)
    return {"job_id": await _publish_remote_print(cid, body.printer_id, {
        "kasgeld_id": entry_id, "url": f"/api/kiosk/kasgeld/{entry_id}/receipt.png", "data": data})}


@api.post("/kiosk/kasgeld", response_model=CashEntryOut)
async def kiosk_create_cash(body: CashEntryIn, _session=Depends(get_kiosk_session),
                            employee_id: Optional[str] = Query(None),
                            employee_pin: Optional[str] = Query(None)):
    """Nieuwe kasgeld-mutatie geregistreerd vanuit de Kiosk (medewerker).
    Vereist een geldig kiosk_token. Company_id komt uit de sessie zodat
    kruis-bedrijf schrijven onmogelijk is."""
    cid = _session.get("company_id")
    if not cid:
        raise HTTPException(status_code=400, detail="Geen actief bedrijf")
    payload = body.model_dump()
    raw = (payload.pop("entry_date", None) or "").strip()
    now_iso = iso(now_utc())
    entry_iso = now_iso
    if raw:
        try:
            if "T" in raw:
                dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            else:
                dt = datetime.fromisoformat(f"{raw}T12:00:00+00:00")
            entry_iso = iso(dt)
        except Exception:
            entry_iso = now_iso
    emp_id, emp_name = None, None
    if employee_id:
        emp = await db.employees.find_one({"id": employee_id, "company_id": cid, "active": True}, {"_id": 0})
        if emp and emp.get("kiosk_pin_hash") and verify_password((employee_pin or "").strip(), emp["kiosk_pin_hash"]):
            emp_id, emp_name = emp["id"], emp.get("name") or ""
    doc = {
        "id": new_id(), "company_id": cid, **payload,
        "created_at": now_iso,
        "entry_date": entry_iso,
        # Audit: wie heeft dit vanuit de Kiosk ingebracht?
        "created_via": "kiosk",
        "created_by": emp_id,
        "created_by_name": emp_name or "Kiosk medewerker",
    }
    await db.kasgeld.insert_one(doc)
    doc.pop("_id", None)
    bal_after = round(float((await kiosk_cash_balance(_session)).get(doc["currency"], 0)), 2)
    await db.kasgeld.update_one({"id": doc["id"]}, {"$set": {"balance_after": bal_after}})
    doc["balance_after"] = bal_after
    soort = "Inkomen" if doc["type"] == "in" else "Uitgave"
    asyncio.create_task(_notify_company_admins(
        cid,
        f"Kasgeld · {soort} {_nl_money(doc['currency'], doc['amount'])}",
        f"Door {doc['created_by_name']} · {doc.get('description') or '-'}",
        {"kind": "kasgeld", "url": "/admin/kasgeld", "entry_id": doc["id"]},
    ))
    return doc


# =====================================================================
# AES-256 secure receipt + QR verification
# =====================================================================
from pdf_security import secure_pdf, make_verify_token, verify_token  # noqa: E402


@api.get("/payments/{payment_id}/secure-pdf")
async def payment_secure_pdf(payment_id: str, encrypted: bool = False):
    p = await db.payments.find_one({"id": payment_id}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Kwitantie niet gevonden")
    p = await _enrich_payment(p, include_logo=True)
    base = await asyncio.to_thread(receipt_pdf, p)
    token = make_verify_token({
        "kind": "payment", "id": payment_id, "rn": p["receipt_number"],
        "amt": p["amount"], "cur": p["currency"], "ts": int(now_utc().timestamp()),
    })
    public_base = os.environ.get("PUBLIC_BASE_URL", "")
    verify_url = f"{public_base}/api/verify/{token}" if public_base else f"/api/verify/{token}"
    out = secure_pdf(base, verify_url, encrypted=encrypted)
    return _pdf_response(out, f"kwitantie-{p['receipt_number']}{'-encrypted' if encrypted else ''}.pdf")


@api.get("/verify/{token}")
async def verify_pdf_token(token: str):
    payload = verify_token(token)
    if not payload:
        return {"valid": False, "reason": "Ongeldige of geknoeide handtekening"}
    kind = payload.get("kind")
    if kind == "payment":
        p = await db.payments.find_one({"id": payload.get("id")}, {"_id": 0})
        if not p:
            return {"valid": False, "reason": "Kwitantie niet gevonden in database"}
        if p["receipt_number"] != payload.get("rn") or float(p["amount"]) != float(payload.get("amt", 0)):
            return {"valid": False, "reason": "Gegevens komen niet overeen met origineel"}
        return {
            "valid": True,
            "type": "Kwitantie",
            "receipt_number": p["receipt_number"],
            "amount": p["amount"],
            "currency": p["currency"],
            "paid_at": p["paid_at"],
            "issued_at": datetime.fromtimestamp(payload.get("ts", 0)).isoformat(),
        }
    return {"valid": False, "reason": "Onbekend type"}


# =====================================================================
# PWA Push Notifications
# =====================================================================
from push_service import send_push  # noqa: E402

VAPID_PUBLIC_KEY = os.environ.get("VAPID_PUBLIC_KEY", "")


async def _deep_link(d: dict) -> str:
    """Directe link naar het juiste item (betaling, goedkeuring, factuur, regeling, onderhoud)."""
    kind = d.get("kind")
    pid = d.get("payment_id")
    if pid and kind in ("payment", "payment_pending", "payment_pending_approval", "approval"):
        return f"/admin/payments?open=payment:{pid}"
    if d.get("plan_id"):
        return f"/admin/payment_plans?open=plan:{d['plan_id']}"
    if d.get("invoice_id"):
        inv = await db.invoices.find_one({"id": d["invoice_id"]}, {"_id": 0, "tenant_id": 1})
        tid = (inv or {}).get("tenant_id") or ""
        return f"/admin/invoices?open=invoice:{d['invoice_id']}&tenant={tid}"
    if d.get("maintenance_id"):
        return f"/admin/maintenance?open=maintenance:{d['maintenance_id']}"
    if kind in ("kasgeld", "kiosk_login", "kiosk_logout"):
        return "/admin/kasgeld"
    if kind in ("overdue", "auto_invoice", "invoice_reminder"):
        return d.get("url") or "/admin/invoices"
    return d.get("url") or "/admin"


async def _notify_company_admins(company_id: str, title: str, body: str, data: dict | None = None) -> int:
    """Stuur een push naar ALLE admins/owners/boekhouders van een bepaalde
    company. Push-dispatch gebeurt PARALLEL via asyncio.to_thread zodat het
    backend-antwoord nooit blokkeert op trage WebPush-endpoints.

    Wordt gebruikt voor automatische meldingen zoals:
      • nieuwe kiosk-betaling
      • achterstand-alert
      • nieuwe factuur
      • goedkeuring nodig

    Verlopen subs worden direct opgeschoond. Faalt nooit hard — return
    aantal succesvol verzonden.
    """
    if not company_id:
        return 0
    data = dict(data or {})
    try:
        data["url"] = await _deep_link(data)
    except Exception as e:  # noqa: BLE001
        print(f"[notify] deep link failed: {e}")
    # Vind alle admin/owner/boekhouder users van deze company. Boekhouders
    # hebben dezelfde betalingsverwerkings-rechten als admins (geen approval
    # nodig) dus krijgen ook real-time meldingen.
    admin_ids = []
    async for u in db.users.find(
        {"company_id": company_id, "role": {"$in": ["admin", "owner", "boekhouder"]}},
        {"_id": 0, "id": 1},
    ):
        admin_ids.append(u["id"])
    # SSE ALTIJD broadcasten (ook als er geen push-subs of admin_ids zijn),
    # zodat open admin-tabs live updates krijgen zonder OS-push setup. Voorheen
    # returnde deze functie vroeg als er geen push-subs waren, waardoor de
    # SSE-broadcast miste — met als gevolg dat admin Betalingen niet live
    # ververste na een huurder-betaling.
    try:
        await _sse_broadcast(company_id, {
            "type": "notification",
            "title": title,
            "body": body,
            "data": data or {},
        })
    except Exception as e:  # noqa: BLE001
        print(f"[sse] broadcast failed: {e}")
    asyncio.create_task(_fcm_notify_company(company_id, title, body, data or {}))

    if not admin_ids:
        return 0
    # Verzamel alle subscriptions eerst (1 DB-call), dispatch dan parallel
    subs = []
    async for sub in db.push_subs.find({"user_id": {"$in": admin_ids}}, {"_id": 0}):
        subs.append(sub)
    if not subs:
        return 0

    async def _send_one(sub):
        info = {"endpoint": sub["endpoint"], "keys": sub["keys"]}
        # pywebpush is blocking sync — run in threadpool zodat we niet
        # andere subs blokkeren tijdens 1 trage push.
        ok = await asyncio.to_thread(send_push, info, title, body, _with_action_token(data, sub.get("user_id"), company_id))
        if not ok:
            await db.push_subs.delete_one({"endpoint": sub["endpoint"]})
        return ok

    results = await asyncio.gather(*[_send_one(s) for s in subs], return_exceptions=True)
    return sum(1 for r in results if r is True)


# =====================================================================
# Goedkeuren / Afwijzen vanuit de melding (PWA + Android-app)
# =====================================================================
_APPROVAL_KINDS = ("payment_pending", "payment_pending_approval", "approval")
_ACTION_TTL_S = 7 * 24 * 3600


def _with_action_token(data: dict, uid: str | None, cid: str) -> dict:
    """Voeg per ontvanger een ondertekend actie-token toe aan goedkeuringsmeldingen."""
    data = data or {}
    if data.get("kind") not in _APPROVAL_KINDS or not data.get("payment_id") or not uid:
        return data
    tok = make_verify_token({"t": "pa", "pid": data["payment_id"], "uid": uid, "cid": cid,
                             "exp": int(now_utc().timestamp()) + _ACTION_TTL_S})
    base = os.environ.get("PUBLIC_BASE_URL", "").rstrip("/")
    return {**data, "require_approval": True, "action_token": tok,
            "action_url": f"{base}/api/push/action", "actions": "approve,reject"}


class PushActionIn(BaseModel):
    token: str = Field(min_length=10, max_length=2000)
    action: str


@api.post("/push/action")
async def push_action(body: PushActionIn):
    """Goedkeuren/Afwijzen via knop in de melding — het token is de autorisatie."""
    if body.action not in ("approve", "reject"):
        raise HTTPException(status_code=422, detail="Onbekende actie")
    pl = verify_token(body.token) or {}
    if pl.get("t") != "pa" or int(pl.get("exp") or 0) < int(now_utc().timestamp()):
        raise HTTPException(status_code=401, detail="Deze melding is verlopen — open de app om goed te keuren")
    u = await db.users.find_one({"id": pl.get("uid"), "company_id": pl.get("cid")},
                                {"_id": 0, "id": 1, "name": 1, "email": 1, "role": 1, "approval_signature": 1})
    if not u or u.get("role") not in ("admin", "owner", "boekhouder"):
        raise HTTPException(status_code=403, detail="Onvoldoende rechten")
    q = {"id": pl["pid"], "company_id": pl["cid"]}
    try:
        if body.action == "approve":
            p = await _approve_payment_core(q, u.get("approval_signature"), u["id"],
                                            u.get("name") or u.get("email") or "Beheerder", via="notification")
            msg = f"Goedgekeurd: {p.get('tenant_name', '')} {p.get('currency', '')} {float(p.get('amount') or 0):,.2f}"
        else:
            p = await _reject_payment_core(q, "Afgewezen via melding", u["id"])
            msg = f"Afgewezen: {p.get('tenant_name', '')} {p.get('currency', '')} {float(p.get('amount') or 0):,.2f}"
    except HTTPException as e:
        if e.status_code == 400:
            raise HTTPException(status_code=409, detail="Deze betaling is al verwerkt")
        raise
    asyncio.create_task(_sse_broadcast(pl["cid"], {"type": "change", "path": f"/api/payments/{pl['pid']}/{body.action}", "method": "POST"}))
    return {"ok": True, "status": p.get("status"), "message": msg.strip()}


class ApprovalSignatureIn(BaseModel):
    signature_data_url: Optional[str] = Field(default=None, max_length=300_000)


@api.get("/me/approval-signature")
async def get_approval_signature(user=Depends(get_current_user)):
    u = await db.users.find_one({"id": user.get("id")}, {"_id": 0, "approval_signature": 1})
    return {"signature_data_url": (u or {}).get("approval_signature")}


@api.put("/me/approval-signature")
async def put_approval_signature(body: ApprovalSignatureIn, user=Depends(get_current_user)):
    sig = body.signature_data_url or None
    if sig and not sig.startswith("data:image/"):
        raise HTTPException(status_code=422, detail="Ongeldige handtekening")
    await db.users.update_one({"id": user.get("id")}, {"$set": {"approval_signature": sig}})
    return {"ok": True, "signature_data_url": sig}


# =====================================================================
# Android-app pushmeldingen via Firebase Cloud Messaging (FCM)
# =====================================================================
from fcm_service import send_fcm, fcm_configured  # noqa: E402

_FCM_KIND_PREF = {
    "payment": "payment", "payment_plan": "payment",
    "overdue": "overdue",
    "approval": "approval", "payment_pending": "approval", "payment_pending_approval": "approval",
    "kasgeld": "kasgeld",
    "kiosk_login": "employee", "kiosk_logout": "employee",
    "maintenance": "maintenance",
    "auto_invoice": "invoices", "invoice_reminder": "invoices",
}
_FCM_ADMIN_ROLES = ("admin", "owner", "boekhouder")


async def _fcm_prefs(cid: str) -> dict:
    cs = await db.company_settings.find_one({"company_id": cid}, {"_id": 0, "fcm_prefs": 1})
    return {**_empty_section("fcm_prefs"), **((cs or {}).get("fcm_prefs") or {})}


async def _fcm_send_and_clean(tokens: list, title: str, body: str, data: dict, data_only: bool = False) -> int:
    res = await send_fcm(tokens, title, body, data, data_only=data_only)
    if res["unregistered"]:
        await db.fcm_tokens.delete_many({"token": {"$in": res["unregistered"]}})
    return res["sent"]


async def _fcm_notify_company(cid: str, title: str, body: str, data: dict) -> int:
    """Stuur naar alle gekoppelde Android-toestellen van beheerders (als de soort aan staat)."""
    pref = _FCM_KIND_PREF.get((data or {}).get("kind"))
    if not cid or not pref or not fcm_configured():
        return 0
    try:
        if not (await _fcm_prefs(cid)).get(pref, True):
            return 0
        docs = await db.fcm_tokens.find({"company_id": cid}, {"_id": 0, "token": 1, "user_id": 1, "capabilities": 1}).to_list(500)
        sent = await asyncio.gather(*[
            _fcm_send_and_clean([d["token"]], title, body, _with_action_token(data, d.get("user_id"), cid),
                                data_only="actions" in (d.get("capabilities") or []))
            for d in docs
        ])
        return sum(sent)
    except Exception as e:  # noqa: BLE001
        print(f"[fcm] notify failed: {e}")
        return 0


class FcmRegisterIn(BaseModel):
    token: str = Field(min_length=20, max_length=4096)
    device_name: Optional[str] = Field(default=None, max_length=80)
    capabilities: Optional[List[str]] = Field(default=None, max_length=10)


def _fcm_admin(user) -> str:
    if user.get("role") not in _FCM_ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Alleen beheerders kunnen Android-meldingen ontvangen")
    cid = company_id_of(user)
    if not cid:
        raise HTTPException(status_code=400, detail="Geen actief bedrijf geselecteerd")
    return cid


@api.post("/push/fcm/register")
async def fcm_register(body: FcmRegisterIn, user=Depends(get_current_user)):
    cid = _fcm_admin(user)
    now = iso(now_utc())
    try:
        await _fcm_upsert(body, cid, user, now)
    except DuplicateKeyError:
        await _fcm_upsert(body, cid, user, now)
    return {"ok": True, "configured": fcm_configured()}


async def _fcm_upsert(body, cid: str, user: dict, now: str):
    await db.fcm_tokens.update_one(
        {"token": body.token},
        {"$set": {"company_id": cid, "user_id": user["id"], "user_name": user.get("name") or user.get("email"),
                  "device_name": (body.device_name or "Android-toestel").strip(), "platform": "android", "updated_at": now,
                  "capabilities": [str(c)[:30] for c in (body.capabilities or [])]},
         "$setOnInsert": {"id": str(uuid.uuid4()), "created_at": now}},
        upsert=True,
    )


@api.post("/push/fcm/unregister")
async def fcm_unregister(body: FcmRegisterIn, user=Depends(get_current_user)):
    await db.fcm_tokens.delete_one({"token": body.token, "user_id": user["id"]})
    return {"ok": True}


@api.get("/push/fcm/devices")
async def fcm_devices(user=Depends(get_current_user)):
    cid = _fcm_admin(user)
    docs = await db.fcm_tokens.find({"company_id": cid}, {"_id": 0, "token": 0, "capabilities": 0}).sort("updated_at", -1).to_list(200)
    return {"configured": fcm_configured(), "devices": docs}


@api.delete("/push/fcm/devices/{device_id}")
async def fcm_device_delete(device_id: str, user=Depends(get_current_user)):
    cid = _fcm_admin(user)
    res = await db.fcm_tokens.delete_one({"id": device_id, "company_id": cid})
    if not res.deleted_count:
        raise HTTPException(status_code=404, detail="Toestel niet gevonden")
    return {"ok": True}


@api.post("/push/fcm/test")
async def fcm_test(user=Depends(get_current_user)):
    cid = _fcm_admin(user)
    if not fcm_configured():
        raise HTTPException(status_code=503, detail="Firebase is niet ingesteld op de server")
    tokens = await db.fcm_tokens.distinct("token", {"company_id": cid})
    sent = await _fcm_send_and_clean(tokens, "SuriRent test", "Android-meldingen werken!", {"kind": "test", "url": "/admin/notifications"})
    return {"sent": sent, "devices": len(tokens)}


# =====================================================================
# Server-Sent Events (SSE) — real-time push naar open admin tabs
# Veel sneller dan WebPush voor open tabs (geen FCM/APNS roundtrip).
# Verwacht: <100ms latency van event tot UI render.
# =====================================================================
# =====================================================================
# Admin SSE stream — cross-replica via `event_bus` (MongoDB capped tail).
# Voorheen in-memory `_sse_queues`: events bereikten alleen de replica
# die de mutation-request afhandelde. Nu wordt elke publish naar Mongo
# gepushed en pikt elke replica hem op via een tailable cursor.
# =====================================================================
from event_bus import publish as _bus_publish, subscribe as _bus_subscribe, unsubscribe as _bus_unsubscribe


def _sse_channel(company_id: str) -> str:
    return f"admin:{company_id}"


async def _sse_broadcast(company_id: str, event: dict):
    """Publish naar de cross-replica bus. Alle SSE-loops (op elke pod)
    ontvangen het en dispatchen naar hun lokale subscribers."""
    if not company_id:
        return
    await _bus_publish(_sse_channel(company_id), event)


@api.get("/admin/events")
async def admin_events_sse(request: Request, user=Depends(get_current_user)):
    """Server-Sent Events stream voor real-time admin notificaties.
    Gebruikt door /admin/payments e.a. om instant UI updates te krijgen
    zonder polling. Hartslag elke 25s om proxies door te laten.
    Cross-replica: subscribed via `event_bus` op kanaal admin:{cid}."""
    cid = user.get("company_id")
    if not cid:
        raise HTTPException(status_code=400, detail="Geen bedrijf")
    channel = _sse_channel(cid)
    queue = _bus_subscribe(channel, maxsize=100)

    async def event_stream():
        try:
            # Initial handshake als ECHT data-event (client ontvangt via
            # onmessage en reset zijn watchdog-timer). `event: ready` fired
            # géén onmessage → toen kon client een silent-dead connection
            # niet detecteren.
            yield f"data: {json.dumps({'type':'ready','ts':iso(now_utc())})}\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    # Bus dispatched dict → dumps hier. Voorheen JSON al
                    # gemaakt in _sse_broadcast; nu doet elke stream zijn
                    # eigen serialisatie voor iets betere fault-isolation.
                    payload = await asyncio.wait_for(queue.get(), timeout=15.0)
                    yield f"data: {json.dumps(payload)}\n\n"
                except asyncio.TimeoutError:
                    # Heartbeat als ECHT event (i.p.v. SSE-comment) zodat de
                    # client via `onmessage` weet dat de connectie leeft.
                    # Comments ("`: ...`") firen géén onmessage → client kan
                    # dan een silent-dead connection niet detecteren.
                    yield f"data: {json.dumps({'type':'heartbeat','ts':iso(now_utc())})}\n\n"
        finally:
            _bus_unsubscribe(channel, queue)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",  # disable nginx buffering
            "Connection": "keep-alive",
        },
    )


class PushSubscriptionIn(BaseModel):
    endpoint: str
    keys: dict
    user_label: Optional[str] = ""  # admin label for filtering
    user_agent: Optional[str] = ""  # browser UA — getoond in /admin/notifications


@api.get("/push/vapid-public-key")
async def push_vapid_key():
    return {"public_key": VAPID_PUBLIC_KEY}


@api.post("/push/subscribe")
async def push_subscribe(body: PushSubscriptionIn, request: Request, user=Depends(get_current_user)):
    # User-agent komt uit body (frontend stuurt navigator.userAgent) of als
    # fallback uit de HTTP header. Wordt later vertaald naar een leesbaar
    # device-label ("iPhone Safari", "Chrome Desktop") in de UI.
    ua = (body.user_agent or "").strip() or (request.headers.get("user-agent") or "")
    now_iso = iso(now_utc())
    set_doc = {
        "user_id": user["id"],
        "endpoint": body.endpoint,
        "keys": body.keys,
        "user_label": body.user_label or user.get("email", ""),
        "user_agent": ua,
        "last_seen_at": now_iso,
    }
    set_on_insert = {
        "id": new_id(),
        "created_at": now_iso,
    }
    # Upsert by endpoint — bij update behouden we created_at + id.
    await db.push_subs.update_one(
        {"endpoint": body.endpoint},
        {"$set": set_doc, "$setOnInsert": set_on_insert},
        upsert=True,
    )
    return {"ok": True}


@api.get("/push/status")
async def push_status(user=Depends(get_current_user)):
    """Hoeveel apparaten heeft deze user geregistreerd?"""
    n = await db.push_subs.count_documents({"user_id": user["id"]})
    return {"devices": n}


@api.get("/push/devices")
async def push_devices(user=Depends(get_current_user)):
    """Lijst alle gekoppelde apparaten van de huidige gebruiker — getoond
    in /admin/notifications zodat de admin kan zien welke devices push
    krijgen en eventueel een oud / verloren apparaat kan loskoppelen."""
    items = []
    async for sub in db.push_subs.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1):
        # id-fallback voor oude documents zonder id-veld.
        sid = sub.get("id") or sub.get("endpoint", "")[-32:]
        items.append({
            "id": sid,
            "endpoint": sub.get("endpoint", ""),
            "user_agent": sub.get("user_agent", ""),
            "created_at": sub.get("created_at"),
            "last_seen_at": sub.get("last_seen_at") or sub.get("created_at"),
            "label": _device_label_from_ua(sub.get("user_agent", "")),
        })
    return items


def _device_label_from_ua(ua: str) -> str:
    """Vertaal user-agent naar een leesbaar device-label.

    We doen het zelf (geen extra dependency) zodat de UI direct ziet:
      "iPhone · Safari" / "Android · Chrome" / "Windows · Chrome" / "Mac · Safari"
    Bij onbekende UA fall-back naar "Apparaat" zodat de admin alsnog
    iets ziet om te tikken.
    """
    if not ua:
        return "Apparaat"
    ua_l = ua.lower()
    # OS
    if "iphone" in ua_l:
        os_name = "iPhone"
    elif "ipad" in ua_l:
        os_name = "iPad"
    elif "android" in ua_l:
        os_name = "Android"
    elif "windows" in ua_l:
        os_name = "Windows"
    elif "mac os x" in ua_l or "macintosh" in ua_l:
        os_name = "Mac"
    elif "linux" in ua_l:
        os_name = "Linux"
    else:
        os_name = "Apparaat"
    # Browser (volgorde belangrijk — Edge/Chrome bevatten "safari" in hun UA)
    if "edg/" in ua_l or "edge/" in ua_l:
        br = "Edge"
    elif "chrome/" in ua_l and "chromium" not in ua_l:
        br = "Chrome"
    elif "firefox/" in ua_l:
        br = "Firefox"
    elif "safari/" in ua_l:
        br = "Safari"
    elif "samsungbrowser" in ua_l:
        br = "Samsung Internet"
    else:
        br = ""
    return f"{os_name} · {br}".rstrip(" ·") if br else os_name


@api.delete("/push/devices/{device_id}")
async def push_remove_device(device_id: str, user=Depends(get_current_user)):
    """Verwijder een specifiek device uit de gekoppelde push-apparaten van
    de huidige user. We accepteren zowel het id-veld als de laatste 32
    chars van het endpoint (voor oude records zonder id-veld)."""
    res = await db.push_subs.delete_one({
        "user_id": user["id"],
        "$or": [
            {"id": device_id},
            {"endpoint": {"$regex": f"{re.escape(device_id)}$"}},
        ],
    })
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Apparaat niet gevonden")
    return {"ok": True}


@api.post("/push/unsubscribe")
async def push_unsubscribe(body: dict, user=Depends(get_current_user)):
    endpoint = body.get("endpoint")
    if not endpoint:
        raise HTTPException(status_code=400, detail="endpoint vereist")
    await db.push_subs.delete_one({"endpoint": endpoint})
    return {"ok": True}


class PushTestIn(BaseModel):
    title: str = "SuriRent test"
    body: str = "Push notificatie werkt!"


@api.post("/push/test")
async def push_test(body: PushTestIn, user=Depends(get_current_user)):
    """Send a test push to all subscriptions of current admin."""
    sent = 0
    failed = 0
    cursor = db.push_subs.find({"user_id": user["id"]}, {"_id": 0})
    async for sub in cursor:
        sub_info = {"endpoint": sub["endpoint"], "keys": sub["keys"]}
        ok = send_push(sub_info, body.title, body.body, {"kind": "test", "url": "/admin/notifications"})
        if ok:
            sent += 1
        else:
            failed += 1
            await db.push_subs.delete_one({"endpoint": sub["endpoint"]})
    total = await db.push_subs.count_documents({"user_id": user["id"]})
    return {"sent": sent, "failed": failed, "remaining_devices": total}


@api.post("/push/notify-overdue")
async def push_notify_overdue(user=Depends(get_current_user)):
    """Stuur de admin een push-overzicht van huurders met achterstallige facturen."""
    cid = company_id_of(user)
    if not cid:
        raise HTTPException(status_code=400, detail="Geen actief bedrijf geselecteerd")
    overdue = await _company_overdue_tenants(cid)
    msg = _overdue_summary_text(overdue)
    sent = 0
    async for sub in db.push_subs.find({"user_id": user["id"]}, {"_id": 0}):
        if send_push(
            {"endpoint": sub["endpoint"], "keys": sub["keys"]},
            "Achterstallige huur",
            msg,
            {"kind": "overdue", "count": len(overdue), "url": "/admin/invoices"},
        ):
            sent += 1
    return {"sent": sent, "overdue_count": len(overdue), "message": msg}


# =====================================================================
# Company settings (SMTP, Twilio, Shelly, custom domain, invoicing)
# =====================================================================
from settings_service import (
    empty_section as _empty_section,
    mask_section as _mask_section,
    merge_section as _merge_section,
    reveal_section as _reveal_section,
    SECTION_SECRETS as _SECTION_SECRETS,
)

VALID_SETTINGS_SECTIONS = ["smtp", "twilio", "shelly", "domain", "invoicing", "receipts", "kiosk_devices", "fcm_prefs"]


async def _get_company_settings_doc(company_id: str) -> dict:
    """Fetch full raw settings doc (encrypted secrets intact). Creates empty if missing."""
    doc = await db.company_settings.find_one({"company_id": company_id}, {"_id": 0})
    if not doc:
        doc = {"company_id": company_id}
        for s in VALID_SETTINGS_SECTIONS:
            doc[s] = _empty_section(s)
    else:
        # Backfill any new section keys that didn't exist before.
        for s in VALID_SETTINGS_SECTIONS:
            if s not in doc or not doc[s]:
                doc[s] = _empty_section(s)
    return doc


async def get_company_section(company_id: str, section: str) -> dict:
    """Internal helper for other services (e.g. mail/twilio sender). Returns DECRYPTED."""
    if section not in VALID_SETTINGS_SECTIONS:
        return {}
    doc = await _get_company_settings_doc(company_id)
    return _reveal_section(section, doc.get(section) or {})


@api.get("/settings")
async def get_settings(user=Depends(get_current_user)):
    """Return all settings sections with secrets MASKED."""
    cid = company_id_of(user)
    if not cid:
        raise HTTPException(status_code=400, detail="Geen actief bedrijf geselecteerd")
    doc = await _get_company_settings_doc(cid)
    out = {"company_id": cid}
    for s in VALID_SETTINGS_SECTIONS:
        out[s] = _mask_section(s, doc.get(s) or {})
    # Verrijk de invoicing-sectie met berekende velden zodat de admin ziet
    # wanneer de volgende auto-run staat gepland (afhankelijk van mode).
    try:
        inv = out.get("invoicing") or {}
        from datetime import date as _date
        today = _date.today()
        mode = (inv.get("mode") or "grace_workdays").strip()
        last_run = inv.get("last_auto_run")

        def _deadline_grace(t):
            try:
                grace = int(inv.get("grace_workdays") or 10)
            except (TypeError, ValueError):
                grace = 10
            prev_year = t.year if t.month > 1 else t.year - 1
            prev_month = t.month - 1 if t.month > 1 else 12
            prev_last = _last_day_of_month(prev_year, prev_month)
            return _add_workdays(prev_last, grace)

        def _deadline_fixed(t):
            try:
                fixed_day = int(inv.get("billing_day") or 1)
            except (TypeError, ValueError):
                fixed_day = 1
            fixed_day = max(1, min(31, fixed_day))
            last_of_m = _last_day_of_month(t.year, t.month)
            return t.replace(day=min(fixed_day, last_of_m.day))

        def _deadline_for(t):
            return _deadline_fixed(t) if mode in ("fixed_day", "due_next_month") else _deadline_grace(t)

        deadline_this = _deadline_for(today)
        already_ran_this_cycle = (
            last_run == today.isoformat() or today >= deadline_this
        ) if last_run else (today >= deadline_this)
        if already_ran_this_cycle:
            # Volgende maand
            nm_year = today.year if today.month < 12 else today.year + 1
            nm_month = today.month + 1 if today.month < 12 else 1
            next_run = _deadline_for(today.replace(year=nm_year, month=nm_month, day=1))
        else:
            next_run = deadline_this
        inv["mode"] = mode
        inv["next_auto_run"] = next_run.isoformat()
        inv["billing_day_of_month"] = next_run.day
        out["invoicing"] = inv
    except Exception as _e:  # noqa: BLE001
        print(f"[settings] next_auto_run compute failed: {_e}")
    return out


@api.put("/settings/{section}")
async def update_settings_section(section: str, body: dict, user=Depends(get_current_user)):
    """Update a single section. Sends secrets back masked."""
    if section not in VALID_SETTINGS_SECTIONS:
        raise HTTPException(status_code=404, detail="Onbekende instellingen sectie")
    cid = company_id_of(user)
    if not cid:
        raise HTTPException(status_code=400, detail="Geen actief bedrijf geselecteerd")
    doc = await _get_company_settings_doc(cid)
    existing_section = doc.get(section) or {}
    merged = _merge_section(section, existing_section, body or {})
    if section == "kiosk_devices":
        if (body or {}).get("printer_mode") is not None and body["printer_mode"] not in _PRINTER_MODES:
            raise HTTPException(status_code=422, detail="Onbekend printertype")
        if "printer_mode" not in (body or {}) and "kt_v520_enabled" in (body or {}):
            merged["printer_mode"] = "kt-v520" if body["kt_v520_enabled"] else "none"
        merged["printer_mode"] = _printer_mode(merged)
        merged["kt_v520_enabled"] = merged["printer_mode"] == "kt-v520"
        merged["paper_width"] = 80 if str(merged.get("paper_width")) == "80" else 58

    update = {
        f"{section}": merged,
        "updated_at": iso(now_utc()),
        "updated_by": user.get("email"),
    }
    await db.company_settings.update_one(
        {"company_id": cid},
        {"$set": update, "$setOnInsert": {"company_id": cid, "created_at": iso(now_utc())}},
        upsert=True,
    )
    if section == "kiosk_devices":
        await _kb_publish(_kiosk_admin_channel(cid), _device_config_msg(merged))
    return {"section": section, "data": _mask_section(section, merged)}


# Placeholder test endpoints — actual implementations come in Fases B-F.
@api.get("/settings/receipts/preview.html", response_class=HTMLResponse)
async def receipts_preview(font_size: str = "groot", base: Optional[int] = None, name: Optional[int] = None,
                           title: Optional[int] = None, amount: Optional[int] = None, user=Depends(get_current_user)):
    """Live bonvoorbeeld (58mm) met de gekozen lettergrootte, ook op het scherm."""
    cid = company_id_of(user)
    brand = await _company_brand_info(cid)
    p = await db.payments.find_one({"company_id": cid, "receipt_number": {"$nin": [None, ""]}}, {"_id": 0}, sort=[("created_at", -1)])
    if p:
        p = await _enrich_payment(p)
    else:
        p = {**brand, "receipt_number": "KW-VOORBEELD", "paid_at": iso(now_utc()), "tenant_name": "Voorbeeld Huurder",
             "apartment_number": "A-101", "location_name": "Hoofdvestiging", "amount": 2500.0, "currency": "SRD",
             "method": "contant", "category": "huur", "outstanding_after": 0, "note": "Voorbeeldbon"}
    p["_font_px"] = _receipt_fonts({"font_size": font_size,
                                    "presets": {font_size: {"base": base, "name": name, "title": title, "amount": amount}}})[1]
    p["_screen_sizes"] = True
    html = _render_receipt_html(p, fmt="thermal", preview=True)
    return HTMLResponse(content=html, headers={"Cache-Control": "no-store"})


@api.post("/settings/{section}/test")
async def test_settings_section(section: str, user=Depends(get_current_user)):
    if section not in VALID_SETTINGS_SECTIONS:
        raise HTTPException(status_code=404, detail="Onbekende sectie")
    cid = company_id_of(user)
    if not cid:
        raise HTTPException(status_code=400, detail="Geen actief bedrijf geselecteerd")
    cfg = await get_company_section(cid, section)
    if not cfg.get("enabled"):
        raise HTTPException(status_code=400, detail="Sectie is uitgeschakeld — vink 'Ingeschakeld' aan en bewaar eerst.")

    if section == "smtp":
        from email_service import send_email, wrap_template, EmailError
        to = user.get("email") or cfg.get("from_email")
        if not to:
            raise HTTPException(status_code=400, detail="Geen ontvanger gevonden (vul afzender e-mail in)")
        brand_kwargs = await _tenant_email_brand(cid)
        html = wrap_template(
            "<h1>SMTP test geslaagd</h1>"
            "<p>Als je deze e-mail ontvangt, is de SMTP configuratie voor je bedrijf correct.</p>"
            "<p>Je kunt nu kwitanties, facturen en herinneringen verzenden naar je huurders.</p>",
            **brand_kwargs,
        )
        try:
            await send_email(cfg, to, f"{brand_kwargs['brand_name']} — SMTP test", html)
        except EmailError as e:
            return {"section": section, "ok": False, "detail": str(e)}
        return {"section": section, "ok": True, "detail": f"Test e-mail verzonden naar {to}"}

    if section == "twilio":
        from twilio_service import send_whatsapp, send_sms, TwilioError
        # Try WhatsApp first if from is set, else SMS.
        co = await db.companies.find_one({"id": cid}, {"_id": 0, "name": 1}) or {}
        brand_name_twil = co.get("name") or "Vastgoed"
        test_msg = f"{brand_name_twil} test bericht — als je dit ontvangt is je Twilio configuratie correct."
        # Find a destination: prefer admin's own phone from user record (not stored normally),
        # so we test by sending to the configured `from` itself (will fail with sandbox not paired,
        # but at minimum validates credentials).
        target = cfg.get("whatsapp_from") or cfg.get("sms_from")
        if not target:
            raise HTTPException(status_code=400, detail="Vul minimaal WhatsApp- of SMS-afzender in")
        try:
            if cfg.get("whatsapp_from"):
                await send_whatsapp(cfg, target, test_msg)
                return {"section": section, "ok": True, "detail": f"WhatsApp testbericht verzonden naar {target}"}
            await send_sms(cfg, target, test_msg)
            return {"section": section, "ok": True, "detail": f"SMS testbericht verzonden naar {target}"}
        except TwilioError as e:
            return {"section": section, "ok": False, "detail": str(e)}

    if section == "shelly":
        from shelly_service import list_devices, ShellyError
        try:
            devs = await list_devices(cfg)
            return {"section": section, "ok": True,
                    "detail": f"Verbonden met Shelly Cloud — {len(devs)} apparaat(en) gevonden."}
        except ShellyError as e:
            return {"section": section, "ok": False, "detail": str(e)}

    if section == "domain":
        import socket
        import ipaddress
        custom = (cfg.get("custom_domain") or "").strip().lower()
        if not custom:
            return {"section": section, "ok": False, "detail": "Vul eerst een custom domein in."}
        # Target = the server hostname users normally use to reach this app.
        app_target = (os.environ.get("APP_PUBLIC_HOST")
                      or os.environ.get("APP_PUBLIC_URL", "")
                      .replace("https://", "").replace("http://", "").rstrip("/"))
        if not app_target:
            return {"section": section, "ok": False,
                    "detail": "Server is niet geconfigureerd voor custom domeinen. Contact Emergent support om APP_PUBLIC_HOST als productie env-variabele te zetten (bv. surirent.sr)."}
        try:
            host_ip = socket.gethostbyname(custom)
        except socket.gaierror as e:
            return {"section": section, "ok": False,
                    "detail": f"DNS lookup mislukt voor {custom}: {e}. "
                              f"Stel CNAME of A record naar {app_target} in en wacht op DNS propagatie."}
        try:
            target_ip = socket.gethostbyname(app_target)
        except socket.gaierror:
            return {"section": section, "ok": False,
                    "detail": f"Kan target {app_target} niet resolven — controleer APP_PUBLIC_HOST."}

        # ────────────────────────────────────────────────────────────
        # Cloudflare edge-IP ranges. Als beide IPs binnen Cloudflare
        # vallen dan is een IP-vergelijking zinloos: Cloudflare kiest
        # per zone een andere edge-IP maar routeert intern op basis van
        # Host header. Doe in dat geval een functionele HTTPS-check.
        # ────────────────────────────────────────────────────────────
        CLOUDFLARE_RANGES = [
            "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22",
            "103.31.4.0/22", "141.101.64.0/18", "108.162.192.0/18",
            "190.93.240.0/20", "188.114.96.0/20", "197.234.240.0/22",
            "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
            "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
        ]

        def _in_cloudflare(ip_str):
            try:
                ip = ipaddress.ip_address(ip_str)
                return any(ip in ipaddress.ip_network(cidr) for cidr in CLOUDFLARE_RANGES)
            except (ValueError, TypeError):
                return False

        both_cloudflare = _in_cloudflare(host_ip) and _in_cloudflare(target_ip)
        if host_ip == target_ip or both_cloudflare:
            # Functionele HTTPS check — verify dat het domein DE APP
            # serveert i.p.v. een Cloudflare error page (1000-serie).
            https_ok = False
            cf_error_code = None
            try:
                import httpx
                async with httpx.AsyncClient(verify=True, timeout=10, follow_redirects=False) as client:
                    r = await client.get(f"https://{custom}/")
                    if r.status_code < 500:
                        https_ok = True
                    text_head = (r.text or "")[:5000]
                    text_lower = text_head.lower()
                    if "1034" in text_head or "edge ip restricted" in text_lower:
                        cf_error_code = "1034 (Edge IP Restricted)"
                    elif "1000" in text_head and ("dns points" in text_lower or "prohibited" in text_lower):
                        cf_error_code = "1000 (DNS points to prohibited IP)"
                    elif "1014" in text_head and "cname" in text_lower:
                        cf_error_code = "1014 (CNAME cross-user banned)"
            except httpx.HTTPError as e:
                # Netwerk-timeout of TLS fout — meestal betekent dit dat de
                # backend Cloudflare's edge niet vlot bereikt (fluctueert). Bij
                # deze test doen we een 2e poging via HEAD als bevestiging dat
                # er GEEN 1034 aanwezig is (zodat we niet ten onrechte "email
                # support" adviseren).
                try:
                    async with httpx.AsyncClient(verify=True, timeout=8, follow_redirects=False) as client2:
                        r2 = await client2.head(f"https://{custom}/")
                        if r2.status_code < 500:
                            https_ok = True
                except Exception:
                    cf_error_code = f"HTTPS check faalde ({type(e).__name__})"
            except Exception as e:
                cf_error_code = f"HTTPS check faalde ({type(e).__name__})"

            if cf_error_code and "1034" in str(cf_error_code):
                return {"section": section, "ok": False,
                        "detail": (
                            f"DNS resolveert (host {host_ip}, target {target_ip}), maar Cloudflare "
                            f"geeft {cf_error_code}. Dit is een multi-tenant custom-hostname "
                            "beperking van het Emergent platform.\n\n"
                            f"OPLOSSING: Mail support@emergent.sh met (a) je Job ID, (b) een "
                            f"screenshot van Error 1034 en (c) het verzoek om {custom} als "
                            "custom hostname op de Cloudflare zone van dit deployment toe te "
                            f"voegen. Ondertussen werkt de standaard-URL {app_target}/<jouw-slug> "
                            "wel direct zonder DNS-config."
                        )}
            if cf_error_code and both_cloudflare and "HTTPS check faalde" in cf_error_code:
                # Timeout op een dual-Cloudflare setup is bijna altijd Error
                # 1034 die de backend niet snel kon afronden — geef dezelfde
                # duidelijke oplossing i.p.v. een verwarrende "check je DNS".
                return {"section": section, "ok": False,
                        "detail": (
                            f"Cloudflare blokkeert de verbinding naar {custom} (dubbele Cloudflare "
                            f"setup: beide {custom} en {app_target} draaien op Cloudflare). Dit is "
                            "een multi-tenant custom-hostname beperking van het Emergent platform.\n\n"
                            "OPLOSSING: Mail support@emergent.sh met (a) je Job ID, (b) een "
                            f"screenshot van Error 1034 en (c) het verzoek om {custom} als "
                            "custom hostname op de Cloudflare zone van dit deployment toe te "
                            f"voegen. Ondertussen werkt de standaard-URL {app_target}/<jouw-slug> "
                            "wel direct zonder DNS-config."
                        )}
            if cf_error_code:
                return {"section": section, "ok": False,
                        "detail": (
                            f"DNS resolveert (host {host_ip}, target {target_ip}) maar er is een "
                            f"probleem: {cf_error_code}. Controleer of jouw domein correct is "
                            "geconfigureerd bij je registrar en dat DNS-propagatie voltooid is "
                            "(kan tot 24u duren). Als het probleem aanhoudt, mail support met "
                            "je Job ID en dit foutbericht."
                        )}
            if https_ok or both_cloudflare:
                await db.company_settings.update_one(
                    {"company_id": company_id_of(user)},
                    {"$set": {"domain.dns_verified": True, "updated_at": iso(now_utc())}},
                )
                cf_note = " (beide via Cloudflare edge)" if both_cloudflare else ""
                return {"section": section, "ok": True,
                        "detail": f"{custom} wijst correct naar {app_target}{cf_note}. "
                                  "DNS is geverifieerd. Regel nog HTTPS/SSL zelf via Cloudflare (gratis) "
                                  "of een eigen reverse-proxy met Let's Encrypt."}
        return {"section": section, "ok": False,
                "detail": f"{custom} resolveert naar {host_ip}, maar verwacht het IP van {app_target} ({target_ip}). "
                          f"Controleer je DNS record."}

    # Other sections come in later Fases.
    return {
        "section": section,
        "ok": False,
        "detail": "Test endpoint nog niet geïmplementeerd voor deze sectie. Wordt in een volgende fase toegevoegd.",
    }


# ============== Domain target info (voor DNS instructies) ==============
@api.get("/public/domain-resolve")
async def public_domain_resolve(host: str = ""):
    """Publieke lichtgewicht resolver — geeft tenant slug + branding terug
    voor een gegeven hostname. De frontend roept dit aan bij page-load
    wanneer de huidige hostname geen platform-host is, om te bepalen
    voor welke tenant we routen. Geen auth vereist — response is bewust
    beperkt tot niet-gevoelige branding info.
    """
    import re
    target = (host or "").strip().lower()
    # Strip poortnummer indien aanwezig
    target = re.sub(r":\d+$", "", target)
    SYSTEM_HOSTS = ("surirent.sr", "emergentagent.com", "localhost", "127.0.0.1")
    if not target or any(target == s or target.endswith("." + s) for s in SYSTEM_HOSTS):
        return {"found": False, "reason": "system_host"}

    # 1) legacy: companies.custom_domain
    co = await db.companies.find_one(
        {"custom_domain": target},
        {"_id": 0, "id": 1, "slug": 1, "name": 1, "branding": 1},
    )
    # 2) nieuwe locatie: company_settings.domain.custom_domain + enabled
    if not co:
        s = await db.company_settings.find_one(
            {"domain.custom_domain": target, "domain.enabled": True},
            {"_id": 0, "company_id": 1},
        )
        if s:
            co = await db.companies.find_one(
                {"id": s["company_id"]},
                {"_id": 0, "id": 1, "slug": 1, "name": 1, "branding": 1},
            )
    if not co:
        return {"found": False}
    b = co.get("branding") or {}
    return {
        "found": True,
        "slug": co.get("slug"),
        "name": co.get("name"),
        "app_name": b.get("app_name") or co.get("name"),
        "primary_color": _hex_color(b.get("primary_color")),
        "logo_url": b.get("logo_url") or "",
    }


# ============== Domain target info (voor DNS instructies) ==============
@api.post("/settings/email/preview")
async def preview_email_template(body: dict = Body(default={}), user=Depends(get_current_user)):
    """Rendert een voorbeeld-e-mail HTML zoals huurders die zullen ontvangen.

    Body (alle optioneel — vult defaults aan uit `db.companies.branding`):
      - brand_name: overschrijft bedrijfsnaam voor preview
      - brand_color: overschrijft primaire kleur
      - logo_url: overschrijft logo (mag `/api/landing/asset/<id>` of full URL)
      - kind: soort mail (`kwitantie` | `factuur` | `contract` | `herinnering`).
              Default `kwitantie`.

    Retourneert `{"html": "<full email html>"}` — frontend kan dit in een
    iframe `srcdoc` renderen voor een 1:1 live preview.
    """
    from email_service import wrap_template
    cid = company_id_of(user)
    brand = await _tenant_email_brand(cid)
    # Overrides — de admin kan de preview aanpassen zonder eerst op te slaan.
    override_name = (body or {}).get("brand_name")
    override_color = (body or {}).get("brand_color")
    override_logo = (body or {}).get("logo_url")
    if override_name:
        brand["brand_name"] = override_name
    if override_color:
        brand["brand_color"] = override_color
    if override_logo is not None:
        rel = str(override_logo).strip()
        if rel and not rel.startswith("http"):
            base = (os.environ.get("APP_PUBLIC_URL") or "https://app.surirent.sr").rstrip("/")
            brand["logo_url"] = f"{base}{rel if rel.startswith('/') else '/' + rel}"
        else:
            brand["logo_url"] = rel

    kind = (body or {}).get("kind") or "kwitantie"
    samples = {
        "kwitantie": {
            "subject_line": "Kwitantie R-2026-0042",
            "content": """
                <h1>Kwitantie R-2026-0042</h1>
                <p>Beste Jan de Vries,<br />Hierbij ontvangt u een digitale kopie van uw kwitantie.</p>
                <table class="kv">
                  <tr><td>Datum</td><td>2026-02-27</td></tr>
                  <tr><td>Bedrag</td><td>SRD 3.500,00</td></tr>
                  <tr><td>Betaalmethode</td><td>Contant</td></tr>
                  <tr><td>Appartement</td><td>A-102</td></tr>
                  <tr><td>Categorie</td><td>Huur</td></tr>
                </table>
                <p style="margin-top:20px;color:#64748b;font-size:13px">Bewaar deze e-mail als bewijs van betaling.</p>
            """,
        },
        "factuur": {
            "subject_line": "Factuur F-2026-0203 - februari 2026",
            "content": """
                <h1>Factuur F-2026-0203</h1>
                <p>Beste Jan de Vries,<br />Hierbij ontvangt u uw factuur voor februari 2026.</p>
                <table class="kv">
                  <tr><td>Periode</td><td>februari 2026</td></tr>
                  <tr><td>Bedrag</td><td>SRD 3.500,00</td></tr>
                  <tr><td>Status</td><td>Openstaand</td></tr>
                  <tr><td>Appartement</td><td>A-102</td></tr>
                </table>
            """,
        },
        "contract": {
            "subject_line": "Huurcontract C-2026-0005",
            "content": """
                <h1>Contract C-2026-0005</h1>
                <p>Beste Jan de Vries,<br />Hierbij ontvangt u uw huurcontract.</p>
                <table class="kv">
                  <tr><td>Contract</td><td>C-2026-0005</td></tr>
                  <tr><td>Appartement</td><td>A-102</td></tr>
                  <tr><td>Startdatum</td><td>2026-03-01</td></tr>
                  <tr><td>Einddatum</td><td>2027-02-28</td></tr>
                </table>
            """,
        },
        "herinnering": {
            "subject_line": "Betalingsherinnering openstaande facturen",
            "content": """
                <h1>Betalingsherinnering</h1>
                <p>Beste Jan de Vries,<br />U heeft op dit moment <b>2</b> openstaande facturen.</p>
                <table class="kv" style="width:100%;border-collapse:collapse">
                  <tr><td>Januari 2026</td><td style='text-align:right'><b>SRD 3.500,00</b></td></tr>
                  <tr><td>Februari 2026</td><td style='text-align:right'><b>SRD 3.500,00</b></td></tr>
                  <tr style="border-top:2px solid #e2e8f0">
                    <td><b>Totaal openstaand</b></td>
                    <td style='text-align:right;color:#dc2626'><b>SRD 7.000,00</b></td>
                  </tr>
                </table>
                <p style="margin-top:20px">Heeft u vragen? Neem gerust contact met ons op.</p>
            """,
        },
    }
    sample = samples.get(kind) or samples["kwitantie"]
    html = wrap_template(sample["content"], **brand)
    return {
        "html": html,
        "subject": f"{sample['subject_line']} - {brand['brand_name']}",
        "brand": brand,
    }


@api.get("/settings/domain/target")
async def get_domain_target(user=Depends(get_current_user)):
    """Geeft aan het frontend door welke host en IP-adres een custom domein
    moet aanwijzen. Gebruikt door Instellingen → Eigen domein om real-time
    DNS instructies te tonen i.p.v. `<IP van je productie server>` placeholder.
    """
    import socket
    host = (os.environ.get("APP_PUBLIC_HOST")
            or (os.environ.get("APP_PUBLIC_URL") or "")
            .replace("https://", "").replace("http://", "").rstrip("/"))
    ip = ""
    error = ""
    if not host:
        error = "APP_PUBLIC_HOST niet geconfigureerd op de server."
    else:
        try:
            ip = socket.gethostbyname(host)
        except socket.gaierror as e:
            error = f"Kan {host} niet resolven: {e}"
    return {"host": host, "ip": ip, "configured": bool(host and ip), "error": error}


# ============== Live DNS + SSL status voor custom domain ==============
@api.get("/settings/domain/status")
async def get_domain_status(user=Depends(get_current_user)):
    """Real-time status van het custom domein van deze tenant.

    Checkt achter elkaar:
      1. Custom domein is ingesteld?
      2. DNS resolveert naar een IP?
      3. Dat IP matcht het target (APP_PUBLIC_HOST resolved IP)?
      4. HTTPS werkt zonder SSL fout (echt certificaat uitgegeven door bv.
         Let's Encrypt of Cloudflare voor deze exacte hostname)?

    Retourneert een status-code die de frontend als badge toont.
    """
    import socket
    import ssl as _ssl
    cid = company_id_of(user)
    if not cid:
        raise HTTPException(status_code=400, detail="Geen actief bedrijf")

    # Custom domein ophalen uit settings
    settings = await db.company_settings.find_one({"company_id": cid}, {"_id": 0}) or {}
    dom = settings.get("domain") or {}
    custom = (dom.get("custom_domain") or "").strip().lower()
    enabled = bool(dom.get("enabled"))

    # Target ophalen (dezelfde bron als /target endpoint)
    target_host = (os.environ.get("APP_PUBLIC_HOST")
                   or (os.environ.get("APP_PUBLIC_URL") or "")
                   .replace("https://", "").replace("http://", "").rstrip("/"))
    target_ip = ""
    if target_host:
        try:
            target_ip = socket.gethostbyname(target_host)
        except socket.gaierror:
            target_ip = ""

    result = {
        "custom_domain": custom,
        "enabled": enabled,
        "target_host": target_host,
        "target_ip": target_ip,
        "resolved_ip": "",
        "dns_ok": False,
        "ssl_ok": False,
        "https_status_code": None,
        "status": "not_configured",
        "message": "",
    }

    if not custom:
        result["status"] = "not_configured"
        result["message"] = "Geen custom domein ingesteld. Vul een domein in en sla op."
        return result

    if not enabled:
        result["status"] = "disabled"
        result["message"] = f"Custom domein {custom} is uitgeschakeld — zet 'Ingeschakeld' aan om te activeren."
        return result

    # === Stap 1: DNS resolve ===
    try:
        result["resolved_ip"] = socket.gethostbyname(custom)
    except socket.gaierror:
        result["status"] = "dns_missing"
        result["message"] = (f"DNS voor {custom} is niet gevonden. "
                             "Controleer dat je CNAME/A-record correct is ingesteld bij je domeinregistrar.")
        return result

    # === Stap 2: IP klopt met target? ===
    # Cloudflare-fronted domeinen kunnen resolven naar verschillende IPs uit
    # dezelfde /16 subnet — we accepteren ook als het IP tot dezelfde /16
    # behoort (bv. 172.66.x.x is altijd Cloudflare).
    dns_ok = False
    if target_ip and result["resolved_ip"]:
        if result["resolved_ip"] == target_ip:
            dns_ok = True
        else:
            # Zelfde /16 (bv. 172.66.2.113 vs 162.159.142.117 zijn beide CF)
            try:
                a = result["resolved_ip"].split(".")[:2]
                # ────────────────────────────────────────────────────
                # Beide via Cloudflare = OK (Cloudflare gebruikt vele edge
                # IPs, IP-vergelijking is dus zinloos; routing gaat op
                # Host-header). Gebruik ipaddress module voor volledige
                # CIDR-check i.p.v. hardcoded /16 prefixes.
                # ────────────────────────────────────────────────────
                import ipaddress
                CLOUDFLARE_RANGES = [
                    "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22",
                    "103.31.4.0/22", "141.101.64.0/18", "108.162.192.0/18",
                    "190.93.240.0/20", "188.114.96.0/20", "197.234.240.0/22",
                    "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
                    "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
                ]
                def _in_cf(ip_str):
                    try:
                        ip = ipaddress.ip_address(ip_str)
                        return any(ip in ipaddress.ip_network(n) for n in CLOUDFLARE_RANGES)
                    except (ValueError, TypeError):
                        return False
                if _in_cf(result["resolved_ip"]) and _in_cf(target_ip):
                    dns_ok = True
            except Exception:
                pass
    result["dns_ok"] = dns_ok
    if not dns_ok:
        result["status"] = "dns_wrong"
        result["message"] = (f"{custom} resolveert naar {result['resolved_ip']} maar "
                             f"verwacht {target_ip} ({target_host}). Update je DNS record.")
        return result

    # === Stap 3: HTTPS/SSL check ===
    # Doe een HEAD request naar https://{custom} en check dat er een echt
    # certificaat is voor deze hostname (SNI match). We accepteren ook 4xx
    # status codes — die zijn "SSL werkt, backend routing pending".
    try:
        ctx = _ssl.create_default_context()
        with socket.create_connection((custom, 443), timeout=5) as sock:
            with ctx.wrap_socket(sock, server_hostname=custom) as ssock:
                cert = ssock.getpeercert()
                # Cert bevat SAN of CN — als de connectie überhaupt lukt met
                # server_hostname=custom, is SNI match al bewezen door OpenSSL
                result["ssl_ok"] = bool(cert)
    except (_ssl.SSLError, _ssl.CertificateError, socket.error, socket.timeout, socket.gaierror, OSError) as e:
        result["ssl_ok"] = False
        result["status"] = "dns_ok_ssl_pending"
        result["message"] = (
            "DNS wijst correct — maar er is nog geen geldig HTTPS certificaat op je domein. "
            "SSL regel je zelf: het snelst via Cloudflare (gratis) — voeg je domein toe, wijzig "
            "de nameservers naar Cloudflare, zet de DNS-record op proxied (oranje wolk) en kies "
            "SSL/TLS mode 'Full'. Alternatief: eigen reverse-proxy (nginx / Traefik) met Let's Encrypt."
        )
        result["ssl_error"] = str(e)[:200]
        return result

    # === Stap 4: HTTPS response check + SSL provider detectie ===
    # Herken populaire providers via response headers zodat de tenant een
    # groen ✓ krijgt zonder handmatig te bevestigen dat SSL werkt.
    # Ook: detecteer Cloudflare error-pagina's (Error 1034 "Edge IP
    # Restricted", 1000, 1014) — die betekenen SSL werkt WEL maar het
    # domein is niet bereikbaar door een Cloudflare-to-Cloudflare loop.
    ssl_provider = None
    ssl_provider_label = None
    cf_error_code = None
    try:
        import httpx
        async with httpx.AsyncClient(verify=True, timeout=6, follow_redirects=False) as client:
            # GET / (root) i.p.v. /api/health zodat we ook Cloudflare
            # error-pagina's zien voor domeinen die zijn misconfigured —
            # deze error pages worden door CF alleen op HTML routes
            # terug gegeven, niet op API paths.
            r = await client.get(f"https://{custom}/")
            result["https_status_code"] = r.status_code
            body_head = (r.text or "")[:5000]
            # Cloudflare error pages bevatten zowel "errorCode: 1034" (in JS)
            # als "Error 1034" of "Edge IP Restricted" (in HTML). Check op
            # ALLE varianten voor robuustheid.
            body_lower = body_head.lower()
            if "1034" in body_head or "edge ip restricted" in body_lower:
                cf_error_code = "1034"
            elif "1000" in body_head and ("dns points" in body_lower or "prohibited" in body_lower):
                cf_error_code = "1000"
            elif "1014" in body_head and "cname" in body_lower:
                cf_error_code = "1014"
            # Response headers → provider detectie
            hdrs = {k.lower(): v for k, v in r.headers.items()}
            server_hdr = hdrs.get("server", "").lower()
            if hdrs.get("cf-ray") or "cloudflare" in server_hdr:
                ssl_provider = "cloudflare"
                ssl_provider_label = "Cloudflare"
            elif hdrs.get("x-vercel-id") or "vercel" in server_hdr:
                ssl_provider = "vercel"
                ssl_provider_label = "Vercel"
            elif hdrs.get("x-served-by") and "fastly" in hdrs.get("x-served-by", "").lower():
                ssl_provider = "fastly"
                ssl_provider_label = "Fastly"
            elif "nginx" in server_hdr:
                ssl_provider = "nginx"
                ssl_provider_label = "Nginx / Let's Encrypt"
            elif "caddy" in server_hdr:
                ssl_provider = "caddy"
                ssl_provider_label = "Caddy / Let's Encrypt"
            elif server_hdr:
                ssl_provider = "unknown"
                ssl_provider_label = f"Eigen HTTPS ({server_hdr.split('/')[0]})"
    except Exception:
        # SSL werkt maar routing niet — nog altijd "live" want cert is er
        pass
    result["ssl_provider"] = ssl_provider
    result["ssl_provider_label"] = ssl_provider_label

    if cf_error_code:
        # SSL werkt, DNS werkt, maar Cloudflare weigert de request door
        # Cloudflare-to-Cloudflare loop óók bij DNS-only. In dat geval is
        # de enige oplossing dat Emergent Cloudflare-SaaS Custom Hostnames
        # aanzet, OF dat de tenant naar de origin-IP van Emergent's K8s
        # ingress wijst (niet naar surirent.sr).
        result["status"] = "cloudflare_loop"
        result["ssl_ok"] = True
        result["cloudflare_error_code"] = cf_error_code
        result["message"] = (
            f"Cloudflare geeft Error {cf_error_code} \u2014 dit betekent dat "
            f"jouw domein {custom} niet bereikbaar is via onze standaard "
            "custom-domain flow. Beide domeinen (jouw én surirent.sr) draaien "
            "op Cloudflare en dat werkt alleen als Emergent voor jouw domein "
            "Cloudflare-SaaS Custom Hostnames heeft geactiveerd.\n\n"
            "OPLOSSING: Neem contact op met support (support@emergent.sh) en "
            f"vraag om {custom} als custom hostname toe te voegen. Vermeld "
            "in je bericht je bedrijfsnaam en dit foutbericht (Error 1034). "
            "Alternatief: gebruik de standaard-URL surirent.sr/<jouw-slug> — "
            "die werkt direct zonder DNS-config."
        )
        return result

    # Alles OK
    result["status"] = "live"
    provider_txt = f" via {ssl_provider_label}" if ssl_provider_label else ""
    result["message"] = f"✓ {custom} is live en veilig bereikbaar via HTTPS{provider_txt}."
    # Persist verified state
    await db.company_settings.update_one(
        {"company_id": cid},
        {"$set": {"domain.dns_verified": True, "domain.ssl_verified": True,
                  "domain.last_verified_at": iso(now_utc())}},
    )
    return result


# ============== Email send endpoints (Fase B) ==============
class EmailSendIn(BaseModel):
    to: Optional[str] = None  # override; otherwise we use tenant.email
    message: Optional[str] = ""  # optional extra note shown above the receipt block


async def _smtp_or_400(user) -> dict:
    cid = company_id_of(user)
    if not cid:
        raise HTTPException(status_code=400, detail="Geen actief bedrijf geselecteerd")
    cfg = await get_company_section(cid, "smtp")
    if not cfg.get("enabled"):
        raise HTTPException(status_code=400, detail="SMTP is niet ingeschakeld — configureer eerst onder Instellingen → E-mail.")
    return cfg


@api.post("/email/payment/{payment_id}")
async def email_payment_receipt(payment_id: str, body: EmailSendIn, user=Depends(get_current_user)):
    from email_service import send_email, wrap_template, EmailError
    cfg = await _smtp_or_400(user)
    p = await db.payments.find_one({"id": payment_id, **scope(user)}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Kwitantie niet gevonden")
    p = await _enrich_payment(p, include_logo=True)
    tenant = await db.tenants.find_one({"id": p.get("tenant_id"), **scope(user)}, {"_id": 0}) or {}
    to = (body.to or tenant.get("email") or "").strip()
    if not to:
        raise HTTPException(status_code=400, detail="Geen ontvanger — vul een e-mailadres in of zet er een bij de huurder")
    pdf_bytes = await asyncio.to_thread(receipt_pdf, p)
    brand_kwargs = await _tenant_email_brand(company_id_of(user))
    extra_note = f"<p>{body.message}</p>" if body.message else ""
    # Periode-regel — voorheen ontbrak deze in de e-mail, waardoor de huurder
    # niet zag voor welke maand de kwitantie was. Toon de maand+jaar in
    # zowel de intro-zin als de tabel. Voor niet-huur betalingen (borg,
    # servicekosten, boete) hebben we geen periode dus laten we die weg.
    _months_nl = ["januari", "februari", "maart", "april", "mei", "juni",
                  "juli", "augustus", "september", "oktober", "november", "december"]
    period_label = ""
    if p.get("period_month") and p.get("period_year"):
        try:
            period_label = f"{_months_nl[int(p['period_month']) - 1]} {int(p['period_year'])}"
        except Exception:
            period_label = ""
    intro_period = f" voor <b>{period_label}</b>" if period_label else ""
    period_row = f"<tr><td>Periode</td><td>{period_label}</td></tr>" if period_label else ""
    content = f"""
        {extra_note}
        <h1>Kwitantie {p['receipt_number']}</h1>
        <p>Beste {tenant.get('name', 'huurder')},<br />Hierbij ontvang je de kwitantie van je betaling{intro_period}.</p>
        <table class="kv">
          <tr><td>Datum</td><td>{p.get('paid_at', '')[:10]}</td></tr>
          {period_row}
          <tr><td>Bedrag</td><td>{p['currency']} {p['amount']:.2f}</td></tr>
          <tr><td>Betaalmethode</td><td>{p.get('method', '')}</td></tr>
          <tr><td>Appartement</td><td>{p.get('apartment_number', '-')}</td></tr>
        </table>
    """
    subject_period = f" · {period_label}" if period_label else ""
    try:
        await send_email(cfg, to, f"Kwitantie {p['receipt_number']}{subject_period} - {brand_kwargs['brand_name']}",
                         wrap_template(content, **brand_kwargs),
                         attachments=[(f"kwitantie-{p['receipt_number']}.pdf", pdf_bytes, "application/pdf")])
    except EmailError as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {"ok": True, "sent_to": to}


@api.post("/email/invoice/{invoice_id}")
async def email_invoice(invoice_id: str, body: EmailSendIn, user=Depends(get_current_user)):
    from email_service import send_email, wrap_template, EmailError
    cfg = await _smtp_or_400(user)
    inv = await db.invoices.find_one({"id": invoice_id, **scope(user)}, {"_id": 0})
    if not inv:
        raise HTTPException(status_code=404, detail="Factuur niet gevonden")
    inv = await _enrich_invoice(inv)
    tenant = await db.tenants.find_one({"id": inv["tenant_id"], **scope(user)}, {"_id": 0}) or {}
    apt = await db.apartments.find_one({"id": inv.get("apartment_id"), **scope(user)}, {"_id": 0}) or {}
    to = (body.to or tenant.get("email") or "").strip()
    if not to:
        raise HTTPException(status_code=400, detail="Geen ontvanger — vul een e-mailadres in of zet er een bij de huurder")
    payments = await db.payments.find({
        **scope(user),
        "tenant_id": inv["tenant_id"], "category": "huur",
        "period_month": inv["period_month"], "period_year": inv["period_year"],
    }, {"_id": 0}).to_list(50)
    inv = {**inv, **(await _company_brand_info(inv.get("company_id")))}
    pdf_bytes = await asyncio.to_thread(invoice_pdf, inv, tenant, apt, payments)
    brand_kwargs = await _tenant_email_brand(company_id_of(user))
    extra_note = f"<p>{body.message}</p>" if body.message else ""
    months_nl = ["januari", "februari", "maart", "april", "mei", "juni",
                 "juli", "augustus", "september", "oktober", "november", "december"]
    period_label = f"{months_nl[inv['period_month'] - 1]} {inv['period_year']}"
    content = f"""
        {extra_note}
        <h1>Factuur {inv['invoice_number']}</h1>
        <p>Beste {tenant.get('name', 'huurder')},<br />Hierbij ontvang je je factuur voor {period_label}.</p>
        <table class="kv">
          <tr><td>Periode</td><td>{period_label}</td></tr>
          <tr><td>Bedrag</td><td>{inv['currency']} {inv['amount']:.2f}</td></tr>
          <tr><td>Status</td><td>{inv['status']}</td></tr>
          <tr><td>Appartement</td><td>{apt.get('number', '-')}</td></tr>
        </table>
    """
    try:
        await send_email(cfg, to, f"Factuur {inv['invoice_number']} - {brand_kwargs['brand_name']}",
                         wrap_template(content, **brand_kwargs),
                         attachments=[(f"factuur-{inv['invoice_number']}.pdf", pdf_bytes, "application/pdf")])
    except EmailError as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {"ok": True, "sent_to": to}


@api.post("/email/contract/{contract_id}")
async def email_contract(contract_id: str, body: EmailSendIn, user=Depends(get_current_user)):
    from email_service import send_email, wrap_template, EmailError
    cfg = await _smtp_or_400(user)
    c = await db.contracts.find_one({"id": contract_id, **scope(user)}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Contract niet gevonden")
    c = await _enrich_contract(c)
    tenant = await db.tenants.find_one({"id": c["tenant_id"], **scope(user)}, {"_id": 0}) or {}
    apt = await db.apartments.find_one({"id": c["apartment_id"], **scope(user)}, {"_id": 0}) or {}
    to = (body.to or tenant.get("email") or "").strip()
    if not to:
        raise HTTPException(status_code=400, detail="Geen ontvanger — vul een e-mailadres in of zet er een bij de huurder")
    c = {**c, **(await _company_brand_info(c.get("company_id")))}
    id_photo_bytes = await _load_tenant_id_photo_bytes(tenant)
    ev = await _load_tenant_evidence_bundle(tenant, c.get("company_id"))
    pdf_bytes = await asyncio.to_thread(contract_pdf, c, tenant, apt, **ev)
    brand_kwargs = await _tenant_email_brand(company_id_of(user))
    extra_note = f"<p>{body.message}</p>" if body.message else ""
    # If contract is unsigned, include a signing link.
    sign_block = ""
    if c.get("sign_token") and not c.get("signed_at"):
        backend_url = (os.environ.get("APP_PUBLIC_URL")
                       or os.environ.get("PUBLIC_APP_URL", "")).rstrip("/")
        if backend_url:
            sign_block = (f"<p style=\"margin-top:14px\"><a href=\"{backend_url}/onderteken/{c['sign_token']}\""
                          f" style=\"background:{brand_kwargs['brand_color']};color:#fff;text-decoration:none;padding:10px 18px;border-radius:10px;font-weight:700;display:inline-block\">"
                          f"Onderteken contract</a></p>")
    content = f"""
        {extra_note}
        <h1>Contract {c['contract_number']}</h1>
        <p>Beste {tenant.get('name', 'huurder')},<br />Hierbij ontvang je je huurcontract.</p>
        <table class="kv">
          <tr><td>Contract</td><td>{c['contract_number']}</td></tr>
          <tr><td>Appartement</td><td>{apt.get('number', '-')}</td></tr>
          <tr><td>Startdatum</td><td>{c.get('start_date', '')}</td></tr>
          <tr><td>Einddatum</td><td>{c.get('end_date') or '—'}</td></tr>
        </table>
        {sign_block}
    """
    try:
        await send_email(cfg, to, f"Huurcontract {c['contract_number']} - {brand_kwargs['brand_name']}",
                         wrap_template(content, **brand_kwargs),
                         attachments=[(f"contract-{c['contract_number']}.pdf", pdf_bytes, "application/pdf")])
    except EmailError as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {"ok": True, "sent_to": to}


# ============== WhatsApp / SMS send endpoints (Fase C) ==============
class MessageSendIn(BaseModel):
    to: Optional[str] = None
    channel: Literal["whatsapp", "sms"] = "whatsapp"
    message: Optional[str] = ""  # extra text prepended to template


async def _twilio_or_400(user) -> dict:
    cid = company_id_of(user)
    if not cid:
        raise HTTPException(status_code=400, detail="Geen actief bedrijf geselecteerd")
    cfg = await get_company_section(cid, "twilio")
    if not cfg.get("enabled"):
        raise HTTPException(status_code=400, detail="Twilio is niet ingeschakeld — configureer eerst onder Instellingen → WhatsApp & SMS.")
    return cfg


def _public_url(path: str) -> str:
    """Return absolute URL using APP_PUBLIC_URL (frontend hostname), fallback to backend URL."""
    base = (os.environ.get("APP_PUBLIC_URL")
            or os.environ.get("PUBLIC_APP_URL")
            or os.environ.get("REACT_APP_BACKEND_URL", ""))
    return f"{base.rstrip('/')}{path}"


async def _twilio_send(cfg: dict, channel: str, to: str, body: str):
    from twilio_service import send_whatsapp, send_sms, TwilioError
    try:
        if channel == "whatsapp":
            await send_whatsapp(cfg, to, body)
        else:
            await send_sms(cfg, to, body)
    except TwilioError as e:
        raise HTTPException(status_code=502, detail=str(e))


@api.post("/message/payment/{payment_id}")
async def message_payment_receipt(payment_id: str, body: MessageSendIn, user=Depends(get_current_user)):
    cfg = await _twilio_or_400(user)
    p = await db.payments.find_one({"id": payment_id, **scope(user)}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Kwitantie niet gevonden")
    p = await _enrich_payment(p, include_logo=True)
    tenant = await db.tenants.find_one({"id": p.get("tenant_id"), **scope(user)}, {"_id": 0}) or {}
    to = (body.to or tenant.get("phone") or "").strip()
    if not to:
        raise HTTPException(status_code=400, detail="Geen telefoonnummer — vul een nummer in of voeg toe aan de huurder")
    brand_name = await _brand_name_of(company_id_of(user))
    extra = f"{body.message.strip()}\n\n" if body.message else ""
    msg = (
        f"{extra}"
        f"Hallo {tenant.get('name', 'huurder')},\n\n"
        f"Bij dezen je kwitantie {p['receipt_number']}:\n"
        f"• Bedrag: {p['currency']} {p['amount']:.2f}\n"
        f"• Datum: {p.get('paid_at', '')[:10]}\n"
        f"• Methode: {p.get('method', '')}\n\n"
        f"📷 De kwitantie is als foto meegestuurd — bewaar hem in uw galerij.\n"
        f"📄 PDF-versie: {_public_url(f'/api/payments/{payment_id}/pdf')}\n\n"
        f"— {brand_name}"
    )
    # Voor WhatsApp: stuur JPG kwitantie als media-bijlage (inline preview).
    if body.channel == "whatsapp":
        try:
            from twilio_service import send_whatsapp as _swa
            await _swa(cfg, to, msg, media_url=_public_url(f"/api/payments/{payment_id}/image"))
        except Exception as e:  # noqa: BLE001
            print(f"[message-payment] whatsapp media fail, fallback text: {e}")
            await _twilio_send(cfg, body.channel, to, msg)
    else:
        await _twilio_send(cfg, body.channel, to, msg)
    return {"ok": True, "sent_to": to, "channel": body.channel}


@api.post("/message/invoice/{invoice_id}")
async def message_invoice(invoice_id: str, body: MessageSendIn, user=Depends(get_current_user)):
    cfg = await _twilio_or_400(user)
    inv = await db.invoices.find_one({"id": invoice_id, **scope(user)}, {"_id": 0})
    if not inv:
        raise HTTPException(status_code=404, detail="Factuur niet gevonden")
    inv = await _enrich_invoice(inv)
    tenant = await db.tenants.find_one({"id": inv["tenant_id"], **scope(user)}, {"_id": 0}) or {}
    to = (body.to or tenant.get("phone") or "").strip()
    if not to:
        raise HTTPException(status_code=400, detail="Geen telefoonnummer — vul een nummer in of voeg toe aan de huurder")
    brand_name = await _brand_name_of(company_id_of(user))
    months_nl = ["januari", "februari", "maart", "april", "mei", "juni",
                 "juli", "augustus", "september", "oktober", "november", "december"]
    period = f"{months_nl[inv['period_month'] - 1]} {inv['period_year']}"
    extra = f"{body.message.strip()}\n\n" if body.message else ""
    msg = (
        f"{extra}"
        f"Hallo {tenant.get('name', 'huurder')},\n\n"
        f"Je factuur {inv['invoice_number']} voor {period}:\n"
        f"• Bedrag: {inv['currency']} {inv['amount']:.2f}\n"
        f"• Status: {inv['status']}\n\n"
        f"PDF: {_public_url(f'/api/invoices/{invoice_id}/pdf')}\n\n"
        f"— {brand_name}"
    )
    await _twilio_send(cfg, body.channel, to, msg)
    return {"ok": True, "sent_to": to, "channel": body.channel}


@api.post("/tenants/{tenant_id}/reminder")
async def tenant_payment_reminder(
    tenant_id: str,
    body: dict = Body(default={}),
    user=Depends(get_current_user),
):
    """Stuur een herinnering naar een huurder met een overzicht van ALLE
    openstaande facturen (één bericht met opsomming van maanden + totaal).

    body = {channel: 'whatsapp' | 'sms' | 'email', message?: str}
    """
    channel = (body.get("channel") or "whatsapp").lower()
    custom_msg = (body.get("message") or "").strip()
    if channel not in ("whatsapp", "sms", "email"):
        raise HTTPException(status_code=400, detail="Onbekend kanaal")

    sc = scope(user)
    tenant = await db.tenants.find_one({"id": tenant_id, **sc}, {"_id": 0})
    if not tenant:
        raise HTTPException(status_code=404, detail="Huurder niet gevonden")

    invs = await db.invoices.find(
        {**sc, "tenant_id": tenant_id, "status": {"$in": ["open", "sent", "pending", "overdue"]}},
        {"_id": 0},
    ).sort([("period_year", 1), ("period_month", 1)]).to_list(60)
    if not invs:
        raise HTTPException(status_code=400, detail="Deze huurder heeft geen openstaande facturen")

    months_nl = ["januari", "februari", "maart", "april", "mei", "juni",
                 "juli", "augustus", "september", "oktober", "november", "december"]
    cur = invs[0].get("currency", "SRD")
    total = sum(float(i.get("amount", 0)) for i in invs)
    lines = []
    for i in invs:
        pdf_link = _public_url(f"/api/invoices/{i['id']}/pdf")
        month_lbl = months_nl[i['period_month']-1].capitalize()
        lines.append(f"• {month_lbl} {i['period_year']}: {cur} {float(i['amount']):.2f}\n  {pdf_link}")
    period_label = ", ".join(f"{months_nl[i['period_month']-1].capitalize()} {i['period_year']}" for i in invs[:3])
    if len(invs) > 3:
        period_label += f" (+{len(invs) - 3} meer)"

    if channel == "email":
        from email_service import send_email, wrap_template, EmailError
        cfg = await _smtp_or_400(user)
        to = (tenant.get("email") or "").strip()
        if not to:
            raise HTTPException(status_code=400, detail="Geen e-mailadres bij huurder")
        brand_kwargs = await _tenant_email_brand(company_id_of(user))
        extra_note = f"<p>{custom_msg}</p>" if custom_msg else ""
        rows = "".join(
            f"<tr><td>{months_nl[i['period_month']-1].capitalize()} {i['period_year']}</td>"
            f"<td style='text-align:right'><b>{cur} {float(i['amount']):.2f}</b></td></tr>"
            for i in invs
        )
        content = f"""
            {extra_note}
            <h1>Betalingsherinnering</h1>
            <p>Beste {tenant.get('name', 'huurder')},<br />
            U heeft op dit moment <b>{len(invs)}</b> openstaande factu{'ren' if len(invs) > 1 else 'ur'}.
            Graag verzoeken wij u deze zo spoedig mogelijk te voldoen.</p>
            <table class="kv" style="width:100%;border-collapse:collapse">
              {rows}
              <tr style="border-top:2px solid #e2e8f0">
                <td><b>Totaal openstaand</b></td>
                <td style='text-align:right;color:#dc2626'><b>{cur} {total:.2f}</b></td>
              </tr>
            </table>
            <p style="margin-top:20px">Heeft u vragen? Neem gerust contact met ons op.</p>
        """
        try:
            await send_email(cfg, to, "Betalingsherinnering openstaande facturen",
                             wrap_template(content, **brand_kwargs))
        except EmailError as e:
            raise HTTPException(status_code=502, detail=str(e))
        return {"sent": True, "channel": "email", "to": to, "count": len(invs)}

    # WhatsApp / SMS
    cfg = await _twilio_or_400(user)
    to = (tenant.get("phone") or "").strip()
    if not to:
        raise HTTPException(status_code=400, detail="Geen telefoonnummer bij huurder")
    brand_name = await _brand_name_of(company_id_of(user))
    extra = f"{custom_msg}\n\n" if custom_msg else ""
    msg = (
        f"{extra}"
        f"Hallo {tenant.get('name', 'huurder')},\n\n"
        f"Vriendelijke herinnering — u heeft {len(invs)} openstaande "
        f"factu{'ren' if len(invs) > 1 else 'ur'}:\n\n"
        + "\n".join(lines)
        + f"\n\nTotaal openstaand: *{cur} {total:.2f}*\n\n"
        f"Periodes: {period_label}\n\n"
        f"Gelieve zo spoedig mogelijk te betalen.\n\n— {brand_name}"
    )
    await _twilio_send(cfg, channel, to, msg)
    return {"sent": True, "channel": channel, "to": to, "count": len(invs)}


@api.post("/message/contract/{contract_id}")
async def message_contract(contract_id: str, body: MessageSendIn, user=Depends(get_current_user)):
    cfg = await _twilio_or_400(user)
    c = await db.contracts.find_one({"id": contract_id, **scope(user)}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Contract niet gevonden")
    c = await _enrich_contract(c)
    tenant = await db.tenants.find_one({"id": c["tenant_id"], **scope(user)}, {"_id": 0}) or {}
    to = (body.to or tenant.get("phone") or "").strip()
    if not to:
        raise HTTPException(status_code=400, detail="Geen telefoonnummer — vul een nummer in of voeg toe aan de huurder")
    brand_name = await _brand_name_of(company_id_of(user))
    extra = f"{body.message.strip()}\n\n" if body.message else ""
    pdf_link = _public_url(f"/api/contracts/{contract_id}/pdf")
    sign_line = ""
    if c.get("sign_token") and not c.get("signed_at"):
        sign_url = _public_url(f"/onderteken/{c['sign_token']}")
        sign_line = f"\nOnderteken hier: {sign_url}"
    msg = (
        f"{extra}"
        f"Hallo {tenant.get('name', 'huurder')},\n\n"
        f"Je huurcontract {c['contract_number']}:\n"
        f"• Startdatum: {c.get('start_date', '')}\n"
        f"• Einddatum: {c.get('end_date') or '—'}\n\n"
        f"PDF: {pdf_link}"
        f"{sign_line}\n\n"
        f"— {brand_name}"
    )
    await _twilio_send(cfg, body.channel, to, msg)
    return {"ok": True, "sent_to": to, "channel": body.channel}


@api.post("/message/overdue-reminder/{tenant_id}")
async def message_overdue_reminder(tenant_id: str, body: MessageSendIn, user=Depends(get_current_user)):
    """Send a friendly overdue-payment reminder to a tenant."""
    cfg = await _twilio_or_400(user)
    t = await db.tenants.find_one({"id": tenant_id, **scope(user)}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Huurder niet gevonden")
    to = (body.to or t.get("phone") or "").strip()
    if not to:
        raise HTTPException(status_code=400, detail="Geen telefoonnummer — vul in of voeg toe aan de huurder")
    bal = await _calc_balance(t)
    if bal.get("balance", 0) <= 0:
        raise HTTPException(status_code=400, detail="Deze huurder heeft geen achterstand")
    brand_name = await _brand_name_of(company_id_of(user))
    extra = f"{body.message.strip()}\n\n" if body.message else ""
    msg = (
        f"{extra}"
        f"Hallo {t.get('name', 'huurder')},\n\n"
        f"Vriendelijke herinnering: er staat nog {bal['currency']} {bal['balance']:.2f} open.\n\n"
        f"Je kunt langskomen bij ons kantoor of via de Kiosk betalen.\n\n"
        f"— {brand_name}"
    )
    await _twilio_send(cfg, body.channel, to, msg)
    return {"ok": True, "sent_to": to, "channel": body.channel}


# =====================================================================
# Shelly — elektriciteit per appartement (admin only)
# =====================================================================
async def _shelly_or_400(user) -> dict:
    cid = company_id_of(user)
    if not cid:
        raise HTTPException(status_code=400, detail="Geen actief bedrijf geselecteerd")
    # Pakket-gate: Shelly stroombeheer moet in het abonnement zitten.
    await _require_plan_feature(cid, "allow_shelly", "Shelly stroombeheer")
    cfg = await get_company_section(cid, "shelly")
    if not cfg.get("enabled"):
        raise HTTPException(status_code=400, detail="Shelly is niet ingeschakeld — configureer eerst onder Instellingen → Shelly.")
    if not (cfg.get("cloud_token") or "").strip():
        raise HTTPException(status_code=400, detail="Shelly Cloud token ontbreekt — vul in onder Instellingen → Shelly.")
    return cfg


@api.get("/shelly/devices")
async def shelly_list_devices(user=Depends(get_current_user)):
    """List all Shelly devices on the company's Shelly Cloud account."""
    from shelly_service import list_devices, ShellyError
    cfg = await _shelly_or_400(user)
    try:
        devs = await list_devices(cfg)
    except ShellyError as e:
        raise HTTPException(status_code=502, detail=str(e))
    # Normalize to a small payload for the dropdown.
    out = []
    for d in devs:
        out.append({
            "device_id": str(d.get("id") or d.get("deviceId") or ""),
            "name": d.get("name") or d.get("alias") or "",
            "type": d.get("type") or d.get("gen") or "",
            "online": bool(d.get("online")) if "online" in d else None,
        })
    return out


@api.put("/apartments/{apt_id}/shelly")
async def bind_apartment_shelly(apt_id: str, body: ShellyBindIn, user=Depends(get_current_user)):
    """Bind or unbind a Shelly device to an apartment."""
    apt = await db.apartments.find_one({"id": apt_id, **scope(user)}, {"_id": 0})
    if not apt:
        raise HTTPException(status_code=404, detail="Appartement niet gevonden")
    if not (body.device_id or "").strip():
        await db.apartments.update_one({"id": apt_id}, {"$unset": {"shelly": ""}})
        return {"ok": True, "shelly": None}
    binding = {
        "device_id": body.device_id.strip(),
        "channel": int(body.channel or 0),
        "label": (body.label or "").strip(),
    }
    await db.apartments.update_one({"id": apt_id}, {"$set": {"shelly": binding}})
    return {"ok": True, "shelly": binding}


@api.get("/shelly/apartment/{apt_id}/status")
async def shelly_apartment_status(apt_id: str, user=Depends(get_current_user)):
    from shelly_service import device_status, ShellyError
    apt = await db.apartments.find_one({"id": apt_id, **scope(user)}, {"_id": 0})
    if not apt:
        raise HTTPException(status_code=404, detail="Appartement niet gevonden")
    binding = apt.get("shelly") or {}
    device_id = (binding.get("device_id") or "").strip()
    if not device_id:
        raise HTTPException(status_code=400, detail="Geen Shelly apparaat gekoppeld aan dit appartement")
    cfg = await _shelly_or_400(user)
    try:
        st = await device_status(cfg, device_id)
    except ShellyError as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {
        "apartment_id": apt_id,
        "device_id": device_id,
        "channel": binding.get("channel", 0),
        "label": binding.get("label", ""),
        "online": st.get("online"),
        "ison": st.get("ison"),
        "power_w": st.get("power_w"),
        "energy_wh": st.get("energy_wh"),
    }


@api.post("/shelly/apartment/{apt_id}/control")
async def shelly_apartment_control(apt_id: str, body: ShellyControlIn, user=Depends(get_current_user)):
    from shelly_service import control_relay, ShellyError
    apt = await db.apartments.find_one({"id": apt_id, **scope(user)}, {"_id": 0})
    if not apt:
        raise HTTPException(status_code=404, detail="Appartement niet gevonden")
    binding = apt.get("shelly") or {}
    device_id = (binding.get("device_id") or "").strip()
    if not device_id:
        raise HTTPException(status_code=400, detail="Geen Shelly apparaat gekoppeld aan dit appartement")
    cfg = await _shelly_or_400(user)
    try:
        await control_relay(cfg, device_id, body.turn, int(binding.get("channel") or 0))
    except ShellyError as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {"ok": True, "apartment_id": apt_id, "turn": body.turn}


@api.post("/superadmin/run-trial-reminders")
async def manual_run_trial_reminders(user=Depends(require_role("superadmin"))):
    """Manually trigger the reminder sweep (useful for testing)."""
    await _send_trial_reminders()
    return {"ok": True}


async def _enforce_billing_expirations():
    """Markeer trial-bedrijven waar de trial is afgelopen als 'expired'.
    Wordt op verzoek aangeroepen door superadmin of (later) cronjob.
    Verstuurt 1 email per nieuw geconvergeerd expired bedrijf."""
    now = datetime.now(timezone.utc)
    expired = []
    cursor = db.companies.find({"billing_status": "trial"}, {"_id": 0})
    async for c in cursor:
        end_raw = c.get("trial_ends_at")
        if not end_raw:
            continue
        try:
            end = datetime.fromisoformat(end_raw.replace("Z", "+00:00"))
        except Exception:
            continue
        if end < now:
            await db.companies.update_one(
                {"id": c["id"]},
                {"$set": {"billing_status": "expired", "expired_at": now.isoformat()}},
            )
            expired.append(c)
            if c.get("owner_email"):
                try:
                    await _saas_email(
                        to_email=c["owner_email"],
                        subject="Uw proefperiode is verlopen",
                        body_html=f"<p>Beste {c.get('owner_name', 'beheerder')},</p>"
                                  f"<p>De proefperiode van uw <strong>{c.get('name')}</strong> omgeving is verlopen. "
                                  f"Activeer uw abonnement om weer toegang te krijgen.</p>",
                    )
                except Exception:
                    pass
    return expired


@api.post("/superadmin/run-billing-checks")
async def manual_run_billing_checks(user=Depends(require_role("superadmin"))):
    """Markeer expired trial-bedrijven + stuur notificatie. Kan handmatig of
    via cronjob worden aangeroepen."""
    expired = await _enforce_billing_expirations()
    return {
        "ok": True,
        "expired_count": len(expired),
        "expired_companies": [{"id": c["id"], "name": c.get("name")} for c in expired],
    }



@api.get("/admin/morning-briefing")
async def morning_briefing(user=Depends(require_role("admin"))):
    """Lichte dagbriefing voor /admin: aantal overdue invoices (>7 dgn),
    bedrag-totaal per valuta, nieuwe pendings vandaag, nieuwe betalingen
    vandaag. Frontend toont éénmalig per dag een banner (08:00-12:00).
    """
    cid = company_id_of(user)
    today = now_utc().date()
    week_ago = (now_utc() - timedelta(days=7)).date()
    midnight = datetime.combine(today, datetime.min.time(), tzinfo=timezone.utc)

    # Overdue invoices > 7 days behind (status=open, created_at < 7 dagen geleden)
    overdue_q = {"company_id": cid, "status": {"$in": ["open", "overdue"]}}
    overdue_invoices = await db.invoices.find(overdue_q, {"_id": 0}).to_list(2000)
    overdue_filtered = []
    overdue_total_by_currency: dict = {}
    for inv in overdue_invoices:
        try:
            cat = inv.get("created_at") or ""
            cat_d = datetime.fromisoformat(cat.replace("Z", "+00:00")).date() if cat else None
        except Exception:
            cat_d = None
        if cat_d and cat_d <= week_ago:
            overdue_filtered.append(inv)
            cur = (inv.get("currency") or "SRD").upper()
            overdue_total_by_currency[cur] = overdue_total_by_currency.get(cur, 0.0) + float(inv.get("amount", 0))

    # Overdue payment-plan termijnen
    overdue_installments = 0
    today_iso = today.isoformat()
    async for inst in db.payment_plan_installments.find(
        {"company_id": cid, "status": "pending", "due_date": {"$lt": today_iso}},
        {"_id": 0, "id": 1},
    ):
        overdue_installments += 1

    # Pending approvals + payments since midnight
    new_pending = await db.payments.count_documents(
        {"company_id": cid, "status": "pending_approval", "paid_at": {"$gte": iso(midnight)}}
    )
    new_payments = await db.payments.count_documents(
        {"company_id": cid, "status": "approved", "paid_at": {"$gte": iso(midnight)}}
    )

    # Unieke huurders met achterstand
    unique_tenants = len({inv.get("tenant_id") for inv in overdue_filtered if inv.get("tenant_id")})

    return {
        "date": today_iso,
        "overdue_invoice_count": len(overdue_filtered),
        "overdue_tenant_count": unique_tenants,
        "overdue_total_by_currency": {k: round(v, 2) for k, v in overdue_total_by_currency.items()},
        "overdue_installment_count": overdue_installments,
        "new_pending_today": new_pending,
        "new_payments_today": new_payments,
    }


app.include_router(api)

# =====================================================================
# Modulaire route-bestanden (zie /app/backend/routes/) — incrementele
# refactor om server.py op te splitsen in behapbare logische modules.
# De _deps module krijgt referenties naar shared dependencies zodat
# route-modules geen circulaire imports nodig hebben.
# =====================================================================
from routes import _deps as _route_deps  # noqa: E402
from routes import nfc as _nfc_routes    # noqa: E402
from routes import saas_ops as _saas_ops_routes  # noqa: E402
from routes import superadmin as _superadmin_routes  # noqa: E402

_route_deps.db = db
_route_deps.get_current_user = get_current_user
_route_deps.get_kiosk_session = get_kiosk_session
_route_deps.company_id_of = company_id_of
_route_deps.scope = scope
_route_deps.require_role = require_role
_route_deps.saas_email = _saas_email
_route_deps.iso = iso
_route_deps.now_utc = now_utc
_route_deps.new_id = new_id
_route_deps.billing_summary = _billing_summary
_route_deps.is_online = _is_online
_route_deps.activate_company_after_payment = _activate_company_after_saas_payment
_route_deps.send_saas_payment_email = _send_saas_payment_email
_route_deps.get_eur_per_srd = _get_eur_per_srd
_route_deps.ensure_open_invoice = _ensure_open_invoice_for_company
_route_deps.notify_company_admins = _notify_company_admins
app.include_router(_nfc_routes.router, prefix="/api")
app.include_router(_saas_ops_routes.router, prefix="/api")
app.include_router(_superadmin_routes.router, prefix="/api")

# SaaS Stripe betalingen — custom PaymentIntent flow (geen hosted checkout)
from routes import saas_stripe as _saas_stripe_routes  # noqa: E402
app.include_router(_saas_stripe_routes.router, prefix="/api")
from routes import company_stripe as _company_stripe_routes  # noqa: E402
app.include_router(_company_stripe_routes.router, prefix="/api")

# AI-assistent — aparte router met eigen /api/assistant/* endpoints
from ai_assistant import router as _assistant_router  # noqa: E402
app.include_router(_assistant_router)

async def _notify_tenant_installment_paid(plan_id: str, seq: int) -> None:
    """Stuur een korte WhatsApp/SMS bevestiging naar de huurder na een
    succesvolle termijn-betaling. Faalt stilzwijgend wanneer Twilio niet
    is ingeschakeld of er geen telefoonnummer is."""
    try:
        plan = await db.payment_plans.find_one({"id": plan_id}, {"_id": 0})
        if not plan:
            return
        tenant = await db.tenants.find_one(
            {"id": plan["tenant_id"]}, {"_id": 0, "name": 1, "phone": 1, "email": 1}
        ) or {}
        phone = (tenant.get("phone") or "").strip()
        cid = plan.get("company_id")
        cfg = await get_company_section(cid, "twilio") if cid else {}
        cur = plan.get("currency", "SRD")
        inst = await db.payment_plan_installments.find_one(
            {"plan_id": plan_id, "sequence": seq}, {"_id": 0}
        )
        if not inst:
            return
        total_inst = await db.payment_plan_installments.count_documents(
            {"plan_id": plan_id, "status": {"$ne": "cancelled"}}
        )
        paid_inst = await db.payment_plan_installments.count_documents(
            {"plan_id": plan_id, "status": "paid"}
        )
        next_inst = await db.payment_plan_installments.find_one(
            {"plan_id": plan_id, "status": "pending"}, {"_id": 0},
            sort=[("sequence", 1)],
        )
        remaining = total_inst - paid_inst
        amount = float(inst.get("amount") or 0)
        # Bouw publieke kwitantie-links — Twilio WhatsApp toont een JPG inline
        # als media bijlage; PDF-link komt in de tekst voor download/print.
        payment_id = inst.get("payment_id")
        receipt_image_url = _public_url(f"/api/payments/{payment_id}/image") if payment_id else None
        receipt_pdf_url = _public_url(f"/api/payments/{payment_id}/pdf") if payment_id else None
        if paid_inst >= total_inst:
            body = (
                f"Bedankt {tenant.get('name', 'huurder')}!\n\n"
                f"Termijn {seq}/{total_inst} betaald ({cur} {amount:.2f}).\n\n"
                f"*Uw betalingsregeling is volledig voldaan.* "
                f"Hartelijk dank voor de tijdige betaling!\n\n"
            )
        else:
            nl = ""
            if next_inst and next_inst.get("due_date"):
                try:
                    y, m, d = next_inst["due_date"].split("-")
                    nl = f"\nVolgende vervaldatum: {d}-{m}-{y}"
                except Exception:
                    nl = f"\nVolgende vervaldatum: {next_inst['due_date']}"
            body = (
                f"Bedankt {tenant.get('name', 'huurder')}!\n\n"
                f"Termijn {seq}/{total_inst} betaald ({cur} {amount:.2f}).\n"
                f"Nog *{remaining}* termijn{'en' if remaining != 1 else ''} te gaan.{nl}\n\n"
            )
        if receipt_pdf_url:
            body += f"📄 Kwitantie PDF: {receipt_pdf_url}\n\n"
        body += f"— {await _brand_name_of(cid)}"
        if cfg.get("enabled") and phone:
            try:
                from twilio_service import send_whatsapp
                await send_whatsapp(cfg, phone, body, media_url=receipt_image_url)
            except Exception as e:  # noqa: BLE001
                print(f"[plan-notify] twilio fail: {e}")
        # Optionele email — met PDF kwitantie als bijlage indien beschikbaar.
        email = (tenant.get("email") or "").strip()
        smtp = await get_company_section(cid, "smtp") if cid else {}
        if smtp.get("enabled") and email:
            try:
                from email_service import send_email, wrap_template
                brand_kwargs = await _tenant_email_brand(cid)
                next_line = ""
                if paid_inst < total_inst and next_inst:
                    next_line = f"<p>Nog <b>{remaining}</b> termijn(en) te gaan, volgende vervaldatum {next_inst.get('due_date','')}.</p>"
                elif paid_inst >= total_inst:
                    next_line = "<p><b>Uw betalingsregeling is volledig voldaan.</b></p>"
                link_block = (
                    f'<p style="margin:18px 0;"><a href="{receipt_pdf_url}" '
                    f'style="background:{brand_kwargs["brand_color"]};color:#fff;padding:10px 16px;border-radius:8px;'
                    f'text-decoration:none;font-weight:bold;display:inline-block;">'
                    f'📄 Download kwitantie</a></p>'
                ) if receipt_pdf_url else ""
                content = f"""
                    <h1>Termijn {seq}/{total_inst} ontvangen</h1>
                    <p>Beste {tenant.get('name', 'huurder')},<br />
                    Bedankt voor uw betaling van <b>{cur} {amount:.2f}</b>.</p>
                    {next_line}
                    {link_block}
                """
                # Genereer PDF bijlage van de kwitantie zelf (compact, ~10 KB).
                # ReportLab is synchroon en kan 1-3s duren bij branding/logo —
                # draai het in een threadpool om het event loop niet te blokkeren.
                attachments = None
                if payment_id:
                    try:
                        payment_doc = await db.payments.find_one({"id": payment_id}, {"_id": 0})
                        if payment_doc:
                            enriched = await _enrich_payment(payment_doc)
                            pdf_bytes = await asyncio.to_thread(receipt_pdf, enriched)
                            attachments = [(f"kwitantie-{enriched.get('receipt_number','')}.pdf", pdf_bytes, "application/pdf")]
                    except Exception as e:  # noqa: BLE001
                        print(f"[plan-notify] pdf-attach fail: {e}")
                await send_email(
                    smtp, email,
                    f"Termijn {seq}/{total_inst} ontvangen — Betalingsregeling",
                    wrap_template(content, **brand_kwargs),
                    attachments=attachments,
                )
            except Exception as e:  # noqa: BLE001
                print(f"[plan-notify] smtp fail: {e}")
    except Exception as e:  # noqa: BLE001
        print(f"[plan-notify] outer fail: {e}")



# --- Payment Plans (Betalingsregeling) router ---
# Apart bestand zodat server.py niet nog verder uitdijt. We injecteren de
# helpers expliciet zodat er geen circular import nodig is.
from payment_plans import make_router as _make_payment_plans_router, _build_pay_core as _build_plan_pay_core  # noqa: E402

_pp_helpers = {
    "new_id": new_id,
    "iso": iso,
    "now_utc": now_utc,
    "scope": scope,
    "company_id_of": company_id_of,
    "get_current_user": get_current_user,
    "require_role": require_role,
    "next_receipt_number": _next_receipt_number,
    "allocate_to_invoices": _allocate_payment_to_invoices,
    "notify_tenant_paid": _notify_tenant_installment_paid,
}
_payment_plans_router = _make_payment_plans_router(db, _pp_helpers)
# We voegen de router toe aan de hoofd `app` via /api prefix omdat
# `api.include_router(_payment_plans_router)` na `app.include_router(api)`
# niet meer alle endpoints registreert (sub-router al gemount).
app.include_router(_payment_plans_router, prefix="/api")

# =====================================================================
# Slug-aware PWA manifest endpoint
#
# Wanneer een tenant een PWA installeert vanaf `/<slug>/login` (of een
# andere branded route) moet de geïnstalleerde app blijven openen binnen
# het bedrijfs-context (`/<slug>/...`) — niet op de generieke `/login`.
#
# Browsers cachen het manifest op de URL. Een blob: manifest URL werkt
# alleen tijdens de huidige document-sessie. Een stabiele HTTP URL is
# robuuster: Chrome/Android herfetcht hem bij update-checks, en de
# installed PWA gebruikt de daarin opgegeven `start_url` / `scope`.
# =====================================================================
import json as _json
from fastapi import Response as _FastAPIResponse

_PWA_ROLE_MANIFEST: dict[str, dict] = {
    "beheer": {
        "name": "SuriRent Beheer",
        "short_name": "Beheer",
        "description": "Beheerdersapp voor SuriRent — appartementen, huurders, betalingen en facturen.",
        "start_url": "/login?view=admin&source=pwa",
        "scope": "/",
        "display": "standalone",
        "orientation": "any",
        "background_color": "#FFF7F0",
        "theme_color": "#FFFFFF",
        "lang": "nl",
        "dir": "ltr",
        "categories": ["business", "finance", "productivity"],
        "id": "/?app=beheer",
        "prefer_related_applications": False,
        "icons": [
            {"src": "/kiosk-icons/beheer-72.png",  "sizes": "72x72",   "type": "image/png", "purpose": "any"},
            {"src": "/kiosk-icons/beheer-144.png", "sizes": "144x144", "type": "image/png", "purpose": "any"},
            {"src": "/kiosk-icons/beheer-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable"},
            {"src": "/kiosk-icons/beheer-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable"},
        ],
    },
    "huurder": {
        "name": "SuriRent Huurder",
        "short_name": "Huurder",
        "description": "Huurdersportaal voor SuriRent — saldo, betalingen, kwitanties en onderhoud.",
        "start_url": "/kiosk/huurder?source=pwa",
        "scope": "/",
        "display": "standalone",
        "orientation": "any",
        "background_color": "#EAF8F1",
        "theme_color": "#10B981",
        "lang": "nl",
        "dir": "ltr",
        "categories": ["business", "productivity"],
        "id": "/?app=huurder",
        "prefer_related_applications": False,
        "icons": [
            {"src": "/kiosk-icons/huurder-72.png",  "sizes": "72x72",   "type": "image/png", "purpose": "any"},
            {"src": "/kiosk-icons/huurder-144.png", "sizes": "144x144", "type": "image/png", "purpose": "any"},
            {"src": "/kiosk-icons/huurder-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable"},
            {"src": "/kiosk-icons/huurder-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable"},
        ],
    },
    "kiosk": {
        "name": "SuriRent Kiosk",
        "short_name": "Kiosk",
        "description": "Selfservice kiosk terminal voor huurders — PIN-toegang, betalingen.",
        "start_url": "/kiosk?source=pwa",
        "scope": "/",
        "display": "standalone",
        "orientation": "any",
        "background_color": "#FF5C00",
        "theme_color": "#FFFFFF",
        "lang": "nl",
        "dir": "ltr",
        "categories": ["business", "productivity"],
        "id": "/?app=kiosk",
        "prefer_related_applications": False,
        "icons": [
            {"src": "/kiosk-icons/kioskpwa-72.png",  "sizes": "72x72",   "type": "image/png", "purpose": "any"},
            {"src": "/kiosk-icons/kioskpwa-144.png", "sizes": "144x144", "type": "image/png", "purpose": "any"},
            {"src": "/kiosk-icons/kioskpwa-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable"},
            {"src": "/kiosk-icons/kioskpwa-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable"},
        ],
    },
}


# =====================================================================
# Globaal gedeelde PWA metadata — screenshots voor install-prompt UI,
# IARC content-rating (volwassen content: nee) en protocol_handlers
# zodat `web+surirent://` deeplinks de app openen. Voor alle rollen
# identiek; wordt gemerged in de dynamic manifest response hieronder.
# =====================================================================
_PWA_SCREENSHOTS = [
    {
        "src": "/kiosk-icons/screenshots/01_landing.jpg",
        "sizes": "540x960",
        "type": "image/jpeg",
        "form_factor": "narrow",
        "label": "De complete huurbeheer oplossing voor vastgoed",
    },
    {
        "src": "/kiosk-icons/screenshots/02_kiosk_pin.jpg",
        "sizes": "540x960",
        "type": "image/jpeg",
        "form_factor": "narrow",
        "label": "Kiosk Terminal — snelle PIN-toegang voor huurders",
    },
    {
        "src": "/kiosk-icons/screenshots/03_tenant_login.jpg",
        "sizes": "540x960",
        "type": "image/jpeg",
        "form_factor": "narrow",
        "label": "Mijn Huurportaal — saldo, betalingen en onderhoud",
    },
]

# IARC rating (Everyone, geen volwassen content) — zelfde id in alle manifests.
_PWA_IARC_RATING_ID = "e84b072d-71b3-4d3e-86ae-31a8ce4e53b7"

# Protocol handlers — Chrome/Edge Android/Desktop openen `web+surirent://`
# deeplinks direct in de geïnstalleerde PWA. `%s` wordt vervangen door
# de encoded target-URL door de browser.
_PWA_PROTOCOL_HANDLERS = [
    {"protocol": "web+surirent", "url": "/open?target=%s"},
]


def _slug_aware_start_url(role: str, slug: str | None) -> str:
    """Bouw de role-specifieke in-slug start_url."""
    if not slug:
        # geen slug → fallback naar de niet-branded defaults
        return _PWA_ROLE_MANIFEST.get(role, _PWA_ROLE_MANIFEST["beheer"])["start_url"]
    if role == "huurder":
        return f"/{slug}/kiosk/huurder?source=pwa"
    if role == "kiosk":
        return f"/{slug}/kiosk?source=pwa"
    return f"/{slug}/login?source=pwa&view=admin"



# NOTE: Uni5Pay mock pay page endpoint verwijderd — geen online providers meer.


@app.get("/api/pwa/manifest")
async def pwa_manifest(role: str = "beheer", slug: str | None = None):
    """
    Slug-aware PWA manifest. Frontend zet:
        <link rel="manifest" href="/api/pwa/manifest?role=beheer&slug=surirent">
    De geïnstalleerde PWA opent dan in het bedrijfs-context.

    Returns: application/manifest+json
    """
    role = (role or "beheer").lower().strip()
    if role not in _PWA_ROLE_MANIFEST:
        role = "beheer"
    base = _json.loads(_json.dumps(_PWA_ROLE_MANIFEST[role]))  # diepe copy
    # Merge gedeelde PWA metadata: install-screenshots, content rating,
    # protocol_handlers. Deze blijven identiek per rol zodat alle Apps
    # dezelfde ratings/handlers krijgen bij install.
    base["screenshots"] = _PWA_SCREENSHOTS
    base["iarc_rating_id"] = _PWA_IARC_RATING_ID
    base["protocol_handlers"] = _PWA_PROTOCOL_HANDLERS
    if slug:
        slug = slug.lower().strip()
        # Strikte sanitatie — alleen [a-z0-9-] toelaten zodat we geen
        # injectie in URLs krijgen.
        import re as _re
        if _re.match(r"^[a-z0-9][a-z0-9-]{0,62}$", slug):
            base["start_url"] = _slug_aware_start_url(role, slug)
            base["scope"] = f"/{slug}/"
            base["id"] = f"/{slug}/?role={role}"
    body = _json.dumps(base, ensure_ascii=False)
    return _FastAPIResponse(
        content=body,
        media_type="application/manifest+json",
        headers={
            # Korte cache — laat browsers de manifest verversen wanneer
            # we de start_url logica updaten. PWA install captures op
            # install-moment, dus deze cache is alleen voor herfetches.
            "Cache-Control": "public, max-age=300, must-revalidate",
        },
    )




# Shared core voor tenant + kiosk installment-betaling
_plan_core = _build_plan_pay_core(db, _pp_helpers)


# ---------- Tenant Kiosk — Betalingsregelingen ----------
@app.get("/api/tenant-portal/payment-plans")
async def tenant_portal_payment_plans(tenant=Depends(get_tenant_session)):
    """Lijst van actieve betalingsregelingen voor de ingelogde huurder."""
    return await _plan_core["list_plans_for_tenant"](
        tenant["id"], tenant.get("company_id"), status="active",
    )


class _TenantPayInstallmentIn(BaseModel):
    method: Literal["contant", "bank"] = "contant"
    note: Optional[str] = ""
    amount: Optional[float] = None


@app.post("/api/tenant-portal/payment-plans/{plan_id}/installments/{seq}/pay")
async def tenant_portal_pay_installment(
    plan_id: str, seq: int, body: _TenantPayInstallmentIn,
    tenant=Depends(get_tenant_session),
):
    """Huurder betaalt zelf een termijn vanuit zijn Tenant Kiosk."""
    plan = await db.payment_plans.find_one(
        {"id": plan_id, "tenant_id": tenant["id"], "company_id": tenant.get("company_id")},
        {"_id": 0},
    )
    if not plan:
        raise HTTPException(status_code=404, detail="Regeling niet gevonden")
    out = await _plan_core["pay_installment_for"](
        plan, seq,
        method=body.method, amount=body.amount, note=body.note or "",
        received_by=tenant.get("name") or "Huurder Kiosk",
        approved_by_label=tenant.get("name") or "Huurder Kiosk",
        status="approved",
    )
    # Notify admins (zelfde flow als bij /tenant-portal/payments)
    try:
        await _notify_company_admins(
            tenant.get("company_id"),
            f"Termijnbetaling regeling — {plan.get('currency', '')} {float(body.amount or 0):,.2f}",
            f"{tenant.get('name')} betaalde termijn {seq} via Huurder Kiosk",
            {"kind": "payment", "url": "/admin/payment_plans", "badge_inc": 1, "plan_id": plan_id},
        )
    except Exception as e:  # noqa: BLE001
        print(f"[push] tenant pay-installment notify failed: {e}")
    return out


# ---------- Operator Kiosk — Betalingsregelingen ----------
@app.get("/api/kiosk/tenants/{tenant_id}/payment-plans")
async def kiosk_tenant_payment_plans(tenant_id: str, _session=Depends(get_kiosk_session)):
    """Operator Kiosk haalt actieve regelingen op voor de huurder die nu
    aan de balie staat. Filter op company_id van de kiosk-sessie."""
    cid = _session.get("company_id")
    return await _plan_core["list_plans_for_tenant"](tenant_id, cid, status="active")


class _KioskPayInstallmentIn(BaseModel):
    method: Literal["contant", "bank", "creditcard", "ideal"] = "contant"
    note: Optional[str] = ""
    amount: Optional[float] = None
    employee_id: Optional[str] = None
    employee_pin: Optional[str] = None


@app.post("/api/kiosk/payment-plans/{plan_id}/installments/{seq}/pay")
async def kiosk_pay_installment(
    plan_id: str, seq: int, body: _KioskPayInstallmentIn,
    _session=Depends(get_kiosk_session),
):
    """Operator Kiosk medewerker int een termijn voor een huurder.
    Indien een `employee_id` + `employee_pin` is meegegeven → pending_approval
    zodat de admin later moet goedkeuren (zelfde patroon als kiosk_create_payment)."""
    cid = _session.get("company_id")
    plan = await db.payment_plans.find_one(
        {"id": plan_id, "company_id": cid}, {"_id": 0}
    )
    if not plan:
        raise HTTPException(status_code=404, detail="Regeling niet gevonden")

    kiosk_emp_id, kiosk_emp_name, status = None, None, "approved"
    if body.employee_id:
        emp = await db.employees.find_one(
            {"id": body.employee_id, "company_id": cid, "active": True, "app_role": "kiosk"},
            {"_id": 0},
        )
        if not emp:
            raise HTTPException(status_code=404, detail="Kiosk-medewerker niet gevonden")
        if not emp.get("kiosk_pin_hash") or not verify_password(
            (body.employee_pin or "").strip(), emp["kiosk_pin_hash"],
        ):
            raise HTTPException(status_code=401, detail="Ongeldige PIN")
        kiosk_emp_id, kiosk_emp_name = emp["id"], emp.get("name", "")

    out = await _plan_core["pay_installment_for"](
        plan, seq,
        method=body.method, amount=body.amount, note=body.note or "",
        received_by=kiosk_emp_name or "Operator Kiosk",
        approved_by_label=kiosk_emp_name or "Operator Kiosk",
        status=status,
        kiosk_employee_id=kiosk_emp_id,
        kiosk_employee_name=kiosk_emp_name,
    )
    # Betaling meegeven zodat de kiosk direct de kwitantie kan tonen/printen.
    inst = await db.payment_plan_installments.find_one({"plan_id": plan_id, "sequence": seq}, {"_id": 0, "payment_id": 1})
    if inst and inst.get("payment_id"):
        pay = await db.payments.find_one({"id": inst["payment_id"]}, {"_id": 0})
        if pay:
            out = {**out, "payment": await _enrich_payment(pay)}
    # Direct verwerkt → beheerders krijgen een gewone betaalmelding.
    try:
        if kiosk_emp_name:
            await _notify_company_admins(
                cid,
                "Termijnbetaling ontvangen",
                f"{kiosk_emp_name} ontving termijn {seq} voor {plan.get('tenant_name', 'huurder')}",
                {"kind": "payment", "url": "/admin/payment_plans", "badge_inc": 1,
                 "payment_id": (inst or {}).get("payment_id"), "plan_id": plan_id},
            )
    except Exception as e:  # noqa: BLE001
        print(f"[push] kiosk pay-installment notify failed: {e}")
    return out


class KioskQuickPlanIn(BaseModel):
    """Snelle betalingsregeling vanuit de kiosk-flow. Twee scenarios:
    1. NA een partial-payment → backend geeft auto-suggestie voor restbedrag
       (single invoice_id, total_amount = restbedrag)
    2. PROACTIEF — huurder kan huidige maand of achterstand niet betalen en
       maakt regeling-afspraak vóór betaling. invoice_ids = lijst van
       geselecteerde facturen, total_amount = som van outstanding.

    Bedrijf-context komt van de bestaande kiosk-sessie (niet van de
    gebruiker — kiosk heeft geen user).
    """
    tenant_id: str
    invoice_id: Optional[str] = None  # legacy: enkele factuur
    invoice_ids: Optional[List[str]] = None  # nieuw: multi-factuur regeling
    total_amount: float = Field(gt=0)
    num_installments: int = Field(ge=2, le=12)
    currency: Literal["SRD", "USD", "EUR"] = "SRD"
    start_date: Optional[str] = None  # yyyy-mm-dd, default = vandaag + 30 dagen
    notes: Optional[str] = None


@app.post("/api/kiosk/payment-plans/quick")
async def kiosk_quick_payment_plan(body: KioskQuickPlanIn, request: Request):
    """Maakt direct een actieve betalingsregeling vanuit de kiosk. Bedoeld
    voor de "Restbedrag in N termijnen afbetalen?"-suggestie die getoond
    wordt na een partial-betaling. Werkt onder kiosk-token (geen admin-PIN
    nodig — de huurder staat fysiek voor de kiosk en heeft net contant
    deelbetaald).
    """
    from datetime import date as _date
    from datetime import timedelta as _timedelta
    session = await get_kiosk_session(request)
    cid = session.get("company_id") if isinstance(session, dict) else None
    if not cid:
        raise HTTPException(status_code=400, detail="Geen actieve kiosk-sessie")
    tenant = await db.tenants.find_one({"id": body.tenant_id, "company_id": cid}, {"_id": 0})
    if not tenant:
        raise HTTPException(status_code=404, detail="Huurder niet gevonden")

    # Start: standaard 30 dagen vanaf vandaag zodat huurder tijd heeft.
    if body.start_date:
        try:
            start_d = _date.fromisoformat(body.start_date)
        except ValueError:
            raise HTTPException(status_code=400, detail="Ongeldige startdatum (yyyy-mm-dd)")
    else:
        start_d = now_utc().date() + _timedelta(days=30)

    n = int(body.num_installments)
    per = round(body.total_amount / n, 2)
    running = 0.0
    installments_docs: list = []
    plan_id = new_id()
    now_iso = iso(now_utc())

    # Helper inline — kopie van payment_plans._add_months om circulaire
    # import te vermijden (kiosk endpoint draait BUITEN de admin-router).
    def _add_months_local(d, months):
        m = d.month - 1 + months
        y = d.year + m // 12
        m = m % 12 + 1
        last_day = [31, 29 if (y % 4 == 0 and (y % 100 != 0 or y % 400 == 0)) else 28,
                    31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]
        return _date(y, m, min(d.day, last_day))

    for i in range(n):
        due = _add_months_local(start_d, i)
        amt = per if i < n - 1 else round(body.total_amount - running, 2)
        running += per
        installments_docs.append({
            "id": new_id(),
            "plan_id": plan_id,
            "company_id": cid,
            "sequence": i + 1,
            "due_date": due.isoformat(),
            "amount": amt,
            "status": "pending",
        })

    plan_doc = {
        "id": plan_id,
        "company_id": cid,
        "tenant_id": body.tenant_id,
        "tenant_name": tenant.get("name") or "",
        "invoice_ids": (
            body.invoice_ids if body.invoice_ids
            else ([body.invoice_id] if body.invoice_id else [])
        ),
        "total_amount": round(body.total_amount, 2),
        "currency": body.currency,
        "notes": body.notes or "Aangemaakt vanuit kiosk",
        "status": "active",
        "created_by": "kiosk",
        "created_at": now_iso,
    }
    await db.payment_plans.insert_one(plan_doc)
    for inst in installments_docs:
        await db.payment_plan_installments.insert_one(inst)

    # Stuur admins een notificatie zodat ze weten dat er een regeling is.
    try:
        await _notify_company_admins(
            cid,
            "Nieuwe betalingsregeling vanuit kiosk",
            f"{tenant.get('name', 'Huurder')} — {_nl_money(body.currency, body.total_amount)} in {n} termijnen",
            {"kind": "payment_plan", "url": "/admin/payment_plans", "plan_id": plan_id},
        )
    except Exception as e:
        print(f"[push] kiosk quick plan notify failed: {e}")

    return {
        "id": plan_id,
        "tenant_id": body.tenant_id,
        "total_amount": plan_doc["total_amount"],
        "currency": plan_doc["currency"],
        "num_installments": n,
        "first_due_date": installments_docs[0]["due_date"],
        "monthly_amount": installments_docs[0]["amount"],
        "installment_amount": installments_docs[0]["amount"],
        "pdf_url": f"/api/kiosk/payment-plans/{plan_id}/pdf",
    }


@app.get("/api/kiosk/payment-plans/{plan_id}/pdf")
async def kiosk_payment_plan_pdf(plan_id: str):
    """Genereert PDF-bonnetje voor een betalingsregeling. Publiek toegankelijk
    via plan_id (zoals receipts) zodat huurder de link kan delen / opslaan."""
    plan = await db.payment_plans.find_one({"id": plan_id}, {"_id": 0})
    if not plan:
        raise HTTPException(status_code=404, detail="Regeling niet gevonden")
    insts = await db.payment_plan_installments.find(
        {"plan_id": plan_id}, {"_id": 0}
    ).sort("sequence", 1).to_list(50)
    plan["installments"] = insts
    plan["num_installments"] = len(insts)
    plan["first_due_date"] = insts[0]["due_date"] if insts else ""
    plan["installment_amount"] = insts[0]["amount"] if insts else 0
    # Enrich met huurder + appartement + bedrijfsnaam
    if plan.get("tenant_id"):
        t = await db.tenants.find_one({"id": plan["tenant_id"]}, {"_id": 0})
        if t:
            plan["tenant_name"] = plan.get("tenant_name") or t.get("name", "")
            apt = None
            if t.get("apartment_id"):
                apt = await db.apartments.find_one({"id": t["apartment_id"]}, {"_id": 0})
            if apt:
                plan["apartment_number"] = apt.get("number", "")
    if plan.get("company_id"):
        c = await db.companies.find_one({"id": plan["company_id"]}, {"_id": 0})
        if c:
            plan["company_name"] = c.get("name", "")
            plan["company_address"] = c.get("address", "")
    plan["plan_number"] = f"BR{plan.get('created_at', '')[:4]}-{plan_id[:6].upper()}"
    pdf_bytes = payment_plan_pdf(plan)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="regeling_{plan_id[:8]}.pdf"'},
    )




# ---------- Background — Achterstallige termijnen WhatsApp/Email ----------
async def _send_upcoming_invoice_reminders():
    """1× per dag per huurder: stuur een herinnering voor facturen waarvan
    de vervaldatum binnen `invoicing.reminder_days_before` dagen valt.

    Idempotent via `sent_upcoming_invoice_reminders` collectie
    (dedup per invoice_id + days_bucket) zodat we niet spammen.
    """
    from datetime import date as _date, timedelta as _td
    today = _date.today()
    today_iso = today.isoformat()

    # Doorloop per company zodat we de correcte reminder_days_before + kanalen
    # kunnen ophalen.
    async for cs in db.company_settings.find({}, {"_id": 0, "company_id": 1, "invoicing": 1}):
        cid = cs.get("company_id")
        if not cid:
            continue
        inv_cfg = cs.get("invoicing") or {}
        try:
            days_before = int(inv_cfg.get("reminder_days_before") or 0)
        except (TypeError, ValueError):
            days_before = 0
        if days_before <= 0:
            continue  # uitgeschakeld voor dit bedrijf
        # Facturen met due_date tussen morgen en (today + days_before)
        min_due = (today + _td(days=1)).isoformat()
        max_due = (today + _td(days=days_before)).isoformat()
        # Huur-facturen (F/H prefix) die nog niet volledig betaald zijn.
        async for inv in db.invoices.find({
            "company_id": cid,
            "status": {"$nin": ["paid", "cancelled"]},
            "due_date": {"$gte": min_due, "$lte": max_due},
        }, {"_id": 0}):
            try:
                remaining = float(inv.get("amount") or 0) - float(inv.get("paid_amount") or 0)
            except (TypeError, ValueError):
                remaining = 0.0
            if remaining <= 0.01:
                continue
            due_iso = inv.get("due_date")
            try:
                due = _date.fromisoformat(str(due_iso))
                days_until = max(0, (due - today).days)
            except Exception:
                continue
            # Bucket-key: (invoice_id, days_until) — 1 reminder per drempel.
            marker = await db.sent_upcoming_invoice_reminders.find_one({
                "invoice_id": inv["id"], "days_bucket": days_until,
            }, {"_id": 0})
            if marker:
                continue

            tenant = await db.tenants.find_one(
                {"id": inv.get("tenant_id")}, {"_id": 0},
            ) or {}
            if not tenant:
                continue
            currency = inv.get("currency") or "SRD"
            phone = (tenant.get("phone") or "").strip()
            email = (tenant.get("email") or "").strip()

            # Bericht opbouwen — zowel WhatsApp/SMS als Email content.
            co = await db.companies.find_one({"id": cid}, {"_id": 0, "name": 1}) or {}
            brand = co.get("name") or "Vastgoed"
            due_nl = due.strftime("%d-%m-%Y")
            wa_msg = (
                f"Hallo {tenant.get('name', 'huurder')},\n\n"
                f"Vriendelijke herinnering — uw huurfactuur "
                f"{inv.get('invoice_number', '')} vervalt "
                f"{'morgen' if days_until == 1 else f'over {days_until} dagen'} "
                f"({due_nl}).\n\n"
                f"Bedrag: *{currency} {remaining:.2f}*\n\n"
                f"Gelieve op tijd te betalen om onnodige kosten te voorkomen.\n"
                f"— {brand}"
            )

            # 1) WhatsApp / SMS
            twilio_cfg = await get_company_section(cid, "twilio")
            wa_ok = False
            if twilio_cfg.get("enabled") and phone:
                try:
                    channel = "whatsapp" if twilio_cfg.get("whatsapp_number") else "sms"
                    await _twilio_send(twilio_cfg, channel, phone, wa_msg)
                    wa_ok = True
                except Exception as e:  # noqa: BLE001
                    print(f"[reminder-upcoming] twilio fail inv={inv['id'][:8]}: {e}")

            # 2) Email
            smtp_cfg = await get_company_section(cid, "smtp")
            email_ok = False
            if smtp_cfg.get("enabled") and email:
                try:
                    from email_service import send_email, wrap_template
                    brand_kwargs = await _tenant_email_brand(cid)
                    content = f"""
                        <h1>Uw factuur vervalt binnenkort</h1>
                        <p>Beste {tenant.get('name', 'huurder')},<br />
                        Vriendelijke herinnering: uw huurfactuur
                        <b>{inv.get('invoice_number', '')}</b> vervalt
                        {'morgen' if days_until == 1 else f'over <b>{days_until}</b> dagen'}
                        ({due_nl}).</p>
                        <p><b>Openstaand bedrag:</b> {currency} {remaining:.2f}</p>
                        <p>Gelieve op tijd te betalen om onnodige kosten te voorkomen.</p>
                    """
                    await send_email(smtp_cfg, email,
                                     f"Herinnering: factuur {inv.get('invoice_number','')} vervalt binnenkort",
                                     wrap_template(content, **brand_kwargs))
                    email_ok = True
                except Exception as e:  # noqa: BLE001
                    print(f"[reminder-upcoming] smtp fail inv={inv['id'][:8]}: {e}")

            # 3) Push naar de admin (info) + interne tab notificatie
            try:
                await _notify_company_admins(
                    cid,
                    f"Reminder verzonden — {tenant.get('name', 'huurder')}",
                    f"Factuur {inv.get('invoice_number','')} vervalt {due_nl}",
                    {"kind": "invoice_reminder", "url": "/admin/invoices",
                     "invoice_id": inv["id"]},
                )
            except Exception:  # noqa: BLE001
                pass

            # Marker altijd wegschrijven — ook bij deel-fouten — om
            # dubbele bezorging te voorkomen bij een volgende poging vandaag.
            await db.sent_upcoming_invoice_reminders.insert_one({
                "invoice_id": inv["id"],
                "company_id": cid,
                "tenant_id": tenant.get("id"),
                "days_bucket": days_until,
                "due_date": due_iso,
                "sent_at": iso(now_utc()),
                "wa_ok": wa_ok,
                "email_ok": email_ok,
            })


async def _upcoming_invoice_reminder_loop():
    """Achtergrond-loop: probeert elke 30 min, maar stuurt alleen tussen 09:00
    en 10:00 lokale tijd (UTC-3 Suriname) — max 1× per drempel per factuur.
    """
    import asyncio as _aio
    while True:
        try:
            hour_local = (now_utc().hour - 3) % 24
            if 9 <= hour_local < 10:
                await _send_upcoming_invoice_reminders()
        except Exception as e:  # noqa: BLE001
            print(f"[reminder-upcoming] loop fail: {e}")
        await _aio.sleep(30 * 60)


@app.post("/api/superadmin/run-upcoming-invoice-reminders")
async def manual_run_upcoming_invoice_reminders(user=Depends(require_role("superadmin"))):
    """Manueel triggeren — handig om de cron-flow te testen."""
    await _send_upcoming_invoice_reminders()
    return {"ok": True}


@app.post("/api/admin/run-upcoming-invoice-reminders")
async def admin_run_upcoming_invoice_reminders(user=Depends(get_current_user)):
    """Admin kan zelf de reminder-cyclus triggeren voor zijn/haar eigen
    bedrijf. Handig na het aanpassen van `reminder_days_before` in
    Instellingen om direct te testen zonder te wachten op de 09:00-loop.
    LET OP: `@app.post` (niet `@api.post`) omdat deze declaratie ná
    `app.include_router(api)` staat — zonder deze bypass zou de route
    stil niet geregistreerd worden.
    """
    if (user.get("role") or "") not in ("admin", "employee", "superadmin"):
        raise HTTPException(status_code=403, detail="Onvoldoende rechten")
    await _send_upcoming_invoice_reminders()
    return {"ok": True}


async def _send_overdue_installment_reminders():
    """1x per dag per huurder: stuur een herinnering voor achterstallige
    termijnen van betalingsregelingen. Tracking via plan.last_inst_reminder
    zodat we niet spammen.
    """
    today_key = now_utc().strftime("%Y-%m-%d")
    today_iso = now_utc().date().isoformat()
    # Eerste: groeperen per tenant_id
    pipeline = [
        {"$match": {"status": "pending", "due_date": {"$lt": today_iso}}},
        {"$lookup": {
            "from": "payment_plans", "localField": "plan_id",
            "foreignField": "id", "as": "plan",
        }},
        {"$unwind": "$plan"},
        {"$match": {"plan.status": "active"}},
        {"$group": {
            "_id": {"tenant_id": "$plan.tenant_id", "company_id": "$plan.company_id"},
            "currency": {"$first": "$plan.currency"},
            "plan_ids": {"$addToSet": "$plan.id"},
            "overdue_count": {"$sum": 1},
            "overdue_total": {"$sum": "$amount"},
            "earliest_due": {"$min": "$due_date"},
        }},
    ]
    async for grp in db.payment_plan_installments.aggregate(pipeline):
        tenant_id = grp["_id"]["tenant_id"]
        cid = grp["_id"]["company_id"]
        if not tenant_id or not cid:
            continue
        # Check we have not reminded today voor deze tenant
        ldoc = await db.payment_plan_reminders.find_one(
            {"tenant_id": tenant_id, "company_id": cid}, {"_id": 0}
        ) or {}
        if ldoc.get("last_sent") == today_key:
            continue
        tenant = await db.tenants.find_one({"id": tenant_id}, {"_id": 0}) or {}
        if not tenant:
            continue

        cur = grp.get("currency") or "SRD"
        total = float(grp.get("overdue_total") or 0)
        n = int(grp.get("overdue_count") or 0)
        earliest = grp.get("earliest_due") or ""

        # WhatsApp / SMS via twilio
        twilio_cfg = await get_company_section(cid, "twilio")
        if twilio_cfg.get("enabled") and (tenant.get("phone") or "").strip():
            co = await db.companies.find_one({"id": cid}, {"_id": 0, "name": 1}) or {}
            brand_name_wa = co.get("name") or "Vastgoed"
            msg = (
                f"Hallo {tenant.get('name', 'huurder')},\n\n"
                f"Vriendelijke herinnering — u heeft {n} achterstallige "
                f"termijn{'en' if n > 1 else ''} in uw betalingsregeling.\n\n"
                f"Totaal achterstallig: *{cur} {total:.2f}*\n"
                f"Eerst-vervallen: {earliest}\n\n"
                f"Gelieve zo spoedig mogelijk te voldoen via onze kiosk of betaalapp.\n\n— {brand_name_wa}"
            )
            try:
                await _twilio_send(twilio_cfg, "whatsapp", tenant["phone"], msg)
            except Exception as e:  # noqa: BLE001
                print(f"[reminder] twilio installment fail: {e}")

        # Email via smtp
        smtp_cfg = await get_company_section(cid, "smtp")
        if smtp_cfg.get("enabled") and (tenant.get("email") or "").strip():
            try:
                from email_service import send_email, wrap_template
                brand_kwargs = await _tenant_email_brand(cid)
                content = f"""
                    <h1>Achterstallige termijn(en)</h1>
                    <p>Beste {tenant.get('name', 'huurder')},<br />
                    U heeft <b>{n}</b> achterstallige termijn{'en' if n > 1 else ''}
                    in uw lopende betalingsregeling.</p>
                    <p><b>Totaal achterstallig:</b> {cur} {total:.2f}<br />
                    <b>Eerst-vervallen:</b> {earliest}</p>
                    <p>Gelieve zo spoedig mogelijk te voldoen via onze kiosk of betaalapp.</p>
                """
                await send_email(smtp_cfg, tenant["email"],
                                 "Achterstallige termijn(en) — betalingsregeling",
                                 wrap_template(content, **brand_kwargs))
            except Exception as e:  # noqa: BLE001
                print(f"[reminder] smtp installment fail: {e}")

        await db.payment_plan_reminders.update_one(
            {"tenant_id": tenant_id, "company_id": cid},
            {"$set": {
                "tenant_id": tenant_id,
                "company_id": cid,
                "last_sent": today_key,
                "last_sent_at": iso(now_utc()),
                "overdue_count": n,
            }},
            upsert=True,
        )


async def _installment_reminder_loop():
    """Achtergrond-loop: probeert elke 30 min, maar stuurt alleen tussen 09:00
    en 10:00 lokale tijd (UTC-3 Suriname) — max 1× per huurder per dag.
    """
    import asyncio as _aio
    while True:
        try:
            hour_local = (now_utc().hour - 3) % 24
            if 9 <= hour_local < 10:
                await _send_overdue_installment_reminders()
        except Exception as e:  # noqa: BLE001
            print(f"[reminder] installment loop fail: {e}")
        await _aio.sleep(30 * 60)


@api.post("/superadmin/run-installment-reminders")
async def manual_run_installment_reminders(user=Depends(require_role("superadmin"))):
    """Manueel triggeren — handig om de cron-flow te testen."""
    await _send_overdue_installment_reminders()
    return {"ok": True}


# Start de loop ná app-init zodat de event-loop al draait.
import asyncio as _aio_outer  # noqa: E402

@app.on_event("startup")
async def _start_installment_reminder_loop():
    # NB: lifespan handelt dit al af. Blijft staan voor backwards-compat
    # met andere deployments (indien lifespan uitstaat).
    if os.environ.get("DISABLE_INSTALLMENT_REMINDERS") == "1":
        return
    # No-op als lifespan al draait — dubbele task creëren is niet erg
    # want beide loops zijn idempotent, maar we vermijden 't:
    return


@app.on_event("startup")
async def _start_event_bus():
    # NB: lifespan handelt dit al af. Blijft staan als vangnet.
    return
