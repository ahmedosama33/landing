import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const consent = readFileSync(new URL('../public/consent.js', import.meta.url), 'utf8');
const loader = html.match(/<!-- Google Tag Manager -->\s*<script>([\s\S]*?)<\/script>/)[1];

function harness(saved = null) {
  const scripts = [];
  const listeners = new Map();
  const browser = {
    localStorage: { getItem: () => saved && JSON.stringify({ version: 1, value: saved.value, updatedAt: Date.now() }), setItem() {}, removeItem() {} },
    addEventListener(name, callback) { listeners.set(name, callback); },
  };
  const document = {
    getElementsByTagName() { return [{ parentNode: { insertBefore(node) { scripts.push(node); } } }]; },
    createElement(tag) { return { tag }; },
  };
  const context = vm.createContext({ window: browser, document });
  return { browser, scripts, listeners, initialize: () => vm.runInContext(consent, context), load: () => vm.runInContext(loader, context) };
}

test('failed consent.js download leaves GTM uninitialized even with a saved acceptance', () => {
  const h = harness({ value: true });
  // A blocked/404 script executes no code; the next inline loader still runs.
  h.load();
  h.load();
  assert.equal(h.scripts.length, 0);
  assert.equal(h.browser.royalModelGtmStarted, undefined);
  assert.equal(h.browser.dataLayer, undefined, 'no GTM initialization event');
  assert.doesNotMatch(html, /googletagmanager\.com\/ns\.html/);
  assert.match(html, /<script type="module" src="\/src\/main.jsx"><\/script>/, 'React still has its independent entry point');
});

test('partially failed consent initialization does not authorize GTM', () => {
  const h = harness();
  h.browser.addEventListener = name => { if (name === 'focus') throw new Error('initialization interrupted'); };
  assert.throws(h.initialize, /initialization interrupted/);
  assert.ok(h.browser.royalModelConsent, 'API object alone is not readiness');
  h.load();
  assert.equal(h.scripts.length, 0);
  assert.equal(h.browser.dataLayer.filter(entry => entry.event === 'gtm.js').length, 0);
});

test('successful initialization queues default denied and restored preferences before one GTM load', () => {
  for (const saved of [null, { value: true }, { value: false }]) {
    const h = harness(saved);
    h.initialize();
    h.load();
    h.initialize();
    h.load();
    assert.equal(h.scripts.length, 1);
    assert.equal(h.scripts[0].src, 'https://www.googletagmanager.com/gtm.js?id=GTM-5K6HVKD2');
    const queue = h.browser.dataLayer;
    assert.equal(queue[0][0], 'consent');
    assert.equal(queue[0][1], 'default');
    for (const category of ['ad_storage', 'analytics_storage', 'ad_user_data', 'ad_personalization']) assert.equal(queue[0][2][category], 'denied');
    assert.equal(h.browser.royalModelAdvertisingConsent, saved?.value === true);
    assert.equal(queue.filter(entry => entry[0] === 'consent' && entry[1] === 'default').length, 1);
    assert.equal(queue.filter(entry => entry.event === 'gtm.js').length, 1);
    assert.equal(queue.filter(entry => entry.event === 'royalmodel_consent_updated').length, 0);
    if (saved?.value) assert.ok(queue.findIndex(entry => entry[1] === 'update') < queue.findIndex(entry => entry.event === 'gtm.js'));
  }
});

test('replacing the initialized dataLayer blocks the GTM loader', () => {
  const h = harness();
  h.initialize();
  h.browser.dataLayer = [];
  h.load();
  assert.equal(h.scripts.length, 0);
  assert.equal(h.browser.dataLayer.length, 0);
});
