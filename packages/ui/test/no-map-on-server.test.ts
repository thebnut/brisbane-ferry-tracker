/**
 * The server builds' map stub (vite/no-map-on-server.ts): MapView and StopPickerMap are stubbed whatever the import's
 * spelling (package id or a relative path inside @bft/ui, which #115's OnboardingPicker used), and maplibre-gl itself
 * stops the build.
 */
import { describe, expect, it, vi } from 'vitest'
import { noMapOnServer, normalisePath } from '../vite/no-map-on-server.ts'

const SRC = decodeURIComponent(new URL('../src/', import.meta.url).pathname)
const FILES: Record<string, string> = {
  '@bft/ui/map': `${SRC}map/MapView.tsx`,
  '@bft/ui/stop-picker-map': `${SRC}StopPickerMap.tsx`,
  './StopPickerMap.tsx': `${SRC}StopPickerMap.tsx`,
  './map/MapView.tsx': `${SRC}map/MapView.tsx`,
  '../map/MapView': `${SRC}map/MapView.tsx`,
  './StopPickerMap.tsx?v=1': `${SRC}StopPickerMap.tsx?v=1`,
  '@bft/ui/stop-picker-map?x': `${SRC}StopPickerMap.tsx?x`,
  './other/MapView.tsx': '/somewhere/else/MapView.tsx',
}
const ctx = {
  resolve: vi.fn(async (id: string) => (FILES[id] ? { id: FILES[id] } : null)),
  error: (message: string): never => {
    throw new Error(message)
  },
}
const plugin = noMapOnServer()
const resolve = (id: string) => plugin.resolveId.call(ctx, id, `${SRC}OnboardingPicker.tsx`, {})

describe('noMapOnServer', () => {
  it('applies to the server (ssr) build only', () => {
    expect(plugin.applyToEnvironment({ name: 'ssr' })).toBe(true)
    expect(plugin.applyToEnvironment({ name: 'client' })).toBe(false)
  })

  it('stubs the map modules by resolved file, however they are imported', async () => {
    for (const id of [
      '@bft/ui/map',
      '@bft/ui/stop-picker-map',
      './StopPickerMap.tsx',
      './map/MapView.tsx',
      '../map/MapView',
    ])
      expect(await resolve(id), id).toBe('\0bft-map-stub')
    const stub = plugin.load.call(ctx, '\0bft-map-stub')
    for (const name of ['export default', 'BASEMAP_STYLE_URL', 'toCardDepartures', 'useWide'])
      expect(stub).toContain(name)
  })

  it('leaves everything else alone (and does not resolve unrelated imports)', async () => {
    ctx.resolve.mockClear()
    expect(await resolve('react')).toBeNull()
    expect(await resolve('./onboarding.ts')).toBeNull()
    expect(ctx.resolve).not.toHaveBeenCalled()
    expect(await resolve('./other/MapView.tsx')).toBeNull()
    expect(plugin.load.call(ctx, `${SRC}OnboardingPicker.tsx`)).toBeNull()
  })

  it('a query on the import is still the same file (Codex review)', async () => {
    for (const id of ['./StopPickerMap.tsx?v=1', '@bft/ui/stop-picker-map?x'])
      expect(await resolve(id), id).toBe('\0bft-map-stub')
  })

  it('compares Windows paths in one spelling (file URL vs resolver)', () => {
    expect(normalisePath('/C:/repo/packages/ui/src/StopPickerMap.tsx')).toBe(
      'C:/repo/packages/ui/src/StopPickerMap.tsx',
    )
    expect(normalisePath('C:\\repo\\packages\\ui\\src\\StopPickerMap.tsx')).toBe(
      'C:/repo/packages/ui/src/StopPickerMap.tsx',
    )
    expect(normalisePath('/Users/x/repo/src/a.tsx')).toBe('/Users/x/repo/src/a.tsx')
  })

  it('fails the build if maplibre-gl is loaded for the server anyway', () => {
    for (const id of [
      '/repo/node_modules/.pnpm/maplibre-gl@6.14.0/node_modules/maplibre-gl/dist/maplibre-gl.mjs',
      '/repo/node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs?url',
    ])
      expect(() => plugin.load.call(ctx, id)).toThrow(/maplibre-gl reached the server bundle/)
  })
})
