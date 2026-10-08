import test from 'node:test';
import assert from 'node:assert/strict';
import { checkConversation, summarizeStoredError } from '../server/integrationDiagnostics.js';
import { validateEnquiry } from '../shared/enquiry.js';
import { createBotspaceClient, syncBotspaceEnquiry } from '../server/services/botspaceService.js';

const env = key => ({ BOTSPACE_API_KEY: 'secret', BOTSPACE_CHANNEL_ID: 'channel' })[key];

test('shared validation rejects unrecognized calling codes and impossible lengths before any provider operation', () => {
  for (const phone of ['+999123456789', '+12025550', '+4402079460018']) {
    assert.throws(() => validateEnquiry({ fullName: 'Test Person', phone, service: 'Other', consent: true }), /phone/);
  }
  assert.equal(validateEnquiry({ fullName: 'Test Person', phone: '00971 50 123 4567', service: 'Other', consent: true }).phone, '+971501234567');
});

test('live diagnostic is GET-only, validates identity and never outputs phone, URL, key or raw response', async () => {
  const phone = '+12025550123';
  let calls = 0;
  const result = await checkConversation({ phone, botspaceConversationId: 'conversation' }, env, async (url, init) => {
    calls++;
    assert.equal(init.method, 'GET');
    return Response.json({ data: { id: 'conversation', fullPhoneNumber: phone, private: 'secret' } });
  });
  assert.equal(calls, 1);
  assert.equal(result.storedIdMatches, true);
  assert.equal(result.attempts[0].status, 200);
  assert.doesNotMatch(JSON.stringify(result), /12025550123|secret|apiKey|https:/);
  const absent = await checkConversation({ phone }, env, async () => Response.json({ message: 'Conversation not found' }, { status: 404 }));
  assert.equal(absent.result, 'conversation_not_found');
  const failed = await checkConversation({ phone }, env, async () => { throw new Error('secret ' + phone); });
  assert.doesNotMatch(JSON.stringify(failed), /secret|12025550123/);
  assert.equal(failed.reason, 'provider_or_transport_failure');
});

test('stored diagnostics redact arbitrary provider messages and preserve only safe HTTP/reason metadata', () => {
  assert.deepEqual(summarizeStoredError('HTTP 500 secret customer@example.com'), { httpStatus: 500, operation: 'unknown', reason: 'other_redacted' });
  assert.deepEqual(summarizeStoredError('request was rejected secret'), { httpStatus: null, operation: 'unknown', reason: 'request_rejected' });
});

test('BotSpace persists rejection operation and status without raw provider body, retaining contact progress', async () => {
  const row = { _id: 'test', phone: '+12025550123', botspaceContactId: 'contact' };
  const client = createBotspaceClient(env, async () => new Response('secret customer@example.com', { status: 503 }));
  const store = { async claimBotspace() { return row; }, async update(id, fields) { Object.assign(row, fields); } };
  assert.equal(await syncBotspaceEnquiry(store, client, 'test', { error() {} }), false);
  assert.equal(row.botspaceContactId, 'contact');
  assert.deepEqual(row.botspaceSyncFailure, { operation: 'conversation lookup', status: 503, code: 'invalid_json' });
  assert.doesNotMatch(JSON.stringify(row.botspaceSyncFailure), /secret|customer/);
});
