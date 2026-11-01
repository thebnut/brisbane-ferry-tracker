// Release 24: brisbaneferry.com and www move to BrisbaneTransit's Ferry tab (vercel.json "redirects"), one 301 each,
// path kept (query strings pass through on Vercel). /api/* is never redirected: the iOS app calls
// https://www.brisbaneferry.com/api/gtfs-proxy cross-origin (src/utils/environment.js), and a redirect without CORS
// headers would break it. Other hosts on the project (previews, ferry.lifemap.au) are untouched.
// The matcher below covers the pattern shapes vercel.json uses (":name", ":name(regex)", a trailing ":name*").
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

/** The redirect Vercel would answer for a host and path, or null (served by the app). */
function redirectFor(host, path) {
  for (const r of vercel.redirects ?? []) {
    const hostRule = (r.has ?? []).find((h) => h.type === 'host');
    if (hostRule && !new RegExp(`^${hostRule.value}$`).test(host)) continue;
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

const CASES = [
  ['/', `${T}/ferry`],
  ['/terminal/bulimba', `${T}/ferry/terminal/bulimba`],
  ['/terminal/bulimba/', `${T}/ferry/terminal/bulimba`],
  ['/terminal/riverside/index.html', `${T}/ferry/terminal/riverside`],
  ['/map', `${T}/ferry/map`],
  ['/privacy', `${T}/ferry/privacy`],
  ['/privacy.html', `${T}/ferry/privacy`],
  ['/terms', `${T}/ferry/terms`],
  ['/terms.html', `${T}/ferry/terms`],
  ['/sitemap.xml', `${T}/sitemap.xml`],
  ['/robots.txt', `${T}/robots.txt`],
  ['/some/old/page', `${T}/ferry/some/old/page`],
  ['/apix', `${T}/ferry/apix`],
];

describe('brisbaneferry.com → brisbanetransit.com/ferry (release 24)', () => {
  for (const host of ['brisbaneferry.com', 'www.brisbaneferry.com']) {
    for (const [path, location] of CASES) {
      it(`${host}${path} → ${location}, one 301`, () => {
        assert.deepEqual(redirectFor(host, path), { status: 301, location });
      });
    }
    for (const path of ['/api/gtfs-proxy', '/api/feedback', '/api']) {
      it(`${host}${path} is served, never redirected (the iOS app's API)`, () => {
        assert.equal(redirectFor(host, path), null);
      });
    }
  }

  it('other hosts on the project are untouched', () => {
    for (const host of ['ferry.lifemap.au', 'brisbane-ferry-tracker-git-develop-starblaze.vercel.app', 'next.brisbaneferry.com.example'])
      for (const [path] of CASES) assert.equal(redirectFor(host, path), null, `${host}${path}`);
  });

  it('every rule is a host-scoped 301 to brisbanetransit.com', () => {
    for (const r of vercel.redirects) {
      assert.equal(r.statusCode, 301, r.source);
      assert.ok(r.destination.startsWith(`${T}/`), r.source);
      assert.deepEqual(r.has, [{ type: 'host', value: '(?:www\\.)?brisbaneferry\\.com' }], r.source);
    }
  });
});
