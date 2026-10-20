import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MapBoundary, supportsWebGL } from '../src/StopPickerMap.tsx'

function Boom(): never {
  throw new Error('Failed to initialize WebGL')
}

describe('map without WebGL (R13-R1)', () => {
  afterEach(() => vi.restoreAllMocks())

  it('supportsWebGL is false when the browser has no WebGL 2 context, and never throws', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    expect(supportsWebGL()).toBe(false)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(supportsWebGL()).toBe(false)
  })

  it('a map that fails anyway shows the fallback instead of taking down the page', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <div>
        <p>Search stays</p>
        <MapBoundary fallback={<p>Map unavailable on this device</p>}>
          <Boom />
        </MapBoundary>
      </div>,
    )
    expect(screen.getByText('Map unavailable on this device')).toBeTruthy()
    expect(screen.getByText('Search stays')).toBeTruthy()
  })
})
