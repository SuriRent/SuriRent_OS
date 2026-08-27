# RCA — Betalingen empty on production (app.surirent.sr) — user shyam@kewalbansing.net

## Verdict
**CONFIRMED: one corrupt payment document in the PRODUCTION DB is crashing `GET /api/payments` (HTTP 500), which blanks the entire Betalingen list — including the healthy older payments.** This is the same class of bug fixed on preview this morning. A redeploy alone does NOT fix it; the corrupt row must be repaired/deleted.

## Confirmed facts (production, live evidence)
- User: `shyam@kewalbansing.net` → `company_id = e485dfb7-d865-4310-9005-805125a38326` (Gopi Appartements, slug "kewalbansing").
- Prod DB: `vastgoed-app-vastgoed_kiosk` (Mongo binding correct; data is present).
- `GET /api/payments` is throwing, live pod logs (run `ffcad93d`):
  `GET /api/payments HTTP/1.1 500 Internal Server Error ×8`
  `fastapi.exceptions.ResponseValidationError: 2 validation errors` on `('response', 24, 'paid_at')` and `('response', 24, 'receipt_number')` — both `Field required`. (Index 24 = the bad row is the last of 25 in this company's list; one bad row invalidates the whole response.)

### The corrupt document (exact target)
```
payments._id = 6a900551302a81579bf45622
payments.id  = 6fdf15f2-4a61-45a3-bc80-8889fbd7f6e4
company_id   = e485dfb7-d865-4310-9005-805125a38326   (Gopi Appartements)
created_by   = shyam@kewalbansing.net
note         = "Via AI-assistent"
created_at   = 2026-08-27T09:37:21Z
status       = confirmed ; amount 1000 SRD ; tenant "Monique Treesje Pika"
MISSING: receipt_number  AND  paid_at   (both required by PaymentOut)
NOTE: this doc has NO `source` field (preview's corrupt doc had source:"ai_assistant") — it predates that field; do NOT rely on source to find it.
```

### Counts (verified read-only)
- `payments` total (all companies): 28.
- Corrupt docs for company `e485dfb7` (`$or receipt_number null / missing`): **1**.
- Corrupt docs DB-wide (`receipt_number` OR `paid_at` null/missing): **1** — the same single doc.
- Company `e485dfb7` payments: 25 (24 healthy + 1 corrupt). Demo company: 3. **SuriRent N.V. `a6f4b9d1` (admin@vastgoed.sr): 0 payments** — if the user ever logs in under that company they'll see a legitimately empty 200 list; the real data is all under Gopi Appartements.

## Root cause
`list_payments` (server.py ~L7916) scopes by the caller's `company_id` and serializes every row through `PaymentOut` (models.py L140), which requires `receipt_number: str` **and** `paid_at`. Doc `6fdf15f2…` lacks both → `ResponseValidationError` → 500 for every listing by company Gopi Appartements. The doc was written at 09:37 by the pre-fix `ai_assistant.register_payment` (raw-dict insert) while image `2d4eb8e1` was live. The committed fix stops NEW bad inserts but cannot repair this existing row.

## IMPORTANT — deployer tooling constraint
**My database access is strictly READ-ONLY. I cannot run `deleteMany`/`updateOne` or any write, and I have no shutdown/rollback lever.** The cleanup below must be performed by E1 / the user. The eph sandbox was also unavailable (pod stuck Pending / spawn timeout), so I could not statically diff the deployed `ai_assistant.py` — see item 3.

## Remediation (for E1 / user — do in this order)
1. **Repair or delete the corrupt row (unblocks prod immediately).** Target exactly:
   ```
   db.payments.deleteMany({
     company_id: "e485dfb7-d865-4310-9005-805125a38326",
     $or: [ {receipt_number: null}, {receipt_number: {$exists: false}} ]
   })   // will delete exactly 1 doc (id 6fdf15f2-4a61-45a3-bc80-8889fbd7f6e4)
   ```
   Do this via the Deployment panel → **Database (DB Manager)** on production, or a one-off migration. Preferable to *repair* (set a valid `receipt_number` from the counters sequence + `paid_at = created_at`) if the SRD 1000 payment for tenant "Monique Treesje Pika" is real and should be kept — deleting discards that payment record. Either way the list returns to 200 and the 24 older payments reappear.
2. **Harden the code so one bad row can't nuke the page.** In `list_payments`, build `PaymentOut` per-item in try/except and skip+log invalid rows (or backfill defaults, or make `receipt_number`/`paid_at` Optional). Today a single malformed document 500s the entire company's Betalingen page and dashboard cards.
3. **Confirm the AI fix is on the live image `ffcad93d`.** Verify `register_payment` (ai_assistant.py ~L250–292) now uses `PaymentIn` + `_create_payment_doc` AND that `_create_payment_doc` sets BOTH `receipt_number` and `paid_at`. I could NOT confirm this from data (no AI payment created since the 10:00 deploy) or via eph (spawn failed). If the image is stale, redeploy — otherwise the next AI-registered payment re-corrupts the list.

## Answers to the specific asks
- Corrupt docs found: **1** (id `6fdf15f2-4a61-45a3-bc80-8889fbd7f6e4`). Docs deleted: **0 — I cannot write; deletion must be done by E1/user.**
- Deploy image: `us-central1-docker.pkg.dev/emergent-default/customers-app/vastgoed-app:ffcad93d-7263-4dad-a95e-d53ba1559d35` (run `ffcad93d`, redeploy, deployed 2026-08-27T10:00:47Z). Commit hash not exposed to deployer tooling; source-level fix presence unverified (eph unavailable).
- Post-cleanup 200 confirmation: cannot be produced by me — `/api/payments` is auth-gated and I cannot delete. After E1 deletes the row, re-run the health/list check as `shyam@kewalbansing.net`.
