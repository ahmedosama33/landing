export function createEnquiryTracker(browser) {
  const sent = new Set();
  return function trackEnquiry(result, ok) {
    // The API returns Mongo ObjectIds. No patient fields or attribution are forwarded.
    if (!ok || result?.success !== true || !/^[a-f0-9]{24}$/i.test(result.enquiryId || '')) return false;
    const id = String(result.enquiryId);
    if (sent.has(id)) return false;
    try {
      browser.dataLayer = browser.dataLayer || [];
      // Also covers module reinitialization while the page's dataLayer is retained.
      if (browser.dataLayer.some?.(entry => entry?.event === 'enquiry_submitted' && entry.enquiry_id === id)) {
        sent.add(id);
        return false;
      }
      sent.add(id);
      browser.dataLayer.push({ event: 'enquiry_submitted', enquiry_id: id });
      return true;
    } catch { return false; } // Analytics must never turn a saved enquiry into a form error.
  };
}

let track;
export function trackEnquirySubmitted(result, ok) {
  track ||= createEnquiryTracker(window);
  return track(result, ok);
}
