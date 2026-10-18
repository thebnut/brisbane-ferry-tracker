// The legacy CSPs (vercel.json header, index.html meta used by the iOS app) carry Cloudflare Turnstile for the
// feedback modal exactly as Cloudflare's CSP reference lists it: script-src and frame-src
// https://challenges.cloudflare.com, nothing else (https://developers.cloudflare.com/turnstile/reference/content-security-policy/).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const TURNSTILE = 'https://challenges.cloudflare.com';
const root = new URL('../../', import.meta.url);
const vercel = JSON.parse(readFileSync(new URL('vercel.json', root), 'utf8'));
const header = vercel.headers
  .flatMap((h) => h.headers)
  .find((h) => h.key === 'Content-Security-Policy').value;
const meta = readFileSync(new URL('index.html', root), 'utf8').match(
  /http-equiv="Content-Security-Policy" content="([^"]+)"/,
)[1];
const directives = (csp) =>
  Object.fromEntries(
    csp
      .split(';')
      .map((d) => d.trim().split(/\s+/))
      .filter((d) => d[0])
      .map(([name, ...v]) => [name, v]),
  );

describe('legacy CSP: Turnstile for the feedback modal', () => {
  for (const [name, csp] of [
    ['vercel.json', header],
    ['index.html meta', meta],
  ]) {
    it(`${name} allows Turnstile in script-src and frame-src only`, () => {
      const d = directives(csp);
      assert.ok(d['script-src'].includes(TURNSTILE));
      assert.ok(d['frame-src'].includes(TURNSTILE));
      const others = Object.entries(d).filter(([k, v]) => v.includes(TURNSTILE) && k !== 'script-src' && k !== 'frame-src');
      assert.deepEqual(others, []);
    });
  }
});
