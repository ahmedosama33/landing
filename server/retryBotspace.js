import mongoose from 'mongoose';
import { connectDB } from './config/db.js';
import Enquiry from './models/Enquiry.js';
import { enquiryStore } from './services/enquiryStore.js';
import { createBotspaceClient, syncBotspaceEnquiry } from './services/botspaceService.js';

// Dry run unless explicitly executed by a trusted operator. Only existing contact
// mappings are eligible; ambiguous contact creation must be reconciled separately.
const id = process.argv[2];
try {
  if (!/^[0-9a-f]{24}$/i.test(id || '')) throw new Error('Invalid ID.');
  await connectDB();
  const row = await Enquiry.findById(id).select('botspaceContactId botspaceConversationId botspaceSyncStatus').lean();
  if (!row?.botspaceContactId || !['failed', 'pending'].includes(row.botspaceSyncStatus)) throw new Error('Not eligible.');
  console.log(JSON.stringify({ enquiryId: id, contactId: row.botspaceContactId, conversationId: row.botspaceConversationId || null,
    action: 'Reuse contact, look up conversation, create only on confirmed not-found; save result. No messages sent.', execute: process.argv.includes('--execute') }));
  if (process.argv.includes('--execute')) {
    if (row.botspaceSyncStatus === 'failed') {
      const reset = await Enquiry.updateOne({ _id: id, botspaceSyncStatus: 'failed', botspaceContactId: row.botspaceContactId }, { $set: { botspaceSyncStatus: 'pending' } });
      if (!reset.matchedCount) throw new Error('State changed.');
    }
    if (!await syncBotspaceEnquiry(enquiryStore, createBotspaceClient(), id)) process.exitCode = 1;
  }
} catch {
  console.error('BotSpace retry unavailable. Verify the enquiry ID, known contact mapping, pending/failed state, and database configuration.');
  process.exitCode = 1;
} finally { await mongoose.disconnect(); }
