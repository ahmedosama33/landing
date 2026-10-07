import mongoose from 'mongoose';
import { enquiryStore } from './services/enquiryStore.js';
import { createZohoClient, syncEnquiry } from './services/zohoService.js';
const id = process.argv[2];
try {
  if (!/^[0-9a-f]{24}$/i.test(id || '')) throw new Error('Invalid ID.');
  const synced = await syncEnquiry(enquiryStore, createZohoClient(name => process.env[name]), id);
  console.log(synced ? 'Enquiry synced.' : 'Not synced; inspect the enquiry status in MongoDB.');
  if (!synced) process.exitCode = 1;
} catch {
  console.error('Retry failed. Check the enquiry ID and server configuration.');
  process.exitCode = 1;
} finally { await mongoose.disconnect(); }
