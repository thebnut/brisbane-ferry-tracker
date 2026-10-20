import { DEMO_ALLOWED_SPECS, demoAllowedProject, demoAllowedServer } from '@bft/ui/e2e/demo-allowed.ts'
import { onboardingAnswered } from '@bft/ui/e2e/onboarding.ts'
import { defineConfig, devices } from '@playwright/test'

const PORT = 8789
/** The demo-allowed server (R9, @bft/ui/e2e/demo-allowed.ts). */
const DEMO_PORT = 8799

/**
 * Smoke tests against the production build running in workerd (`wrangler dev`), in fixture mode so no live API is
 * needed. `pnpm test:e2e` builds first.
 */
export default defineConfig({
  testDir: 'tests',
  testIgnore: [DEMO_ALLOWED_SPECS],
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
  ],
  webServer: [
    {
      command: `pnpm build && wrangler dev --port ${PORT} --var FIXTURES:1 --var ALLOW_FIXTURES:1 --var TRIP_WS:1`,
      url: `http://localhost:${PORT}/robots.txt`,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
    },
    demoAllowedServer({
      port: PORT,
      demoPort: DEMO_PORT,
      reuseExistingServer: !process.env.CI,
      readyPath: '/robots.txt',
      vars: ['TRIP_WS:1'],
    }),
  ],
})
