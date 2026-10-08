import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { connectDB } from '../server/config/db.js';
import Enquiry from '../server/models/Enquiry.js';
import { enquiryStore, ConflictError } from '../server/services/enquiryStore.js';
import { syncFlowEnquiry as syncEnquiry } from '../server/services/zohoFlowService.js';
import { validateEnquiry } from '../shared/enquiry.js';
import { once } from 'node:events';
import { createApp } from '../server/app.js';
import { createContactRegistry } from '../server/services/botspaceContactRegistry.js';

test('real Mongo contact registry serializes creation across concurrent enquiries', { skip: !process.env.TEST_MONGODB_URI }, async () => {
  process.env.MONGODB_URI = process.env.TEST_MONGODB_URI;
  const collectionName = `botspace_test_${randomUUID().replaceAll('-', '')}`;
  let collection;
  try {
    await connectDB();
    collection = mongoose.connection.db.collection(collectionName);
    const registry = createContactRegistry(collection);
    const phone = '+12025550123';
    const claims = await Promise.all(Array.from({ length: 5 }, () => registry.reserve(phone)));
    assert.equal(claims.filter(claim => claim.acquired).length, 1);
    assert.equal((await registry.reserve(phone)).acquired, false);
    await registry.resolve(phone, 'test-contact');
    assert.equal(await registry.find(phone), 'test-contact');
    await assert.rejects(registry.resolve(phone, 'wrong-contact'));
  } finally {
    if (collection) await collection.drop().catch(error => { if (error.code !== 26) throw error; });
    await mongoose.disconnect();
  }
});

// Explicit opt-in only. Use a dedicated test database, never the clinic database.
test('real MongoDB capture, concurrent deduplication, atomic claims and failed-sync retry', { skip: !process.env.TEST_MONGODB_URI }, async () => {
  process.env.MONGODB_URI = process.env.TEST_MONGODB_URI;
  const submissionKey = randomUUID();
  try {
    const connections = await Promise.all([connectDB(), connectDB()]);
    assert.equal(connections[0], connections[1]);
    await Enquiry.createIndexes();
    const row = validateEnquiry({ fullName: 'Integration Test', phone: '+15555550123', service: 'Other', consent: true });
    const saved = await Promise.all(Array.from({ length: 5 }, () => enquiryStore.save(row, submissionKey)));
    assert.equal(new Set(saved.map(item => String(item._id))).size, 1);
    assert.equal(await Enquiry.countDocuments({ submissionKey }), 1);
    await assert.rejects(enquiryStore.save({ ...row, fullName: 'Different' }, submissionKey), ConflictError);
    const id = saved[0]._id;
    assert.equal(await enquiryStore.markWhatsAppStarted(id, randomUUID()), false);
    const beforeTracking = await Enquiry.findById(id).lean();
    assert.equal(await enquiryStore.markWhatsAppStarted(id, submissionKey), true);
    const afterTracking = await Enquiry.findById(id).lean();
    assert.deepEqual(afterTracking, { ...beforeTracking, whatsappStarted: true });
    const logger = { error() {} };
    assert.equal(await syncEnquiry(enquiryStore, { async sync() { throw new Error('private'); } }, id, logger), false);
    assert.equal((await Enquiry.findById(id)).zohoSyncStatus, 'needs_reconciliation');
    assert.equal(await enquiryStore.claim(id), null);
    await Enquiry.updateOne({ _id: id }, { $set: { zohoSyncStatus: 'pending' } }); // Reconciled privately.
    const claims = await Promise.all([enquiryStore.claim(id), enquiryStore.claim(id)]);
    assert.equal(claims.filter(Boolean).length, 1);
    await Enquiry.updateOne({ _id: id }, { $set: { zohoSyncStartedAt: new Date(Date.now() - 180000) } });
    assert.equal(await syncEnquiry(enquiryStore, { async sync() { return '12345'; } }, id, logger, { retry: true }), true);
    const result = await Enquiry.findById(id);
    assert.equal(result.zohoSyncStatus, 'synced');
    assert.equal(result.zohoLeadId, undefined);
    assert.ok(result.createdAt);
    assert.ok(result.zohoSyncedAt);
  } finally {
    if (mongoose.connection.readyState === 1) await Enquiry.deleteMany({ submissionKey });
    await mongoose.disconnect();
  }
});

test('real HTTP capture persists in MongoDB and returns public success when both integration doubles fail', { skip: !process.env.TEST_MONGODB_URI }, async () => {
  process.env.MONGODB_URI = process.env.TEST_MONGODB_URI;
  const submissionKey = randomUUID();
  let server;
  try {
    await connectDB();
    await Enquiry.createIndexes();
    server = createApp({
      flow: { async sync() { throw new Error('mock CRM outage'); } },
      botspace: { async createContact() { throw new Error('mock BotSpace outage'); } },
      logger: { error() {} },
    }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/enquiries`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': submissionKey },
      body: JSON.stringify({ fullName: 'Integration Test', phone: '+12025550123', service: 'Other', consent: true, company_website: '' }),
    });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.deepEqual(body, { success: true, enquiryId: body.enquiryId, message: 'Your enquiry has been received.' });
    const saved = await Enquiry.findOne({ submissionKey }).lean();
    assert.equal(String(saved._id), body.enquiryId);
    assert.equal(saved.zohoSyncStatus, 'needs_reconciliation');
    assert.equal(saved.botspaceSyncStatus, 'failed');
  } finally {
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    if (mongoose.connection.readyState === 1) await Enquiry.deleteMany({ submissionKey });
    await mongoose.disconnect();
  }
});
