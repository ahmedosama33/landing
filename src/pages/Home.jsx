import CareMotion from '../components/CareMotion.jsx';
import FieldIcon from '../components/FieldIcon.jsx';
import Form from '../components/contactform.jsx';
import logo from '../assets/RM LOGO.png';
import './home.css';

export default function Home() {
  const whatsappNumber = import.meta.env.VITE_CLINIC_WHATSAPP_NUMBER ?? '';
  const whatsappContact = /^[1-9]\d{7,14}$/.test(whatsappNumber) ? `https://wa.me/${whatsappNumber}` : null;
  return (
    <div className="clinic-page">
      <header className="clinic-header">
        <a href="/" className="clinic-brand" aria-label="Royal Model Modern Clinic home">
          <img src={logo} alt="Royal Model Modern Clinic" />
        </a>
        {whatsappContact ? <a className="header-whatsapp" href={whatsappContact} target="_blank" rel="noopener noreferrer">Chat on WhatsApp <span aria-hidden="true">&#8599;</span></a> : <a className="header-whatsapp" href="tel:0559988250">Call the clinic <span aria-hidden="true">&#8599;</span></a>}
      </header>
      <main className="booking-layout">
        <section className="contact-introduction" aria-labelledby="page-title">
          <p className="eyebrow">Contact us</p>
          <h1 id="page-title">Let&apos;s get in touch.</h1>
          <p>Have a question or an appointment in mind? Speak with our team directly.</p>
        </section>
        <Form />
        <aside className="clinic-intro" aria-labelledby="contact-details-title">
          <h2 id="contact-details-title" className="visually-hidden">Clinic contact details</h2>
          <dl className="contact-details">
            <div><dt><span className="contact-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" /><circle cx="12" cy="10" r="2" /></svg></span><span className="visually-hidden">Clinic address</span></dt><dd>Royal Model<br />Medical Center<span>205 Al Wasl Rd – Al Bada<br />Dubai, UAE</span><a className="whatsapp-contact" href="https://www.google.com/maps/dir/?api=1&destination=Royal%20Model%20Medical%20Center%2C%20205%20Al%20Wasl%20Rd%2C%20Al%20Bada%2C%20Dubai%2C%20UAE" target="_blank" rel="noopener noreferrer">Get Directions <span aria-hidden="true">&#8599;</span><span className="visually-hidden"> (opens Google Maps in a new tab)</span></a></dd></div>
            <div><dt><span className="contact-icon"><FieldIcon name="phone" /></span>Contact details</dt><dd><a className="contact-number" href="tel:0559988250" dir="ltr"><span className="number-icon"><FieldIcon name="mobile" /></span>055 998 8250</a><a className="contact-number secondary-contact" href="tel:043389909" dir="ltr"><span className="number-icon"><FieldIcon name="landline" /></span>04 338 9909</a>{whatsappContact && <a className="whatsapp-contact" href={whatsappContact} target="_blank" rel="noopener noreferrer">Chat on WhatsApp <span aria-hidden="true">&#8599;</span></a>}</dd></div>
          </dl>
        </aside>
        {/* <section className="clinic-location" aria-label="Royal Model Medical Center map">
          <iframe
            className="clinic-map"
            src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3609.1162179745356!2d55.269828600000004!3d25.2330103!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x3e5f42558b679127%3A0x15efd825aef16f9f!2sRoyal%20Model%20Medical%20Center!5e0!3m2!1sen!2seg!4v1791478195342!5m2!1sen!2seg"
            width="600"
            height="450"
            allowFullScreen
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
            title="Royal Model Medical Center Location"
          />
        </section> */}
      </main>
      <CareMotion />
    </div>
  );
}
