import { createHash } from 'node:crypto';
import { normalizePhone } from '../../shared/enquiry.js';

// One configured BotSpace workspace per deployment. No expiring lock: a timed
// out create may already have succeeded. Only verified reconciliation can release it.
export function createContactRegistry(collection) {
  const key = phone => createHash('sha256').update(normalizePhone(phone)).digest('hex');
  return {
    async find(phone) { return (await collection.findOne({ _id: key(phone) }))?.contactId; },
    async reserve(phone) {
      try {
        await collection.insertOne({ _id: key(phone), state: 'needs_reconciliation', attemptedAt: new Date() });
        return { acquired: true };
      } catch (error) {
        if (error.code !== 11000) throw error;
        return { acquired: false, contactId: await this.find(phone) };
      }
    },
    async resolve(phone, contactId) {
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(contactId)) throw new Error('Invalid contact mapping.');
      const result = await collection.updateOne({ _id: key(phone), $or: [{ contactId: { $exists: false } }, { contactId }] },
        { $set: { contactId, state: 'resolved', resolvedAt: new Date() } });
      if (!result.matchedCount) throw new Error('Contact reservation missing or mapping conflicts.');
    },
  };
}
