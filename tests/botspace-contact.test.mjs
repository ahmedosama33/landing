import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone } from '../shared/enquiry.js';
import { createBotspaceClient, syncBotspaceEnquiry } from '../server/services/botspaceService.js';
import { createContactRegistry } from '../server/services/botspaceContactRegistry.js';
import { diagnoseContactCreation } from '../server/services/botspaceContactDiagnostic.js';

const phone = '+201012345678';
const env = name => ({ BOTSPACE_API_KEY: 'private-key', BOTSPACE_CHANNEL_ID: 'channel',
  BOTSPACE_PROPERTY_SERVICE: 'configured_service', BOTSPACE_PROPERTY_ENQUIRY: 'configured_enquiry',
  BOTSPACE_PROPERTY_EMAIL: 'configured_email', BOTSPACE_PROPERTY_FULL_NAME: 'configured_name' })[name];
const row = { fullName: 'Test Person', phone, email: 'test@example.com', service: 'Other', message: 'Test enquiry' };

function registryHarness() {
  const rows = new Map();
  const collection = {
    async insertOne(doc) { if (rows.has(doc._id)) throw Object.assign(new Error('duplicate'), { code: 11000 }); rows.set(doc._id, { ...doc }); },
    async findOne({ _id }) { return rows.get(_id); },
    async updateOne(filter, update) {
      const existing = rows.get(filter._id);
      if (!existing || existing.contactId && existing.contactId !== update.$set.contactId) return { matchedCount: 0 };
      Object.assign(existing, update.$set); return { matchedCount: 1 };
    },
  };
  return createContactRegistry(collection);
}

test('Egyptian mobile/local/landline and Arabic numerals normalize while international identities remain intact', () => {
  for (const input of ['01012345678', '201012345678', '00201012345678', '+20 10 1234 5678', '٠١٠١٢٣٤٥٦٧٨', '۰۱۰۱۲۳۴۵۶۷۸']) {
    assert.equal(normalizePhone(input), phone);
  }
  assert.equal(normalizePhone('02 2345 6789'), '+20223456789');
  assert.equal(normalizePhone('+971501234567'), '+971501234567');
  for (const invalid of ['015123', '1012345678', '+2001012345678']) assert.throws(() => normalizePhone(invalid));
});

test('contact create and property update use only documented envelopes and configured property keys', async () => {
  const client = createBotspaceClient(env, async (url, init) => {
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get('apiKey'), 'private-key');
    const body = JSON.parse(init.body);
    assert.deepEqual(body.contactProperties, { configured_name: row.fullName, configured_email: row.email,
      configured_service: row.service, configured_enquiry: row.message });
    if (init.method === 'POST') {
      assert.equal(parsed.pathname, '/v1/contact');
      assert.deepEqual(Object.keys(body).sort(), ['contactProperties', 'email', 'name', 'phone']);
      return Response.json({ data: { contactId: 'contact' } });
    }
    assert.equal(init.method, 'PATCH');
    assert.equal(parsed.pathname, '/v1/contact/properties');
    assert.deepEqual(Object.keys(body).sort(), ['contactId', 'contactProperties']);
    assert.equal(body.contactId, 'contact');
    return Response.json({ data: { success: true } });
  });
  assert.equal(await client.createContact(row), 'contact');
  assert.deepEqual(await client.updateContactProperties('contact', row), { updated: true });
  const unconfigured = createBotspaceClient(() => undefined, () => assert.fail('No network'));
  assert.equal((await unconfigured.updateContactProperties('contact', row)).skipped, true);
  await assert.rejects(createBotspaceClient(env, async () => Response.json({ data: { success: false } })).updateContactProperties('contact', row), /not confirmed/);
});

test('phone reservation allows one creator across submissions and retains ambiguous attempts indefinitely', async () => {
  const registry = registryHarness();
  const outcomes = await Promise.all(Array.from({ length: 10 }, () => registry.reserve(phone)));
  assert.equal(outcomes.filter(result => result.acquired).length, 1);
  assert.equal((await registry.reserve('01012345678')).acquired, false);
  await registry.resolve(phone, 'contact');
  assert.deepEqual(await registry.reserve(phone), { acquired: false, contactId: 'contact' });
  await assert.rejects(registry.resolve(phone, 'different'), /conflicts/);
});

test('diagnostic requires both permissions, blocks known conversations and never retries ambiguous create', async () => {
  const blocked = new Proxy({}, { get() { assert.fail('No access without both permissions'); } });
  for (const args of [{}, { allowCreate: true }, { absenceConfirmed: true }]) {
    assert.equal((await diagnoseContactCreation({ phone, ...args }, blocked, blocked)).mode, 'DRY_RUN');
  }
  const registry = registryHarness();
  const store = { findBotspaceContact: value => registry.find(value), reserveBotspaceContact: value => registry.reserve(value),
    resolveBotspaceContact: (value, id) => registry.resolve(value, id) };
  const args = { phone, allowCreate: true, absenceConfirmed: true };
  let creates = 0;
  const client = { async getConversationByPhone() { return { id: 'conversation' }; }, async createContact() { creates++; throw new Error('private'); } };
  assert.match((await diagnoseContactCreation(args, store, client)).result, /existing_conversation/);
  assert.equal(creates, 0);
  client.getConversationByPhone = async () => null;
  assert.equal((await diagnoseContactCreation(args, store, client)).created, 'unknown');
  assert.match((await diagnoseContactCreation(args, store, client)).result, /prior_attempt/);
  assert.equal(creates, 1);
});

test('diagnostic confirms creation only after provider ID, saves mapping and never creates a conversation', async () => {
  const registry = registryHarness();
  const store = { findBotspaceContact: value => registry.find(value), reserveBotspaceContact: value => registry.reserve(value),
    resolveBotspaceContact: (value, id) => registry.resolve(value, id) };
  const client = { async getConversationByPhone() { return null; }, async createContact() { return 'contact'; } };
  const result = await diagnoseContactCreation({ phone, allowCreate: true, absenceConfirmed: true }, store, client);
  assert.equal(result.contactExists, 'creation_confirmed_by_provider');
  assert.equal(await registry.find(phone), 'contact');
  assert.equal(result.messagesSent, false);
});

test('existing contact is updated without create; pending reservation blocks another submission', async () => {
  const saved = { ...row, _id: 'enquiry' };
  const store = { async claimBotspace() { return { ...saved }; }, async findBotspaceContact() { return 'contact'; },
    async update(id, fields) { Object.assign(saved, fields); } };
  let updates = 0;
  const client = { async createContact() { assert.fail('No create'); }, async updateContactProperties(id, value) {
    updates++; assert.equal(id, 'contact'); assert.equal(value.message, row.message);
  }, async ensureConversation() { return { id: 'conversation' }; } };
  assert.equal(await syncBotspaceEnquiry(store, client, saved._id), true);
  assert.equal(updates, 1);
  delete saved.botspaceContactId;
  store.findBotspaceContact = async () => undefined;
  store.reserveBotspaceContact = async () => ({ acquired: false });
  assert.equal(await syncBotspaceEnquiry(store, client, saved._id, { error() {} }), false);
  assert.match(saved.botspaceSyncError, /reconcile before retry/);
});
