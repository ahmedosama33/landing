// Whitelist only: the raw query value is never rendered, only used as a lookup key.
// `option` must be one of SERVICES in shared/enquiry.js.
const CAMPAIGNS = {
  fillers: { option: 'Dermal Fillers', headline: 'Dermal Fillers 1ml – 599 AED', subline: 'European filler · Free consultation · Al Wasl Road, Dubai' },
  antiwrinkle: { option: 'Anti-Wrinkle Treatment', headline: 'Anti-Wrinkle Treatment, Full Face – 599 AED', subline: 'Free consultation · Licensed medical center' },
  'laser-women': { option: 'Laser - Women', headline: 'Full-Body Laser Hair Removal – 3 Sessions 699 AED', subline: 'Was 1,200 AED · Candela GentleMax Pro & Cynosure Elite+' },
  'laser-men': { option: 'Laser - Men', headline: "Men's Laser – 3 Beard + 3 Underarm Sessions 399 AED", subline: 'Candela GentleMax Pro & Cynosure Elite+' },
  lipo: { option: 'Liposuction & Body Contouring', headline: 'Liposuction & Body Contouring', subline: 'Free consultation with our surgeon' },
  mommy: { option: 'Mommy Makeover & Tummy Tuck', headline: 'Mommy Makeover & Tummy Tuck', subline: 'Free consultation with our surgeon' },
};

export function getServiceCampaign(search = typeof window === 'undefined' ? '' : window.location.search) {
  const key = new URLSearchParams(search).get('service');
  if (!key || !Object.hasOwn(CAMPAIGNS, key)) return null;
  return { key, ...CAMPAIGNS[key] };
}
