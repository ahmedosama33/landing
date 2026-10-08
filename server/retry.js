import mongoose from 'mongoose';
import { enquiryStore } from './services/enquiryStore.js';
import { createZohoFlowClient, syncFlowEnquiry } from './services/zohoFlowService.js';
const id = process.argv[2];
try {
  if (!/^[0-9a-f]{24}$/i.test(id || '')) throw new Error('Invalid ID.');
  if (process.argv[3] !== '--idempotent-flow-confirmed') throw new Error('Confirm Flow deduplication before retry.');
  const synced = await syncFlowEnquiry(enquiryStore, createZohoFlowClient(), id, console, { retry: true });
  console.log(synced ? 'Delivered to Flow; verify CRM completion in Flow history.' : 'Not delivered; inspect MongoDB status.');
  if (!synced) process.exitCode = 1;
} catch {
  console.error('Retry failed. Check ID/configuration and use --idempotent-flow-confirmed only after verifying Flow deduplication.');
  process.exitCode = 1;
} finally { await mongoose.disconnect(); }
