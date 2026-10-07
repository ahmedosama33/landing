import { useRef, useState } from 'react';
import { SERVICES, validateEnquiry, buildWhatsAppUrl } from '../../shared/enquiry.js';
import Reveal from './Reveal.jsx';
import { trackWhatsAppStarted } from '../lib/whatsapp.js';
import FieldIcon from './FieldIcon.jsx';

export default function ContactForm() {
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(null);
  const submission = useRef(null);
  const submitting = useRef(false);
  const whatsappUrl = buildWhatsAppUrl(import.meta.env.VITE_CLINIC_WHATSAPP_NUMBER ?? '', submitted);

  async function submit(event) {
    event.preventDefault();
    if (submitting.current) return;
    const data = Object.fromEntries(new FormData(event.currentTarget));
    data.consent = data.consent === 'on';
    const page = new URL(window.location.href);
    for (const [field, query] of Object.entries({ utmSource: 'utm_source', utmMedium: 'utm_medium', utmCampaign: 'utm_campaign', utmContent: 'utm_content', utmTerm: 'utm_term' })) data[field] = page.searchParams.get(query) ?? '';
    data.landingPage = page.origin + page.pathname;
    data.referrer = document.referrer;
    let payload;
    try { payload = { ...validateEnquiry(data), company_website: data.company_website }; }
    catch (failure) {
      if (import.meta.env.DEV) console.info('[enquiry] client validation failed', { reason: failure.code || 'invalid_input', requestSent: false });
      setError(failure.message);
      return;
    }
    const body = JSON.stringify(payload);
    if (submission.current?.body !== body) submission.current = { body, key: crypto.randomUUID() };
    submitting.current = true;
    setStatus('submitting');
    setError('');
    try {
      const response = await fetch('/api/enquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': submission.current.key },
        body,
      });
      const result = await response.json();
      if (!response.ok || result.success !== true) {
        if (response.status === 409) submission.current = null;
        throw new Error(result.message || 'We could not submit your enquiry. Please try again.');
      }
      setSubmitted({ fullName: payload.fullName, service: payload.service, enquiryId: result.enquiryId, key: submission.current.key });
      setStatus('success');
    } catch (failure) {
      setError(failure instanceof TypeError || failure instanceof SyntaxError
        ? 'We could not confirm your enquiry. Check your connection and try again.'
        : failure.message);
      setStatus('idle');
    } finally { submitting.current = false; }
  }

  return (
    <Reveal as="section" id="enquiry" className="delay-150 focus-within:shadow-[0_24px_80px_#9271301c] relative min-w-0 rounded-[32px] border border-[#e4dac3] bg-linear-to-br from-white via-[#fffefa] to-[#faf5e9] px-9 pt-8 pb-[26px] shadow-[0_20px_65px_#79602b12] max-[1100px]:p-7 max-[480px]:px-5 max-[480px]:pt-[26px] max-[480px]:pb-[22px]" aria-labelledby="enquiry-title">
      <div className="mb-[11px] flex items-center justify-between"><span className="text-[9px] font-semibold tracking-[2px] text-[#95815a]">YOUR NEXT CHAPTER</span><span className="inline-block transition-transform duration-700 hover:rotate-180 motion-reduce:hover:rotate-0 text-[25px] leading-none text-[#ac8d4a]" aria-hidden="true"><FieldIcon name="serum" className="size-6" /></span></div>
      <h2 className="font-['Cormorant_Garamond',Georgia,serif] text-[38px] leading-[1.2] font-medium tracking-[-1px] max-[480px]:text-[34px]" id="enquiry-title">Let’s start with you.</h2>
      {status === 'success' ? (
        <Reveal className="grid gap-6 py-[35px]" role="status">
          <span className="grid size-[50px] place-items-center rounded-full border border-[#b8a06f] bg-[#f5f0e4] text-[22px] text-[#8b7039]" aria-hidden="true">✓</span>
          <h3 className="font-['Cormorant_Garamond',Georgia,serif] text-3xl font-medium">Thank You<br />Your enquiry has been received.</h3>
          <p className="text-[13px] leading-[1.8] text-[#74736a]">Our team will contact you shortly. You can also continue directly on WhatsApp.</p>
          {whatsappUrl && <a className="group relative overflow-hidden before:pointer-events-none before:absolute before:inset-y-0 before:-left-1/2 before:w-1/3 before:skew-x-[-20deg] before:bg-white/10 before:transition-transform before:duration-700 motion-safe:hover:before:translate-x-[500%] motion-safe:active:scale-[0.985] flex w-full cursor-pointer items-center justify-between rounded-2xl border border-[#292923] bg-linear-to-r from-[#292923] to-[#494331] shadow-[0_6px_16px_#29292318] px-[19px] py-4 text-xs font-medium tracking-[.3px] text-[#fcfaf4] no-underline transition duration-200 motion-safe:hover:-translate-y-0.5 hover:bg-[#414035] disabled:translate-y-0 disabled:cursor-wait disabled:opacity-65 [&>span:last-child]:transition-transform [&>span:last-child]:duration-300 motion-safe:hover:[&>span:last-child]:translate-x-0.5 motion-safe:hover:[&>span:last-child]:-translate-y-0.5 [&>span:last-child]:text-[19px] [&>span:last-child]:leading-none [&>span:last-child]:text-[#d4b573]" href={whatsappUrl} onClick={() => trackWhatsAppStarted(submitted)} target="_blank" rel="noopener noreferrer">Continue on WhatsApp</a>}
        </Reveal>
      ) : (
        <form onSubmit={submit} aria-busy={status === 'submitting'}>
          <p className="mt-[9px] text-xs leading-[1.7] text-[#74736a]">A few details, and we’ll take it from here.</p>
          <fieldset className="mt-[23px] grid min-w-0 gap-5 border-0 border-t border-[#ece7dc] pt-[23px]" disabled={status === 'submitting'}>
            <div className="grid grid-cols-2 gap-4 max-[480px]:grid-cols-1 max-[480px]:gap-5">
              <label className="grid min-w-0 gap-2 text-xs font-medium text-[#48463e]"><span className="flex items-center gap-2"><FieldIcon name="person" className="size-4 shrink-0 text-[#ad9056]" />Full name <b className="font-normal text-[#977537]">*</b></span><input className="h-12 w-full min-w-0 rounded-2xl border border-[#e6e2d7] bg-white/80 px-[13px] py-3 text-xs text-[#24241f] transition duration-300 hover:border-[#c8b78f] placeholder:font-normal placeholder:text-[#a09b8e] placeholder:opacity-100 focus:border-[#ad8b46] focus:bg-[#fffefa] focus:shadow-[0_0_0_3px_#b99b5c14] focus:outline-none max-[480px]:text-base max-[480px]:placeholder:text-xs" name="fullName" placeholder="Your full name" autoComplete="name" required minLength={2} maxLength={80} /></label>
              <label className="grid min-w-0 gap-2 text-xs font-medium text-[#48463e]"><span className="flex items-center gap-2"><FieldIcon name="phone" className="size-4 shrink-0 text-[#ad9056]" />Mobile / WhatsApp Number <b className="font-normal text-[#977537]">*</b></span><input className="h-12 w-full min-w-0 rounded-2xl border border-[#e6e2d7] bg-white/80 px-[13px] py-3 text-xs text-[#24241f] transition duration-300 hover:border-[#c8b78f] placeholder:font-normal placeholder:text-[#a09b8e] placeholder:opacity-100 focus:border-[#ad8b46] focus:bg-[#fffefa] focus:shadow-[0_0_0_3px_#b99b5c14] focus:outline-none max-[480px]:text-base max-[480px]:placeholder:text-xs" name="phone" type="tel" autoComplete="tel" placeholder="+971 50 123 4567" required maxLength={40} aria-describedby="phone-help" /></label>
            </div>
            <small id="phone-help" className="-mt-2.5 text-[9px] leading-normal text-[#8a8478]">UAE numbers use +971, without the leading 0. Other country codes are welcome.</small>
            <label className="grid min-w-0 gap-2 text-xs font-medium text-[#48463e]"><span className="flex items-center gap-2"><FieldIcon name="email" className="size-4 shrink-0 text-[#ad9056]" />Email address <small className="ml-[5px] text-[9px] font-normal text-[#918b7d]">Optional</small></span><input className="h-12 w-full min-w-0 rounded-2xl border border-[#e6e2d7] bg-white/80 px-[13px] py-3 text-xs text-[#24241f] transition duration-300 hover:border-[#c8b78f] placeholder:font-normal placeholder:text-[#a09b8e] placeholder:opacity-100 focus:border-[#ad8b46] focus:bg-[#fffefa] focus:shadow-[0_0_0_3px_#b99b5c14] focus:outline-none max-[480px]:text-base max-[480px]:placeholder:text-xs" name="email" placeholder="you@example.com" type="email" autoComplete="email" maxLength={254} /></label>
            <label className="grid min-w-0 gap-2 text-xs font-medium text-[#48463e]">
              <span className="flex items-center gap-2"><FieldIcon name="serum" className="size-4 shrink-0 text-[#ad9056]" />Service Interested In <b className="font-normal text-[#977537]">*</b></span>
              <select className="h-12 w-full min-w-0 rounded-2xl border border-[#e6e2d7] bg-white/80 px-[13px] py-2 text-xs text-[#24241f] transition duration-300 hover:border-[#c8b78f] invalid:text-[#a09b8e] focus:border-[#ad8b46] focus:bg-[#fffefa] focus:shadow-[0_0_0_3px_#b99b5c14] focus:outline-none max-[480px]:text-base" name="service" defaultValue="" required>
                <option value="" disabled>Select a service</option>
                {SERVICES.map(service => (
                  <option key={service} value={service} className="text-[#24241f]">{service}</option>
                ))}
              </select>
            </label>
            <label className="grid min-w-0 gap-2 text-xs font-medium text-[#48463e]"><span>Message / Enquiry <small className="ml-[5px] text-[9px] font-normal text-[#918b7d]">Optional</small></span><textarea className="h-[78px] min-h-[78px] resize-y leading-[1.6] w-full min-w-0 rounded-2xl border border-[#e6e2d7] bg-white/80 px-[13px] py-3 text-xs text-[#24241f] transition duration-300 hover:border-[#c8b78f] placeholder:font-normal placeholder:text-[#a09b8e] placeholder:opacity-100 focus:border-[#ad8b46] focus:bg-[#fffefa] focus:shadow-[0_0_0_3px_#b99b5c14] focus:outline-none max-[480px]:text-base max-[480px]:placeholder:text-xs" name="message" placeholder="Your questions, goals, or a little more about you…" rows={3} maxLength={2000} /></label>
            <div hidden aria-hidden="true"><label className="grid min-w-0 gap-2 text-xs font-medium text-[#48463e]">Website<input className="h-12 w-full min-w-0 rounded-2xl border border-[#e6e2d7] bg-white/80 px-[13px] py-3 text-xs text-[#24241f] transition duration-300 hover:border-[#c8b78f] placeholder:font-normal placeholder:text-[#a09b8e] placeholder:opacity-100 focus:border-[#ad8b46] focus:bg-[#fffefa] focus:shadow-[0_0_0_3px_#b99b5c14] focus:outline-none max-[480px]:text-base max-[480px]:placeholder:text-xs" name="company_website" type="text" tabIndex={-1} autoComplete="off" data-lpignore="true" data-1p-ignore="true" /></label></div>
            <label className="flex items-start gap-2 text-[11px] leading-relaxed text-[#74736a]"><input type="checkbox" name="consent" required className="mt-0.5 accent-[#927130]" /><span>I agree to Royal Model Modern Clinic contacting me about my enquiry.</span></label>
            {error && <Reveal as="p" className="rounded-xl border-l-2 border-[#ba6254] bg-[#fbefeb] p-3 text-xs leading-[1.6] text-[#a43830]" role="alert">{error}</Reveal>}
            <button className="group relative overflow-hidden before:pointer-events-none before:absolute before:inset-y-0 before:-left-1/2 before:w-1/3 before:skew-x-[-20deg] before:bg-white/10 before:transition-transform before:duration-700 motion-safe:hover:before:translate-x-[500%] motion-safe:active:scale-[0.985] flex w-full cursor-pointer items-center justify-between rounded-2xl border border-[#292923] bg-linear-to-r from-[#292923] to-[#494331] shadow-[0_6px_16px_#29292318] px-[19px] py-4 text-xs font-medium tracking-[.3px] text-[#fcfaf4] no-underline transition duration-200 motion-safe:hover:-translate-y-0.5 hover:bg-[#414035] disabled:translate-y-0 disabled:cursor-wait disabled:opacity-65 [&>span:last-child]:transition-transform [&>span:last-child]:duration-300 motion-safe:hover:[&>span:last-child]:translate-x-0.5 motion-safe:hover:[&>span:last-child]:-translate-y-0.5 [&>span:last-child]:text-[19px] [&>span:last-child]:leading-none [&>span:last-child]:text-[#d4b573]" type="submit"><span className="flex items-center gap-2">{status === 'submitting' && <span className="size-3.5 rounded-full border-2 border-white/30 border-t-white motion-safe:animate-spin" aria-hidden="true" />}{status === 'submitting' ? 'Sending your enquiry…' : 'Send my enquiry'}</span><span aria-hidden="true">↗</span></button>
            <p className="-mt-1.5 text-center text-[9px] leading-normal text-[#8a8478]">We’ll use these details to respond to your enquiry.</p>
          </fieldset>
        </form>
      )}
      <div className="mt-5 flex flex-wrap justify-center gap-x-5 gap-y-2 text-[11px] text-[#78602e]"><a href="tel:0559988250" className="underline underline-offset-4">Call: 0559988250</a><a href="tel:043389909" className="underline underline-offset-4">Landline: 043389909</a></div>
    </Reveal>
  );
}
