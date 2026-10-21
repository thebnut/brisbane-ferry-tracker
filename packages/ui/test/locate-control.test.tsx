/**
 * THE-112: the locate-me button on every map, with MapLibre's Marker and the map mocked and the browser's geolocation
 * and permissions faked. Granted locates on mount (dot, no camera move); prompt waits for a tap; a tap frames the map;
 * denied, unavailable and timed out answers say so under the button.
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import type { Map as MlMap } from 'maplibre-gl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('maplibre-gl', () => ({
  Marker: class {
    el: HTMLElement
    constructor({ element }: { element: HTMLElement }) {
      this.el = element
    }
    setLngLat(ll: [number, number]) {
      this.el.dataset.lngLat = ll.join(',')
      return this
    }
    addTo(m: { box: HTMLElement }) {
      m.box.appendChild(this.el)
      return this
    }
    remove() {
      this.el.remove()
    }
  },
}))

const { default: LocateControl, locateMessage } = await import('../src/map/LocateControl.tsx')

type Ctrl = { onAdd: (m: unknown) => HTMLElement; onRemove: () => void }
function fakeMap() {
  const box = document.createElement('div')
  document.body.appendChild(box)
  const layers: string[] = []
  const sources = new Map<string, { setData: ReturnType<typeof vi.fn> }>()
  const m = {
    box,
    layers,
    fitBounds: vi.fn(),
    addControl: (c: Ctrl) => box.appendChild(c.onAdd(m)),
    removeControl: (c: Ctrl) => c.onRemove(),
    getSource: (id: string) => sources.get(id),
    addSource: (id: string) => sources.set(id, { setData: vi.fn() }),
    addLayer: (l: { id: string }) => layers.push(l.id),
    getLayer: () => undefined,
  }
  return m
}

type Success = (p: { coords: { latitude: number; longitude: number; accuracy: number } }) => void
type Failure = (e: { code: number; PERMISSION_DENIED: 1; TIMEOUT: 3 }) => void
let pending: Array<{ ok: Success; fail: Failure }> = []
let permission: PermissionState = 'prompt'

beforeEach(() => {
  pending = []
  permission = 'prompt'
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: (ok: Success, fail: Failure) => pending.push({ ok, fail }) },
  })
  Object.defineProperty(navigator, 'permissions', {
    configurable: true,
    value: { query: () => Promise.resolve({ state: permission }) },
  })
})
afterEach(() => {
  document.body.innerHTML = ''
})

const answer = (lat = -27.4732, lon = 153.0195, accuracy = 30) =>
  act(() => pending.shift()?.ok({ coords: { latitude: lat, longitude: lon, accuracy } }))
const fail = (code: number) => act(() => pending.shift()?.fail({ code, PERMISSION_DENIED: 1, TIMEOUT: 3 }))

async function mount() {
  const map = fakeMap()
  render(<LocateControl map={map as unknown as MlMap} ready />)
  await act(async () => {}) // the permissions query
  return map
}

describe('LocateControl', () => {
  it('granted: locates on mount and shows the dot, but only a tap moves the map', async () => {
    permission = 'granted'
    const map = await mount()
    expect(pending).toHaveLength(1)
    await answer()
    expect(screen.getByLabelText('You are here').dataset.lngLat).toBe('153.0195,-27.4732')
    expect(map.layers).toContain('bft-you-accuracy')
    expect(map.fitBounds).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Show my location' }))
    await answer()
    expect(map.fitBounds).toHaveBeenCalledTimes(1)
    expect(map.fitBounds.mock.calls[0]?.[1]).toMatchObject({ maxZoom: 16 })
  })

  it('prompt then allow: nothing is asked until the tap, then it shows the busy state, the dot and moves', async () => {
    const map = await mount()
    expect(pending).toHaveLength(0)
    expect(screen.queryByLabelText('You are here')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show my location' }))
    const busy = screen.getByRole('button', { name: 'Finding your location…' })
    expect(busy).toHaveAttribute('aria-busy', 'true')
    expect(busy).toBeDisabled()
    await answer()
    expect(screen.getByLabelText('You are here')).toBeInTheDocument()
    expect(map.fitBounds).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('denied: an inline line under the button, no retry, no move', async () => {
    permission = 'denied'
    const map = await mount()
    // Known-denied on mount says nothing until the user asks.
    expect(screen.queryByRole('status')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show my location' }))
    await fail(1)
    expect(screen.getByRole('status')).toHaveTextContent(
      'Location is off. Allow it in your browser settings.',
    )
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Show my location' })).toBeEnabled()
    expect(map.fitBounds).not.toHaveBeenCalled()
  })

  it('unavailable: says so, and Try again asks again', async () => {
    const map = await mount()
    fireEvent.click(screen.getByRole('button', { name: 'Show my location' }))
    await fail(2)
    expect(screen.getByRole('status')).toHaveTextContent("Couldn't find your location.")
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(pending).toHaveLength(1)
    await answer()
    expect(map.fitBounds).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('timeout: says so, with Try again', async () => {
    await mount()
    fireEvent.click(screen.getByRole('button', { name: 'Show my location' }))
    await fail(3)
    expect(screen.getByRole('status')).toHaveTextContent("Couldn't find your location.")
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('a caller’s own geolocation is used instead of asking again', async () => {
    const map = fakeMap()
    const locate = vi.fn()
    const geo = { state: 'ok', lat: -27.5, lon: 153, accuracy: null } as const
    render(<LocateControl map={map as unknown as MlMap} ready source={{ geo, locate }} />)
    await act(async () => {})
    expect(pending).toHaveLength(0)
    expect(screen.getByLabelText('You are here').dataset.lngLat).toBe('153,-27.5')
    fireEvent.click(screen.getByRole('button', { name: 'Show my location' }))
    expect(locate).toHaveBeenCalledTimes(1)
  })

  it('locateMessage: only a failed answer has a line', () => {
    expect(locateMessage({ state: 'unavailable' })).toBe("Couldn't find your location.")
    expect(locateMessage({ state: 'locating' })).toBeNull()
  })
})
