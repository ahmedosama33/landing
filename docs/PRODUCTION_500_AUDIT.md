# Production submission HTTP 500 audit

8 October 2026. Inspected the current working tree; production settings, deployed source revision, response body, and Vercel Runtime Logs were not available. The supplied browser message only establishes HTTP 500. No secrets were read from `.env` or printed. No remote database, CRM, BotSpace, or WhatsApp operations were performed.

## Finding and classification

**The current production root cause is not confirmed.** No reproduced provider-error or entrypoint defect explains the 500. Existing provider failures are isolated after capture. Configuration/runtime failure is a candidate, not a proven diagnosis; there is insufficient evidence to classify the incident as code, configuration, or both.

Two failure classes were reproduced using the actual production export:

1. Initial persistence throws: generic JSON 500; no provider calls.
2. Invalid `ALLOWED_ORIGIN` (for example an origin with a `/contact` path): generic JSON 500 before capture. This also breaks `/api/health`, even without an Origin header, because validation is unconditional middleware. Correct the setting rather than weakening origin validation.

Missing provider credentials, Zoho `invalid_code`/`invalid_client`, provider HTTP/network failures, and failed post-save claims/status writes all return 201 in tests. The prior saved production record with failed integrations is consistent with this design, and demonstrates only that the earlier deployment could save at that time.

The IDE selection shows a local loopback MongoDB URI. That is appropriate only for a local MongoDB instance. **If** that URI was copied to Vercel, `MONGODB_URI` must be replaced there with the intended Atlas connection string. There is no evidence that it was copied, so this is not asserted as the cause.

No production application code was changed. Added regression coverage and this report; frontend, security, validation, idempotency, and integration behavior remain intact.

## Complete request path

1. `src/components/contactform.jsx`: builds form/consent/attribution, validates with `shared/enquiry.js`, retains a UUID idempotency key for unchanged retries, prevents concurrent submits, POSTs JSON to relative `/api/enquiries`.
2. `vercel.json`: `/api` and `/api/:path*` rewrite to `/api/index`; the SPA rewrite excludes API paths.
3. `api/index.js`: ESM default re-export of `server/app.js`'s Express application. This is a Node request/response handler, without a listener. `package.json` declares `type: module`, Node 22.x, and `vite build`. Imports include the server/shared files; there is no top-level database connection or provider configuration validation.
4. `server/app.js`: Helmet, origin checks, rate limit, JSON size limit, content type, shared validation and UUID validation precede persistence.
5. `enquiryStore.save`: connects to MongoDB; hashes normalized payload; atomically upserts by submission key, using `$setOnInsert`; checks payload hash. Duplicate-key races read the winner. Changed payload under a key returns 409.
6. Zoho: atomic claim, OAuth refresh/cache, phone search then optional email search, update matching lead or upsert, persist outcome. Claims and provider/status failures are caught.
7. BotSpace: independent atomic claim, reuse a known contact mapping or create a contact, save partial contact mapping, look up/create conversation, persist outcome. Failures cannot undo capture.
8. Returns 201 with only success, enquiry ID and generic receipt message. Frontend displays success and an optional WhatsApp continuation. The separate click-tracking endpoint is not form acceptance.

Vercel's [Express documentation](https://vercel.com/docs/frameworks/backend/express) supports a default-exported Express application. The local test invokes the real export using Node HTTP, but does not emulate Vercel's rewrite engine, packaging, proxy, or deployed environment. The rewrite pattern is consistent with the intended routing; deployment smoke tests remain necessary. See [Vercel rewrites](https://vercel.com/docs/rewrites).

## 500 and runtime-failure paths

| Path | Effect and evidence |
| --- | --- |
| Invalid `ALLOWED_ORIGIN` | Throws before the route; generic JSON 500, including health. Reproduced. Custom `ConfigurationError` inherits the name `Error`, so the current log's type alone cannot identify this setting. |
| Missing/malformed `MONGODB_URI` | Lazy configuration throws on save; fixed Mongo configuration log plus generic 500. Existing test covers missing URI. |
| Mongo connection failure | DNS/SRV/TLS, authentication, Atlas network access, paused/unavailable cluster, loopback URI, connection limits: caught as capture failure. These specific live causes were not reproduced or verified. |
| Initial upsert/read failure | Permissions, database validation/cast failure, write/network errors, failed duplicate-key reconciliation read: generic 500 unless converted to `ConflictError` (409). Fake persistence exception reproduced. |
| Other unexpected middleware/route exception | Error handler defaults to generic 500. E.g. body-parser errors not explicitly mapped can reach this handler. Validation, conflict, JSON syntax and oversize have explicit non-500 responses. |
| After successful save | Normal provider/claim/update exceptions are caught. No rollback/delete occurs. Unexpected logger/serialization failure or process death can still prevent an HTTP acknowledgement; there is no absolute delivery guarantee. No such ordinary production defect was found. |
| Function startup/invocation failure | Missing packaged imports/dependencies, wrong deployed runtime/revision or infrastructure failure can produce a platform 500 without the application's JSON. Actual handler imports and serves locally under Node 22. |
| Function duration exhausted | Work is awaited before 201. Each provider call has a five-second abort, but there is no total request deadline. Vercel documents 504 `FUNCTION_INVOCATION_TIMEOUT`, not ordinary application 500, for duration exhaustion. |
| Separate WhatsApp tracking write | Database failure returns generic 500 on `/api/enquiries/:id/whatsapp-started`; does not invalidate the already accepted enquiry. Check which request actually failed. |

Other expected outcomes: invalid input/key/JSON 400, rejected origin 403, API missing 404, wrong method 405, conflicting key 409, oversized JSON 413, wrong content type 415, rate limit 429. Incorrect but syntactically valid origin normally causes 403 rather than 500.

No request-path filesystem writes, background jobs, unawaited integration work, process exits, ESM/CommonJS mismatch, or missing await/return were found. Only local dev starts a listener. Setup/retry scripts disconnect and set exit status but are not imported by the function. Default client initialization references global fetch, supported by the declared Node 22 runtime.

## MongoDB

`server/config/db.js` returns the ready Mongoose connection and shares an in-flight connection promise. Failed connections reset the promise so later invocations retry. Warm invocations reuse the driver pool; separate function instances have separate pools. Maximum pool size is five; server-selection and socket timeouts are 5,000 ms. Buffering and automatic request-time index creation are disabled. The pool is not closed per request.

The URI selects the database; there is no explicit `dbName` override. Include the intended database path rather than depending on a driver default. Mongoose model `Enquiry` uses collection `enquiries`. `server/setup.js` creates indexes separately; the unique `submissionKey` index must exist for concurrent deduplication. Do not run setup against production as part of this audit.

Provider updates use `$set` on the captured record; there is no deletion, transaction rollback, or replacement of its captured fields. If a status write fails, capture remains but status may be pending/syncing. Socket/selection timeouts are not an aggregate deadline: multiple database operations plus providers can exceed the configured 60 seconds. Pool wait/overall operation deadlines are not explicitly configured.

The new tests fake persistence and do not prove current Atlas connectivity or write concern durability. Existing opt-in `tests/mongo.integration.mjs` was not run: it requires an isolated `TEST_MONGODB_URI`, creates indexes and cleans up its test rows. No production data was touched.

## Providers

BotSpace configuration is lazy. Requires `BOTSPACE_API_KEY` and `BOTSPACE_CHANNEL_ID`; base URL defaults to `https://public-api.bot.space`. Auth is the API-key query parameter according to the checked-in `docs/botspace-openapi.json`. No invented duplicate-contact contract was added.

Contact IDs from this or previous same-phone enquiries are reused. Contact creation is account-scoped. Contact ID is persisted before conversation preparation. Stored conversation IDs are reused; otherwise lookup splits the normalized phone. Only lookup HTTP 404 with case-insensitive exact `Conversation Not Found` is treated as absence. A create 409 triggers lookup to reconcile. Other 404s/errors fail safely. Contact-create 409 rechecks contact mappings; a conversation ID is never passed off as a contact ID. The checked-in implementation/report records the narrow observed 404 contract; this audit did not independently call the provider.

Requests refuse redirects, use five-second abort signals, sanitize network and response errors, and never log the API-key URL or raw provider body. Failed attempts persist `failed` when the database allows. Failed/ambiguous contact creations are not automatically retried; review and reconciliation are required. Form capture never invokes message helpers. `BOTSPACE_TEMPLATE_ID` is irrelevant to capture.

Zoho validates five required settings lazily before OAuth. Refresh-token exchange posts to `/oauth/v2/token`; access tokens and concurrent refresh promises are cached in the warm instance until shortly before expiry. CRM calls use `/crm/v8/{module}` under **`ZOHO_API_BASE_URL`**. `ZOHO_API_URL` is never read and is not an alias. Origins must be supported data-center HTTPS origins without paths. API/Accounts data centers must match the account; the code validates each independently and does not guarantee they match.

OAuth `invalid_code` and `invalid_client` are sanitized, persisted as failed sync, and do not fail capture. Network errors, scope/permission problems, ambiguous matches, invalid JSON and record rejection follow the same safe failure path. Existing cached access tokens can defer detection of changed/revoked credentials. No immediate invalid-token refresh retry is implemented. Failed claims/status writes leave state needing reconciliation without erasing the enquiry.

Application logs contain fixed labels, IDs, safe summaries and error names, not credentials or request bodies. External outbound tracing must redact query strings because BotSpace puts its API key there. No credential values were used in test diagnostics.

## Exact environment inventory and Vercel settings

`.env.example`, README and deployment guide consistently use `ZOHO_API_BASE_URL`. Two BotSpace settings listed there are reserved and not read. Local `.env` is loaded only by the explicit local CLI scripts; Vercel runtime reads its deployment environment.

| Variables actually read | Requirement / usage |
| --- | --- |
| `MONGODB_URI` | Required for capture; Atlas URI including intended database for Vercel. |
| `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_ACCOUNTS_URL`, `ZOHO_API_BASE_URL` | Required for successful Zoho sync, optional for capture. Use the account's supported data-center origins. |
| `ZOHO_LEADS_MODULE` | Optional, defaults to `Leads`. |
| `BOTSPACE_API_KEY`, `BOTSPACE_CHANNEL_ID` | Required for successful BotSpace preparation, optional for capture. |
| `BOTSPACE_BASE_URL` | Optional; defaults to `https://public-api.bot.space`. |
| `BOTSPACE_TEMPLATE_ID` | Optional explicit template helper only; not used during form capture. |
| `ALLOWED_ORIGIN` | Optional additional exact origin. Leave unset for same-origin hosting, or use an HTTPS origin without paths/query/credentials. `*` is invalid. |
| `VITE_CLINIC_WHATSAPP_NUMBER` | Public build-time setting, international digits only. Missing/invalid hides continuation and does not fail capture. |
| `ZOHO_LEAD_STATUS` | Optional existing CRM picklist value; read at module initialization. |
| `ZOHO_FIELD_SERVICE`, `ZOHO_FIELD_UTM_SOURCE`, `ZOHO_FIELD_UTM_MEDIUM`, `ZOHO_FIELD_UTM_CAMPAIGN`, `ZOHO_FIELD_UTM_CONTENT`, `ZOHO_FIELD_UTM_TERM`, `ZOHO_FIELD_LANDING_PAGE`, `ZOHO_FIELD_REFERRER` | Optional actual CRM API names; read at module initialization. Unmapped attribution goes into Description. |
| `ZOHO_FIELD_WHATSAPP_STATUS`, `ZOHO_FIELD_BOTSPACE_CONTACT_ID`, `ZOHO_FIELD_BOTSPACE_CONVERSATION_ID`, `ZOHO_FIELD_LAST_WHATSAPP_MESSAGE_AT`, `ZOHO_FIELD_LAST_WHATSAPP_DIRECTION` | Optional explicit metadata helper; not called by form capture. |
| `NODE_ENV`, `VERCEL` | Runtime mode/logging/origin/proxy behavior. Set by deployment tooling; do not manually override to development. |
| `PORT` | Local `server/dev.js` only; defaults to 3000. |
| `TEST_MONGODB_URI` | Opt-in real database tests only; not a production variable. |
| `import.meta.env.DEV` | Vite-provided frontend diagnostic flag, not a user secret/setting. |

Not consumed: `ZOHO_API_URL`, `BOTSPACE_AUTO_SEND`, `BOTSPACE_WEBHOOK_SECRET`. Setting these does not enable automatic messaging, webhook verification, or change the CRM API origin.

Vercel Project Settings: root directory containing this `package.json`, `vercel.json`, and `api/`; framework Vite; Node 22.x; install `npm ci`; build `npm run build`; output `dist`. Function `api/index.js` has `maxDuration: 60`. Check actual deployment settings/revision rather than assuming a previous successful deployment is unchanged.

Apply runtime credentials to **Production**, and Preview separately if needed. Changes to environment variables apply to new deployments, so **redeploy after correcting settings**, then confirm the production domain points at that deployment. See [Vercel environment variables](https://vercel.com/docs/environment-variables). Tests/report alone need no production redeploy.

## Runtime evidence and verification checklist

1. Open Vercel project Logs for the active Production deployment. Filter `POST /api/enquiries`, status 500, and the timestamp of an existing failed request. Record deployment ID/commit, route, duration, safe error label/type and platform error code. Do not share connection strings, raw request data, tokens or provider URLs containing query parameters.
2. In browser Network, select the failing request and inspect URL, response status, Content-Type and Response. App JSON `{success:false,message:...}` and `enquiry_capture_failed` mean Express handled an exception. A platform error page/`FUNCTION_INVOCATION_FAILED` without that label points to initialization/invocation; inspect the stack's module path and error code with secrets redacted. An HTML page on an API path suggests routing/deployment mismatch.
3. Read-only `GET /api/health` should return 200 `{"status":"ok"}`. It does not check MongoDB. If it returns the app's generic 500, inspect `ALLOWED_ORIGIN` first. Missing/invalid Mongo cannot alone break health. A valid origin with a wrong domain instead produces 403 on browser requests.
4. For save errors: fixed `Mongo configuration missing or invalid: MONGODB_URI` proves URI validation failure. `enquiry_capture_failed` with `MongooseServerSelectionError`, `MongoServerError`, `MongoParseError` or similar narrows connection/auth/write failures. Current production logging records only error name, so it may not distinguish authentication from permissions or network causes. Inspect configuration/Atlas diagnostics privately; do not enable raw error/body dumps. `type: Error` alone is insufficient.
5. Verify `MONGODB_URI` is Atlas rather than localhost; intended database, encoded credentials, database-user write privileges, current Atlas cluster/network access, and submission-key unique index. An old saved record does not prove today's deployment has the same URI or access.
6. Check the exact provider environment names above and latest deployment time. Use `ZOHO_API_BASE_URL`, not `ZOHO_API_URL`. Remove unused `ALLOWED_ORIGIN` for same-origin hosting or correct its origin. Only make corrections supported by settings/log evidence; do not rotate credentials during diagnosis.
7. After corrections and redeploy, repeat health and unknown-API checks (JSON 404), and verify a frontend deep link loads. A production form smoke test will create external records when sync succeeds; perform that only with explicitly approved test data. Expect 201, one Mongo enquiry for the submission key, and independent provider statuses. Controlled provider-failure tests belong in an isolated preview with fakes or separate approved test accounts. No such live write was performed in this audit.

If duration approaches 60 seconds and the platform reports `FUNCTION_INVOCATION_TIMEOUT`, investigate aggregate database/provider time rather than treating a caught provider error as an application 500. [Vercel limits](https://vercel.com/docs/functions/limitations) describe the 504 timeout response. Provider networking can take up to about 20 seconds for four Zoho calls plus about 20 seconds for BotSpace contact/lookup/create/conflict lookup, before database delays. These are path budgets, not a proven total upper bound.

## Changes, validation, and remaining limits

Added `tests/production-http.test.mjs`: exercises the actual default `api/index.js` export under production/Vercel mode with HTTPS proxy headers, fake persistence and fake outbound transport. Covers independent/both provider failures, missing optional credentials, OAuth invalid-code/client responses, network failures, 404 conversation creation, post-save claims/status-write failures, pre-save failure, and malformed-origin reproduction. Provider calls assert capture happened first; fake transport blocks unexpected hosts and messaging paths. Existing security/deduplication tests are retained.

Executed with cached Node **22.23.3**, matching the project's Node 22 major requirement (host default is Node 26.3.0):

| Command | Result |
| --- | --- |
| `npm test` | Exit 0; 66 tests passed, 0 failed, 0 skipped (54 top-level tests including the new parent and its 12 subtests). |
| `npm run lint` | Exit 0; no diagnostics. |
| `npm run build` | Exit 0; Vite 8.3.1, 36 modules transformed. |
| `git diff --check` | Exit 0. |

Files changed: this report and the new test file. No runtime fix was applied because the production cause is unproven. Configuration remedies above are conditional on log/settings evidence, not claims about the live deployment.

Remaining risks: Vercel packaging/routing and live Atlas permissions/connectivity unverified; aggregate latency can outlast function duration; process/network loss can prevent acknowledgement after durable save; status writes can leave syncing records; ambiguous BotSpace creation requires reconciliation; rate limits are per process, not shared across instances. No queue/worker, provider contract, retry policy, or logging redesign was introduced speculatively. The supplied browser error cannot resolve the remaining diagnosis; the exact evidence required is listed above.
