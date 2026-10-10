# Meta verification and cookie consent — 11 October 2026

## Fail-closed initialization safeguard

The GTM loader now requires `royalModelConsent.readyDataLayer` to reference the current dataLayer. `public/consent.js` publishes this readiness marker only after default-denied consent, saved preferences and all consent listeners initialize successfully. A missing, blocked, malformed or interrupted consent script therefore leaves GTM unloaded. A replaced dataLayer also fails the check. A separate start guard prevents duplicate GTM initialization if the inline loader runs again; no new consent events are introduced.

The GTM noscript iframe has been removed because it could initialize tracking without the JavaScript consent state. This supersedes references to a retained noscript fallback below. No-JavaScript visits intentionally receive no GTM tracking. If the consent script fails, React and the enquiry entry point remain independent, but consent buttons cannot save a new preference until the script loads successfully on a subsequent page load. No automatic retry or permissive fallback was added.

Files changed for this safeguard: `index.html`, `public/consent.js`, `tests/tracking.test.mjs`, new `tests/consent-bootstrap.test.mjs`, and this report. The four new tests cover a failed download (including saved acceptance), partial initialization failure, successful initialization order with duplicate-execution guards, and dataLayer replacement. All **125 tests**, lint and production build passed. The earlier 121-test count below describes the previous implementation. No deployment or GTM publication occurred. Marketiq's tag-level consent work remains required when initialization succeeds.

Implemented in the local checkout. No deployment, GTM publication, live CRM writes, or changes to the supplied GTM export were made. Website consent and CRM attribution work locally; GTM-side vendor enforcement remains a release requirement.

## Files created or changed

| File | Change |
| --- | --- |
| `index.html` | Exact Meta verification token; synchronous consent bootstrap before the existing single GTM loader |
| `public/consent.js` | Saved choice, early Google defaults, choice updates, existing boolean event contract, cross-tab and expiry handling |
| `src/components/CookieConsentBanner.jsx` | Reusable banner and Cookie Settings footer control |
| `src/components/cookie-consent.css` | Scoped responsive styling, focus outlines, bottom space reservation |
| `src/App.jsx` | Mount consent component once, after page content |
| `src/lib/attribution.js` | Capture IDs only with consent; capture immediately on Accept; clear on Decline; redact cached retry attribution |
| `src/components/contactform.jsx` | Apply current consent to cached retry payloads while retaining the same submission key |
| `server/services/enquiryStore.js` | Recognize an otherwise-identical retry that removes all optional advertising identifiers |
| `tests/consent.test.mjs` | Consent lifecycle, timing, storage, Google queue, redacted retries, and API-to-Flow tests |
| `tests/tracking.test.mjs` | Assert exact verification tag and retain single-loader/event regression checks |
| `README.md`, `docs/MARKETIQ_TRACKING_REPORT.md`, this report | Updated handoff and history |

`src/main.jsx` still initializes the existing attribution utility before React renders. `src/lib/tracking.js` and the Zoho Flow payload mapper are unchanged. No dependency was added. No `.env` contents were read or modified.

## Meta verification

Immediately after charset in root `index.html`:

```html
<meta name="facebook-domain-verification" content="hf8fg2qxknf4hmsbgj1ind2hsm1n0w" />
```

The exact tag appears once in source and once in generated `dist/index.html`. Existing SEO metadata and GTM's loader/noscript fallback are retained. No direct Meta Pixel installation was added. Meta's dashboard verification itself has not been performed.

## Banner and returning visitors

The component is mounted once in `src/App.jsx`. It displays the requested title, description, Decline and Accept buttons. The bottom panel uses Cairo, clinic gold, cream and rounded controls. It is nonmodal, has native keyboard-operable buttons, labelled content and no preselected consent. A measured spacer plus document scroll padding allows content and form controls to scroll above the fixed panel. Small screens use stacked text and full-width paired buttons; the panel can scroll internally on short screens.

The small Cookie Settings button appears in a footer after page content. It reopens the choices, focuses the heading, and permits either choice to replace the prior one. Choosing a value returns focus to Cookie Settings. First appearance does not steal focus or trap keyboard navigation.

Both choices are persisted under localStorage key `royalModelAdvertisingConsent`:

```json
{"version":1,"value":true,"updatedAt":1791676800000}
```

This timestamp is only an illustrative format. Runtime writes use `Date.now()`. Decline uses `"value":false`. The record is valid for 90 days; invalid versions, malformed JSON, non-boolean values, future timestamps, absent or expired decisions are never acceptance. Expiry is checked at startup and on window focus. Valid saved choices suppress the banner until Cookie Settings is reopened. Expired or missing choices show it again. Cross-tab storage changes update the active page without repeatedly writing the same record.

The preference record is kept after Decline so the site remembers the decision; it contains no identifiers or patient details. If storage is blocked, choice and consent work in memory for the visit, and the banner may appear again on the next load.

## Existing consent contract and attribution

The existing runtime flag remains a boolean: `window.royalModelAdvertisingConsent`. The bootstrap restores this before React's attribution initialization and before GTM. No saved choice sets the flag to false while the consent service retains `null` to distinguish undecided from declined.

The exact existing event contract is preserved:

```js
window.dispatchEvent(new CustomEvent('royalmodel:advertising-consent', { detail: true }));
window.dispatchEvent(new CustomEvent('royalmodel:advertising-consent', { detail: false }));
```

The banner calls `window.royalModelConsent.setChoice(true/false)`, which dispatches this event. The early listener saves the decision and updates Google consent; the existing attribution listener then captures or clears values. Non-boolean event details are ignored.

Accept immediately reads eligible IDs from the current URL and real `_fbp`/`_fbc` cookies without reload. New cookie values can also be read when the enquiry is prepared. No IDs are fabricated. Granted attribution uses the existing `royalmodel.attribution.v1` object of `{value, at}` entries with per-value 90-day expiry.

Decline clears that attribution storage and in-memory advertising fields, stops extracting click IDs and reading Meta cookies, and sends empty advertising fields to `/api/enquiries`. Existing UTMs, sanitized landing/referrer URLs and essential enquiry/contact behavior remain. The contact-permission checkbox is separate and cannot grant advertising consent. Denied/undecided startup also removes leftover attribution storage. This implementation does not delete vendor cookies, remove records already sent to CRM, unload an already-loaded pixel, or replace GTM vendor consent enforcement.

The backend and Flow field structure stays unchanged: `gclid`, `gbraid`, `wbraid`, `fbclid`, `fbp`, `fbc`, existing camelCase UTMs, and enquiry fields. Accepted visitors send available IDs; declined visitors send empty strings. Both retain the existing HTTP 201 response containing `success`, `enquiryId`, and `message`. Live CRM field configuration is still Marketiq/Zoho's responsibility.

For unchanged retries, original attribution stays frozen to avoid new enquiries when cookies change. Withdrawal now strips IDs even from that snapshot, retaining the original idempotency key. The store accepts this redacted replay only when every non-advertising submitted field still matches the saved record and all incoming advertising fields are empty. Changed patient data or replacement IDs still conflict. An already-saved record is returned rather than creating another; historical database/CRM attribution is not erased. Accept after an already-attempted declined submission does not enrich that retry or create a replacement lead.

`enquiry_submitted` still fires only after confirmed API success with a valid saved ID, once per ID within the current page. Its custom payload remains exactly event name and enquiry ID. No names, email, phone, service/treatment, messages or advertising IDs are added to advertising events by this change.

## Google Consent Mode

`/consent.js` is a synchronous classic script immediately before GTM in head. It initializes the same dataLayer, queues denied defaults, enables `ads_data_redaction`, restores any valid saved acceptance, and only then allows the unchanged GTM snippet to execute. It does not load `gtag.js`, create a second container, or issue page-view/conversion commands.

| Category | No choice / Decline | Accept |
| --- | --- | --- |
| ad_storage | denied | granted |
| analytics_storage | denied | granted |
| ad_user_data | denied | granted |
| ad_personalization | denied | denied |

Accept grants measurement storage and advertising-measurement data use described in the supplied text. It never enables personalized advertising: the text does not request profiling or personalization, and no reviewed policy authorizing it is present. Marketiq must review the final policy and measurement configuration; consent does not authorize otherwise-prohibited healthcare data sharing.

Updates use `dataLayer.push(arguments)` with `('consent', 'update', categories)`, followed on a changed choice by:

```js
{ event: 'royalmodel_consent_updated', advertising_consent: 'granted' } // or 'denied'
```

The latter is a GTM lifecycle signal, not a patient/conversion event. Repeating the same choice does not issue another update signal. Returning acceptance is restored before normal GTM initialization rather than emitting a second initialization/page-view event.

Google consent-aware tags can send cookieless pings under denied consent. Therefore denied defaults alone are not proof of zero optional tracking/network requests. See [Google consent mode](https://developers.google.com/tag-platform/security/concepts/consent-mode) and [consent setup](https://developers.google.com/tag-platform/security/guides/consent).

## Exact GTM work required from Marketiq

The local export `GTM-5K6HVKD2_royalmodel_import.json` was inspected read-only. All 14 tags have `consentStatus: NOT_SET`. Meta tags are Custom HTML; the Meta base tag initializes the pixel and sends PageView, is set to ONCE_PER_EVENT, and is also used as a setup tag by other Meta tags with `stopOnSetupFailure: false`. This does not establish vendor consent enforcement. The live workspace may differ from that export.

Before deployment/publication, Marketiq should:

1. Enable Consent Overview and verify defaults/updates in Tag Assistant. Keep a single default-consent owner; do not add a competing default that resets returning acceptance. If moving consent management into a GTM template, use Google's `setDefaultConsentState`/`updateConsentState` APIs and coordinate that migration rather than installing a second website system.
2. Define a GTM JavaScript variable reading `window.royalModelAdvertisingConsent`, testing strict boolean true. Create a Custom Event trigger for `royalmodel_consent_updated` with `advertising_consent` equal to `granted` and that boolean true.
3. To honor Decline as **no optional tag firing**, add explicit consent checks/trigger guards: all GA4 base/event tags require `analytics_storage`; Ads base/conversion tags require `ad_storage` and `ad_user_data`; Conversion Linker requires `ad_storage`. Keep personalization denied and do not add remarketing/personalized-audience processing. Use the late-grant event as an additional trigger for base initialization where needed, with once-per-page guards to prevent duplicate initialization/PageViews. Conversion tags retain their original success/click triggers; never replay declined conversions just because consent is later granted.
4. Gate **every Meta tag**, including base, history PageView, Lead and both Contact tags, with explicit advertising-consent checks. Custom HTML does not automatically obey Google Consent Mode. Apply gating to sequenced setup tags as well; a trigger guard alone is insufficient if another tag invokes setup directly. Review the setup failure behavior and ensure dependent events cannot run after consent blocks initialization.
5. Initialize Meta once per page only after consent, including late acceptance. Separate initialization from history PageViews so setup sequencing cannot repeatedly send PageView. On the denied lifecycle signal, revoke an already-loaded Meta pixel using its documented consent handling without loading a new pixel. On reacceptance, grant appropriately without reinitializing or replaying old events. Disable automatic/advanced matching and unwanted automatic DOM/form collection; do not transmit clinical fields or sensitive link/query contents.
6. Review any noscript/custom-image tags: JavaScript consent cannot communicate a choice when JavaScript is disabled. Do not use the retained standard GTM noscript fallback to bypass optional-tag consent.
7. Verify fresh, accepted-returning, declined-returning, late Accept, withdrawal, and reacceptance paths. Check GA4/Ads/Meta network traffic, cookie writes and event counts, not just dataLayer values. Confirm no duplicate PageViews or leads and no form/contact functionality regression.

Google documents that Custom HTML tags may need explicit additional consent checks: [GTM consent support](https://support.google.com/tagmanager/answer/10718549). No GTM tags, triggers, variables or marketing settings were changed by this implementation. Until Marketiq completes those controls, do not describe all vendor advertising tracking as disabled on Decline or the site as fully compliant.

## Verification and limits

- `npm test`: **121 passed, zero failures**. Includes existing enquiry/event/link regressions and eight new consent tests.
- `npm run lint`: passed.
- `npm run build`: passed.
- Built HTML verified: exact Meta token once, one GTM script, consent script before GTM, and `dist/consent.js` copied intact.
- Tests exercise startup/defaults, actual boolean CustomEvents, late Accept, Decline, storage expiry/corruption/unavailability, returning decisions, cross-tab withdrawal, no repeated consent-update events, real-ID capture, redacted retries, and HTTP 201 plus mocked Flow forwarding under both choices.
- Source provides Cookie Settings reopening, native buttons/focus handling and responsive CSS. Browser discovery returned no connected browsers, so real interaction, keyboard and visual viewport checks could not be performed. These remain manual QA tasks; passing build/unit tests is not visual verification.
- No production GTM/Tag Assistant, Meta dashboard verification, live MongoDB write or Zoho field-population test was performed. No synthetic messages or enquiries were sent to production.
- Healthcare advertising eligibility, patient-linked enquiry identifiers, automatic vendor collection, consent policy/disclosures and permitted processing require Marketiq/clinic review. Acceptance alone does not establish compliance. The website currently has no verified privacy-policy URL to link, so none was fabricated.
