# Enquiry submission diagnosis — 7 October 2026

## Finding and evidence

The exact message `Unable to accept this enquiry.` originates only from the shared validator when `company_website` is non-empty. React calls this validator before fetch, so that condition can prevent any request from being sent. A direct API request with the same condition returns HTTP 400 before persistence. No MongoDB/schema failure is needed to produce this message.

Using the running API at `http://127.0.0.1:3000` with `Origin: http://localhost:5173`:

| Check | Observed result |
| --- | --- |
| Health | 200 |
| Before change, filled honeypot | 400, exact reported error |
| Before change, empty honeypot | 201, document created |
| After change, empty honeypot | 201, document created |
| Repeat after-change submission with same key | 201, same ID, one document |

This isolates the failing layer to validation, with a frontend honeypot input as the source of that field. **The original browser's reason for populating the field is not proven.** Browser discovery found no available browser; autofill/extension behavior could not be observed. The old field was a text input in an `sr-only` wrapper. It already had autocomplete off, but remained laid out offscreen. The change hardens its hiding and adds diagnostics; it does not remove spam validation or falsely claim an observed browser-autofill reproduction.

## Changes

- `src/components/contactform.jsx`: replace the honeypot's `sr-only` wrapper with native `hidden`; keep the field enabled, named, and submitted; retain autocomplete off and negative tab index; add password-manager ignore hints. Add a Vite-development-only log of the validation code and `requestSent: false`, without field values.
- `shared/enquiry.js`: add a safe `ValidationError.code`, including `honeypot_filled`; preserve the existing rejection condition and user-facing message.
- `server/app.js`: development-only route/validation/save/Zoho-stage diagnostics; production response behavior unchanged.
- `server/config/db.js`: development-only connection success/failure and missing-variable diagnostics, without URI/error body logging.
- `server/dev.js`: default `NODE_ENV` to development for the local runner, without overriding an explicit value.
- `tests/enquiry.test.mjs`: two regression tests for diagnostic codes, rejection before persistence, redaction, and absence of development logs in production.
- Documentation: this report and the latest workspace handoff update.

No BotSpace/webhook logic, database model/store logic, Vite proxy, origin rules, visible design, or environment values were changed. No packages added.

## Request and persistence path

The form uses POST `/api/enquiries`, JSON content type and `Idempotency-Key`. Field names agree with shared validation; checkbox `on` becomes boolean true, service choices use the shared enum, email is optional, and phone requires an explicit international prefix. The UUID submission key is a header, not a required JSON field. The example body value `submissionKey: "debug-test-001"` is ignored by the whitelist; that string would be rejected if used as the header. First-time requests without a header receive a server-generated UUID. Unchanged browser retries reuse their key.

The Express route parses JSON before validation/save; localhost:5173 origin was accepted in the direct test. Vite configuration targets port 3000 correctly. No Vite listener was reachable on 5173 during diagnosis, so browser/proxy end-to-end submission was not tested. Start `npm run dev` to test the page.

The store awaits connection, hashes validated input, upserts by submission key, and then attempts Zoho. The schema matches the validated fields/services. The active `.env` points to database **royal_model_clinic**, and the actual model collection is **enquiries**. No clients/integrations/message_events refactor was performed.

## Real MongoDB verification

Two clearly labeled fictional diagnostic enquiries were retained for inspection:

- Before-change empty-honeypot check: `6ac6398026527e11ecfbd82d`.
- After-change check: `6ac639f126527e11ecfbd876`.

Both exist in `royal_model_clinic.enquiries`. The second request's replay returned the same ID and a count of one. Zoho's claim timestamp and failed status confirm the post-save sync stage was attempted. Local Zoho configuration is incomplete and the BotSpace API key is absent; their failed states do not block HTTP 201 or erase the enquiry. No successful external CRM/BotSpace write is claimed.

A separate setup gap was found: this database initially had only `_id_`. Ran the existing `npm run db:setup` successfully and verified `submissionKey_1` (unique), `phone_1`, and `zohoSyncStatus_1_createdAt_1`. This protects concurrent deduplication but was not the cause of the honeypot message. No existing records were deleted or migrated.

## Validation and remaining checks

- `npm run lint`: passed.
- `node --test --test-isolation=none tests/enquiry.test.mjs`: 21 passed.
- Existing real MongoDB integration test: passed in dedicated local `royal_model_clinic_debug_test`; its own temporary test document was cleaned up by the test. It verified concurrency, deduplication, claims, tracking and retry with real MongoDB and mocked CRM.
- Final `npm test` under Node 22.23.3: 42 passed, zero failures.
- Final `npm run build` under Node 22.23.3: passed outside the previously diagnosed process sandbox restriction.

Restart the local API if it is not running through the watch script; start Vite and reload the page to replace the old form DOM. Submit with consent and an international phone. If the same message reappears, the development console will report `honeypot_filled` without logging its value; determine which autofill/extension or interaction populated it. Browser behavior remains the unverified part. No blocker was observed for valid direct API submissions; live Zoho/BotSpace setup remains outstanding independently of capture.
