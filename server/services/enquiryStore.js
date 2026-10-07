import { createHash } from 'node:crypto';
import Enquiry from '../models/Enquiry.js';
import { connectDB } from '../config/db.js';

export class ConflictError extends Error {}
export const enquiryStore = {
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
    const payloadHash = createHash('sha256').update(JSON.stringify(row)).digest('hex');
    let saved;
    try {
      saved = await Enquiry.findOneAndUpdate({ submissionKey }, {
        $setOnInsert: { ...row, submissionKey, payloadHash },
      }, { upsert: true, returnDocument: 'after', runValidators: true, setDefaultsOnInsert: true }).lean();
    } catch (error) {
      if (error.code !== 11000) throw error;
      saved = await Enquiry.findOne({ submissionKey }).lean();
    }
    if (!saved || saved.payloadHash !== payloadHash) throw new ConflictError('Submission key already used.');
    return saved;
  },
  async claim(id) {
    await connectDB();
    return Enquiry.findOneAndUpdate({ _id: id, $or: [
      { zohoSyncStatus: { $in: ['pending', 'failed'] } },
      { zohoSyncStatus: 'syncing', zohoSyncStartedAt: { $lt: new Date(Date.now() - 120000) } },
    ] }, { $set: { zohoSyncStatus: 'syncing', zohoSyncStartedAt: new Date(), zohoSyncError: null } }, { returnDocument: 'after' }).lean();
  },
  async update(id, fields) {
    const result = await Enquiry.updateOne({ _id: id }, { $set: fields }, { runValidators: true });
    if (!result.matchedCount) throw new Error('Enquiry not found.');
  },
};
