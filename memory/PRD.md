# SuriRent — Multi-Company Vastgoed SaaS

## Original Problem Statement
Extract Vastgoed (Real Estate) + KIOSK functionaliteit uit legacy ERP en herbouw als multi-company SaaS platform met dual-domain architectuur (marketing landing + Kiosk/Admin/Tenant portal op subdomain), multi-tenant data-isolatie, SaaS superadmin billing, pixel-perfect kiosk-UI, PWA optimalisaties en hardware-integraties (Shelly smart breakers).

## Tech Stack
- **Frontend**: React 19 + SWR + Tailwind + Shadcn UI
- **Backend**: FastAPI + Motor (async MongoDB) + PyMuPDF + jwt
- **Auth**: Emergent Google Auth (session_token cookie) + JWT (access_token/kiosk_token/tenant_token cookies)
- **Real-time**: Server-Sent Events (`/api/admin/events`) → SWR globalMutate + `surirent:live-change` events
- **PWA**: Service Worker + Web Push (VAPID) voor pending-payment pings

## Latest Fix (2026-02-XX) — Live-sync Betalingen
Wanneer huurder een betaling doet via tenant-portal moet Admin > Betalingen live updaten zonder refresh. Drie bugs gefixt:
1. `_notify_company_admins()` in `server.py` — SSE broadcast miste als er geen push-subs waren. Verplaatst `_sse_broadcast()` naar vóór de early-return.
2. `_live_sync_broadcast` middleware decodeerde alleen admin `access_token`. Tenant-portal betalingen (via `tenant_token`) hadden geen `company_id` in JWT-payload → geen broadcast. Nu resolvet middleware `company_id` via `db.tenants` lookup.
3. `AdminDashboard.jsx` SSE-effect las verkeerde localStorage key (`token` i.p.v. `admin_token`) → EventSource-connectie werd nooit opgezet. Nu correct + `withCredentials:true` voor cookie-auth fallback.

## Architecture
```
/app/
├── backend/
│   ├── server.py               # Core FastAPI (~14k lines) — refactor pending
│   ├── models.py               # Pydantic v2 models
│   ├── auth_utils.py           # JWT + cookie helpers + extract_token
│   ├── pdf_gen.py              # PDF invoice + PyMuPDF JPG conversion
│   └── routes/                 # (empty — modularization pending)
├── frontend/
│   ├── scripts/inline-landing-content.js  # Postbuild HTML injection
│   └── src/
│       ├── lib/swr.js          # SWR helpers + prefetching
│       ├── lib/admin-events.js # useAdminEvents hook (SSE listener)
│       ├── lib/live-pulse.js   # Sidebar pulse indicator
│       └── pages/vastgoed/
│           ├── AdminDashboard.jsx  # Global SSE handler + SWR prefetch
│           └── admin/Payments.jsx  # useAdminEvents subscriber
```

## Completed
- **Full removal Mope/Uni5Pay/SumUp betaalproviders (2026-02)**: Alle online-gateway integraties uit backend + frontend gestripped:
  - **DB migratie**: bestaande records met `method in {mope,sumup,uni5pay}` → `bank`; `mope_account`/`uni5pay_account` velden op companies weg; `saas_settings.mope/sumup` weg.
  - **Backend**: `PaymentIn.method`/`TenantPaymentIn.method`/`CustomerMethodIn.method`/plan-installment methods gereduceerd tot `Literal["contant","bank"]`. Endpoints verwijderd: `/kiosk/mope/create-qr`, `/integrations/mope/webhook`, `/admin/integrations/mope`, `/public/customer-display/{slug}/mope-confirm`, `/webhooks/mope-saas`, `/webhooks/sumup-saas`, `/billing/me/checkout` (nu 410), `/api/payments/mock-pay/{ref}` (uni5pay mock page). `payments_service.py` bestand verwijderd. SaaS-settings + company-settings sections `mope`+`uni5pay` verwijderd.
  - **Frontend**: MijnAbonnement OnlinePayBox weg, SaasSettings Mope+SumUp secties weg, SetupWizard steps weg, BusinessInfo mobile-wallet sectie weg, Settings.jsx PaymentGatewayForm weg, InstellingenHub integratie-ids opgeschoond, TenantKioskLayout `TenantPayMobile` component + `pay-mobile` view + mope/uni5pay branches weg, KioskLayout Uni5Pay QR flow (`isUni5Pay`, `waitingPaid`, useEffects) weg, CustomerDisplay Uni5Pay tegel + QR fallback weg, Payments/Subscriptions/QuickPay/CreditSources methode-lijsten en labels gereduceerd tot contant + bank, MOPÉ/UNI5PAY marketing footer logos vervangen door tekst "Contant · Bankoverschrijving". `/public/payment-logos/` map verwijderd.
  - **E2E tests via curl**: `method=mope`/`uni5pay` retourneren nu 422 met literal_error; `method=bank` gaat voorbij validatie; superadmin/settings bevat geen mope/sumup keys meer.
- **Google Auth cross-account bleed fix (2026-02)**: Kritieke security fix. `/api/auth/logout` wist nu ALLE auth-cookies incl. `session_token` (Emergent Google) + verwijdert de bijbehorende rij uit `user_sessions`. Nieuwe helper `_invalidate_prior_sessions()` wordt aangeroepen door `/auth/login`, `/auth/register` én `/auth/google/callback` zodat een fresh login op een gedeeld apparaat ALTIJD eerder achtergelaten sessies (van gebruiker A) invalideert vóór het nieuwe token wordt gezet.
- **Direct-login demo + marketing logout redirect (2026-02)**: "Bekijk de demo" navigeert nu zonder login-flash naar `/admin` (AuthProvider `refresh()` vóór SPA-navigate op hybrid; hard-nav op cross-domain productie). `doLogout()` in AdminDashboard stuurt zowel demo- als echte gebruikers direct naar `publicMarketingUrl()` (marketing landing) i.p.v. `/login`.
- **Marketing footer payment logos (2026-02)**: MOPÉ + UNI5PAY logos toegevoegd naast copyright. Getrimd (transparente padding verwijderd) en opgeslagen als WebP in `/app/frontend/public/payment-logos/`.
- SSE live-sync (fix: broadcasts nu ook zonder push-subs, en voor tenant-portal mutaties)
- SWR caching + background prefetch (`requestIdleCallback`)
- Emergent Google Auth met needs_onboarding modal
- Unified desktop/mobile registration wizard
- Custom domain settings + SSL auto-detect (Cloudflare/Vercel/Nginx)
- WhatsApp/SMS invoice reminders met inline JPG previews (PyMuPDF)
- Natural sorting op `apartment_number` (HUIS 1A, HUIS 2B, ...)
- "HUIS X — Naam" formaat in alle Kies-huurder dropdowns
- Marketing landing content geïnlined in `build/index.html` (zero-fetch paint)

## Backlog

### P1 — Security & Tech Debt
- **`localStorage` → `httpOnly` cookies migratie** (recurring 14×). Email/Pin login slaan JWT nog in localStorage op (XSS-risico). Audit: `PinLogin.jsx`, `EmailLogin.jsx`, `LoginPage.jsx`.
- **Marketing images op productie**: 9 image-IDs missen in `landing_assets`. User moet handmatig uploaden via Admin Landing Editor.

### P2 — Refactor & UX
- `server.py` opsplitsen (~14k lines) naar `/app/backend/routes/`
- Consolideer `RESERVED_SLUGS` (`BrandedShell.RESERVED_TOP_PATHS` + `branded-nav.js`)
- React hook exhaustive-deps warnings (KioskLayout, EmailLogin, Subscriptions)
- Superadmin Settings redesign (card-based layout)

### P3 — Features
- Shelly Smart Breakers hardware-integratie
- AI-generated fysieke QR plaques (auto-print)

## 3rd Party Integrations
- **Twilio** (WhatsApp/SMS) — user API key
- **SMTP Email** — user API key
- **Uni5Pay** (Payments, MOCKED) — user API key
- **Gemini 2.5 Flash** (OCR bankafschriften) — Emergent LLM key
- **Google Auth** — Emergent integrations

## Environments
- **Preview**: dit pod (dev, hot-reload)
- **Productie**: https://www.surirent.sr

## Key API Endpoints
- `POST /api/tenant-portal/payments` — huurder registreert betaling → SSE broadcast naar company admins
- `GET /api/admin/events` — SSE stream (auth via cookie of `?token=`)
- `GET /api/invoices/{id}/pdf/jpg` — inline WhatsApp preview
- `POST /api/companies/me/onboarding` — post Google-login slug/naam
