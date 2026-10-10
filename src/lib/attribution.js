import { AD_ATTRIBUTION_FIELDS, validAttributionId } from '../../shared/attribution.js';

export const ATTRIBUTION_STORAGE_KEY = 'royalmodel.attribution.v1';
export const ATTRIBUTION_TTL = 90 * 24 * 60 * 60 * 1000;
const utmFields = { utmSource: 'utm_source', utmMedium: 'utm_medium', utmCampaign: 'utm_campaign', utmContent: 'utm_content', utmTerm: 'utm_term' };
const fields = [...Object.keys(utmFields), 'landingPage', 'referrer', ...AD_ATTRIBUTION_FIELDS];

function pageUrl(value) {
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.origin + url.pathname : '';
  } catch { return ''; }
}
function valid(key, value) {
  if (AD_ATTRIBUTION_FIELDS.includes(key)) return validAttributionId(value);
  if (typeof value !== 'string' || !value) return false;
  if (key === 'landingPage' || key === 'referrer') return value.length <= 2000 && pageUrl(value) === value;
  return value.length <= 255 && !/[<>\u0000-\u001f\u007f]/.test(value); // eslint-disable-line no-control-regex
}

export function createAttribution(browser, now = Date.now) {
  let entries = {};
  let consent = browser.royalModelAdvertisingConsent === true;
  function prune() {
    for (const [key, entry] of Object.entries(entries)) {
      if (!fields.includes(key) || !valid(key, entry?.value) || !Number.isFinite(entry?.at)
        || entry.at > now() || now() - entry.at >= ATTRIBUTION_TTL) delete entries[key];
    }
  }
  function put(key, value) {
    if (valid(key, value) && entries[key]?.value !== value) entries[key] = { value, at: now() };
  }
  function persist() {
    if (consent) { try { browser.localStorage.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify(entries)); } catch { /* memory fallback */ } }
  }
  function restore() {
    try {
      const saved = JSON.parse(browser.localStorage.getItem(ATTRIBUTION_STORAGE_KEY));
      if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
        entries = { ...saved, ...entries };
      }
    } catch { /* blocked or corrupt storage */ }
    prune();
  }
  function cookies() {
    if (!consent) return;
    try {
      for (const part of browser.document.cookie.split(';')) {
        const [name, ...value] = part.trim().split('=');
        if (name === '_fbp' || name === '_fbc') {
          try { put(name.slice(1), decodeURIComponent(value.join('='))); } catch { /* malformed cookie */ }
        }
      }
    } catch { /* cookies unavailable */ }
  }
  function capture() {
    prune();
    const url = new URL(browser.location.href);
    for (const [key, query] of Object.entries(utmFields)) put(key, url.searchParams.get(query));
    if (consent) {
      for (const key of ['gclid', 'gbraid', 'wbraid', 'fbclid']) put(key, url.searchParams.get(key));
    }
    put('landingPage', pageUrl(url.href));
    put('referrer', pageUrl(browser.document.referrer));
    cookies();
    persist();
  }
  function setConsent(granted) {
    consent = granted === true;
    browser.royalModelAdvertisingConsent = consent;
    if (consent) { restore(); capture(); }
    else {
      for (const key of AD_ATTRIBUTION_FIELDS) delete entries[key];
      try { browser.localStorage.removeItem(ATTRIBUTION_STORAGE_KEY); } catch { /* blocked storage */ }
    }
  }
  if (consent) restore();
  else { try { browser.localStorage.removeItem(ATTRIBUTION_STORAGE_KEY); } catch { /* blocked storage */ } }
  capture();
  return {
    setConsent,
    getPayload() {
      prune(); cookies(); persist();
      return Object.fromEntries(fields.map(key => [key,
        AD_ATTRIBUTION_FIELDS.includes(key) && !consent ? '' : entries[key]?.value || '',
      ]));
    },
  };
}

let attribution;
export function initializeAttribution(browser = window) {
  if (attribution) return;
  attribution = createAttribution(browser);
  // Contact-form consent is unrelated. Ignore malformed external events.
  browser.addEventListener('royalmodel:advertising-consent', event => {
    if (typeof event.detail === 'boolean') attribution.setConsent(event.detail);
  });
}
export function getEnquiryAttribution() {
  initializeAttribution();
  return attribution.getPayload();
}

export function attributionForSubmission(previous, current, allowed) {
  const result = { ...(previous || current) };
  if (!allowed) for (const key of AD_ATTRIBUTION_FIELDS) result[key] = '';
  return result;
}
