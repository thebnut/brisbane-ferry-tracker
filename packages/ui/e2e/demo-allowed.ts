/**
 * A second local server for each app's `demo-allowed` Playwright project (R9): demo mode allowed but not forced
 * (ALLOW_FIXTURES=1, FIXTURES=0), as on staging, so the one-off demo clean-up runs on a first load. The default
 * server forces fixtures for everyone (FIXTURES=1), where the clean-up never runs. Pages here are ordinary visits;
 * the Worker's API calls go to its own recorded responses (API_BASE → /__fixtures), so no live API is needed.
 */
import { devices } from '@playwright/test'
import { onboardingAnswered } from './onboarding.ts'

/** Specs that run only against the demo-allowed server. */
export const DEMO_ALLOWED_SPECS = '**/*.demo.spec.ts'

export function demoAllowedServer({
  port,
  demoPort,
  readyPath,
  vars = [],
  reuseExistingServer,
}: {
  /** The default server's port: its `pnpm build` must finish before this one starts. */
  port: number
  demoPort: number
  readyPath: string
  vars?: string[]
  /** As the default server's (the configs: not on CI). */
  reuseExistingServer: boolean
}) {
  // Its own inspector port: two `wrangler dev` starting together can race for the default one.
  const extra = vars.map((v) => ` --var ${v}`).join('')
  return {
    command: `until curl -sf http://localhost:${port}${readyPath} >/dev/null; do sleep 1; done; wrangler dev --port ${demoPort} --inspector-port ${demoPort + 10_000} --var FIXTURES:0 --var ALLOW_FIXTURES:1 --var API_BASE:http://localhost:${demoPort}/__fixtures${extra}`,
    url: `http://localhost:${demoPort}${readyPath}`,
    timeout: 240_000,
    reuseExistingServer,
  }
}

export const demoAllowedProject = (demoPort: number) => ({
  name: 'demo-allowed',
  testMatch: DEMO_ALLOWED_SPECS,
  // The config-wide testIgnore leaves these specs out of the other projects.
  testIgnore: [],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://localhost:${demoPort}`,
    // The first-visit onboarding prompt (P4) stays out of these specs' way.
    storageState: onboardingAnswered(`http://localhost:${demoPort}`),
  },
})
