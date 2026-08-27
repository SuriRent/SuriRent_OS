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
- **AI-gecropte pasfoto's als huurder-avatar (2026-02-27)**: Bij ID-kaart upload (of via handmatige backfill) detecteert Gemini 2.5 Flash de pasfoto op de ID-kaart, geeft normalized bbox terug, en PIL crop + WebP-encoded (256×256) resultaat wordt als nieuw `landing_asset` opgeslagen en gekoppeld aan `tenant.avatar_url`. Nieuwe endpoints in `server.py`: `_extract_face_avatar_from_bytes()` (helper), `POST /tenants/{id}/generate-avatar` (single re-generate), `POST /tenants/backfill-avatars` (bulk voor alle huurders in company met id_photo_url maar zonder avatar_url). Auto-trigger na upload in bestaande `POST /tenants/{id}/id-photo`. `TenantOut` model uitgebreid met `avatar_url`. Frontend `TenantRow` + `TenantDetail` in `AdminDashboard.jsx` tonen `<img src={avatar_url}>` i.p.v. initials wanneer beschikbaar; anders fallback. Oranje "Genereer nu" banner op Huurders-lijst verschijnt zodra er huurders zijn met een ID-kaart maar zonder avatar.
- **Zoekbalk opent direct detail-view (2026-02-27)**: `GlobalSearch.go(tab, focus)` in `AdminDashboard.jsx` dispatcht nu een `focus-entity` event met `{type, id, tenant_id}` na de tabwissel. `Apartments`, `Tenants` en `Invoices` componenten luisteren erop en zetten hun `detailId` / `detail`-state, waardoor bij een klik op "HUIS 2C" (of een huurder of factuur) direct de detailpagina opent i.p.v. de hele lijst. Getest e2e via Playwright: typ "HUIS 2C" → klik resultaat → detail-view van dat appartement opent onmiddellijk.
- **Autoplay-unlock voor TTS (2026-02-27)**: Browsers (Chrome/Safari/iOS) blokkeren `audio.play()` na langere network-latency (Whisper+chat+TTS ≈3-5s) omdat de "user gesture" is verlopen. Nu: (1) `unlockAudio()` speelt bij elke user-tap (mic/telefoon/tts-toggle/verstuur) een geluidloos 0.1s-MP3 af binnen het gesture-venster → autoplay is ontgrendeld voor de rest van de sessie. (2) Fallback: als een `audio.play()` toch nog rejected wordt met `NotAllowedError`, wordt de blob-URL opgeslagen en verschijnt een prominente oranje knop "Tik hier om het antwoord te horen" boven de input. Bij tik: audio speelt af en de gesprek-modus loop hervat via `startRecordingRef` (TDZ-safe). Fix voor "assistent praat niet terug, schrijft alleen" op productie.
- **Gesprek-modus + live interim transcriptie (2026-02-27)**: `AssistantPage.jsx` heeft nu drie voice-verbeteringen:
  1. **Live preview tekst** via Web Speech API (`SpeechRecognition`, `lang=nl-NL`, `interimResults=true`) — je ziet je woorden real-time terwijl je spreekt. Op stop vervangt Whisper's transcriptie de preview voor accuraatheid (hybride optie A).
  2. **Gesprek-modus** — nieuwe Phone/PhoneOff-knop in de header. Als actief:
     - Web Audio API `AnalyserNode` monitort mic-volume (RMS-threshold 8/128, 60Hz tick)
     - Auto-stop na 1,5s stilte (met min. 0,7s gesproken); veiligheidsplafond 60s
     - Auto-verzend naar `/chat` → speel reply af via TTS → herstart luisteren na `audio.onended`
     - Feedback-loop voorkomen: mic-knop disabled tijdens `speaking`, TTS pause bij nieuwe opname-start
  3. **Statusbanner** boven input toont staat: "Luistert…", "Denkt na…", "Assistent praat…", "Gesprek-modus actief", plus de live interim-tekst tijdens spreken
- **AI-Assistent voice I/O via Emergent-managed models (2026-02-27)**: Volledige spraakfunctionaliteit toegevoegd. Backend endpoints `POST /api/assistant/stt` (Whisper-1 via `OpenAISpeechToText` uit `emergentintegrations`, language=nl) en `POST /api/assistant/tts` (`OpenAITextToSpeech` model `tts-1`, voice `nova`, mp3-response) — beide beveiligd met dezelfde `_has_ai_access` check als `/chat`. Frontend `AssistantPage.jsx` gebruikt nu `MediaRecorder` + `getUserMedia` i.p.v. de browser-native Web Speech API — werkt in Chrome/Safari/Edge/Firefox. Elk assistant-antwoord wordt automatisch uitgesproken (persistent toggle in header `Volume2/VolumeX`, opgeslagen in `localStorage.assistant_tts_on`). Text wordt server-side gesanitized voor TTS (emoji/markdown/URL-strip). Getest end-to-end: TTS "Hallo, dit is een test..." → 41KB MP3 → Whisper transcribeert perfect terug naar Nederlands.
- **Betalingen defensive backfill (2026-02-27)**: `_enrich_payment` + `_enrich_payments_bulk` in `server.py` vullen nu missende verplichte `PaymentOut`-velden (`receipt_number`, `paid_at`) aan met veilige defaults (`KW-LEGACY-<id8>` + `created_at`/`approved_at`) en loggen een waarschuwing. Voorkomt dat één corrupt legacy-doc de hele `/api/payments` response met een `ResponseValidationError` naar 500 laat crashen. Production-blocker opgelost voor Gopi Appartements (`e485dfb7...`) — deployer RCA `RCA_ffcad93d` bevestigde 1 corrupt doc `6fdf15f2-4a61-45a3-bc80-8889fbd7f6e4` dat 24 gezonde betalingen onzichtbaar maakte. Getest op preview met bewust corrupt insert → 200 OK, doc verschijnt met legacy-receipt.
- **AI-Assistent payment pipeline fix (2026-02-27)**: P0 crash op `/api/payments` verholpen. `register_payment` in `ai_assistant.py` bypasste voorheen `_create_payment_doc` en insertte een raw dict zonder `receipt_number` → `PaymentOut` Pydantic-validatie faalde bij GET → 500 op admin dashboard. Nu wordt de reguliere pipeline gebruikt (via `PaymentIn` + `_create_payment_doc`) zodat receipt_number, invoice-auto-linking, allocaties, credit-remainder en admin-notificaties allemaal correct werken. AI-registraties krijgen `source: "ai_assistant"` markering voor audit. 1 corrupt legacy-doc uit MongoDB verwijderd. E2E getest via curl: AI → registreert → doc krijgt `KW2026-00451` + invoice `D2026-00106` → verschijnt bovenaan admin dashboard.
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
