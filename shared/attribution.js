export const AD_ATTRIBUTION_FIELDS = ['gclid', 'gbraid', 'wbraid', 'fbclid', 'fbp', 'fbc'];
export const ATTRIBUTION_ID_MAX_LENGTH = 512;

// Identifiers are opaque ASCII tokens, never normalize or manufacture them.
export function validAttributionId(value) {
  return typeof value === 'string' && value.length <= ATTRIBUTION_ID_MAX_LENGTH
    && /^[A-Za-z0-9._~-]+$/.test(value);
}
