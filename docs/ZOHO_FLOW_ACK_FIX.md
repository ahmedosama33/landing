# Zoho Flow acknowledgement fix — 8 October 2026

## Diagnosis

The exact error `Zoho Flow acknowledgement invalid; reconcile before retry.` is defined in `server/services/zohoFlowService.js`. The same file sends the webhook and validates its response.

| Component | Previous expectation | Original enquiry's actual response | New behavior |
| --- | --- | --- | --- |
| HTTP status | Exactly 200 | 200, inferred from the acknowledgement-error branch | Any 200–299 with a valid acknowledgement |
| Response headers | No header validation; response Content-Type was ignored | Not recorded; unknown | Content-Type does not gate JSON parsing; safe media-type diagnostic retained |
| Response body | JSON object with boolean `accepted: true` | Parsing failed or `accepted` was not boolean true; exact body was not recorded | JSON parsing accepts whitespace and any property ordering; still requires boolean true |

The POST request uses `Content-Type: application/json`, a five-second timeout, and rejects redirects. Request headers and response headers are different: the old sender never required the server's response to advertise JSON.

The reported failure was an acknowledgement-contract mismatch, not proof of CRM failure. The prior HTTP-200-only restriction was additionally too narrow, but did not cause this particular record's acknowledgement error. JSON whitespace and ordering were already handled by JSON parsing; explicit regression coverage now verifies both. No actual old response body can be recovered from the provided record. No speculative response example is presented as live evidence.

## Implementation

`zoho_flow_response` diagnostics and MongoDB's optional `zohoFlowResponse` record the actual status, sanitized media type, and short body projection. Only boolean `accepted` survives from a JSON body. Empty bodies, non-JSON content, and missing/invalid acknowledgement values receive fixed markers. Unknown JSON keys, string values, arbitrary text/HTML, and media-type parameters are never retained. Unknown media types become `other/redacted`. This excludes echoed webhook secrets and customer information rather than relying on unreliable text truncation or regex masking.

Example **mocked** diagnostic, not the original live response:

```json
{"status":202,"contentType":"application/json","body":"{\"accepted\":true}"}
```

`needs_reconciliation` now covers ambiguous acknowledgements, timeouts, transport failures, HTTP 3xx/5xx, and acknowledgement persistence failures. Configuration errors and HTTP 4xx remain `failed`. The existing claim query excludes `needs_reconciliation`, including private retries. The retry CLI now also requires `--reconciled` alongside `--idempotent-flow-confirmed` before attempting eligible records; these are operator attestations, not automated history checks.

The schema change is additive: a new enum member and optional diagnostics subdocument. No existing database documents were changed and no indexes are added. Deploy compatible readers/workers together. Historical errors stored as `failed` need reconciliation too; their original response details remain unavailable.

MongoDB persistence, BotSpace implementation, frontend, and API response remain unchanged. A saved enquiry still returns HTTP 201 during ambiguous Flow delivery. `synced` means webhook acknowledgement only; `zohoLeadId` is not populated or changed, and CRM creation is not asserted.

## Reconciliation of the reported enquiry

Before any resend, inspect Flow execution history by the original submission key and inspect the corresponding CRM action/Lead. If already delivered, resolve the local status without resending. If an action failed after receipt, recover it in Flow. Only reset an uncertain record to pending when a trusted operator has established that redelivery is safe and deduplication is configured. The backend cannot query Flow history through the inbound webhook URL.

No authenticated Flow/CRM account access is available in this session. The user was asked for the history result. No webhook retry, CRM lookup/write, WhatsApp message, or database mutation was performed. CRM Lead creation remains unverified.

## Files changed for this fix

- `server/services/zohoFlowService.js`
- `server/models/Enquiry.js`
- `server/retry.js`
- `tests/zoho-flow.test.mjs`
- `tests/production-http.test.mjs`
- `tests/enquiry.test.mjs`
- `tests/botspace.test.mjs`
- `tests/mongo.integration.mjs`
- `README.md`
- `docs/ZOHO_FLOW_MIGRATION.md`
- `docs/ZOHO_FLOW_ACK_FIX.md`

## Verification

- `npm test`: 85 passed, 0 failed.
- `npm run lint`: passed.
- `npm run build`: passed.
- Provider calls were mocked. Tests include 2xx acknowledgement variants, whitespace/order, invalid/malformed/empty JSON, non-2xx even with `accepted: true`, request/body timeouts, diagnostics redaction, schema validation, retry exclusion, and HTTP 201 with BotSpace success during ambiguous Flow delivery.
- Optional real MongoDB integration tests were updated but not run. No live delivery or CRM creation is claimed.
