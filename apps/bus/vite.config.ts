import { cloudflare } from '@cloudflare/vite-plugin'
import { reactRouter } from '@react-router/dev/vite'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vite'
import { pwa } from './pwa.config.ts'

/**
 * MapLibre only ever renders in the browser (behind React.lazy), so the Worker bundle gets a stub instead of ~1 MB of
 * map code and its web-worker asset (same as apps/ferry).
 */
function noMapOnServer(): Plugin {
  const stub = '\0bft-map-stub'
  return {
    name: 'bft:no-map-on-server',
    enforce: 'pre',
    applyToEnvironment: (env) => env.name === 'ssr',
    resolveId: (id) => (id === '@bft/ui/map' ? stub : null),
    load: (id) =>
      id === stub
        ? 'export default function MapView() { return null }\nexport const BASEMAP_STYLE_URL = ""'
        : null,
  }
}

// Parallel builds and tests (pnpm mono:build) each opened the Worker inspector on 9229 (EADDRINUSE). Keep it for
// `react-router dev`, where it's useful for debugging; disable it everywhere else.
const inspectorPort = process.argv.includes('dev') ? undefined : false

export default defineConfig({
  plugins: [
    noMapOnServer(),
    cloudflare({ viteEnvironment: { name: 'ssr' }, inspectorPort }),
    tailwindcss(),
    reactRouter(),
    pwa(),
  ],
  build: { assetsInlineLimit: 0 },
  // Don't pick up the legacy root app's postcss.config.js (Tailwind 3); Tailwind 4 runs as a Vite plugin here.
  css: { postcss: { plugins: [] } },
  // Pre-bundle lazily imported deps so the dev server doesn't reload the page when they're first used.
  optimizeDeps: { include: ['maplibre-gl', '@leeoniya/ufuzzy'] },
})
