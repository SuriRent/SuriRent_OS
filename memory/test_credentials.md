# Test Credentials

## ⚠️ Preview database is compleet gewist (2026-02-08)
Alle geregistreerde bedrijven + hun admins zijn verwijderd. Alleen deze twee accounts blijven.

## Superadmin
- **URL**: /login (admin tab)
- **Email**: `super@surirent.sr`
- **Password**: `super1234`
- **Role**: superadmin
- **Toegang**: SaaS-overzicht, alle bedrijven, Danger Zone reset

## Demo (gedeeld)
- **URL**: /login (demo tab) of klik "Demo proberen"
- **Email**: `demo@surirent.sr`
- **Password**: `demo1234`
- **Slug**: `demo`
- **Company**: Demo Vastgoed N.V.

## Superadmin
- **Role**: superadmin
- **Email**: `super@surirent.sr`
- **Password**: `super1234` (reset 2026-02-28)
- **URL**: na login auto-redirect naar `/saas/overzicht`

## Kiosk login (gedeelde kiosk-PIN is AFGESCHAFT — alleen persoonlijke medewerker-PIN)
- ⚠️ Demo-omgeving reset elke 30 min (nieuwe employee-IDs, geen PINs). Maak Anita opnieuw kiosk-medewerker via PUT /api/employees/{id} (app_role kiosk, email, password, pin) vóór kiosk-tests.
- **Kiosk-medewerker**: Anita Sewdas — email `anita@demo.sr` / wachtwoord `anita1234` / PIN `4321` (company `my-awesome-rentals-bv`, app_role kiosk)
- **Login flow**: email+wachtwoord op /login → doorverwijzing naar `/my-awesome-rentals-bv/login?target=kiosk&view=pin` → PIN 4321
- **API**: `POST /api/auth/kiosk-pin` body `{"pin":"4321","company_slug":"my-awesome-rentals-bv"}` (matcht nu alleen medewerker-PINs)

## Tenant Portal
- **URL**: `/huurder` of `/tenant-portal`
- **Login**: per huurder via email + wachtwoord (set bij onboarding)

## Auth endpoints (httpOnly cookies, ook Bearer fallback)
- `POST /api/auth/login` — admin/staff (cookie: `access_token`)
- `POST /api/auth/kiosk-pin` — kiosk PIN (cookie: `kiosk_token`)
- `POST /api/tenant-portal/login` — huurder (cookie: `tenant_token`)
- `POST /api/auth/logout` — wist alle 3 cookies
- `GET /api/auth/me` — werkt met cookie OF `Authorization: Bearer ...`

## Wipe-all endpoint (superadmin only)
- `POST /api/superadmin/wipe-all-companies` body `{"confirm":"WIPE ALL COMPANIES"}`
- UI: SaaS Overzicht → "Danger Zone" → "Toon opties"

## Werknemer-logins (bedrijf my-awesome-rentals-bv, aangemaakt via Werknemers)
- Kiosk medewerker: `kiosk.medewerker@surirent.sr` / `test1234`, PIN `5566` → na e-mail+wachtwoord volgt de PIN op /my-awesome-rentals-bv/login?target=kiosk, daarna naar /kiosk
- Boekhouder: `boekhouder@surirent.sr` / `test1234`, PIN `6677` → /admin met alleen de financiële tabbladen
- Volgende keer op hetzelfde apparaat: alleen PIN via `POST /api/auth/personal-pin/login` {email, pin}
