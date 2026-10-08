import mongoose from 'mongoose';
import { SERVICES } from '../../shared/enquiry.js';

const text = maxLength => ({ type: String, trim: true, maxlength: maxLength });
const schema = new mongoose.Schema({
  submissionKey: { type: String, required: true, unique: true },
  payloadHash: { type: String, required: true },
  fullName: { ...text(80), required: true, minlength: 2 },
  phone: { ...text(16), required: true, index: true },
  email: { ...text(254), lowercase: true },
  service: { type: String, required: true, enum: SERVICES },
  message: text(2000),
  consent: { type: Boolean, required: true, validate: value => value === true },
  utmSource: text(255), utmMedium: text(255), utmCampaign: text(255),
  utmContent: text(255), utmTerm: text(255), landingPage: text(2000), referrer: text(2000),
  // New records track Flow receipt, not CRM completion. Legacy synced rows and
  // lead IDs keep their old meaning; no automatic replay or destructive migration.
  zohoSyncStatus: { type: String, enum: ['pending', 'syncing', 'synced', 'failed'], default: 'pending' },
  zohoLeadId: String, zohoSyncedAt: Date, zohoSyncError: String, zohoSyncStartedAt: Date,
  whatsappStarted: { type: Boolean, default: false },
  botspaceSyncStatus: { type: String, enum: ['pending', 'syncing', 'synced', 'failed'], default: 'pending' },
  botspaceContactId: text(128), botspaceSyncError: text(300), botspaceSyncStartedAt: Date,
  botspaceConversationId: text(128), botspaceLastMessageId: text(128),
  botspaceLastMessageStatus: text(80), botspaceLastMessageAt: Date,
  whatsappStatus: { type: String, enum: ['not_started', 'started', 'active', 'closed'], default: 'not_started' },
  whatsappLastDirection: { type: String, enum: ['inbound', 'outbound'] },
}, { timestamps: true, bufferCommands: false });
schema.index({ zohoSyncStatus: 1, createdAt: 1 });
export default mongoose.models.Enquiry || mongoose.model('Enquiry', schema);
