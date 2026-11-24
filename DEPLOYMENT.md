# SuriRent deployment on Coolify

This repository includes a Docker Compose stack for Coolify with three services:

- `web`: the React single-page app, served by Nginx and proxying `/api` requests to the API.
- `app`: the FastAPI backend.
- `database`: MongoDB 7 with persistent storage.

## Deploy

1. Create a Docker Compose resource in Coolify for this repository and select `docker-compose.yml`.
2. Set the required environment variables from `.env.example` in the resource's environment settings. Generate unique secrets; for example, use `openssl rand -hex 32` for `JWT_SECRET`, `PDF_AES_PASSWORD`, and `MONGO_ROOT_PASSWORD`. Use hexadecimal characters for the MongoDB password so it is safe in the connection URI. Keep MongoDB credentials and encryption secrets stable for this database.
3. Configure both public domains on the Coolify `web` service using container port `80`: the marketing hostname (for example, `https://example.com`) and the app hostname (for example, `https://app.example.com`). Do not assign a public domain to the internal `app` API service.
4. Set `APP_PUBLIC_URL` and `APP_PUBLIC_HOST` to the app domain, `CORS_ORIGINS` to both origins separated by a comma, `REACT_APP_MARKETING_HOST` to the marketing hostname without a scheme, and `REACT_APP_APP_URL` to the full app URL. Leave `REACT_APP_BACKEND_URL` empty so each domain uses the same-origin `/api` proxy.
5. Coolify supplies HTTPS and routes both hostnames to Nginx on `web`; Nginx serves the frontend and forwards API and WebSocket traffic internally to `app`.
6. Deploy. MongoDB data is stored in the `mongo_data` volume and survives container replacement.

The API starts with one worker because background jobs and PIN throttling are process-local. The admin account's password is synchronized from `ADMIN_PASSWORD` at each startup; keep that value as the source of truth. The superadmin is created once from `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD`. Set the optional `SUPERADMIN_PIN` in Coolify to bootstrap a four-digit PIN when creating the superadmin or when its database record has no PIN hash. The value is hashed before storage and does not overwrite an existing PIN; remove it from Coolify after the first successful startup. If the database already has a PIN hash, changing this variable will not reset it. If you are reusing an existing database with the old seeded superadmin, change its password before exposing the deployment.

Optional third-party integrations (AI, Stripe, push notifications, SMTP) are disabled or unused until configured. Their corresponding variables are present as empty placeholders in `.env.example`; configure only the integrations you use.

## Operations

Use the Coolify resource to redeploy, inspect logs, and restart services. Back up MongoDB regularly; the named volume is persistent storage, not a backup. Before restoring or moving data, back up the `mongo_data` volume using `mongodump` with the configured MongoDB root credentials.

The public health endpoint is `https://<your-domain>/api/health`.

## WhatsApp templates (Twilio)

In Kiosk Beheer, open **Instellingen > WhatsApp (Twilio)**. Each company uses its
own Twilio account and WhatsApp sender. Configure `APP_PUBLIC_URL` as the public
HTTPS app origin so receipt and invoice links work outside the kiosk.

Create two text templates in Twilio Content Template Builder and obtain WhatsApp
approval. Use exactly these five variables in both templates:

| Variable | Value |
|----------|-------|
| `{{1}}` | Tenant name |
| `{{2}}` | Company name |
| `{{3}}` | Amount including currency |
| `{{4}}` | Receipt number, invoice number, period or installment reference |
| `{{5}}` | Receipt/invoice image URL, or tenant portal URL for grouped reminders |

Example receipt: `Hallo {{1}}, {{2}} heeft uw betaling van {{3}} ontvangen. Referentie: {{4}}. Bekijk uw betaalbewijs: {{5}}. Bedankt.`

Example reminder: `Hallo {{1}}, een betalingsherinnering van {{2}} voor {{3}}. Referentie: {{4}}. Bekijk de gegevens: {{5}}. Neem contact op bij vragen.`

Save the approved `HX...` Content SIDs in the receipt and reminder fields.
Configured templates are used for kiosk receipts, manually sent receipts and
invoices, paid installment notifications, and manual/automatic payment reminders.
The fixed template replaces free text (including any custom message); the link
replaces the separate media attachment. SMS and unrelated WhatsApp messages
(such as PIN recovery or contract signing) retain their existing behavior.
An empty SID retains free-text sending, which requires an open 24-hour WhatsApp
customer-service window.

Obtain the recipient's WhatsApp opt-in before enabling automatic messages.
Save settings, enter a receiving number with country code, choose a template
under **Testbericht**, then test. Twilio acceptance is not proof of delivery;
check the message status in Twilio Console. SuriRent cannot grant template
approval or bypass WhatsApp's messaging window.

### Receipt image template

For a JPG directly in WhatsApp, create and submit a separate `twilio/media`
image template. Use variables `{{1}}` to `{{4}}` in its body with the same
meaning as above. Set the media URL to
`https://<APP_PUBLIC_URL host>/api/public/whatsapp-receipts/{{5}}`:
replace the host with the exact HTTPS origin shown in the kiosk settings.
Enter `sample.jpg` as the sample value for `{{5}}`; this resolves to a public
fictional JPG for template approval. Do not put `{{5}}` in the message body.
Enter samples for the other variables and submit for WhatsApp approval.
Sandbox senders have their own template restrictions.

Example body: `Hallo {{1}}, uw betaling aan {{2}} van {{3}} is ontvangen.
Uw betaalbewijs met referentie {{4}} vindt u als afbeelding bij dit bericht.
Bedankt.`

Save the approved media template's SID in **Betaalbewijs als afbeelding**.
It takes priority over the receipt text template. SuriRent passes a signed
payment-specific token followed by `.jpg` as `{{5}}` for Twilio to retrieve the image; the token
expires after 24 hours and responses are not cached. Test using
**Betaalbewijs-afbeeldingstemplate** to send the fictional sample. Payment
plan notifications without a linked payment fall back to the receipt text
template if configured; otherwise they cannot use the image template.
The existing public receipt-image endpoint is unchanged; the signed URL does
not revoke previously shared URLs.
The signed URL is a bearer link: anyone holding it can access the image while
it is valid, including anyone with access to proxy or server access logs.
