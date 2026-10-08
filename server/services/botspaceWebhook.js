// The public Swagger does not specify webhook envelopes or authenticity verification.
// Disabled shell until a verified, durable event processor exists. "Valid" means
// a JSON object, NOT an authenticated BotSpace event. No persistence/CRM writes.
// TODO: obtain verification mechanism and Incoming/Outgoing/Delivery examples;
// verify raw bytes before mapping identifiers, deduplicating, or writing anything.
export function createBotspaceWebhook(logger = console) {
  return (req, res) => {
    if (!req.is('application/json')) return res.status(415).json({ success: false, message: 'Use application/json.' });
    let body;
    try { body = JSON.parse(req.body.toString('utf8')); }
    catch { return res.status(400).json({ success: false, message: 'Invalid JSON.' }); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ success: false, message: 'Expected a JSON object.' });
    logger.info?.('botspace_webhook_unavailable', { bytes: req.body.length });
    return res.status(503).json({ success: false, processed: false, message: 'Webhook processing is not configured.' });
  };
}
