# PRD — Vastgoed Multi-Company SaaS

## Origineel probleem
Extract ONLY de Vastgoed + Kiosk-functionaliteit uit een legacy ERP en bouw hem opnieuw als een moderne Multi-Company SaaS met dual-domain, multi-tenant isolatie, SaaS-billing, PWA en hardware-integraties (Shelly).

## Personas
- **Superadmin (SaaS-eigenaar)** — beheert bedrijven, abonnementen, facturen, kasgeld.
- **Admin (Bedrijf)** — beheert appartementen, huurders, contracten, kasgeld.
- **Huurder** — betaalt via Kiosk, ziet portal.

## Kern-vereisten
- Multi-tenant data isolatie per `company_id`.
- Superadmin panel (SaaS) + Admin panel (Vastgoed) + Kiosk PWA.
- Custom domains met live DNS/SSL status.
- Dynamische Contract PDF (num2words NL, ID/DOB auto-fill).
- OCR-goedkeuring van SaaS-betalingen (Gemini 2.5).
- Automatische SaaS facturen, betaal-herinneringen, PDF factuur + e-mail.
- Superadmin Kasregister-kiosk met bedrijfs-detail drawer.
- Handmatige kasmutaties (correcties/refunds) door superadmin.

## Wat is af (recente sessies)
- **2026-02-28q**: **Custom Domain Cloudflare-to-Cloudflare loop detectie + fix** — Bug: kewalbansing.net → surirent.sr (beide via Cloudflare) leverde bij Cloudflare Error 1034 "Edge IP Restricted", maar onze status-widget zei foutief "LIVE" + toonde tegelijk een rode banner over IP-mismatch. Fixes: (1) Backend gebruikt nu `ipaddress` module + volledige Cloudflare CIDR-ranges om te detecteren of beide IPs Cloudflare edge-IPs zijn (i.p.v. hardcoded /16 prefixes die 172.67 misten). (2) Backend fetcht `GET /` van het custom domein en scant body op Cloudflare error codes 1034/1000/1014 → nieuwe status `cloudflare_loop`. (3) Nieuwe frontend status-meta met rode badge + duidelijke NL-oplossing: "Zet CNAME record op DNS-only (klik op de oranje wolk zodat hij grijs wordt)". (4) Topbar puls-dot wordt rood + pulsend bij `cloudflare_loop` i.p.v. groen. Verified visueel: kewalbansing.net toont nu "STATUS: CLOUDFLARE LOOP" met actie-instructie.
- **2026-02-28p**: **Custom Domain topbar quick-access + SSL provider auto-detect** — Globe-icoontje naast bellen, SSL provider detectie via headers.
- **2026-02-28o**: **Custom Domain UX consolidation + SSL self-managed** — Alle domain-config op één plek in Instellingen → Integraties → Eigen domein, geen Emergent Support references meer.
- **2026-02-28n**: **Proactieve prefetch — geen empty state of flikker meer tussen admin-tabs** — `usePrefetchAdmin` hook, 6/8 tabs 0 API-calls bij navigatie.
- **2026-02-28m**: **BUG FIX: `/auth/callback` werd als bedrijfscode "auth" geïnterpreteerd** — RESERVED_TOP_PATHS synced + `/auth/callback` route toegevoegd aan Hybrid en Tenant custom-domain trees.
- **2026-02-28l**: **Registratie-flow overal consistent + SuriRent brand-mark** — "Registreer hier" op login page opent nu de wizard, SuriRent logo boven progress dots.
- **2026-02-28k**: **data-testid cleanup: `mobile-register-*` → `register-*`** — 14 test-ids hernoemd, 0 oude referenties over.
- **2026-02-28j**: **Desktop registratie = mobile wizard-stijl** — RegisterModal thin wrapper rond `MobileRegisterWizard`.
- **2026-02-28i**: **Post-Google "Kies uw portalnaam" mini-modal** — nieuwe onboarding endpoint + auto-mount modal in AdminDashboard bij `needs_onboarding` flag.
- **2026-02-28h**: **Google Auth: stale-company fix + registratie via Google** — bug fix `/api/auth/google/callback` + Google-knop bovenaan RegisterModal en MobileRegisterWizard.
- **2026-02-28g**: **Live Puls Badge ook op mobiele bottom-tabbar** — `MobileTabBar` gebruikt dezelfde `useLivePulse` hook.
- **2026-02-28f**: **Live Puls Badge in sidebar (desktop)** — hook `useLivePulse` mapt SSE-paden naar sidebar-tabs, houdt Set van pulsende tabs bij voor 2.5s. Groene animate-ping dot naast tab-icoon.
- **2026-02-28e**: **Hero image preload + PWA manifest analyse** — inline-script in `public/index.html` voegt runtime `<link rel="preload" as="image" fetchpriority="high">` + `<link rel="preconnect">` toe alleen op `/` en `/site/*`.
- **2026-02-28d**: **Marketing landing 100% instant paint (ZERO fetch bij eerste bezoek)** — `frontend/scripts/inline-landing-content.js` postbuild-script injecteert gepubliceerde content als `<script>window.__LANDING_CONTENT__=…</script>` in `build/index.html`. `useLandingContent` leest die synchroon vóór localStorage.
- **2026-02-28c**: **Marketing landing snellere paint + geen flicker** — `webpackPreload: true` op MarketingLandingV2 chunk, localStorage cache in `useLandingContent`, backend `Cache-Control: public, max-age=60, stale-while-revalidate=300` op `/api/landing/content`. Reload: DOM ready in ~0.7s.
- **2026-02-28b**: **Polling verwijderd op alle backoffice pagina's** — Overzicht, Betalingsregelingen, Borg/Deposits, Kasgeld, Onderhoud, Werknemers, Instellingen (domain DNS/SSL status): alle `useAutoRefresh`, `setInterval` en `useEffect`+`api.get` fetch-patronen vervangen door `useApiSWR`. SSE-broadcast (via AdminDashboard globalMutate) invalideert nu automatisch alle keys onder het gemuteerde pad + `/admin/stats` cross-invalidatie.
- **2026-02-28**: **SSE live-sync FIX (backend + frontend)** — Backend middleware `_live_sync_broadcast` (server.py L720-768) leest nu ook `access_token` uit httpOnly cookies i.p.v. alleen `Authorization: Bearer` header, waardoor cookie-authenticated mutaties eindelijk SSE-events broadcasten. Verified 100% (12/12 pytest tests, `/app/backend/tests/test_sse_broadcast.py`). Frontend: AdminDashboard SSE listener invalideert nu automatisch SWR-caches op basis van het gemuteerde pad. Payments.jsx `useAdminEvents` luistert nu op `type === 'change'` i.p.v. verkeerde `'notification'`.
- **2026-02-27b**: **Klant Logo Preview** — nieuw endpoint `POST /api/settings/email/preview` (kwitantie / factuur / contract / herinnering samples) + live iframe-preview op Branding-pagina die real-time meebeweegt bij logo/kleur/naam wijzigingen. Debounced 350ms om backend niet te overladen. Toont exact hoe huurders de email ontvangen.
- **2026-02-27b**: **server.py refactor batch 3** — Pydantic modellen (~200 regels) verplaatst naar `/app/backend/models.py`; pure auth-helpers (hash_password, JWT create/decode, time helpers, PIN throttle, extract_token) (~110 regels) verplaatst naar `/app/backend/auth_utils.py`. Server.py teruggebracht van 13.4k → 13.26k regels. Herhaalbaar patroon voor volgende batches (routes/kiosk.py, routes/settings.py, etc.). Alle 15 regression tests groen.
- **2026-02-27**: **White-label tenant emails** — `wrap_template()` in `email_service.py` accepts `brand_name`, `brand_color`, `brand_color_dark`, `logo_url` kwargs. Nieuwe helpers `_tenant_email_brand(company_id)` en `_brand_name_of(company_id)` in `server.py`. Alle tenant-scoped emails (kwitantie, factuur, contract, betalingsherinnering, betalingsregeling termijn/reminder, SMTP-test, forgot-PIN) én WhatsApp/SMS signoffs gebruiken nu de bedrijfsnaam + primary-color uit `db.companies.branding` i.p.v. hardcoded "SuriRent". Platform emails (welkom, trial-reminder, wachtwoord-reset, SaaS-billing) behouden SuriRent branding via default kwargs. 9/9 backend tests passed (`/app/backend/tests/test_whitelabel_email.py`).
- **2026-02-15**: SaaS Facturen krijgt PDF + Mail knop per rij. Endpoint `GET /api/superadmin/subscription-invoices/{id}/pdf` (StreamingResponse) + `POST /.../email` (met PDF-attachment via `_saas_email(attachments=)`). Nieuwe `saas_invoice_pdf()` in `pdf_gen.py`.
- **2026-02-15**: Kasregister krijgt detail-drawer — klik op bedrijfskaart opent slide-in met alle facturen (T1/T2/T3 badges) + betaalhistorie + regelingen + PDF/Mail per factuur. Endpoint `GET /api/superadmin/kasregister/{company_id}`.
- **2026-02-15**: Betaling Prefill — Kasregister "Betaling" knop navigeert naar `/admin/saas_payments?prefill_company=xxx`, Subscriptions.jsx auto-opent modal met bedrijf voorgevuld.
- **2026-02-15**: Betaal-herinneringen — `check_invoice_reminders()` draait dagelijks, mailt bedrijven met facturen >=3 dagen vervallen (met PDF-bijlage). Idempotent via `sent_invoice_reminders` collectie. Zet factuur ook op `overdue`. Handmatige trigger `POST /api/superadmin/invoice-reminders/run`.
- **2026-02-15**: Superadmin Kiosk repurposed → SaaS Kasregister (dark kiosk-stijl).
- **2026-02-15**: SaaS Facturen auto-maandgeneratie + handmatige "Nieuwe factuur" knop.
- **2026-02-15**: SaaS Betalingsregelingen volledig herbouwd.
- **2026-02-15**: Handmatige SaaS Kasgeld mutaties.
- **2026-02-15**: Trial-verloop e-mailwaarschuwing 3 dagen voor einde.
- **2026-02-15**: Superadmin routes eerste batch verplaatst naar routes/superadmin.py.
- **2026-02-15**: SaaS Overzicht 1:1 gespiegeld aan Admin Overview.
- 2026-02: Custom domain resolver + DNS/SSL widget.
- 2026-02: Contract PDF generator herbouwd.
- 2026-02: UI redesign Kasgeld/Huurders/Contracten.
- 2026-02: Superadmin sidebar gespiegeld.

## Backlog (P0 → P2)
- **P1** Server.py refactor batch 2: OCR-approve/reject + companies-CRUD naar routes/superadmin.py.
- **P1** JWT-migratie van `localStorage` naar `httpOnly` cookies.
- **P2** React Hook exhaustive-deps warnings fixen.
- **P2** Superadmin Settings card-based redesign.
- **P2** Shelly Smart Breakers integratie.
- **P2** Herhaal-herinneringen (3d, 7d, 14d vervallen).
- **P2** Superadmin dashboard-tegel voor "verstuurde herinneringen" historie.

## Tech stack
React · FastAPI · Motor (async MongoDB) · SSE · ReportLab · num2words · Web NFC · Gemini 2.5 Flash · Emergent LLM key · SMTP.

## Key files
- `/app/frontend/src/pages/vastgoed/AdminDashboard.jsx` — Admin + SaaS sidebar + routing
- `/app/frontend/src/pages/vastgoed/admin/SaasOverview.jsx` — Superadmin Overzicht
- `/app/frontend/src/pages/vastgoed/admin/SaasKasregister.jsx` — SaaS Kasregister + Detail drawer
- `/app/frontend/src/pages/vastgoed/admin/Subscriptions.jsx` — SaaS Facturen/Betalingen/Kasgeld/Regelingen + alle modals + PDF/Mail helpers + prefill
- `/app/backend/routes/superadmin.py` — Alle SaaS-eigenaar routes + PDF endpoints + reminder loop
- `/app/backend/routes/saas_ops.py` — Kas-mutaties + Trial-warnings
- `/app/backend/routes/_deps.py` — Shared deps
- `/app/backend/pdf_gen.py` — Contract + SaaS invoice PDF
- `/app/backend/server.py` — Core FastAPI

## API endpoints (nieuw deze sessie)
- `GET /api/superadmin/kasregister` — bedrijven-lijst met betaalstatus
- `GET /api/superadmin/kasregister/{company_id}` — detail (invoices + payments + plans)
- `POST /api/superadmin/subscription-invoices` — handmatige factuur maken
- `GET /api/superadmin/subscription-invoices/{id}/pdf` — download PDF
- `POST /api/superadmin/subscription-invoices/{id}/email` — mail PDF naar owner
- `POST /api/superadmin/invoice-reminders/run` — trigger herinneringen
- `POST /api/superadmin/saas-payment-plans` — regeling met N termijnen
- `GET /api/superadmin/saas-payment-plans` — plans + termijn-progress
- `POST /api/superadmin/saas-auto-invoice/run` — trigger auto-generatie
- `POST /api/superadmin/kas-mutations` — handmatige +/- boeking
- `POST /api/superadmin/trial-warnings/run` — trial-warning cyclus

## MongoDB collecties (nieuw deze sessie)
- `sent_trial_warnings` — dedup marker trial-mails
- `sent_invoice_reminders` — dedup marker factuur-reminders
- `saas_payment_plans` — SaaS-betalingsregelingen
- `subscription_invoices.saas_plan_id / kind:'installment'` — termijn-facturen
- `subscription_invoices.email_log` — historie verstuurde facturen
- `subscription_invoices.manual: true / auto_generated: true` — herkomst-marker

## Test credentials
Zie `/app/memory/test_credentials.md`.
