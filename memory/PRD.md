# SuriRent — Multi-Company Vastgoed SaaS


## Latest Feature (2026-02-12) — Historische Facturen (Onboarding Achterstanden)
Nieuwe endpoint `POST /api/invoices/historical` waarmee beheerders bij onboarding een historische factuur kunnen aanmaken met:
- Vrij bedrag (`amount > 0`) + valuta (default = valuta van appartement)
- Vrije datum in het verleden (`YYYY-MM-DD`, geen future dates)
- Vrije omschrijving (1-200 karakters, zichtbaar in overzicht)

De factuur krijgt `is_historical: true`, invoice-number prefix `H{year}-` en telt gewoon mee in het openstaand saldo van de huurder. Duplicate-check op (tenant, period) is bewust gedrophed voor historische zodat meerdere entries per maand mogen (bv. "borg", "achterstand", "reparatiekost"). Frontend: `InvoiceForm.jsx` heeft nu een segmented toggle "Nieuwe factuur / Historische achterstand". In `InvoiceRow.jsx` + `MobileInvoiceLine` verschijnt een violet "Historisch"-badge + de omschrijving eronder.

Backend regressietests: `/app/backend/tests/test_historical_invoice.py` (5 tests: create + reject-future + reject-zero + reject-invalid-date + allow-multiple-per-period, allemaal groen).


## Latest Fix (2026-02-12) — QuickPay: methode-toggle verwijderd
Op verzoek van gebruiker is de Contant/Bankoverschrijving-toggle in de "Snelle betaling" modal (`/app/frontend/src/pages/vastgoed/admin/invoices/QuickPayModal.jsx`) verwijderd. Snelle registratie loopt nu altijd als `contant`. Bijkomend opgeruimd: ongebruikte `setMethod` state → const, en ontbrekende `FileText` import toegevoegd. `oxlint`-config uitgebreid met `importScripts` en `__non_webpack_require__` globals om pre-completion checks door te laten.

E2E gescreenshot: modal toont uitsluitend Totaal/Betaald/Nog te betalen overzicht, Bedrag met NumPad en Annuleren/Registreer — geen methode-selector meer aanwezig.

## Latest Fix (2026-02-08) — Realtime Live-sync over ALLE admin modules
Uitbreiding op de bestaande SSE (`_live_sync_broadcast` middleware + `/api/admin/events` stream). Vijf admin-facing pages die tot dusver direct `api.get()` gebruikten (zonder SWR of auto-refresh) syncten niet automatisch tussen apparaten. Opgelost door:

1. **`BusinessInfo.jsx`**, **`Branding.jsx`**, **`Settings.jsx`**, **`MijnAbonnement.jsx`**, **`Notifications.jsx`**: `useAutoRefresh(load)` toegevoegd en `setLoading(true)` uit de `load`-functies verwijderd → silent refresh zonder spinner-flikkering.
2. **`Settings.jsx > useSection()`**: prop→state desync gefixt met `useEffect`-sync op `initial` prop + `dirtyRef` guard zodat actieve invoer van een typende admin niet overschreven wordt door een SSE-refresh.
3. **`AdminDashboard.jsx` prefetch-lijst**: `/setup-status` → `/companies/me/setup-status` (verwijdert 404 uncaught pageerror op elke dashboard-load).

Backend testsuite `/app/backend/tests/test_live_sync_sse.py` + `/app/backend/tests/test_iter57_live_sync_sse.py` bewijzen dat de SSE-broadcast vuurt op alle major CRUD endpoints (branding, profile, tenants, apartments, contracts, invoices, payments, locations PUT, settings smtp/invoicing). E2E playwright verifieert dat BusinessInfo, Branding, SMTP-form, Huurders, Betalingen binnen 3-4s live updaten na externe mutatie zonder page reload.

Bekende openstaande item: Notificaties-tab renderer crashed in headless chromium (pre-existing, ook op HEAD zonder deze wijziging — niet veroorzaakt door live-sync).

## Latest Fix (2026-02-08) — P0 Blank Overzicht Pagina op Productie
Root cause: `_classify_invoice_bucket()` in `/app/backend/server.py` crashte met `calendar.IllegalMonthError` als een corrupte factuur (AI-gegenereerde borg-regels) `period_month=0` of `period_year=0` had. Dit caste `/api/admin/stats` → 500, waardoor de Overzicht-pagina permanent bleef laden.

Fixes toegepast:
1. **`_classify_invoice_bucket`** (line ~10545): defensieve int-validatie + range-check (`1≤pm≤12`, `1900≤py≤3000`). Retourneert `"unknown"` bucket voor corrupte data i.p.v. te crashen. Try/except rond `_last_day_of_month + _add_workdays`.
2. **`admin_stats` variable shadowing** (line ~9714): loop-variabele `outstanding = max(...)` overschreef de outer dict `outstanding = {}`. Hernoemd naar `remain`. `outstanding_by_currency` retourneert nu correct een dict per valuta i.p.v. een float.

Getest lokaal met corrupte invoice `{period_month: 0, period_year: 0}` → `/api/admin/stats` geeft HTTP 200 en bucket wordt correct geskipt in overdue/current tellingen.

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

## Latest Fix (2026-02-29) — KeyboardSafeModal (iOS toetsenbord)
Nieuwe universele modal-wrapper `/app/frontend/src/components/KeyboardSafeModal.jsx`:
- Rendert via React `createPortal` in `document.body` (buiten elke parent CSS)
- Hoogte = `window.visualViewport.height` (JS-driven, betrouwbaarder dan CSS `dvh` op iOS)
- Body scroll-lock via `position: fixed`
- Header met `env(safe-area-inset-top)` padding
- Footer met `env(safe-area-inset-bottom)` padding
- Sub-componenten: `.Header` / `.Body` / `.Footer` voor sticky layout
- Viewport meta tag: `interactive-widget=resizes-content`

Toegepast op alle popup-formulieren met input-velden:
- ✅ QuickPayModal (incl. success view)
- ✅ InvoiceForm
- ✅ ReminderModal
- ✅ Payments.jsx (ApproveModal + PaymentForm)
- ✅ AdminDashboard.jsx (ApartmentForm, TenantForm, TenantPinModal)
- ✅ Locations.jsx (LocationForm)
- ✅ Deposits.jsx (DepositForm + RefundForm)
- ✅ Maintenance.jsx (MaintenanceForm)
- ✅ Contracts.jsx (ContractForm)
- ✅ Employees.jsx (EmployeeForm + SalaryForm + KioskPinModal)

Resultaat: op iPhone/Android schuift NIETS meer omhoog wanneer toetsenbord opent.
Header blijft bovenaan, footer-knoppen (Annuleren/Registreer) blijven altijd
zichtbaar direct boven het toetsenbord, alleen body scrollt.


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
- **Betalingen = exacte kopie van Huurders-cards (2026-02-27)**: `PaymentRow` volgt nu 1:1 het TenantRow patroon. Appartement (`HUIS 2C`) is de primaire titel, huurdersnaam als groene emerald-badge ernaast, subtitle `D-KW-nnn · datum`, bedrag rechts. Location-info verwijderd uit de subtitle (was overbodig — is al zichtbaar via appartement-groepering). Categorie- en methode-badges definitief weg. Enige rest-badge: pending_approval (oranje) of rejected (rood). "Ontvangen"-default toont geen badge. Getest op preview mobile: rijen renderen 1-regel-hoog, exact zelfde hoogte als Huurders.
- **PIN-numpad flikker na login opgelost (2026-02-27)**: Na succesvolle PIN-invoer flitste de numpad kort opnieuw voordat de navigatie naar `/admin` doorging — root cause was dat `AuthProvider`'s user-state pas op de VOLGENDE render cycle beschikbaar is nadat `refresh()` compleet is. Fix: nieuwe `authenticating` state in `LoginPage.jsx` gaat op `true` zodra `onPinSuccess()` start; toont dan een oranje huis-splash overlay (identiek design als het PWA-opstartscherm — SVG-huis met pulse + bouncing dots + "INLOGGEN…"-caption) totdat de router-transitie klaar is. Numpad blijft daardoor 100% verborgen tussen success en /admin-mount.
- **PWA splash screen (2026-02-27)**: In `frontend/public/index.html` een CSS/SVG-only splash toegevoegd binnen `<div id="root">` — verschijnt onmiddellijk bij PWA-opstart (nog vóór `bundle.js` geladen is) en wordt automatisch verwijderd wanneer React de eerste render doet. Bevat: oranje SuriRent-huis (Lucide-style SVG met `#FF5C00` stroke + 8% fill), 1.4s pulse-animatie, 3 pulserende oranje dots eronder (loading indicator), en "SURIRENT"-tekst in tracking-wide caps. Warme `#FFF7F0` background matched met brand-color. Geen white flash meer bij PWA-opstart op productie.
- **PWA flikker + registreren-flow fixes (2026-02-27)**: Drie samenhangende issues op de geïnstalleerde PWA gefixt.
  1. **Marketing-flash bij openen**: `index.html` heeft nu een synchrone pre-React redirect: als `display-mode:standalone` én pathname is "/" → `window.location.replace('/login?source=pwa')` VOOR React mount. Geen marketing-glimp meer voordat de login/onboarding laadt.
  2. **"Ik heb een bedrijf" → inloggen**: `handleOnboardingChoice` in `LoginPage.jsx` navigeerde naar `publicMarketingUrl() + '/?register=1'` — op productie is dat een ANDER domein (surirent.sr) → val buiten PWA-scope → break. Nu `setView('register')` → `RegisterModal`/`MobileRegisterWizard` opent DIRECT in-page binnen PWA-scope.
  3. **Onboarding herhaalt na logout**: LoginPage skipt PwaOnboarding wanneer `?loggedout=1` in URL staat. Gebruiker landt direct op login zonder de 3-choice welcome screen te doorlopen.
- **Sticky install-banner + geen "use Chrome"-fallback (2026-02-27)**: Nieuwe `PersistentInstallBanner` bovenaan `MarketingLandingV2` verschijnt zodra `beforeinstallprompt` capturet is (Chrome/Edge/Android) of platform=iOS. Werkt exact als Chrome's eigen "install app"-strip: oranje, dismissible met ✕ (7 dagen cooldown via `localStorage.install_banner_dismissed_at`). Install-logic ge-extracted naar `usePwaInstall()` hook zodat banner + download-sectie dezelfde state delen (installed, deferredPrompt, platform, showIosModal). De storende "Installeer via Chrome of Edge"-fallback-modal is verwijderd — voor niet-iOS zonder gecapture prompt tonen we nu een vriendelijke "open browser-menu → App installeren"-uitleg met tip "blader een paar seconden door de pagina" (Chrome's engagement-heuristic). Banner + section-knop verdwijnen automatisch zodra `appinstalled` event vuurt.
- **Download-de-app sectie op marketing landing (2026-02-27)**: Nieuwe `InstallPwaSection` in `MarketingLandingV2.jsx` net vóór de Footer. Slim gedrag per platform via `navigator.userAgent`-detectie: (1) Desktop Chrome/Edge/Android → capture `beforeinstallprompt` event, native install-prompt bij tik. (2) iOS Safari → uitleg-modal met de "Deel → Zet op beginscherm → Voeg toe"-stappen (iOS ondersteunt geen native prompt). (3) Firefox / desktop Safari → fallback-modal "gebruik Chrome/Edge". (4) `appinstalled` event schakelt de knop naar "App is geïnstalleerd" (groen, disabled). Extra CTA link naar `/assistent` voor de aparte AI-assistent PWA. Auto-label reageert op OS: "Installeer op iPhone / iPad" · "Installeer op Android" · "Installeer op je computer". Rechter-kolom toont 4 benefits (Direct openen · Werkt offline · Push meldingen · Native gevoel). Alle teksten `EditableText` — beheerder kan aanpassen via live-editor.
- **Safari logout spring-back fix (2026-02-27)**: Op Safari kwam de gebruiker na uitloggen weer direct op het admin-dashboard terecht. Root cause: `api.post('/auth/logout')` was fire-and-forget → Safari navigeerde weg voordat de Set-Cookie response was verwerkt → cookie was op de vervolgpagina nog geldig → AuthProvider hield gebruiker "ingelogd" → LoginPage's auto-redirect useEffect stuurde weer naar /admin. Drie-laags fix: (1) `doLogout` in `AdminDashboard.jsx` AWAIT nu de server-logout (max 2.5s timeout via Promise.race) voor de hard-nav. (2) Target-URL krijgt `?loggedout=1` marker. (3) `LoginPage.jsx` skipt de auto-redirect-naar-admin useEffect wanneer `?loggedout=1` in de URL staat, en roept eenmalig `refresh()` aan zodat AuthProvider `/auth/me` opnieuw fetcht — komt terug als 401 → `user=null`. Getest via Playwright: logout → `.../login?loggedout=1` → na 2s wachten nog steeds op login (geen spring-back).
- **AI-Assistent PWA installeert nu correct als aparte app (2026-02-27)**: De initiële `<link rel="manifest">` in `frontend/public/index.html` verwees hard naar `/manifest.json` (main app: `start_url=/login?source=pwa`). Chrome/Safari captured die manifest tijdens de HTML-parse voordat de rol-detectie-JS de href kon swappen naar `/assistent-manifest.json` → installaties vanuit /assistent belandden verkeerd op de main login. Fix: initiële `href=""` zodat browsers nooit `/manifest.json` fetchen; inline rol-detectie zet nu ALTIJD als eerste de correcte manifest (assistent → statisch, beheer/kiosk → `/api/pwa/manifest?role=…&slug=…`). Playwright bevestigt: op `/assistent` staat `link[rel=manifest]` op `/assistent-manifest.json` en title = "SuriRent Assistent"; op `/login` op de branded beheer-manifest en title = "Beheer".
- **Logout-redirect gefixt (2026-02-27)**: `doLogout` in `AdminDashboard.jsx` en `AssistantPage.jsx` stuurde beheerders naar de marketing landing (`publicMarketingUrl()`). Nu gaat elke beheerder-logout naar `/login` op de huidige origin, of naar `/{slug}/login` als er een branded company-slug in `localStorage.pwa_company_slug` staat — zo landen ze direct op de branded PIN-login. Tenants blijven via `TenantKioskLayout.logout()` op hun eigen kiosk-omgeving (view='dashboard', authed=false → PIN-login re-renders). `publicMarketingUrl`-imports opgeruimd uit beide files. Getest via Playwright: login demo → uitloggen → landt op `/my-awesome-rentals-bv/login` met "Beheerder Login" scherm.
- **Branding in 1 blok (2026-02-27)**: 5 losse cards (Logo · Primaire kleur · Naam & tagline · PDF-sjabloon · Verhuurder handtekening) samengevoegd tot één witte card met dunne scheidslijnen. `LandlordSignatureSection` intern van `<div class="bg-white ...">` naar `<section>` gebracht zodat het naadloos in het grote blok past. De live preview (login-mock + email-preview) blijft in de rechterkolom. Tip-banner "Bedrijfsgegevens onder Account" blijft apart als lichte sky-callout bovenaan. Getest via Playwright: `[data-testid="branding-card"]` aanwezig, alle inputs (logo, kleur, naam, tagline, PDF-sjabloon) renderen op volgorde.
- **Bedrijfsgegevens in 1 blok (2026-02-27)**: 3 losse cards (Contact & Adres · Bankrekeningen · Verhuurder) samengevoegd tot één witte card met dunne scheidslijnen tussen de secties. Order per sectie: Contact (naam · e-mail · telefoon · adres · KKF) → Bankrekeningen (SR · NL) → Verhuurder (naam · geboortedatum · ID). Rasters (`md:grid-cols-2` en `md:grid-cols-3`) zorgen dat de velden op desktop naast elkaar staan i.p.v. onder elkaar. Getest via Playwright: single card zichtbaar, alle velden gevuld met demo-data.
- **Setup wizard-tab verwijderd (2026-02-27)**: `setup`-entry uit `InstellingenHub` SECTIONS gehaald op user-verzoek. De wizard blijft functioneel — hij verschijnt automatisch via `SetupWizardSheet` in `AdminDashboard` na registratie zolang `/companies/me/setup-status` aangeeft dat de setup nog niet compleet is. Resterend: 7 top-tabs `['abonnement','bedrijf','branding','smtp','invoicing','kiosk','backup']`.
- **Instellingen-hub opschoning (2026-02-27)**: "Mijn landing"-tab volledig verwijderd uit `InstellingenHub.jsx` en `MijnLanding.jsx`-bestand gedelete (was alleen daar geïmporteerd). Vroegere "Integraties"-tab opgesplitst in drie losse top-tabs: E-mail (SMTP), Facturen automatisering, Kiosk PIN. `SettingsPage` accepteert nu `hideSubNav` prop zodat het bij embed in de hub alleen de content-vorm rendert (geen dubbele nav of header). Legacy deep-links (`section: 'integraties'` + `integrationsSection`) blijven werken via automap. Resultaat: 8 top-tabs, elk 1 klik weg. Getest via Playwright: `['abonnement','setup','bedrijf','branding','smtp','invoicing','kiosk','backup']` zichtbaar, landing-tab weg.
- **Strakkere pasfoto-crop + force-regenerate (2026-02-27)**: Eerste versie van avatar-generatie cropte te ruim (hele pasfoto-doos inclusief tekst rondom). Fix drieledig: (1) Gemini prompt expliciet vraagt om ALLEEN gezicht (hoofdhaar → kin, oor → oor), niets van kader/tekst/nummers/schouders/handtekening. (2) PIL crop margin van 1.16 → 1.0, en 0.96 (4% inwaarts) als gezicht groot genoeg (>80px). (3) Sanity reject: als crop-oppervlak >60% van hele plaatje is, wordt geweigerd (fallback naar initials). (4) `POST /tenants/backfill-avatars?force=true` overschrijft bestaande avatars. (5) Nieuwe frontend-knop "Alle X pasfoto's opnieuw croppen" onder de banner voor huurders die al avatars hebben.
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
- `GET /api/superadmin/account` — huidig superadmin-profiel (naam, email)
- `PUT /api/superadmin/account` — wijzig eigen naam / inlog-email / wachtwoord (direct actief)


## Session Log — 2026-02-08 (bug fix Betalingsregelingen)
- **Bug**: Regeling toonde meer "resterend" dan er nog echt open stond op de gekoppelde factuur wanneer buiten de regeling om al was bijbetaald → risico op over-betaling van de factuur.
- **Fix in `/app/backend/payment_plans.py`**:
  - `_enrich_plan` en `enrich_plan` cappen nu `remaining_amount` + `next_due_amount` aan `sum(open op linked invoices)`. Nieuwe response-velden: `overpayment_adjustment`, `linked_invoice_open`.
  - `pay_installment_for` capt de betaling zelf ook (bewaart `original_amount` op de installment). Als de factuur na de betaling volledig gedekt is → resterende pending termijnen worden gemarkeerd als `cancelled` (reason=`invoice_fully_paid`) en het plan wordt `completed`.
- **Frontend `PaymentPlans.jsx`**: Amber "Bijstelling"-banner + "BIJGESTELD"-badge op de eerst-openstaande termijn wanneer die is verlaagd t.o.v. gepland.
- **Regressietest**: `/app/backend/tests/test_payment_plan_overpayment.py` — verifieert cap + auto-completion na factuur-vulling.

## Session Log — 2026-02-08
- Superadmin "Mijn Account" sectie toegevoegd binnen SaaS Instellingen: superadmin kan eigen naam, inlog-email en wachtwoord wijzigen zonder extra bevestiging (per MVP-keus). Backend endpoints `GET/PUT /api/superadmin/account` met validaties (email-formaat, min 6 tekens wachtwoord, uniek email).

## Session Log — 2026-02-08 (auto-herverdeling termijnen)
- Wanneer een betaling binnenkomt die de gekoppelde factuur méér reduceert dan de plan-progressie voorspelt, verdeelt de backend het nieuwe openstaande bedrag **gelijkmatig** over alle nog pending termijnen. De looptijd (aantal termijnen) blijft gelijk, alleen de bedragen per termijn zakken. `plan.total_amount` schuift mee.
- Nieuwe helper `_redistribute_pending_installments` in `server.py`, aangeroepen vanuit `_sync_plan_installments_with_invoice`. Rondingsverschillen komen in de laatste termijn zodat de som exact op het factuur-openstaand uitkomt.
- Regressietest `/app/backend/tests/test_payment_plan_redistribute.py`.

## Session Log — 2026-02-08 (instant sync na betaling)
- **Backend**: `_notify_company_admins` (WebPush + SSE) verplaatst naar `asyncio.create_task` in `create_payment` — voorheen wachtte de response 1-2s op trage WebPush-endpoints, waardoor de live-sync SSE-broadcast ook uitgesteld werd. Nu: response in ~130ms (gemeten).
- **Frontend**: SSE cross-invalidation uitgebreid — `/payments` mutatie invalideert nu ook `/payment-plans` (en `?status=active`) zodat de Betalingsregelingen-lijst instant refresht. Detail-view registreert nu een `surirent:live-change` handler die de plan-detail ook automatisch herlaadt.





## Session Log — 2026-02-08 (SSE singleton — hele beheerder instant)
- **Root cause**: elke React hook die `useAdminEvents` gebruikte opende zijn EIGEN EventSource → 4-5 parallelle SSE-connecties per tab (Bells + Payments + AdminDashboard). Browsers/proxies throttlen op 6 concurrente HTTP-connecties per domein → sommige SSE-streams kregen bytes niet door → events "leken traag" of misten.
- **Fix**: `admin-events.js` herschreven naar module-level singleton met pub/sub — één gedeelde EventSource waar álle hooks zich op abonneren. Aparte EventSource in `AdminDashboard.jsx` verwijderd; gebruikt nu dezelfde singleton. `closeAdminEvents()` wordt geroepen bij logout.
- **Result**: 1 SSE-connectie i.p.v. 5. Live-sync in de hele beheerder werkt binnen **~300ms** (gemeten browser-side: POST → SWR-invalidate → DOM update).


## Session Log — 2026-02-08 (facturen delete + historisch maand-picker)
- **Delete-knop verruimd**: was alleen zichtbaar op `current`/`future` facturen. Nu op **elke** onbetaalde factuur (past/current/future) mits niet partial-paid én geen actieve regeling. Zelfde regel in mobile + desktop InvoiceRow.
- **Backend guardrails** in `DELETE /api/invoices/{id}`: blokkeert delete wanneer er goedgekeurde payments aan de factuur hangen (audit-trail) of een niet-geannuleerde `payment_plan` gekoppeld is. Geeft duidelijke NL error i.p.v. silently orphan-payments.
- **Historische factuur form**: `Datum`-veld vervangen door **Maand + Jaar** dropdowns; klant boekt achterstanden per maand. Backend endpoint blijft compatibel (frontend stuurt `YYYY-MM-01`).


## Session Log — 2026-02-08 (facturen-automatisering: volgende run zichtbaar)
- Backend `GET /api/settings` verrijkt de `invoicing`-sectie met berekende velden `next_auto_run` (ISO-datum) en `billing_day_of_month` op basis van `grace_workdays` + `last_auto_run`. Logica: einde vorige/huidige maand + grace werkdagen (weekenden overslaan). Update bij elke settings-fetch, geen persistentie nodig.
- Frontend `Settings.jsx` → tab "Facturen automatisering": nieuw blauw info-paneel toont **"14 september 2026 (= dag 14 van de maand)"** met uitleg dat verlaging van grace de facturatie eerder in de maand plaatst.
