import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createApp } from '../server/app.js';
import { getMongoConfig, getZohoConfig, getBotspaceConfig, getAllowedOrigin } from '../server/config/env.js';

function environment(t, changes) {
  const previous = Object.fromEntries(Object.keys(changes).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  t.after(() => { for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } });
}

async function serve(t) {
  const server = createApp({ logger: { error() {} } }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}

test('lazy provider config rejects missing settings without leaking invalid values', () => {
  for (const helper of [getMongoConfig, getZohoConfig, getBotspaceConfig]) assert.throws(() => helper(() => undefined));
  assert.throws(() => getMongoConfig(() => 'https://secret@example.com'), error => !error.message.includes('secret'));
  assert.equal(getMongoConfig(name => name === 'MONGODB_URI' ? 'mongodb+srv://example.invalid/clinic' : undefined).uri, 'mongodb+srv://example.invalid/clinic');
  const settings = { ZOHO_CLIENT_ID: 'id', ZOHO_CLIENT_SECRET: 'private', ZOHO_REFRESH_TOKEN: 'refresh', ZOHO_ACCOUNTS_URL: 'https://accounts.zoho.com/', ZOHO_API_BASE_URL: 'https://www.zohoapis.com/' };
  assert.equal(getZohoConfig(name => settings[name]).apiBaseUrl, 'https://www.zohoapis.com');
});

test('production health is minimal without credentials; missing Mongo returns controlled failure', async t => {
  environment(t, { NODE_ENV: 'production', MONGODB_URI: undefined, ALLOWED_ORIGIN: undefined });
  const root = await serve(t);
  const health = await fetch(`${root}/api/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok' });
  const response = await fetch(`${root}/api/enquiries`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fullName: 'Deployment Test', phone: '+12025550123', service: 'Other', consent: true }) });
  assert.equal(response.status, 500);
  assert.doesNotMatch(await response.text(), /MONGODB_URI|mongodb|stack|configuration/i);
  const missing = await fetch(`${root}/api/nonexistent`);
  assert.equal(missing.status, 404);
  assert.match(missing.headers.get('content-type'), /application\/json/);
});

test('production permits Vercel same-origin HTTPS and exact configured origin, rejects others', async t => {
  environment(t, { NODE_ENV: 'production', VERCEL: '1', ALLOWED_ORIGIN: 'https://clinic.example/' });
  const root = await serve(t);
  for (const origin of [root.replace('http:', 'https:'), 'https://clinic.example']) {
    const r = await fetch(`${root}/api/health`, { headers: { Origin: origin, 'X-Forwarded-Proto': 'https' } });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('access-control-allow-origin'), origin);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  }
  for (const origin of ['http://localhost:5173', 'https://other.example']) {
    assert.equal((await fetch(`${root}/api/health`, { headers: { Origin: origin } })).status, 403);
  }
  assert.throws(() => getAllowedOrigin(name => name === 'ALLOWED_ORIGIN' ? '*' : 'production'));
  assert.throws(() => getAllowedOrigin(name => name === 'ALLOWED_ORIGIN' ? 'http://clinic.example' : 'production'));
});

test('public environment example has no credential values and API paths stay outside SPA fallback', () => {
  const example = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
  for (const name of ['MONGODB_URI', 'ZOHO_FLOW_WEBHOOK_URL', 'ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN', 'BOTSPACE_API_KEY', 'BOTSPACE_WEBHOOK_SECRET']) {
    assert.match(example, new RegExp(`^${name}=$`, 'm'), `${name} must be empty in public example`);
  }
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  const spa = new RegExp(`^${config.rewrites.at(-1).source}$`);
  for (const path of ['/api', '/api/health', '/api/enquiries', '/api/webhooks/botspace']) assert.equal(spa.test(path), false);
  assert.equal(spa.test('/some/frontend/route'), true);
  assert.equal(config.rewrites[0].destination, '/api/index');
});
