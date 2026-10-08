# Zoho Flow migration — 8 October 2026

## Result and cause avoided

The application's direct Zoho OAuth exchange previously returned `invalid_code`. The normal submission and private retry paths now deliver to Zoho Flow; Flow owns its CRM connection and mapping. The old token was not repaired or replaced, and no live CRM success is claimed.

Trace: `src/components/contactform.jsx` sends a validated same-origin request with an idempotency key; `api/index.js` exports `server/app.js`; the handler validates again and saves through `server/services/enquiryStore.js` / `server/models/Enquiry.js`. Only after MongoDB persistence does it attempt Flow delivery, then independently attempt existing BotSpace preparation. Each failure is contained; either or both failures still return the unchanged HTTP 201 response.

## Files changed in this refactor

- `server/services/zohoFlowService.js`: new allowlisted payload, lazy URL validation, five-second POST, redirect rejection, explicit acknowledgement contract, safe classifications, status orchestration.
- `server/app.js`: Flow replaces the direct client; browser replays only claim pending deliveries.
- `server/services/enquiryStore.js`: claim policy distinguishes public initial attempts from private recovery.
- `server/retry.js`: existing `zoho:retry` now sends to Flow, with explicit confirmation of configured idempotent CRM processing.
- `server/models/Enquiry.js`: documents reused status semantics; no schema rename or index change.
- `server/config/env.js`: exports the lazy Flow validator while retaining the legacy validator for separate consumers.
- `server/services/zohoService.js`: labels retained OAuth code as legacy; no automatic fallback.
- `.env.example`: adds empty server-only Flow URL and labels legacy settings.
- `README.md`, `docs/VERCEL_DEPLOYMENT.md`, this report: current architecture, configuration, payload, migration, reconciliation, deployment.
- `tests/zoho-flow.test.mjs`: new Flow transport, payload, timeout, error/redaction, duplicate/retry, and claim-policy coverage.
- `tests/production-http.test.mjs`: actual Vercel export with real provider clients and fake transports, including OAuth-free success, timeouts, both failure combinations, and status/claim outages.
- `tests/enquiry.test.mjs`, `tests/botspace.test.mjs`, `tests/deployment.test.mjs`: update injected integration/receipt expectations and environment checks while retaining legacy unit coverage.
- `tests/mongo.integration.mjs`: optional real-database tests updated to Flow semantics; not executed.

Pre-existing edits in package configuration, frontend, shared validation, legacy OAuth, tests, and handoff/audit files were preserved. Private `.env` / `.env.local` were not edited. BotSpace implementation and WhatsApp handoff were not changed by this refactor.

## Configuration, payload, and deployment

Add **`ZOHO_FLOW_WEBHOOK_URL`** privately in Vercel's environment settings and redeploy. Never use a `VITE_` prefix. Keep existing MongoDB and BotSpace settings.

The submission path no longer requires `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_ACCOUNTS_URL`, `ZOHO_API_BASE_URL`, or `ZOHO_API_URL`. Legacy `zoho:test` and explicitly invoked metadata helpers may still require their original OAuth settings. Legacy field-mapping environment variables are not used by Flow delivery.

The exact JSON payload and step-by-step Flow/Vercel configuration are in the [current README](../README.md#exact-webhook-payload). Its 16 fields are `enquiryId`, `submissionKey`, `fullName`, `phone`, `email`, `service`, `message`, `consent`, `landingPage`, `referrer`, `utmSource`, `utmMedium`, `utmCampaign`, `utmContent`, `utmTerm`, and `createdAt`. Optional text is empty when omitted; timestamps are ISO UTC. No internal metadata or CRM field API names are transmitted.

Create a JSON webhook Flow; configure acknowledgement on every request as HTTP 200 with `Content-Type: application/json` and `{"accepted":true}`. Connect CRM inside Flow, map actual account fields, and implement durable duplicate detection plus race-safe CRM create/upsert/update. Configure isolated Preview resources, verify there, then deploy with the server-only URL and existing database/index/BotSpace configuration. Record the cutover time.

## Verification

- `npm test`: **79 passed, 0 failed, 0 skipped**.
- `npm run lint`: **passed**.
- `npm run build`: **passed** (Vite 8.3.1).
- `git diff --check`: no whitespace errors; Git emitted normal LF/CRLF notices.
- Source/build scan: no Flow URL setting, Flow host reference, or Flow service reference in `src` / `dist`; no direct CRM service import in the API route or private retry command.
- Runtime used: host **Node 26.3.0**. Project/Vercel target remains **Node 22.x**; this run did not repeat checks under Node 22.
- No live Mongo integration test, Flow webhook, CRM write, BotSpace message, deployment, commit, or secret update was performed.

## Recovery and remaining risks

`zohoSyncStatus: synced` now means Flow acknowledged receipt, not that CRM actions finished. Old synced records retain their historical direct-CRM meaning and are never automatically replayed; `zohoLeadId` is preserved. No data migration is required, but historical pending/failed rows need review before retry.

Private retry: `npm run zoho:retry -- ENQUIRY_OBJECT_ID --idempotent-flow-confirmed`. Failed/pending and syncing records older than two minutes are eligible. Stable delivery IDs are preserved. The flag confirms an operator has verified Flow-side deduplication; it cannot enforce that remotely. Do not enable retries against an unconditional CRM create action.

Timeouts and failed local status writes can follow remote acceptance. Reconcile Flow history and the CRM record before resending. Search-then-create alone is not race-safe: configure unique CRM identities/conflict handling and a durable delivery ledger. A receipt can precede a downstream CRM failure, which must be recovered in Flow. No completion callback or scheduled retry worker is installed.

If MongoDB becomes unavailable after saving, sync status writes can fail too; inspect pending/stale records when storage recovers. Platform termination or network disconnection can still prevent the client receiving an already-durable success response. The existing per-instance limiter and BotSpace webhook-contract limitations remain.
