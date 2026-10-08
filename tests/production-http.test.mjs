import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

// Exercise the actual default Vercel export and real provider clients. Only the
// persistence boundary and outbound provider transport are replaced. No .env load.
test('production Vercel handler preserves the persistence success boundary', async t => {
  const settings = {
    NODE_ENV: 'production', VERCEL: '1', ALLOWED_ORIGIN: undefined,
    ZOHO_FLOW_WEBHOOK_URL: 'https://flow.zoho.com/123/flow/webhook/incoming?zapikey=flow-private-token',
    MONGODB_URI: undefined, ZOHO_CLIENT_ID: undefined,
    ZOHO_CLIENT_SECRET: undefined, ZOHO_REFRESH_TOKEN: undefined,
    ZOHO_ACCOUNTS_URL: undefined,
    ZOHO_API_BASE_URL: undefined, ZOHO_API_URL: undefined,
    ZOHO_LEADS_MODULE: 'Leads', BOTSPACE_API_KEY: 'test-key',
    BOTSPACE_CHANNEL_ID: 'test-channel', BOTSPACE_BASE_URL: 'https://public-api.bot.space',
  };
  const previous = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));
  function configure(values) {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
  configure(settings);
  t.after(() => configure(previous));
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args));
  t.mock.method(console, 'info', (...args) => logs.push(args));
  let scenario;
  let row;
  let calls;
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
  // Capture the fake in the default clients at module initialization. Use the
  // original fetch only for loopback requests to our HTTP server.
  const localFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async input => {
    const url = new URL(input);
    assert.ok(row, 'provider must never run before persistence');
    calls.push(url.pathname);
    if (url.hostname === 'flow.zoho.com') {
      if (scenario === 'ambiguous-ack') return new Response('');
      if (scenario === 'flow-timeout') throw new DOMException('flow-private-token', 'TimeoutError');
      if (scenario === 'zoho-network') throw new Error('provider-private-data');
      if (scenario === 'invalid-client') return json({ private: 'provider-private-data' }, 401);
      if (['zoho-fails', 'both-fail'].includes(scenario)) return json({ private: 'provider-private-data' }, 503);
      return json({ accepted: true });
    }
    assert.equal(url.hostname, 'public-api.bot.space', 'unexpected external request blocked');
    assert.doesNotMatch(url.pathname, /message/, 'form must never send messages');
    if (['botspace-fails', 'both-fail', 'status-write-fails'].includes(scenario)) return json({ private: 'provider-private-data' }, 503);
    if (scenario === 'botspace-network') throw new Error('provider-private-data');
    if (url.pathname === '/v1/contact') return json({ data: { contactId: 'contact-1' } });
    if (calls.filter(path => path === url.pathname).length === 1) return json({ message: 'Conversation Not Found' }, 404);
    return json({ data: { conversationId: 'conversation-1', fullPhoneNumber: row.phone } });
  });
  const { default: handler } = await import('../api/index.js');
  const { enquiryStore } = await import('../server/services/enquiryStore.js');
  assert.equal(typeof handler, 'function');
  t.mock.method(enquiryStore, 'save', async (value, submissionKey) => {
    if (scenario === 'save-fails') throw new Error('database-private-data');
    row = { ...value, submissionKey, createdAt: new Date(), _id: '0123456789abcdef01234567', zohoSyncStatus: 'pending', botspaceSyncStatus: 'pending' };
    return row;
  });
  for (const [method, field] of [['claim', 'zohoSyncStatus'], ['claimBotspace', 'botspaceSyncStatus']]) {
    t.mock.method(enquiryStore, method, async () => {
      if (scenario === 'claims-fail') throw new Error('database-private-data');
      row[field] = 'syncing';
      return { ...row };
    });
  }
  t.mock.method(enquiryStore, 'findBotspaceContact', async () => undefined);
  t.mock.method(enquiryStore, 'reserveBotspaceContact', async () => ({ acquired: true }));
  t.mock.method(enquiryStore, 'resolveBotspaceContact', async () => {});
  t.mock.method(enquiryStore, 'update', async (id, fields) => {
    assert.equal(id, row._id);
    if (scenario === 'status-write-fails') throw new Error('database-private-data');
    Object.assign(row, fields);
  });
  const server = createServer(handler).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const root = `http://127.0.0.1:${server.address().port}`;
  const payload = { fullName: 'Production Test', phone: '+12025550123', service: 'Other', consent: true };
  async function submit() {
    // Vercel proxy headers, same-origin HTTPS, valid idempotency and JSON.
    return localFetch(`${root}/api/enquiries`, { method: 'POST', headers: {
      'Content-Type': 'application/json', 'Idempotency-Key': randomUUID(),
      Origin: root.replace('http:', 'https:'), 'X-Forwarded-Proto': 'https',
      // Independent synthetic visitors avoid the real per-IP limiter in this matrix.
      'X-Forwarded-For': `192.0.2.${visitor++}`,
    }, body: JSON.stringify(payload) });
  }
  let visitor = 1;
  await t.test('health loads with no Mongo configuration', async () => {
    const response = await localFetch(`${root}/api/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok' });
  });
  for (const name of ['both-succeed', 'ambiguous-ack', 'zoho-fails', 'invalid-client', 'botspace-fails', 'both-fail', 'missing-providers', 'flow-timeout', 'zoho-network', 'botspace-network', 'claims-fail', 'status-write-fails']) {
    await t.test(`${name}: persisted enquiry still returns 201`, async () => {
      scenario = name; row = undefined; calls = []; configure(settings);
      if (name === 'missing-providers') {
        configure({ ZOHO_FLOW_WEBHOOK_URL: undefined, BOTSPACE_API_KEY: undefined, BOTSPACE_CHANNEL_ID: undefined });
      }
      const response = await submit();
      assert.equal(response.status, 201);
      assert.deepEqual(await response.json(), { success: true, enquiryId: row._id, message: 'Your enquiry has been received.' });
      assert.equal(row.fullName, payload.fullName);
      if (name === 'both-succeed') {
        assert.equal(row.zohoSyncStatus, 'synced');
        assert.equal(row.botspaceSyncStatus, 'synced');
        assert.equal(row.zohoLeadId, undefined);
      }
      if (name === 'ambiguous-ack') {
        assert.equal(row.zohoSyncStatus, 'needs_reconciliation');
        assert.equal(row.zohoFlowResponse.body, '[empty body]');
        assert.equal(row.botspaceSyncStatus, 'synced');
      }
      if (name === 'flow-timeout') {
        assert.match(row.zohoSyncError, /timed out/);
        assert.equal(row.zohoSyncStatus, ['missing-providers', 'invalid-client'].includes(name) ? 'failed' : 'needs_reconciliation');
        assert.equal(row.botspaceSyncStatus, 'synced');
      }
      if (name === 'botspace-fails') {
        assert.equal(row.zohoSyncStatus, 'synced');
        assert.equal(row.botspaceSyncStatus, 'failed');
      }
      if (name === 'zoho-fails' || name === 'invalid-client') {
        assert.equal(row.zohoSyncStatus, ['missing-providers', 'invalid-client'].includes(name) ? 'failed' : 'needs_reconciliation');
        assert.match(row.zohoSyncError, name === 'invalid-client' ? /HTTP 401/ : /HTTP 503/);
        assert.equal(row.botspaceSyncStatus, 'synced');
        assert.equal(row.botspaceConversationId, 'conversation-1');
      }
      if (name === 'missing-providers') {
        assert.equal(calls.length, 0);
        assert.equal(row.zohoSyncStatus, ['missing-providers', 'invalid-client'].includes(name) ? 'failed' : 'needs_reconciliation');
        assert.equal(row.botspaceSyncStatus, 'failed');
      }
      if (name === 'both-fail') {
        assert.equal(row.zohoSyncStatus, ['missing-providers', 'invalid-client'].includes(name) ? 'failed' : 'needs_reconciliation');
        assert.equal(row.botspaceSyncStatus, 'failed');
      }
      assert.doesNotMatch(JSON.stringify({ row, logs }), /provider-private-data|database-private-data|test-secret|test-refresh|test-key|flow-private-token|zapikey|https:\/\/flow/);
    });
  }
  await t.test('persistence failure returns safe 500 and never calls providers', async () => {
    scenario = 'save-fails'; row = undefined; calls = []; configure(settings);
    const response = await submit();
    assert.equal(response.status, 500);
    assert.equal((await response.json()).success, false);
    assert.equal(row, undefined);
    assert.equal(calls.length, 0);
  });
  await t.test('malformed ALLOWED_ORIGIN reproduces 500 before persistence, including health', async () => {
    scenario = 'origin-invalid'; row = undefined; calls = [];
    configure({ ALLOWED_ORIGIN: 'https://clinic.example/contact' });
    assert.equal((await submit()).status, 500);
    assert.equal((await localFetch(`${root}/api/health`)).status, 500);
    assert.equal(row, undefined);
    assert.equal(calls.length, 0);
    configure({ ALLOWED_ORIGIN: undefined });
    assert.equal((await localFetch(`${root}/api/health`)).status, 200);
  });
});
