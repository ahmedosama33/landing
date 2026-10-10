# Royal Model Modern Clinic

Website tracking (10 October 2026): see [Marketiq implementation report](docs/MARKETIQ_TRACKING_REPORT.md) for payloads, consent integration, validation results, and outstanding Flow/GTM configuration.

BotSpace update (8 October 2026): see [connection setup and safe contact test](docs/BOTSPACE_CONNECTION.md) for Egyptian number normalization, configured custom-property mapping, durable contact-create deduplication and the permission-gated diagnostic. Existing Zoho Flow delivery is preserved.

## Current architecture

React form (`src/components/contactform.jsx`) -> same-origin `POST /api/enquiries` -> Vercel export (`api/index.js`) / Express (`server/app.js`) -> validated MongoDB save (`server/services/enquiryStore.js`). After persistence, the backend attempts Zoho Flow delivery and BotSpace preparation independently. Zoho Flow creates/updates the CRM Lead using its own CRM connection.

MongoDB remains the source of truth and the durable-success boundary. Either or both integrations may fail; a saved enquiry still returns HTTP 201 with exactly:

```json
{"success":true,"enquiryId":"...","message":"Your enquiry has been received."}
```

This avoids the application's failing direct OAuth refresh exchange (`invalid_code`). It does not repair that legacy token. CRM authentication and field mapping now belong in Flow. No frontend design, validation, honeypot, security middleware, BotSpace service, or WhatsApp handoff behavior was changed. Form submission sends no WhatsApp messages.

## Local development and checks

Use Node 22.x. Run `npm ci`, copy `.env.example` to private `.env`, and configure MongoDB and the desired integrations. Never commit private environment files.

```sh
npm run db:setup
npm run dev:api
# Separate terminal
npm run dev
```

Vite proxies `/api` to 127.0.0.1:3000. Only `server/dev.js` starts a listener; the Vercel handler exports Express. Run `npm test`, `npm run lint`, and `npm run build`. Automated provider tests use fakes and do not load `.env`, call a live Flow webhook, create CRM records, or send messages. The optional `tests/mongo.integration.mjs` requires a dedicated `TEST_MONGODB_URI`; it is not part of `npm test`.

## Environment variables

| Variable | Use |
| --- | --- |
| `MONGODB_URI` | Server-only durable storage; required to accept enquiries |
| `ZOHO_FLOW_WEBHOOK_URL` | Server-only secret URL copied from the enabled Flow webhook trigger |
| `BOTSPACE_API_KEY`, `BOTSPACE_CHANNEL_ID`, `BOTSPACE_BASE_URL` | Existing server-only BotSpace configuration |
| `ALLOWED_ORIGIN` | Optional extra exact origin; same-origin needs no setting |
| `VITE_CLINIC_WHATSAPP_NUMBER` | Public build-time international digits, without `+` or spaces |

Flow configuration is checked lazily, after capture. A missing/invalid URL records a safe failed sync where MongoDB remains writable; it does not prevent startup or enquiry success. The validator accepts HTTPS regional `flow.zoho.*` hosts listed in `getZohoFlowConfig`, a numeric organization webhook path, and a nonempty `zapikey`. It rejects credentials in the URL authority, fragments, custom ports, and redirects. If Zoho supplies a different endpoint format, verify that official format and update the validator before enabling it.

Never prefix the webhook, database URI, or integration secrets with `VITE_`. Do not log outbound URLs or response bodies. Redact query strings in any external HTTP tracing/proxy instrumentation too.

The submission and Flow retry paths no longer require `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_ACCOUNTS_URL`, `ZOHO_API_BASE_URL`, or the older `ZOHO_API_URL`. `ZOHO_LEADS_MODULE`, `ZOHO_LEAD_STATUS`, and `ZOHO_FIELD_*` likewise have no role in new Flow deliveries.

Legacy OAuth code remains isolated in `server/services/zohoService.js` and `server/config/zoho.js`, with regression tests. `npm run zoho:test` is still an explicit legacy, live read-only OAuth diagnostic, not a Flow test. The optional existing-lead WhatsApp metadata helper also still needs legacy OAuth if invoked privately. Keep or retire those secrets according to those separate uses; there is no automatic fallback to direct CRM. Rollback requires a reviewed code change, not simply restoring environment variables.

## Zoho Flow setup

1. Create a Flow, choose **Webhook** as its trigger, and choose **JSON**. Copy its generated URL privately.
2. Configure Advanced settings -> **Enable webhook acknowledgement** for **all requests**, not only the first. Use response header `Content-Type: application/json` and response body `{"accepted":true}`. The sender accepts any HTTP **2xx** with a JSON object containing boolean `accepted: true`, regardless of whitespace, property order, or response Content-Type. Empty/malformed bodies or missing/false acknowledgements require reconciliation; 2xx alone never proves CRM creation.
3. Supply the synthetic sample below in Flow's trigger setup, with CRM actions disabled or connected to an isolated test organization. Do not send sample traffic to production as part of automated tests.
4. Connect Zoho CRM inside Flow. Map generic payload keys to the actual fields and mandatory layout values in your CRM account. Confirm field types, required fields, service/status picklists and consent handling. No custom CRM API field names are assumed by this application.
5. Implement idempotent CRM processing before enabling production or private retries, as described below. Enable the Flow and verify its acknowledgement contract and actions in an isolated environment.

Zoho documents JSON triggers and configurable acknowledgement bodies/headers in [Webhook Trigger - Zoho Flow](https://help.zoho.com/portal/en/kb/flow/user-guide/create-a-flow/typesoftriggers/articles/webhook-trigger-typesoftriggers). The `accepted` body above is **our configured contract**, not an assumed default Zoho response. HTTP acknowledgement confirms receipt, not completion of downstream CRM actions.

### Exact webhook payload

The body always contains these 22 keys. Optional validated text defaults to an empty string. `enquiryId`, `submissionKey`, and `createdAt` come from the durable record; `createdAt` is ISO 8601 UTC. Internal hashes, sync metadata, CRM IDs, unknown input fields, and credentials are excluded.

```json
{
  "enquiryId": "0123456789abcdef01234567",
  "submissionKey": "678d6127-4fa8-4651-8d99-577700fd24b7",
  "fullName": "Example Person",
  "phone": "+12025550123",
  "email": "example@example.com",
  "service": "Other",
  "message": "Example enquiry",
  "consent": true,
  "landingPage": "https://clinic.example/contact",
  "referrer": "https://example.com/",
  "utmSource": "example",
  "utmMedium": "example",
  "utmCampaign": "example",
  "utmContent": "",
  "utmTerm": "",
  "gclid": "",
  "gbraid": "",
  "wbraid": "",
  "fbclid": "",
  "fbp": "",
  "fbc": "",
  "createdAt": "2026-10-08T10:00:00.000Z"
}
```

### CRM matching and duplicate prevention inside Flow

Use `submissionKey` (or `enquiryId`) as the stable delivery identity. Store its processing result and CRM record association in a durable deduplication mechanism. Replayed deliveries must reuse that association. A payload key by itself is not an idempotency guarantee.

For a new delivery identity, search using normalized phone and, where appropriate, validated email. Update one unambiguous existing Lead; route ambiguous matches for review. If none exists, create/upsert with uniqueness enforced in CRM. Configure actual unique fields and verified CRM actions in your account; a search followed by an unconditional create is unsafe under concurrent Flow runs. Handle uniqueness conflicts by finding and using the winning record. Preserve omitted optional values and existing sales status where appropriate.

Both the delivery ledger and CRM writes need race-safe uniqueness. If a Flow run crashes after creating a Lead but before recording delivery completion, the next run must find/update that Lead through the same unique identity. A delivery ledger alone does not close that failure window. Different enquiries for the same person also need contact-level matching. Verify this design in your account before enabling retries; the backend cannot enforce CRM uniqueness from a webhook acknowledgement.

## Submission, sync tracking, and recovery

Validation, 20 KB JSON limit, consent requirement, honeypot, normalized international phone, bounded text, attribution sanitization, and unknown-field removal remain. The form uses an `Idempotency-Key`; unchanged retries reuse it. MongoDB atomically upserts against the unique submission key and rejects changed data under the same key with HTTP 409. Clients that omit the header receive a new key and cannot deduplicate independent requests.

Existing fields are reused; no schema rename or index change is required. This update adds the `needs_reconciliation` enum value and optional `zohoFlowResponse` subdocument without rewriting existing records:

| Field | New Flow delivery meaning |
| --- | --- |
| `zohoSyncStatus` | `pending`, `syncing`, `synced` (acknowledged receipt), `failed`, or `needs_reconciliation` |
| `zohoSyncStartedAt` | Time the atomic delivery claim began |
| `zohoSyncedAt` | Time Flow acknowledgement was recorded |
| `zohoSyncError` | Fixed safe classification and HTTP status where available |
| `zohoFlowResponse` | Actual HTTP status, allowlisted media type without parameters, and a short body projection containing only boolean `accepted` or fixed redaction markers |
| `zohoLeadId` | Retained legacy CRM ID; Flow never invents, clears, or overwrites it |

Historical `synced` rows retain their original direct-CRM meaning and are not replayed. Record the deployment cutover time when interpreting these shared fields. Review old pending/failed rows before delivering through Flow because they may already have CRM effects. No blanket reset of historical statuses is performed.

Flow uses POST JSON, a five-second timeout, and no redirects or inline automatic retries. BotSpace is attempted even after Flow fails. Public submissions claim only pending deliveries; repeated browser submissions do not resend failed, synced, or stale-syncing deliveries. This avoids triggering ambiguous remote effects on a browser retry.

Private recovery after verifying Flow deduplication:

```sh
npm run zoho:retry -- ENQUIRY_OBJECT_ID --idempotent-flow-confirmed --reconciled
```

The existing command now delivers to **Flow**, never direct CRM. The flags confirm that the operator has checked Flow execution history/CRM existence and configured retry-safe CRM processing; it does not implement that processing. Claims allow pending/failed records and syncing records older than two minutes. Concurrent claims for one record are atomic. Retries resend the same submission identity and original creation timestamp. Synced and `needs_reconciliation` records are not eligible. An operator must first check Flow history by submission key and CRM Lead existence, then explicitly resolve the record privately: record verified receipt without resending if already delivered, or reset to pending only if redelivery is safe. No automatic reset is provided. Legacy acknowledgement errors stored as failed also require this review.

After a timeout, network error, or status-write failure, first reconcile Flow history by submission identity; remote acceptance may already have happened. If MongoDB status writes also fail or the process terminates, inspect pending/stale-syncing records. A Flow-accepted run can fail later inside CRM: use Flow history and its reconciliation tools, since the application has no CRM completion callback. Do not blindly replay those accepted records.

No scheduled worker or public retry endpoint exists. Monitor and reconcile failures privately. BotSpace retry behavior is unchanged: do not retry ambiguous contact creation automatically. See the existing [BotSpace extension report](docs/BOTSPACE_EXTENSION_REPORT.md) and [integration report](docs/INTEGRATION_DEBUG_REPORT.md); their direct-Zoho submission descriptions are historical. `server/retryBotspace.js` remains the reviewed existing-contact recovery tool.

## Vercel deployment

1. Configure and test the Flow acknowledgement and idempotent CRM actions in isolated resources.
2. In Vercel Project Settings -> Environment Variables, add server-only `ZOHO_FLOW_WEBHOOK_URL` for the intended environment. Keep `MONGODB_URI` and the working BotSpace settings. Use separate Preview resources. Do not place the secret in frontend variables or source files.
3. Keep Vite, Node 22.x, `npm ci`, `npm run build`, and output directory `dist`. The root is the directory containing `package.json` and `api/`. Environment changes require redeployment.
4. Ensure Atlas access and the existing unique submission-key index. Run `npm run db:setup` with an authorized database account if not already done. No new indexes are required for this refactor.
5. Deploy, record the cutover time, and check `/api/health`, frontend routing, and JSON API 404s. Health checks liveness only, not integrations.
6. In Preview, submit an authorized synthetic enquiry and verify MongoDB, Flow history/CRM matching, BotSpace status, response format, and WhatsApp handoff. Simulate Flow failure and confirm HTTP 201 after persistence. Repeat the same submission key and verify no duplicate side effects. Production smoke tests require intentional authorization to create real records.

Helmet, origin checks, request limits, and the per-instance IP limiter remain. Configure a Vercel Firewall limit for `/api/enquiries` for cross-instance protection. The 60-second function limit is unchanged. A platform termination or client disconnect after a save can still prevent a response; no application can promise a received HTTP response under those conditions.

The BotSpace webhook returns HTTP 503 (`processed: false`) pending verified provider event/signature contracts and durable processing. Do not register it as a working event processor; disable any existing subscription to this placeholder until implementation is complete. Production form submissions can now send the approved template when `BOTSPACE_AUTO_SEND=true`, as authorized by the owner. Preview/development and the contact-only diagnostic never auto-send. See [template setup](docs/BOTSPACE_CONNECTION.md#automatic-template-after-live-submissions).

Run `npm run integrations:check` for read-only local configuration checks, MongoDB index/recent sync metadata inspection, and BotSpace conversation lookups. It never creates records, sends messages, invokes Flow, or sends Meta events. Raw responses, secrets and phone numbers are withheld; dashboard visibility still requires manual verification. There is no write-test flag. `npm run test:mongo` runs the separate persistence suite only when `TEST_MONGODB_URI` names a dedicated test database; otherwise both tests skip. See [the integration audit](INTEGRATION_AUDIT_REPORT.md) for evidence, repairs and external blockers.

### Acknowledgement diagnostics update

Timeouts, transport errors, malformed/empty acknowledgements, HTTP 5xx/3xx, and failures to persist an acknowledgement now use `needs_reconciliation`. Configuration errors and HTTP 4xx use `failed`. Existing documents are not rewritten. Deploy readers/workers that understand the new enum together; old code may reject it. Neither browser replays nor the private retry command claim the new state.

Diagnostics are logged as `zoho_flow_response` and stored in `zohoFlowResponse`. Arbitrary text, JSON properties/values, and header parameters are dropped, not merely truncated, because they can contain customer data or tokens. Recognized media types are preserved; others become `other/redacted`. These diagnostics apply to future attempts only. They cannot recover an older response that was never recorded. See [the acknowledgement fix report](docs/ZOHO_FLOW_ACK_FIX.md).
