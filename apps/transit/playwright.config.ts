import { DEMO_ALLOWED_SPECS, demoAllowedProject, demoAllowedServer } from '@bft/ui/e2e/demo-allowed.ts'
import { GA_SPECS, gaProject, gaServer } from '@bft/ui/e2e/ga.ts'
import { onboardingAnswered } from '@bft/ui/e2e/onboarding.ts'
import { defineConfig, devices } from '@playwright/test'

const PORT = 8796
/** The GA-on server (@bft/ui/e2e/ga.ts): GA_MEASUREMENT_ID set, gtag.js stubbed in the specs. */
const GA_PORT = 8826
/** The demo-allowed server (R9, @bft/ui/e2e/demo-allowed.ts). */
const DEMO_PORT = 8806

/**
 * Smoke tests against the production build running in workerd (`wrangler dev`), in fixture mode so no live API is
 * needed. `pnpm test:e2e` builds first. Turnstile uses Cloudflare's always-pass test sitekey here only (its script is
 * stubbed in tests/turnstile-stub.ts); deployed config has the real one. The live LLM check against staging is playwright.llm.config.ts;
 * the live CSP + Turnstile check is playwright.staging.config.ts.
 */
export default defineConfig({
  testDir: 'tests',
  testIgnore: ['**/llm.spec.ts', '**/*.staging.spec.ts', DEMO_ALLOWED_SPECS, GA_SPECS],
  fullyParallel: true,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    // The first-visit onboarding prompt (P4) answered: only tests/onboarding.spec.ts starts from a real first visit.
    storageState: onboardingAnswered(`http://localhost:${PORT}`),
  },
  projects: [
    { name: 'phone', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    demoAllowedProject(DEMO_PORT),
    gaProject(GA_PORT),
  ],
  webServer: [
    {
      command: `pnpm build && wrangler dev --port ${PORT} --var FIXTURES:1 --var ALLOW_FIXTURES:1 --var TURNSTILE_SITEKEY:1x00000000000000000000AA`,
      url: `http://localhost:${PORT}/robots.txt`,
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
    },
    demoAllowedServer({
      port: PORT,
      demoPort: DEMO_PORT,
      reuseExistingServer: !process.env.CI,
      readyPath: '/robots.txt',
      vars: ['TURNSTILE_SITEKEY:1x00000000000000000000AA'],
    }),
    gaServer({
      port: PORT,
      gaPort: GA_PORT,
      reuseExistingServer: !process.env.CI,
      readyPath: '/robots.txt',
      vars: ['TURNSTILE_SITEKEY:1x00000000000000000000AA'],
    }),
  ],
})
