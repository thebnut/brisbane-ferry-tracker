import { DEMO_ALLOWED_SPECS, demoAllowedProject, demoAllowedServer } from '@bft/ui/e2e/demo-allowed.ts'
import { GA_SPECS, gaProject, gaServer } from '@bft/ui/e2e/ga.ts'
import { onboardingAnswered } from '@bft/ui/e2e/onboarding.ts'
import { defineConfig, devices } from '@playwright/test'

const PORT = 8791
/** The GA-on server (@bft/ui/e2e/ga.ts): GA_MEASUREMENT_ID set, gtag.js stubbed in the specs. */
const GA_PORT = 8821
/** The demo-allowed server (R9, @bft/ui/e2e/demo-allowed.ts). */
const DEMO_PORT = 8801

/**
 * Smoke tests against the production build running in workerd (`wrangler dev`), in fixture mode so no live API is
 * needed. `pnpm test:e2e` builds first.
 */
export default defineConfig({
  testDir: 'tests',
  testIgnore: [DEMO_ALLOWED_SPECS, GA_SPECS],
  fullyParallel: true,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    // The first-visit onboarding prompt (P4) answered: only tests/onboarding.spec.ts starts from a real first visit.
    storageState: onboardingAnswered(`http://localhost:${PORT}`),
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
    demoAllowedProject(DEMO_PORT),
    gaProject(GA_PORT),
  ],
  webServer: [
    {
      command: `pnpm build && wrangler dev --port ${PORT} --var FIXTURES:1 --var ALLOW_FIXTURES:1`,
      url: `http://localhost:${PORT}/about`,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
    },
    demoAllowedServer({
      port: PORT,
      demoPort: DEMO_PORT,
      reuseExistingServer: !process.env.CI,
      readyPath: '/about',
    }),
    gaServer({
      port: PORT,
      gaPort: GA_PORT,
      reuseExistingServer: !process.env.CI,
      readyPath: '/about',
    }),
  ],
})
