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

export default defineConfig({
  plugins: [
    modeBases(),
    navSlots(),
    noMapOnServer(),
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
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
                { name: 'ui', test: /packages[\\/]ui[\\/]src[\\/](?!map[\\/]|StopSearch)/ },
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
