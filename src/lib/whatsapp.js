// Best-effort tracking: never await this in the anchor click handler or cancel navigation.
export function trackWhatsAppStarted(enquiry, fetcher = fetch) {
  if (!enquiry?.enquiryId || !enquiry.key) return;
  try {
    void fetcher(`/api/enquiries/${encodeURIComponent(enquiry.enquiryId)}/whatsapp-started`, {
      method: 'POST', headers: { 'Idempotency-Key': enquiry.key }, keepalive: true,
    }).catch(() => {});
  } catch { /* Navigation must also survive synchronous network errors. */ }
}
