/**
 * The picker with MapView and geolocation mocked: a stop picked from the list while the map is (re)loading is centred
 * on the map that loads next, never sent to a removed one (Codex review, P3 part 2 r4).
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

interface FakeMap {
  id: number
  jumpTo: ReturnType<typeof vi.fn>
  easeTo: ReturnType<typeof vi.fn>
}
const maps: FakeMap[] = []
let readyNow: Array<() => void> = []
const geoState: { current: { state: string; lat?: number; lon?: number } } = { current: { state: 'idle' } }

vi.mock('../src/map/MapView.tsx', () => ({
  default: function MapView({ onReady }: { onReady?: (m: unknown) => void }) {
    useEffect(() => {
      const m = {
        id: maps.length,
        jumpTo: vi.fn(),
        easeTo: vi.fn(),
        getZoom: () => 15,
        addSource: vi.fn(),
        addLayer: vi.fn(),
        on: vi.fn(),
        getSource: () => undefined,
        getCanvas: () => ({ style: {} }),
      }
      maps.push(m)
      // The basemap "loads" when the test says so.
      readyNow.push(() => onReady?.(m))
    }, [onReady])
    return <div />
  },
}))
vi.mock('../src/geolocation.ts', () => ({ useGeolocation: () => ({ geo: geoState.current }) }))

const { default: StopPickerMap } = await import('../src/StopPickerMap.tsx')

const STOPS = [{ id: 's1', name: 'Cultural Centre', lat: -27.4732, lon: 153.0195 }]

function renderPicker() {
  // jsdom lays nothing out: give the map box a size so the picker can seed its view.
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(800)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as RenderingContext)
  return render(
    <StopPickerMap
      title="Bus stops"
      noun="stop"
      shape="diamond"
      stops={STOPS}
      loadDepartures={() => new Promise(() => {})}
      renderOpen={() => null}
      save={{ label: () => 'Save', onClick: () => {} }}
      onClose={() => {}}
      className="h-96"
    />,
  )
}

const pickFromList = () => {
  fireEvent.click(screen.getByRole('button', { name: /Stops in view \(1\)/ }))
  fireEvent.click(screen.getByRole('button', { name: /Cultural Centre/ }))
}

describe('list picks while the map loads', () => {
  beforeEach(() => {
    maps.length = 0
    readyNow = []
    geoState.current = { state: 'idle' }
    vi.restoreAllMocks()
  })

  it('a pick before the first map is ready is centred once it is', () => {
    renderPicker()
    pickFromList()
    act(() => readyNow.shift()?.())
    expect(maps[0]?.jumpTo).toHaveBeenCalledWith({ center: [153.0195, -27.4732], zoom: 16 })
  })

  it('after a geolocation remount, a pick goes to the replacement map, not the removed one', () => {
    const view = renderPicker()
    act(() => readyNow.shift()?.())
    // Location arrives: the map remounts (key), the new one is still loading.
    geoState.current = { state: 'ok', lat: -27.47, lon: 153.02 }
    renderAgain(view)
    expect(maps).toHaveLength(2)
    pickFromList()
    expect(maps[0]?.easeTo).not.toHaveBeenCalled()
    act(() => readyNow.shift()?.())
    expect(maps[1]?.jumpTo).toHaveBeenCalledWith({ center: [153.0195, -27.4732], zoom: 16 })
  })
})

function renderAgain(view: ReturnType<typeof render>) {
  view.rerender(
    <StopPickerMap
      title="Bus stops"
      noun="stop"
      shape="diamond"
      stops={STOPS}
      loadDepartures={() => new Promise(() => {})}
      renderOpen={() => null}
      save={{ label: () => 'Save', onClick: () => {} }}
      onClose={() => {}}
      className="h-96"
    />,
  )
}
