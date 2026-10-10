# BotSpace pending-template audit — 9 October 2026

## Confirmed cause

The owner confirmed that Vercel Production has the five API/send variables but does not have `BOTSPACE_TEMPLATE_VARIABLE_FIELDS`. The current auto-send service requires this sixth variable. Parsing its absent value fails; validation logs `botspace_template_configuration_invalid` and returns before claiming or sending. Consequently contact/conversation remain synced, template status remains pending, and WhatsApp remains not started. A fake-only reproduction confirmed zero claims and zero sends with the listed production configuration.

This is a configuration blocker in the current checkout. The earlier code fix allowing an already-synced enquiry to claim its pending template is already present. No further production-code changes are justified by this evidence. The missing-mapping gate was introduced in the preceding fix to avoid guessing the approved template's variable count/order.

## Execution trace

1. ContactForm validates input and POSTs `/api/enquiries` with a stable Idempotency-Key for an unchanged submission.
2. The API validates and durably upserts the enquiry by submission key; payload conflicts are rejected. Saved enquiries are the success boundary.
3. The existing awaited Zoho Flow attempt is unchanged.
4. BotSpace atomically claims pending contact synchronization. It reuses the row/phone registry contact mapping or reserves and creates the contact, saving partial progress. Contact creation ambiguity is not blindly retried.
5. It reuses the conversation ID or looks up by normalized phone; creation requires confirmed absence. Successful resolution persists contact/conversation IDs and synced state.
6. The route awaits sendEnquiryTemplate even when sync was already completed. It checks auto-send, production runtime, template ID and explicit variable mapping.
7. The atomic enquiry claim requires consent, synced state, both IDs, pending template state and no last-message ID/status. It writes sending before any provider request.
8. Existing sendTemplateMessage sends the configured templateId. Success stores returned IDs/status, accepted template state, null template error, and started/outbound WhatsApp fields.
9. Provider failures do not undo capture or HTTP 201. Explicit FAILED becomes failed; ambiguous outcomes become needs_reconciliation. A process killed during send can remain sending. Neither is automatically retried; returned IDs are preserved where possible.

## Provider contract and configuration

The saved docs/botspace-openapi.json specifies POST `/v1/{channelId}/message/send-message`, query `apiKey`, and JSON fields `name`, `phone`, `templateId`, `variables`. Existing client logic is reused. Swagger types variables as an object but supplies an array example; the client follows that example. No undocumented idempotency fields are added.

Required Vercel Production server variables:

- BOTSPACE_API_KEY: private workspace key.
- BOTSPACE_CHANNEL_ID: intended channel ID.
- BOTSPACE_BASE_URL: https://public-api.bot.space (also the default).
- BOTSPACE_TEMPLATE_ID: actual approved template ID, passed as templateId.
- BOTSPACE_AUTO_SEND: true. String false disables sending; no Boolean("false") conversion is used.
- BOTSPACE_TEMPLATE_VARIABLE_FIELDS: explicit JSON array matching approved slots. Use [] only for a confirmed zero-placeholder template. Only fullName slots are currently supported, e.g. ["fullName"]. Other slot types need a verified implementation, not guessed mappings.

NODE_ENV must be production; VERCEL_ENV must be production or absent. Preserve MONGODB_URI and existing Zoho settings. Optional contact-property variables remain BOTSPACE_PROPERTY_FULL_NAME, BOTSPACE_PROPERTY_EMAIL, BOTSPACE_PROPERTY_SERVICE and BOTSPACE_PROPERTY_ENQUIRY; they do not enable template sending.

The approved template's content and variable order are not contained in the saved Swagger and were not verified remotely. Set the correct mapping in Vercel and redeploy. Existing pending rows are not swept automatically: a same-key submission replay can resume a never-attempted pending send, but no real replay or historical send was performed in this audit.

## Expected successful record

botspaceSyncStatus=synced, botspaceSyncError=null, botspaceContactId present, botspaceConversationId present, botspaceTemplateStatus=accepted, botspaceTemplateId=configured ID, botspaceTemplateStartedAt=claim timestamp, botspaceTemplateError=null, botspaceLastMessageId=returned ID, botspaceLastMessageStatus=exact returned status, whatsappStarted=true, whatsappStatus=started, whatsappLastDirection=outbound. Acceptance is not delivery; botspaceLastMessageAt is not fabricated. The trusted polling helper can update delivery status for a matching message ID; no scheduler or verified webhook currently automates it.

Duplicate protection is at-most-one automatic send attempt per enquiry/submission identity. The provider contract does not promise exactly-once remote delivery. Different submission keys can represent different enquiries.

## Changes and verification

Only this report and tests/botspace-auto-template.test.mjs were changed in this follow-up. The regression reproduces repeated safe skips with the five-variable configuration, then confirms one send after explicit zero-slot configuration and no duplicate on replay. Terminal-status coverage now includes success. No production logic, Zoho Flow, contact/conversation behavior, credentials, or deployed settings were changed. Tests use fakes; no real provider call or WhatsApp message was made.

Validation completed: npm test passed all 106 tests; npm run lint and npm run build passed.
