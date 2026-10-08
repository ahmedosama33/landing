import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import mongoose from 'mongoose';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { getMongoConfig, getAllowedOrigin, getBotspaceConfig } from './config/env.js';
import { getZohoFlowConfig } from './services/zohoFlowService.js';
import { createBotspaceClient } from './services/botspaceService.js';

export function summarizeStoredError(value) {
  if (!value) return null;
  const status = /HTTP (\d{3})/.exec(value)?.[1];
  return { httpStatus: status ? Number(status) : null,
    operation: /contact creation/.test(value) ? 'contact creation' : /conversation lookup/.test(value) ? 'conversation lookup'
      : /conversation creation/.test(value) ? 'conversation creation' : 'unknown',
    reason: /configuration/i.test(value) ? 'configuration' : /conversation.*not found/i.test(value) ? 'conversation_not_found'
      : /rejected/i.test(value) ? 'request_rejected' : /acknowledgement/i.test(value) ? 'acknowledgement_invalid'
        : /timed out/i.test(value) ? 'timeout' : 'other_redacted' };
}

export async function checkConversation(row, env = name => process.env[name], fetcher = fetch) {
  const attempts = [];
  // The diagnostic exposes only this read method. It cannot create or send.
  const client = createBotspaceClient(env, async (url, init) => {
    if (init.method !== 'GET') throw new Error('Read-only diagnostic');
    const response = await fetcher(url, init);
    attempts.push({ operation: 'conversation lookup', method: 'GET', path: '/v1/{channelId}/conversation', status: response.status });
    return response;
  }, { info() {} });
  try {
    const result = await client.getConversationByPhone(row.phone);
    return { attempts, result: result ? 'found_matching_phone' : 'conversation_not_found',
      conversationId: result?.id ?? null, storedIdMatches: result ? result.id === row.botspaceConversationId : null,
      dashboardVisibility: 'manual_check_required' };
  } catch (error) {
    return { attempts, result: 'lookup_failed_or_invalid_response',
      reason: /split safely|country code|Invalid phone/.test(error.message) ? 'invalid_international_phone'
        : /configuration/.test(error.message) ? 'configuration' : 'provider_or_transport_failure',
      dashboardVisibility: 'manual_check_required' };
  }
}

export async function runDiagnostics() {
  const report = { mode: 'READ_ONLY', writes: false, messages: false, conversionEvents: false, configuration: {}, localOverrides: [] };
  const names = ['MONGODB_URI', 'ZOHO_FLOW_WEBHOOK_URL', 'BOTSPACE_API_KEY', 'BOTSPACE_CHANNEL_ID',
    'BOTSPACE_BASE_URL', 'BOTSPACE_PROPERTY_FULL_NAME', 'BOTSPACE_PROPERTY_EMAIL', 'BOTSPACE_PROPERTY_SERVICE',
    'BOTSPACE_PROPERTY_ENQUIRY', 'BOTSPACE_TEST_PHONE', 'BOTSPACE_TEMPLATE_ID', 'BOTSPACE_AUTO_SEND',
    'BOTSPACE_TEMPLATE_VARIABLE_FIELDS', 'ALLOWED_ORIGIN', 'VITE_CLINIC_WHATSAPP_NUMBER', 'TEST_MONGODB_URI'];
  for (const name of names) report.configuration[name] = process.env[name]?.trim() ? 'present' : 'missing';
  try {
    const local = parseEnv(readFileSync('.env.local', 'utf8'));
    report.localOverrides = names.filter(name => local[name] && local[name] !== process.env[name]);
  } catch { /* optional Vite overrides */ }
  for (const [name, validate] of Object.entries({ mongo: getMongoConfig, botspace: getBotspaceConfig, flow: getZohoFlowConfig, origin: getAllowedOrigin })) {
    try { validate(); report.configuration[name] = 'valid_format_only'; }
    catch { report.configuration[name] = 'missing_or_invalid'; }
  }
  report.flow = 'Not invoked: webhook POST can create CRM records. Check Flow history and actual Lead ID manually.';
  report.statusSync = 'NOT IMPLEMENTED';
  report.meta = 'NOT IMPLEMENTED';
  try {
    const { uri } = getMongoConfig();
    // Use the native collection, disabling all automatic DDL/model initialization.
    await mongoose.connect(uri, { autoCreate: false, autoIndex: false, serverSelectionTimeoutMS: 5000, socketTimeoutMS: 5000 });
    const collection = mongoose.connection.db.collection('enquiries');
    const indexes = await collection.indexes();
    report.mongo = { connected: true, uniqueSubmissionIndex: indexes.some(index => index.unique && index.key.submissionKey === 1 && Object.keys(index.key).length === 1) };
    const projection = { phone: 1, botspaceContactId: 1, botspaceConversationId: 1,
      botspaceSyncStatus: 1, botspaceSyncError: 1, botspaceTemplateStatus: 1, botspaceLastMessageId: 1,
      zohoSyncStatus: 1, zohoSyncError: 1, zohoLeadId: 1, createdAt: 1 };
    const recent = await collection.find({}, { projection })
      .sort({ createdAt: -1 }).limit(5).toArray();
    const failed = await collection.find({ botspaceSyncStatus: 'failed' }, { projection })
      .sort({ createdAt: -1 }).limit(5).toArray();
    const rows = [...new Map([...recent, ...failed].map(row => [String(row._id), row])).values()];
    report.sample = 'Latest five enquiries plus latest five BotSpace failures, deduplicated; not a full database audit.';
    report.sampledEnquiries = [];
    for (const row of rows) {
      const parsed = typeof row.phone === 'string' ? parsePhoneNumberFromString(row.phone) : undefined;
      report.sampledEnquiries.push({ enquiryId: String(row._id),
      phoneAssessment: { recognizedCallingCode: Boolean(parsed), possibleLength: parsed?.isPossible() ?? false, unchangedIdentity: parsed?.number === row.phone },
      botspaceContactId: row.botspaceContactId ?? null, botspaceConversationId: row.botspaceConversationId ?? null,
      botspaceSyncStatus: row.botspaceSyncStatus ?? 'missing', botspaceError: summarizeStoredError(row.botspaceSyncError),
      templateStatus: row.botspaceTemplateStatus ?? 'legacy_not_scheduled', templateMessageIdPresent: Boolean(row.botspaceLastMessageId),
      zohoSyncStatus: row.zohoSyncStatus, zohoLeadIdPresent: Boolean(row.zohoLeadId), zohoError: summarizeStoredError(row.zohoSyncError),
      botspaceLive: await checkConversation(row) });
    }
  } catch { report.mongo = { ...report.mongo, diagnosticError: 'Database read failed; inspect credentials, network access and read permissions privately.' }; }
  finally { await mongoose.disconnect(); }
  return report;
}
