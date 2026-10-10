import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { AD_ATTRIBUTION_FIELDS, validAttributionId } from './attribution.js';

export const SERVICES = ['Plastic Surgery', 'Dermatology', 'Laser', 'Skin Care', 'Cosmetics', 'Slimming', 'Other'];

export class ValidationError extends Error {
  constructor(message, code = 'invalid_input') {
    super(message);
    this.code = code;
  }
}

function clean(value, field, max, required = false) {
  if (value == null && !required) return '';
  if (typeof value !== 'string') throw new ValidationError(`Invalid ${field}.`);
  // eslint-disable-next-line no-control-regex
  const result = value.normalize('NFKC').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f<>]/g, '').trim();
  if ((required && !result) || result.length > max) throw new ValidationError(`Invalid ${field}.`);
  return result;
}

export function normalizePhone(value) {
  let phone = clean(value, 'phone', 40, true).replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 0x6f0)).replace(/[\s().-]/g, '').replace(/^00/, '+');
  // Explicit Egyptian national input support; other countries still require +/00.
  if (/^0\d+$/.test(phone)) {
    const egyptian = parsePhoneNumberFromString(phone, 'EG');
    if (egyptian?.country === 'EG' && egyptian.isValid()) phone = egyptian.number;
  } else if (/^20\d{9,10}$/.test(phone)) {
    const egyptian = parsePhoneNumberFromString('+' + phone);
    if (egyptian?.country === 'EG' && egyptian.isValid()) phone = egyptian.number;
  }
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw new ValidationError('Enter your phone number with its country code.');
  const parsed = parsePhoneNumberFromString(phone);
  if (!parsed || parsed.number !== phone || !parsed.isPossible()) {
    throw new ValidationError('Enter a possible international phone number with its country code.');
  }
  return phone;
}

function pageUrl(value, field) {
  const text = clean(value, field, 2000);
  if (!text) return '';
  let url;
  try { url = new URL(text); } catch { throw new ValidationError(`Invalid ${field}.`); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new ValidationError(`Invalid ${field}.`);
  return url.origin + url.pathname;
}

export function validateEnquiry(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new ValidationError('Invalid enquiry.');
  if (payload.company_website) throw new ValidationError('Unable to accept this enquiry.', 'honeypot_filled');
  if (payload.consent !== true) throw new ValidationError('Please consent to being contacted about your enquiry.');
  const row = {
    fullName: clean(payload.fullName, 'full name', 80, true),
    phone: normalizePhone(payload.phone),
    email: clean(payload.email, 'email', 254).toLowerCase(),
    service: clean(payload.service, 'service', 50, true),
    message: clean(payload.message, 'message', 2000),
    consent: true,
    landingPage: pageUrl(payload.landingPage, 'landing page'),
    referrer: pageUrl(payload.referrer, 'referrer'),
  };
  if (row.fullName.length < 2) throw new ValidationError('Enter your full name.');
  if (row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) throw new ValidationError('Enter a valid email address.');
  if (!SERVICES.includes(row.service)) throw new ValidationError('Choose a valid service.');
  for (const key of ['utmSource', 'utmMedium', 'utmCampaign', 'utmContent', 'utmTerm']) row[key] = clean(payload[key], key, 255);
  for (const key of AD_ATTRIBUTION_FIELDS) {
    const value = payload[key];
    if (value != null && value !== '' && !validAttributionId(value)) throw new ValidationError(`Invalid ${key}.`);
    row[key] = value || '';
  }
  return row;
}

export function buildWhatsAppUrl(number, enquiry) {
  if (!/^[1-9]\d{7,14}$/.test(number) || !enquiry) return null;
  const message = `Hello Royal Model Modern Clinic,\n\nI would like to request a booking.\n\nName: ${enquiry.fullName}\nEmail: ${enquiry.email || 'Not provided'}\nPhone: ${enquiry.phone || 'Not provided'}\nService: ${enquiry.service}\n\nPlease let me know the available appointments.`;
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}
