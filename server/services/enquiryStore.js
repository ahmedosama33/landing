import { createHash } from 'node:crypto';
import { AD_ATTRIBUTION_FIELDS } from '../../shared/attribution.js';
import Enquiry from '../models/Enquiry.js';
import { connectDB } from '../config/db.js';
import { createContactRegistry } from './botspaceContactRegistry.js';

async function contactRegistry() {
  const connection = await connectDB();
  return createContactRegistry(connection.connection.db.collection('botspace_contact_links'));
}

export class ConflictError extends Error {}
export function enquiryPayloadHash(row) {
  // Empty optional additions must not invalidate pre-update idempotency keys.
  const hashable = Object.fromEntries(Object.entries(row).filter(([key, value]) => !AD_ATTRIBUTION_FIELDS.includes(key) || value));
  return createHash('sha256').update(JSON.stringify(hashable)).digest('hex');
}
export function isRedactedAttributionReplay(row, saved) {
  // Withdrawal can remove optional IDs on a retry, but cannot change patient data.
  if (AD_ATTRIBUTION_FIELDS.some(key => row[key])) return false;
  const original = Object.fromEntries(Object.keys(row).map(key => [key,
    AD_ATTRIBUTION_FIELDS.includes(key) ? '' : saved[key] ?? '',
  ]));
  return enquiryPayloadHash(original) === enquiryPayloadHash(row);
}
export function botspaceTemplateClaimFilter(id) {
  return { _id: id, consent: true, botspaceSyncStatus: 'synced', botspaceTemplateStatus: 'pending',
    botspaceContactId: { $type: 'string', $ne: '' }, botspaceConversationId: { $type: 'string', $ne: '' },
    botspaceLastMessageId: { $in: [null, ''] }, botspaceLastMessageStatus: { $in: [null, ''] } };
}
export const enquiryStore = {
  async claimBotspaceTemplate(id, templateId) {
    await connectDB();
    // No stale-claim reset: the provider may have accepted a timed-out request.
    return Enquiry.findOneAndUpdate(botspaceTemplateClaimFilter(id),
      { $set: { botspaceTemplateStatus: 'sending', botspaceTemplateId: templateId, botspaceTemplateStartedAt: new Date() } },
      { returnDocument: 'after' }).lean();
  },
  async reserveBotspaceContact(phone, enquiryId) {
    await connectDB();
    // Pre-registry failures can already represent a successful remote create.
    // Preserve them for manual reconciliation instead of retrying under a new UUID.
    const unresolved = await Enquiry.findOne({ phone, botspaceContactId: { $in: [null, ''] },
      ...(enquiryId ? { _id: { $ne: enquiryId } } : {}), $or: [
        { botspaceSyncStatus: 'failed' },
        { botspaceSyncStatus: 'syncing', botspaceSyncStartedAt: { $lt: new Date(Date.now() - 120000) } },
      ] }).select('_id').lean();
    if (unresolved) return { acquired: false };
    return (await contactRegistry()).reserve(phone);
  },
  async resolveBotspaceContact(phone, contactId) { return (await contactRegistry()).resolve(phone, contactId); },
  async updateBotspaceMessageStatus(id, messageId, status) {
    await connectDB();
    const result = await Enquiry.updateOne({ _id: id, botspaceLastMessageId: messageId },
      { $set: { botspaceLastMessageStatus: status } }, { runValidators: true });
    return result.matchedCount === 1;
  },
  async claimBotspace(id) {
    await connectDB();
    // No automatic retry of ambiguous remote creates: Swagger promises no idempotency.
    return Enquiry.findOneAndUpdate({ _id: id, $or: [
      { botspaceSyncStatus: 'pending' }, { botspaceSyncStatus: { $exists: false } },
    ] }, { $set: { botspaceSyncStatus: 'syncing', botspaceSyncStartedAt: new Date() } }, { returnDocument: 'after' }).lean();
  },
  async findBotspaceContact(phone) {
    await connectDB();
    const registered = await (await contactRegistry()).find(phone);
    if (registered) return registered;
    const row = await Enquiry.findOne({ phone, botspaceContactId: { $type: 'string', $ne: '' } })
      .sort({ createdAt: -1 }).select('botspaceContactId').lean();
    return row?.botspaceContactId;
  },
  async markWhatsAppStarted(id, submissionKey) {
    await connectDB();
    const result = await Enquiry.updateOne({ _id: id, submissionKey },
      { $set: { whatsappStarted: true } }, { runValidators: true, timestamps: false });
    return result.matchedCount === 1;
  },
  async save(row, submissionKey) {
    await connectDB();
    const payloadHash = enquiryPayloadHash(row);
    let saved;
    try {
      saved = await Enquiry.findOneAndUpdate({ submissionKey }, {
        $setOnInsert: { ...row, submissionKey, payloadHash },
      }, { upsert: true, returnDocument: 'after', runValidators: true, setDefaultsOnInsert: true }).lean();
    } catch (error) {
      if (error.code !== 11000) throw error;
      saved = await Enquiry.findOne({ submissionKey }).lean();
    }
    if (!saved || (saved.payloadHash !== payloadHash && !isRedactedAttributionReplay(row, saved))) throw new ConflictError('Submission key already used.');
    return saved;
  },
  async claim(id, { retry = true } = {}) {
    await connectDB();
    return Enquiry.findOneAndUpdate({ _id: id, $or: [
      { zohoSyncStatus: { $in: retry ? ['pending', 'failed'] : ['pending'] } },
      ...(retry ? [{ zohoSyncStatus: 'syncing', zohoSyncStartedAt: { $lt: new Date(Date.now() - 120000) } }] : []),
    ] }, { $set: { zohoSyncStatus: 'syncing', zohoSyncStartedAt: new Date(), zohoSyncError: null } }, { returnDocument: 'after' }).lean();
  },
  async update(id, fields) {
    const result = await Enquiry.updateOne({ _id: id }, { $set: fields }, { runValidators: true });
    if (!result.matchedCount) throw new Error('Enquiry not found.');
  },
};
