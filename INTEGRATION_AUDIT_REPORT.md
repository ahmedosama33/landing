# Royal Model lead-management integration audit

Follow-up: [BotSpace connection update](docs/BOTSPACE_CONNECTION.md) adds property updates, Egyptian national input normalization, a durable phone-level create guard and a permission-gated contact-only diagnostic. The findings below are the original audit snapshot; newer implementation details and test results are in that follow-up.

Audit date: 8 October 2026 (Africa/Cairo). Scope: existing working tree and configured local private environment. No deployment, provider record creation, WhatsApp message, Meta event, database mutation, or secret change was performed. Existing uncommitted changes were preserved. Historical documents are context, not live evidence.

## Result matrix

PASS is scoped to the evidence stated below. Local mocked HTTP tests do not establish deployed behavior. Database reads establish existing persistence, not a newly executed browser-to-database write.

| Integration step | Status | Evidence | Problem | Required action |
|---|---|---|---|---|
| Website form submission | UNVERIFIED | React uses same-origin `/api/enquiries`, shared validation, synchronous submit guard and stable UUID; build passes | No confirmed deployed URL/browser session was available | Test the deployed form with a designated test identity after deployment |
| Backend receives enquiry | PASS | Local HTTP tests exercise the actual Express/Vercel export: valid requests return 201, invalid requests reject, provider outages preserve success after save | Production routing is unverified | Verify production health and form routing |
| MongoDB saves enquiry | PASS | Live read found nine sampled enquiry documents and unique `submissionKey` index; mocked persistence boundary tests pass | No new live write test; dedicated test database absent | Set `TEST_MONGODB_URI` to an isolated database and run `npm run test:mongo` |
| Enquiry reaches BotSpace | FAIL | Latest enquiry has stored contact-creation HTTP 500 and no IDs; four recent enquiries have saved IDs and matching live HTTP 200 conversation lookups | Invalid calling code accepted by previous validation; older configuration failures also exist | Deploy validation repair; reconcile historical failures before any retry |
| Contact visible in BotSpace | UNVERIFIED | Six sampled phones resolve to the same existing conversation; saved contact ID exists on five sampled rows | API lookup does not prove dashboard Contacts/Inbox visibility or business workspace identity | Confirm account, channel and dashboard filters using IDs below |
| Contact linked to WhatsApp channel | PASS | Six current GETs to configured channel returned the expected phone and conversation ID | Limited to the found identity; two other lookups returned 404 | Verify channel belongs to the intended clinic workspace; reconcile missing rows |
| Enquiry reaches Zoho CRM | UNVERIFIED | User reports CRM Leads; sampled Mongo rows all show failed Zoho sync; active path is Flow | No Flow history access; direct legacy OAuth returns `invalid_code` | Inspect Flow execution/CRM action results by submission key; repair acknowledgement configuration |
| BotSpace contact linked to Zoho Lead | NOT IMPLEMENTED | All nine sampled documents lack `zohoLeadId`; Flow sender ignores CRM results and runs before BotSpace | No authenticated CRM-result callback or read reconciliation in active path | Add verified result reconciliation and persist actual Lead ID before enabling status sync |
| Salesperson can initiate permitted WhatsApp conversation | UNVERIFIED | Template/session helpers exist and are not automatically called; one conversation exists | No message sent; approved template, assignment, session eligibility and account permissions unverified | Verify in dashboard with a designated consenting tester |
| BotSpace status updates Zoho CRM | NOT IMPLEMENTED | No status event processor, status mapping or active CRM update workflow | Webhook was a discard-only HTTP 200 shell; now explicitly unavailable with 503 | Obtain actual event/authentication contracts and configured fields before implementation |
| Zoho CRM status updates BotSpace | NOT IMPLEMENTED | No Zoho inbound route, workflow configuration or active status updater | No verified CRM picklist or BotSpace status representation | Configure and implement an authenticated, durable CRM status workflow |
| Conversion event reaches Meta | NOT IMPLEMENTED | No Pixel, `fbq`, CAPI sender, event ledger or Meta settings found in application | No event construction, consent gating or deduplication | Configure approved event/consent design and test diagnostics before enabling delivery |
| Duplicate submissions handled | PASS | Stable frontend UUID, synchronous submit guard, unique Mongo index verified live; replay/conflict/concurrency mocked tests pass | Per-submission protection; separate UUIDs for same phone are not globally serialized | Preserve keys across retry; verify Flow uniqueness and reconcile remote races |
| Failure recovery works | UNVERIFIED | Partial IDs persist, ambiguous sends are not publicly replayed, mocked failure/reconciliation tests pass; private retry tools exist | No live recovery executed; historical failed/stuck records remain; no scheduled worker | Reconcile provider state first, then use reviewed private recovery; monitor pending/failed/stuck records |

## Actual architecture and enquiry trace

`src/components/contactform.jsx` validates and POSTs an allowlisted payload with `Idempotency-Key`. `server/app.js` validates again, atomically upserts an enquiry through `enquiryStore`, awaits Zoho Flow delivery, then awaits BotSpace preparation and responds 201 after successful capture even if either provider fails. Provider failures do not delete enquiries. Browser WhatsApp continuation uses `wa.me`; `whatsappStarted` records an attempted handoff, not a sent message or changed CRM status.

MongoDB is the durable delivery ledger. `server/services/zohoFlowService.js` POSTs to the private Flow webhook with enquiry ID, submission key, name, international phone, optional email, service/message, contact consent and attribution. A 2xx response with boolean `accepted: true` means Flow receipt only. The field named `zohoSyncStatus: synced` does not prove CRM completion. The current Flow path neither returns nor persists the CRM Lead ID. Legacy direct-CRM helpers remain for explicit use; the enquiry route does not call them.

BotSpace is called from the backend, independently of Flow success. It creates an account-scoped contact, persists its ID, then looks up/creates a channel conversation and persists that separate ID. Repeated enquiries can reuse a contact mapping by normalized phone. No template or session message is sent by the form. A conversation container does not prove a message, active WhatsApp session or salesperson access.

Example trace: enquiry `6ac7b61e26527e11ecfbf9f7` exists in MongoDB, has contact `6ac64d4848ad2166306d9243`, conversation `6ac65574739277a351709b39`, BotSpace `synced`, Zoho `failed` with an acknowledgement error, and no Zoho Lead ID. Current BotSpace lookup returns HTTP 200 with the same phone identity and conversation ID. There is no implemented status/Meta path beyond that point.

## BotSpace live evidence and root causes

The current official [BotSpace Swagger](https://public-api.bot.space/) and its `swagger-ui-init.js` were retrieved successfully. Its paths and component schemas match `docs/botspace-openapi.json`. Contact creation is `POST /v1/contact`, authentication is query `apiKey`, and phone is international format. Conversation lookup is `GET /v1/{channelId}/conversation` with `countryCode` and national `phone`. Configured channel: `6ac529a17669b2ff0c3bd3d2`. Credentials and customer values were never printed.

The final read-only sample comprises the latest five enquiries plus latest five BotSpace failures, deduplicated to nine records. The table records current GET results separately from historical errors. No POST was replayed.

| Enquiry ID | Historical Mongo BotSpace status / contact ID | Current operation / endpoint | Current HTTP / sanitized response | Conversation ID |
|---|---|---|---|---|
| `6ac7b7b726527e11ecfbfaca` | failed; no contact ID; historical contact creation HTTP 500 | Lookup stopped locally before GET | No current HTTP; `invalid_international_phone`; calling code unrecognized | none |
| `6ac7b61e26527e11ecfbf9f7` | synced; `6ac64d4848ad2166306d9243` | GET `/v1/{channelId}/conversation` | 200; `found_matching_phone` | `6ac65574739277a351709b39` |
| `6ac7b56926527e11ecfbf992` | synced; same contact ID | same GET | 200; `found_matching_phone` | same conversation ID |
| `6ac798cc26527e11ecfbf348` | synced; same contact ID | same GET | 200; `found_matching_phone` | same conversation ID |
| `6ac6565c26527e11ecfbe2cf` | synced; same contact ID | same GET | 200; `found_matching_phone` | same conversation ID |
| `6ac64d4926527e11ecfbddcf` | failed; same contact ID; historical `request_rejected`, no HTTP retained | same GET | 200; `found_matching_phone`; local conversation mapping missing | same conversation ID |
| `6ac63a8126527e11ecfbd8d4` | failed; no contact ID; historical configuration error | same GET | 200; `found_matching_phone`; local IDs missing | same conversation ID |
| `6ac639f126527e11ecfbd876` | failed; no contact ID; historical configuration error | same GET | 404; exact recognized provider message `Conversation not found` | none |
| `6ac6398026527e11ecfbd82d` | failed; no contact ID; historical configuration error | same GET | 404; exact recognized provider message `Conversation not found` | none |

Dashboard visibility remains UNVERIFIED for every row. Contact IDs above came from MongoDB, not the current conversation response. The public schema has no account-contact lookup by phone/list endpoint; a conversation ID must not be substituted for a contact ID. No documented delete operation was used and no test records require cleanup.

Established defects: the previous regular-expression phone validator admitted an unrecognized calling code on the latest failed row; historical configuration errors prevented other attempts; the older rejected row retained a contact ID and now resolves to a conversation, so its failed flag is stale relative to current remote state. Its original failure status/operation was not retained and cannot be reconstructed. The invalid number is a confirmed input defect and plausible contributor to the historical 500, but the provider's internal reason for that 500 is not established. No evidence establishes that every reported dashboard absence has the same cause, or that the user was searching the same workspace/channel.

The current API key/channel combination can read the found conversation. This establishes API access, not the intended account name or create/update permissions. A failed conversation step can coexist with a successfully created contact because the ID is saved first. Current code already handles only the exact observed not-found response as absence; arbitrary errors do not authorize creation.

## Repairs made

1. Shared browser/server phone validation now requires a recognized calling code, possible number length, and unchanged identity after parsing. It rejects malformed submissions before persistence/provider delivery instead of guessing a country or stripping an extra trunk digit. This is structural validation, not proof the number is registered on WhatsApp.
2. BotSpace transport/HTTP/JSON failures now retain a fixed operation, actual HTTP status when available, and an allowlisted diagnostic code in `botspaceSyncFailure`. Raw provider content is excluded; successful sync clears this failure. Existing contact/conversation progress and conservative retry behavior remain intact.
3. The unimplemented BotSpace webhook now returns 503 with `processed: false`, rather than acknowledging and discarding events. It still rejects malformed/oversized input and never changes records. This is not a functional webhook implementation. Keep subscriptions disabled until processing is ready; a configured sender may retry non-2xx responses.
4. Added `npm run integrations:check`: bounded read-only Mongo/index/metadata and BotSpace lookup checks, no Flow POST, no live write flag, no messages or conversions, sanitized output and explicit manual visibility checks. It never prints credentials, complete phone numbers, names, emails or raw provider bodies. Diagnostic exit success means the report was generated, not that the entire integration passed.
5. Exposed the existing optional isolated Mongo suite through `npm run test:mongo` and added regressions for the new validation, read-only diagnostics, redaction and durable failure metadata.

No speculative API endpoint, CRM picklist value, webhook signature or Meta event was invented. Status synchronization cannot be safely completed from the available configuration/contracts.

## Required dashboard and workflow configuration

### BotSpace

Confirm the API key's workspace and configured channel correspond to Royal Model. In Contacts search the normalized phone privately; separately inspect Inbox/Conversations, including closed/unassigned views and salesperson permissions. Use the IDs above to locate the existing identity. Confirm approved template, variable order and messaging eligibility before a designated test conversation. Creating a contact or conversation alone is not evidence of permission to send.

For `6ac64d4926527e11ecfbddcf`, a trusted operator can reconcile the verified conversation mapping to the existing contact without creating another contact. For missing-contact-ID rows, reconcile against a known correct mapping or the dashboard; do not blindly replay account-level contact creation. Correct the invalid phone only from an authoritative source, never by guessing. The existing `server/retryBotspace.js <id>` is a dry run; `--execute` can perform remote conversation creation after confirmed absence and therefore is not a read-only audit command.

The Swagger supports `PATCH /v1/contact/properties` with `{contactId, contactProperties}` and separate contact/conversation label operations. The application has not implemented a status updater. Obtain actual configured property names/labels and supported outbound event/authentication contracts. Do not register the placeholder as an event processor. Setting `BOTSPACE_WEBHOOK_SECRET` alone does nothing.

### Zoho Flow / CRM

Flow's documented advanced settings allow a configurable acknowledgement. Set the JSON trigger to acknowledge **every** request with the existing application contract `{"accepted":true}`, not just the first request after enabling the Flow. This confirms receipt, not completion of CRM actions. See [Zoho's webhook trigger documentation](https://help.zoho.com/portal/en/kb/flow/user-guide/create-a-flow/typesoftriggers/articles/webhook-trigger-typesoftriggers).

Inspect run history by stored `submissionKey`/`enquiryId`. Verify name, phone, optional email, Website source, enquiry details and actual initial Lead_Status mapping in the CRM action. Deduplicate with a durable unique submission identity and CRM contact identity; do not interpret a successful webhook response as a completed Lead. Persist the actual CRM result through a verified callback or private reconciliation. BotSpace IDs are created after Flow is invoked, so the existing Flow payload cannot link those IDs at first receipt.

The live legacy diagnostic returned `Zoho token-refresh failed: HTTP 200 (invalid_code).` CRM reads, picklist inspection and field inspection could not proceed. If direct reconciliation is needed, repair `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN` and regional URL pairing privately. No credential values should be posted in chat. Flow's own CRM connection is separate and must be checked in Flow.

No implemented A/B/C/D sales-status mechanism was found. In particular, sending WhatsApp messages does not change Lead_Status. The smallest proposed initial workflow is D: salesperson updates Zoho CRM directly, CRM is the status authority, and a verified status event projects that status to a configured BotSpace property. This is a proposal, not an existing automation. Add BotSpace-originated changes only after a real supported trigger and source-of-truth policy are agreed.

| Mapping element | Actual account state | Prerequisite |
|---|---|---|
| Zoho `Lead_Status` picklist | UNVERIFIED; OAuth/read access blocked | Inspect actual CRM field metadata; supply approved values through private configuration |
| BotSpace status property/labels | UNVERIFIED | Inspect dashboard configuration and choose documented property/label operations |
| Cross-system mapping | NOT IMPLEMENTED | Map each real CRM value explicitly; reject unknown values rather than inventing New/Qualified/etc. |
| Ordering and loop prevention | NOT IMPLEMENTED | Durable unique provider event ID, source marker, linked IDs and atomic version/timestamp guard |

The eventual worker must persist an authenticated event before acknowledgement, deduplicate replays, ignore stale versions, avoid echoing its own status updates, and keep recoverable delivery state. There are no currently implemented status-loop/replay/stale-event tests because there is no status processor; webhook rejection tests only demonstrate that untrusted events cannot mutate records.

### Meta Events Manager

No Meta implementation/configuration was found, so neither Lead construction nor event deduplication nor delivery can be claimed. Decide approved event names and consent policy, configure the correct Pixel/dataset and private server credentials, and implement browser/server event identity plus a durable delivery ledger. Contact permission on this clinical form is not evidence of advertising consent. Exclude enquiry/clinical details from any proposed advertising payload. Use Test Events for designated test traffic and inspect receipt/deduplication before enabling production conversions. CRM-side events require a supported server integration, not a browser Pixel call from the CRM. The official Meta deduplication page could not be retrieved during this audit (HTTP 429); no current API version or payload contract was assumed.

## Reliability and remaining limitations

Both provider operations are awaited; no fire-and-forget provider work was found. Each HTTP operation is bounded by five seconds and Vercel maxDuration is 60 seconds. This reduces premature termination risk but does not guarantee exactly-once delivery if a process dies between a remote write and local persistence. Pending/failed/stuck states require reconciliation; there is no queue worker, cron or alerting service configured. No new infrastructure was added.

Atomic per-enquiry claims and a verified unique submission key guard replays. Concurrent different submissions for one phone can still race on contact creation, and an account-level conflict can require manual contact-ID mapping. Unknown/ambiguous create outcomes are not automatically retried. The private Flow retry requires operator reconciliation and confirmed idempotent Flow processing. Historical errors stored as `failed` predate the newer `needs_reconciliation` behavior and must not be blindly replayed.

The local private variables needed for Mongo, BotSpace, Flow and the public WhatsApp destination are present and format-valid. `ALLOWED_ORIGIN` is absent but optional for same-origin deployment. `TEST_MONGODB_URI` is absent. No conflicting audited keys were found in `.env.local`. Vercel environment parity, deployment version, production domain, dashboard automations and permissions are UNVERIFIED. In-memory rate limits are per server instance; production global limiting still depends on deployment configuration.

## Files changed by this audit

- `shared/enquiry.js`: international phone validation.
- `server/services/botspaceService.js`, `server/models/Enquiry.js`: safe persisted failure metadata.
- `server/services/botspaceWebhook.js`, `server/app.js`: explicitly unavailable webhook.
- `server/integrationDiagnostics.js`, `server/checkIntegrations.js`: new read-only diagnostic.
- `package.json`: diagnostic and isolated Mongo test commands.
- `tests/integration-diagnostics.test.mjs`, `tests/botspace.test.mjs`: regressions.
- `README.md`, `docs/VERCEL_DEPLOYMENT.md`, this report: current behavior and operator instructions.

Other dirty files existed before this audit. No frontend design changes, dependency additions, secret edits, commits or deployments were made. Ignored build output was regenerated.

## Tests and live checks

| Check | Result | Evidence boundary |
|---|---|---|
| Baseline `npm test` | 85 passed, 0 failed | External APIs mocked |
| Final `npm test` after repairs | 89 passed, 0 failed | Validation, HTTP capture, provider contracts, partial failure, deduplication, claims, safe retries, disabled webhook and diagnostics |
| `npm run lint` | PASS | Static checks |
| `npm run build` | PASS | Production assets built; not deployed |
| `npm run test:mongo` | 2 skipped | No isolated `TEST_MONGODB_URI`; no production write substituted |
| `npm run integrations:check` | Report generated | Live Mongo read and unique index; six HTTP 200 matching conversation reads, two exact 404 absences, one invalid phone blocked locally in final sample |
| `npm run zoho:test` | FAIL | Live OAuth HTTP 200 with safe error `invalid_code`; CRM read never reached |
| Current public BotSpace Swagger comparison | PASS | HTTP 200 retrieval; saved/current paths and component schemas equal |
| Live Flow/CRM writes, WhatsApp sends, Meta delivery, browser production submission | NOT RUN | No write-test opt-in or verified account workflow; no unsolicited traffic generated |

One new synthetic validation test initially assumed a short UAE number was impossible; library metadata permits that length. The test was corrected to a clearly impossible US length rather than adding an unsupported country rule. Final suite passes. Existing mocked direct-CRM tests do not establish that the active Flow CRM action works. Meta construction/deduplication and bidirectional status tests remain blocked on their missing implementations and real configuration.

## Final verdict

**IS THE COMPLETE ROYAL MODEL LEAD MANAGEMENT CYCLE WORKING END TO END?**

**PARTIALLY — Some integrations work, but the complete cycle does not.**
