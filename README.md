# Royal Model Modern Clinic

## Vercel deployment preparation

Use [the deployment guide](docs/VERCEL_DEPLOYMENT.md) for the current environment-variable table, project settings, Atlas/index setup, Git secret exclusions, smoke tests and post-deployment webhook steps. Framework: Vite; Node: 22.x; install: `npm ci`; build: `npm run build`; output: `dist`; root: the directory containing this package and `api/`.

The example environment has been cleared of credentials and now uses the correct .com Zoho origins. Rotate credentials previously entered in that example before deployment. Actual secrets belong only in private local/Vercel environment settings. No deployment has been made. The BotSpace webhook remains an acknowledgement-only shell awaiting verified provider contracts; do not register it as a working production event processor yet.

React / Vite / Tailwind frontend -> same-origin Express API on Vercel -> MongoDB Atlas -> Zoho CRM -> enquiry received -> WhatsApp continuation.

The optional BotSpace extension attempts contact/conversation preparation after Zoho sync and before the success response: React -> Express -> MongoDB -> Zoho CRM -> BotSpace preparation -> WhatsApp handoff. MongoDB persistence remains the success condition. **The webhook is an acknowledgement-only shell: valid JSON objects receive 200 with `processed: false`; event processing awaits documented contracts.**

The existing design and routing are preserved. MongoDB is the durable enquiry store; CRM failures do not turn a saved enquiry into a failed form submission. Contact: calls / WhatsApp 0559988250; landline 043389909. The WhatsApp international destination must be confirmed by the clinic.

## Local development

Use Node.js 22 and npm. Install with `npm ci`. Copy `.env.example` to `.env` and fill in the required values. Neither file containing real secrets should be committed. Existing `.env.local` public WhatsApp configuration is preserved under the new name and overrides `.env` in Vite.

```sh
npm run db:setup
npm run dev:api
# In another terminal:
npm run dev
```

The API listens on 127.0.0.1:3000; Vite proxies `/api` to it from localhost:5173. Only `server/dev.js` starts a listener. `api/index.js` exports Express for Vercel. No CORS package is needed: same-origin is preferred; localhost:5173 is allowed outside production. `ALLOWED_ORIGIN` allows one extra exact origin if required.

Checks: `npm test`, `npm run lint`, `npm run build`. The unit/HTTP tests use injected database and CRM doubles, plus real Mongoose schema validation. They do not claim to validate Atlas or a live Zoho account. `node --env-file=.env --test tests/mongo.integration.mjs` runs an opt-in real database test when `TEST_MONGODB_URI` points to a dedicated test database.

## Environment variables

Server only in Vercel: `MONGODB_URI`, `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_ACCOUNTS_URL`, `ZOHO_API_BASE_URL`. Never prefix these with `VITE_`.

`ZOHO_ACCOUNTS_URL` and `ZOHO_API_BASE_URL` are HTTPS origins for your account's data center, without `/oauth` or `/crm` paths. No region is assumed. Optional: `ZOHO_LEADS_MODULE` (default Leads), `ALLOWED_ORIGIN`, `ZOHO_LEAD_STATUS`, and the `ZOHO_FIELD_*` mappings listed in `.env.example`.

Public build-time variable: `VITE_CLINIC_WHATSAPP_NUMBER`, international digits only, without +, spaces or punctuation. Confirm the number rather than deriving a country code. If missing or invalid, the WhatsApp continuation is hidden; the success state and call link still work. Changing a VITE variable requires rebuilding.

## MongoDB Atlas setup

1. Create an Atlas project and cluster in the chosen region; choose a database name for clinic enquiries.
2. Create a database user scoped to that database. Configure Atlas network access for the deployment's egress and your development machine. Use an appropriate fixed-egress option if strict IP allowlisting is required.
3. Copy the driver's connection URI with your database name and URL-encoded credentials into server-only `MONGODB_URI`.
4. Run `npm run db:setup` before accepting submissions. This creates the unique submission-key index, phone index and sync-status index. Automatic index creation is disabled in request handlers. Use a setup account with index privileges if the runtime account is more restricted.
5. Configure backups, retention and access for the enquiries collection. No raw IP addresses or request bodies are logged.

Connection promises are shared across simultaneous requests and warm serverless invocations. Pools are bounded to five connections per instance; they are not closed after each request.

## Zoho configuration

Create a server-side OAuth client and refresh token for the intended CRM organization/environment. Grant the scopes required to read/search, create and update the Leads module (including search scope). Set the five Zoho server variables above. Refer to [OAuth refresh](https://www.zoho.com/crm/developer/docs/api/v8/refresh.html) and [record search](https://www.zoho.com/crm/developer/docs/api/v8/search-records.html).

All field mappings live in `server/config/zoho.js`. Standard names map full name to Last_Name, phone to Mobile, email to Email, and notes to Description. Lead_Source is Website; confirm that this picklist value exists. Lead_Status is omitted unless a valid value is explicitly configured.

Find the real custom API names through Zoho CRM field metadata / API Names and set the corresponding `ZOHO_FIELD_*` variables. These include service, UTM source/medium/campaign/content/term, landing page and referrer. No guessed custom field names are enabled. Until configured, their values are retained in MongoDB and included in CRM Description. Verify picklist values match the website choices and any other mandatory CRM fields/layout requirements before launch.

Mark Mobile as a unique field (Do not allow duplicate values), resolving existing duplicates first. The integration searches phone/mobile then email, updates a match, and otherwise uses [Zoho upsert](https://www.zoho.com/crm/developer/docs/api/v8/upsert-records.html) with Mobile and Email duplicate checks. Uniqueness is required to prevent duplicates when concurrent requests beat CRM search indexing. Ambiguous searches fail safely for administrator review. Existing status and omitted email fields are not overwritten. Description reflects the latest enquiry; MongoDB retains every enquiry.

Access tokens are cached server-side until shortly before expiry. Each remote request has a five-second timeout. Failures store only sanitized summaries. A revoked token can require waiting for cache expiry or a new deployment after correcting credentials.

## Submission and retry behavior

`POST /api/enquiries` accepts JSON (20 KB limit) and validates name, international phone, optional email, service, message length, explicit boolean consent and `company_website` honeypot. Unknown fields are discarded. URL query strings/fragments are removed from landing/referrer URLs; UTM fields are separately bounded.

React validates the same rules, disables submission while pending and sends a random `Idempotency-Key` header. Network retries with unchanged values reuse that key. MongoDB atomically upserts against its unique key. Changed data under the same key gets 409. Clients that omit the header get a new server-generated key and cannot deduplicate retries.

The API saves before attempting CRM sync and returns 201 with `{success, enquiryId, message}`; the message is `Your enquiry has been received.` and integration status is private. If CRM or its status update fails after capture, the form still succeeds. Database save failure returns a safe 500; invalid input 400; unsupported methods 405; excessive requests 429. No enquiry read or general update endpoint is public. `POST /api/enquiries/:id/whatsapp-started` sets only `whatsappStarted = true`. It requires the original random submission key in the `Idempotency-Key` header and matches it to the enquiry ID. The browser sends this request without waiting for it; failures never prevent the WhatsApp link opening. This flag records a handoff click, not confirmed message delivery.

The success view never displays CRM status. The encoded WhatsApp message contains only the visitor's name and service, with no email, medical notes or record IDs. A visible call link remains available.

Failed/pending syncs can be retried privately:

```sh
npm run zoho:retry -- ENQUIRY_OBJECT_ID
```

Run only in a trusted environment with server secrets. Claims are atomic; interrupted syncing records become claimable after two minutes. A known CRM ID is reused. If status persistence also fails, inspect pending/stale-syncing records as well as failed records. No automatic scheduled retry or public retry endpoint is installed.

## Security and deployment

Helmet, request limits, validation, honeypot, safe errors, origin checks and a 10-request/15-minute IP limiter protect the API. The limiter is **per warm serverless instance**, not a global quota. Before production, add a Vercel Firewall rate-limit rule for POST `/api/enquiries` to enforce limits across instances. CORS/origin checks do not authenticate non-browser clients.

1. Import this repository into Vercel using the Vite preset and Node.js 22. Build: `npm run build`; output: `dist`.
2. Set the server variables and public WhatsApp variable separately for Preview and Production. Use isolated test CRM/database resources for preview.
3. Configure Atlas access and run index setup for the target database before enabling the form.
4. Configure and verify CRM mappings, permissions, unique Mobile and picklist values. Add the global firewall rule above.
5. Deploy. `vercel.json` routes `/api/*` to the Express function before applying SPA fallback, explicitly excluding API paths. Function duration is 60 seconds. See [Vercel rewrites](https://vercel.com/docs/routing/rewrites).
6. Check `/api/health` (liveness only), a frontend deep link, and `/api/nonexistent` (JSON 404, never HTML). Submit a designated test enquiry and confirm its MongoDB document, CRM status/lead ID, success view and WhatsApp link. Test a controlled CRM failure in preview: capture must still succeed. Test invalid consent, honeypot, repeated clicks and API rate limits.

No deployment or real external write is performed just by installing/building this repository. Atlas connectivity, live CRM sync and deployed Vercel routing require the configured environment and final smoke test.

## Migration inventory

Removed the entire former Supabase backend: config.toml, README, SQL migration, submit-enquiry Edge Function, and shared enquiry/handler/store/zoho/zoho-config modules. Removed Supabase frontend calls and environment variables. No Supabase npm dependency was present.

Created `api/index.js`, `vercel.json`, `shared/enquiry.js`, and `server/` modules: app.js, dev.js, setup.js, retry.js, config/db.js, config/zoho.js, models/Enquiry.js, services/enquiryStore.js and services/zohoService.js. Added optional MongoDB integration coverage in `tests/mongo.integration.mjs`.

Modified contactform.jsx, Home.jsx (WhatsApp copy only), package.json / lockfile, vite.config.js, eslint.config.js, .gitignore, .env.example, local public WhatsApp variable name, tests/enquiry.test.mjs and this README. Added only express, mongoose, helmet and express-rate-limit. No unrelated assets or components were removed.

Existing hosted data is not automatically transferred or deleted. If the old backend contains real enquiries, export and import them with an explicit field mapping, verify counts and CRM IDs, and then retire its hosted function/secrets. Keep historic consent provenance; do not assume older enquiries supplied the new explicit consent.

## WhatsApp sales workflow

WhatsApp is the only application follow-up channel. Optional email is lead information and can assist CRM duplicate matching; no messages are sent to it. Existing clinic call links remain available as a secondary action. The form collects name, Mobile / WhatsApp Number, optional email, service, optional message and consent.

Configure the clinic WhatsApp Business account in Zoho CRM separately and verify conversation association against normalized international Mobile numbers with a test lead. The website creates/updates a Lead, then offers the WhatsApp handoff; it does not itself connect a WhatsApp Business account or guarantee CRM conversation association. Saved enquiries still succeed during CRM outages and can be retried privately.

Suggested CRM stages, to configure and confirm in the account: New Enquiry, Contacted, Interested, Consultation Booked, Consultation Completed, Converted, No Response, Not Interested. Sales manages those stages and WhatsApp conversations inside Zoho CRM.

Removing fields from the schema does not purge existing database documents. Historical records are left intact; no remote data cleanup has been run.

## BotSpace: implemented in code

Source of truth: [BotSpace Swagger](https://public-api.bot.space/), inspected 7 October 2026. The public specification is saved in `docs/botspace-openapi.json` for review. Authentication uses the `apiKey` **query parameter**, not a Bearer header. Channel-scoped paths use `BOTSPACE_CHANNEL_ID`. Contact creation alone is account-scoped. No clinical message, service, consent record, or attribution is sent during form preparation.

Implemented service methods:

| Method | BotSpace endpoint | Behavior |
| --- | --- | --- |
| `createContact` | `POST /v1/contact` | Sends name, normalized phone, optional email; reads `data.contactId` |
| `getConversationByPhone` | `GET /v1/{channelId}/conversation` | Queries `countryCode` and national `phone`; reads `data.id` and checks full phone identity |
| `createConversation` | `POST /v1/{channelId}/conversation` | Sends name/phone; reads `data.conversationId` and checks full phone identity |
| `ensureConversation` | Lookup or create above | Reuses stored ID, otherwise looks up; creates on the observed conversation-not-found 404 |
| `sendTemplateMessage` | `POST /v1/{channelId}/message/send-message` | Sends configured template ID and explicit variables; missing template skips without network |
| `sendSessionMessage` | `POST /v1/{channelId}/message/send-session-message` | Sends explicit text only when trusted caller confirms an allowed session |
| `getMessage` | `GET /v1/{channelId}/message/{messageId}` | Returns selected metadata, validates message/channel identity, drops raw customer content |
| `getMessageStatus` | `GET /v1/{channelId}/message/{messageId}/delivery-status` | Preserves documented uppercase statuses: SENT, DELIVERED, REPLIED, FAILED, READ, CLICKED |

`libphonenumber-js` splits an already-normalized international number into calling code and national number for lookup. The existing `normalizePhone` remains the identity source; no default country or competing normalization is introduced. If parsing would change that identity, the operation fails safely.

**Conversation absence was confirmed by a live read-only lookup on 7 October 2026:** HTTP 404 with `message: "Conversation not found"`. Only that response from the conversation lookup is treated as absence and followed by creation. Other 404s, 400/401/403 errors, empty data, timeouts, and malformed responses fail safely. If creation returns 409, a second lookup reconciles the concurrent winner. Stored conversation IDs remain reusable. After explicit user approval, live creation and an independent lookup succeeded for conversation `6ac65574739277a351709b39`. The specific not-found message is matched case-insensitively to accept the actual `Conversation Not Found` response. The explicit trusted `absenceConfirmed` option remains available.

Message helpers are explicit server operations, never called by form submission. `sendBotspaceTemplate` and `sendBotspaceSession` orchestrate an explicit send and persist returned message ID, conversation ID, and exact status in the existing enquiry. No timestamps are invented from send responses. `refreshBotspaceMessageStatus` polls privately and updates only if the message ID still matches the enquiry's current message. These are not public APIs or scheduled jobs. Reconcile before retrying a send if remote success is followed by a database failure; exactly-once delivery is not promised.

`BOTSPACE_TEMPLATE_ID` must be a real approved template. Its variables must match that template; Swagger's variables property is inconsistently typed as an object while showing an array, so the helper follows its array example and the requested contract. `BOTSPACE_AUTO_SEND=false` is a reserved safety setting: this version never automatically sends even if it is set to true. An approved business rule and explicit future code change are required to enable automatic sends. Session confirmation is the trusted caller's responsibility; a click on the WhatsApp button alone is not confirmation of a messaging session.

`server/config/botspace.js` validates server settings lazily. Missing secrets do not prevent startup or builds. `server/services/botspaceService.js` uses a five-second timeout, refuses redirects, and never logs request URLs, credentials, response bodies, or customer messages. Since the API key is in the URL, configure any outbound HTTP tracing/proxy tooling to redact query strings.

After MongoDB capture and the existing Zoho attempt, an atomic per-enquiry claim permits one BotSpace attempt. A known contact ID from an earlier enquiry with the same normalized phone is reused; otherwise the documented contact endpoint is used. That ID is persisted before conversation lookup, and conversation ID is persisted on success. A later failure retains partial progress. Royal Model's channel ID is used for conversation and message operations. Older contact-only records already marked synced need reviewed reset to pending before conversation preparation can run.

BotSpace states are `pending`, `syncing`, `synced`, and `failed`. The additional `syncing` state prevents simultaneous retries of the same enquiry. Safe errors and any obtained contact ID are retained where database writes succeed. If status persistence itself fails, inspect pending/syncing records. All BotSpace failures leave a saved enquiry successful, with the existing API response unchanged.

Swagger does not promise contact-create idempotency or document duplicate-contact error handling. Failed/stuck creates are therefore **not automatically retried**. Before retrying privately, reconcile the contact in BotSpace: attach its confirmed contact ID to the correct enquiry if it exists, and reset the enquiry's BotSpace state to `pending` only after review. Then invoke `syncBotspaceEnquiry` from a trusted server process with the existing store/client. Missing-credential failures likewise need this explicit reset after configuration. There is no public retry endpoint. Distinct simultaneous enquiries for the same new phone can still race to create contacts; cross-enquiry uniqueness is not guaranteed by this implementation or the published contract. Confirm provider duplicate semantics before enabling live creation at scale.

The existing schema already contains `botspaceSyncStatus`, `botspaceContactId`, `botspaceSyncError`, `botspaceSyncStartedAt`, `botspaceConversationId`, `botspaceLastMessageId`, `botspaceLastMessageStatus`, `botspaceLastMessageAt`, `whatsappStatus`, and `whatsappLastDirection`. No schema changes were needed for this extension. Conversation and explicit-send/status helpers now populate their ID/status fields. Message time, direction, and WhatsApp lifecycle await verified activity mapping. Existing `whatsappStarted` remains the handoff-click flag; `whatsappStatus` defaults to `not_started` and is not live conversation status. No fields or records were removed.

Optional Zoho field mappings and an `updateWhatsAppMetadata` method are prepared. That method updates only a known `zohoLeadId`, sends only explicitly configured metadata, and never creates/searches/upserts a lead. It is not connected to unverified webhook data. Existing lead creation, matching, status preservation, and private Zoho retries remain unchanged.

## BotSpace webhook: blocked contract, prepared route

`POST /api/webhooks/botspace` has a 20 KB raw JSON limit and the existing Helmet/origin protections. Per the latest request, it acknowledges unknown syntactically valid JSON objects with HTTP 200 and `{ success: true, processed: false }`. It logs a fixed acknowledgement label and byte count only. Malformed/non-object JSON returns 400, other content types 415, oversized input 413, unsupported methods 405. No database/CRM writes, signature claims, or customer payload logging occur. No webhook has been registered.

The inspected public Swagger contains no webhook envelopes, event type names, signing/HMAC algorithm, verification token/header, shared-secret protocol, or challenge flow. **This means verification was not found in that source; it does not prove BotSpace offers no signing.** The user confirmed that separate documentation/sample payloads are not yet available. `BOTSPACE_WEBHOOK_SECRET` is reserved and unused; setting it does not enable the route. No guessed signature header is accepted.

Before enabling Incoming, Outgoing, or Delivery processing, obtain official contracts and redacted examples for all three categories, plus authenticity verification and retry behavior. Implement verification against raw bytes if required, channel validation, identifier/phone matching, replay deduplication, event ordering, durable state updates, and bounded existing-lead metadata updates. Use reliable provider timestamps. The current shell's 200 means receipt only: events are discarded, not authenticated or processed. Do not register it as a production processor until these TODOs are implemented.

Current tests verify acknowledgement without side effects, including arbitrary category-like input and guessed headers, plus malformed/content-type/size rejection. They are **not** tests of real incoming/outgoing/delivery payloads or BotSpace signatures. Those acceptance tests await the provider contract.

## BotSpace: requires live account / deployment configuration

Set these only on the server, separately for Preview and Production:

```dotenv
BOTSPACE_API_KEY=
BOTSPACE_CHANNEL_ID=6ac529a17669b2ff0c3bd3d2
BOTSPACE_BASE_URL=https://public-api.bot.space
BOTSPACE_TEMPLATE_ID=
BOTSPACE_AUTO_SEND=false
# Reserved, not yet consumed:
BOTSPACE_WEBHOOK_SECRET=
```

Channel name: **Royal Model**. Contact creation is scoped to the API key's account; verify that key belongs to the intended clinic account. Copy real custom Zoho API names into the optional settings below, and confirm field types/picklist values in CRM. The names below are environment variable names, not assumed CRM field API names:

```dotenv
ZOHO_FIELD_WHATSAPP_STATUS=
ZOHO_FIELD_BOTSPACE_CONTACT_ID=
ZOHO_FIELD_BOTSPACE_CONVERSATION_ID=
ZOHO_FIELD_LAST_WHATSAPP_MESSAGE_AT=
ZOHO_FIELD_LAST_WHATSAPP_DIRECTION=
```

Existing server settings remain `MONGODB_URI`, `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_ACCOUNTS_URL`, and `ZOHO_API_BASE_URL`. The public build-time setting remains `VITE_CLINIC_WHATSAPP_NUMBER`. Never use `VITE_` for database, Zoho, or BotSpace credentials. No real secrets were added to `.env.example`.

MongoDB still requires Atlas database/user/network access and `npm run db:setup`. Zoho still requires OAuth configuration, correct region, permissions, unique Mobile, mandatory fields, and verified picklists/mappings. BotSpace requires its private API key, account/channel confirmation, duplicate-contact behavior verification, and eventual webhook contracts. The clinic WhatsApp destination remains unconfirmed. No live Atlas, Zoho, BotSpace, or Vercel validation was performed.

After the webhook contract is implemented and Vercel is deployed:

1. Confirm API deployment and determine the actual final HTTPS domain; none is assumed here.
2. Manually configure Royal Model's BotSpace webhook to that domain plus `/api/webhooks/botspace`, using the documented verification mechanism.
3. Enable Incoming, Outgoing, and Delivery events.
4. Send a designated test WhatsApp message and verify webhook receipt, authenticated processing, MongoDB updates, and configured Zoho metadata updates.
5. Test replay, out-of-order delivery, unknown authenticated events, and CRM outage recovery before production use.

Optional pre-deployment live testing can use a temporary Cloudflare Tunnel once the webhook implementation is enabled. Do not configure BotSpace with localhost. No tunnel was created and no temporary URL is stored. The global Vercel Firewall rate-limit rule remains a manual deployment task.

## Build diagnosis and verification — 7 October 2026

Installed dependencies were verified with `npm ls --depth=0`: Vite 8.3.1 and Tailwind 4.3.3 were present without reported missing/invalid packages. The host default is Node 26.3.0, while this project declares Node 22.x. The only addition in this extension is `libphonenumber-js` 1.13.14 for server-side phone splitting, with its package/lockfile entries. No removals, downgrades, Vite config changes, or frontend changes were needed. No reinstall was needed to repair the build.

The original `spawn EPERM`/Vite config/Tailwind native UTF-8 failure disappeared when the same build ran outside restricted process execution. The unchanged application also built successfully using a temporary Node 22.23.3 runtime. Evidence therefore points to the process sandbox/config-loading environment, not corrupt dependencies or a frontend defect. The system Node installation was not changed.

- `npm run lint`: passed.
- `node --test --test-isolation=none tests/enquiry.test.mjs tests/botspace.test.mjs`: see the latest extension report for the final count; original 19 tests retained.
- `npm test`: 40 passed with normal process isolation under Node 22.23.3. See `docs/BOTSPACE_EXTENSION_REPORT.md` for the complete change inventory and remaining contract limitations.
- `npm run build`: passed under Node 22.23.3 and the host Node 26.3.0 outside the restricted sandbox.
- Live MongoDB integration tests were not run; no service credentials were required by unit tests.

The Node 22 check used `npx --yes --package=node@22 -c "node --version && npm test && npm run build"`. It installed a temporary runtime in npm's cache, without adding a project dependency. Use Node 22 for normal development and deployment. A checkpoint commit is recommended after review; no commit or deployment was made.

## Integration debugging update ? 7 October 2026

See `docs/INTEGRATION_DEBUG_REPORT.md` for live evidence and limitations. The local Zoho Accounts setting incorrectly contained a CRM UI URL/path; it was corrected to `https://accounts.zoho.com`. The API origin remains `https://www.zohoapis.com`. Both are HTTPS origins, with an optional trailing slash; the service appends OAuth/CRM paths once. Known supported Zoho Accounts/API hosts are now checked, and missing settings are distinguished from invalid URLs. Live OAuth now reaches Zoho but returns `invalid_code`: verify the private refresh token and matching client/organization. No successful live CRM write is claimed.

BotSpace logs now identify the operation, method, endpoint path (without query), HTTP status and a fixed safe reason in development. Provider raw messages, customer content and API keys are excluded. Database summaries include the operation and status. A contact-create 409 rechecks known contact mappings; if none exists, it can reconcile a conversation but records failure until the real contact ID is supplied. A conversation ID is never substituted for a contact ID.

A private existing-contact retry is prepared:

```sh
# Dry run: reads mapping and prints the plan; does not call BotSpace or mutate state.
node --env-file=.env server/retryBotspace.js ENQUIRY_OBJECT_ID
# Explicit execution: resets an eligible failed row, claims it and retries conversation preparation.
node --env-file=.env server/retryBotspace.js ENQUIRY_OBJECT_ID --execute
```

Only pending/failed enquiries with a known contact ID qualify. It sends no WhatsApp message. A caught integration error is persisted as failed where MongoDB remains writable; if the status write itself fails or the process dies, syncing may remain and requires reconciliation. No unconditional retry of ambiguous contact creation or stale syncing is introduced.

The capture route already tolerated caught integration failures; it now also removes `zohoSynced` from the public response. A genuine network interruption after a save can still prevent the browser receiving confirmation; unchanged retries reuse the submission key. This cannot be solved by claiming success when the browser has not received confirmation.

Validation: 49 unit/API tests passed, two real MongoDB tests passed in a dedicated local test database (external integrations doubled), lint passed, and Node 22 build passed. Live BotSpace creation/verification was blocked by automatic approval review pending explicit permission to reuse the saved enquiry's data. No production deployment or token replacement was performed.

Latest approved live result: BotSpace conversation creation and lookup succeeded; the selected enquiry is synced with no BotSpace error. No WhatsApp message was sent. See the completed-retry update in `docs/INTEGRATION_DEBUG_REPORT.md`. Earlier statements that this specific live retry awaits approval are historical. Zoho remains unverified after its last `invalid_code` response.
