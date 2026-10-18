import { defineConfig, devices } from '@playwright/test'

/**
 * Live end-to-end check of the Ask box's LLM path against staging (real Turnstile token from a real browser, real
 * Haiku calls, real money: keep it to a handful of questions). Not part of test:e2e. Run: `pnpm test:llm`.
 * BASE_URL overrides the staging host; LLM_OUT writes the results as JSON.
 */
export default defineConfig({
  testDir: 'tests',
  testMatch: ['**/llm.spec.ts'],
  workers: 1,
  reporter: 'list',
  timeout: 180_000,
  use: {
    baseURL: process.env.BASE_URL ?? 'https://bft-transit.brisbanetransit.workers.dev',
    ...devices['Desktop Chrome'],
  },
})
