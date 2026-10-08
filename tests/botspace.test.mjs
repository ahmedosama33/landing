import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createBotspaceClient, syncBotspaceEnquiry, botspacePhoneParts, refreshBotspaceMessageStatus, sendBotspaceTemplate, sendBotspaceSession } from '../server/services/botspaceService.js';
import { readBotspaceConfig } from '../server/config/botspace.js';
import { createZohoClient } from '../server/services/zohoService.js';
import { createApp } from '../server/app.js';

const env = name => ({ BOTSPACE_API_KEY: 'private-key', BOTSPACE_CHANNEL_ID: '6ac529a17669b2ff0c3bd3d2', BOTSPACE_BASE_URL: 'https://public-api.bot.space' })[name];
const json = body => new Response(JSON.stringify(body));
const payload = { fullName: 'Test Person', phone: '+15555550123', service: 'Other', consent: true };
const logger = { error() {} };

test('documented contact request uses query apiKey and normalized phone, no clinical data', async () => {
  const client = createBotspaceClient(env, async (url, init) => {
    const parsed = new URL(url);
    assert.equal(parsed.pathname, '/v1/contact');
    assert.equal(parsed.searchParams.get('apiKey'), 'private-key');
    assert.equal(init.method, 'POST');
    assert.equal(init.redirect, 'error');
    assert.ok(init.signal);
    assert.deepEqual(JSON.parse(init.body), { name: 'Test Person', phone: '+15555550123' });
    return json({ data: { contactId: 'contact-123' } });
  });
  assert.equal(await client.createContact({ ...payload, phone: '001 (555) 555-0123', message: 'private notes' }), 'contact-123');
});

test('configuration is lazy and rejects missing secrets or unsafe base URLs', async () => {
  const client = createBotspaceClient(() => undefined, () => assert.fail('No network expected'));
  await assert.rejects(client.createContact(payload), /configuration is incomplete/);
  for (const base of ['https://example.com', 'https://public-api.bot.space:8443', 'http://example.com', 'https://user:secret@example.com', 'https://example.com/path', 'https://example.com/?key=secret']) {
    assert.throws(() => readBotspaceConfig(name => name === 'BOTSPACE_BASE_URL' ? base : env(name)), /invalid/);
  }
});

test('contact errors never expose URL, API key, or provider response', async () => {
  for (const fetcher of [
    async () => { throw new Error('https://example.com/?apiKey=private-key'); },
    async () => new Response('customer-private-key', { status: 500 }),
    async () => new Response('not json'),
    async () => json({ data: { id: 'wrong-contract' } }),
  ]) {
    await assert.rejects(createBotspaceClient(env, fetcher).createContact(payload), error => {
      assert.doesNotMatch(error.message, /private-key|customer|https:/);
      return true;
    });
  }
});

function harness({ fail = false, knownContact } = {}) {
  const row = { ...payload, _id: '0123456789abcdef01234567', botspaceSyncStatus: 'pending', zohoSyncStatus: 'pending' };
  const order = [];
  const store = {
    async save() { order.push('save'); return row; },
    async claim() { if (row.zohoSyncStatus === 'synced') return; return { ...row }; },
    async claimBotspace() {
      if (row.botspaceSyncStatus !== 'pending') return;
      row.botspaceSyncStatus = 'syncing';
      return { ...row };
    },
    async findBotspaceContact(phone) { assert.equal(phone, payload.phone); return knownContact; },
    async reserveBotspaceContact() { return { acquired: true }; },
    async resolveBotspaceContact() {},
    async update(id, fields) { assert.equal(id, row._id); Object.assign(row, fields); },
  };
  const zoho = { async sync() { order.push('zoho'); return '12345'; } };
  const botspace = { async createContact() { order.push('botspace'); if (fail) throw new Error('private-key'); return 'contact-123'; } };
  botspace.ensureConversation = async () => ({ id: 'conversation-123' });
  botspace.updateContactProperties = async () => ({ skipped: true });
  return { row, order, store, zoho, flow: zoho, botspace, logger };
}

async function api(t, deps) {
  const server = createApp(deps).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return (path, body, headers = {}) => fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
}

test('save then Zoho then BotSpace succeeds; duplicate requests do not repeat sync', async t => {
  const h = harness();
  const request = await api(t, h);
  assert.equal((await request('/api/enquiries', payload)).status, 201);
  assert.deepEqual(h.order, ['save', 'zoho', 'botspace']);
  assert.equal(h.row.botspaceContactId, 'contact-123');
  assert.equal(h.row.botspaceSyncStatus, 'synced');
  assert.equal(h.row.botspaceConversationId, 'conversation-123');
  await request('/api/enquiries', payload);
  assert.deepEqual(h.order, ['save', 'zoho', 'botspace', 'save']);
});

test('BotSpace unavailable after save still returns normal success with safe persisted error', async t => {
  const h = harness({ fail: true });
  const request = await api(t, h);
  const response = await request('/api/enquiries', payload);
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { success: true, enquiryId: h.row._id, message: 'Your enquiry has been received.' });
  assert.equal(h.row.botspaceSyncStatus, 'failed');
  assert.doesNotMatch(h.row.botspaceSyncError, /private-key/);
  await request('/api/enquiries', payload);
  assert.equal(h.order.filter(item => item === 'botspace').length, 1, 'ambiguous create must not automatically retry');
});

test('CRM failure does not prevent BotSpace preparation or saved-enquiry success', async t => {
  const h = harness();
  h.zoho.sync = async () => { throw new Error('outage'); };
  const response = await (await api(t, h))('/api/enquiries', payload);
  assert.equal(response.status, 201);
  assert.equal(h.row.zohoSyncStatus, 'needs_reconciliation');
  assert.equal(h.row.botspaceSyncStatus, 'synced');
});

test('reuse known phone mapping and keep atomic per-enquiry claim', async () => {
  const h = harness({ knownContact: 'existing-contact' });
  const results = await Promise.all([1, 2].map(() => syncBotspaceEnquiry(h.store, h.botspace, h.row._id, logger)));
  assert.deepEqual(results.sort(), [false, true]);
  assert.equal(h.row.botspaceContactId, 'existing-contact');
  assert.deepEqual(h.order, []);
});

test('status persistence failure retains contact ID when possible and cannot undo save', async t => {
  const h = harness();
  const update = h.store.update;
  h.store.update = async (id, fields) => {
    if (fields.botspaceSyncStatus === 'synced') throw new Error('database outage');
    return update(id, fields);
  };
  assert.equal((await (await api(t, h))('/api/enquiries', payload)).status, 201);
  assert.equal(h.row.botspaceContactId, 'contact-123');
  assert.equal(h.row.botspaceSyncStatus, 'failed');
});

test('BotSpace claim/storage outages cannot undo enquiry capture', async t => {
  const h = harness();
  h.store.claimBotspace = async () => { throw new Error('database private'); };
  assert.equal((await (await api(t, h))('/api/enquiries', payload)).status, 201);
  assert.deepEqual(h.order, ['save', 'zoho']);
});

test('disabled webhook rejects repeated unknown events without trusting guessed headers or writing data', async t => {
  // These are deliberately arbitrary bytes/objects, NOT claimed BotSpace fixtures.
  const request = await api(t, { store: {}, zoho: {}, logger });
  for (const body of [{}, { arbitrary: 'incoming' }, { arbitrary: 'outgoing' }, { arbitrary: 'delivery' }, { arbitrary: 'unknown' }]) {
    const response = await request('/api/webhooks/botspace', body, { 'X-Signature': 'invented', Authorization: 'Bearer invented' });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { success: false, processed: false, message: 'Webhook processing is not configured.' });
  }
  assert.equal((await request('/api/webhooks/botspace', { data: 'x'.repeat(21000) })).status, 413);
  assert.equal((await request('/api/webhooks/botspace', null)).status, 400);
  assert.equal((await request('/api/webhooks/botspace', [])).status, 400);
  assert.equal((await request('/api/webhooks/botspace', {}, { 'Content-Type': 'text/plain' })).status, 415);
});

test('country-code splitting preserves international identity and supports explicit Egyptian national input', () => {
  assert.deepEqual(botspacePhoneParts('00971 50 123 4567'), { countryCode: '971', phone: '501234567' });
  assert.deepEqual(botspacePhoneParts('+44 20 7946 0018'), { countryCode: '44', phone: '2079460018' });
  assert.deepEqual(botspacePhoneParts(payload.phone), { countryCode: '1', phone: '5555550123' });
  assert.deepEqual(botspacePhoneParts('+201270627474'), { countryCode: '20', phone: '1270627474' });
  assert.deepEqual(botspacePhoneParts('01012345678'), { countryCode: '20', phone: '1012345678' });
  assert.throws(() => botspacePhoneParts('05012'));
});

test('conversation found is reused using documented countryCode and phone query', async () => {
  let calls = 0;
  const client = createBotspaceClient(env, async (url, init) => {
    calls++;
    const parsed = new URL(url);
    assert.equal(parsed.pathname, `/v1/${env('BOTSPACE_CHANNEL_ID')}/conversation`);
    assert.equal(parsed.searchParams.get('countryCode'), '1');
    assert.equal(parsed.searchParams.get('phone'), '5555550123');
    assert.equal(parsed.searchParams.get('apiKey'), 'private-key');
    assert.equal(init.method, 'GET');
    return json({ data: { id: 'existing-conversation', fullPhoneNumber: payload.phone } });
  });
  assert.deepEqual(await client.ensureConversation(payload), { id: 'existing-conversation' });
  assert.equal(calls, 1);
  await client.ensureConversation({ ...payload, botspaceConversationId: 'already-mapped' });
  assert.equal(calls, 1);
});

test('trusted confirmed absence creates conversation with documented request/response', async () => {
  const client = createBotspaceClient(env, async (url, init) => {
    assert.ok(new URL(url).pathname.endsWith('/conversation'));
    assert.equal(init.method, 'POST');
    assert.deepEqual(JSON.parse(init.body), { name: payload.fullName, phone: payload.phone });
    return json({ data: { conversationId: 'created-conversation', fullPhoneNumber: payload.phone } });
  });
  assert.deepEqual(await client.ensureConversation(payload, { absenceConfirmed: true }), { id: 'created-conversation' });
});

test('ambiguous absence/errors/mismatched phone never trigger duplicate conversation creation', async () => {
  for (const response of [new Response('{}', { status: 404 }), json({ data: null }), json({ data: { id: 'wrong', fullPhoneNumber: '+15555550124' } })]) {
    let calls = 0;
    const client = createBotspaceClient(env, async () => { calls++; return response; });
    await assert.rejects(client.ensureConversation(payload));
    assert.equal(calls, 1);
  }
});

test('observed conversation-not-found 404 creates once and reuses conflict winner', async () => {
  for (const conflict of [false, true]) {
    const calls = [];
    const responses = [
      new Response(JSON.stringify({ statusCode: 404, error: 'Not Found', message: conflict ? 'Conversation not found' : 'Conversation Not Found' }), { status: 404 }),
      conflict ? new Response('{}', { status: 409 }) : json({ data: { conversationId: 'created', fullPhoneNumber: payload.phone } }),
      json({ data: { id: 'winner', fullPhoneNumber: payload.phone } }),
    ];
    const client = createBotspaceClient(env, async (url, init) => { calls.push(init.method); return responses.shift(); });
    assert.deepEqual(await client.ensureConversation(payload), { id: conflict ? 'winner' : 'created' });
    assert.deepEqual(calls, conflict ? ['GET', 'POST', 'GET'] : ['GET', 'POST']);
  }
});

test('BotSpace rejection reports operation/status and logs no URLs, keys or customer data', async t => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  t.after(() => { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; });
  const logs = [];
  const client = createBotspaceClient(env, async () => new Response(JSON.stringify({ message: 'private-key +12025550123 confidential' }), { status: 400 }), { info(...args) { logs.push(args); } });
  await assert.rejects(client.getConversationByPhone(payload.phone), error => {
    assert.equal(error.status, 400);
    assert.match(error.message, /conversation lookup failed: HTTP 400/);
    return true;
  });
  assert.match(JSON.stringify(logs), /conversation lookup/);
  assert.doesNotMatch(JSON.stringify(logs), /apiKey|private-key|12025550123|confidential|https:/);
});

test('both integrations fail after persistence and still return public-only 201 success', async t => {
  const h = harness({ fail: true });
  h.zoho.sync = async () => { throw new Error('private CRM failure'); };
  const response = await (await api(t, h))('/api/enquiries', payload);
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { success: true, enquiryId: h.row._id, message: 'Your enquiry has been received.' });
  assert.equal(h.row.zohoSyncStatus, 'needs_reconciliation');
  assert.equal(h.row.botspaceSyncStatus, 'failed');
});

test('contact conflict reconciles conversation without inventing missing contact ID', async () => {
  const h = harness();
  h.botspace.createContact = async () => { const e = new Error('duplicate'); e.status = 409; throw e; };
  assert.equal(await syncBotspaceEnquiry(h.store, h.botspace, h.row._id, logger), false);
  assert.equal(h.row.botspaceConversationId, 'conversation-123');
  assert.equal(h.row.botspaceSyncStatus, 'failed');
  assert.match(h.row.botspaceSyncError, /contact ID requires administrator mapping/);
});

test('conversation failure preserves contact ID and enquiry success with no key exposed', async t => {
  const h = harness();
  h.botspace.ensureConversation = async () => { throw new Error('private-key'); };
  const response = await (await api(t, h))('/api/enquiries', payload);
  assert.equal(response.status, 201);
  assert.doesNotMatch(await response.text(), /private-key|botspace/i);
  assert.equal(h.row.botspaceContactId, 'contact-123');
  assert.equal(h.row.botspaceSyncStatus, 'failed');
});

test('template helper skips missing template and sends configured template without clinical fields', async () => {
  assert.deepEqual(await createBotspaceClient(env, () => assert.fail()).sendTemplateMessage(payload), { skipped: true, reason: 'template_not_configured' });
  const client = createBotspaceClient(name => name === 'BOTSPACE_TEMPLATE_ID' ? 'approved-template' : env(name), async (url, init) => {
    assert.ok(new URL(url).pathname.endsWith('/message/send-message'));
    assert.deepEqual(JSON.parse(init.body), { name: payload.fullName, phone: payload.phone, templateId: 'approved-template', variables: ['Test Person'] });
    return json({ data: { id: 'message-1', conversationId: 'conversation-1', status: 'accepted' } });
  });
  assert.deepEqual(await client.sendTemplateMessage({ ...payload, message: 'private' }, ['Test Person']), { id: 'message-1', conversationId: 'conversation-1', status: 'accepted' });
});

test('session helper requires caller-confirmed session; no automatic session send', async () => {
  let calls = 0;
  const client = createBotspaceClient(env, async (url, init) => {
    calls++;
    assert.ok(new URL(url).pathname.endsWith('/message/send-session-message'));
    assert.deepEqual(JSON.parse(init.body), { name: payload.fullName, phone: payload.phone, text: 'Hello' });
    return json({ data: { id: 'message-2', conversationId: 'conversation-1', status: 'accepted' } });
  });
  await assert.rejects(client.sendSessionMessage(payload, 'Hello'), /confirmed WhatsApp session/);
  assert.equal(calls, 0);
  assert.equal((await client.sendSessionMessage(payload, 'Hello', { sessionConfirmed: true })).id, 'message-2');
});

test('delivery status keeps documented casing and persists against matching message ID', async () => {
  const client = createBotspaceClient(env, async url => {
    assert.ok(new URL(url).pathname.endsWith('/message/message-1/delivery-status'));
    return json({ data: { messageId: 'message-1', status: 'READ', failedReason: 'private-provider-data' } });
  });
  assert.deepEqual(await client.getMessageStatus('message-1'), { messageId: 'message-1', status: 'READ' });
  let written;
  await refreshBotspaceMessageStatus({ async updateBotspaceMessageStatus(...args) { written = args; return true; } }, client, { _id: 'enquiry-1', botspaceLastMessageId: 'message-1' });
  assert.deepEqual(written, ['enquiry-1', 'message-1', 'READ']);
  await assert.rejects(createBotspaceClient(env, async () => json({ data: { messageId: 'message-1', status: 'made-up' } })).getMessageStatus('message-1'));
});

test('message inspection returns metadata only and validates channel/message identity', async () => {
  const client = createBotspaceClient(env, async url => {
    assert.ok(new URL(url).pathname.endsWith('/message/message-1'));
    return json({ data: { _id: 'message-1', channelId: env('BOTSPACE_CHANNEL_ID'), createdOn: '2026-10-07T10:00:00Z', direction: 'outgoing', payload: 'sensitive' } });
  });
  assert.deepEqual(await client.getMessage('message-1'), { id: 'message-1', createdOn: '2026-10-07T10:00:00Z', direction: 'outgoing' });
});

test('explicit sends persist provider IDs/status and skip absent templates without writes', async () => {
  const result = { id: 'sent-message', conversationId: 'conversation', status: 'accepted' };
  const writes = [];
  const store = { async update(id, fields) { writes.push({ id, fields }); } };
  const row = { ...payload, _id: 'enquiry' };
  await sendBotspaceTemplate(store, { async sendTemplateMessage() { return { skipped: true }; } }, row);
  assert.equal(writes.length, 0);
  await sendBotspaceTemplate(store, { async sendTemplateMessage() { return result; } }, row);
  await sendBotspaceSession(store, { async sendSessionMessage(value, text, options) {
    assert.equal(options.sessionConfirmed, true);
    assert.equal(text, 'Hello');
    return result;
  } }, row, 'Hello', { sessionConfirmed: true });
  assert.deepEqual(writes, Array.from({ length: 2 }, () => ({ id: 'enquiry', fields: {
    botspaceLastMessageId: 'sent-message', botspaceLastMessageStatus: 'accepted', botspaceConversationId: 'conversation',
  } })));
});

test('WhatsApp CRM metadata only updates existing lead and explicitly configured fields', async () => {
  const calls = [];
  const settings = {
    ZOHO_CLIENT_ID: 'client', ZOHO_CLIENT_SECRET: 'secret', ZOHO_REFRESH_TOKEN: 'refresh',
    ZOHO_ACCOUNTS_URL: 'https://accounts.zoho.eu', ZOHO_API_BASE_URL: 'https://www.zohoapis.eu',
    ZOHO_FIELD_WHATSAPP_STATUS: 'Test_WhatsApp_Status',
  };
  const client = createZohoClient(name => settings[name], async (url, init) => {
    calls.push({ url, ...init });
    return calls.length === 1 ? json({ access_token: 'token' }) : json({ data: [{ status: 'success', details: { id: '12345' } }] });
  });
  assert.equal(await client.updateWhatsAppMetadata({ whatsappStatus: 'active' }), false);
  assert.equal(calls.length, 0);
  assert.equal(await client.updateWhatsAppMetadata({ zohoLeadId: '12345', whatsappStatus: 'active', botspaceContactId: 'unmapped' }), true);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].method, 'PUT');
  assert.ok(calls[1].url.endsWith('/Leads/12345'));
  assert.deepEqual(JSON.parse(calls[1].body), { data: [{ Test_WhatsApp_Status: 'active' }] });
});
