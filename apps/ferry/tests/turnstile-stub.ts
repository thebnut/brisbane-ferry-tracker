import type { Page } from '@playwright/test'

/**
 * Test-only stand-in for Cloudflare's Turnstile script: no request leaves the machine. The Playwright webServer runs
 * with Cloudflare's always-pass test sitekey (1x00000000000000000000AA, playwright.config.ts only, never in deployed
 * config). The stub is served from the real script URL, so the page's CSP must allow it, and it records each render's
 * options so a test can check the sitekey and action. Its token is the dummy one Cloudflare's test keys return.
 */
export const TEST_SITEKEY = '1x00000000000000000000AA'
export const DUMMY_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX'

const STUB = `
window.__turnstileRenders = [];
window.turnstile = {
  render: function (el, o) {
    window.__turnstileRenders.push({ sitekey: o.sitekey, action: o.action, appearance: o.appearance });
    window.__turnstileOpts = o;
    return 'w1';
  },
  execute: function () { setTimeout(function () { window.__turnstileOpts.callback(${JSON.stringify(DUMMY_TOKEN)}); }, 20); },
  reset: function () {},
  remove: function () {},
};`

/** Stub the script; returns how many times it was requested. */
export async function stubTurnstile(page: Page): Promise<{ requests: () => number }> {
  let n = 0
  await page.route('https://challenges.cloudflare.com/**', async (route) => {
    n++
    await route.fulfill({ contentType: 'application/javascript', body: STUB })
  })
  return { requests: () => n }
}

export const turnstileRenders = (page: Page) =>
  page.evaluate(() => (window as unknown as { __turnstileRenders?: unknown[] }).__turnstileRenders ?? [])
