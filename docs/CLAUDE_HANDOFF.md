# Claude handoff: Royal Model Modern Clinic

Updated: 8 October 2026 (Africa/Cairo).
Workspace: `C:\Users\Ahmed Osama\Desktop\Landing-page\landing`.

## Start here

This is an existing clinic landing page, not a greenfield project. Preserve the frontend design and the React/Vite, Express, MongoDB, Zoho, and BotSpace architecture unless the user explicitly requests a change. Do not expose `.env`, credentials, OAuth responses, authorization headers, or customer records in logs or reports.

Two tasks were implemented locally:
1. Harden and diagnose the Zoho CRM integration.
2. Change the booking form to collect name, email, phone and service, then automatically open WhatsApp with those details after saving the enquiry.

**Where we stopped:** the latest form changes passed lint, 28 enquiry tests, and a production build. A real browser/mobile WhatsApp handoff has NOT been verified. Live Zoho OAuth was attempted earlier and failed with `invalid_code`; no real CRM Lead creation or MongoDB `synced` outcome was verified. No deployment or commit was performed in this session.

## Project map

- `src/components/contactform.jsx`: booking form, client validation, API submission, success view and WhatsApp navigation.
- `shared/enquiry.js`: supported services, normalized/whitelisted enquiry validation, WhatsApp message construction.
- `src/lib/whatsapp.js`: best-effort WhatsApp-start tracking using keepalive fetch.
- `server/app.js`: Express routes, origin checks, rate limits, validation, persistence and provider orchestration.
- `server/services/enquiryStore.js`: Mongo persistence, idempotency, atomic provider claims and status updates.
- `server/models/Enquiry.js`: Mongoose enquiry schema, CRM and BotSpace state.
- `server/config/db.js`: lazy Mongo connection using `MONGODB_URI`.
- `server/config/zoho.js`: Zoho credentials/URL config, field mappings, optional defaults, safe error class.
- `server/config/env.js`: other runtime config; re-exports `getZohoConfig` for compatibility.
- `server/services/zohoService.js`: refresh-token exchange/cache, lead search/upsert/update, sync status handling, read-only connection check.
- `server/testZoho.js`: private OAuth/read-only CRM diagnostic; never prints tokens or records.
- `server/retry.js`: retry one enquiry's Zoho sync by Mongo ID.
- `server/services/botspaceService.js`: contact/conversation preparation and separate explicit messaging helpers.
- `server/services/botspaceWebhook.js`: webhook acknowledgement; do not assume verified message ingestion.
- `server/dev.js`: local API listener, default port 3000.
- `api/index.js`: Vercel default Express export.
- `vercel.json`: Vite build to `dist`, API rewrites, SPA fallback, function maxDuration 60 seconds.
- `tests/enquiry.test.mjs`, `tests/botspace.test.mjs`, `tests/deployment.test.mjs`, `tests/production-http.test.mjs`: regression suites.
- `tests/mongo.integration.mjs`: separate opt-in database tests, not established as run in this session.

Stack: React, Vite, Tailwind, Node/Express, Mongoose/MongoDB. `package.json` declares ESM and Node 22.x.

## Current booking behavior

The user's latest implementation request was: collect name, email, phone number and service, then have the button send the booking directly into WhatsApp.

Implemented interpretation preserves the prior Mongo enquiry flow:
1. The visible form has full name, phone, email and service. Email is now required in the HTML form. The optional message textarea was removed.
2. Consent remains required, and the hidden honeypot remains. Existing styles were retained.
3. Client validation normalizes phone and email, collects attribution, and validates the clinic WhatsApp destination.
4. If `VITE_CLINIC_WHATSAPP_NUMBER` is missing/invalid, the form shows a call-the-clinic error BEFORE submitting. This is a change from the earlier optional WhatsApp continuation.
5. The button says **Book on WhatsApp**; its pending label is **Preparing your booking...**.
6. The form POSTs to `/api/enquiries` using an idempotency UUID, retaining the key for unchanged retries.
7. On successful save response it retains the four booking fields, enquiry ID and key, starts best-effort WhatsApp tracking, and calls `window.location.assign(bookingUrl)`.
8. The success view retains a WhatsApp fallback link if automatic navigation does not open the app.

The message contains clinic greeting, booking request, name, email, phone and service, followed by a request for available appointments. It excludes freeform clinical messages, database IDs, credentials and attribution.

**WhatsApp is prefilled, not automatically sent.** The visitor must tap Send in WhatsApp. This is an appointment request, not a confirmed scheduled appointment. No BotSpace outbound message is triggered by form submission.

Important remaining behavior/limits:
- Navigation waits for the API response. The backend currently awaits Zoho and BotSpace attempts after saving, so this is not instantaneous if providers are slow.
- A database/API capture failure prevents automatic WhatsApp navigation; this was intentionally left consistent with the existing save-first design.
- Shared/backend validation still permits missing email/message for compatibility; email is required by the current frontend.
- `whatsappStarted` tracks the handoff attempt, not actual message delivery.
- The local WhatsApp destination format check passed, but recipient ownership/correctness and actual device launch were not verified.

## Backend capture contract

`POST /api/enquiries` validates and persists first. Mongo persistence is the capture success boundary. It then independently attempts Zoho and BotSpace sync, catches their failures, and returns HTTP 201 with public success/enquiry ID/message. Provider failure after save must not produce an HTTP 500 solely because the provider failed.

Idempotency uses a UUID submission key plus normalized payload hash. Reuse with changed data returns 409. Atomic claims protect sync attempts. Zoho statuses remain `pending`, `syncing`, `synced`, `failed`.

Successful Zoho sync stores `zohoLeadId`, `zohoSyncedAt`, clears `zohoSyncError`, and marks `synced`. Failed sync stores a sanitized error for retry. Claims set `zohoSyncStartedAt`. Do not bypass this persistence logic.

## Zoho findings and changes

Original reported symptom: Mongo records had `zohoSyncStatus = failed` and `CRM URL configuration is invalid.`.

The exact reported error string was not found in the current checkout. The existing validator in `server/config/zoho.js` already accepted both correct .com origins and optional trailing slashes. The local environment's URL structure also matched the expected origins. Therefore the historical URL failure was NOT reproduced and its exact cause is unconfirmed. An older deployment/configuration is a possibility, not a proven diagnosis.

Implemented:
- Moved `getZohoConfig` into `server/config/zoho.js`; retained re-export from `env.js`.
- HTTPS allowlisted origin validation strips optional trailing slash and rejects paths, query strings, credentials and unsupported hosts.
- Distinct safe messages for missing config, invalid accounts URL and invalid API base URL.
- Refresh POST to `${accountsUrl}/oauth/v2/token`, explicitly `application/x-www-form-urlencoded`, using `grant_type=refresh_token`, client ID, client secret and refresh token.
- Access token stays in memory, cached with expiry margin; concurrent refreshes share a promise. Runtime config is validated even when an access token is cached.
- OAuth `api_domain`, if supplied, is validated against trusted Zoho API origins and preferred for CRM calls. Invalid/untrusted domains are rejected before transmitting an access token.
- Central CRM endpoint construction: `${apiDomainOrConfiguredBase}/crm/v8/${module}`, default module `Leads`.
- CRM authorization is `Zoho-oauthtoken <access_token>`.
- Safe operation-specific HTTP and allowlisted provider error codes, including errors inside record-level response data.
- Private `npm run zoho:test`: config validation, OAuth, minimal Leads read (`fields=id&per_page=1`), no PII/token output.

Preserved existing lead behavior:
- Search normalized phone first, then email if supplied and no match.
- Update a match; otherwise use Leads upsert with Mobile/Email duplicate fields.
- Ambiguous results are rejected rather than blindly creating duplicates.
- Core mapping: fullName -> Last_Name, phone -> Mobile, email -> Email, message -> Description; new leads use Lead_Source Website.
- Service and unmapped attribution can be included in Description. Custom fields are sent only when mapped.
- Optional `ZOHO_LEAD_STATUS` still sends a configured value on creation. The operator must confirm the value exists; no live metadata validation was added.
- Mobile uniqueness in Zoho remains an account configuration assumption for race-safe upsert.
- No automatic retry on CRM INVALID_TOKEN was added.

## Live blocker

The private live diagnostic returned:

```text
Zoho config: OK
Zoho token-refresh failed: HTTP 200 (invalid_code).
```

This proves the request reached Zoho and was rejected at OAuth; it does NOT establish why the token/client combination is invalid. No access token was obtained. The subsequent CRM read was not reached. No live Lead creation or new enquiry was performed after this failure.

Next step is to privately verify or regenerate a valid refresh token for the configured client/account and required CRM permissions. Do not ask the user to paste secrets into chat. Update local/Vercel environment privately and run the diagnostic again. Do not repeatedly submit fake enquiries while OAuth is known to fail.

Expected server settings:

```dotenv
MONGODB_URI=
ZOHO_CLIENT_ID=
ZOHO_CLIENT_SECRET=
ZOHO_REFRESH_TOKEN=
ZOHO_ACCOUNTS_URL=https://accounts.zoho.com
ZOHO_API_BASE_URL=https://www.zohoapis.com
ZOHO_LEADS_MODULE=Leads
```

The base URL must NOT include `/crm/v8`. `ZOHO_API_URL` is not an alias. Credentials must never use a `VITE_` prefix.

`VITE_CLINIC_WHATSAPP_NUMBER` is a public build-time destination, international digits only without `+` or spaces. Changing it requires rebuilding the frontend. Server settings use `process.env`; local npm scripts load `.env`, while Vercel needs its own environment configuration.

Custom `ZOHO_FIELD_*` mappings are optional. Leave unknown API names blank. Keep Lead Status blank unless the value is confirmed. Do not invent custom CRM field names.

## Verification history

After Zoho changes:
- `npm test`: 70 tests passed, zero failures, including the production HTTP suite.
- `node --test --test-isolation=none tests/enquiry.test.mjs`: 28 passed.
- `npm run lint`: passed.
- `npm run build`: passed.
- `git diff --check`: passed.
- `npm run zoho:test`: failed at live OAuth with `invalid_code` as above.

After the latest WhatsApp form/message changes:
- Lint passed.
- The 28 enquiry tests passed, including updated message assertions for name/email/phone/service and exclusion of private message/database ID.
- Production build passed; it was rebuilt again after final button/help text changes.
- Full 70-test suite was NOT rerun after this frontend change.
- No browser/mobile end-to-end test, live Mongo integration test, Vercel deployment check, or live Lead creation was completed.

Four Zoho regression tests were added for form-encoded credentials and authorization, trusted returned API domains, missing access token/concurrent refreshes, and safe read/search/create diagnostics. Existing URL/missing-credential/status/failure-isolation tests were retained/adjusted.

A broad experimental run with `--test-isolation=none tests/*.test.mjs` failed due to shared process/module environment interference (production suite returned 403). Use the project's standard `npm test` for the whole suite; the requested isolated enquiry-file command passes. During standard-suite validation a cached-config regression was found, fixed, and all 70 tests then passed.

## Working tree / files changed

Tracked local modifications from this work:
- `.env.example`
- `package.json`
- `server/config/env.js`
- `server/config/zoho.js`
- `server/services/zohoService.js`
- `shared/enquiry.js`
- `src/components/contactform.jsx`
- `tests/enquiry.test.mjs`

New file from Zoho work: `server/testZoho.js`.

Already present as untracked when this work began: `docs/PRODUCTION_500_AUDIT.md` and `tests/production-http.test.mjs`. Preserve them; do not discard unrelated working-tree changes. This handoff is another new file, `docs/CLAUDE_HANDOFF.md`. `.env` secrets were not changed by this implementation.

Older reports in `docs/` are historical. In particular, the production audit describes the PREVIOUS optional WhatsApp continuation and older test totals. This report describes the latest form behavior and verification limits; source code remains authoritative.

## Suggested continuation

1. Read this report, inspect the current diff and preserve uncommitted work.
2. Run `npm test` for the current full tree.
3. Run the frontend and API, then verify the four required inputs, consent, validation/error states, button label, successful capture and WhatsApp fallback. Check desktop and mobile handoff using approved test details. The user must still tap Send in WhatsApp.
4. Resolve OAuth credentials privately; run `npm run zoho:test` until config, OAuth and CRM API checks pass.
5. Submit an approved enquiry and verify Mongo `zohoSyncStatus: synced`, real `zohoLeadId`, and `zohoSyncError: null`; verify the corresponding Lead in Zoho. Until then, do not claim live CRM success.
6. If appropriate, retry one failed enquiry with `npm run zoho:retry -- <enquiry-id>`; this writes to CRM and is not a read-only diagnostic.
7. Configure the same server environment and public WhatsApp destination for the intended Vercel deployment, deploy when authorized, and verify production separately. No deployment success has been established here.

Commands:

```sh
npm run dev
npm run dev:api
npm run lint
node --test --test-isolation=none tests/enquiry.test.mjs
npm test
npm run build
npm run zoho:test
```

Use separate terminals for frontend/API development. Never print `.env` while diagnosing. No need to rebuild the architecture or redesign the page to finish this work.
