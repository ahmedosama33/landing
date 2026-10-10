import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAttribution, ATTRIBUTION_STORAGE_KEY, ATTRIBUTION_TTL } from '../src/lib/attribution.js';
import { createEnquiryTracker } from '../src/lib/tracking.js';
import { validateEnquiry } from '../shared/enquiry.js';
import { mapFlowPayload } from '../server/services/zohoFlowService.js';
import Enquiry from '../server/models/Enquiry.js';
import { enquiryPayloadHash } from '../server/services/enquiryStore.js';

function browser(url = 'https://clinic.example/?gclid=click-1&utm_source=google') {
  const storage = new Map();
  return { location: { href: url }, document: { referrer: 'https://search.example/path?q=private', cookie: '_fbp=fb.1.123.456; _fbc=fb.1.123.click-1' },
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) }, storage };
}

test('unknown consent preserves existing UTMs but withholds advertising payload, storage and cookie reads', () => {
  const b = browser();
  let cookieReads = 0;
  Object.defineProperty(b.document, 'cookie', { get() { cookieReads++; return '_fbp=fb.1.123.456'; } });
  const a = createAttribution(b);
  const payload = a.getPayload();
  assert.equal(payload.utmSource, 'google');
  assert.equal(payload.landingPage, 'https://clinic.example/');
  assert.equal(payload.referrer, 'https://search.example/path');
  assert.equal(payload.gclid, '');
  assert.equal(payload.fbp, '');
  assert.equal(b.storage.size, 0);
  assert.equal(cookieReads, 0);
});

test('consent enables real URL/cookie attribution, 90-day persistence, nonempty merge and revocation', () => {
  let time = 1000;
  const b = browser();
  const a = createAttribution(b, () => time);
  a.setConsent(true);
  assert.equal(a.getPayload().gclid, 'click-1');
  assert.equal(a.getPayload().fbp, 'fb.1.123.456');
  b.location.href = 'https://clinic.example/?gclid=&utm_source=';
  b.document.cookie = '';
  time += 100;
  const returning = createAttribution(b, () => time);
  assert.equal(returning.getPayload().gclid, 'click-1');
  assert.equal(returning.getPayload().utmSource, 'google');
  time = 1000 + ATTRIBUTION_TTL;
  assert.equal(returning.getPayload().gclid, '');
  assert.equal(returning.getPayload().fbp, '');
  returning.setConsent(false);
  assert.equal(b.storage.has(ATTRIBUTION_STORAGE_KEY), false);
});

test('malformed or blocked storage/cookies and invalid click identifiers never prevent capture', () => {
  const b = browser('https://clinic.example/?gclid=%3Cprivate%3E&gbraid=real-braid');
  b.royalModelAdvertisingConsent = true;
  b.localStorage.setItem(ATTRIBUTION_STORAGE_KEY, '{broken');
  assert.equal(createAttribution(b).getPayload().gbraid, 'real-braid');
  Object.defineProperty(b, 'localStorage', { get() { throw new Error('blocked'); } });
  Object.defineProperty(b.document, 'cookie', { get() { throw new Error('blocked'); } });
  const a = createAttribution(b);
  assert.equal(a.getPayload().gclid, '');
  assert.equal(a.getPayload().gbraid, 'real-braid');
  assert.equal(a.getPayload().fbc, '');
  assert.doesNotThrow(() => a.setConsent(false));
});

test('saved enquiry emits once; rejected responses, missing IDs, and patient data do not reach GTM', () => {
  const b = {};
  const track = createEnquiryTracker(b);
  const result = { success: true, enquiryId: '0123456789abcdef01234567', fullName: 'Private', service: 'Other', gclid: 'private' };
  assert.equal(track(result, false), false);
  assert.equal(track({ ...result, success: false }, true), false);
  assert.equal(track({ success: true }, true), false);
  assert.equal(track(result, true), true);
  assert.equal(track(result, true), false);
  assert.equal(createEnquiryTracker(b)(result, true), false);
  assert.deepEqual(b.dataLayer, [{ event: 'enquiry_submitted', enquiry_id: result.enquiryId }]);
  assert.doesNotThrow(() => createEnquiryTracker({ dataLayer: { push() { throw new Error('blocked'); } } })(result, true));
});

test('all six attribution identifiers survive validation, model serialization and Flow mapping', async () => {
  const ids = { gclid: 'real-click', gbraid: 'real-braid', wbraid: 'other-braid', fbclid: 'meta-click', fbp: 'fb.1.123.456', fbc: 'fb.1.123.meta-click' };
  const input = { fullName: 'Test Person', phone: '+12025550123', service: 'Other', consent: true, utmSource: 'google', ...ids };
  const row = validateEnquiry(input);
  const doc = new Enquiry({ ...row, submissionKey: 'test', payloadHash: 'test', createdAt: new Date() });
  await doc.validate();
  const mapped = mapFlowPayload(doc.toObject());
  for (const [key, value] of Object.entries(ids)) assert.equal(mapped[key], value);
  assert.equal(mapped.utmSource, 'google');
  for (const value of [{ malicious: true }, 'x'.repeat(513), 'space is invalid', '<script>']) {
    assert.throws(() => validateEnquiry({ ...input, gclid: value }), /Invalid gclid/);
  }
});

test('empty attribution additions preserve old submission hashes; real changes still conflict', () => {
  const old = { fullName: 'Test', utmSource: 'google' };
  assert.equal(enquiryPayloadHash(old), enquiryPayloadHash({ ...old, gclid: '', gbraid: '', wbraid: '', fbclid: '', fbp: '', fbc: '' }));
  assert.notEqual(enquiryPayloadHash(old), enquiryPayloadHash({ ...old, gclid: 'real-click' }));
});

test('one GTM loader and fallback, no direct vendor installation, conversion only after success branch', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.equal((html.match(/googletagmanager.com\/gtm.js/g) || []).length, 1);
  assert.equal((html.match(/googletagmanager.com\/ns.html/g) || []).length, 1);
  assert.doesNotMatch(html, /gtag\/js|fbevents.js|facebook-domain-verification/);
  const form = readFileSync(new URL('../src/components/contactform.jsx', import.meta.url), 'utf8');
  assert.ok(form.indexOf('trackEnquirySubmitted(result, response.ok)') > form.indexOf("setStatus('success')"));
  const home = readFileSync(new URL('../src/pages/Home.jsx', import.meta.url), 'utf8');
  assert.match(home, /https:\/\/wa.me\//);
  assert.match(home, /href="tel:0559988250"/);
  assert.match(home, /href="tel:043389909"/);
});
