import { useEffect, useRef, useState } from 'react';
import { SERVICES, validateEnquiry } from '../../shared/enquiry.js';
import FieldIcon from './FieldIcon.jsx';
import { getEnquiryAttribution } from '../lib/attribution.js';
import { trackEnquirySubmitted } from '../lib/tracking.js';
import tabbyLogo from '../assets/partners/tabby.svg';
import tamaraLogo from '../assets/partners/tamara.png';
import toothpickLogo from '../assets/partners/toothpick.webp';

function ServiceDropdown({ services, value, onChange }) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const root = useRef(null);
  const trigger = useRef(null);
  const listbox = useRef(null);
  const selectedIndex = services.indexOf(value);

  useEffect(() => {
    if (open) listbox.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsidePointer = event => {
      if (!root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [open]);

  function choose(index) {
    onChange(services[index]);
    setOpen(false);
    trigger.current?.focus();
  }

  function handleKeyDown(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) {
        setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
        setOpen(true);
      } else setActiveIndex(index => (index + 1) % services.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setActiveIndex(selectedIndex >= 0 ? selectedIndex : services.length - 1);
        setOpen(true);
      } else setActiveIndex(index => (index - 1 + services.length) % services.length);
    } else if (event.key === 'Home' && open) {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === 'End' && open) {
      event.preventDefault();
      setActiveIndex(services.length - 1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (open) choose(activeIndex);
      else {
        setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
        setOpen(true);
      }
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === 'Tab' && open) {
      setOpen(false);
    }
  }

  return (
    <div className="service-select" ref={root}>
      <input type="hidden" name="service" value={value} readOnly />
      <button
        ref={trigger}
        type="button"
        className="service-select-trigger"
        role="combobox"
        aria-labelledby="service-label service-value"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls="service-options"
        aria-activedescendant={open ? `service-option-${activeIndex}` : undefined}
        aria-required="true"
        onClick={() => {
          setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
          setOpen(isOpen => !isOpen);
        }}
        onKeyDown={handleKeyDown}
      >
        <span id="service-value" className={value ? '' : 'service-placeholder'}>{value || 'Select a service'}</span>
        <svg className="service-select-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>
      </button>
      {open && (
        <ul id="service-options" className="service-select-menu" role="listbox" ref={listbox}>
          {services.map((service, index) => (
            <li
              key={service}
              id={`service-option-${index}`}
              role="option"
              aria-selected={value === service}
              className={`service-select-option${activeIndex === index ? ' is-active' : ''}${value === service ? ' is-selected' : ''}`}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseDown={event => event.preventDefault()}
              onClick={() => choose(index)}
            >
              {service}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function ContactForm() {
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [service, setService] = useState('');
  const submission = useRef(null);
  const submitting = useRef(false);

  async function submit(event) {
    event.preventDefault();
    if (submitting.current) return;
    const data = Object.fromEntries(new FormData(event.currentTarget));
    data.consent = data.consent === 'on';
    const formBody = JSON.stringify(data);
    // Keep retries identical even if an advertising cookie arrives after the first request.
    const attribution = submission.current?.formBody === formBody
      ? submission.current.attribution : getEnquiryAttribution();
    Object.assign(data, attribution);
    let payload;
    try { payload = { ...validateEnquiry(data), company_website: data.company_website }; }
    catch (failure) {
      if (import.meta.env.DEV) console.info('[enquiry] client validation failed', { reason: failure.code || 'invalid_input', requestSent: false });
      setError(failure.message);
      return;
    }
    const body = JSON.stringify(payload);
    if (submission.current?.body !== body) submission.current = { body, formBody, attribution, key: crypto.randomUUID() };
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
      setStatus('success');
      trackEnquirySubmitted(result, response.ok);
    } catch (failure) {
      setError(failure instanceof TypeError || failure instanceof SyntaxError
        ? 'We could not confirm your enquiry. Check your connection and try again.'
        : failure.message);
      setStatus('idle');
    } finally { submitting.current = false; }
  }

  return (
    <section id="enquiry" className="booking-form" aria-labelledby="enquiry-title">
      <h2 id="enquiry-title" className="visually-hidden">Contact Royal Model</h2>
      {status === 'success' ? (
        <div className="booking-success" role="status">
          <span className="success-mark" aria-hidden="true">&#10003;</span>
          <h3>Your enquiry has been received.</h3>
          <p>Thank you. Our team will contact you using the details you provided.</p>
        </div>
      ) : (
        <form onSubmit={submit} aria-busy={status === 'submitting'}>
          <fieldset className="contact-fields" disabled={status === 'submitting'}>
            <legend className="visually-hidden">Your contact details and service</legend>
            <div className="form-grid">
              <label className="form-field"><span><FieldIcon name="person" />Full name <span className="required">*</span></span><input name="fullName" placeholder="Your full name" autoComplete="name" required minLength={2} maxLength={80} /></label>
              <label className="form-field"><span><FieldIcon name="email" />Email address <span className="required">*</span></span><input name="email" placeholder="you@example.com" type="email" autoComplete="email" required maxLength={254} /></label>
              <label className="form-field"><span><FieldIcon name="phone" />Phone number <span className="required">*</span></span><input name="phone" type="tel" autoComplete="tel" placeholder="+971 50 123 4567" required maxLength={40} /></label>
              <label className="form-field"><span id="service-label"><FieldIcon name="message" />Subject <span className="required">*</span></span><ServiceDropdown services={SERVICES} value={service} onChange={setService} /></label>
            </div>
            <div hidden aria-hidden="true"><label>Website<input name="company_website" type="text" tabIndex={-1} autoComplete="off" data-lpignore="true" data-1p-ignore="true" /></label></div>
            <label className="form-consent"><input type="checkbox" name="consent" required /><span>I agree to Royal Model Modern Clinic contacting me about my enquiry.</span></label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="booking-submit" type="submit"><span aria-live="polite">{status === 'submitting' ? 'Sending your enquiry...' : 'Book Now'}</span></button>
            <p className="form-footnote">Our team will follow up using your contact details.</p>
          </fieldset>
        </form>
      )}
      <div className="clinic-partners" aria-labelledby="clinic-partners-title">
        <p id="clinic-partners-title">Available at our clinic</p>
        <ul className="clinic-partner-logos" role="list">
          <li><img src={tabbyLogo} alt="Tabby" width="75" height="32" /></li>
          <li><img src={tamaraLogo} alt="Tamara" width="85" height="28" /></li>
          <li><img src={toothpickLogo} alt="Toothpick" width="124" height="30" /></li>
        </ul>
      </div>
    </section>
  );
}
