/**
 * MapView's fitKey (THE-118 PR 6): a trip's "Track on map" follows a vehicle whose position can arrive after the
 * map's first fit. A new key fits once more, to the markers in `fitTo`; an unchanged one leaves the view alone.
 */
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const fits: Array<[[number, number], [number, number]]> = []
vi.mock('maplibre-gl', () => ({
  setWorkerUrl: () => {},
  Marker: class {
    setLngLat() {
      return this
    }
    addTo() {
      return this
    }
    remove() {}
  },
  Map: class {
    on() {}
    off() {}
    remove() {}
    addControl() {}
    removeControl() {}
    fitBounds(b: [[number, number], [number, number]]) {
      fits.push(b)
    }
    getSource() {
      return undefined
    }
  },
}))
vi.mock('maplibre-gl/dist/maplibre-gl-worker.mjs?url', () => ({ default: '' }))
vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}))

const { default: MapView } = await import('../src/map/MapView.tsx')

const stop = { id: 's', lat: -27.47, lon: 153.02, label: 'Stop' }
const ferry = { id: 'v', lat: -27.4, lon: 153.1, label: 'Ferry' }

describe('MapView fitKey', () => {
  it('fits again, to the followed vehicle, once its position arrives', () => {
    fits.length = 0
    const { rerender } = render(<MapView markers={[stop]} fitTo={['s', 'v']} fitKey="" label="Map" />)
    expect(fits).toHaveLength(1)
    // The vehicles poll again with nothing new to follow: the view stays.
    rerender(<MapView markers={[stop]} fitTo={['s', 'v']} fitKey="" label="Map" />)
    expect(fits).toHaveLength(1)
    rerender(<MapView markers={[stop, ferry]} fitTo={['s', 'v']} fitKey="v" label="Map" />)
    expect(fits).toHaveLength(2)
    const [[west, south], [east, north]] = fits[1] as [[number, number], [number, number]]
    expect(west <= ferry.lon && ferry.lon <= east && south <= ferry.lat && ferry.lat <= north).toBe(true)
    // It moves on later polls without the map jumping back to it.
    rerender(
      <MapView markers={[stop, { ...ferry, lat: -27.41 }]} fitTo={['s', 'v']} fitKey="v" label="Map" />,
    )
    expect(fits).toHaveLength(2)
  })
})
