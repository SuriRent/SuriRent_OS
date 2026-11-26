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
It also starts the actual app container against the isolated replica and checks
the app's MongoDB driver and transactions across database and app restarts.
This does not test the Coolify deployment, real data, or the payment flow.

`deploy/coolify-replica-test.yml` also has a `rehearsal` profile for a
standalone synthetic source and separate source/target app containers. The CI
workflow restores a synthetic dump to the isolated replica, starts the target
app, restarts the database, and returns to the standalone source before
customer writes. Never use this profile with an existing volume, customer data,
real credentials or a real backup. It does not execute or validate a Coolify
cutover; rollback after writes requires separate reconciliation.

The same workflow also rehearses stopping a standalone MongoDB, converting its
isolated test volume to a replica set, and checking existing data, its unique
index, transaction commit and rollback, and a restart. This is not a migration
of a Coolify volume and does not establish that the Coolify setup is compatible.
Another isolated rehearsal dumps a synthetic application database, restores it
to a fresh volume, and converts only the restored copy while checking that the
standalone source remains unchanged. It starts the app against the restored
replica, then stops it and starts an app against the original standalone source.
This models a rollback before customer writes, not a way to recover changes
made after cutover: switching to an older source would lose those changes.
The test uses synthetic data and separate volumes, and the app itself may create
startup records. It does not back up database users or prove the safety of a
Coolify migration.

Before any sandbox migration, the operator must identify the exact Coolify
resource and MongoDB volume, arrange a maintenance window, and verify a fresh
MongoDB backup and its restore into a separate private target volume. The target
may be the intended sandbox replica; no additional test restore is required if
the target is checked against the stopped source before any app uses it. Stop
all application and background writes before the final backup and conversion.
Keep the existing credentials and encryption settings; store a new replica key
securely and retain it across restarts. Rehearse the Coolify-specific procedure
with synthetic data before changing the sandbox. Confirm that the volume,
indexes and data are preserved, authentication succeeds, transactions commit
and roll back, and the database and app restart successfully.

Prepare a rollback before starting: preserve the backup and restore it into a
separate fresh volume if rollback is needed. Do not start a replica-converted
volume as a standalone database or use the isolated test overlay on the live
volume without a reviewed migration plan and explicit approval. A single-member
replica set enables transactions but does not provide high availability. This
database rehearsal alone is not sufficient to enable SMS checkout.

#### Sandbox cutover design (not an execution procedure)

The current Compose stack addresses its standalone database as `database` and
stores it in `mongo_data`. The intended cutover keeps that service and volume
unchanged and creates an authenticated replica on a **different, new** volume
and a distinct Compose service hostname. The replica must advertise that
hostname, not `localhost`; the app's MongoDB URI must use that hostname and
`replicaSet=rs0`. The existing test template is not the sandbox configuration.
The exact Coolify configuration and cutover sequence still need to be reviewed
and rehearsed before use.

Coolify container labels can point at a temporary `/artifacts/...` build
directory that no longer exists. Do not edit that path or run a replacement
Compose project from it. Identify and change the managed Coolify resource and
its persistent source configuration instead, after the procedure has been
reviewed and approved.

`deploy/coolify-cutover-rehearsal.yml` is a synthetic-only Compose overlay for
testing this same-stack topology with a separate `replica_data` volume and
`replica-database` hostname. Its CI rehearsal uses a disposable project and
test credentials and does not bind replica scripts from the temporary build
directory; it must never be applied to an existing Coolify resource or volume.
It is not an approved sandbox migration configuration.

`docker-compose.sandbox-cutover.yml` is a separate **candidate** Git-based
Compose configuration, not an instruction to deploy. It preserves the
`database` service and `mongo_data` volume, adds a separate replica volume,
and defaults the app to the original database. Its replica requires a retained,
secret `MONGO_REPLICA_KEY`. The app uses the replica only when both
`CUTOVER_DATABASE_HOST=replica-database` and
`CUTOVER_DATABASE_QUERY=&replicaSet=rs0` are set. Neither setting, a deployment,
nor customer payments are enabled automatically. Verify the Coolify-generated
Compose, volume names and persisted key before any approved deployment. The
candidate starts an app by default, so block traffic and stop writers as needed;
never deploy the target settings before the target restore is verified.

1. Agree on a maintenance window, inventory every writer and integration, and
   stop them. Check Coolify's auto-deploy and queued or running deployments:
   a push to the tracked branch can redeploy the app and resume writes. With
   explicit operator approval, prevent automatic and manual deployments
   during the window and verify no deployment is in flight. Record the
   original setting so it can be restored afterwards. Keep SMS checkout and
   payment reminders disabled. Verify that no writes can reach the source
   while the final backup is made.
2. Make a fresh consistent application-database backup and verify a restore
   privately. Preserve the source volume, database credentials, encryption
   settings and the replica key separately and securely; an application-only
   dump does not contain MongoDB users or server configuration.
3. Initialize the new replica with the intended credentials and restore only
   into its confirmed empty database. Before starting an app against it,
   compare data and indexes, verify authentication, commit and abort
   transactions, and check restart and network reachability. Keep real
   integrations and background jobs from sending while verifying.
4. With users still blocked, point the app to the new replica and check its
   database connection and restart. Startup itself can write data. Do not
   enable customer payments or SMS reminders until the complete payment flow
   has been verified and separately approved.
5. Before any writes that must be retained, rollback means stopping the target
   app and pointing the original configuration back to the untouched source.
   Preserve both volumes and the backup. Once any such writes or provider
   requests exist on the new side, do not switch back to the older source
   without reconciling and preserving them first.

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
The first planned release is Stripe only. Mopé is separately disabled for SMS
checkout even when enabled elsewhere; a later release requires its own real
provider test and review.

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
review and cannot yet be safely unlocked through the UI. An uncertain Stripe
confirmation switches the SMS checkout to status verification rather than
starting another payment. Stripe currently accepts EUR
or SRD with a current configured rate; USD and amounts below the Stripe minimum
are rejected, not silently converted or increased.

The in-development booking code supports individual invoices without an active
plan and specific installments on consistent plans. Inconsistent balances,
pending installment payments, or overlapping plans require manual review.
It requires MongoDB transactions. The Compose database
above is a standalone MongoDB instance, so it cannot run this booking code.
Before reserving an SMS checkout, the app checks that MongoDB reports a
replica-set primary or sharded router with sessions. This early check prevents
a standalone deployment from leaving a reservation, but does not prove that
transactions or booking will succeed; the transactional preflight still runs
before contacting the payment provider.
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
For the separate opt-in browser test, set the environment variable
`SMS_STRIPE_TEST_PUBLISHABLE_KEY` to the matching `pk_test_...` key in that
same GitHub Actions environment. On a trusted branch, run the workflow with
`run_stripe_browser_test` enabled. The browser test uses synthetic records,
a disposable local replica set and a EUR 1.00 Stripe test-mode payment. It
starts with a manual reminder request and checks the generated 160-character
SMS and scoped link, but intercepts the Messente HTTP request locally: no
actual SMS is sent. The browser opens the link's token on the local test server,
not the public domain. The test does not exercise the Coolify deployment or
enable checkout for customers.
The manual invoice-reminder SMS integration is prepared behind both
`_SMS_CHECKOUT_READY` and the separate `_SMS_PAYMENT_REMINDERS_READY` gate,
which remain false. When enabled, it checks the tenant and each invoice,
creates a scoped payment grant and sends the selected 160-character tone.
The templates use complete optional sentences rather than trailing-space
padding, which may be stripped during delivery. They fail closed if a
160-character message cannot be formed without truncating the payment link.
Actual delivery and the received character count still require verification.
Existing reminders continue unchanged while the gates are off. The upcoming
invoice SMS reminder is also prepared behind these gates: it claims the
existing unique invoice/day marker before sending, so a crash or uncertain
send is not automatically retried. Overdue installment SMS reminders use a
company-scoped, per-tenant daily claim and include only the selected overdue
terms. Both marker types remain claimed on crashes and must be investigated
before any manual retry; acceptance is not proof of delivery. Claims are
included in company backups, but restoring an older backup can lose later
claims: pause reminders and reconcile delivery history before resuming.
The manual overdue SMS route only creates a link when the tenant's calculated
arrears exactly match scoped overdue rent invoices, with no active plan, and
only sends it to the tenant's stored number. Otherwise it requires manual
review. Ordinary invoice messages remain unchanged. Actual Messente delivery
has not been verified. Do not enable either gate solely on the basis of the
isolated browser test.
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
The old startup task that guessed invoice links and marked invoices paid has
been disabled. Rent payments without a direct invoice link may need manual
review; SMS checkout conservatively blocks the affected tenant, including
payments that have other allocation links, until the records are reconciled.
Startup logs a warning if such records exist, but does not change them.
Archived-tenant debt settlement, permanent deletion and reactivation now
also acquire the tenant guard and recheck the archived tenant while holding it.
If a change fails after it starts, its `archived_debt`, `tenant_deletion` or
`tenant_reactivation` guard remains for manual review. These legacy operations
are not transactional: reconcile any partial changes before retrying.

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
