import { AD_ATTRIBUTION_FIELDS } from '../../shared/attribution.js';

// Flow acknowledgement confirms receipt only, never CRM completion.
const messages = Object.freeze({
  configuration: 'Zoho Flow configuration missing or invalid: ZOHO_FLOW_WEBHOOK_URL.',
  timeout: 'Zoho Flow delivery timed out; reconcile before retry.',
  network: 'Zoho Flow delivery network failure; reconcile before retry.',
  acknowledgement: 'Zoho Flow acknowledgement invalid; reconcile before retry.',
  unexpected: 'Zoho Flow delivery failed; reconciliation required.',
});
class FlowError extends Error {
  constructor(code, status) {
    super(messages[code] || `Zoho Flow delivery failed: HTTP ${status} (${code}).`);
    this.code = code;
    this.status = status;
  }
}
export function getZohoFlowConfig(env = name => process.env[name]) {
  let url;
  try { url = new URL(env('ZOHO_FLOW_WEBHOOK_URL')?.trim()); }
  catch { throw new FlowError('configuration'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash
    || !/^flow\.zoho\.(com|eu|in|com\.au|com\.cn|jp|ca|sa)$/.test(url.hostname)
    || !/^\/\d+\/flow\/webhook\/incoming$/.test(url.pathname)
    || !url.searchParams.get('zapikey')) throw new FlowError('configuration');
  return { webhookUrl: url.href };
}
export function mapFlowPayload(row) {
  const payload = { enquiryId: String(row._id), submissionKey: row.submissionKey };
  for (const key of ['fullName', 'phone', 'email', 'service', 'message', 'consent', 'landingPage',
    'referrer', 'utmSource', 'utmMedium', 'utmCampaign', 'utmContent', 'utmTerm', ...AD_ATTRIBUTION_FIELDS]) {
    payload[key] = row[key] ?? (key === 'consent' ? false : '');
  }
  payload.createdAt = new Date(row.createdAt).toISOString();
  return payload;
}
// Diagnostics deliberately project only a boolean acknowledgement. Truncating raw
// response text is not redaction: providers can echo secrets or customer data.
function responseDiagnostics(response) {
  const mediaType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  return {
    status: response.status,
    contentType: !mediaType ? 'missing' : ['application/json', 'text/plain', 'text/html', 'application/problem+json'].includes(mediaType) ? mediaType : 'other/redacted',
    body: '[unreadable body; redacted]',
  };
}
function summarizeBody(text) {
  if (!text.trim()) return { summary: '[empty body]' };
  let body;
  try { body = JSON.parse(text); }
  catch { return { summary: '[non-JSON body; redacted]' }; }
  const object = body !== null && typeof body === 'object' && !Array.isArray(body);
  const accepted = object && Object.hasOwn(body, 'accepted') ? body.accepted : undefined;
  return { accepted, summary: typeof accepted === 'boolean'
    ? JSON.stringify({ accepted }) : '[JSON body without boolean accepted; redacted]' };
}
export function createZohoFlowClient(env = name => process.env[name], fetcher = fetch) {
  return {
    async sync(row, recordDiagnostic = () => {}) {
      const { webhookUrl } = getZohoFlowConfig(env);
      const signal = AbortSignal.timeout(5000);
      let diagnostic;
      try {
        const response = await fetcher(webhookUrl, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(mapFlowPayload(row)), redirect: 'error', signal,
        });
        diagnostic = responseDiagnostics(response);
        const { accepted, summary } = summarizeBody(await response.text());
        diagnostic.body = summary;
        if (!response.ok) {
          const code = response.status >= 500 ? 'server_error' : response.status >= 400 ? 'client_error' : 'unexpected_status';
          throw new FlowError(code, response.status);
        }
        if (accepted !== true) throw new FlowError('acknowledgement', response.status);
      } catch (error) {
        if (error instanceof FlowError) throw error;
        throw new FlowError(signal.aborted || error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'timeout' : 'network');
      } finally {
        // Diagnostic sink failures must never turn an acknowledged delivery into a retry.
        if (diagnostic) { try { recordDiagnostic(diagnostic); } catch { /* best effort */ } }
      }
    },
  };
}
export async function syncFlowEnquiry(store, flow, id, logger = console, { retry = false } = {}) {
  const row = await store.claim(id, { retry });
  if (!row) return false;
  let diagnostic;
  try {
    await flow.sync(row, value => {
      diagnostic = value;
      try { logger.info?.('zoho_flow_response', { enquiry_id: String(id), ...value }); } catch { /* best effort */ }
    });
    await store.update(id, { zohoSyncStatus: 'synced', zohoSyncedAt: new Date().toISOString(), zohoSyncError: null, zohoFlowResponse: diagnostic ?? null });
    return true;
  } catch (error) {
    const reason = error instanceof FlowError ? error.message : messages.unexpected;
    const status = error instanceof FlowError && ['configuration', 'client_error'].includes(error.code) ? 'failed' : 'needs_reconciliation';
    logger.error('zoho_flow_sync_failed', { enquiry_id: String(id), reason, status, ...(diagnostic ? { response: diagnostic } : {}) });
    try { await store.update(id, { zohoSyncStatus: status, zohoSyncError: reason, zohoFlowResponse: diagnostic ?? null }); }
    catch { logger.error('zoho_flow_status_write_failed', { enquiry_id: String(id) }); }
    return false;
  }
}
