# BotSpace connection and safe contact test

Updated 8 October 2026. These are local changes, not a deployment. This document supersedes older BotSpace notes where implementation details differ. Existing Zoho Flow delivery and order are preserved: MongoDB save, awaited Flow attempt, awaited BotSpace synchronization. Either provider can fail without undoing capture or preventing the other attempt. The owner subsequently authorized automatic production template messages; see the template section below.

## Official contract and mapping

The current [official BotSpace Swagger](https://public-api.bot.space/) was retrieved and inspected, including request/response schemas. Authentication is query `apiKey` over HTTPS; redirects and nonofficial API hosts are rejected. Credentials, request URLs and provider bodies are not logged.

| Operation | Endpoint | Supported mapping |
|---|---|---|
| Create account contact | POST `/v1/contact` | `fullName → name`, normalized `phone`, optional `email`, configured `contactProperties` |
| Update known contact properties | PATCH `/v1/contact/properties` | `contactId`, `contactProperties`; require `data.success === true` |
| Find channel conversation | GET `/v1/{channelId}/conversation` | Query `countryCode` and national `phone` |
| Prepare channel conversation | POST `/v1/{channelId}/conversation` | `name`, international `phone`; only after confirmed absence |

The schema has no account-contact lookup/list-by-phone, general native name/email update, or contact-delete endpoint. Contact creation is not documented as an upsert. Existing IDs therefore use property updates rather than repeated contact POSTs. Conversation IDs are never substituted for contact IDs.

Service and enquiry details map through actual configured custom-property keys. No keys are guessed. Native name/email are sent at creation; optional custom-property copies can carry later name/email updates. Missing property settings leave those values in MongoDB/Zoho only. Blank optional values are omitted instead of clearing existing values. Concurrent property updates are last-completed writes; full enquiry history stays in MongoDB.

## Required configuration

| Variable | Value to configure |
|---|---|
| `BOTSPACE_API_KEY` | Private API key issued by the intended Royal Model workspace |
| `BOTSPACE_CHANNEL_ID` | ID of its intended WhatsApp channel, not its phone number, WABA ID or contact ID |
| `BOTSPACE_BASE_URL` | `https://public-api.bot.space` (also the default) |
| `MONGODB_URI` | Existing database; write access to enquiries and new `botspace_contact_links` collection |
| `BOTSPACE_PROPERTY_SERVICE` | Exact BotSpace custom-property key for the selected service |
| `BOTSPACE_PROPERTY_ENQUIRY` | Exact custom-property key for the enquiry message |
| `BOTSPACE_PROPERTY_FULL_NAME` | Optional exact custom-property key for a later name copy |
| `BOTSPACE_PROPERTY_EMAIL` | Optional exact custom-property key for a later email copy |
| `BOTSPACE_TEST_PHONE` | Designated phone you control, used only by the gated diagnostic |

The local API key, channel and base URL are present. All four property-key settings and `BOTSPACE_TEST_PHONE` are currently missing. Obtain/create the desired properties in the BotSpace workspace and copy their exact keys privately; the public API provides no property-list read endpoint. Configure the same server variables in the intended deployment. Do not prefix them with `VITE_`. Keep the existing `ZOHO_FLOW_WEBHOOK_URL` unchanged.

The inspected channel ID is `6ac529a17669b2ff0c3bd3d2`. Successful reads establish API access to the returned conversation, but dashboard access must confirm the intended business workspace. No API key is printed. `BOTSPACE_TEMPLATE_ID` is required for automatic templates, but unnecessary for contact-only synchronization.

## Egyptian phones

Valid Egyptian local numbers are normalized using country metadata. `01012345678`, `201012345678`, `00201012345678`, `+20 10 1234 5678` and Arabic-numeral equivalents become `+201012345678`. Egyptian landline `02 2345 6789` becomes `+20223456789`. Explicit valid international numbers retain their country identity. Other countries require `+` or `00`; the form explains that local numbers are interpreted as Egyptian. Invalid/unrecognized calling codes are rejected. This does not establish WhatsApp registration.

## Duplicate protection and recovery

Existing unique submission keys and per-enquiry claims remain. Before creating an unknown contact, the backend atomically reserves a normalized phone hash in `botspace_contact_links` using MongoDB's unique `_id` index. Different enquiries cannot both create that phone. The returned contact ID is persisted in this ledger before subsequent enquiry/conversation work.

Reservations never expire automatically. A timeout, HTTP failure, malformed response or process interruption can follow a successful remote create. Subsequent attempts stop for reconciliation. Historical failed/stale syncing enquiries without contact IDs also block a fresh create. Database outages prevent an unguarded create. The first authorized application insert creates the collection; no new paid infrastructure is required.

This guards application-originated attempts, not contacts independently created elsewhere. A conversation 404 does not prove that the account contact is absent. On conflict/ambiguity, inspect Contacts, establish the actual contact ID, and reconcile ledger/enquiry mappings privately before resetting anything. Do not remove a reservation just because it is old. This deployment assumes one workspace; switching accounts requires reviewing stored mappings first. A concurrent losing enquiry may remain failed and need reviewed recovery after the winner's mapping is available.

## Diagnostic commands

Read-only existing state inspection:

```text
npm run integrations:check
```

Contact-test dry run, with zero database/provider writes and zero provider calls:

```text
npm run botspace:test-contact
```

Only after explicit approval, privately set `BOTSPACE_TEST_PHONE` to a phone you control, verify that it is absent in account Contacts, and run:

```text
npm run botspace:test-contact -- --allow-create-contact --absence-confirmed
```

Both flags are required. This command authorizes creation of the fixed-name `Royal Model integration test` contact and its MongoDB deduplication ledger, not a message. It checks local mappings and the channel conversation before creating. A known conversation without a contact mapping stops creation for reconciliation. Ambiguous writes retain the reservation across processes. It never invokes Flow, submits an enquiry, creates a conversation, sends WhatsApp messages or emits conversions. No cleanup through an undocumented endpoint is attempted.

Output includes method, credential-free endpoint path, actual HTTP status, returned contact ID and reconciliation state. It excludes phone numbers, keys and raw responses. A provider-returned ID confirms the create response, while independent contact-GET verification is unavailable. Dashboard visibility remains manual. Do not bypass a reservation to retry an ambiguous attempt.

## Live findings and where to look

Repeated read-only checks on 8 October reproduced the earlier audit:

- Six sampled enquiry lookups returned HTTP 200 for conversation `6ac65574739277a351709b39` with matching phone identity. These are repeat enquiries for one conversation, not six independently verified contacts.
- Five sampled rows store contact `6ac64d4848ad2166306d9243`. One still has a historical rejected-sync error and lacks a saved conversation mapping, even though that conversation now exists remotely.
- Two historically configuration-failed rows returned HTTP 404 with exact provider message `Conversation not found`.
- The latest failed enquiry has no contact ID, a historical contact-create HTTP 500, and an unrecognized phone calling code. Invalid input is proven; the provider's internal reason for the historical 500 is unknown.
- The old generic rejection did not retain status/operation, so its original response cannot be reconstructed. Current failures retain safe operation/status metadata.

There are multiple failure modes, not one proven universal cause. Current key/channel reads work, but create/update permission is not established by those reads. Flow can reach CRM while BotSpace fails because provider attempts and statuses are independent.

Open **Contacts** in the BotSpace workspace that issued the API key and search the normalized phone privately. Separately inspect the configured WhatsApp channel's **Inbox/Conversations**, including closed/unassigned filters and salesperson access. A contact-only test may appear only in Contacts. Neither a contact nor a conversation container proves a message was sent.

No live test contact was created: explicit write approval and a designated test phone were not supplied. The dry run made zero provider calls. No live customer records were modified or messages sent during this task.

## Verification and changed files

95 automated tests passed; lint and production build passed. Three optional real Mongo tests skipped because `TEST_MONGODB_URI` is absent. New tests cover Egyptian normalization, official property payloads, false success responses, concurrent reservations, ambiguous retry blocking, explicit permission gates and existing-contact updates. Mocked writes do not establish live provider creation/update success.

Changed: shared phone validation, contact-form helper text, BotSpace service/config, enquiry store, read-only diagnostic configuration reporting, `.env.example`, package scripts and relevant tests. Added: contact registry, contact-test orchestration/CLI, contact regression tests and this guide. README/original audit link here. No Zoho service changes, new dependencies or deployment were made. Preserve earlier uncommitted changes.

## Automatic template after live submissions

The owner requested automatic template sending and described the template as "Hi". This is treated as the complete text with no placeholders; template approval/content cannot be independently read through the documented API. The configured `BOTSPACE_TEMPLATE_ID` is retained, not replaced with literal message text.

Configure in Vercel **Production** and redeploy:

```dotenv
BOTSPACE_AUTO_SEND=true
BOTSPACE_TEMPLATE_VARIABLE_FIELDS=[]
# Retain the actual approved BOTSPACE_TEMPLATE_ID and existing API/channel settings.
```

The local private `.env` toggle is enabled under this authorization; NODE_ENV must also be production. Vercel Preview is explicitly excluded even though its NODE_ENV is production. For a template needing a name placeholder, the supported field list is `["fullName"]`; arrange values in the template's exact slot order. No service or clinical enquiry details are included. Local development and contact-test commands never send automatically.

Only a newly completed BotSpace sync in the form route triggers a template. MongoDB atomically changes `botspaceTemplateStatus` from `pending` to `sending` before the provider call and requires saved consent plus BotSpace `synced`. The request awaits the documented `POST /v1/{channelId}/message/send-message`. A validated response stores the message and conversation IDs, exact provider status and template status `accepted` (or `failed` if the provider reports FAILED). Acceptance is not delivery; verify the message in Inbox or use the existing trusted delivery-status helper.

Timeouts, malformed responses and failed result persistence become `needs_reconciliation`; a process killed mid-send remains `sending`. Neither state is automatically retried. Browser replays, old synced enquiries and the private contact recovery command do not auto-send. The protection is per enquiry/submission key: separate intentional submissions with different keys may each produce a message. No historical backfill or mass send is performed.

Message failure does not undo the saved enquiry, BotSpace contact/conversation, or Zoho attempt; the form still returns 201 for successful capture. There is a possible missed-send window if the process stops after contact sync but before the message claim; reconcile it manually instead of replaying submissions. Configuration errors log `botspace_template_configuration_invalid` without sending. Production monitoring should inspect pending/sending/reconciliation template states.

100 automated tests passed after this addition; lint/build passed. Tests cover production gating, concurrent claims, replay protection, unknown outcomes, preservation of returned IDs and the actual form route retaining Zoho success despite template failure. No live message was sent and delivery is unverified. Live URL/Vercel project details are still needed to deploy and verify production.
