import { defineConfig, devices } from '@playwright/test'

const PORT = 8796

/**
 * Smoke tests against the production build running in workerd (`wrangler dev`), in fixture mode so no live API is
 * needed. `pnpm test:e2e` builds first. Turnstile uses Cloudflare's always-pass test sitekey here only (its script is
 * stubbed in tests/turnstile-stub.ts); deployed config has the real one. The live LLM check against staging is playwright.llm.config.ts;
 * the live CSP + Turnstile check is playwright.staging.config.ts.
 */
export default defineConfig({
  testDir: 'tests',
  testIgnore: ['**/llm.spec.ts', '**/*.staging.spec.ts'],
  fullyParallel: true,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure' },
  projects: [
    { name: 'phone', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: `pnpm build && wrangler dev --port ${PORT} --var FIXTURES:1 --var ALLOW_FIXTURES:1 --var TURNSTILE_SITEKEY:1x00000000000000000000AA`,
    url: `http://localhost:${PORT}/robots.txt`,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
  },
})
