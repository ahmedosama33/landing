/* Runs before GTM and React. This is a consent queue, not an analytics installation. */
(function (browser) {
  'use strict';
  if (browser.royalModelConsent) return;
  var key = 'royalModelAdvertisingConsent';
  var eventName = 'royalmodel:advertising-consent';
  var lifetime = 90 * 24 * 60 * 60 * 1000;
  var choice = null;
  var updatedAt = 0;
  var synchronizedRecord;
  browser.dataLayer = browser.dataLayer || [];
  function queue() { browser.dataLayer.push(arguments); }
  function categories(value) {
    var state = value === true ? 'granted' : 'denied';
    return {
      ad_storage: state,
      analytics_storage: state,
      ad_user_data: state,
      // The banner covers measurement, not profiling or personalized advertising.
      ad_personalization: 'denied'
    };
  }
  function readChoice() {
    try {
      var saved = JSON.parse(browser.localStorage.getItem(key));
      if (saved && saved.version === 1 && typeof saved.value === 'boolean'
        && Number.isFinite(saved.updatedAt) && saved.updatedAt <= Date.now()
        && Date.now() - saved.updatedAt < lifetime) return saved;
    } catch (_) { /* Storage unavailable or malformed: no implicit acceptance. */ }
    return null;
  }
  function clearAttribution() {
    try { browser.localStorage.removeItem('royalmodel.attribution.v1'); } catch (_) { /* best effort */ }
  }
  queue('consent', 'default', categories(false));
  // Restrict denied-state Google Ads data; GTM must separately gate Custom HTML.
  queue('set', 'ads_data_redaction', true);
  var saved = readChoice();
  if (saved) {
    choice = saved.value;
    updatedAt = saved.updatedAt;
  }
  browser.royalModelAdvertisingConsent = choice === true;
  if (choice === true) queue('consent', 'update', categories(true));
  else clearAttribution();

  browser.addEventListener(eventName, function (event) {
    if (typeof event.detail !== 'boolean') return;
    var next = synchronizedRecord === null ? null : event.detail;
    var changed = choice !== next;
    choice = next;
    updatedAt = synchronizedRecord ? synchronizedRecord.updatedAt : Date.now();
    browser.royalModelAdvertisingConsent = choice === true;
    if (synchronizedRecord === undefined) {
      try { browser.localStorage.setItem(key, JSON.stringify({ version: 1, value: choice, updatedAt: updatedAt })); }
      catch (_) { /* Keep the choice in memory for this visit. */ }
    }
    if (!choice) clearAttribution();
    if (changed) {
      queue('consent', 'update', categories(choice));
      // A GTM trigger for tags that need to start after a late Accept.
      browser.dataLayer.push({ event: 'royalmodel_consent_updated', advertising_consent: choice ? 'granted' : 'denied' });
    }
  });
  function setChoice(value) {
    if (typeof value !== 'boolean') return;
    browser.dispatchEvent(new browser.CustomEvent(eventName, { detail: value }));
  }
  function expireChoice() {
    if (choice === null || Date.now() - updatedAt < lifetime) return;
    try { browser.localStorage.removeItem(key); } catch (_) { /* best effort */ }
    synchronize(null);
  }
  function synchronize(record) {
    synchronizedRecord = record;
    try { setChoice(record ? record.value : false); }
    finally { synchronizedRecord = undefined; }
  }
  browser.royalModelConsent = {
    getChoice: function () { return choice; },
    setChoice: setChoice
  };
  // Other tabs and long-lived visits must not retain an obsolete acceptance.
  browser.addEventListener('storage', function (event) {
    if (event.key !== key && event.key !== null) return;
    var current = readChoice();
    synchronize(current);
  });
  browser.addEventListener('focus', expireChoice);
  // Publish readiness only after defaults, saved preferences and listeners succeed.
  // Bind it to the initialized queue so a replaced dataLayer cannot bypass consent.
  browser.royalModelConsent.readyDataLayer = browser.dataLayer;
})(window);
