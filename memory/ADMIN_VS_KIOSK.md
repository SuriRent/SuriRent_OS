# Vergelijking beheeromgeving (/admin) vs Kiosk-beheer (/kiosk) — 2026-06

## Ontbreekt in Kiosk (moet erbij vóór verwijderen /admin)
### Kritiek
1. OnboardingModal (needs_onboarding na Google-registratie: portalnaam kiezen) — AdminDashboard.jsx ~4538. Kiosk toont dit niet.
2. SetupWizardSheet (startwizard als <2 van 5 setup-stappen klaar, /companies/me/setup-status) — AdminDashboard.jsx ~4390/4529.
### Facturen (Kiosk gebruikt eigen KioskInvoicesPage/KioskInvoicesModal i.p.v. admin/Invoices.jsx)
3. Ernst-filter (severity) — Invoices.jsx:33,316-325
4. Tegoed-badge + herkomst tegoed (/tenants/{id}/credit-sources) — Invoices.jsx:160-197
5. Tegoed toepassen op factuur (POST /invoices/{id}/apply-credit) — InvoiceDetailPage.jsx:66-85
6. Per-factuur e-mail/WhatsApp verzenden (SendDialog) — InvoiceDetailPage.jsx:398-513
7. KioskInvoicesPage (Beheer-tegel Facturen) mist: Herverdeel tegoed, Betaal deze factuur (QuickPayModal), PDF-download betaalde facturen (PaidHistorySection) — die zitten alleen in KioskInvoicesModal
8. Paginering (kiosk laadt max 500)
9. Deep-link vanuit meldingen/zoeken naar specifieke factuur
### Overzicht / algemeen
10. Desktop dashboard (KPI-hero, Snelle acties) verborgen in embedded Overview — AdminDashboard.jsx:1533,1860
11. Globale zoekfunctie (alle collecties) — AdminDashboard.jsx:1159; kiosk heeft alleen "Zoek huurder"
12. Bel "betalingen wachten op goedkeuring" (PendingApprovalBell, /payments/pending-count)
### Klein
13. Werknemers: desktop-tabelweergave loonstroken (kiosk toont alleen kaarten)

## Al aanwezig in Kiosk (zelfde component of beter)
Locaties, Appartementen, Huurders (+archief/uitgang), Contracten, Betalingen, Betalingsregelingen, Borg, Onderhoud, Werknemers, Meldingen, alle 10 Instellingen-secties (abonnement, bedrijf, branding, smtp, facturatie, stripe, bon, bonprinter, kiosk-apparaten, backup), NFC, Kasgeld (kiosk heeft méér: bewerken, maandgroepen, rechten).

## Alleen superadmin (blijft in /admin, niet voor kiosk)
SaaS-overzicht, bedrijven, klanten, plannen, SaaS-betalingen/facturen, OCR-goedkeuring, landing-editor, APK-releases, SaaS-instellingen.
