import { defineConfig, devices } from '@playwright/test'

const PORT = 8796

/**
 * Smoke tests against the production build running in workerd (`wrangler dev`), in fixture mode so no live API is
 * needed. `pnpm test:e2e` builds first. The live LLM check against staging is playwright.llm.config.ts.
 */
export default defineConfig({
  testDir: 'tests',
  testIgnore: ['**/llm.spec.ts'],
  fullyParallel: true,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure' },
  projects: [
    { name: 'phone', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: `pnpm build && wrangler dev --port ${PORT} --var FIXTURES:1 --var ALLOW_FIXTURES:1`,
    url: `http://localhost:${PORT}/robots.txt`,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
  },
})
