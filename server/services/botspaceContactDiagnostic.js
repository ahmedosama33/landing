import { normalizePhone } from '../../shared/enquiry.js';
import { BotspaceError } from '../config/botspace.js';

export async function diagnoseContactCreation({ allowCreate = false, absenceConfirmed = false, phone }, store, client) {
  const base = { messagesSent: false, flowInvoked: false, dashboard: 'Contacts in the workspace that issued BOTSPACE_API_KEY; a contact alone need not appear in Inbox.' };
  if (!allowCreate || !absenceConfirmed) return { ...base, mode: 'DRY_RUN', created: false,
    required: 'Both --allow-create-contact and --absence-confirmed plus BOTSPACE_TEST_PHONE are required. Confirm in Contacts that your designated test phone is absent.' };
  const row = { fullName: 'Royal Model integration test', phone: normalizePhone(phone) };
  const known = await store.findBotspaceContact(row.phone);
  if (known) return { ...base, created: false, contactId: known, result: 'existing_local_mapping; verify in Contacts', contactExists: 'not_independently_verified' };
  const existing = await client.getConversationByPhone(row.phone);
  if (existing) return { ...base, created: false, conversationId: existing.id,
    result: 'existing_conversation; reconcile actual contact ID in Contacts before creating', contactExists: 'not_independently_verified' };
  const reserved = await store.reserveBotspaceContact(row.phone);
  if (!reserved.acquired) return { ...base, created: false, contactId: reserved.contactId ?? null,
    result: 'prior_attempt; reconcile before retry', contactExists: 'not_independently_verified' };
  let contactId;
  try {
    contactId = await client.createContact(row);
    await store.resolveBotspaceContact(row.phone, contactId);
    return { ...base, created: true, contactId, contactExists: 'creation_confirmed_by_provider',
      result: 'Provider returned a contact ID. Verify dashboard visibility in Contacts; no conversation or message was created by this diagnostic.' };
  } catch (error) {
    return { ...base, created: 'unknown', contactId: contactId ?? null, contactExists: 'requires_reconciliation',
      result: 'Do not retry creation; the durable phone reservation is retained.',
      error: error instanceof BotspaceError ? error.message : 'Creation or mapping persistence could not be confirmed.' };
  }
}
