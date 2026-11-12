// Vercel preview builds of the legacy ferry app (the git-develop alias and every other non-production deployment) stay
// out of search, and say where the real pages are. Vercel already sends X-Robots-Tag: noindex on previews; this makes
// the files say it too, so a copy served or cached without the header does as well:
//  - robots.txt disallows everything, and no sitemap is written (it listed www.brisbaneferry.com URLs);
//  - every HTML page gets a robots noindex meta;
//  - canonicals and og:url name the page on BrisbaneTransit (https://brisbanetransit.com/ferry/…), where the legacy
//    hosts 301 to since release 24.
// Production builds (VERCEL_ENV=production) and builds outside Vercel (the iOS app, local) are unchanged.

export const TRANSIT_FERRY_URL = 'https://brisbanetransit.com/ferry';
const LEGACY_SITE_RE = /^https:\/\/www\.brisbaneferry\.com(?=\/|$)/;

export const PREVIEW_ROBOTS_TXT = 'User-agent: *\nDisallow: /\n';

/** Whether this build is a Vercel preview: VERCEL_ENV set to anything but "production". */
export function isPreviewBuild(env = process.env) {
  return Boolean(env.VERCEL_ENV) && env.VERCEL_ENV !== 'production';
}

/** A legacy canonical URL's BrisbaneTransit page; any other URL is returned as it is. */
export function transitCanonical(url) {
  if (!LEGACY_SITE_RE.test(url)) return url;
  const rest = url.replace(LEGACY_SITE_RE, '');
  return `${TRANSIT_FERRY_URL}${rest === '' ? '/' : rest}`;
}

const NOINDEX_META = '<meta name="robots" content="noindex" />';

/** One page's HTML for a preview: noindex meta (once), canonical and og:url on BrisbaneTransit. */
export function previewHtml(html) {
  let out = html
    .replace(/(<link rel="canonical" href=")([^"]*)(" \/>)/g, (_, a, url, b) => `${a}${transitCanonical(url)}${b}`)
    .replace(/(<meta property="og:url" content=")([^"]*)(" \/>)/g, (_, a, url, b) => `${a}${transitCanonical(url)}${b}`);
  if (!/<meta name="robots" content="[^"]*noindex/.test(out)) {
    if (!out.includes('</head>')) throw new Error('preview-seo: no </head> in an HTML page');
    out = out.replace('</head>', () => `    ${NOINDEX_META}\n  </head>`);
  }
  return out;
}
