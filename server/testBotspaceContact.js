import mongoose from 'mongoose';
import { getBotspaceConfig } from './config/env.js';
import { createBotspaceClient } from './services/botspaceService.js';
import { enquiryStore } from './services/enquiryStore.js';
import { diagnoseContactCreation } from './services/botspaceContactDiagnostic.js';

const operations = [];

try {
  const flags = process.argv.slice(2);
  if (flags.some(flag => !['--allow-create-contact', '--absence-confirmed'].includes(flag))) throw new Error('Unsupported argument.');
  getBotspaceConfig();
  const client = createBotspaceClient(undefined, async (url, init) => {
    const path = new URL(url).pathname;
    if (!(init.method === 'GET' && path.endsWith('/conversation')) && !(init.method === 'POST' && path === '/v1/contact')) {
      throw new Error('Diagnostic operation blocked.');
    }
    const response = await fetch(url, init);
    operations.push({ method: init.method, path: path === '/v1/contact' ? path : '/v1/{channelId}/conversation', status: response.status });
    return response;
  }, { info() {} });
  const result = await diagnoseContactCreation({ allowCreate: flags.includes('--allow-create-contact'),
    absenceConfirmed: flags.includes('--absence-confirmed'), phone: process.env.BOTSPACE_TEST_PHONE }, enquiryStore, client);
  console.log(JSON.stringify({ ...result, operations }, null, 2));
} catch {
  console.error('BotSpace diagnostic unavailable. Check BOTSPACE_API_KEY, BOTSPACE_CHANNEL_ID, BOTSPACE_BASE_URL, MONGODB_URI and BOTSPACE_TEST_PHONE privately. Raw error withheld.');
  console.log(JSON.stringify({ operations, messagesSent: false, result: 'No automatic retry; reconcile any previous write before creating.' }));
  process.exitCode = 1;
} finally { await mongoose.disconnect(); }
