import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import { validateEnquiry, ValidationError } from '../shared/enquiry.js';
import { enquiryStore, ConflictError } from './services/enquiryStore.js';
import { createZohoFlowClient, syncFlowEnquiry } from './services/zohoFlowService.js';
import { createBotspaceClient, syncBotspaceEnquiry } from './services/botspaceService.js';
import { createBotspaceWebhook } from './services/botspaceWebhook.js';
import { sendEnquiryTemplate } from './services/botspaceAutoTemplate.js';
import { getAllowedOrigin } from './config/env.js';

const failureMessage = "We couldn't send your enquiry right now. Please try again.";
export function createApp({ store = enquiryStore, flow = createZohoFlowClient(), botspace = createBotspaceClient(), logger = console, rateLimitMax = 10 } = {}) {
  const app = express();
  const debug = (stage, fields = {}) => {
    if (process.env.NODE_ENV === 'development') logger.info?.(`[enquiry] ${stage}`, fields);
  };
  app.disable('x-powered-by');
  // Vercel is the single trusted reverse proxy; local dev accepts direct connections.
  app.set('trust proxy', process.env.VERCEL ? 1 : false);
  app.use(helmet());
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const origin = req.get('origin');
    const sameOrigin = origin === `${req.protocol}://${req.get('host')}`;
    const allowed = [getAllowedOrigin(), ...(process.env.NODE_ENV !== 'production' ? ['http://localhost:5173'] : [])].filter(Boolean);
    if (origin && !sameOrigin && !allowed.includes(origin)) return res.status(403).json({ success: false, message: 'Origin not allowed.' });
    if (origin) {
      res.set('Access-Control-Allow-Origin', origin);
      res.vary('Origin');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Idempotency-Key');
      res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
  // Disabled with 503 until verification and durable event processing exist.
  app.post('/api/webhooks/botspace', express.raw({ type: 'application/json', limit: '20kb' }), createBotspaceWebhook(logger));
  app.all('/api/webhooks/botspace', (req, res) => res.set('Allow', 'POST, OPTIONS').status(405).json({ success: false, message: 'Use POST.' }));
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, limit: rateLimitMax, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { success: false, message: 'Too many enquiries. Please try again later.' },
  });
  app.post('/api/enquiries', limiter, express.json({ limit: '20kb' }), async (req, res, next) => {
    debug('route reached');
    if (!req.is('application/json')) return res.status(415).json({ success: false, message: 'Use application/json.' });
    try {
      const row = validateEnquiry(req.body);
      debug('validation passed');
      const key = req.get('Idempotency-Key') || randomUUID();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) throw new ValidationError('Invalid submission key.');
      let saved;
      try { saved = await store.save(row, key); }
      catch (error) {
        debug(error instanceof ConflictError ? 'submission conflict' : 'Mongo save failed');
        throw error;
      }
      debug('Mongo save succeeded', { enquiryId: String(saved._id) });
      // Public replays never retry failed/ambiguous deliveries. Atomic claims
      // guard concurrent requests; reviewed private recovery handles failures.
      if (saved.zohoSyncStatus === 'pending') {
        try { await syncFlowEnquiry(store, flow, saved._id, logger); }
        catch { logger.error('zoho_flow_sync_claim_failed'); }
      }
      try {
        const prepared = await syncBotspaceEnquiry(store, botspace, saved._id, logger);
        // Only a freshly completed sync may trigger a message; public replays and
        // historical synced enquiries never start a new template attempt.
        if (prepared) await sendEnquiryTemplate(store, botspace, saved._id, logger);
      }
      catch { logger.error('botspace_sync_claim_failed'); }
      return res.status(201).json({ success: true, enquiryId: String(saved._id), message: 'Your enquiry has been received.' });
    } catch (error) { next(error); }
  });
  app.all('/api/enquiries', (req, res) => res.set('Allow', 'POST, OPTIONS').status(405).json({ success: false, message: 'Use POST.' }));
  const trackingLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { success: false, message: 'Too many requests. Please try again later.' },
  });
  app.post('/api/enquiries/:id/whatsapp-started', trackingLimiter, express.json({ limit: '20kb' }), async (req, res, next) => {
    const key = req.get('Idempotency-Key');
    if (!/^[0-9a-f]{24}$/i.test(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid enquiry ID.' });
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key || '')) return res.status(403).json({ success: false, message: 'Invalid submission key.' });
    try {
      // Ignore all body fields. Possession of this enquiry's submission key is required.
      const matched = await store.markWhatsAppStarted(req.params.id, key);
      if (!matched) return res.status(404).json({ success: false, message: 'Enquiry not found.' });
      return res.json({ success: true });
    } catch (error) { next(error); }
  });
  app.all('/api/enquiries/:id/whatsapp-started', (req, res) => res.set('Allow', 'POST, OPTIONS').status(405).json({ success: false, message: 'Use POST.' }));
  app.all('/api/health', (req, res) => res.set('Allow', 'GET, OPTIONS').status(405).json({ success: false, message: 'Use GET.' }));
  app.use((req, res) => res.status(404).json({ success: false, message: 'Not found.' }));
  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    let status = 500;
    let message = failureMessage;
    if (error instanceof ValidationError) {
      status = 400; message = error.message;
      debug('validation failed', { reason: error.code === 'honeypot_filled' ? 'honeypot_filled' : 'invalid_input' });
    }
    else if (error instanceof ConflictError) { status = 409; message = 'Submission details changed. Please submit again.'; }
    else if (error.type === 'entity.parse.failed') { status = 400; message = 'Invalid JSON.'; }
    else if (error.type === 'entity.too.large') { status = 413; message = 'Enquiry is too large.'; }
    if (status === 500) logger.error('enquiry_capture_failed', { type: error.name });
    res.status(status).json({ success: false, message });
  });
  return app;
}
export default createApp();
