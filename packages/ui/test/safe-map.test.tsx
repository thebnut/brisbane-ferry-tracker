import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Stands in for MapView (and so MapLibre): the factory runs only if SafeMap actually imports it.
const imported = vi.fn()
vi.mock('../src/map/MapView.tsx', () => {
  imported()
  return { default: ({ label }: { label: string }) => <section aria-label={label} /> }
})

/** A fresh SafeMap module per test: supportsWebGL() and the one-time warning are cached per page load. */
const load = async () => {
  vi.resetModules()
  return import('../src/map/SafeMap.tsx')
}

let warn: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  imported.mockClear()
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

const withWebGL2 = (ok: boolean) =>
  vi
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockImplementation(((kind: string) =>
      ok && kind === 'webgl2' ? { getExtension: () => null } : null) as never)

describe('supportsWebGL', () => {
  it('asks for webgl2 (MapLibre 6 has no WebGL1 fallback) and caches the answer', async () => {
    const ctx = withWebGL2(true)
    const { supportsWebGL } = await load()
    expect(supportsWebGL()).toBe(true)
    expect(supportsWebGL()).toBe(true)
    expect(ctx).toHaveBeenCalledTimes(1)
    expect(ctx).toHaveBeenCalledWith('webgl2')
  })

  it('is false when there is no WebGL2 context, or getContext throws', async () => {
    withWebGL2(false)
    expect((await load()).supportsWebGL()).toBe(false)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect((await load()).supportsWebGL()).toBe(false)
  })
})

describe('SafeMap / MapBoundary', () => {
  it('without WebGL2 shows the panel in the map box and never imports MapView (MapLibre)', async () => {
    withWebGL2(false)
    const { default: SafeMap } = await load()
    render(
      <SafeMap
        markers={[]}
        label="Route map"
        className="h-80 w-full"
        unavailable={<a href="/list">List</a>}
      />,
    )
    const panel = screen.getByRole('status')
    expect(panel).toHaveTextContent('Map unavailable on this device')
    expect(panel).toHaveClass('h-80', 'w-full')
    expect(screen.getByRole('link', { name: 'List' })).toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 20))
    expect(imported).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Route map')).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('with WebGL2 renders the map', async () => {
    withWebGL2(true)
    const { default: SafeMap } = await load()
    render(<SafeMap markers={[]} label="Route map" />)
    expect(await screen.findByLabelText('Route map')).toBeInTheDocument()
    expect(imported).toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
  })

  it('a map that throws on start shows the panel, keeps its siblings and warns once', async () => {
    withWebGL2(true)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { MapBoundary } = await load()
    const Boom = () => {
      throw new Error('Failed to initialize WebGL')
    }
    render(
      <main>
        <MapBoundary className="h-72">
          <Boom />
        </MapBoundary>
        <MapBoundary className="h-72">
          <Boom />
        </MapBoundary>
        <ul aria-label="Stops">
          <li>Stop 1</li>
        </ul>
      </main>,
    )
    expect(screen.getAllByText('Map unavailable on this device')).toHaveLength(2)
    expect(screen.getByRole('list', { name: 'Stops' })).toBeInTheDocument()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toMatch(/failed to start/)
  })
})
