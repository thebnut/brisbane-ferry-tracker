import { defineConfig } from 'vitest/config'

// Unit tests only; Playwright smoke tests live in tests/ (pnpm test:e2e).
export default defineConfig({
  test: { include: ['test/**/*.test.{ts,tsx}'], environment: 'node', setupFiles: ['./test/setup.ts'] },
})
