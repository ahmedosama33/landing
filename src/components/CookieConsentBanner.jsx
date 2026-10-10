import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import './cookie-consent.css';

function getChoice() { return window.royalModelConsent?.getChoice() ?? null; }
function subscribe(callback) {
  window.addEventListener('royalmodel:advertising-consent', callback);
  window.addEventListener('storage', callback);
  window.addEventListener('focus', callback);
  return () => {
    window.removeEventListener('royalmodel:advertising-consent', callback);
    window.removeEventListener('storage', callback);
    window.removeEventListener('focus', callback);
  };
}

export default function CookieConsentBanner() {
  const choice = useSyncExternalStore(subscribe, getChoice, () => null);
  const [settingsOpen, setSettingsOpen] = useState(null);
  const panel = useRef(null);
  const title = useRef(null);
  const settings = useRef(null);
  const visible = settingsOpen ?? (choice === null);

  useLayoutEffect(() => {
    if (!visible || !panel.current) return undefined;
    const resize = () => document.documentElement.style.setProperty('--cookie-banner-height', `${panel.current?.getBoundingClientRect().height || 0}px`);
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(panel.current);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty('--cookie-banner-height');
    };
  }, [visible]);

  useEffect(() => {
    if (settingsOpen) title.current?.focus({ preventScroll: true });
  }, [settingsOpen]);

  function choose(value) {
    window.royalModelConsent?.setChoice(value);
    setSettingsOpen(null);
    settings.current?.focus({ preventScroll: true });
  }

  return (
    <>
      <button ref={settings} type="button" className="cookie-settings-float" aria-label="Cookie Settings" title="Cookie Settings" aria-controls="cookie-consent-banner" aria-expanded={visible} onClick={() => setSettingsOpen(!visible)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20.5 12.4A8.5 8.5 0 1 1 11.6 3.5a4 4 0 0 0 4.3 4.3 4 4 0 0 0 4.6 4.6Z" />
          <circle cx="8" cy="9" r="1" fill="currentColor" stroke="none" />
          <circle cx="7.5" cy="15" r="1" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12.5" r="1" fill="currentColor" stroke="none" />
          <circle cx="14.5" cy="17" r="1" fill="currentColor" stroke="none" />
        </svg>
      </button>
      {visible && (
        <div className="cookie-consent-space">
          <section ref={panel} id="cookie-consent-banner" className="cookie-consent-banner" aria-labelledby="cookie-consent-title" aria-describedby="cookie-consent-description">
            <div className="cookie-consent-content">
              <div>
                <h2 ref={title} tabIndex={-1} id="cookie-consent-title">We Value Your Privacy</h2>
                <p id="cookie-consent-description">We use cookies to improve your browsing experience, understand website traffic, and measure our advertising performance. You can choose to accept or decline optional cookies.</p>
              </div>
              <div className="cookie-consent-actions">
                <button type="button" className="cookie-decline" onClick={() => choose(false)}>Decline</button>
                <button type="button" className="cookie-accept" onClick={() => choose(true)}>Accept</button>
              </div>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
