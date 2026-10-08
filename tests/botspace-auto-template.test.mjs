import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { sendEnquiryTemplate } from '../server/services/botspaceAutoTemplate.js';
import { createApp } from '../server/app.js';

const settings = { NODE_ENV: 'production', VERCEL_ENV: 'production', BOTSPACE_AUTO_SEND: 'true', BOTSPACE_TEMPLATE_ID: 'approved-hi' };
const env = overrides => key => ({ ...settings, ...overrides })[key];
const logger = { error() {} };
function harness() {
  const row = { _id: '0123456789abcdef01234567', fullName: 'Test Person', phone: '+201012345678',
    service: 'Other', consent: true, botspaceTemplateStatus: 'pending', botspaceSyncStatus: 'synced' };
  let sends = 0;
  const store = {
    async claimBotspaceTemplate(id, templateId) {
      if (!row.consent || row.botspaceSyncStatus !== 'synced' || row.botspaceTemplateStatus !== 'pending') return null;
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
  assert.equal(await sendEnquiryTemplate(h.store, h.client, h.row._id, logger, env()), false);
});

test('disabled, development, preview and invalid template config make no claims or sends', async () => {
  for (const overrides of [{ BOTSPACE_AUTO_SEND: 'false' }, { NODE_ENV: 'development' }, { VERCEL_ENV: 'preview' },
    { BOTSPACE_TEMPLATE_ID: '' }, { BOTSPACE_TEMPLATE_VARIABLE_FIELDS: 'broken' }, { BOTSPACE_TEMPLATE_VARIABLE_FIELDS: '["message"]' }]) {
    const h = harness();
    assert.equal(await sendEnquiryTemplate(h.store, h.client, h.row._id, logger, env(overrides)), false);
    assert.equal(h.row.botspaceTemplateStatus, 'pending'); assert.equal(h.sends(), 0);
  }
});

test('no consent, unprepared contact, historical/ambiguous template states cannot send', async () => {
  for (const change of [{ consent: false }, { botspaceSyncStatus: 'failed' }, { botspaceTemplateStatus: undefined },
    { botspaceTemplateStatus: 'sending' }, { botspaceTemplateStatus: 'needs_reconciliation' }]) {
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

test('live form route awaits template after BotSpace preparation and preserves Zoho/capture on message failure', async t => {
  const before = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));
  Object.assign(process.env, settings);
  t.after(() => { for (const [key, value] of Object.entries(before)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const h = harness(); const order = [];
  h.row.botspaceSyncStatus = 'pending'; h.row.zohoSyncStatus = 'pending';
  Object.assign(h.store, {
    async save() { order.push('save'); return { ...h.row }; },
    async claim() { if (h.row.zohoSyncStatus !== 'pending') return null; h.row.zohoSyncStatus = 'syncing'; return { ...h.row }; },
    async claimBotspace() { if (h.row.botspaceSyncStatus !== 'pending') return null; h.row.botspaceSyncStatus = 'syncing'; return { ...h.row }; },
    async findBotspaceContact() { return 'contact'; },
  });
  Object.assign(h.client, {
    async updateContactProperties() {},
    async ensureConversation() { order.push('conversation'); return { id: 'conversation' }; },
    async sendTemplateMessage() { order.push('template'); throw new Error('timeout'); },
  });
  const app = createApp({ store: h.store, botspace: h.client, flow: { async sync() { order.push('flow'); } }, logger });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const submit = () => fetch(`http://127.0.0.1:${server.address().port}/api/enquiries`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': '00000000-0000-4000-8000-000000000000' },
    body: JSON.stringify({ fullName: h.row.fullName, phone: h.row.phone, service: 'Other', consent: true }) });
  assert.equal((await submit()).status, 201);
  assert.deepEqual(order, ['save', 'flow', 'conversation', 'template']);
  assert.equal(h.row.zohoSyncStatus, 'synced');
  assert.equal(h.row.botspaceSyncStatus, 'synced');
  assert.equal(h.row.botspaceTemplateStatus, 'needs_reconciliation');
  assert.equal((await submit()).status, 201);
  assert.equal(order.filter(value => value === 'template').length, 1);
});
