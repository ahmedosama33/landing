import { normalizePhone } from '../../shared/enquiry.js';
import { BotspaceError } from '../config/botspace.js';
import { getBotspaceConfig } from '../config/env.js';
import { parsePhoneNumberFromString } from 'libphonenumber-js';

function identifier(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) throw new BotspaceError('BotSpace identifier is invalid.');
  return value;
}

export function botspacePhoneParts(value) {
  const normalized = normalizePhone(value);
  const parsed = parsePhoneNumberFromString(normalized);
  // Never choose a default country or silently change the stored identity.
  if (!parsed || parsed.number !== normalized) throw new BotspaceError('BotSpace phone cannot be split safely.');
  return { countryCode: parsed.countryCallingCode, phone: parsed.nationalNumber };
}

function messageResult(data) {
  identifier(data?.id);
  identifier(data?.conversationId);
  if (typeof data.status !== 'string' || !data.status || data.status.length > 80) throw new BotspaceError('BotSpace message response is invalid.');
  return { id: data.id, conversationId: data.conversationId, status: data.status };
}

export function createBotspaceClient(env = name => process.env[name], fetcher = fetch, logger = console) {
  async function request(path, { method = 'GET', body, query, operation = 'message request' } = {}) {
    const config = getBotspaceConfig(env);
    const url = new URL(path.replace('{channelId}', encodeURIComponent(config.channelId)), config.baseUrl);
    url.searchParams.set('apiKey', config.apiKey);
    for (const [key, value] of Object.entries(query || {})) url.searchParams.set(key, value);
    let response;
    try {
      response = await fetcher(url.toString(), {
        method, redirect: 'error', signal: AbortSignal.timeout(5000),
        headers: { 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch { throw new BotspaceError(`BotSpace ${operation} failed or timed out; reconcile before retry.`); }
    let result;
    try { result = await response.json(); }
    catch { throw new BotspaceError(`BotSpace ${operation} returned invalid JSON: HTTP ${response.status}.`); }
    // Narrow observed provider contract: verified live on 7 October 2026.
    const conversationAbsent = operation === 'conversation lookup' && response.status === 404
      && typeof result?.message === 'string' && /^Conversation not found$/i.test(result.message);
    if (process.env.NODE_ENV === 'development') logger.info?.('[botspace] request completed', {
      operation, method, path, status: response.status,
      reason: conversationAbsent ? 'conversation_not_found' : response.ok ? 'ok' : 'request_rejected',
    });
    if (conversationAbsent) return null;
    if (!response.ok) {
      const error = new BotspaceError(`BotSpace ${operation} failed: HTTP ${response.status}; reconcile before retry.`);
      error.status = response.status;
      throw error;
    }
    if (!result?.data || typeof result.data !== 'object' || Array.isArray(result.data)) throw new BotspaceError('BotSpace response data is invalid; reconcile before retry.');
    return result.data;
  }
  const client = {
    async createContact(row) {
      // Swagger: POST /v1/contact, apiKey query parameter, name + E.164 phone.
      // This endpoint is account-scoped, not channel-scoped.
      const data = await request('/v1/contact', { operation: 'contact creation', method: 'POST', body: {
        name: row.fullName, phone: normalizePhone(row.phone), ...(row.email ? { email: row.email } : {}),
      } });
      return identifier(data.contactId);
    },
    async getConversationByPhone(phone) {
      const data = await request('/v1/{channelId}/conversation', { operation: 'conversation lookup', query: botspacePhoneParts(phone) });
      if (data === null) return null;
      const id = identifier(data.id);
      if (data.fullPhoneNumber !== normalizePhone(phone)) throw new BotspaceError('BotSpace conversation phone did not match.');
      return { id };
    },
    async createConversation(row) {
      const data = await request('/v1/{channelId}/conversation', { operation: 'conversation creation', method: 'POST', body: {
        name: row.fullName, phone: normalizePhone(row.phone),
      } });
      const id = identifier(data.conversationId);
      if (data.fullPhoneNumber !== normalizePhone(row.phone)) throw new BotspaceError('BotSpace conversation phone did not match.');
      return { id };
    },
    async ensureConversation(row, { absenceConfirmed = false } = {}) {
      if (row.botspaceConversationId) return { id: identifier(row.botspaceConversationId) };
      const existing = absenceConfirmed ? null : await client.getConversationByPhone(row.phone);
      if (existing) return existing;
      try { return await client.createConversation(row); }
      catch (error) {
        // A concurrent creator may have won. Reconcile by phone, never invent an ID.
        if (error.status !== 409) throw error;
        const found = await client.getConversationByPhone(row.phone);
        if (!found) throw error;
        return found;
      }
    },
    async sendTemplateMessage(row, variables = []) {
      const templateId = env('BOTSPACE_TEMPLATE_ID');
      if (!templateId) return { skipped: true, reason: 'template_not_configured' };
      if (typeof templateId !== 'string' || templateId.length > 200 || !Array.isArray(variables)
        || variables.some(value => !['string', 'number'].includes(typeof value))) throw new BotspaceError('BotSpace template configuration is invalid.');
      // Swagger declares variables as object but illustrates an array; follow its
      // example and the requested text-template contract. No media/cards added.
      return messageResult(await request('/v1/{channelId}/message/send-message', { operation: 'template send', method: 'POST', body: {
        name: row.fullName, phone: normalizePhone(row.phone), templateId, variables,
      } }));
    },
    async sendSessionMessage(row, text, { sessionConfirmed = false } = {}) {
      if (!sessionConfirmed) throw new BotspaceError('A confirmed WhatsApp session is required.');
      if (typeof text !== 'string' || !text.trim()) throw new BotspaceError('BotSpace message text is required.');
      return messageResult(await request('/v1/{channelId}/message/send-session-message', { operation: 'session send', method: 'POST', body: {
        name: row.fullName, phone: normalizePhone(row.phone), text,
      } }));
    },
    async getMessage(messageId) {
      const data = await request(`/v1/{channelId}/message/${identifier(messageId)}`, { operation: 'message lookup' });
      if (data._id !== messageId || data.channelId !== getBotspaceConfig(env).channelId) throw new BotspaceError('BotSpace message identity did not match.');
      // Return metadata only, never provider raw message/customer content.
      return { id: data._id, createdOn: data.createdOn, direction: data.direction };
    },
    async getMessageStatus(messageId) {
      const data = await request(`/v1/{channelId}/message/${identifier(messageId)}/delivery-status`, { operation: 'delivery lookup' });
      if (data.messageId !== messageId || !['SENT', 'DELIVERED', 'REPLIED', 'FAILED', 'READ', 'CLICKED'].includes(data.status)) {
        throw new BotspaceError('BotSpace delivery response is invalid.');
      }
      return { messageId: data.messageId, status: data.status };
    },
  };
  return client;
}

export async function syncBotspaceEnquiry(store, client, id, logger = console) {
  const row = await store.claimBotspace(id);
  if (!row) return false;
  let contactId = row.botspaceContactId;
  let conversationId = row.botspaceConversationId;
  try {
    // Reuse a known mapping from earlier enquiries with the same normalized phone.
    contactId ||= await store.findBotspaceContact(row.phone);
    if (!contactId) {
      try { contactId = await client.createContact(row); }
      catch (error) {
        if (error.status !== 409) throw error;
        contactId = await store.findBotspaceContact(row.phone);
        if (!contactId) {
          // A conversation is not a contact. Preserve its mapping but require the
          // real contact ID to be reconciled; Swagger has no contact lookup by phone.
          conversationId = (await client.ensureConversation(row)).id;
          throw new BotspaceError('BotSpace contact already exists; conversation reconciled, contact ID requires administrator mapping.');
        }
      }
    }
    // Persist partial progress before the next external operation.
    await store.update(id, { botspaceContactId: contactId });
    if (process.env.NODE_ENV === 'development') logger.info?.('[botspace] contact ready', { enquiryId: String(id), contactId });
    conversationId = (await client.ensureConversation({ ...row, botspaceConversationId: conversationId })).id;
    await store.update(id, { botspaceSyncStatus: 'synced', botspaceContactId: contactId, botspaceConversationId: conversationId, botspaceSyncError: null });
    if (process.env.NODE_ENV === 'development') logger.info?.('[botspace] conversation ready', { enquiryId: String(id), conversationId });
    return true;
  } catch (error) {
    const reason = error instanceof BotspaceError ? error.message : 'BotSpace synchronization failed; administrator review required.';
    logger.error('botspace_sync_failed', { enquiry_id: String(id), reason });
    try {
      await store.update(id, { botspaceSyncStatus: 'failed', ...(contactId ? { botspaceContactId: contactId } : {}), ...(conversationId ? { botspaceConversationId: conversationId } : {}), botspaceSyncError: reason });
    } catch { logger.error('botspace_sync_status_write_failed', { enquiry_id: String(id) }); }
    return false;
  }
}

// Trusted server-side polling only. Match the current message so a late poll
// cannot overwrite metadata for a newer message. No public polling endpoint.
export async function refreshBotspaceMessageStatus(store, client, row) {
  const result = await client.getMessageStatus(row.botspaceLastMessageId);
  return store.updateBotspaceMessageStatus(row._id, result.messageId, result.status);
}

async function recordSentMessage(store, row, result) {
  if (result.skipped) return result;
  await store.update(row._id, {
    botspaceLastMessageId: result.id, botspaceLastMessageStatus: result.status,
    botspaceConversationId: result.conversationId,
  });
  // Send responses have no timestamp. Do not invent a delivered/message time.
  return result;
}

// Explicit trusted-server operations only; never called by the enquiry route.
// If persistence fails after send, reconcile remotely before any retry.
export async function sendBotspaceTemplate(store, client, row, variables = []) {
  return recordSentMessage(store, row, await client.sendTemplateMessage(row, variables));
}

export async function sendBotspaceSession(store, client, row, text, options) {
  return recordSentMessage(store, row, await client.sendSessionMessage(row, text, options));
}
