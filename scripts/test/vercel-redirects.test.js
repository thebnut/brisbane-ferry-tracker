// Release 24: brisbaneferry.com and www move to BrisbaneTransit's Ferry tab (vercel.json "redirects"), one 301 each,
// path kept (query strings pass through on Vercel).
//  - Crawlers, scripts (no Sec-Fetch-Mode) and browsers already handed off (the bft-handoff cookie) get the 301 for
//    every page. A browser's first visit to a www page (home, terminal pages) is served the legacy page instead, whose
//    first script (public/handoff-ferry.js) hands its remembered pair to transit and leaves for the same URL: the
//    pair lives in www's storage, which only a page on www can read. The apex never held any (it always 307'd to www).
//  - /api/* is never redirected: the iOS app calls https://www.brisbaneferry.com/api/gtfs-proxy cross-origin
//    (src/utils/environment.js), and a redirect without CORS headers would break it. Neither are the files the
//    legacy page loads, nor other hosts on the project (previews, next.brisbaneferry.com).
//  - The project's other legacy hosts (brisbanecitycat.com and www, ferry.lifemap.au, brisbane-ferry-tracker.vercel.app)
//    used to 307/308 to www at the domain level, so they never held storage either: they 301 like the apex.
// The matcher covers what vercel.json uses: ":name", ":name(regex)", a trailing ":name*"; host, cookie and header
// conditions in "has" and "missing" (values as anchored regexes).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const vercel = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));
const T = 'https://brisbanetransit.com';

function compile(source) {
  const names = [];
  const re = source.replace(/:(\w+)(\(((?:[^()]|\((?:[^()]|\([^()]*\))*\))*)\))?/g, (_m, name, _g, custom) => {
    names.push(name);
    return `(${custom ?? '[^/]+'})`;
  });
  return { re: new RegExp(`^${re}$`), names };
}

/** Whether a has/missing item matches this request ({ host, headers, cookies }). */
function matches(item, req) {
  const actual =
    item.type === 'host' ? req.host : item.type === 'cookie' ? req.cookies[item.key] : req.headers[item.key];
  if (actual === undefined) return false;
  return item.value === undefined || new RegExp(`^${item.value}$`).test(actual);
}

/** The redirect Vercel would answer, or null (served by the app). */
function redirectFor(path, req) {
  for (const r of vercel.redirects ?? []) {
    if (!(r.has ?? []).every((h) => matches(h, req))) continue;
    if ((r.missing ?? []).some((h) => matches(h, req))) continue;
    const { re, names } = compile(r.source);
    const m = re.exec(path);
    if (!m) continue;
    let dest = r.destination;
    names.forEach((n, i) => {
      dest = dest.replace(new RegExp(`:${n}\\*?`), m[i + 1]);
    });
    return { status: r.statusCode ?? (r.permanent === false ? 307 : 308), location: dest };
  }
  return null;
}

const CHROME = 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
const curl = (host) => ({ host, headers: { 'user-agent': 'curl/8.7.1' }, cookies: {} });
const googlebot = (host) => ({
  host,
  headers: {
    'user-agent': `Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) ${CHROME}`,
    'sec-fetch-mode': 'navigate',
  },
  cookies: {},
});
const browser = (host, cookies = {}) => ({
  host,
  headers: { 'user-agent': CHROME, 'sec-fetch-mode': 'navigate' },
  cookies,
});

/** Pages the legacy app serves (where a remembered pair can be read), then every other path. */
const PAGES = [
  ['/', `${T}/ferry/`],
  ['/index.html', `${T}/ferry/`],
  ['/terminal/bulimba', `${T}/ferry/terminal/bulimba`],
  ['/terminal/bulimba/', `${T}/ferry/terminal/bulimba`],
  ['/terminal/riverside/index.html', `${T}/ferry/terminal/riverside`],
];
const OTHERS = [
  ['/map', `${T}/ferry/map`],
  ['/privacy', `${T}/ferry/privacy`],
  ['/privacy.html', `${T}/ferry/privacy`],
  ['/terms', `${T}/ferry/terms`],
  ['/terms.html', `${T}/ferry/terms`],
  ['/sitemap.xml', `${T}/sitemap.xml`],
  ['/sitemap-ferry.xml', `${T}/sitemap.xml`],
  ['/sitemap_index.xml', `${T}/sitemap.xml`],
  ['/sitemaps/pages.xml', `${T}/sitemap.xml`],
  ['/robots.txt', `${T}/robots.txt`],
  // Old URLs that already carry the mode prefix keep a single one (they used to become /ferry/ferry/…, a 404).
  ['/ferry', `${T}/ferry/`],
  ['/ferry/', `${T}/ferry/`],
  ['/ferry/terminal/south-bank', `${T}/ferry/terminal/south-bank`],
  ['/ferry/terminal/south-bank/', `${T}/ferry/terminal/south-bank/`],
  ['/ferry/map', `${T}/ferry/map`],
  ['/ferryx', `${T}/ferry/ferryx`],
  ['/some/old/page', `${T}/ferry/some/old/page`],
  ['/apix', `${T}/ferry/apix`],
];
const LEGACY = ['brisbanecitycat.com', 'www.brisbanecitycat.com', 'ferry.lifemap.au', 'brisbane-ferry-tracker.vercel.app'];
const NEVER = ['/api/gtfs-proxy', '/api/feedback', '/api'];
const FILES = ['/handoff-ferry.js', '/ga-config.js', '/assets/index-abc123.js', '/assets/index-abc123.css', '/favicon.ico', '/manifest.webmanifest'];

describe('brisbaneferry.com → brisbanetransit.com/ferry (release 24)', () => {
  for (const [who, req] of [
    ['curl (no Sec-Fetch-Mode)', curl],
    ['Googlebot', googlebot],
    ['a browser already handed off', (h) => browser(h, { 'bft-handoff': '1' })],
    ['any browser on the apex', (h) => (h === 'www.brisbaneferry.com' ? browser(h, { 'bft-handoff': '1' }) : browser(h))],
  ]) {
    for (const host of ['brisbaneferry.com', 'www.brisbaneferry.com', ...LEGACY]) {
      it(`${who}, ${host}: every page and old URL is one 301`, () => {
        for (const [path, location] of [...PAGES, ...OTHERS])
          assert.deepEqual(redirectFor(path, req(host)), { status: 301, location }, path);
      });
      it(`${who}, ${host}: /api/* is never redirected (the iOS app's API)`, () => {
        for (const path of NEVER) assert.equal(redirectFor(path, req(host)), null, path);
      });
    }
  }

  it("a browser's first visit to a www page gets the legacy page (its handoff script), every other URL the 301", () => {
    const req = browser('www.brisbaneferry.com');
    for (const [path] of PAGES) assert.equal(redirectFor(path, req), null, path);
    for (const [path, location] of OTHERS) assert.deepEqual(redirectFor(path, req), { status: 301, location }, path);
    // The files the legacy page loads (the handoff script first) stay reachable.
    for (const path of FILES) assert.equal(redirectFor(path, req), null, path);
  });

  it('no rule sends a page to a doubled /ferry/ferry prefix, or robots/sitemaps under /ferry', () => {
    const paths = [...PAGES, ...OTHERS].map(([p]) => p).concat(['/ferry/ferry', '/ferry/x/y/z', '/ferry/robots.txt']);
    for (const host of ['brisbaneferry.com', 'www.brisbaneferry.com', ...LEGACY])
      for (const path of paths) {
        const r = redirectFor(path, curl(host));
        if (!r) continue;
        const to = new URL(r.location);
        assert.equal(to.origin, T, `${host}${path}`);
        if (path !== '/ferry/ferry') assert.ok(!/^\/ferry\/ferry(?:\/|$)/.test(to.pathname), `${host}${path} → ${r.location}`);
        assert.ok(!/^\/ferry\/(?:robots\.txt|sitemap[^/]*\.xml)$/.test(to.pathname) || path.startsWith('/ferry/'), `${host}${path} → ${r.location}`);
      }
  });

  it('query strings pass through (Vercel appends them to the destination), so the destinations carry none', () => {
    for (const r of vercel.redirects) assert.ok(!r.destination.includes('?'), r.source);
  });

  it('other hosts on the project are untouched', () => {
    for (const host of ['brisbane-ferry-tracker-git-develop-starblaze.vercel.app', 'next.brisbaneferry.com', 'api.brisbaneferry.com', 'www.brisbaneferry.com.example', 'xbrisbanecitycat.com', 'ferry.lifemap.au.example'])
      for (const [path] of [...PAGES, ...OTHERS]) {
        assert.equal(redirectFor(path, curl(host)), null, `${host}${path}`);
        assert.equal(redirectFor(path, browser(host)), null, `${host}${path}`);
      }
  });

  it('every rule is a host-scoped 301 to brisbanetransit.com', () => {
    for (const r of vercel.redirects) {
      assert.equal(r.statusCode, 301, r.source);
      assert.ok(r.destination.startsWith(`${T}/`), r.source);
      assert.equal(r.has[0].type, 'host', r.source);
      assert.match('brisbaneferry.com www.brisbaneferry.com', new RegExp(r.has[0].value.replace(/^\^|\$$/g, '')), r.source);
    }
  });

  it('the legacy page loads the handoff script first, before anything else runs', () => {
    const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
    assert.ok(html.indexOf('<script src="/handoff-ferry.js"></script>') > 0);
    assert.ok(html.indexOf('/handoff-ferry.js') < html.indexOf('<script', html.indexOf('/handoff-ferry.js') + 1));
    assert.equal(html.indexOf('<script'), html.indexOf('<script src="/handoff-ferry.js">'));
  });
});
