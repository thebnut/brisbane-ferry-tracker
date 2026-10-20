import { cloudflare } from '@cloudflare/vite-plugin'
import { reactRouter } from '@react-router/dev/vite'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin, type ResolveModulePreloadDependenciesFn, type Rolldown } from 'vite'
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
    resolveId: (id) => (id === '@bft/ui/map' || id === '@bft/ui/stop-picker-map' ? stub : null),
    load: (id) =>
      id === stub
        ? 'export default function MapView() { return null }\nexport const BASEMAP_STYLE_URL = ""\n' +
          // The map stop picker (@bft/ui/stop-picker-map) imports MapView by path, so it is stubbed whole.
          'export const toCardDepartures = () => []\nexport const useWide = () => false'
        : null,
  }
}

/**
 * A lazy import's preload list sits in the importing chunk, so on its page's first load. Leave out the chunks the
 * importer already imports statically, directly or not: they have loaded before the import can run, so preloading
 * them again does nothing. The bus search's Routes group (RouteResults, loaded on a keystroke), the map picker
 * (BusStopPicker, on the Map button) and the favourites import (handoff-import, only for an #import= page) get no list
 * at all.
 * Vite calls resolveDependencies from its own generateBundle, after this plugin's (enforce: 'pre') has kept the bundle.
 */
let clientBundle: Rolldown.OutputBundle | null = null
function keepClientBundle(): Plugin {
  return {
    name: 'bft:keep-client-bundle',
    enforce: 'pre',
    applyToEnvironment: (env) => env.name === 'client',
    generateBundle(_, bundle) {
      clientBundle = bundle
    },
  }
}
function loadedWith(host: string, bundle: Rolldown.OutputBundle): Set<string> {
  const seen = new Set<string>()
  const visit = (file: string) => {
    const chunk = bundle[file]
    if (chunk?.type !== 'chunk') return
    for (const dep of chunk.imports) {
      if (seen.has(dep)) continue
      seen.add(dep)
      visit(dep)
    }
  }
  visit(host)
  return seen
}
const resolveDependencies: ResolveModulePreloadDependenciesFn = (file, deps, { hostId }) => {
  if (/(RouteResults|BusStopPicker|handoff-import)-[\w-]+\.js$/.test(file)) return []
  if (!clientBundle) return deps
  const loaded = loadedWith(hostId, clientBundle)
  return deps.filter((d) => !loaded.has(d))
}

// Parallel builds and tests (pnpm mono:build) each opened the Worker inspector on 9229 (EADDRINUSE). Keep it for
// `react-router dev`, where it's useful for debugging; disable it everywhere else (as apps/ferry, train, bus: #51).
const inspectorPort = process.argv.includes('dev') ? undefined : false

export default defineConfig({
  plugins: [
    keepClientBundle(),
    modeBases(),
    navSlots(),
    noMapOnServer(),
    cloudflare({ viteEnvironment: { name: 'ssr' }, inspectorPort }),
    tailwindcss(),
    reactRouter(),
    pwa(),
  ],
  build: {
    assetsInlineLimit: 0,
    modulePreload: { resolveDependencies },
  },
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
                  // demo-cleanup and handoff-codec (P6b's import) are loaded on demand: off every page's first load. The
                  // map stop picker (P3) is lazy, and its Map button is only on the stop searches (below).
                  test: /packages[\\/]ui[\\/]src[\\/](?!map[\\/]|StopSearch|StopPickerMap|MapToggle|stop-picker|map-pref|demo-cleanup|handoff-codec|bus\.tsx)/,
                },
                // The bus boards' elements (@bft/ui/bus) that only the Bus pages load. After 'ui', so the modules they
                // share stay there.
                { name: 'ui-bus', test: /packages[\\/]ui[\\/]src[\\/]bus\.tsx$/ },
                // The Map button beside the stop searches (P3): its own small chunk, so the other modes' searches don't
                // load the bus elements for it.
                { name: 'ui-map-toggle', test: /packages[\\/]ui[\\/]src[\\/](MapToggle\.tsx|map-pref\.ts)$/ },
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
