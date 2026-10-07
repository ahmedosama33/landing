import { normalizeZohoBaseUrl, SyncError } from './zoho.js';
import { readBotspaceConfig } from './botspace.js';

const runtimeEnv = name => process.env[name];
export class ConfigurationError extends Error {}

// All validation is on demand: importing the app/serving health needs no secrets.
export function getMongoConfig(env = runtimeEnv) {
  const uri = env('MONGODB_URI')?.trim();
  if (!uri) throw new ConfigurationError('Database configuration missing: MONGODB_URI.');
  if (!/^mongodb(?:\+srv)?:\/\/[^\s]+$/.test(uri)) throw new ConfigurationError('Database configuration invalid: MONGODB_URI.');
  return { uri };
}

export function getZohoConfig(env = runtimeEnv) {
  const required = name => {
    const value = env(name)?.trim();
    if (!value) throw new SyncError(`CRM configuration is incomplete: ${name}.`);
    return value;
  };
  return {
    clientId: required('ZOHO_CLIENT_ID'), clientSecret: required('ZOHO_CLIENT_SECRET'),
    refreshToken: required('ZOHO_REFRESH_TOKEN'),
    accountsUrl: normalizeZohoBaseUrl('ZOHO_ACCOUNTS_URL', env('ZOHO_ACCOUNTS_URL')),
    apiBaseUrl: normalizeZohoBaseUrl('ZOHO_API_BASE_URL', env('ZOHO_API_BASE_URL')),
  };
}

// Reuse the established provider validator rather than maintaining another one.
export function getBotspaceConfig(env = runtimeEnv) {
  return readBotspaceConfig(env);
}

export function getAllowedOrigin(env = runtimeEnv) {
  const value = env('ALLOWED_ORIGIN')?.trim();
  if (!value) return undefined;
  let url;
  try { url = new URL(value); } catch { throw new ConfigurationError('ALLOWED_ORIGIN must be an exact origin.'); }
  if (!['https:', 'http:'].includes(url.protocol) || (env('NODE_ENV') === 'production' && url.protocol !== 'https:')
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new ConfigurationError('ALLOWED_ORIGIN must be an exact HTTPS origin in production.');
  }
  return url.origin;
}
