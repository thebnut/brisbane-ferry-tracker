// Google Analytics bootstrap — moved out of index.html to satisfy
// CSP `script-src 'self'` (inline scripts blocked by design).
// It also loads gtag/js, so hosts where GA is off make no request to Google.
//  - production hosts and the iOS app (capacitor://localhost): on;
//  - Vercel pre-prod/previews (*.vercel.app): on, with debug_mode for DebugView;
//  - localhost and anything else: off. window.gtag stays undefined, so the
//    app's event helper (src/utils/analytics.js) is a no-op.
// The event contract (one property, cross-domain linker, site_mode on every
// event, signals off) is shared with the Worker apps.
(function () {
  var MEASUREMENT_ID = 'G-MEG3CX0SFC';
  var PRODUCTION_HOSTS = ['brisbaneferry.com', 'www.brisbaneferry.com', 'ferry.lifemap.au'];
  var loc = window.location;
  var isCapacitor = loc.protocol === 'capacitor:' || loc.protocol === 'ionic:';
  var isPreview = /\.vercel\.app$/.test(loc.hostname);
  if (!isCapacitor && !isPreview && PRODUCTION_HOSTS.indexOf(loc.hostname) === -1) return;

  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() { window.dataLayer.push(arguments); };

  var config = {
    site_mode: 'ferry',
    linker: { domains: ['brisbaneferry.com', 'brisbanebus.com', 'brisbanetrain.com', 'brisbanetransit.com'] },
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  };
  if (isPreview) config.debug_mode = true;

  window.gtag('js', new Date());
  window.gtag('config', MEASUREMENT_ID, config);

  var script = document.createElement('script');
  script.async = true;
  script.src = 'https://www.googletagmanager.com/gtag/js?id=' + MEASUREMENT_ID;
  document.head.appendChild(script);
})();
