# SuriRent — Multi-Company Vastgoed SaaS


## Latest Change (2026-06 · Alles-in-één betalen + Automatisch betalen + Pushmeldingen)
- Betaalbox Mijn Abonnement toont ALLE open facturen met checkboxes (standaard alles), totaal live; betaalt selectie in één Stripe PaymentIntent (`create-intent` met `invoice_ids` / `all_open`). Checkout toont factuurlijst + totaal.
- Automatisch betalen (alleen creditcard): checkbox "Kaart bewaren" in checkout (`POST /saas-stripe/intent-save-card` → setup_future_usage off_session, Stripe Customer per bedrijf per modus `companies.stripe_customers`). Kaart opgeslagen in `companies.autopay`. Kaart `AutopayCard`: aan/uit, verwijderen. Endpoints `GET/PUT/DELETE /api/billing/me/autopay`.
- Nieuwe factuur (maandelijkse tick + handmatig superadmin) → `on_new_saas_invoice`: direct off-session afschrijven; mislukt → `autopay_failed` op factuur + push. Geen autopay → push "Nieuwe abonnementsfactuur".
- Push ook bij geslaagde autopay en dagelijks bij verlopen abonnement (`expiry_push_tick`, idempotent via `sent_expiry_push`).
- Getest: iteration_63 (backend 7/7, frontend 100%) in TEST-modus; Stripe daarna teruggezet naar LIVE, testfacturen opgeruimd.


## Latest Change (2026-06 · Abonnementsbel + Mijn Abonnement licht design)
- ApartmentsBell (gebouw-icoon) en OverdueBell (huur-achterstanden) verwijderd uit de beheerder-topbar (desktop + mobiel). Nieuwe `components/SubscriptionBell.jsx`: toont alleen abonnementsmeldingen (verlopen, proef/vernieuwing binnen 7 dagen, nieuwe/achterstallige factuur) met directe Creditcard/iDEAL knoppen + link naar Mijn abonnement.
- Huur-achterstanden alleen nog op Facturen-pagina.
- Mijn Abonnement herontworpen in de stijl van Facturen: KPI-strip (Pakket/Status/Openstaand/Laatste betaling), betaalbanner oudste open factuur, tabbalk (Facturen/Betalingen/Pakket wijzigen/Bankoverschrijving), tabel-achtige factuurrijen.
- `/api/billing/me` geeft nu `company_name` terug (omschrijving bankoverschrijving toont echte naam).
- Getest: iteration_62 (100% backend + frontend).


## Latest Change (2026-06 · Instellingen-dropdown + Mijn Abonnement redesign)
- Tab-balk bovenaan Instellingen verwijderd. Zijmenu "Instellingen" (klant-admin) is nu een uitklapbare dropdown met 8 onderdelen (Mijn abonnement eerst). Mobiel: in de menu-sheet klapt "Instellingen" een lijst open.
- Eén bron: `admin/instellingenSections.js`; `InstellingenHub` volgt de URL-hash (`/admin/instellingen#<id>`).
- Mijn Abonnement: nieuwe bento-layout (donkere status-hero met 3 stats, "Nu betalen" kaart met Creditcard/iDEAL, bankoverschrijving + upload naast elkaar, pakketkaarten, facturen + betalingen-tijdlijn, gevarenzone).
- "Oudste open factuur" = vroegste `period_start` (frontend + backend).
- Getest: iteration_61 (backend 8/8, frontend OK; mobiele overflow opgelost en opnieuw gecontroleerd op 390px).
- LET OP: Stripe staat in LIVE-modus (door superadmin ingesteld op 2026-10-09).


## Latest Feature (2026-06 · Stripe Creditcard & iDEAL voor SaaS-abonnement)
- **SaaS Instellingen → "Stripe betalingen"**: Test/Live schakelaar, Publishable key, Secret key (gemaskeerd), Webhook secret per modus; opgeslagen in `saas_settings.stripe`. Testmodus valt terug op env-keys. Prefix-validatie (pk_/sk_/whsec_, _test_/_live_), live kan pas na invullen live keys. Knop "Test verbinding" (`POST /api/superadmin/stripe-config/test`).
- **Mijn Abonnement (klant)**: box "Direct online betalen" met knoppen Creditcard + iDEAL (oudste open factuur) + per open factuur Creditcard/iDEAL knoppen. Navigeert naar `/saas/checkout/<id|open>?method=card|ideal&back=...`.
- **Checkout**: eigen pagina (Stripe PaymentElement), iDEAL-redirect terugkeer via `?pi=` / `payment_intent` → status polling. SRD→EUR met live FX (`_get_eur_per_srd`).
- **Na betaling**: factuur paid, `subscription_payments` (method creditcard/ideal), bedrijf geactiveerd (`_activate_company_after_saas_payment`) + bevestigingsmail.
- **Webhook**: verifieert met live én test whsec; bugfix StripeObject `.get()` crash.
- **Superadmin SaaS Facturen**: knop "Kaart" per open factuur.
- Endpoints: `GET/PUT /api/superadmin/stripe-config`, `GET /api/saas-stripe/public-config`, `POST /api/saas-stripe/create-intent` (superadmin of eigen bedrijf), `GET /api/saas-stripe/intent-status/{pi}`, `POST /api/saas-stripe/webhook`.
- Getest: iteration_60 (19/19 backend, frontend kaartflow E2E). iDEAL end-to-end redirect niet volledig in UI getest.

## Backlog
- P0: server.py opsplitsen (17k regels)
- P1: OCR automatische betalingsverwerking
- P2: NumPad overal, reserved slugs single source, public API rate limiting
- Onderzoek: herhaalde 400-fout op een (niet-Stripe) endpoint op superadmin pagina's


## Latest Fix (2026-02-28 · superadmin) — Missing `await` in `routes/superadmin.py`

**Bug**: Alle superadmin schermen (Overzicht, Betalingen, Facturen, Betalingsregelingen, Kasgeld, Kasregister) bleven oneindig laden. Backend returned HTTP 500 met `TypeError: 'coroutine' object is not subscriptable`.

**Root cause**: `_billing_summary(c)` is een `async def` in `server.py:4670` maar werd op 4 plaatsen in `routes/superadmin.py` AANGEROEPEN ZONDER `await` tijdens de recente refactor:
- `superadmin_overview` (line 54)
- `superadmin_clients` (line 148)
- `superadmin_kasregister` (line 378)
- `superadmin_company_detail` (line 544)

**Fix**: `s = _deps.billing_summary(c)` → `s = await _deps.billing_summary(c)` (replace_all + 1 unieke). Alle 4 endpoints returnen nu HTTP 200 in <120ms.

**Visueel getest**: SaaS Overzicht laadt alle KPI tegels + "Totaal ontvangen SRD 6.100" + sidebar menu volledig bereikbaar.

**Credentials opgeslagen**: `super@surirent.sr` / `super1234` toegevoegd aan `test_credentials.md`.


## Latest Fix (2026-02-28 · v3) — Pill-knoppen onderaan `+` sheet + Hoe-wilt-u-betalen opschoning

**Twee wijzigingen** (`KioskLayout.jsx`):

1. **Kasgeld / Beheerder / Uit nu als pill-knoppen** onder de 7 aanmaak-tegels in `KioskAddSheet`:
   - 7 witte card-tegels (unchanged): Nieuwe huurder, appartement, locatie, contract, factuur, Betalingen inzien, Onderhoud
   - 3 compacte pill-buttons in `grid-cols-3 gap-2` eronder: **Kasgeld** (witte achtergrond, oranje tekst), **Beheerder** (semi-transparant wit, alleen bij admin-access), **Uit** (semi-transparant wit)
   - Pill-styling matcht de oude top-balk visuele hiërarchie — zijn echt knoppen, geen kaarten

2. **"Hoe wilt u betalen?" opschoning**: tekst "Wacht op klant: laat hen op het klantenscherm de betaalmethode kiezen — of tik hieronder voor handmatige invoer." verwijderd (lines ~2290-2296). De betaalmethodes (SRD/USD/EUR cash/bank/online) blijven direct selecteerbaar — simpeler scherm.

Visueel geverifieerd op 390×844.


## Latest Fix (2026-02-28 · v2) — Uit/Kasgeld/Beheerder verhuisd naar `+` sheet

**Reden**: user wou dat de drie knoppen (Uit, Kasgeld, Beheerder) uit de mobile top-balk weg gaan en samen met de quick-add opties in de `+` bottom-sheet komen, zodat de top-balk vrij komt en de locatie-/appartement-lijst hoger op het scherm begint.

**Wijzigingen** (`KioskLayout.jsx`):
- `MobileHeaderButtons` component retourneert nu `null` (geen DOM op mobile) — call-sites in `ApartmentSelect`/`TenantConfirm` blijven intact
- `KioskAddSheet.tiles` uitgebreid van 7 naar maximaal 10 tegels:
  - **Standaard** (7, zelfde als desktop bottom-bar): Nieuwe huurder, Nieuw appartement, Nieuwe locatie, Nieuw contract, Nieuwe factuur, Betalingen inzien, Onderhoud
  - **Nieuw**: Kasgeld (oranje accent `#FF5C00`), Beheerder (alleen zichtbaar als `hasAdminAccess === true`), Uit/uitloggen (rode danger-styling)
- `handleSheetPick` uitgebreid met `kasgeld` → `setStep('kasgeld')`, `admin` → `adminRef.current()`, `exit` → `exitRef.current()`. Hoisting-probleem opgelost via `useRef`+`useEffect` zodat `handleSheetPick` bovenaan de component kan blijven staan terwijl `exit`/`adminMode` pas verderop gedefinieerd zijn
- Sheet-mount krijgt `hasAdminAccess` prop door zodat de Beheerder-tegel conditioneel verschijnt — zelfde logica als de desktop-bar

**Visueel geverifieerd op 390×844**:
- Top van het scherm: "Kies een locatie" start direct zonder tussen-balk
- `+` sheet toont nu 10 tegels in 2-koloms grid incluzief kleur-accenten op Kasgeld (oranje) en Uit (rood)


## Latest Fix (2026-02-28) — Mobile "+" FAB terug op Kiosk select

**Reden**: Op desktop was er al een bottom-bar met Huurder/Appt./Locatie/Contract/Factuur/Betalingen/Onderhoud, maar op mobiel waren deze shortcuts niet bereikbaar sinds de verwijdering van de oude FAB (iOS-PWA viewport-drift bug uit feb 2026).

**Nieuwe implementatie** (`KioskLayout.jsx`):
- Mobile FAB (oranje rond `+` icoon, 56×56) via `createPortal` naar `document.body` met safe-area bottom padding, zodat de iOS/Android nav-bar nooit over de knop valt
- Alleen zichtbaar wanneer `step === 'select'` + `md:hidden` zodat desktop onveranderd blijft
- Opent de bestaande (al gedefinieerde maar niet-gerenderd) `KioskAddSheet` component die fullscreen uitklapt met 2-koloms grid van 7 tegels. De sheet-component was al bulletproof tegen keyboard-shift via `useVisualViewport`
- Dispatch via `handleSheetPick` → dezelfde `setShowAdd*`-states die ook de desktop-bar gebruikt (dus elke tegel opent exact dezelfde modal)
- Mount van `<KioskAddSheet>` toegevoegd in de JSX van `KioskLayout` (ontbrak voorheen)

**Visueel getest** op 390×844: FAB zichtbaar, click opent sheet, 7 tegels + ✕-sluit knop allemaal correct zichtbaar met oranje branding.


## Latest Feature (2026-02-28) — Automatische boetes via Facturen-automatisering

**Doel**: Boetes-rij in Financieel overzicht moet pas verschijnen zodra er echt een boete is. De admin schakelt dit aan in Facturen-automatisering en configureert bedrag + modus.

**Backend** (`settings_service.py` + `server.py`):
- `empty_section("invoicing")` uitgebreid met 5 velden: `fines_enabled`, `fines_amount`, `fines_currency`, `fines_mode` (`per_overdue` | `per_day`), `fines_grace_days`
- `GET /kiosk/tenants/{id}/overview` berekent nu `fines_total` + `fines_currency`:
  - Alleen wanneer `fines_enabled: true` én tenant heeft `overdue_invoices`
  - `per_overdue`: `fines_amount × count(overdue)`
  - `per_day`: `fines_amount × sum(max(days_late - grace, 0))` over alle overdue facturen
- `GET /tenant-portal/overview` idem — eigen berekening uit huurder-scoped invoices
- Testresultaat: Jan Pieterse met 2 overdue facturen × SRD 50 → `fines_total: 100.0` correct

**Frontend**:
- `KioskLayout.jsx` `TenantOverview`: items-array leest `data.fines_total` + `data.fines_currency` en toont Boetes-rij alleen wanneer `> 0`
- `TenantKioskLayout.jsx` `DashboardView`: leest `overview.fines_total` en toont rij conditioneel
- `admin/Settings.jsx` `InvoicingForm`: nieuwe "Automatische boetes" sectie onderaan met toggle "Ingeschakeld", bedrag/valuta/grace-dagen velden, en modus-selector (Per vervallen factuur / Per dag te laat). Toont uitleg-blok dat niets automatisch wordt geïncasseerd — enkel informatief in Financieel overzicht

**Visueel geverifieerd**:
- Fines ingeschakeld (SRD 50 per overdue) → Boetes-rij toont `SRD 100,00` bij 2 overdue
- Fines uitgeschakeld → Boetes-rij volledig verborgen


## Latest Fix (2026-02-28 · v4) — Items in eigen scroll-container + numpad toggle label

**Twee aanpassingen** (`PaySelect` in KioskLayout.jsx):
1. **Items in eigen scroll-container** — de maand/termijn-lijst krijgt een visueel distinct scroll-vak (`bg-slate-50/60 border border-slate-100 rounded-xl p-1.5`) ONDER de altijd-vaste "Alles betalen" knop. Zo scrollen de items binnen hun eigen afgebakende sectie zonder dat "Alles betalen", de "Direct betalen" knop of het "Ander bedrag" numpad meescrollen.
2. **Toggle label dynamisch**: `showMobileKeypad ? 'Sluiten' : 'Openen'` reeds correct; de SW v108 updates heeft het label nu live in-browser gefixt. Default-state is `useState(true)` zodat huurders direct een bedrag kunnen invoeren bij openen van PaySelect.

Visueel geverifieerd op 390×844 — numpad open ("Sluiten" label + toetsen 1-9+0 zichtbaar) en numpad dicht ("Openen" label + alleen bar) werken beide correct.


## Latest Fix (2026-02-28 · v3) — Numpad toggle-bar blijft altijd zichtbaar

**User feedback**: toen de numpad gesloten was, verdween de "Ander bedrag" rij volledig en kwam alleen een vage compacte knop terug. Beter is dat de bar met "Ander bedrag (SRD) · Sluiten/Openen" ALTIJD zichtbaar blijft en alleen het numpad-grid in-/uitklapt.

**Fix** (`PaySelect` in KioskLayout.jsx): mobile keypad container herbouwd als één card met twee lagen:
1. **Toggle-bar** (altijd zichtbaar) — `# Ander bedrag (SRD)` links + `Sluiten`/`Openen` rechts, hele rij is klikbaar
2. **Numpad-paneel** (conditioneel) — bedrag-display + 4×3 grid onder de bar met `border-t` scheiding

Safe-area bottom-padding wordt alleen toegepast wanneer het paneel open is (anders overbodige lege ruimte onder de dichte bar).

Visueel getest op 390×844 — toggle-bar blijft zichtbaar in alle 3 states (open → dicht → opnieuw open), numpad verschijnt/verdwijnt eronder.


## Latest Fix (2026-02-28 · update) — Kiosk PaySelect items-list scrollbaar

**Probleem** (vervolg na vorige fix): wanneer álle items (achterstallige huur + vooruit gefactureerd + 4× termijnen) geselecteerd zijn, groeide de items-lijst door en duwde de "Direct betalen" + numpad onder de viewport. Numpad-rij `7/8/9/0` was dan niet zichtbaar.

**Fix** (`KioskLayout.jsx` PaySelect LEFT-card): items-container `flex flex-col gap-1 sm:gap-1.5 flex-1` → `flex flex-col gap-1 sm:gap-1.5 flex-1 min-h-0 overflow-y-auto -mx-0.5 px-0.5`. Nu scrolt de items-lijst binnen de witte card zodat de "Direct betalen"/"Regeling afspreken" knoppen en het "Ander bedrag" numpad altijd zichtbaar blijven onderaan.

Visueel getest op 390×844 met Alles-geselecteerd + geopende numpad — alle 10 toetsen (1-9 + 0 + DEL + .) zichtbaar inclusief veilige safe-area padding onder.


## Latest Fix (2026-02-28) — Kiosk PaySelect UI clean-up (3 items)

1. **Boetes rij conditioneel**: `PAY_ITEMS_TEMPLATE.map` → `PAY_ITEMS_TEMPLATE.filter((t) => (amounts[t.id] || 0) > 0).map` zodat de "Boetes" rij alleen verschijnt zodra de beheerder een boetebedrag heeft ingesteld. Zolang `amounts.boete === 0` blijft deze volledig verborgen in de "Wat wilt u betalen?" lijst.
2. **Donkere samenvattingsbalk verwijderd**: De `bg-slate-900` rij met "N items — Huur X, Y, Z — totaal" (lines ~1963-1971) is weg. De totalen zijn al zichtbaar in de "Direct betalen" + "Regeling afspreken" CTA-knoppen eronder, dus de aparte balk was overbodig.
3. **Mobile keypad safe-area padding**: `md:hidden` keypad container krijgt `paddingBottom: max(env(safe-area-inset-bottom, 0px), 12px)` zodat de laatste rij toetsen (7/8/9/0) niet onder de iOS home-indicator of Android navigatiebalk verdwijnt.

Visueel getest op 390×844: PaySelect toont alleen huur-items (geen Boetes), geen donkere balk, en de numpad `0`-rij zit netjes boven de safe-area.


## Latest Feature (2026-02-28) — PWA score boost (manifest + SW + offline)

**Manifest** (statisch `/public/manifest.json` + `/public/assistent-manifest.json` + dynamic `/api/pwa/manifest`):
- `iarc_rating_id: e84b072d-71b3-4d3e-86ae-31a8ce4e53b7` toegevoegd (IARC Everyone, geen volwassen content)
- `protocol_handlers` toegevoegd: `web+surirent://` → `/open?target=%s` + voor beheer-manifest ook `mailto` → `/admin/berichten/nieuw?to=%s`
- `screenshots` toegevoegd aan de dynamic endpoint (statisch had al 3 install-screenshots) — in de backend als `_PWA_SCREENSHOTS` constante, geserveerd voor alle 4 rollen (beheer/huurder/kiosk/klant)
- `categories: ["business", "finance", "productivity"]` + `description` waren al aanwezig; voor `assistent-manifest.json` toegevoegd

**Service Worker** (`/public/sw.js` → v107 → **v108**):
- Nieuwe `/offline.html` branded fallback-pagina (oranje card, "Je bent offline", retry-knop, auto-reload bij `online` event)
- `/offline.html` toegevoegd aan `PRECACHE` zodat hij altijd beschikbaar is
- **API-strategie gewijzigd**: `/api/*` GET-calls waren hard bypassed → nu **network-first met stale cache-fallback**. SSE (`/events`) + `?nocache=1` blijven bypassen. Bij offline + geen cache return 503 JSON zodat frontend toast kan tonen
- **HTML navigation fallback-ladder**: specifieke URL cache → app-shell `/` cache → `/offline.html` → inline minimal HTML
- Static assets (JS/CSS/images) blijven cache-first (geen wijziging)
- Push notifications: ongewijzigd (al volledig geïmplementeerd)

**Installeerbaarheid**:
- `beforeinstallprompt` handler bestond al in `lib/pwa.jsx:146` + iOS fallback timer; geen wijziging nodig — handler is actief in `<InstallPrompt />` dat in `App.js` is gemount

**Geverifieerd via curl**:
- `GET /offline.html` → 200
- `GET /manifest.json` → bevat `iarc_rating_id`, `protocol_handlers`, `screenshots(3)`, `shortcuts(3)`, `categories`
- `GET /api/pwa/manifest?role=beheer` → bevat `iarc_rating_id`, `protocol_handlers`, `screenshots(3)` + per-role base
- `GET /sw.js` → v108 live met nieuwe strategie-comment

Visueel getest op 390×844: offline-pagina toont correct SuriRent branding, WiFi-off icoon, "Probeer opnieuw" knop.


## Latest Fix (2026-02-28) — Kasgeld desktop = Financieel overzicht patroon + creator per mutatie

**Wijzigingen**:

1. **Desktop layout aligned met Financieel-overzicht patroon** (`KioskLayout.jsx` KasgeldPanel):
   - `md:flex-row` 3:2 split zoals TenantOverview "Financieel overzicht"
   - LINKS (`md:flex-[3]`, `md:order-1`): Recente mutaties - brede card met per-maand accordion
   - RECHTS (`md:flex-[2]`, `md:order-2`): Kasgeld-overzicht met titel, maand-pil, totaal-saldo, 3-valuta grid, "Nieuwe mutatie" CTA
   - Mobile orde intact (Kasgeld-overview boven, Recente onder) via `md:order-*` swap
   - Oranje header (Terug + operator-naam rechts) identiek aan Financieel-overzicht

2. **Creator-naam zichtbaar per mutatie** (`backend/server.py` + `KioskLayout.jsx`):
   - `CashEntryOut` model uitgebreid met `created_by` + `created_by_name`
   - `POST /api/kasgeld` (admin) → slaat `created_by = user.id`, `created_by_name = user.name or user.email or "Beheerder"` + `created_via: "admin"`
   - `POST /api/kiosk/kasgeld` (kiosk) → slaat `created_by = session.employee_id`, `created_by_name = session.employee_name or "Kiosk medewerker"`
   - GET endpoints: projectie uit `payments.kiosk_employee_name` of `payments.approved_by` voor payment-sourced items; `"Onbekend"` fallback voor legacy kasgeld-docs
   - UI toont `{datum} · {Contant/method} · Door {creator_name}` in de subregel van elke `KasgeldMutationRow`
   - Nieuwe testid: `kasgeld-row-creator-{id}`

**Getest** op 390×844 (mobile) en 1440×900 (desktop) — mobile matcht de user-mock, desktop matcht het Financieel-overzicht patroon. Legacy payment-items tonen "Door Onbekend"; nieuwe mutaties zullen de operator-naam tonen.


## Latest Feature (2026-02-28) — Kiosk Kasgeld herontwerp (mobile + desktop)

**Wat**: Volledige redesign van het Kasgeld-paneel in de Kiosk, op basis van user mock-up. Twee witte "card"-secties op oranje achtergrond: (1) Overzicht met totaalsaldo + 3-valuta grid + "Nieuwe mutatie" knop, (2) Recente mutaties met per-maand accordion.

**Mobile layout**: Verticaal gestapeld; eerst de overzicht-card met titel/maand-pil, dan het totaal-saldo (wallet-icon + SRD-bedrag groot), dan 3-koloms valuta-grid (SRD/USD/EUR) + oranje `Nieuwe mutatie` CTA; onder de card de recente-mutaties lijst gegroepeerd per maand.

**Desktop layout**: Op `lg+` (≥1024px) wordt het een 2-koloms grid: overzicht-card links (max 420px), mutaties-rechts (flexibel). Dezelfde cards, zelfde logica.

**Functionaliteit**:
- `KasgeldPanel` fetcht `/kiosk/kasgeld/balance` en `/kiosk/kasgeld` (ongewijzigd backend)
- Mutations worden client-side gegroepeerd per `YYYY-MM`, nieuwste maand eerst
- Standaard is de huidige maand uitgevouwen in de accordion, oudere maanden ingeklapt
- "Oktober 2026 ▼" chip opent `KasgeldMonthPicker` (bottom-sheet mobiel / centered dialog desktop) om snel naar een andere maand te springen
- Mutatie-rij: gekleurde icoon-tegel (groen ↗ voor inkomsten / rood ↙ voor uitgaven) + titel + "datum · Contant/Betaalmethode" subtekst + gekleurd bedrag (+/−)
- Operator-naam uit `getKioskEmployee()` toont rechts in de oranje header
- `Nieuwe mutatie` opent de bestaande `KasgeldMutationModal` (ongewijzigd)

**Nieuwe helpers**: `KasgeldMutationRow` (1 regel per transactie) + `KasgeldMonthPicker` (overlay). Icons `ArrowUpRight`/`ArrowDownLeft`/`ChevronDown` toegevoegd aan lucide-imports.

**Getest** op 390×844 (iPhone 14 Pro) en 1440×900 (desktop) via screenshot tool — beide matchen de user mock-up.


## Latest Fix (2026-02-27 • update) — Android text-size-adjust + robuustere label/value utility

**Correctie**: Vorige fix richtte zich teveel op iOS. User meldde dat op kleinere Android schermen de layout nog steeds brak tenzij gebruikers in Instellingen de systeem-lettergrootte verkleinden.

**Root cause**: Android Chrome schaalt tekst mee met de systeem "Lettergrootte" instelling tenzij `text-size-adjust: 100%` expliciet in álle vendor-varianten op `html` staat. De oude CSS had alleen `-webkit-text-size-adjust`. Daarnaast had `.row-label-value__value` geen fallback-truncatie bij extreem lange bedragen op <320px schermen.

**Wijzigingen (`index.css`)**:
- `html`: `-webkit-text-size-adjust`, `-moz-text-size-adjust`, `-ms-text-size-adjust` én `text-size-adjust` nu allemaal op `100%` — Android Chrome respecteert nu geen systeem-font-scaling meer. Base `font-size: 16px` toegevoegd zodat rem-waarden overal voorspelbaar blijven
- `.row-label-value`: `flex-wrap: nowrap` + `max-width: 100%` expliciet; gap-reductie naar `0.375rem` op <360px
- `.row-label-value > :last-child` (waarde): `max-width: 65%` + `overflow: hidden` + `text-overflow: ellipsis` als vangnet bij extreem lange bedragen, blijft nog altijd `white-space: nowrap`

**Getest** op 288×640, 320×640 Android viewports — alle label/value rijen in Facturen-lijst, Factuur-detail en Betalingen blijven correct op één regel staan zonder dat de gebruiker Android systeem-settings hoeft aan te passen.


## Latest Fix (2026-02-27) — Globale `.row-label-value` utility voor label/waarde-rijen

**Probleem**: Op smalle schermen (< 400px, iOS PWA) sprong het bedrag naast een label soms naar een tweede regel of werd links uitgelijnd door lange dynamische labels. User wilde dat label + bedrag ALTIJD op één horizontale lijn blijven staan.

**Oplossing**: Globale CSS utility class `.row-label-value` toegevoegd aan `/app/frontend/src/index.css`:
- Container: `flex flex-row justify-between items-start gap-2 w-full min-w-0`
- Eerste child (label): `flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap`
- Laatste child (waarde): `flex-shrink: 0; white-space: nowrap; text-align: right`
- Sub-klassen `.row-label-value__label` en `.row-label-value__value` beschikbaar voor complexere layouts

**Toegepast op** (systematische uitrol via reusable helpers + expliciete rijen):
- `KioskLayout.jsx`: `Row`, `RowSlim` helpers · Totaal openstaand (financieel overzicht) · Regeling-modal (Per maand / Termijnen / Eerste vervaldatum) · PartialPlanSuggestion
- `TenantKioskLayout.jsx`: `ConfirmRow` helper · Totaal openstaand (huurder-portaal)
- `admin/Deposits.jsx`: Refund-modal Terugbetaling · Borggegevens detail-card (Huurder/Appartement/Valuta/Terugbetaald)
- `admin/invoices/QuickPayModal.jsx`: Totaal factuur / Reeds betaald / Nog te betalen samenvatting
- `admin/Payments.jsx`: `DetailRow` helper
- `admin/invoices/InvoiceDetailPage.jsx`: `DetailRow` helper
- `admin/Subscriptions.jsx`: `Row` helper (billing-detail rijen)
- `admin/MijnAbonnement.jsx`: `KV` helper (bank/plan info)
- `admin/Maintenance.jsx`: Ticket-status + kosten rij
- `admin/Employees.jsx`: Netto uitbetaling in loonstrook-modal
- `components/TrialBanner.jsx`: `Row` helper (bank-details in trial modal)
- `auth/RegisterSuccess.jsx`: `Bank` helper

**Bewust NIET aangepast** (bestaande protection of geen label/value pattern):
- `InvoiceRow.jsx` — heeft al `whitespace-nowrap` + `truncate` + extra delete-button (3-child layout)
- `PaidHistorySection.jsx` — headers combineren count+total in één `<p>`, geen simpele split
- `TenantPublicLanding.jsx` — grote price + CTA-button, aesthetische layout
- `AdminDashboard.jsx` outstanding-card — header/chevron pattern, waarde op tweede regel
- Nav/header/toggle rijen door de hele app — niet het target-patroon


## Latest Fix (2026-02-22) — Kiosk onderbalk ALTIJD zichtbaar in de hele Kiosk

**Probleem**: De onderste menubalk (mobile "+" FAB + desktop knoppenbalk) verdween wanneer een modal geopend werd (Kasgeld, Snel toevoegen, Nieuwe huurder, etc.). User wilde de balk overal in de Kiosk zichtbaar + klikbaar houden.

**Root cause**: De balk stond binnen `.kiosk-fullscreen` met `position: absolute` en `z-40`. Modals werden via `createPortal` naar `document.body` gerenderd met `fixed inset-0 z-[100]` → de modal overlay dekte de balk visueel af. Op mobile werd de FAB expliciet verborgen via een lange conditie (`!showAddSheet && !showAddTenant && ...`).

**Wijzigingen**
- `MobileAddFab` (KioskLayout.jsx:89-113) — gerefactored naar `createPortal(..., document.body)` met `position: fixed inset-x-0 bottom-0 z-[110]`
- Desktop bottom bar (KioskLayout.jsx:4767-4835) — omhuld in `createPortal(..., document.body)`, positie van `absolute` → `fixed`, z-index `z-40` → `z-[110]` (hoger dan modal-shell z-[100])
- Conditie op FAB rendering vereenvoudigd van `step === 'select' && !showAddSheet && !showAdd* ...` → `step !== 'check'` (dus ook zichtbaar op Kasgeld en op alle modals)
- `KioskModalShell` outer div: extra `pb-[calc(56px_+_env(safe-area-inset-bottom,0px))] sm:pb-4` — reserveert onderin ruimte voor de balk zodat modal-content niet onder de balk verdwijnt
- `KioskAddSheet` outer div: idem `pb-[calc(56px_+_env(safe-area-inset-bottom,0px))] md:pb-0`
- `.kiosk-content-scroll` in index.css: op mobiel (< 768px) nu `padding-bottom: calc(64px + env(safe-area-inset-bottom, 0px))` zodat ApartmentSelect/KasgeldPanel scroll-content niet onder de FAB doorschuift

**Getest (self-test, screenshot tool)**
- **Mobile 390×844**: balk zichtbaar op (1) apartment-select, (2) Kasgeld-panel, (3) Snel toevoegen sheet, (4) Nieuwe huurder modal — alle vier bevestigd
- **Desktop 1280×800**: balk zichtbaar op (1) select, (2) Nieuwe huurder modal (contract-knop `is_visible()=True` → volledig klikbaar boven de modal), (3) Kasgeld — alle drie bevestigd



## Latest Feature (2026-02-15) — Kiosk quick-create: Nieuwe huurder + Nieuw appartement

**Wat**: Twee nieuwe knoppen op de Kiosk-onderrij (Desktop + Mobile) naast Uit/Kasgeld/Beheerder waarmee de operator ter plekke een huurder of appartement kan aanmaken zonder de Kiosk-modus te verlaten.

**Frontend (`KioskLayout.jsx`)**
- `MobileHeaderButtons` uitgebreid van 3 → 5 knoppen (Uit, Kasgeld, Huurder, Appt., Beheer). Layout: `flex flex-wrap justify-end`, compacte pill-buttons met icoon + kort label. Wrapt vanzelf naar 2 rijen op iPhone-breedtes (< 400px), blijft 1 rij op tablet+
- Desktop bottom bar (`step === 'select'`): 2 nieuwe gekleurde knoppen (`bg-sky-500` "Nieuwe huurder", `bg-violet-500` "Nieuw appartement") — beide alleen zichtbaar met `hasAdminAccess`
- Twee nieuwe modal-componenten `AddTenantModal` en `AddApartmentModal` (via `createPortal`, iOS-safe body scroll-lock, `items-end sm:items-center` bottom-sheet op mobiel, gecentreerd op desktop, safe-area padding op header en footer)
- `AddTenantModal` velden: Naam (required) · Telefoon (tel input) · Appartement dropdown (alleen vacante). Post naar `POST /api/tenants`
- `AddApartmentModal` velden: Nummer (required) · Huur bedrag (numeric, required) · Valuta (SRD/USD/EUR) · Omschrijving. Post naar `POST /api/apartments`
- Na succes: modal sluit + `apartmentsReloadKey` bumpt zodat `ApartmentSelect` opnieuw mount en de verse lijst fetcht

**Toegangscontrole**: knoppen zijn hidden zolang er geen `admin_token` in localStorage staat (`hasAdminAccess`). Dit sluit aan bij de bestaande Beheerder-knop en voorkomt 401's op de admin-only backend endpoints.

**Getest (self-test)**: desktop 1440×900 en mobile 390×844 (iPhone 14 Pro) — beide viewports laten alle 5 knoppen zonder overlap zien; modals openen, formulier submit maakt daadwerkelijk tenant/apartment aan en sluit. Compileerde clean.



## Latest Fix (2026-02-14 later) — Kiosk Payments Endpoint Hardening + SW v92

User rapporteerde 3× `HTTP 500` op `/api/kiosk/tenants/2d286e69-.../payments`. Root cause: die tenant bestaat niet meer sinds de preview-DB wipe (2026-02-08); daarnaast kon een resterende `company_logo_bytes`-blob in oudere docs de JSON-encoder crashen.

**Wijzigingen**
- `kiosk_tenant_payments` (server.py:10443) heeft nu een **top-level try/except**: elke onverwachte fout logt een traceback en retourneert `[]` — nooit meer een 500 vanuit dit endpoint
- **Bytes-strip** in de fallback-path zodat legacy docs met `company_logo_bytes` of andere binary velden veilig als raw doorgestuurd kunnen worden
- **Unknown tenant → 404** blijft correct (was al zo, nu geverifieerd)
- `sw.js CACHE_VERSION` → **`surirent-v92`** (invalideert stale SW-caches met oude 500-responses)

**Testing agent (iteration_58)**: 13/13 tests passed. Geverifieerd: 200 voor 3 echte tenants, 404 voor onbekende, 401 zonder cookie, geen `company_logo_bytes` in payloads, kiosk-pin + overview + notes + receipts regressie OK.



## Latest Fix (2026-02-14) — SSE latency + Kiosk broadcast + Kasgeld modal UX
Cross-replica SSE was traag (soms minuten voordat device B updates zag) door meerdere factoren die nu opgelost zijn:

**Backend (`event_bus.py` + `server.py`)**
- Tail-loop polling: **200ms → 50ms** (empty batch), burst-interval **20ms → 5ms**
- SSE handshake `event: ready` → `data: {"type":"ready"}` — client krijgt 'em via `onmessage`
- SSE heartbeat `: heartbeat` (comment, silent) → `data: {"type":"heartbeat"}` — client kan silent-dead connectie detecteren
- Middleware `/api/kiosk/` skip **opgeheven** → kiosk-medewerker mutaties (kasgeld, payments) triggeren nu ook admin SSE live-update. Alleen `customer-display` (heartbeat 1.5s) en `employee-verify` blijven uitgesloten

**Client (`admin-events.js`)**
- Debug logging via `window.__sseDebug(true)` — toont `[SSE +Xms]` met event/invalidate/refetch flow in console
- **Watchdog** — elke 10s check: >40s geen event/heartbeat + tab visible → force reconnect + `_forceFullRevalidate()` (fix voor iOS Safari silent-dead EventSource)
- `_lastMessageAt` tracking per bericht
- Skip SWR-refresh voor `type: heartbeat`/`ready`
- Cross-invalidatie voor kiosk-endpoints → admin-equivalenten: `/kiosk/kasgeld` → `/kasgeld`+`/kasgeld/balance`, `/kiosk/payments` → `/payments`+etc

**Kiosk Kasgeld Modal (`KioskLayout.jsx`)**
- **NumPad** geïntegreerd voor Bedrag → geen OS-toetsenbord meer bij bedrag invoer op iOS
- **`visualViewport` API** — modal-hoogte tracked exact aan zichtbaar viewport zodat sticky header + Opslaan-knop altijd zichtbaar blijven met keyboard open
- Full-screen bottom-sheet layout met scrollable body
- **Desktop Kasgeld-knop** toegevoegd aan onderbalk (naast Beheerder/Uit) bij `step==='select'` → medewerker op tablet/desktop kan Kasgeld ook bereiken

**Gemeten latency** (curl end-to-end op preview URL):
- POST /api/kasgeld → 200 in ~140ms
- SSE change event ontvangen: **+15-50ms** na POST-response



## Latest Fix (2026-02-13) — Plan-limieten daadwerkelijk afdwingen
De limieten & functies in SaaS Pakketten (Kiosk/OCR/Shelly/Branding/Backup) werden opgeslagen in DB maar niet gehandhaafd op de endpoints — Starter-bedrijven konden bijvoorbeeld nog steeds via Kiosk-PIN inloggen ook al stond `allow_kiosk=false`.

**Gates toegevoegd** via `_require_plan_feature` (raises HTTP 403 `plan_feature_locked`):
- **Kiosk terminal**: `POST /auth/kiosk-pin` — blokkeert PIN-login vroeg zodat geen tokens worden uitgegeven
- **Shelly stroombeheer**: helper `_shelly_or_400` (dekt `/shelly/devices`, `/apartments/{id}/shelly`, status, control)
- **White-label branding**: `PUT /companies/me/branding`
- Backup was al gegated

**Verificatie (curl)**:
- `allow_kiosk=false` → HTTP 403 met NL bericht "Kiosk terminal is niet beschikbaar op uw huidige abonnement"
- `allow_kiosk=true` → HTTP 401 (alleen PIN-verificatie faalt, plan-gate voorbij)

Wijzigingen in SaaS Pakketten hebben nu direct effect — geen restart, geen re-login nodig. De volgende feature-request (kiosk gebruiken) checkt live in `plan_catalog` via `_resolve_company_limits`.


## Latest Fix (2026-02-13) — Plan-catalog synchronisatie
Diverse bugs opgelost rond SaaS Pakketten ↔ Bedrijf-plan integratie:
- **Companies-form Plan dropdown** haalt nu dynamisch uit `/superadmin/plans` catalog (voorheen hardcoded `free/starter/pro`).
- **`_plan_for_company`** kijkt nu eerst in DB-catalog (`plan_catalog`) i.p.v. alleen `PLAN_PRICES` — nieuwe plans zoals **Lifetime (SRD 0)** krijgen nu correcte amount/currency ipv terug te vallen op starter.
- **`_billing_summary`** is async en gebruikt DB-catalog + forceert `status=active` voor gratis plans.
- **`PUT /companies/{cid}`** valideert plan-id tegen catalog (400 bij typo i.p.v. stille terugval op starter).
- **`/billing/me/plans`** leest uit DB-catalog zodat door superadmin toegevoegde plans zichtbaar zijn in "Mijn Abonnement".
- **`ChangePlanIn.plan`** accepteert nu elke string (was `Literal["starter","professional"]`) — nieuwe DB-plans mogen worden gekozen door admin.
- **Gratis plan flow**: `change_plan` activeert SRD 0 pakket **direct** zonder factuur (voorheen bleef pending_invoice hangen).
- **Seed**: nieuwe `Lifetime` (SRD 0, alle Professional features, geen einddatum) automatisch toegevoegd aan plan_catalog met `sort_order=5` zodat hij bovenaan verschijnt.


## Latest UX Fixes (2026-02-13) — InvoiceDetailPage Leesbaarheid
Op basis van gebruikersfeedback (Gopi Appartements, iPhone smalle viewport):
1. **Openstaande facturen rij is nu 2-regelig**: bedrag + factuurnr op regel 1, badges (Te laat/Deze maand/Partieel) + acties (Share, Delete) op regel 2. Voorheen werden badges + bedrag afgekapt door de 3 knoppen op één regel. Op iPhone-viewport blijft niks meer verborgen achter een ellipsis.
2. **"Registreer betaling" knop bovenaan** in de Openstaande Facturen sub-card toegevoegd (`data-testid="quickpay-top-btn"`) — direct zichtbaar zonder scrollen. De grote CTA onderaan in "Acties" blijft ook bestaan.
3. **Betalingsgeschiedenis jaren gevouwd**: `PaidHistorySection.jsx` toont jaar-headers als klikbare toggles die standaard ingeklapt zijn (ChevronRight → ChevronDown na klik). Voorkomt lange scroll bij huurders met > 6 betaalde maanden. Alleen bij klik openen de maanden per jaar.


## Latest Fix (2026-02-13) — Tegoed-herverdeling na Snelle Betaling / Historische Facturen
Wanneer een huurder een grotere betaling deed dan het toen-openstaande factuurbedrag terwijl andere facturen NOG NIET bestonden (of pas later historisch werden aangemaakt), bleef het overschot als `payments.credit_remaining` staan zonder automatisch te verrekenen bij nieuwe historische facturen. Rapport gebruiker: 15.000 SRD op mei 7.000 → alleen mei betaald, juni/juli/aug (later historisch aangemaakt) bleven volledig open.

**Backend fixes** (`server.py`):
- `create_historical_invoice` roept nu `_apply_tenant_credit_to_invoice` aan na insert → verrekent openstaand tegoed direct met de nieuwe historische factuur.
- Nieuw `GET /api/tenants/{tenant_id}/payment-audit` — diagnose-endpoint met alle payments (amount, credit_remaining, invoice-koppeling) + alle facturen (amount, paid_amount, overshoot, status).
- Nieuw `POST /api/tenants/{tenant_id}/rebalance-credits` — corrigeert eerst overshoot-facturen (paid_amount > amount) door het teveel terug op de betaling te zetten als credit, en verrekent daarna alle `credit_remaining > 0` FIFO oudst-eerst met openstaande facturen.

**Frontend** (`InvoiceDetailPage.jsx`):
- Nieuwe sub-card "Tegoeden herverdelen" met knop `RefreshCw` "Herverdeel alle tegoeden" die `POST /rebalance-credits` triggert en de payment history + open invoices ververst. Zichtbaar zodra er openstaande facturen zijn.
- Toast-melding toont exact hoeveel is verrekend over welk aantal facturen.

Regressietest: `/app/backend/tests/test_rebalance_credits.py` bewijst FIFO-verdeling van 8000 credit over juni (7000, paid), juli (1000, partial), aug (blijft 0/8500 open).


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


## Session Log — 2026-02-08 (vaste factuurdag als alternatief voor grace)
- Nieuw veld `invoicing.mode` (`grace_workdays` | `fixed_day`) + `invoicing.billing_day` (1–31). Backend `_auto_invoice_tick` en `next_auto_run`-berekening in `GET /settings` respecteren beide modi. Bij `fixed_day` wordt de dag geclamped naar de laatste dag van korte maanden (bv. 31 → 28/29 in feb).
- Frontend UI: 2 radio-tegels om modus te kiezen; het aangepaste veld (grace of vaste dag) toont conditioneel + de "Hoe werkt het?" uitleg schakelt mee. Testcurl: fixed_day=5 → next_auto_run=2026-10-05; fixed_day=31 → 2026-09-30 (clamp).


## Session Log — 2026-02-08 (invoice_date + due_date opgeslagen)
- **Voor de fix**: Factuurdatum = `created_at` (dag van aanmaak, dynamisch/inconsistent). Vervaldatum = hardcoded "15e van periode-maand". Losstaand van de admin's grace/mode-instelling.
- **Na de fix**: `invoice_date` en `due_date` worden bij aanmaak in de invoice-doc opgeslagen, berekend via nieuwe helper `_compute_invoice_dates()`. Beide velden staan in `InvoiceOut` en worden gebruikt door de PDF-renderer + `_classify_invoice_bucket` (met legacy-fallback).
- Nieuw setting-veld: `invoicing.payment_term_days` (default 14). UI: extra kolom "Betaaltermijn (dagen)" in de tab.
- Voorbeelden verifieerd via curl + PDF-render: grace=10/term=14 → aug 2026 factuur → **14 aug** / **28 aug**. fixed=5/term=7 → nov 2026 factuur → **5 nov** / **12 nov**.


## Session Log — 2026-02-08 (upcoming-invoice reminders)
- Nieuwe achtergrond-flow: elke dag rond 09:00 (Suriname UTC-3) wordt `_send_upcoming_invoice_reminders` aangeroepen. Voor elke company: pak factuur met `due_date` binnen `invoicing.reminder_days_before` dagen; stuur WhatsApp/SMS (Twilio) + email (SMTP) + push naar admins.
- Idempotency via `sent_upcoming_invoice_reminders` collectie (unique-index op `invoice_id + days_bucket`). 2× triggeren op dezelfde dag = 0 nieuwe reminders.
- Manual trigger: `POST /api/admin/run-upcoming-invoice-reminders` — geregistreerd via `@app.post` (bypass omdat `app.include_router(api)` al gebeurd is).
- Frontend Settings: nieuw veld "Herinnering (dagen vóór vervaldatum)" (default 3, 0 = uit) + paars info-paneel met **"Test nu"**-knop voor handmatige trigger.
- End-to-end verifieerd via curl (4 reminders aangemaakt in de demo, 2e trigger idempotent).

## 2026-06 — Kiosk Stripe zonder QR
- Creditcard en iDEAL op de kiosk openen nu direct de betaalpagina; de QR-flow is verwijderd.
- Creditcard: het Stripe-formulier staat direct op het kioskscherm. iDEAL: de PaymentIntent wordt op de server bevestigd en de bankpagina opent automatisch (return_url /betalen/{token}); de kiosk pollt de status.
- Getest: iteration_65 (backend 16/16, frontend E2E op desktop en mobiel)

## 2026-06 — APK print-bridge
- Na een geslaagde kioskbetaling (PaymentConfirm.submit) wordt alleen binnen de APK (als window.ReactNativeWebView bestaat) PRINT_RECEIPT {naam, appartement, bedrag, methode, datum, kwitantie} verstuurd. Getest: iteration_66.
- Update: de bon-data wordt nu opgemaakt voor printen (bedrag 'SRD 25,00', methode 'Contant', datum 'DD-MM-JJJJ UU:MM', kwitantie ook bij betaling van alleen termijnen) en eerst gelogd als console.log('[APK PRINT_RECEIPT]'). Getest: iteration_67.

## 2026-06 — Registratie-fix
- De knop Registreren op de landingspagina gaf het klik-event door als pakket-id; dat is opgelost. De registratiewizard en EmailLogin sturen nu de slug (portalPreview.slug) mee naar /auth/register. Getest: iteration_68.

## 2026-06 — Thermische bon met dynamische bedrijfsgegevens
- /api/payments/{id}/print.html?format=thermal haalt naam, slogan, adres, telefoon, e-mail en KKF op uit het bedrijfsprofiel van de betaling; zonder bedrijfsnaam wordt 'SuriRent' gebruikt. Labels toegevoegd voor CREDITCARD/IDEAL/CONTANT.

## 2026-06 — Werknemer-logins (e-mail + wachtwoord + PIN)
- Elke rol (Beheerder, Boekhouder, Kiosk) kan een PIN krijgen en de PIN is verplicht (4 cijfers, uniek binnen het bedrijf). De beheerder stelt in het werknemerformulier het wachtwoord en de PIN in, en daarmee wordt een account in db.users aangemaakt (employee_id, rol = app_role).
- Login: één keer met e-mail + wachtwoord, daarna op hetzelfde apparaat alleen de PIN (personal-pin/login). Kiosk-medewerkers krijgen na het wachtwoord de PIN-stap en daarna een kiosk-sessie, zonder toegang tot beheer. Boekhouders zien in het beheer alleen de financiële tabbladen en mogen betalingen goedkeuren of afwijzen. Inactief of verwijderd → geen login meer.
- De Werknemers-pagina is responsive gemaakt (kaarten op mobiel). Getest: iteration_69 (backend 15/15, frontend OK).

## 2026-06 — Printerinstellingen per locatie
- Instellingen → Printers (#printers): per locatie printertype (ktp/sunmi/bluetooth) en papier (58mm/80mm/aangepast 30-120mm), opgeslagen in locations.printer. API: GET /api/locations/printer-settings, PUT /api/locations/{id}/printer (alleen admin), GET /api/kiosk/printer-settings?location_id= (standaard sunmi/80mm).
- De kiosk haalt vóór het printen de instellingen van de locatie van het appartement op. PRINT_RECEIPT = {type, command: PRINT_KTP|PRINT_SUNMI|PRINT_BLUETOOTH, printer:{type,command,paper,width_mm,chars_per_line,configured}, data:{...}}. Getest: iteration_70 (backend 11/11) + handmatige controle.
- 2026-06: de print-CSS van de thermische bon is nu 58mm: @media print { @page { size: 58mm auto; margin: 2mm } body { width/max-width: 58mm } }. De schermweergave is ongewijzigd.
- 2026-06: de thermische print-CSS volgt nu de papierbreedte van de locatie (_payment_paper_width; standaard 58mm). Bij ≤60mm een compacte opmaak (lettertype ×0,78, minder witruimte, labels nowrap). Knop 'Testbon printen' per locatie: in de APK PRINT_RECEIPT met test:true, in de browser GET /api/locations/{id}/test-print.html (PROEFBON) in een printvenster.
- 2026-06 FIX: 'size: Wmm auto' is ongeldige CSS, waardoor Chrome terugviel op A4/Letter. Nu @page size Wmm 297mm als terugval, plus een script (page-fit) dat de bonlengte meet en een exacte @page-hoogte zet (DOMContentLoaded/load/beforeprint). Body bij printen W-4mm vanwege de 2mm marges. Geverifieerd via PDF: 58×85mm en 80×122mm.

## 2026-06 — Printerintegraties verwijderd
- KTP/Sunmi/Bluetooth-printerinstellingen, de endpoints en de sectie Instellingen → Printers zijn verwijderd (locations.printer is uit de database gehaald). De thermische bon heeft een vaste breedte van 58mm via @media print.
- Web: printen via iframe.contentWindow.print(). APK: PRINT_RECEIPT {type, url (print.html?format=thermal&preview=1), data}; de APK opent het systeem-printvenster (voorbeeld in /app/memory/apk-print.md). In de APK wordt geen iframe-autoprint gedaan. Getest: iteration_71.
- 2026-06: printen in de web-app via window.print() met de bon in <div id='bon'> (body-child, gevuld via /api/payments/{id}/print.html?fragment=1, met CSS gescoped onder #bon). index.css @media print verbergt alles behalve #bon; @page 58mm auto plus een JS-override met exacte hoogte (style#bon-page-size). De iframe-workaround is verwijderd. Getest: iteration_72.
- 2026-06: bon-template vereenvoudigd: bedrijfsnaam (16px), Kwitantie nr (12px), Huurder, Appartement, Bedrag (18px bold), Betaalmethode, Datum, 'Bedankt voor uw betaling'. Veldnamen 12px, rest 13px, container 54mm. @media print: html 14px, @page margin 0 (geen browser-kop/voettekst met URL). Adres/telefoon/KKF/omschrijving/saldo/opmerking verwijderd van de thermische bon. Scripts worden gestript bij het vullen van #bon.
- 2026-06: sessieduur voor alle rollen is nu 1 jaar (SESSION_MIN in auth_utils: admin/boekhouder/superadmin, kiosk, huurder, Google-sessie, cookies; device-QR-token 365 dagen). De 90s inactiviteit-uitlog in TenantKioskLayout is verwijderd. Impersonatie blijft 1 uur.
- 2026-06: 'Onthoud mij' (desktop + mobiel) slaat e-mail en wachtwoord op in localStorage. AuthProvider.refresh logt automatisch in als /auth/me faalt (autoLoginWithSaved) en daarna stuurt LoginPage door naar /admin. Na een bewuste uitlog wordt auto_login_paused=1 gezet tot de volgende handmatige login; kiosk-medewerkers (PIN-stap) loggen niet automatisch in.
- 2026-06: PWA: automatisch inloggen werkt ook in de geïnstalleerde app (getest in standalone-modus). 'Onthoud mij' staat in de PWA standaard aan. Let op: iOS-PWA heeft eigen opslag, dus de gebruiker moet één keer in de app zelf inloggen.
- 2026-06: PRINT_RECEIPT data bevat nu 13 velden uit GET /api/kiosk/payments/{id}/print-data: bedrijfsnaam, adres, telefoon (eerst van de locatie, anders van het bedrijfsprofiel), kwitantie, datum (SR-tijd), naam, appartement, vestiging, omschrijving, bedrag, openstaand, methode, opmerking. Geldt ook bij opnieuw printen (+payment_id). Getest: iteration_73.
- 2026-06: print.html (thermisch): @page { size: 58mm auto; margin: 2mm } staat buiten een media query, body is 58mm met 14px, max-width 400px is verwijderd. Ook op het scherm staat de bon direct op 58mm. Het script voor de exacte hoogte blijft (marge 2mm). PDF: 58×81mm.
- 2026-06: nieuwe opmaak van de thermische bon volgens het opgegeven formaat (naam/adres/TEL/e-mail, KWITANTIE, NR/DATUM rechts, HUURDER + appartement-vestiging-stad, OMSCHRIJVING, BETAALD groot, BETAALWIJZE, Nog openstaand, OPMERKING, 'Bedankt voor uw betaling' + nr). 12px, sheet 54mm, @media print @page 58mm auto margin 0. Adres valt terug op het adres van de locatie; stad = laatste deel van het locatie-adres (weggelaten als die al in de vestigingsnaam staat). Bank-label 'OVERSCHRIJVING'.
