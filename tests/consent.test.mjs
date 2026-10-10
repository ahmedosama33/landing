import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { once } from 'node:events';
import { createAttribution, attributionForSubmission, ATTRIBUTION_STORAGE_KEY, ATTRIBUTION_TTL } from '../src/lib/attribution.js';
import { AD_ATTRIBUTION_FIELDS } from '../shared/attribution.js';
import { validateEnquiry } from '../shared/enquiry.js';
import { enquiryPayloadHash, isRedactedAttributionReplay } from '../server/services/enquiryStore.js';
import { mapFlowPayload } from '../server/services/zohoFlowService.js';
import { createApp } from '../server/app.js';

const source = readFileSync(new URL('../public/consent.js', import.meta.url), 'utf8');
const choiceKey = 'royalModelAdvertisingConsent';
const eventName = 'royalmodel:advertising-consent';
const input = { fullName: 'Consent Test', phone: '+12025550123', email: 'test@example.com', service: 'Other', consent: true };

function setup({ decision, blocked = false, time = 100000 } = {}) {
  const storage = new Map();
  if (decision !== undefined) storage.set(choiceKey, typeof decision === 'string' ? decision : JSON.stringify(decision));
  const listeners = new Map();
  const events = [];
  let clock = time;
  const browser = {
    dataLayer: [], location: { href: 'https://clinic.example/?gclid=google-real&gbraid=braid-real&wbraid=web-real&fbclid=meta-real&utm_source=campaign' },
    document: { cookie: '_fbp=fb.1.123.real; _fbc=fb.1.123.meta-real', referrer: 'https://search.example/' },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
    localStorage: {
      getItem(key) { if (blocked) throw new Error('blocked'); return storage.get(key) ?? null; },
      setItem(key, value) { if (blocked) throw new Error('blocked'); storage.set(key, value); },
      removeItem(key) { if (blocked) throw new Error('blocked'); storage.delete(key); },
    },
    addEventListener(name, callback) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(callback); },
    dispatchEvent(event) { events.push(event); for (const callback of listeners.get(event.type) || []) callback(event); },
  };
  const context = vm.createContext({ window: browser, Date: { now: () => clock } });
  vm.runInContext(source, context);
  const attribution = createAttribution(browser, () => clock);
  browser.addEventListener(eventName, event => {
    if (typeof event.detail === 'boolean') attribution.setConsent(event.detail);
  });
  return { browser, storage, attribution, events, rerun: () => vm.runInContext(source, context), advance: value => { clock += value; } };
}
function commands(b) { return b.dataLayer.filter(item => item[0] === 'consent').map(item => JSON.parse(JSON.stringify(Array.from(item)))); }

test('first visit starts denied, with no assumed decision; bootstrap precedes the single GTM loader', () => {
  const { browser: b, attribution, rerun } = setup();
  assert.equal(b.royalModelConsent.getChoice(), null);
  assert.equal(b.royalModelAdvertisingConsent, false);
  assert.deepEqual(commands(b), [['consent', 'default', { ad_storage: 'denied', analytics_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' }]]);
  assert.equal(attribution.getPayload().gclid, '');
  rerun();
  assert.equal(commands(b).length, 1);
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(html.indexOf('<script src="/consent.js"></script>') < html.indexOf('<!-- Google Tag Manager -->'));
  assert.equal((html.match(/googletagmanager.com\/gtm.js/g) || []).length, 1);
  assert.equal((html.match(/name="facebook-domain-verification" content="hf8fg2qxknf4hmsbgj1ind2hsm1n0w"/g) || []).length, 1);
});

test('late Accept stores the exact boolean contract and enables existing URL and real cookie capture', () => {
  const { browser: b, storage, attribution, events } = setup();
  b.royalModelConsent.setChoice(true);
  assert.deepEqual(JSON.parse(storage.get(choiceKey)), { version: 1, value: true, updatedAt: 100000 });
  assert.equal(events.at(-1).type, eventName);
  assert.equal(events.at(-1).detail, true);
  assert.equal(b.royalModelAdvertisingConsent, true);
  assert.deepEqual(commands(b).at(-1), ['consent', 'update', { ad_storage: 'granted', analytics_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'denied' }]);
  for (const key of AD_ATTRIBUTION_FIELDS) assert.ok(attribution.getPayload()[key]);
  assert.ok(storage.has(ATTRIBUTION_STORAGE_KEY));
  b.royalModelConsent.setChoice(true);
  assert.equal(b.dataLayer.filter(item => item.event === 'royalmodel_consent_updated').length, 1, 'unchanged choice does not retrigger tags');
});

test('Decline clears attribution; reopening and accepting recaptures current URL IDs without reload', () => {
  const { browser: b, storage, attribution, events } = setup();
  b.royalModelConsent.setChoice(true);
  b.royalModelConsent.setChoice(false);
  assert.equal(events.at(-1).detail, false);
  assert.equal(JSON.parse(storage.get(choiceKey)).value, false);
  assert.equal(storage.has(ATTRIBUTION_STORAGE_KEY), false);
  for (const key of AD_ATTRIBUTION_FIELDS) assert.equal(attribution.getPayload()[key], '');
  assert.equal(attribution.getPayload().utmSource, 'campaign');
  assert.equal(commands(b).at(-1)[2].ad_storage, 'denied');
  b.location.href = 'https://clinic.example/?gclid=new-real-click';
  b.royalModelConsent.setChoice(true);
  assert.equal(attribution.getPayload().gclid, 'new-real-click');
});

test('returning decisions are restored before attribution; missing, expired and malformed consent never grants', () => {
  for (const value of [true, false]) {
    const { browser: b, attribution } = setup({ decision: { version: 1, value, updatedAt: 99999 } });
    assert.equal(b.royalModelConsent.getChoice(), value);
    assert.equal(Boolean(attribution.getPayload().gclid), value);
  }
  for (const decision of ['broken', 'true', { version: 1, value: 'true', updatedAt: 99999 }, { version: 2, value: true, updatedAt: 99999 }, { version: 1, value: true, updatedAt: 100001 }, { version: 1, value: true, updatedAt: 100000 - ATTRIBUTION_TTL }]) {
    const { browser: b } = setup({ decision });
    assert.equal(b.royalModelConsent.getChoice(), null);
    assert.equal(b.royalModelAdvertisingConsent, false);
  }
});

test('blocked storage keeps a working in-memory choice; malformed events cannot imply consent', () => {
  const { browser: b, attribution } = setup({ blocked: true });
  b.royalModelConsent.setChoice('true');
  b.dispatchEvent(new b.CustomEvent(eventName, { detail: { granted: true } }));
  assert.equal(b.royalModelConsent.getChoice(), null);
  b.royalModelConsent.setChoice(true);
  assert.equal(attribution.getPayload().gclid, 'google-real');
  b.royalModelConsent.setChoice(false);
  assert.equal(attribution.getPayload().gclid, '');
});

test('cross-tab withdrawal and expiry revoke attribution without renewing stored acceptance', () => {
  const { browser: b, storage, attribution, advance } = setup();
  b.royalModelConsent.setChoice(true);
  const denied = { version: 1, value: false, updatedAt: 100000 };
  storage.set(choiceKey, JSON.stringify(denied));
  b.dispatchEvent({ type: 'storage', key: choiceKey });
  assert.equal(attribution.getPayload().gclid, '');
  assert.deepEqual(JSON.parse(storage.get(choiceKey)), denied);
  b.royalModelConsent.setChoice(true);
  advance(ATTRIBUTION_TTL);
  b.dispatchEvent({ type: 'focus' });
  assert.equal(b.royalModelConsent.getChoice(), null);
  assert.equal(attribution.getPayload().gclid, '');
  assert.equal(storage.has(choiceKey), false);
});

test('withdrawal removes IDs from cached retry payload without changing the saved enquiry identity', () => {
  const { browser: b, attribution } = setup();
  b.royalModelConsent.setChoice(true);
  const snapshot = attribution.getPayload();
  const original = validateEnquiry({ ...input, ...snapshot });
  b.royalModelConsent.setChoice(false);
  const redacted = attributionForSubmission(snapshot, attribution.getPayload(), b.royalModelAdvertisingConsent);
  for (const key of AD_ATTRIBUTION_FIELDS) assert.equal(redacted[key], '');
  const retry = validateEnquiry({ ...input, ...redacted });
  assert.notEqual(enquiryPayloadHash(retry), enquiryPayloadHash(original));
  assert.equal(isRedactedAttributionReplay(retry, original), true);
  assert.equal(isRedactedAttributionReplay({ ...retry, fullName: 'Different Person' }, original), false);
  assert.equal(isRedactedAttributionReplay({ ...retry, gclid: 'changed' }, original), false);
  assert.equal(snapshot.gclid, 'google-real', 'original snapshot is not mutated');
});

test('Accept and Decline enquiries both return 201 and forward the matching IDs to Flow', async t => {
  for (const accepted of [true, false]) {
    const { browser: b, attribution } = setup();
    b.royalModelConsent.setChoice(accepted);
    let saved;
    let forwarded;
    const store = {
      async save(row) { saved = { ...row, _id: '0123456789abcdef01234567', submissionKey: '678d6127-4fa8-4651-8d99-577700fd24b7', createdAt: new Date(), zohoSyncStatus: 'pending' }; return saved; },
      async claim() { return saved; },
      async update(id, fields) { Object.assign(saved, fields); },
      async claimBotspace() { return null; },
    };
    const server = createApp({ store, flow: { async sync(row) { forwarded = mapFlowPayload(row); } }, botspace: {}, logger: { error() {} } }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/enquiries`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input, ...attribution.getPayload() }) });
    assert.equal(response.status, 201);
    assert.equal((await response.json()).enquiryId, saved._id);
    assert.equal(forwarded.gclid, accepted ? 'google-real' : '');
    assert.equal(forwarded.utmSource, 'campaign');
  }
});
