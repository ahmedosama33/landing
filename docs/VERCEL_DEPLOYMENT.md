# Vercel deployment preparation

Prepared 7 October 2026. No deployment, repository push, Vercel account change, Atlas setup or webhook registration was performed.

## Project settings

| Setting | Value |
| --- | --- |
| Framework preset | Vite |
| Root directory | Directory containing `package.json`, `vercel.json` and `api/` |
| Node.js | 22.x, matching package engines |
| Install command | `npm ci` |
| Build command | `npm run build` |
| Output directory | `dist` |
| API entry | `api/index.js`, exporting Express without starting a listener |
| Function duration | 60 seconds, configured for `api/index.js` |

The current Git root is `royal-model/clinic-landing`, so use `.` if importing that repository. If you later create a repository rooted higher up, set Vercel's Root Directory to the corresponding path to `clinic-landing` instead. Do not deploy the outer folder with no package file.

`/api` and `/api/*` route to the Express function. The SPA fallback explicitly excludes API paths, so an unknown API endpoint returns JSON 404. Frontend deep links fall back to React, which renders its own Not Found page when appropriate. Static build assets are served by Vercel. `server/dev.js` remains local-only; Vite's `/api` proxy targets 127.0.0.1:3000 only during development. Frontend fetches remain relative.

Reference: [Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite), [Node functions](https://vercel.com/docs/functions/runtimes/node-js), and [rewrites](https://vercel.com/docs/routing/rewrites). Local Express tests and rewrite checks do not replace a deployed routing smoke test.

## Environment variables

Enter these under Vercel Project Settings -> Environment Variables for Production. Configure Preview separately using isolated database/CRM resources; do not accidentally sync preview submissions into production accounts. Set private credentials as sensitive where supported. Never put them in `vercel.json`, source files, or `VITE_` variables. Redeploy after changing deployment environment settings.

| Required variable | Visibility / value |
| --- | --- |
| `MONGODB_URI` | Server only; Atlas connection string with the chosen database name and encoded credentials |
| `ZOHO_CLIENT_ID` | Server only; private client configuration |
| `ZOHO_CLIENT_SECRET` | Server only; secret |
| `ZOHO_REFRESH_TOKEN` | Server only; valid refresh token for the matching client and organization |
| `ZOHO_ACCOUNTS_URL` | Server only; `https://accounts.zoho.com` for this .com account |
| `ZOHO_API_BASE_URL` | Server only; `https://www.zohoapis.com` |
| `BOTSPACE_API_KEY` | Server only; private API key |
| `BOTSPACE_CHANNEL_ID` | Server only; `6ac529a17669b2ff0c3bd3d2` (Royal Model) |
| `BOTSPACE_BASE_URL` | Server only; `https://public-api.bot.space` |
| `VITE_CLINIC_WHATSAPP_NUMBER` | Public build-time value; confirmed international digits only, without `+`, spaces or punctuation |

The integrations require their settings to sync, but enquiry capture succeeds when MongoDB saves even if an integration is unavailable. Missing/invalid WhatsApp configuration hides the continuation link; it does not block the form. Changes to the public WhatsApp variable require a rebuild.

| Optional server variable | Meaning |
| --- | --- |
| `ALLOWED_ORIGIN` | One additional exact HTTPS origin; normally blank for same-project frontend/API; trailing slash normalized |
| `ZOHO_LEADS_MODULE` | Defaults to `Leads` |
| `ZOHO_LEAD_STATUS` | Use only a confirmed CRM picklist value |
| `ZOHO_FIELD_*` | Real custom field API names from CRM metadata; full list in `.env.example` |
| `BOTSPACE_TEMPLATE_ID` | Approved template for explicit server-side sends |
| `BOTSPACE_AUTO_SEND` | Keep `false`; reserved switch, automatic sends are not implemented even if set true |
| `BOTSPACE_WEBHOOK_SECRET` | Reserved and unused until the actual verification contract is implemented |

Vercel manages production runtime settings; do not copy local `PORT`, `TEST_MONGODB_URI`, or development `NODE_ENV` into Production. Local `.env` is for the Node dev commands; `.env.local` can override public Vite settings locally. Neither is a deployment configuration source.

## Backend readiness and limits

`server/config/env.js` is the lazy configuration entry point: `getMongoConfig`, `getZohoConfig`, `getBotspaceConfig`, and `getAllowedOrigin`. It reuses existing provider validators; no eager credential check occurs during import/build. Missing Mongo configuration logs a fixed safe server error and returns a controlled 500 for capture. Health returns only `{"status":"ok"}` and does not test Atlas or providers.

Mongoose connection/promise caching, five-connection pool, timeouts, and disabled automatic index creation are preserved. Warm requests reuse a connection, and simultaneous cold requests share the connection promise. Connections are not closed at the end of each request. Vercel must reach an external MongoDB host; the local `localhost` URI cannot work there.

Zoho URLs are HTTPS origins without `/crm/v8` or OAuth paths. Optional trailing slashes normalize to the same origin; service paths are appended once. BotSpace credentials stay server-side; request logging never includes its `apiKey` query parameter. Provider errors are sanitized. Production avoids development stage logs, full request bodies, raw provider responses, tokens and stack traces. The public capture response contains only success, enquiry ID and the received message.

Helmet, JSON body limits, honeypot, validation, origin checks and the per-instance enquiry rate limiter remain. Configure a Vercel Firewall/WAF rate-limit rule for **POST `/api/enquiries`** after deployment; no global rule is assumed. Preview/custom domains work through same-origin requests without wildcard CORS. Test deployed proxy behavior because local emulation cannot prove Vercel routing/headers.

Calls to integrations remain bounded individually, but a platform timeout or network disconnect can still interrupt the overall request after a save. Browser retries retain their submission key. Review failed/stale integration states through trusted administration; no public list/retry endpoint is exposed.

## Deployment steps

1. Rotate the Zoho client secret and BotSpace API key that were found in the public example file during review. It has been cleared, but those values were exposed during inspection. Update private local/Vercel settings; obtain replacement refresh credentials as needed. Keep `self_client.json` private.
2. Create/configure the Atlas cluster, database, least-privilege database user and network access for deployment egress. Obtain a URI containing the desired database name. Do not use the local MongoDB address in Vercel.
3. From a trusted environment with the target Atlas URI configured privately, run `npm run db:setup` before accepting submissions. Confirm unique submission-key, phone and sync indexes. Configure backups/access/retention.
4. Verify the Zoho refresh token, data center, scopes, unique Mobile field, mandatory fields, picklist values and optional field API mappings. The last live OAuth diagnostic returned `invalid_code`; it has not been retested in this preparation task.
5. Verify BotSpace account/channel and credentials. Conversation creation and lookup were verified in the earlier approved local test; that does not verify Vercel's future environment. No automatic messages should be enabled.
6. Review `git status`, stage only intended project files, commit and push to your Git provider. The inspected repository currently has zero commits and no tracked files. `.env*` (except the clean example) and `self_client*.json` are ignored. No commit/push was made here.
7. Import the repository into Vercel and apply the project settings above. Configure all Production and isolated Preview variables.
8. Deploy and note the actual HTTPS domain. No domain is guessed or stored by this preparation.
9. Run the smoke checks below. Confirm the domain and application work before sending real traffic.
10. Configure the WAF limit. Complete verified webhook handling before configuring BotSpace as described below.

## Post-deployment smoke checks

- `GET /api/health`: 200, exactly `{"status":"ok"}`; no infrastructure data.
- `GET /api/nonexistent`: JSON 404, not React HTML. `GET /api` likewise stays in the API.
- Open a frontend deep link: React loads and its fallback route works. Verify static assets load.
- Submit a designated test enquiry through the deployed page: 201 and the success state. Inspect the new MongoDB enquiry privately.
- Verify the Zoho Lead was created/updated and its stored ID/status, separately from capture success.
- Verify BotSpace contact/conversation creation or reuse and stored mapping/status.
- In Preview, exercise a controlled integration failure: MongoDB capture must still yield success. Database failure must yield a controlled failure.
- Verify duplicate-key retries do not create duplicate enquiries, validation/consent/honeypot rejection works, and rate limiting is active.
- Confirm the `wa.me` destination against the clinic's actual international number; click tracking is not message-delivery proof.
- Confirm same-origin requests work and unrelated browser origins are rejected.

## BotSpace webhook after deployment

Final URL pattern:

```text
https://<deployed-domain>/api/webhooks/botspace
```

**Current blocker:** this route is an acknowledgement-only shell. It accepts JSON objects and returns `200` with `processed: false`, logging only minimal metadata; it does not authenticate provider events or update MongoDB/Zoho. No exact Incoming/Outgoing/Delivery envelope or verification contract has been supplied. Setting `BOTSPACE_WEBHOOK_SECRET` does not enable verification. Do not mistake receipt for working webhook integration.

After implementing and testing the real contracts, open BotSpace webhook settings, select **Royal Model**, and enter the final URL. If a temporary Cloudflare URL was configured separately, replace it; this project has not created or confirmed one. Enable **Incoming events**, **Outgoing events**, and **Delivery events**. Send a designated test message, verify receipt, authentication, replay/order handling, MongoDB state and configured Zoho metadata. Until that implementation is complete, webhook production readiness is outstanding even if the website is deployed successfully.

## Changes and final report

Inspected package/build config, Vercel config and API export, Express middleware/routes, provider config/services, Mongoose connection, frontend environment/fetch usage, SPA routes, ignore rules, example environment and Git state. Scanned credential-bearing files and source/build output without reporting credential values in scan results.

Modified `.env.example`, `.gitignore`, `vercel.json`, `server/config/db.js`, `server/config/zoho.js`, `server/services/zohoService.js`, `server/services/botspaceService.js`, `server/app.js`, README and workspace handoff. Created `.vercelignore`, `server/config/env.js`, `tests/deployment.test.mjs` and this guide. No packages or frontend files changed; private `.env` and credential export contents were preserved.

Routing change: add explicit `/api` rewrite; existing `/api/*` rewrite and non-API SPA fallback preserved. Mongo caching/pooling unchanged, with lazy URI validation and safe production configuration logging added. Zoho URL validation moved into existing provider config and is consumed through the central helper; exports remain compatible. BotSpace uses the central helper, which delegates to its established validator; live flow unchanged. `.env.example` now has empty credentials and safe .com URL defaults. `.gitignore` excludes credential exports and `.vercelignore` excludes environment files/exports from CLI uploads.

Required/optional variables, build settings, remaining manual Atlas/Zoho/Vercel work, and webhook URL/event steps are listed above. This is code/config preparation, not a completed deployment or verified Atlas connection.
