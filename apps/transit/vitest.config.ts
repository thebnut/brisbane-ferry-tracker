import { defineConfig } from 'vitest/config'
import { modeBases, navSlots } from './modes.config.ts'

/**
 * Three projects:
 *  - unit: transit's own code, built as BrisbaneTransit (mode bases defined, nav slots swapped)
 *  - parity-standalone / parity-transit: the same mode pages rendered from the same fixtures twice, once as each
 *    standalone app builds them and once as BrisbaneTransit does. Both must match one committed golden file per page
 *    (after removing the prefixes and the navigation, the only intended differences), which is the Phase 9 exit
 *    criterion "each tab matches its standalone app".
 * Playwright smoke tests live in tests/ (pnpm test:e2e).
 */
const shared = { environment: 'node', setupFiles: ['./test/setup.ts'] }

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [modeBases(), navSlots()],
        test: { ...shared, name: 'unit', include: ['test/**/*.test.{ts,tsx}'] },
      },
      {
        test: { ...shared, name: 'parity-standalone', include: ['test/parity/*.parity.tsx'] },
      },
      {
        plugins: [modeBases(), navSlots()],
        test: { ...shared, name: 'parity-transit', include: ['test/parity/*.parity.tsx'] },
      },
    ],
  },
})
