import { cloudflare } from '@cloudflare/vite-plugin'
import { reactRouter } from '@react-router/dev/vite'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin, type ResolveModulePreloadDependenciesFn, type Rolldown } from 'vite'
import { noMapOnServer } from '../../packages/ui/vite/no-map-on-server.ts'
import { modeBases, navSlots } from './modes.config.ts'
import { pwa } from './pwa.config.ts'

/**
 * A lazy import's preload list sits in the importing chunk, so on its page's first load. Leave out the chunks the
 * importer already imports statically, directly or not: they have loaded before the import can run, so preloading
 * them again does nothing. The bus search's Routes group (RouteResults, loaded on a keystroke), the map picker
 * (BusStopPicker, on the Map button), the favourites import (handoff-import, only for an #import= page), the
 * first-visit onboarding (Onboarding*, after hydration, P4) and the Settings sheet (on the gear) get no list at all.
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
  // The header's Settings sheet (THE-118 PR 2) too: it loads on a tap of the gear, and its list was on every page's
  // first load.
  if (/(RouteResults|BusStopPicker|handoff-import|Onboarding\w*|SettingsSheet)-[\w-]+\.js$/.test(file))
    return []
  // The ferry stop selector: its map (MapLibre, ~280 KB gz) loads on its Map button, not whenever the selector opens,
  // and the Map button loads with it. Off the list, which is on the boards' first load (~0 B to spare there).
  if (/StopSelector-[\w-]+\.js$/.test(file))
    deps = deps.filter((d) => !/(MapView|StopPickerMap|ui-map-toggle)-[\w-]+\.(js|css)$/.test(d))
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
                  // map stop picker (P3) is lazy, and its Map button is only on the stop searches (below). Onboarding (P4)
                  // loads after hydration. What's new (WhatsNew, changelog) stays in its route's chunk. The one header and
                  // status line (THE-118 PR 2) are on every page too: in their own chunk they cost ~1 KB gz more. The boards'
                  // alert count (THE-118 PR 3) is only on the boards. Their header and filter row (PR 5) stay here: in a
                  // chunk of their own they took ~1 KB off the transit pages but cost /ferry ~0.8 KB, past its budget. The
                  // destination sheet (PR 5) is opened on demand. Trip detail (PR 6) is only on the trip pages.
                  test: /packages[\\/]ui[\\/]src[\\/](?!map[\\/]|StopSearch|StopPickerMap|MapToggle|stop-picker|map-pref|demo-cleanup|handoff-codec|bus\.tsx|star\.tsx|SaveToast|AlertCountLink|train\.tsx|trip\.tsx|[Oo]nboarding|WhatsNew|changelog|DestinationSheet)|apps[\\/]transit[\\/]app[\\/](components[\\/](ModeHeader|ModeBar|StatusLine)\.tsx|lib[\\/](connection|useNow)\.ts)$/,
                },
                // The bus boards' elements (@bft/ui/bus) that only the Bus pages load. After 'ui', so the modules they
                // share stay there.
                { name: 'ui-bus', test: /packages[\\/]ui[\\/]src[\\/]bus\.tsx$/ },
                // The Save star and its toast (THE-118): on the train and bus boards, and in the ferry star's lazy chunk.
                { name: 'ui-star', test: /packages[\\/]ui[\\/]src[\\/](star\.tsx|SaveToast\.tsx)$/ },
                // The Map button beside the stop searches (P3): its own small chunk, so the ferry stop selector and the
                // train station search don't load the bus elements for it.
                { name: 'ui-map-toggle', test: /packages[\\/]ui[\\/]src[\\/](MapToggle\.tsx|map-pref\.ts)$/ },
                // Each mode's saved-stops store with the modules it always loads with (P4). Onboarding's lazy picker
                // imports the stores on their own; without these groups the bundler split them out of their chunks, which
                // added ~100–300 B of chunk overhead to every page's first load.
                { name: 'bus-store', test: /apps[\\/]bus[\\/]app[\\/]lib[\\/](storage|stops|base)\.ts$/ },
                { name: 'train-store', test: /apps[\\/]train[\\/]app[\\/]lib[\\/](storage|base)\.ts$/ },
                // The train elements (@bft/ui train.tsx, THE-118 PR 4) ride with the train network, which every train page
                // loads and no other page's first load does: in a chunk of their own they cost the train pages ~400 B more.
                {
                  name: 'network',
                  test: /apps[\\/]train[\\/]app[\\/]lib[\\/]network\.ts$|packages[\\/]ui[\\/]src[\\/]train\.tsx$/,
                },
                { name: 'ferry-store', test: /apps[\\/]ferry[\\/]app[\\/]lib[\\/](storage|names)\.ts$/ },
                // The ferry board with the modules its rows need (THE-118 PR 6): the trip page shares some of them, and
                // without this group the bundler split them out into a chunk of their own on /ferry's first load (+~300 B).
                {
                  name: 'FerryBoards',
                  test: /apps[\\/]ferry[\\/]app[\\/](components[\\/](FerryBoards|DepartureList)\.tsx|lib[\\/](departures|queries|api)\.ts)$/,
                },
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
