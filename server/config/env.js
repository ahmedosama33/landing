export { getZohoConfig } from './zoho.js';
export { getZohoFlowConfig } from '../services/zohoFlowService.js';
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
