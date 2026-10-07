import { ZOHO_FIELDS, ZOHO_DEFAULTS, ZOHO_DUPLICATE_FIELDS, whatsappFieldMap, SyncError } from '../config/zoho.js';
import { getZohoConfig } from '../config/env.js';

export { SyncError, normalizeZohoBaseUrl } from '../config/zoho.js';
const safeCodes = new Set(['INVALID_DATA', 'MANDATORY_NOT_FOUND', 'DUPLICATE_DATA', 'OAUTH_SCOPE_MISMATCH', 'NO_PERMISSION', 'INVALID_TOKEN', 'AUTHENTICATION_FAILURE', 'INVALID_MODULE', 'LIMIT_EXCEEDED', 'invalid_client', 'invalid_client_secret', 'invalid_code', 'invalid_grant', 'invalid_token']);

export function safeSyncError(error) {
  return error instanceof SyncError ? error.message : 'CRM synchronization failed; retry required.';
}

export function mapLead(row, existing = false) {
  const data = existing ? {} : { ...ZOHO_DEFAULTS };
  for (const [source, target] of Object.entries(ZOHO_FIELDS)) {
    // Do not clear existing CRM values with omitted optional form fields.
    if (target && row[source]) data[target] = row[source];
  }
  data[ZOHO_FIELDS.message] = [
    `Service: ${row.service}`,
    row.message,
    ...Object.entries(ZOHO_FIELDS).filter(([source, target]) => !target && row[source] && source !== 'service').map(([source]) => `${source}: ${row[source]}`),
  ].filter(Boolean).join('\n');
  return data;
}

export function createZohoClient(env, fetcher = fetch) {
  function base(name) {
    const config = getZohoConfig(env);
    return name === 'ZOHO_ACCOUNTS_URL' ? config.accountsUrl : config.apiBaseUrl;
  }
  async function request(url, init, stage) {
    let response;
    try { response = await fetcher(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(5000) }); }
    catch { throw new SyncError(`CRM ${stage} request failed or timed out.`); }
    if (response.status === 204 && response.ok) return null;
    let body;
    try { body = await response.json(); } catch { throw new SyncError(`CRM ${stage} returned an invalid response.`); }
    if (!response.ok || body.error || body.code) {
      const code = safeCodes.has(body.code) ? ` (${body.code})` : safeCodes.has(body.error) ? ` (${body.error})` : '';
      throw new SyncError(`CRM ${stage} failed: HTTP ${response.status}${code}.`);
    }
    return body;
  }
  let cachedToken;
  let expiresAt = 0;
  let tokenPromise;
  async function refreshToken() {
    // Validate all server settings before transmitting credentials to OAuth.
    const config = getZohoConfig(env);
    const body = await request(`${base('ZOHO_ACCOUNTS_URL')}/oauth/v2/token`, {
      method: 'POST',
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: config.clientId, client_secret: config.clientSecret, refresh_token: config.refreshToken }),
    }, 'authentication');
    if (!body?.access_token) throw new SyncError('CRM authentication did not return an access token.');
    cachedToken = body.access_token;
    expiresAt = Date.now() + Math.max(0, (Number(body.expires_in) || 3600) - 60) * 1000;
    return cachedToken;
  }
  async function getZohoAccessToken() {
    if (cachedToken && Date.now() < expiresAt) return cachedToken;
    tokenPromise ??= refreshToken().finally(() => { tokenPromise = undefined; });
    return tokenPromise;
  }
  return {
    getZohoAccessToken,
    async updateWhatsAppMetadata(row) {
      // Updates only an already mapped lead. Never searches, upserts, or creates leads.
      if (!row.zohoLeadId) return false;
      if (!/^\d+$/.test(row.zohoLeadId)) throw new SyncError('Stored CRM record ID is invalid.');
      const data = {};
      for (const [source, target] of Object.entries(whatsappFieldMap(env))) {
        if (!target || row[source] == null) continue;
        if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(target)) throw new SyncError('CRM field configuration is invalid.');
        data[target] = row[source];
      }
      if (!Object.keys(data).length) return false;
      const module = env('ZOHO_LEADS_MODULE') || 'Leads';
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(module)) throw new SyncError('CRM module configuration is invalid.');
      const token = await getZohoAccessToken();
      const result = await request(`${base('ZOHO_API_BASE_URL')}/crm/v8/${module}/${row.zohoLeadId}`, {
        method: 'PUT', headers: { Authorization: `Zoho-oauthtoken ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: [data] }),
      }, 'WhatsApp metadata update');
      if (result?.data?.[0]?.status !== 'success') throw new SyncError('CRM rejected WhatsApp metadata.');
      return true;
    },
    async sync(row) {
      const accessToken = await getZohoAccessToken();
      const module = env('ZOHO_LEADS_MODULE') || 'Leads';
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(module)) throw new SyncError('CRM module configuration is invalid.');
      const root = `${base('ZOHO_API_BASE_URL')}/crm/v8/${module}`;
      const headers = { Authorization: `Zoho-oauthtoken ${accessToken}`, 'Content-Type': 'application/json' };
      let id = row.zohoLeadId;
      if (id && !/^\d+$/.test(id)) throw new SyncError('Stored CRM record ID is invalid.');
      for (const [parameter, value, field] of [['phone', row.phone, ZOHO_FIELDS.phone], ['email', row.email, ZOHO_FIELDS.email]]) {
        if (id || !value || !field) continue;
        const result = await request(`${root}/search?${new URLSearchParams({ [parameter]: value })}`, { headers }, 'lookup');
        if (result && !Array.isArray(result.data)) throw new SyncError('CRM lookup returned an invalid response.');
        const matches = (result?.data ?? []).filter(lead => parameter === 'phone'
          ? [lead[field], lead.Phone].some(phone => String(phone ?? '').replace(/[\s().-]/g, '').replace(/^00/, '+').replace(/^\+/, '') === value.replace(/^\+/, ''))
          : String(lead[field] ?? '').toLowerCase() === value.toLowerCase());
        if (matches.length > 1 || result?.info?.more_records) throw new SyncError('CRM lookup is ambiguous; administrator review required.');
        id = matches[0]?.id;
        if (id && !/^\d+$/.test(id)) throw new SyncError('CRM lookup returned an invalid record ID.');
      }
      const payload = id
        ? { data: [mapLead(row, true)] }
        : { data: [mapLead(row)], duplicate_check_fields: ZOHO_DUPLICATE_FIELDS.filter(Boolean) };
      const result = await request(id ? `${root}/${id}` : `${root}/upsert`, {
        method: id ? 'PUT' : 'POST', headers, body: JSON.stringify(payload),
      }, 'write');
      const record = result?.data?.[0];
      if (record?.status !== 'success' || !/^\d+$/.test(record?.details?.id ?? '')) {
        const code = safeCodes.has(record?.code) ? ` (${record.code})` : '';
        throw new SyncError(`CRM rejected the lead${code}.`);
      }
      return record.details.id;
    },
  };
}

// Reusable by a future authorized worker. Claim prevents two workers syncing one row.
export async function syncEnquiry(store, zoho, id, logger = console) {
  const row = await store.claim(id);
  if (!row) return false;
  let leadId = row.zohoLeadId;
  try {
    leadId = await zoho.sync(row);
    await store.update(id, { zohoSyncStatus: 'synced', zohoLeadId: leadId, zohoSyncedAt: new Date().toISOString(), zohoSyncError: null });
    return true;
  } catch (error) {
    const message = safeSyncError(error);
    logger.error('zoho_sync_failed', { enquiry_id: id, reason: message });
    try {
      await store.update(id, { zohoSyncStatus: 'failed', zohoLeadId: leadId, zohoSyncError: message });
    } catch {
      logger.error('zoho_sync_status_write_failed', { enquiry_id: id });
    }
    return false;
  }
}
