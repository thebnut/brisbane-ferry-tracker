import { cloudflare } from '@cloudflare/vite-plugin'
import { reactRouter } from '@react-router/dev/vite'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { gaModule } from '../../packages/ui/vite/ga-module.ts'
import { noMapOnServer } from '../../packages/ui/vite/no-map-on-server.ts'
import { pwa } from './pwa.config.ts'

// Parallel builds and tests (pnpm mono:build) each opened the Worker inspector on 9229 (EADDRINUSE). Keep it for
// `react-router dev`, where it's useful for debugging; disable it everywhere else.
const inspectorPort = process.argv.includes('dev') ? undefined : false

export default defineConfig({
  plugins: [
    // MapLibre only renders in the browser (behind React.lazy): the Worker bundle gets a stub (as ferry, bus, transit).
    noMapOnServer(),
    gaModule(),
    cloudflare({ viteEnvironment: { name: 'ssr' }, inspectorPort }),
    tailwindcss(),
    reactRouter(),
    pwa(),
  ],
  build: { assetsInlineLimit: 0 },
  // Don't pick up the legacy root app's postcss.config.js (Tailwind 3); Tailwind 4 runs as a Vite plugin here.
  css: { postcss: { plugins: [] } },
  // Pre-bundle lazily imported deps so the dev server doesn't reload the page when they're first used.
  optimizeDeps: {
    include: ['maplibre-gl', '@leeoniya/ufuzzy'],
  },
})
