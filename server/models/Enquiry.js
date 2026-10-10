import mongoose from 'mongoose';
import { SERVICES } from '../../shared/enquiry.js';
import { AD_ATTRIBUTION_FIELDS, ATTRIBUTION_ID_MAX_LENGTH, validAttributionId } from '../../shared/attribution.js';

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
  ...Object.fromEntries(AD_ATTRIBUTION_FIELDS.map(key => [key, {
    ...text(ATTRIBUTION_ID_MAX_LENGTH), validate: value => !value || validAttributionId(value),
  }])),
  // New records track Flow receipt, not CRM completion. Legacy synced rows and
  // lead IDs keep their old meaning; no automatic replay or destructive migration.
  zohoSyncStatus: { type: String, enum: ['pending', 'syncing', 'synced', 'failed', 'needs_reconciliation'], default: 'pending' },
  zohoLeadId: String, zohoSyncedAt: Date, zohoSyncError: String, zohoSyncStartedAt: Date,
  // Safe response projection only, never a raw response body or header.
  zohoFlowResponse: { type: new mongoose.Schema({
    status: Number, contentType: text(80), body: text(160),
  }, { _id: false }), default: null },
  whatsappStarted: { type: Boolean, default: false },
  botspaceSyncStatus: { type: String, enum: ['pending', 'syncing', 'synced', 'failed'], default: 'pending' },
  botspaceContactId: text(128), botspaceSyncError: text(300), botspaceSyncStartedAt: Date,
  botspaceSyncFailure: { type: new mongoose.Schema({
    operation: text(80), status: Number,
    code: { type: String, enum: ['transport_failure', 'invalid_json', 'request_rejected', 'invalid_response'] },
  }, { _id: false }), default: null },
  botspaceConversationId: text(128), botspaceLastMessageId: text(128),
  botspaceLastMessageStatus: text(80), botspaceLastMessageAt: Date,
  botspaceTemplateStatus: { type: String, enum: ['pending', 'sending', 'accepted', 'failed', 'needs_reconciliation'], default: 'pending' },
  botspaceTemplateId: text(200), botspaceTemplateStartedAt: Date, botspaceTemplateError: text(300),
  whatsappStatus: { type: String, enum: ['not_started', 'started', 'active', 'closed'], default: 'not_started' },
  whatsappLastDirection: { type: String, enum: ['inbound', 'outbound'] },
}, { timestamps: true, bufferCommands: false });
schema.index({ zohoSyncStatus: 1, createdAt: 1 });
export default mongoose.models.Enquiry || mongoose.model('Enquiry', schema);
