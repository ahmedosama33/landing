import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { validateEnquiry, normalizePhone, buildWhatsAppUrl } from '../shared/enquiry.js';
import { createApp } from '../server/app.js';
import productionApp from '../api/index.js';
import Enquiry from '../server/models/Enquiry.js';
import { ConflictError } from '../server/services/enquiryStore.js';
import { trackWhatsAppStarted } from '../src/lib/whatsapp.js';
import { createZohoClient, syncEnquiry, SyncError, normalizeZohoBaseUrl } from '../server/services/zohoService.js';

const payload = {
  fullName: ' Test Person ', phone: '00971 50 123 4567', email: 'TEST@example.com',
  service: 'Dermatology',
  consent: true, landingPage: 'https://clinic.example/contact?private=value#secret',
};
const key = '678d6127-4fa8-4651-8d99-577700fd24b7';
const logger = { error() {} };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
function harness(fail = false) {
  let row;
  let syncs = 0;
  const store = {
    async save(value) { row ??= { ...value, _id: '0123456789abcdef01234567', zohoSyncStatus: 'pending' }; return row; },
    async claim() { if (!['pending', 'failed'].includes(row.zohoSyncStatus)) return; row.zohoSyncStatus = 'syncing'; return { ...row }; },
    async update(id, fields) { Object.assign(row, fields); },
  };
  const zoho = { async sync() { syncs++; if (fail) throw new Error('secret-token and patient data'); return '12345'; } };
  return { store, zoho, flow: zoho, get row() { return row; }, get syncs() { return syncs; } };
}
async function withApi(t, deps) {
  const app = typeof deps === 'function' ? deps : createApp({ ...deps, logger });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const root = `http://127.0.0.1:${server.address().port}`;
  return (body = payload, options = {}) => fetch(`${root}${options.path || '/api/enquiries'}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify(body), ...options,
  });
}

test('validation normalizes and whitelists input, strips URL query/hash', () => {
  const row = validateEnquiry({ ...payload, zohoLeadId: 'untrusted', zohoSyncStatus: 'synced' });
  assert.equal(row.phone, '+971501234567');
  assert.equal(row.fullName, 'Test Person');
  assert.equal(row.email, 'test@example.com');
  assert.equal(row.landingPage, 'https://clinic.example/contact');
  assert.equal(row.zohoLeadId, undefined);
  assert.equal(normalizePhone('+971 (50) 123-4567'), row.phone);
  for (const phone of ['0501234567', '+971abc501234567', '+123', '+000123456789']) assert.throws(() => normalizePhone(phone));
  for (const bad of [{ consent: false }, { consent: 'true' }, { service: 'Invalid' }, { fullName: ' ' }, { email: 'bad' }, { message: 'x'.repeat(2001) }, { landingPage: 'javascript:alert(1)' }, { company_website: 'bot' }, { phone: { $gt: '' } }]) assert.throws(() => validateEnquiry({ ...payload, ...bad }));
});

test('Mongoose enforces consent, enums and timestamps, with unique submission index', async () => {
  const row = new Enquiry({ ...validateEnquiry(payload), submissionKey: key, payloadHash: 'hash' });
  await row.validate();
  row.consent = false;
  await assert.rejects(row.validate(), error => Boolean(error.errors.consent));
  row.service = 'Invalid';
  await assert.rejects(row.validate(), error => Boolean(error.errors.service));
  assert.ok(Enquiry.schema.indexes().some(([fields, options]) => fields.submissionKey && options.unique));
  assert.equal(Enquiry.schema.options.timestamps, true);
});

test('Express saves before CRM, persists status and repeated request does not resync', async t => {
  const h = harness();
  const request = await withApi(t, h);
  const response = await request();
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { success: true, enquiryId: h.row._id, message: 'Your enquiry has been received.' });
  assert.equal(h.row.zohoSyncStatus, 'synced');
  assert.equal(h.row.zohoLeadId, undefined, 'Flow receipt does not supply a CRM ID');
  assert.ok(h.row.zohoSyncedAt);
  await request();
  assert.equal(h.syncs, 1);
});

test('CRM failure returns 201, retains enquiry and sanitized status, allows retry', async t => {
  const h = harness(true);
  const request = await withApi(t, h);
  const response = await request();
  assert.equal(response.status, 201);
  assert.equal((await response.json()).zohoSynced, undefined);
  assert.equal(h.row.zohoSyncStatus, 'failed');
  assert.equal(h.row.zohoSyncError.includes('secret'), false);
  assert.equal(await syncEnquiry(h.store, { async sync() { return '12345'; } }, h.row._id, logger), true);
  assert.equal(h.row.zohoSyncStatus, 'synced');
});

test('DB save fails safely without CRM; failed sync claim cannot undo capture', async t => {
  const h = harness();
  h.store.save = async () => { throw new Error('mongodb://secret'); };
  const request = await withApi(t, h);
  const response = await request();
  assert.equal(response.status, 500);
  assert.doesNotMatch(await response.text(), /mongodb|secret/);
  assert.equal(h.syncs, 0);
  const h2 = harness();
  h2.store.claim = async () => { throw new Error('outage'); };
  assert.equal((await (await withApi(t, h2))()).status, 201);
});

test('honeypot, consent, method, origin, malformed JSON, size, content type and key', async t => {
  const h = harness();
  const request = await withApi(t, { ...h, rateLimitMax: 30 });
  assert.equal((await request({ ...payload, company_website: 'bot' })).status, 400);
  assert.equal((await request({ ...payload, consent: false })).status, 400);
  assert.equal(h.row, undefined);
  assert.equal((await request(payload, { method: 'GET', body: undefined })).status, 405);
  assert.equal((await request(payload, { method: 'OPTIONS', body: undefined })).status, 204);
  assert.equal((await request(payload, { headers: { origin: 'https://other.example' } })).status, 403);
  assert.equal((await request(payload, { headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await request(payload, { body: '{' })).status, 400);
  assert.equal((await request({ message: 'x'.repeat(21000) })).status, 413);
  assert.equal((await request(payload, { headers: { 'content-type': 'application/json', 'idempotency-key': 'bad' } })).status, 400);
  assert.equal(h.syncs, 0);
});

test('rate limit rejects repeated requests and includes security headers', async t => {
  const request = await withApi(t, { ...harness(), rateLimitMax: 1 });
  await request();
  const response = await request();
  assert.equal(response.status, 429);
  assert.ok(response.headers.get('retry-after'));
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
});

test('key reuse with changed payload returns conflict without CRM', async t => {
  const h = harness();
  h.store.save = async () => { throw new ConflictError(); };
  assert.equal((await (await withApi(t, h))()).status, 409);
  assert.equal(h.syncs, 0);
});

test('serverless export handles health and API 404', async t => {
  const request = await withApi(t, productionApp);
  assert.deepEqual(await (await request(null, { method: 'GET', body: undefined, path: '/api/health' })).json(), { status: 'ok' });
  assert.equal((await request(null, { path: '/api/missing' })).status, 404);
});

test('WhatsApp includes only approved fields and requires configured number', () => {
  const url = new URL(buildWhatsAppUrl('15555550123', { ...payload, fullName: 'A & B', message: 'private', enquiryId: 'db-id' }));
  assert.equal(url.origin, 'https://wa.me');
  assert.equal(url.pathname, '/15555550123');
  assert.match(url.searchParams.get('text'), /Name: A & B/);
  assert.ok(url.searchParams.get('text').includes(`Email: ${payload.email}`));
  assert.ok(url.searchParams.get('text').includes(`Phone: ${payload.phone}`));
  assert.ok(url.searchParams.get('text').includes(`Service: ${payload.service}`));
  assert.doesNotMatch(url.searchParams.get('text'), /private|db-id/);
  assert.equal(buildWhatsAppUrl('', payload), null);
  assert.equal(buildWhatsAppUrl('15555550123', null), null);
});

test('WhatsApp tracking requires the matching submission key and ignores body updates', async t => {
  const id = '0123456789abcdef01234567';
  const state = { whatsappStarted: false, fullName: 'Original' };
  const store = { async markWhatsAppStarted(recordId, submissionKey) {
    if (recordId !== id || submissionKey !== key) return false;
    state.whatsappStarted = true;
    return true;
  } };
  const request = await withApi(t, { store });
  const path = `/api/enquiries/${id}/whatsapp-started`;
  assert.equal((await request({}, { path, headers: {} })).status, 403);
  assert.equal((await request({}, { path, headers: { 'Idempotency-Key': '11111111-1111-4111-8111-111111111111' } })).status, 404);
  assert.equal((await request({}, { path: '/api/enquiries/invalid/whatsapp-started' })).status, 400);
  assert.equal(state.whatsappStarted, false);
  assert.equal((await request({ fullName: 'Attacker', whatsappStarted: false }, { path })).status, 200);
  assert.deepEqual(state, { whatsappStarted: true, fullName: 'Original' });
  assert.equal((await request({}, { path })).status, 200);
  assert.equal((await request(null, { path, method: 'PATCH' })).status, 405);
});

test('WhatsApp tracking database errors return a sanitized response', async t => {
  const request = await withApi(t, { store: { async markWhatsAppStarted() { throw new Error('database secret'); } } });
  const response = await request({}, { path: '/api/enquiries/0123456789abcdef01234567/whatsapp-started' });
  assert.equal(response.status, 500);
  assert.doesNotMatch(await response.text(), /database secret/);
});

test('WhatsApp click tracking returns immediately and absorbs network failures', async () => {
  const enquiry = { enquiryId: '0123456789abcdef01234567', key };
  let call;
  assert.equal(trackWhatsAppStarted(enquiry, (url, options) => {
    call = { url, options };
    return new Promise(() => {});
  }), undefined);
  assert.equal(call.url, `/api/enquiries/${enquiry.enquiryId}/whatsapp-started`);
  assert.equal(call.options.headers['Idempotency-Key'], key);
  assert.equal(call.options.keepalive, true);
  assert.equal(call.options.body, undefined);
  assert.doesNotThrow(() => trackWhatsAppStarted(enquiry, () => { throw new Error('offline'); }));
  trackWhatsAppStarted(enquiry, () => Promise.reject(new Error('offline')));
  await new Promise(resolve => setImmediate(resolve));
});

function zohoHarness(responses) {
  const calls = [];
  const env = name => ({ ZOHO_CLIENT_ID: 'client', ZOHO_CLIENT_SECRET: 'secret', ZOHO_REFRESH_TOKEN: 'refresh', ZOHO_ACCOUNTS_URL: 'https://accounts.zoho.eu', ZOHO_API_BASE_URL: 'https://www.zohoapis.eu' })[name];
  return { calls, client: createZohoClient(env, async (url, init) => {
    calls.push({ url, ...init });
    assert.ok(responses.length, 'Unexpected HTTP request');
    return responses.shift();
  }) };
}
const token = () => json({ access_token: 'private-access-token', expires_in: 3600 });
const success = () => json({ data: [{ status: 'success', details: { id: '12345' } }] });

test('phone match updates lead without resetting status or blanking email', async () => {
  const h = zohoHarness([token(), json({ data: [{ id: '12345', Phone: '971501234567' }] }), success()]);
  assert.equal(await h.client.sync({ ...validateEnquiry(payload), email: '' }), '12345');
  assert.equal(h.calls[2].method, 'PUT');
  const data = JSON.parse(h.calls[2].body).data[0];
  assert.equal(data.Last_Name, 'Test Person');
  assert.equal(data.Lead_Status, undefined);
  assert.equal(data.Email, undefined);
});

test('email fallback updates existing lead', async () => {
  const h = zohoHarness([token(), new Response(null, { status: 204 }), json({ data: [{ id: '12345', Email: 'TEST@example.com' }] }), success()]);
  await h.client.sync(validateEnquiry(payload));
  assert.ok(h.calls[2].url.includes('search?email='));
  assert.equal(h.calls[3].method, 'PUT');
});

test('no match uses unique mobile/email upsert and unconfigured fields in Description', async () => {
  const h = zohoHarness([token(), new Response(null, { status: 204 }), new Response(null, { status: 204 }), success()]);
  await h.client.sync({ ...validateEnquiry(payload), utmContent: 'banner' });
  assert.ok(h.calls[3].url.endsWith('/Leads/upsert'));
  const body = JSON.parse(h.calls[3].body);
  assert.deepEqual(body.duplicate_check_fields, ['Mobile', 'Email']);
  assert.match(body.data[0].Description, /Service: Dermatology/);
  assert.match(body.data[0].Description, /utmContent: banner/);
  assert.equal(body.data[0].Lead_Source, 'Website');
  assert.equal(body.data[0].Lead_Status, undefined);
});

test('cached token and stored lead ID avoid repeated OAuth and searches', async () => {
  const h = zohoHarness([token(), success(), success()]);
  const row = { ...validateEnquiry(payload), zohoLeadId: '12345' };
  await h.client.sync(row);
  await h.client.sync(row);
  assert.equal(h.calls.length, 3);
  assert.equal(h.calls[1].method, 'PUT');
});

test('OAuth and record errors sanitized; ambiguous matches not written', async () => {
  const auth = zohoHarness([json({ error: 'invalid_client', secret: 'private' })]);
  await assert.rejects(auth.client.sync(validateEnquiry(payload)), SyncError);
  const write = zohoHarness([token(), json({ data: [{ status: 'error', code: 'INVALID_DATA', message: 'patient data' }] })]);
  await assert.rejects(write.client.sync({ ...validateEnquiry(payload), zohoLeadId: '12345' }), error => error.message === 'Zoho lead-update failed: HTTP 200 (INVALID_DATA).');
  const ambiguous = zohoHarness([token(), json({ data: [], info: { more_records: true } })]);
  await assert.rejects(ambiguous.client.sync(validateEnquiry(payload)), /ambiguous/);
});

test('CRM ID preserved if final status write fails', async () => {
  const h = harness();
  await h.store.save(validateEnquiry(payload));
  const update = h.store.update;
  h.store.update = async (id, fields) => { if (fields.zohoSyncStatus === 'synced') throw new Error('outage'); await update(id, fields); };
  assert.equal(await syncEnquiry(h.store, h.zoho, h.row._id, logger), false);
  assert.equal(h.row.zohoSyncStatus, 'failed');
  assert.equal(h.row.zohoLeadId, '12345');
});

test('honeypot rejection has a safe diagnostic code; empty field permits normal validation', () => {
  assert.throws(() => validateEnquiry({ ...payload, company_website: 'private-autofilled-value' }), error => {
    assert.equal(error.code, 'honeypot_filled');
    assert.equal(error.message, 'Unable to accept this enquiry.');
    assert.doesNotMatch(error.message, /private-autofilled-value/);
    return true;
  });
  assert.equal(validateEnquiry({ ...payload, company_website: '' }).fullName, 'Test Person');
});

test('Zoho accepts .com origins with optional trailing slash and rejects invalid hosts/config safely', () => {
  for (const [name, base] of [['ZOHO_ACCOUNTS_URL', 'https://accounts.zoho.com'], ['ZOHO_API_BASE_URL', 'https://www.zohoapis.com']]) {
    assert.equal(normalizeZohoBaseUrl(name, base), base);
    assert.equal(normalizeZohoBaseUrl(name, `${base}/`), base);
    assert.throws(() => normalizeZohoBaseUrl(name, undefined), /incomplete/);
    for (const url of ['https://crm.zoho.com/crm/org123', 'https://attacker.example', `${base}/crm/v8`, `${base}?secret=value`, 'http://accounts.zoho.com']) {
      assert.throws(() => normalizeZohoBaseUrl(name, url), error => {
        assert.match(error.message, /invalid/);
        assert.doesNotMatch(error.message, /org123|attacker|secret=value/);
        return true;
      });
    }
  }
});

test('Zoho .com OAuth and CRM endpoints are formed once and missing credentials stop network', async () => {
  const settings = { ZOHO_ACCOUNTS_URL: 'https://accounts.zoho.com/', ZOHO_API_BASE_URL: 'https://www.zohoapis.com/', ZOHO_CLIENT_ID: 'client', ZOHO_CLIENT_SECRET: 'secret', ZOHO_REFRESH_TOKEN: 'refresh' };
  const calls = [];
  const responses = [token(), success()];
  const client = createZohoClient(name => settings[name], async (url, init) => { calls.push({ url, ...init }); return responses.shift(); });
  await client.sync({ ...validateEnquiry(payload), zohoLeadId: '12345' });
  assert.equal(calls[0].url, 'https://accounts.zoho.com/oauth/v2/token');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].body.get('grant_type'), 'refresh_token');
  assert.equal(calls[1].url, 'https://www.zohoapis.com/crm/v8/Leads/12345');
  assert.match(calls[1].headers.Authorization, /^Zoho-oauthtoken /);
  for (const missing of Object.keys(settings)) {
    await assert.rejects(createZohoClient(name => name === missing ? undefined : settings[name], () => assert.fail('No network')).getZohoAccessToken(), /incomplete/);
  }
});

test('Zoho invalid_code is reported safely without token or response content', async () => {
  const h = zohoHarness([json({ error: 'invalid_code', private: 'refresh-secret' })]);
  await assert.rejects(h.client.getZohoAccessToken(), error => {
    assert.match(error.message, /invalid_code/);
    assert.doesNotMatch(error.message, /refresh-secret/);
    return true;
  });
});

test('development logs identify honeypot before save without customer data; production omits diagnostics', async t => {
  const previous = process.env.NODE_ENV;
  t.after(() => { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; });
  for (const mode of ['development', 'production']) {
    process.env.NODE_ENV = mode;
    const entries = [];
    const h = harness();
    const app = createApp({ ...h, logger: { error() {}, info(...args) { entries.push(args); } } });
    const request = await withApi(t, app);
    const response = await request({ ...payload, company_website: 'private-autofilled-value' });
    assert.equal(response.status, 400);
    assert.equal(h.row, undefined);
    const logs = JSON.stringify(entries);
    assert.doesNotMatch(logs, /private-autofilled-value|TEST@example.com|971/);
    if (mode === 'development') assert.match(logs, /honeypot_filled/);
    else assert.equal(entries.length, 0);
  }
});

test('refresh exchange sends all credentials as form data and only access token authorizes CRM', async () => {
  const h = zohoHarness([token(), success()]);
  await h.client.sync({ ...validateEnquiry(payload), zohoLeadId: '12345' });
  assert.equal(h.calls[0].headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.deepEqual(Object.fromEntries(h.calls[0].body), {
    grant_type: 'refresh_token', client_id: 'client', client_secret: 'secret', refresh_token: 'refresh',
  });
  assert.equal(h.calls[1].headers.Authorization, 'Zoho-oauthtoken private-access-token');
});

test('validated OAuth api_domain takes precedence and untrusted domains never receive tokens', async () => {
  const h = zohoHarness([json({ access_token: 'private-access-token', api_domain: 'https://www.zohoapis.com/' }), success()]);
  await h.client.sync({ ...validateEnquiry(payload), zohoLeadId: '12345' });
  assert.equal(h.calls[1].url, 'https://www.zohoapis.com/crm/v8/Leads/12345');
  for (const domain of ['https://attacker.example', 'http://www.zohoapis.com', 'https://www.zohoapis.com/crm/v8']) {
    const invalid = zohoHarness([json({ access_token: 'private-access-token', api_domain: domain })]);
    await assert.rejects(invalid.client.getZohoAccessToken(), /Zoho API base URL invalid/);
    assert.equal(invalid.calls.length, 1);
  }
});

test('missing access token fails safely and concurrent refreshes share one request', async () => {
  const missing = zohoHarness([json({ private: 'secret-response' })]);
  await assert.rejects(missing.client.getZohoAccessToken(), /no access token returned/);
  const h = zohoHarness([token()]);
  assert.deepEqual(await Promise.all([h.client.getZohoAccessToken(), h.client.getZohoAccessToken()]), ['private-access-token', 'private-access-token']);
  assert.equal(h.calls.length, 1);
});

test('CRM read helper sends minimal query and search/create errors identify stage without PII', async () => {
  const read = zohoHarness([token(), new Response(null, { status: 204 })]);
  await read.client.checkConnection();
  assert.equal(read.calls[1].url, 'https://www.zohoapis.eu/crm/v8/Leads?fields=id&per_page=1');
  const search = zohoHarness([token(), json({ code: 'NO_PERMISSION', message: 'private-person' }, 403)]);
  await assert.rejects(search.client.sync(validateEnquiry(payload)), /Zoho lead-search failed: HTTP 403 \(NO_PERMISSION\)/);
  const create = zohoHarness([token(), new Response(null, { status: 204 }), new Response(null, { status: 204 }), json({ data: [{ status: 'error', code: 'INVALID_DATA', message: 'private-person' }] })]);
  await assert.rejects(create.client.sync(validateEnquiry(payload)), /Zoho lead-create failed: HTTP 200 \(INVALID_DATA\)/);
});
