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

### Isolated MongoDB transaction test

`docker-compose.replica-test.yml` is an opt-in overlay for a **new, isolated
test database**, not an automatic migration of the Coolify database. It starts
a single-member authenticated replica set; this supports transactions but is
not highly available. Never apply it to an existing volume without a separately
planned backup, restore test and migration.

Set all required variables from `.env.example`, including a stable, private
`MONGO_REPLICA_KEY` generated with `openssl rand -base64 48`. Use test-only
credentials and a unique Compose project name so its volume is isolated:

```sh
docker compose -p surirent-replica-test -f docker-compose.yml -f docker-compose.replica-test.yml up -d database replica-init
docker compose -p surirent-replica-test -f docker-compose.yml -f docker-compose.replica-test.yml logs replica-init
```

The initializer must finish successfully and report `Replica set is ready`.
The app's overlay configuration waits for initialization and uses the replica
set URI. Preserve the same key and credentials across restarts. Do not copy
production or sandbox data into this test environment. The isolated CI workflow
checks authentication, transaction commit and rollback, and a database restart;
it does not verify the deployment database or activate SMS checkout.

## WhatsApp and SMS (Messente)

In Kiosk Beheer, open **Instellingen > WhatsApp & SMS (Messente)**. Each company
has its own Messente configuration under `company_settings.messente`.
Enter the API username and API password from Messente (not the dashboard
login), the registered WhatsApp sender and/or the approved SMS sender name
or number. Both API credentials are encrypted at rest and masked in settings
responses. Blank or masked credentials on save retain the stored values.

The previous Twilio integration is no longer used. Existing Twilio settings
are left untouched in the database, but are not exposed or read for messaging
and are never treated as Messente credentials. Companies must configure and
enable Messente explicitly. Coordinate any existing WhatsApp number migration
with Messente before removing it from the previous provider.

Configure `APP_PUBLIC_URL` as the public HTTPS app origin so images and links
work outside the kiosk. Sending uses `POST https://api.messente.com/v1/omnimessage`
with HTTP Basic authentication and JSON. SMS uses `autoconvert: off` to preserve
the original text; Unicode and long messages can cost multiple SMS segments.

### Text templates

Connect a WhatsApp Business Account to Messente and create approved templates
through Messente or Meta WhatsApp Manager. Save the **template names**, not
Twilio Content SIDs. Set the exact language code (for example `nl` or `en_US`);
all configured templates must use that language. Use exactly these five
positional body variables for receipt and reminder text templates:

| Variable | Value |
|----------|-------|
| `{{1}}` | Tenant name |
| `{{2}}` | Company name |
| `{{3}}` | Amount including currency |
| `{{4}}` | Receipt number, invoice number, period or installment reference |
| `{{5}}` | Receipt/invoice image URL, or tenant portal URL for grouped reminders |

Example receipt: `Hallo {{1}}, {{2}} heeft uw betaling van {{3}} ontvangen. Referentie: {{4}}. Bekijk uw betaalbewijs: {{5}}. Bedankt.`

Example reminder: `Hallo {{1}}, een betalingsherinnering van {{2}} voor {{3}}. Referentie: {{4}}. Bekijk de gegevens: {{5}}. Neem contact op bij vragen.`

Save the approved names in the receipt and reminder fields.
Configured templates are used for kiosk receipts, manually sent receipts and
invoices, paid installment notifications, and manual/automatic payment reminders.
The fixed template replaces free text (including any custom message); the link
replaces the separate media attachment. An empty template name retains
service-message sending, which requires an open 24-hour WhatsApp customer-service
window. Contracts, signature links and power notifications use service messages;
send these within the window or use SMS. Signature requests and tenant PIN
recovery retain their SMS fallback when WhatsApp is rejected synchronously.

Obtain the recipient's WhatsApp opt-in before enabling automatic messages.
Save settings, enter a receiving number with country code, select SMS or
WhatsApp and optionally a template under **Testbericht**, then test.
Messente acceptance is not proof of delivery. The kiosk's **SMS-status** page
shows the last 100 company SMS messages recorded after this feature is deployed.
When `APP_PUBLIC_URL` is a publicly reachable HTTPS origin, SMS requests include
a delivery-report callback; reports are authenticated using Messente's HMAC
signature and the API password used to send the message. Keep the route
`/api/public/messente/sms-status/` reachable from Messente. If the origin is
not configured, the overview shows that delivery status is unavailable.
Messages sent before this feature cannot be reconstructed. Message bodies,
PINs, and recovery codes are not stored in the overview.
No automatic request retries are performed: after a network timeout, check
Messente before resending to avoid duplicates. Switching provider does not
remove Meta restrictions or the 24-hour window.

### SMS payment links (in development)

The experimental payment-link checkout is not connected to reminder sending
and remains disabled. Do not send these links to customers until all payment
paths, database transactions and real provider flows are verified end to end.

The in-development attempt journal reserves at most one SMS checkout per
company and tenant and leaves uncertain provider requests blocked for
investigation. A successfully booked attempt can be archived and released
atomically, preserving idempotent retries.
The in-development Stripe and Mopé adapters create requests
and check provider status against the reserved amount and identity. Before
creating a provider request, they check that the reserved invoice or installment
is currently bookable using the same rules as booking. This check is a snapshot,
not a lock, and cannot prevent subsequent changes by other payment flows.
Pending payments and payments currently being approved or rejected for that tenant cause the SMS attempt
to fail closed until they are resolved. An earlier Stripe or Mopé request is
allowed only when a single matching approved payment and its full invoice
allocations can be verified against the request and current invoice balances.
Ambiguous, partially booked, unallocated, or still-open requests remain
blocked for review. Cancelled Stripe requests are excluded as before. This
conservative check does not repair or unlock older inconsistent records.
Existing provider checkouts and other payment flows still require coordination.
The adapters are
not connected to the existing kiosk or tenant-portal payment flows and do not
resolve overlaps with those flows.

Existing Stripe intents are now claimed consistently across kiosk and tenant
portal bookings: a partial tenant booking blocks kiosk consumption, and a
kiosk claim blocks tenant consumption. Tenant installment payments record the
Stripe intent ID; older installment payments may lack it and require review.
The claim and subsequent payment allocation are still separate writes, so a
failed or interrupted booking requires reconciliation and is not proof of a
fully booked provider request.

The reconciliation function can resume an open, verified or booked attempt,
verifying the provider before booking and preserving uncertain attempts for
manual investigation. A bounded background scanner can recover such attempts
even after a link expires or the browser closes; it starts only when checkout
is enabled. Public callers must authorize the exact attempt.

The experimental checkout orchestrator accepts only an item authorized by an
unexpired SMS grant, derives its amount from the database, and checks the
provider before booking. Its public start and finish endpoints and the checkout
UI are hard-disabled. The experimental UI stores a pending attempt in the
browser session, uses a token-free provider return URL, and shows confirmation
only after server verification. Lost or uncertain attempts may require manual
review and cannot yet be safely unlocked through the UI. Stripe currently accepts EUR
or SRD with a current configured rate; USD and amounts below the Stripe minimum
are rejected, not silently converted or increased.

The in-development booking code supports individual invoices without an active
plan and specific installments on consistent plans. Inconsistent balances,
pending installment payments, or overlapping plans require manual review.
It requires MongoDB transactions. The Compose database
above is a standalone MongoDB instance, so it cannot run this booking code.
The `SMS payment transaction tests` GitHub Actions workflow starts a separate,
disposable replica set for the booking tests; it does not migrate or access the
deployment database. Run it after pushing the branch and inspect its result.
The opt-in Stripe test exercises the backend checkout with Stripe's test API and
an isolated MongoDB replica set. Configure the GitHub Actions environment
`SMS_STRIPE_TEST_SECRET_KEY` with an environment secret of the same name holding
a Stripe **test** secret key (`sk_test_...`); the workflow rejects live keys.
Only on a trusted branch, manually run `SMS payment transaction tests` with
`run_stripe_test` enabled. This also runs the regular transaction tests.
The test creates a EUR 1.00 test-mode PaymentIntent using
Stripe's test payment method; no real charge is made. The test does not send an
SMS, exercise the browser or use the deployment database, and passing it does
not make the checkout ready for customers. Never put keys in the repository,
workflow inputs, chat or logs.
The existing payment paths also need coordination before checkout can be
enabled; do not treat the booking code as an active or complete integration.
The planned coordination blocks other bookings for the same company and
tenant while an SMS checkout is open. An interrupted or uncertain operation
must remain blocked for investigation; guards must not expire automatically.
The experimental SMS provider code now acquires the guard before contacting
the provider and releases it transactionally after booking or cancellation
before the provider request starts. An unstarted reservation rejected by its
initial preflight or a conflicting guard is also cancelled transactionally,
without releasing another operation's guard. The bank reconciliation registration route also acquires
the tenant guard before claiming a statement or creating a payment. Allocation
or plan-sync failures are reported instead of being treated as success, and an
uncertain bank registration retains the guard and statement for manual review.
The guard records `operation=bank_reconciliation` and the statement ID. Do not
clear it or retry the booking without reconciling the payment, invoice,
installments and statement first; there is no automated recovery UI yet.
Several other payment paths still do not acquire the guard; this is not yet safe
interoperation and checkout must remain disabled.

Manual, notification and OCR approvals and rejections now acquire the tenant
guard before claiming the payment. If an operation fails, its guard and the
`approving` or `rejecting` state remain for investigation rather than being
retried automatically. The guard records `operation=payment_approval` or
`payment_rejection` and the payment ID. Verify invoice allocations and plan
installments before any manual repair; there is no automatic recovery
interface. The payments screen shows these legacy guards (including a bank
guard without a payment) for the active company, without providing an unsafe
unlock action. Replica-set tests run in the isolated CI workflow; a successful
test run does not establish that the deployed database supports transactions.
Payment reassignment also holds the guard while updating the payment and both
invoices. A partial failure retains a `payment_reassignment` guard with the
payment ID for investigation; do not retry before reconciling all three.
Admin, kiosk and tenant-portal payment creation also acquire the guard before
consuming Stripe or Mopé and retain a `payment_creation` guard on failure.
The guard stores the planned payment ID and, when applicable, the provider
reference for reconciliation. Provider validation failures after acquiring
the guard also require review; there is no automatic unlock.
Stripe and Mopé request creation also hold the tenant guard until the local
request is recorded. An uncertain request retains a `stripe_request` or
`mope_request` guard with the local request ID. Stripe uses that ID as an
idempotency key and metadata; Mopé includes it as its order ID. Check the
provider and local records before manual recovery.
Admin, kiosk and tenant-portal installment payments hold the tenant guard
before consuming a provider payment and through allocation and plan updates.
Failed or interrupted payments retain an `installment_payment` guard with the
planned payment ID. Review the provider, installment, payment and linked
invoices before any manual repair; there is no automatic unlock.
Kiosk Stripe installment booking requires and consumes a matching completed
intent for the full installment amount under this guard. Kiosk selections
containing installments cannot start a Stripe or Mopé checkout with multiple
items; each installment must be paid separately until combined booking is safe.
Admin and kiosk plan creation and admin plan cancellation also use the tenant
guard. A failed change retains a `payment_plan_change` guard and plan ID;
inspect the plan and all its installments before manual recovery.
Deleting a payment also holds the tenant guard while linked invoices and
installments are changed. Failures retain a `payment_deletion` guard for
review. SMS payments and current plan-installment payments cannot be deleted
through this endpoint because their linked booking state cannot be safely
reversed there.
Manual credit application, credit redistribution, historical invoices and
monthly invoice generation hold a `credit_reconciliation` guard while
allocating credit. An interrupted or inconsistent operation remains blocked;
inspect the invoice, payment allocations and credit before manual recovery.
Rebalancing stops if an overpaid invoice needs review. The overpayment-repair
endpoint holds the tenant guard and updates invoice balances, allocations and
credit in one transaction. It applies only when one non-provider payment and its
full allocation can be proven; provider payments, active plans and ambiguous
legacy records require manual review. A failed or uncertain transaction keeps
the guard. The dry run is only an estimate, not proof that repair can run.
In a batch, earlier invoice repairs can already be committed if a later one
fails; the error reports this and callers must review before retrying.
Kiosk invoice fines and invoice deletion also acquire an `invoice_change`
guard. Interrupted changes retain the guard for investigation; deletion checks
direct, multi-invoice and allocation payment references before removing an
invoice. Other invoice and tenant mutations are not yet all coordinated.
Tenant move-out now holds a `tenant_move_out` guard through deposit allocation,
invoice archival and tenant archival. Interrupted processing retains the guard;
reconcile the deposit, payment, invoice allocations and tenant before repair.
Ordinary tenant deletion also holds a `tenant_deletion` guard and verifies that
the apartment still belongs to that tenant before clearing it. A failure keeps
the guard; inspect both the tenant and apartment before manual recovery.
Invoice balance recomputation also holds an `invoice_change` guard. It uses
recorded allocations instead of counting an entire payment per invoice, and
rejects ambiguous legacy allocations, unexplained balance reductions and
active payment plans for review.

The link is a bearer credential valid for 30 days. Nginx disables access
logging for `/b/` and sends no-store, no-referrer and noindex headers for that
page; the API receives the token in a header rather than its URL. Configure
any upstream proxies, CDNs, monitoring and error-reporting systems not to log
the `/b/` path or the `X-Sms-Payment-Token` header. The link can still appear
in browser history and in the recipient's SMS. MongoDB removes expired grants
using a TTL index; the API checks expiry independently of TTL cleanup.

### Receipt image template

For a JPG directly in WhatsApp, create a utility template with an **image header**
and exactly four body variables `{{1}}` to `{{4}}` with the meaning above.
Do not put `{{5}}` in the body and do not add a dynamic URL button.
The settings screen shows the public fictional JPG at
`https://<APP_PUBLIC_URL host>/api/public/whatsapp-receipts/sample.jpg`
for approval/testing; upload it as the header sample if required by Meta.

Example body: `Hallo {{1}}, uw betaling aan {{2}} van {{3}} is ontvangen.
Uw betaalbewijs met referentie {{4}} vindt u als afbeelding bij dit bericht.
Bedankt.`

Save the approved media template's name in **Betaalbewijs als afbeelding**.
It takes priority over the receipt text template. SuriRent supplies the full
signed JPG URL as the header image parameter, not as a body variable.
The token expires after 24 hours and responses are not cached. Test using
**Betaalbewijs-afbeeldingstemplate** to send the fictional sample. Payment
plan notifications without a linked payment fall back to the receipt text
template if configured; otherwise they cannot use the image template.
The existing public receipt-image endpoint is unchanged; the signed URL does
not revoke previously shared URLs.
The signed URL is a bearer link: anyone holding it can access the image while
it is valid, including anyone with access to proxy or server access logs.

### Platform configuration and password recovery

Superadmin **Instellingen > WhatsApp & SMS (Messente)** provides an independent
platform account with encrypted credentials and its own Save and Test buttons.
Only superadmins can read, save or test this configuration. Company messaging
continues to use company credentials, not the platform account.

The kiosk's **Wachtwoord vergeten** offers **E-mail** or **SMS**. SMS recovery
uses the enabled company Messente account, otherwise the platform Messente
account. An enabled company account that rejects a send is not retried through
the platform account. The recipient is the account's stored phone number, or
the company contact phone when the account has none. Accounts without a company
must have their own stored phone number. Missing/failed delivery is logged
without exposing recovery codes; the public response stays generic to avoid
account enumeration. SMS recovery does not require a WhatsApp template.

### Tenant PIN recovery

Optionally configure an approved **authentication** template with the code as
the single body variable `{{1}}` and a **copy-code** button at index 0. SuriRent
sends the code both in the body and the button's URL parameter as required by
WhatsApp authentication templates. This template is used for tenant PIN
recovery. Without it, WhatsApp PIN recovery requires an open service window.
Tenant PIN recovery retains the company's SMS fallback.
