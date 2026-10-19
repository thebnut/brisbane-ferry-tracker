import { DEMO_ALLOWED_SPECS, demoAllowedProject, demoAllowedServer } from '@bft/ui/e2e/demo-allowed.ts'
import { defineConfig, devices } from '@playwright/test'

const PORT = 8791
/** The demo-allowed server (R9, @bft/ui/e2e/demo-allowed.ts). */
const DEMO_PORT = 8801

/**
 * Smoke tests against the production build running in workerd (`wrangler dev`), in fixture mode so no live API is
 * needed. `pnpm test:e2e` builds first.
 */
export default defineConfig({
  testDir: 'tests',
  testIgnore: [DEMO_ALLOWED_SPECS],
  fullyParallel: true,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
    demoAllowedProject(DEMO_PORT),
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
  ],
})
