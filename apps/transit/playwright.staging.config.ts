import { defineConfig, devices } from '@playwright/test'

/**
 * Checks against the deployed staging Worker (no local server): the live CSP with real Turnstile. Not part of
 * test:e2e. Run: `pnpm test:staging`. BASE_URL overrides the staging host.
 */
export default defineConfig({
  testDir: 'tests',
  testMatch: ['**/*.staging.spec.ts'],
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: process.env.BASE_URL ?? 'https://bft-transit.brisbanetransit.workers.dev',
    ...devices['Desktop Chrome'],
  },
})
