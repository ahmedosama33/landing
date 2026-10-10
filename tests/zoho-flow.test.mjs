import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createZohoFlowClient, getZohoFlowConfig, mapFlowPayload, syncFlowEnquiry } from '../server/services/zohoFlowService.js';
import { enquiryStore } from '../server/services/enquiryStore.js';
import Enquiry from '../server/models/Enquiry.js';
import { createApp } from '../server/app.js';
import { validateEnquiry } from '../shared/enquiry.js';

const webhook = 'https://flow.zoho.com/123/flow/webhook/incoming?zapikey=private-token';
const env = name => name === 'ZOHO_FLOW_WEBHOOK_URL' ? webhook : undefined;
const key = '678d6127-4fa8-4651-8d99-577700fd24b7';
const input = { fullName: 'Flow Test', phone: '+12025550123', service: 'Other', consent: true };
const row = () => ({ ...validateEnquiry(input), _id: '0123456789abcdef01234567', submissionKey: key,
  createdAt: new Date('2026-10-08T10:00:00.000Z'), zohoSyncStatus: 'pending', botspaceSyncStatus: 'pending' });
const accepted = () => new Response('{"accepted":true}', { status: 200 });

test('Flow sends only the exact allowlisted JSON payload with bounded POST and no redirects', async () => {
  const saved = { ...row(), payloadHash: 'private-hash', zohoLeadId: '123', secret: 'private-token' };
  const expected = { enquiryId: saved._id, submissionKey: key, fullName: 'Flow Test', phone: '+12025550123',
    email: '', service: 'Other', message: '', consent: true, landingPage: '', referrer: '',
    utmSource: '', utmMedium: '', utmCampaign: '', utmContent: '', utmTerm: '',
    gclid: '', gbraid: '', wbraid: '', fbclid: '', fbp: '', fbc: '', createdAt: '2026-10-08T10:00:00.000Z' };
  assert.deepEqual(mapFlowPayload(saved), expected);
  const client = createZohoFlowClient(env, async (url, init) => {
    assert.equal(url, webhook);
    assert.equal(init.method, 'POST');
    assert.equal(init.headers['Content-Type'], 'application/json');
    assert.equal(init.redirect, 'error');
    assert.ok(init.signal instanceof AbortSignal);
    assert.deepEqual(JSON.parse(init.body), expected);
    return accepted();
  });
  assert.equal(await client.sync(saved), undefined, 'receipt is not a CRM ID');
});

test('missing or invalid configuration is lazy, sanitized, and makes no network call', async () => {
  for (const value of [undefined, '', 'private-token', 'http://flow.zoho.com/123',
    'https://evil.example/?zapikey=private-token', webhook + '#private-token',
    'https://user:private-token@flow.zoho.com/123/flow/webhook/incoming?zapikey=private-token']) {
    const client = createZohoFlowClient(() => value, () => assert.fail('no network'));
    await assert.rejects(client.sync(row()), error => {
      assert.match(error.message, /configuration/);
      assert.doesNotMatch(error.message, /private-token|https?:/);
      return true;
    });
  }
  assert.equal(getZohoFlowConfig(env).webhookUrl, webhook);
});

test('Flow classifies HTTP 4xx/5xx and rejects redirects, unexpected 2xx, and bad acknowledgements', async () => {
  for (const status of [200, 201, 202, 204, 302, 400, 401, 403, 429, 500, 503]) {
    const client = createZohoFlowClient(env, async () => new Response(status === 204 ? null : 'private-token customer body', { status }));
    await assert.rejects(client.sync(row()), error => {
      assert.match(error.message, status >= 200 && status < 300 ? /acknowledgement/ : new RegExp(`HTTP ${status}`));
      assert.doesNotMatch(error.message, /private-token|customer|zapikey|https:/);
      return true;
    });
  }
  await assert.rejects(createZohoFlowClient(env, async () => new Response('{"accepted":false}')).sync(row()), /acknowledgement/);
  await assert.rejects(createZohoFlowClient(env, async () => { throw new Error(webhook); }).sync(row()), /network failure/);
});

test('Flow timeout aborts transport and is safely classified', async t => {
  const controller = new AbortController();
  t.mock.method(AbortSignal, 'timeout', milliseconds => {
    assert.equal(milliseconds, 5000);
    return controller.signal;
  });
  const client = createZohoFlowClient(env, async (url, { signal }) => {
    const aborted = new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    controller.abort(new DOMException(webhook, 'TimeoutError'));
    return aborted;
  });
  await assert.rejects(client.sync(row()), error => error.code === 'timeout' && !error.message.includes('private-token'));
});

function harness(fetcher = accepted) {
  const saved = row();
  const logs = [];
  let sends = 0;
  const store = {
    async save() { return saved; },
    async claim(id, { retry = false } = {}) {
      if (saved.zohoSyncStatus !== 'pending' && !(retry && saved.zohoSyncStatus === 'failed')) return;
      saved.zohoSyncStatus = 'syncing';
      return { ...saved };
    },
    async claimBotspace() {
      if (saved.botspaceSyncStatus !== 'pending') return;
      saved.botspaceSyncStatus = 'syncing';
      return { ...saved };
    },
    async findBotspaceContact() { return 'contact-existing'; },
    async update(id, fields) { Object.assign(saved, fields); },
  };
  const flow = createZohoFlowClient(env, async (...args) => { sends++; return fetcher(...args); });
  return { saved, store, flow, logs, logger: { error(...args) { logs.push(args); } },
    botspace: { async ensureConversation() { return { id: 'conversation-existing' }; }, async updateContactProperties() { return { skipped: true }; } },
    get sends() { return sends; } };
}

test('concurrent deliveries, failed browser replay, and private retry preserve stable identity and legacy ID', async t => {
  const payloads = [];
  const h = harness(async (url, init) => {
    payloads.push(JSON.parse(init.body));
    if (payloads.length === 1) throw new Error(webhook);
    return accepted();
  });
  h.saved.zohoLeadId = 'legacy-id';
  const server = createApp(h).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const submit = () => fetch(`http://127.0.0.1:${server.address().port}/api/enquiries`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(input),
  });
  const responses = await Promise.all([submit(), submit(), submit()]);
  for (const response of responses) assert.equal(response.status, 201);
  assert.equal(h.sends, 1);
  assert.equal(h.saved.zohoSyncStatus, 'needs_reconciliation');
  assert.equal(h.saved.botspaceSyncStatus, 'synced');
  assert.equal(await syncFlowEnquiry(h.store, h.flow, h.saved._id, h.logger), false);
  assert.equal(await syncFlowEnquiry(h.store, h.flow, h.saved._id, h.logger, { retry: true }), false);
  assert.equal(h.sends, 1, 'uncertain delivery must not be retried');
  // Simulate a private operator reconciling history/CRM and authorizing redelivery.
  h.saved.zohoSyncStatus = 'pending';
  assert.equal(await syncFlowEnquiry(h.store, h.flow, h.saved._id, h.logger), true);
  assert.deepEqual(payloads[0], payloads[1]);
  assert.equal(h.saved.zohoLeadId, 'legacy-id');
  assert.equal(h.saved.zohoSyncError, null);
  await submit();
  assert.equal(h.sends, 2);
  assert.doesNotMatch(JSON.stringify(h.logs), /private-token|zapikey|https:|Flow Test/);
});

test('a status-write failure is recoverable and neither logs nor stored errors leak provider data', async () => {
  const h = harness();
  const update = h.store.update;
  h.store.update = async (id, fields) => {
    if (fields.zohoSyncStatus === 'synced') throw new Error(webhook);
    await update(id, fields);
  };
  assert.equal(await syncFlowEnquiry(h.store, h.flow, h.saved._id, h.logger), false);
  assert.equal(h.saved.zohoSyncStatus, 'needs_reconciliation');
  assert.doesNotMatch(JSON.stringify({ logs: h.logs, error: h.saved.zohoSyncError }), /private-token|zapikey|https:/);
});

test('Mongo claim query allows failed/stale delivery only for explicit retry', async t => {
  // Inspect the production query without a live database or connection.
  const queries = [];
  t.mock.method(Enquiry, 'findOneAndUpdate', query => { queries.push(query); return { lean: async () => null }; });
  // connectDB reuses an already-connected mongoose connection.
  const { default: mongoose } = await import('mongoose');
  const prior = mongoose.connection.readyState;
  mongoose.connection.readyState = 1;
  t.after(() => { mongoose.connection.readyState = prior; });
  await enquiryStore.claim(row()._id, { retry: false });
  await enquiryStore.claim(row()._id, { retry: true });
  assert.deepEqual(queries[0].$or, [{ zohoSyncStatus: { $in: ['pending'] } }]);
  assert.deepEqual(queries[1].$or[0].zohoSyncStatus.$in, ['pending', 'failed']);
  assert.equal(queries[1].$or[1].zohoSyncStatus, 'syncing');
});

test('all body-bearing 2xx statuses accept JSON whitespace/order regardless of response media type', async () => {
  for (const status of [200, 201, 202, 206, 299]) {
    for (const body of [' \n { "accepted" : true } \t', '{"ignored":"private-token","accepted":true}', '{"accepted":true,"ignored":"private-token"}']) {
      const diagnostics = [];
      await createZohoFlowClient(env, async () => new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })).sync(row(), value => diagnostics.push(value));
      assert.deepEqual(diagnostics, [{ status, contentType: 'text/plain', body: '{"accepted":true}' }]);
    }
  }
});

test('ambiguous responses persist safe diagnostics and cannot be retried', async () => {
  for (const body of ['', 'not JSON private-token person@example.com', '{}', '{"accepted":"true"}', '{"accepted":false}', 'null', '[{"accepted":true}]']) {
    const h = harness(() => new Response(body, { headers: { 'Content-Type': 'application/json; secret=private-token' } }));
    assert.equal(await syncFlowEnquiry(h.store, h.flow, h.saved._id, h.logger), false);
    assert.equal(h.saved.zohoSyncStatus, 'needs_reconciliation');
    assert.equal(h.saved.zohoFlowResponse.status, 200);
    assert.equal(h.saved.zohoFlowResponse.contentType, 'application/json');
    assert.ok(h.saved.zohoFlowResponse.body.length < 160);
    assert.equal(await syncFlowEnquiry(h.store, h.flow, h.saved._id, h.logger, { retry: true }), false);
    assert.equal(h.sends, 1);
    assert.doesNotMatch(JSON.stringify({ logs: h.logs, response: h.saved.zohoFlowResponse }), /private-token|person@example|zapikey/);
  }
});

test('non-2xx never acknowledges, even with accepted true; safe diagnostics retain actual status', async () => {
  for (const status of [302, 400, 429, 500, 503]) {
    const h = harness(() => new Response('{"accepted":true,"email":"person@example.com"}', { status, headers: { 'Content-Type': 'secret/private-token' } }));
    await syncFlowEnquiry(h.store, h.flow, h.saved._id, h.logger);
    assert.equal(h.saved.zohoSyncStatus, status >= 400 && status < 500 ? 'failed' : 'needs_reconciliation');
    assert.deepEqual(h.saved.zohoFlowResponse, { status, contentType: 'other/redacted', body: '{"accepted":true}' });
    assert.doesNotMatch(JSON.stringify(h.logs), /private-token|person@example/);
  }
});

test('response body timeout preserves received status; diagnostic logger failure does not undo receipt', async () => {
  const h = harness(() => ({ ok: true, status: 202, headers: new Headers({ 'Content-Type': 'application/json' }),
    async text() { throw new DOMException(webhook, 'TimeoutError'); } }));
  await syncFlowEnquiry(h.store, h.flow, h.saved._id, h.logger);
  assert.equal(h.saved.zohoSyncStatus, 'needs_reconciliation');
  assert.equal(h.saved.zohoFlowResponse.status, 202);
  assert.match(h.saved.zohoSyncError, /timed out/);
  assert.doesNotMatch(JSON.stringify(h.logs), /private-token|zapikey/);
  await createZohoFlowClient(env, accepted).sync(row(), () => { throw new Error('logger unavailable'); });
});

test('Mongoose supports reconciliation status and safe structured response without changing BotSpace state', async () => {
  const enquiry = new Enquiry({ ...row(), payloadHash: 'test-hash', zohoSyncStatus: 'needs_reconciliation',
    zohoFlowResponse: { status: 200, contentType: 'text/plain', body: '[empty body]' } });
  await enquiry.validate();
  assert.equal(enquiry.botspaceSyncStatus, 'pending');
});
