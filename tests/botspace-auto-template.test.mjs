import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { sendEnquiryTemplate } from '../server/services/botspaceAutoTemplate.js';
import { createApp } from '../server/app.js';
import { botspaceTemplateClaimFilter, enquiryStore } from '../server/services/enquiryStore.js';
import Enquiry from '../server/models/Enquiry.js';
import mongoose from 'mongoose';

const settings = { NODE_ENV: 'production', VERCEL_ENV: 'production', BOTSPACE_AUTO_SEND: 'true', BOTSPACE_TEMPLATE_ID: 'approved-hi', BOTSPACE_TEMPLATE_VARIABLE_FIELDS: '[]' };
const env = overrides => key => ({ ...settings, ...overrides })[key];
const logger = { error() {} };
function harness() {
  const row = { _id: '0123456789abcdef01234567', fullName: 'Test Person', phone: '+201012345678',
    service: 'Other', consent: true, botspaceTemplateStatus: 'pending', botspaceSyncStatus: 'synced',
    botspaceContactId: 'contact', botspaceConversationId: 'conversation', whatsappStarted: false, whatsappStatus: 'not_started' };
  let sends = 0;
  const store = {
    async claimBotspaceTemplate(id, templateId) {
      // Evaluate the production claim filter with Mongo's null/missing semantics.
      const matches = Object.entries(botspaceTemplateClaimFilter(id)).every(([key, condition]) => {
        if (typeof condition !== 'object' || condition === null) return row[key] === condition;
        if (condition.$in) return condition.$in.includes(row[key] ?? null);
        return typeof row[key] === condition.$type && row[key] !== condition.$ne;
      });
      if (!matches) return null;
      row.botspaceTemplateStatus = 'sending'; row.botspaceTemplateId = templateId;
      return { ...row };
    },
    async update(id, fields) { Object.assign(row, fields); },
  };
  const client = { async sendTemplateMessage(value, variables, templateId) {
    sends++; assert.equal(value.phone, row.phone); assert.deepEqual(variables, []); assert.equal(templateId, 'approved-hi');
    return { id: 'message', conversationId: 'conversation', status: 'SENT' };
  } };
  return { row, store, client, sends: () => sends };
}

test('production template is claimed once across concurrent calls; accepted is not delivered', async () => {
  const h = harness();
  const results = await Promise.all(Array.from({ length: 5 }, () => sendEnquiryTemplate(h.store, h.client, h.row._id, logger, env())));
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(h.sends(), 1);
  assert.equal(h.row.botspaceTemplateStatus, 'accepted');
  assert.equal(h.row.botspaceLastMessageStatus, 'SENT');
  assert.equal(h.row.botspaceLastMessageId, 'message');
  assert.equal(h.row.whatsappStarted, true);
  assert.equal(h.row.whatsappStatus, 'started');
  assert.equal(h.row.whatsappLastDirection, 'outbound');
  assert.equal(await sendEnquiryTemplate(h.store, h.client, h.row._id, logger, env()), false);
});

test('disabled, development, preview and invalid template config make no claims or sends', async () => {
  for (const overrides of [{ BOTSPACE_AUTO_SEND: 'false' }, { NODE_ENV: 'development' }, { VERCEL_ENV: 'preview' },
    { BOTSPACE_AUTO_SEND: undefined }, { BOTSPACE_AUTO_SEND: '1' },
    { BOTSPACE_TEMPLATE_ID: '' }, { BOTSPACE_TEMPLATE_VARIABLE_FIELDS: undefined },
    { BOTSPACE_TEMPLATE_VARIABLE_FIELDS: 'broken' }, { BOTSPACE_TEMPLATE_VARIABLE_FIELDS: '["message"]' }]) {
    const h = harness();
    assert.equal(await sendEnquiryTemplate(h.store, h.client, h.row._id, logger, env(overrides)), false);
    assert.equal(h.row.botspaceTemplateStatus, 'pending'); assert.equal(h.sends(), 0);
  }
});

test('no consent, unprepared contact, historical/ambiguous template states cannot send', async () => {
  for (const change of [{ consent: false }, { botspaceSyncStatus: 'failed' }, { botspaceTemplateStatus: undefined },
    { botspaceTemplateStatus: 'sending' }, { botspaceTemplateStatus: 'needs_reconciliation' },
    { botspaceContactId: undefined }, { botspaceConversationId: '' }, { botspaceLastMessageId: 'already-sent' },
    ...['sent', 'delivered', 'read', 'accepted', 'failed'].flatMap(status => [
      { botspaceTemplateStatus: status }, { botspaceLastMessageStatus: status }, { botspaceLastMessageStatus: status.toUpperCase() },
    ])]) {
    const h = harness(); Object.assign(h.row, change);
    assert.equal(await sendEnquiryTemplate(h.store, h.client, h.row._id, logger, env()), false);
    assert.equal(h.sends(), 0);
  }
});

test('timeout and status-write failures do not allow message retries; returned ID is preserved when possible', async () => {
  for (const stage of ['send', 'save']) {
    const h = harness(); let attempts = 0;
    if (stage === 'send') h.client.sendTemplateMessage = async () => { attempts++; throw new Error('secret-url'); };
    else {
      const update = h.store.update;
      h.store.update = async (id, fields) => { if (fields.botspaceTemplateStatus === 'accepted') throw new Error('database'); return update(id, fields); };
    }
    assert.equal(await sendEnquiryTemplate(h.store, h.client, h.row._id, logger, env()), false);
    assert.equal(h.row.botspaceTemplateStatus, 'needs_reconciliation');
    assert.doesNotMatch(h.row.botspaceTemplateError, /secret-url/);
    assert.equal(await sendEnquiryTemplate(h.store, h.client, h.row._id, logger, env()), false);
    if (stage === 'send') assert.equal(attempts, 1);
    else assert.equal(h.row.botspaceLastMessageId, 'message');
  }
});

for (const outcome of ['success', 'failure', 'already_synced']) test(`form route: ${outcome}, durable save and no duplicate on replay`, async t => {
  const before = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));
  Object.assign(process.env, settings);
  t.after(() => { for (const [key, value] of Object.entries(before)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const h = harness(); const order = [];
  h.row.botspaceSyncStatus = outcome === 'already_synced' ? 'synced' : 'pending'; h.row.zohoSyncStatus = 'pending';
  if (outcome === 'success') delete h.row.botspaceContactId;
  Object.assign(h.store, {
    async save() { order.push('save'); return { ...h.row }; },
    async claim() { if (h.row.zohoSyncStatus !== 'pending') return null; h.row.zohoSyncStatus = 'syncing'; return { ...h.row }; },
    async claimBotspace() { if (h.row.botspaceSyncStatus !== 'pending') return null; h.row.botspaceSyncStatus = 'syncing'; return { ...h.row }; },
    async findBotspaceContact() { return outcome === 'success' ? undefined : 'contact'; },
    async reserveBotspaceContact() { return { acquired: true }; },
    async resolveBotspaceContact() {},
  });
  Object.assign(h.client, {
    async updateContactProperties() {},
    async createContact() { order.push('contact'); return 'contact'; },
    async ensureConversation() { order.push('conversation'); return { id: 'conversation' }; },
    async sendTemplateMessage() {
      order.push('template');
      if (outcome === 'failure') throw new Error('timeout');
      return { id: 'message', conversationId: 'conversation', status: 'SENT' };
    },
  });
  const app = createApp({ store: h.store, botspace: h.client, flow: { async sync() { order.push('flow'); } }, logger });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const submit = () => fetch(`http://127.0.0.1:${server.address().port}/api/enquiries`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': '00000000-0000-4000-8000-000000000000' },
    body: JSON.stringify({ fullName: h.row.fullName, phone: h.row.phone, service: 'Other', consent: true }) });
  assert.equal((await submit()).status, 201);
  assert.deepEqual(order, outcome === 'already_synced' ? ['save', 'flow', 'template']
    : outcome === 'success' ? ['save', 'flow', 'contact', 'conversation', 'template'] : ['save', 'flow', 'conversation', 'template']);
  assert.equal(h.row.zohoSyncStatus, 'synced');
  assert.equal(h.row.botspaceSyncStatus, 'synced');
  assert.equal(h.row.botspaceTemplateStatus, outcome === 'failure' ? 'needs_reconciliation' : 'accepted');
  assert.equal(h.row.whatsappStarted, outcome !== 'failure');
  assert.equal((await submit()).status, 201);
  assert.equal(order.filter(value => value === 'template').length, 1);
});

test('auto-send parses string booleans and preserves explicitly configured slot order', async () => {
  const h = harness();
  h.client.sendTemplateMessage = async (row, variables) => {
    assert.deepEqual(variables, [row.fullName, row.fullName]);
    return { id: 'message', conversationId: 'conversation', status: 'SENT' };
  };
  assert.equal(await sendEnquiryTemplate(h.store, h.client, h.row._id, logger,
    env({ BOTSPACE_AUTO_SEND: ' TRUE ', BOTSPACE_TEMPLATE_VARIABLE_FIELDS: '["fullName","fullName"]' })), true);
});

test('provider-declared failure retains message identity and blocks retry', async () => {
  const h = harness(); let sends = 0;
  h.client.sendTemplateMessage = async () => {
    sends++;
    return { id: 'failed-message', conversationId: 'conversation', status: 'FAILED' };
  };
  assert.equal(await sendEnquiryTemplate(h.store, h.client, h.row._id, logger, env()), false);
  assert.equal(h.row.botspaceTemplateStatus, 'failed');
  assert.equal(h.row.botspaceLastMessageId, 'failed-message');
  assert.equal(h.row.botspaceLastMessageStatus, 'FAILED');
  assert.ok(h.row.botspaceTemplateError);
  assert.equal(h.row.whatsappStarted, false);
  assert.equal(await sendEnquiryTemplate(h.store, h.client, h.row._id, logger, env()), false);
  assert.equal(sends, 1);
});

test('production store atomically claims the enquiry with all duplicate guards before sending', async t => {
  const prior = mongoose.connection.readyState;
  mongoose.connection.readyState = 1;
  t.after(() => { mongoose.connection.readyState = prior; });
  let captured;
  t.mock.method(Enquiry, 'findOneAndUpdate', (filter, update, options) => {
    captured = { filter, update, options };
    return { lean: async () => null };
  });
  const id = harness().row._id;
  await enquiryStore.claimBotspaceTemplate(id, 'approved-hi');
  assert.deepEqual(captured.filter, {
    _id: id, consent: true, botspaceSyncStatus: 'synced', botspaceTemplateStatus: 'pending',
    botspaceContactId: { $type: 'string', $ne: '' }, botspaceConversationId: { $type: 'string', $ne: '' },
    botspaceLastMessageId: { $in: [null, ''] }, botspaceLastMessageStatus: { $in: [null, ''] },
  });
  assert.equal(captured.update.$set.botspaceTemplateStatus, 'sending');
  assert.equal(captured.update.$set.botspaceTemplateId, 'approved-hi');
  assert.ok(captured.update.$set.botspaceTemplateStartedAt instanceof Date);
  assert.equal(captured.options.returnDocument, 'after');
});
