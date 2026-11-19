// Vercel preview builds of the legacy app stay out of search and point at BrisbaneTransit (scripts/preview-seo.mjs).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { isPreviewBuild, PREVIEW_ROBOTS_TXT, previewHtml, transitCanonical } from '../preview-seo.mjs';

test('only a Vercel build that is not production is a preview', () => {
  assert.equal(isPreviewBuild({ VERCEL_ENV: 'preview' }), true);
  assert.equal(isPreviewBuild({ VERCEL_ENV: 'development' }), true);
  assert.equal(isPreviewBuild({ VERCEL_ENV: 'production' }), false);
  // Outside Vercel (the iOS app, a local build): unchanged.
  assert.equal(isPreviewBuild({}), false);
});

test('canonicals go to the same page on BrisbaneTransit', () => {
  assert.equal(transitCanonical('https://www.brisbaneferry.com/'), 'https://brisbanetransit.com/ferry/');
  assert.equal(transitCanonical('https://www.brisbaneferry.com'), 'https://brisbanetransit.com/ferry/');
  assert.equal(
    transitCanonical('https://www.brisbaneferry.com/terminal/south-bank'),
    'https://brisbanetransit.com/ferry/terminal/south-bank',
  );
  assert.equal(transitCanonical('https://www.brisbaneferry.com/privacy'), 'https://brisbanetransit.com/ferry/privacy');
  // Anything else is left alone.
  assert.equal(transitCanonical('https://www.brisbaneferry.com.evil.test/'), 'https://www.brisbaneferry.com.evil.test/');
  assert.equal(transitCanonical('https://example.test/x'), 'https://example.test/x');
});

test('robots.txt disallows everything', () => {
  assert.equal(PREVIEW_ROBOTS_TXT, 'User-agent: *\nDisallow: /\n');
});

test('index.html: noindex once, canonical and og:url on BrisbaneTransit', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const out = previewHtml(html);
  assert.match(out, /<link rel="canonical" href="https:\/\/brisbanetransit\.com\/ferry\/" \/>/);
  assert.match(out, /<meta property="og:url" content="https:\/\/brisbanetransit\.com\/ferry\/" \/>/);
  assert.equal(out.match(/<meta name="robots" content="noindex" \/>/g)?.length, 1);
  assert.ok(out.indexOf('name="robots"') < out.indexOf('</head>'));
  // Idempotent: a page already noindex (the 404) doesn't get a second meta.
  assert.equal(previewHtml(out), out);
});

test('privacy and terms pages too', () => {
  for (const [file, path] of [
    ['privacy.html', '/privacy'],
    ['terms.html', '/terms'],
  ]) {
    const out = previewHtml(readFileSync(new URL(`../../public/${file}`, import.meta.url), 'utf8'));
    assert.ok(out.includes(`<link rel="canonical" href="https://brisbanetransit.com/ferry${path}" />`), file);
    assert.ok(out.includes('<meta name="robots" content="noindex" />'), file);
  }
});
