import { cloudflare } from '@cloudflare/vite-plugin'
import { reactRouter } from '@react-router/dev/vite'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vite'
import { modeBases, navSlots } from './modes.config.ts'
import { pwa } from './pwa.config.ts'

/**
 * MapLibre only ever renders in the browser (behind React.lazy), so the Worker bundle gets a stub instead of ~1 MB of
 * map code and its web-worker asset (same as the standalone apps).
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
// `react-router dev`, where it's useful for debugging; disable it everywhere else (as apps/ferry, train, bus: #51).
const inspectorPort = process.argv.includes('dev') ? undefined : false

export default defineConfig({
  plugins: [
    modeBases(),
    navSlots(),
    noMapOnServer(),
    cloudflare({ viteEnvironment: { name: 'ssr' }, inspectorPort }),
    tailwindcss(),
    reactRouter(),
    pwa(),
  ],
  build: { assetsInlineLimit: 0 },
  environments: {
    client: {
      build: {
        rolldownOptions: {
          output: {
            // Transit's route graph (three apps' pages + its own) otherwise splits the shared framework and UI code
            // into ~30 small chunks; each compresses alone, which cost 4–11 KB gz of first-load JS per page (measured: the
            // transit pages went from 148 to 144 KB, the Bus tab from 160 to 149 KB).
            codeSplitting: {
              groups: [
                {
                  name: 'framework',
                  test: /node_modules[\\/](react|react-dom|react-router|scheduler|@tanstack|turbo-stream|cookie|set-cookie-parser)[\\/]/,
                },
                {
                  name: 'ui',
                  // demo-cleanup is loaded on demand: off every page's first load.
                  test: /packages[\\/]ui[\\/]src[\\/](?!map[\\/]|StopSearch|demo-cleanup|bus\.tsx)/,
                },
                // The bus boards' elements (@bft/ui/bus) that only the Bus pages load. After 'ui', so the modules they
                // share stay there.
                { name: 'ui-bus', test: /packages[\\/]ui[\\/]src[\\/]bus\.tsx$/ },
              ],
            },
          },
        },
      },
    },
  },
  // Don't pick up the legacy root app's postcss.config.js (Tailwind 3); Tailwind 4 runs as a Vite plugin here.
  css: { postcss: { plugins: [] } },
  // Pre-bundle lazily imported deps so the dev server doesn't reload the page when they're first used.
  optimizeDeps: { include: ['maplibre-gl', '@leeoniya/ufuzzy'] },
})
