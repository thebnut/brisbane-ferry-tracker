/**
 * Keeps MapLibre out of every server (Worker) bundle. Maps only ever render in the browser behind React.lazy, so the
 * SSR build gets a stub for the two modules that import maplibre-gl: `map/MapView.tsx` (`@bft/ui/map`) and
 * `StopPickerMap.tsx` (`@bft/ui/stop-picker-map`, which imports MapView by path). Without it the Worker carries ~1 MB
 * of map code plus its web-worker asset, whose dangling source map makes `wrangler deploy` fail.
 *
 * The stub is chosen by the **resolved file**, not the import's spelling: a relative import inside @bft/ui
 * (OnboardingPicker's `./StopPickerMap.tsx`, P4) slipped past the old id-only check (#115). As a last line, the build
 * stops if anything from maplibre-gl is still loaded for the server.
 *
 * Imported by path from each app's vite.config.ts. It uses no Vite types, so it compiles where Vite isn't a direct
 * dependency (this package); the apps' `plugins` arrays check its shape.
 */
const STUB = '\0bft-map-stub'
/** This package's src/ on disk (a plain file URL decoded: `node:url` types aren't a dependency here). */
const SRC = decodeURIComponent(new URL('../src/', import.meta.url).pathname)
const STUBBED = new Set([`${SRC}map/MapView.tsx`, `${SRC}StopPickerMap.tsx`])
/** Imports that may point at a stubbed file: the two package entry points, or a path ending in either name. */
const CANDIDATE = /^@bft\/ui\/(map|stop-picker-map)$|(^|\/)(MapView|StopPickerMap)(\.tsx)?$/
const MAPLIBRE = /[\\/]node_modules[\\/](\.pnpm[\\/][^\\/]*[\\/]node_modules[\\/])?maplibre-gl[\\/]/

/** What the stub exports: MapView's and StopPickerMap's runtime exports, inert. */
const STUB_CODE = [
  'export default function MapStub() { return null }',
  'export const BASEMAP_STYLE_URL = ""',
  'export const toCardDepartures = () => []',
  'export const useWide = () => false',
].join('\n')

interface ResolveContext {
  resolve(id: string, importer?: string, options?: Record<string, unknown>): Promise<{ id: string } | null>
  error(message: string): never
}

export function noMapOnServer() {
  return {
    name: 'bft:no-map-on-server',
    enforce: 'pre' as const,
    applyToEnvironment: (env: { name: string }) => env.name === 'ssr',
    async resolveId(
      this: ResolveContext,
      id: string,
      importer: string | undefined,
      options: Record<string, unknown>,
    ) {
      if (!CANDIDATE.test(id)) return null
      const r = await this.resolve(id, importer, { ...options, skipSelf: true })
      return r && STUBBED.has(r.id.split('?')[0] as string) ? STUB : null
    },
    load(this: ResolveContext, id: string) {
      if (id === STUB) return STUB_CODE
      if (MAPLIBRE.test(id))
        this.error(
          `maplibre-gl reached the server bundle (${id}): import maps only through @bft/ui's map modules`,
        )
      return null
    },
  }
}
