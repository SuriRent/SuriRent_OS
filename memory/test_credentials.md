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

## Kiosk PIN
- **Default PIN (my-awesome-rentals-bv)**: `4321`
- **Company slug voor kiosk login**: `my-awesome-rentals-bv` (demo Rentals company)
- **Login flow**: `/login?target=kiosk` → PIN-pad
- **API**: `POST /api/auth/kiosk-pin` body `{"pin":"4321","company_slug":"my-awesome-rentals-bv"}`
- Reset PIN als 'Ongeldige PIN' error verschijnt via: `db.kiosk_pins.update_one({"company_id":<cid>}, {"$set":{"pin_hash":hash_password("4321")}}, upsert=True)` en `db.pin_throttle.delete_many({})`

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
