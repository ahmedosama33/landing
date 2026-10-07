# Collection JSON examples

These are fictional example documents, not required database setup or production seed data. Collections can stay empty: MongoDB does not require an example document to define their fields. No documents were inserted by creating these files.

| File | Intended contents | Current backend support |
| --- | --- | --- |
| `clients.json` | One client profile per normalized international phone | Proposed; no Client model or automatic writes yet |
| `enquiries.json` | One submission, including consent, attribution and integration sync state | Implemented; matches the existing Enquiry model |
| `integrations.json` | Non-secret account/provider configuration metadata | Proposed; backend currently reads environment variables instead |
| `message_events.json` | An internal activity history associated with an enquiry/client | Proposed; no event persistence yet |

Each file is a JSON array using MongoDB Extended JSON: `$oid` identifies an ObjectId and `$date` identifies a date. The fixed IDs are illustrative, not provider-issued IDs. Repeated import of the same examples would conflict on IDs/submission key. If exploring these files in MongoDB Compass, use a separate demo database, not the application database containing real enquiries.

## What the app should write

Submit the website form to create real enquiries rather than manually composing them. The backend generates the submission key, payload hash, timestamps and sync results. Never reuse the example submission key for new enquiries or invent CRM/contact/conversation/message IDs. The sample payload hash was generated using the current shared validation and hashing logic. Editing the sample input fields without recomputing the hash breaks that relationship.

The enquiry example represents a saved submission after a WhatsApp handoff click, with integration sync still pending. `whatsappStarted` is true; `whatsappStatus` remains `not_started` because the current code does not populate conversation lifecycle from a click. A click does not prove a message was sent. Consent is fictional test data, not permission to contact an actual person.

The proposed message event describes that same website click. `eventType`, `source`, and the reference fields are **our proposed internal schema**, not BotSpace webhook fields. No BotSpace incoming/outgoing/delivery payload is invented. Exact provider mapping and verification still await documentation. No customer message content is included.

The proposed client/event collections are not linked by existing backend code. In particular, the current enquiry model has no `clientId`; the example does not add one. Matching the example client to its enquiry uses the same normalized phone. Implement client upsert/reference handling before relying on these relationships.

The integrations examples contain environment variable names only. Keep actual MongoDB/Zoho/BotSpace secrets in the private server environment. Editing an integrations document currently has no effect on runtime configuration, automatic sending, or account verification.

Creating collections alone does not make the app populate them. Connecting clients, integrations, and message_events requires a separate backend change; these examples do not alter the existing MongoDB -> Zoho -> BotSpace preparation -> WhatsApp handoff flow.
