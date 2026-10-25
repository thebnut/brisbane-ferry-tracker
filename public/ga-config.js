// Google Analytics bootstrap — moved out of index.html to satisfy
// CSP `script-src 'self'` (inline scripts blocked by design).
// It also loads gtag/js, so hosts where GA is off make no request to Google.
//  - production hosts and the iOS app (capacitor://localhost): on;
//  - Vercel pre-prod/previews (*.vercel.app): on, with debug_mode for DebugView;
//  - localhost and anything else: off. window.gtag stays undefined, so the
//    app's event helper (src/utils/analytics.js) is a no-op.
// The event contract (one property, cross-domain linker, site_mode on every
// event, signals off) is shared with the Worker apps, and so is what GA may see
// of the page: page_location and page_referrer keep only the allowlisted query
// parameters (never lat/lon or anything typed), and page_title is built from the
// path ("ferry home", "ferry terminal bulimba"), never document.title. All three
// are set before the config, so every event carries them (gtag's own too).
(function () {
  var MEASUREMENT_ID = 'G-MEG3CX0SFC';
  var PRODUCTION_HOSTS = ['brisbaneferry.com', 'www.brisbaneferry.com', 'ferry.lifemap.au'];
  var loc = window.location;
  var isCapacitor = loc.protocol === 'capacitor:' || loc.protocol === 'ionic:';
  var isPreview = /\.vercel\.app$/.test(loc.hostname);
  if (!isCapacitor && !isPreview && PRODUCTION_HOSTS.indexOf(loc.hostname) === -1) return;

  // The Worker apps' GA_QUERY_KEEP (packages/ui/src/analytics-config.ts).
  var KEEP = ['to', 'from', 'route', 'at', 'mode', 'station', 'terminal', 'trip',
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
    'gclid', 'gbraid', 'wbraid', 'gad_source'];
  // protocol + host, not origin: capacitor://localhost has no origin ("null").
  function clean(u) {
    try {
      var x = new URL(u, loc.href);
      var q = new URLSearchParams();
      x.searchParams.forEach(function (v, k) { if (KEEP.indexOf(k) >= 0) q.append(k, v); });
      q = q.toString();
      return x.protocol + '//' + x.host + x.pathname + (q ? '?' + q : '');
    } catch (e) {
      return loc.protocol + '//' + loc.host + loc.pathname;
    }
  }
  // The Worker apps' gaPageTitle, for the ferry site: the page type and the id in the path.
  function title(p) {
    try {
      var s = String(p).split(/[?#]/)[0].split('/').filter(Boolean);
      if (['ferry', 'train', 'bus'].indexOf(s[0]) >= 0) s.shift();
      var t = s[0] || 'home';
      var i = '';
      if (!/^[a-z][a-z-]{0,30}$/.test(t)) t = 'page';
      if (/^(stop|station|terminal|route)$/.test(t) && s[1]) {
        i = decodeURIComponent(s[1]);
        if (!/^[A-Za-z0-9._-]{1,40}$/.test(i)) i = '';
      }
      return ['ferry', t, i].filter(Boolean).join(' ');
    } catch (e) {
      return 'ferry';
    }
  }
  var page = { page_location: clean(loc.href), page_title: title(loc.pathname) };
  var ref = window.document && window.document.referrer;
  if (ref) page.page_referrer = clean(ref);

  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() { window.dataLayer.push(arguments); };

  var config = {
    site_mode: 'ferry',
    linker: { domains: ['brisbaneferry.com', 'brisbanebus.com', 'brisbanetrain.com', 'brisbanetransit.com'] },
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  };
  if (isPreview) config.debug_mode = true;
  for (var k in page) config[k] = page[k];

  window.gtag('js', new Date());
  window.gtag('set', page);
  window.gtag('config', MEASUREMENT_ID, config);

  var script = document.createElement('script');
  script.async = true;
  script.src = 'https://www.googletagmanager.com/gtag/js?id=' + MEASUREMENT_ID;
  document.head.appendChild(script);
})();
