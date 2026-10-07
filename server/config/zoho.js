// Standard API names. Confirm all mappings against your account's CRM metadata.
// Custom fields deliberately remain disabled until their actual API names are supplied.
export const ZOHO_FIELDS = Object.freeze({
  fullName: 'Last_Name', phone: 'Mobile', email: 'Email', message: 'Description',
  service: process.env.ZOHO_FIELD_SERVICE || null,
  utmSource: process.env.ZOHO_FIELD_UTM_SOURCE || null,
  utmMedium: process.env.ZOHO_FIELD_UTM_MEDIUM || null,
  utmCampaign: process.env.ZOHO_FIELD_UTM_CAMPAIGN || null,
  utmContent: process.env.ZOHO_FIELD_UTM_CONTENT || null,
  utmTerm: process.env.ZOHO_FIELD_UTM_TERM || null,
  landingPage: process.env.ZOHO_FIELD_LANDING_PAGE || null,
  referrer: process.env.ZOHO_FIELD_REFERRER || null,
});
export const ZOHO_DEFAULTS = Object.freeze({ Lead_Source: 'Website',
  ...(process.env.ZOHO_LEAD_STATUS ? { Lead_Status: process.env.ZOHO_LEAD_STATUS } : {}),
});
// Mobile must be configured as a unique field in Zoho for race-safe upserts.
export const ZOHO_DUPLICATE_FIELDS = ['Mobile', 'Email'];

// Separate from lead/Description mapping: never send unconfigured metadata.
export function whatsappFieldMap(env = name => process.env[name]) {
  return {
    whatsappStatus: env('ZOHO_FIELD_WHATSAPP_STATUS'),
    botspaceContactId: env('ZOHO_FIELD_BOTSPACE_CONTACT_ID'),
    botspaceConversationId: env('ZOHO_FIELD_BOTSPACE_CONVERSATION_ID'),
    botspaceLastMessageAt: env('ZOHO_FIELD_LAST_WHATSAPP_MESSAGE_AT'),
    whatsappLastDirection: env('ZOHO_FIELD_LAST_WHATSAPP_DIRECTION'),
  };
}

export class SyncError extends Error {}

export function normalizeZohoBaseUrl(name, value) {
  if (typeof value !== 'string' || !value.trim()) throw new SyncError(`CRM configuration is incomplete: ${name}.`);
  const domains = name === 'ZOHO_ACCOUNTS_URL'
    ? ['accounts.zoho.com', 'accounts.zoho.eu', 'accounts.zoho.in', 'accounts.zoho.com.au', 'accounts.zoho.com.cn', 'accounts.zoho.jp', 'accounts.zohocloud.ca']
    : name === 'ZOHO_API_BASE_URL'
      ? ['www.zohoapis.com', 'www.zohoapis.eu', 'www.zohoapis.in', 'www.zohoapis.com.au', 'www.zohoapis.com.cn', 'www.zohoapis.jp', 'www.zohoapis.ca'] : [];
  let url;
  try { url = new URL(value.trim()); } catch { throw new SyncError(`CRM URL configuration is invalid: ${name}.`); }
  if (url.protocol !== 'https:' || !domains.includes(url.hostname) || url.port || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new SyncError(`CRM URL configuration is invalid: ${name}; use the data-center HTTPS origin without a path.`);
  }
  return url.origin;
}
