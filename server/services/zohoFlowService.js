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
    'referrer', 'utmSource', 'utmMedium', 'utmCampaign', 'utmContent', 'utmTerm']) {
    payload[key] = row[key] ?? (key === 'consent' ? false : '');
  }
  payload.createdAt = new Date(row.createdAt).toISOString();
  return payload;
}
export function createZohoFlowClient(env = name => process.env[name], fetcher = fetch) {
  return {
    async sync(row) {
      const { webhookUrl } = getZohoFlowConfig(env);
      const signal = AbortSignal.timeout(5000);
      try {
        const response = await fetcher(webhookUrl, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(mapFlowPayload(row)), redirect: 'error', signal,
        });
        if (response.status !== 200) {
          const code = response.status >= 500 ? 'server_error' : response.status >= 400 ? 'client_error' : 'unexpected_status';
          throw new FlowError(code, response.status);
        }
        // Required configured acknowledgement; see README. Never accept arbitrary 2xx.
        let body;
        try { body = await response.json(); }
        catch { throw new FlowError(signal.aborted ? 'timeout' : 'acknowledgement'); }
        if (body?.accepted !== true) throw new FlowError('acknowledgement');
      } catch (error) {
        if (error instanceof FlowError) throw error;
        throw new FlowError(signal.aborted || error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'timeout' : 'network');
      }
    },
  };
}
export async function syncFlowEnquiry(store, flow, id, logger = console, { retry = false } = {}) {
  const row = await store.claim(id, { retry });
  if (!row) return false;
  try {
    await flow.sync(row);
    await store.update(id, { zohoSyncStatus: 'synced', zohoSyncedAt: new Date().toISOString(), zohoSyncError: null });
    return true;
  } catch (error) {
    const reason = error instanceof FlowError ? error.message : messages.unexpected;
    logger.error('zoho_flow_sync_failed', { enquiry_id: String(id), reason });
    try { await store.update(id, { zohoSyncStatus: 'failed', zohoSyncError: reason }); }
    catch { logger.error('zoho_flow_status_write_failed', { enquiry_id: String(id) }); }
    return false;
  }
}
