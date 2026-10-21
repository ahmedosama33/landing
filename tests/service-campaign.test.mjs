import assert from 'node:assert/strict';
import test from 'node:test';
import { getServiceCampaign } from '../src/lib/serviceCampaign.js';
import { SERVICES, LEGACY_SERVICES, validateEnquiry } from '../shared/enquiry.js';
import Enquiry from '../server/models/Enquiry.js';

// Source of truth: "Royal Model - Landing Page Brief", section 1.
const BRIEF = {
  fillers: ['Dermal Fillers 1ml – 599 AED', 'European filler · Free consultation · Al Wasl Road, Dubai'],
  antiwrinkle: ['Anti-Wrinkle Treatment, Full Face – 599 AED', 'Free consultation · Licensed medical center'],
  'laser-women': ['Full-Body Laser Hair Removal – 3 Sessions 699 AED', 'Was 1,200 AED · Candela GentleMax Pro & Cynosure Elite+'],
  'laser-men': ["Men's Laser – 3 Beard + 3 Underarm Sessions 399 AED", 'Candela GentleMax Pro & Cynosure Elite+'],
  lipo: ['Liposuction & Body Contouring', 'Free consultation with our surgeon'],
  mommy: ['Mommy Makeover & Tummy Tuck', 'Free consultation with our surgeon'],
};

test('every service value yields the brief headline and subline', () => {
  for (const [key, [headline, subline]] of Object.entries(BRIEF)) {
    const campaign = getServiceCampaign(`?service=${encodeURIComponent(key)}`);
    assert.equal(campaign?.key, key);
    assert.equal(campaign.headline, headline);
    assert.equal(campaign.subline, subline);
  }
});

test('each campaign pre-selects a real dropdown option and each laser audience has its own', () => {
  const options = Object.keys(BRIEF).map(key => getServiceCampaign(`?service=${key}`).option);
  for (const option of options) assert.ok(SERVICES.includes(option), option);
  assert.equal(new Set(options).size, options.length, 'every campaign maps to a distinct option');
  assert.ok(!SERVICES.includes('Laser'));
});

test('existing services are kept; Laser is replaced by Women and Men', () => {
  for (const kept of ['Plastic Surgery', 'Dermatology', 'Skin Care', 'Cosmetics', 'Slimming', 'Other']) assert.ok(SERVICES.includes(kept), kept);
  assert.ok(SERVICES.includes('Laser - Women') && SERVICES.includes('Laser - Men'));
  assert.equal(SERVICES.at(-1), 'Other');
});

test('missing, unknown, empty and prototype-key values leave the page unchanged', () => {
  for (const search of ['', '?', '?utm_source=google&gclid=abc', '?service=', '?service=unknown', '?service=FILLERS',
    '?service=constructor', '?service=__proto__', '?service=toString', '?service=<script>alert(1)</script>']) {
    assert.equal(getServiceCampaign(search), null, search);
  }
});

test('campaign still resolves alongside UTMs and gclid', () => {
  assert.equal(getServiceCampaign('?utm_source=google&gclid=abc123&service=lipo&utm_campaign=x')?.key, 'lipo');
});

test('every option validates on submit; retired Laser is refused on new enquiries but valid for stored ones', async () => {
  const base = { fullName: 'Test Patient', phone: '+971501234567', email: '', message: '', consent: true };
  for (const service of SERVICES) assert.equal(validateEnquiry({ ...base, service }).service, service);
  assert.throws(() => validateEnquiry({ ...base, service: 'Laser' }));
  assert.deepEqual(LEGACY_SERVICES, ['Laser']);
  const legacy = new Enquiry({ ...validateEnquiry({ ...base, service: 'Other' }), service: 'Laser' });
  assert.equal(legacy.validateSync()?.errors?.service, undefined);
});
