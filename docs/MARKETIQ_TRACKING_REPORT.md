# Marketiq website tracking handoff — 10 October 2026

Implemented locally; nothing deployed and no GTM workspace or marketing configuration changed. GA4, Google Ads and Meta remain managed exclusively by GTM.

## Changed files

- `index.html`: one GTM-5K6HVKD2 script in head and one noscript iframe immediately inside body. No standalone GA4, Ads or Meta installation. No existing Meta verification token was found.
- `src/main.jsx`: capture landing attribution before React renders.
- `src/lib/attribution.js`: extend the form's former inline UTM collection with bounded advertising capture, per-value 90-day expiry, consent-gated persistence/cookies, and graceful storage failures.
- `shared/attribution.js`: shared identifier names, 512-character limit and opaque ASCII token validation.
- `src/components/contactform.jsx`: use attribution utility; preserve the request snapshot and idempotency key on unchanged retries; emit conversion only after successful API confirmation.
- `src/lib/tracking.js`: emit only enquiry ID and event name; deduplicate IDs in page memory/dataLayer; isolate analytics errors from form success.
- `shared/enquiry.js`: validate and retain six optional advertising identifiers.
- `server/models/Enquiry.js`: persist identifiers with matching validation.
- `server/services/enquiryStore.js`: exclude empty new optional identifiers from hashes to preserve pre-update submission keys.
- `server/services/zohoFlowService.js`: include six identifiers in the existing allowlisted webhook payload.
- `tests/tracking.test.mjs`, `tests/zoho-flow.test.mjs`: tracking, consent, attribution and forwarding coverage.
- `README.md`, this report: current payload and handoff documentation.

No design, styling, contact buttons, services or integration retry policies were changed.

## Actual form/API contract

The visible fields are `fullName`, `email`, `phone`, `service`, and contact permission `consent`. There is no preferred contact method field. `company_website` is a hidden honeypot. The shared validator adds `message: ""`; there is currently no message input. Phone is normalized to international format and email is lowercased. The frontend requires email; the existing backend permits it to be empty.

The complete frontend JSON structure is below. Angle-bracket values describe runtime strings; they are documentation, not defaults sent by the implementation.

```json
{
  "fullName": "<validated name>",
  "phone": "<normalized international phone>",
  "email": "<normalized email>",
  "service": "<selected service>",
  "message": "",
  "consent": true,
  "landingPage": "<landing URL origin and pathname>",
  "referrer": "<referrer origin and pathname, or empty>",
  "utmSource": "",
  "utmMedium": "",
  "utmCampaign": "",
  "utmContent": "",
  "utmTerm": "",
  "gclid": "",
  "gbraid": "",
  "wbraid": "",
  "fbclid": "",
  "fbp": "",
  "fbc": "",
  "company_website": ""
}
```

UTMs continue using camelCase payload keys mapped from snake_case URL parameters. Empty attribution values above are replaced only by actual captured, validated, permitted values. Cookies are read, never manufactured. Query strings and fragments are excluded from stored landing/referrer URLs. Attribution is captured on initial page load and survives React navigation in memory. The existing nonempty per-field values survive visits without corresponding values; new nonempty values replace their field. Expiry is per value, not extended by merely reading storage. This is not a cross-provider last-click attribution model.

Request: `POST /api/enquiries`, `Content-Type: application/json`, `Idempotency-Key: <UUID v4>`. The honeypot is checked then excluded from storage/Flow. Unknown fields are stripped.

Actual success response, HTTP 201:

```json
{"success":true,"enquiryId":"<saved MongoDB ObjectId>","message":"Your enquiry has been received."}
```

`enquiryId` is the unique MongoDB record ID, not a Zoho Lead ID. It is stable for an idempotent replay. Save failure, validation failure and conflicting-key rejection do not emit conversions. A successful idempotent replay does not emit a second event for an ID already tracked on this page. Deduplication is page-scoped; it does not claim cross-device or permanent advertising-platform deduplication. The request snapshot prevents late cookies from creating a fresh submission key for an unchanged retry.

The only custom frontend GTM event is:

```js
{ event: 'enquiry_submitted', enquiry_id: '<saved MongoDB ObjectId>' }
```

No patient details, service, message, contact consent or advertising identifiers are added to this event. An unavailable/broken GTM queue cannot turn an accepted submission into an error. Existing WhatsApp and both phone numbers remain actual `a` links; no additional click events were introduced.

## Consent integration required

No advertising CMP, consent API or advertising policy was found in this repository. The contact checkbox is permission to contact a patient, not advertising consent. Until Marketiq connects an explicit advertising-consent signal, URL click IDs remain in page memory, advertising payload fields are empty, localStorage is not read/written, and Meta cookies are not read. Existing UTMs, sanitized landing page and referrer still accompany the enquiry.

The CMP can set `window.royalModelAdvertisingConsent = true` before the application starts for an already-consented visitor. For decisions or changes after application start, dispatch:

```js
window.dispatchEvent(new CustomEvent('royalmodel:advertising-consent', { detail: true }));
// On denial/withdrawal:
window.dispatchEvent(new CustomEvent('royalmodel:advertising-consent', { detail: false }));
```

Only boolean `true` grants permission. Do not set it unconditionally. Granted consent enables up to 90-day localStorage retention under `royalmodel.attribution.v1` and real `_fbp`/`_fbc` reads. Withdrawal removes that storage and in-memory advertising values. It does not delete vendor-owned cookies or retrospectively retract an already-submitted request. Unchanged retries retain the original request snapshot to prevent duplicate durable enquiries. The CMP owns its consent record, expiry, rehydration and vendor-cookie withdrawal handling.

This application hook controls CRM attribution only. It is NOT Google Consent Mode or Meta consent enforcement. The requested GTM snippet loads immediately, and GTM-managed tags may fire according to Marketiq's configuration. Marketiq must configure and validate vendor consent gating separately before release. The supplied GTM export marks consent settings NOT_SET; this alone does not prove consent compliance. See Google's [consent setup guidance](https://developers.google.com/tag-platform/security/guides/consent).

## Zoho integration and field mapping

`server/app.js` validates and saves through `enquiryStore.save`, then calls `syncFlowEnquiry` in `server/services/zohoFlowService.js`. This invokes `createZohoFlowClient().sync`, posting JSON to the server-only `ZOHO_FLOW_WEBHOOK_URL`. `mapFlowPayload` now sends 22 fields: the 19 validated enquiry fields plus `enquiryId`, `submissionKey`, and `createdAt`; it excludes the honeypot. See README for the complete webhook example.

Flow's authenticated CRM action creates/updates Leads. The legacy direct OAuth service is not used by the submission path. Existing atomic delivery claims and recovery behavior are preserved; this change does not add lead creation paths or replay historical records. Flow must continue enforcing CRM deduplication using the submission identity. A 2xx response with `{"accepted":true}` proves webhook receipt only, not CRM save or field population.

The requested mappings are below. Right-hand values are requested DISPLAY LABELS, not verified API names:

| Flow key | Requested Lead label |
| --- | --- |
| gclid | GCLID |
| gbraid | GBRAID |
| wbraid | WBRAID |
| fbclid | FBCLID |
| fbp | FBP |
| fbc | FBC |
| utmSource | UTM Source |
| utmMedium | UTM Medium |
| utmCampaign | UTM Campaign |
| utmContent | UTM Content |
| utmTerm | UTM Term |
| landingPage | Landing Page |

Real CRM metadata and the live Flow definition are not available in the repository. No API names were invented or applied. A Zoho administrator must inspect actual Lead fields/API names, confirm compatible lengths/types, refresh Flow's webhook sample/schema, and map these keys in the existing CRM action. If fields are missing, an administrator must create/approve them. Preserve existing mappings and deduplication. See [Zoho Flow data mapping](https://help.zoho.com/portal/en/kb/flow/user-guide/create-a-flow/building-a-flow/articles/data-mapping). Backend/model and webhook forwarding are verified locally; actual MongoDB writes and CRM field population were not verified against live services. No production enquiries, messages or webhook requests were sent.

## Environment, CSP and release review

No concrete staging URL was found. Vercel Preview setup is documented, but no active preview address or isolated resources were verified. Local development uses `http://localhost:5173` with `/api` proxied to the local backend. Do not use production integration credentials for synthetic browser tests.

Helmet's default CSP is applied to API responses only. Vite serves the frontend separately; no frontend CSP is declared in index.html or vercel.json. No policy was weakened. Any hosting-layer CSP outside this checkout needs separate inspection and narrow GTM/GA4/Ads/Meta endpoint allowances appropriate to enabled tags.

The Meta verification token is absent. Marketiq must provide the actual token; then add `<meta name="facebook-domain-verification" content="ACTUAL_TOKEN_FROM_MARKETIQ" />` inside head. No placeholder was inserted into the website.

Before publishing, Marketiq must review healthcare advertising restrictions, the enquiry-ID linkage, automatic GA4 form collection, Meta automatic/advanced matching, click URL collection and page URL/referrer collection. A minimal custom event does not prevent a GTM tag from reading the DOM or collecting sensitive query strings independently. In the supplied export, review the Meta base tag used as a setup tag: it includes PageView and has ONCE_PER_EVENT behavior, which can produce extra PageViews when sequenced for other events. This report does not change the marketing container.

Test in GTM Preview/Tag Assistant on an authorized staging environment: initial page view; success exactly once; validation/server failure with no conversion; unchanged retries; granted/denied consent; WhatsApp/mobile/landline clicks; Mongo/Flow field retention; CRM action deduplication. Marketiq owns GTM review and publication. Production tag firing and healthcare/privacy compliance have not been certified here.

## Verification results

- `npm test`: 113 tests passed, zero failed. This includes existing API success/failure/replay tests and new attribution, consent, expiry, broken storage/cookies, event deduplication, identifier validation, model serialization, Flow mapping and legacy hash compatibility checks.
- `npm run lint`: passed.
- `npm run build`: passed; production assets include the GTM installation and frontend changes.
- Exactly one GTM script and one noscript fallback verified. No standalone vendor installation or Meta verification placeholder introduced.
- No live MongoDB integration test, Zoho CRM field verification, browser/Tag Assistant session, deployment or GTM publication performed. Local model validation and fake-provider tests must not be interpreted as proof of live persistence, CRM success or production conversions.
