import { act, render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useGeolocation } from '../src/geolocation.ts'
import {
  ChipFilter,
  ModeAlertCard,
  ModePin,
  NearbyDepartureRow,
  SavedTripCard,
  SectionTabs,
} from '../src/multimodal.tsx'

describe('mode pins', () => {
  it.each([
    ['ferry', 'rounded-full'],
    ['train', 'rounded-[3px]'],
    ['bus', 'rotate-45'],
  ] as const)('%s pin is its shape', (mode, cls) => {
    const { container } = render(<ModePin mode={mode} />)
    expect(container.querySelector(`[data-pin="${mode}"]`)?.className).toContain(cls)
  })
})

describe('NearbyDepartureRow', () => {
  it('shows route, destination, walk, countdown and the cue', () => {
    render(
      <NearbyDepartureRow
        mode="bus"
        route="66"
        to="UQ Lakes"
        stop="Cultural Centre P1"
        walk="3 min walk"
        minutes={6}
        cue={{ text: 'Hurry', tone: 'hurry' }}
      />,
    )
    expect(screen.getByText('66')).toBeInTheDocument()
    expect(screen.getByText('Cultural Centre P1 · 3 min walk')).toBeInTheDocument()
    expect(screen.getByText('in 6 mins')).toBeInTheDocument()
    expect(screen.getByText('Hurry')).toBeInTheDocument()
  })

  it('cancelled rows say so and drop the cue', () => {
    render(
      <NearbyDepartureRow
        mode="ferry"
        route="F1"
        to="Riverside"
        minutes={3}
        cancelled
        cue={{ text: 'Hurry', tone: 'hurry' }}
      />,
    )
    expect(screen.getByText('CANCELLED')).toBeInTheDocument()
    expect(screen.queryByText('Hurry')).toBeNull()
  })
})

describe('SavedTripCard', () => {
  it('links with a mode-labelled name, shows LIVE, the time and "Then"', () => {
    render(
      <SavedTripCard
        mode="train"
        label="Train · Springfield line"
        title="Roma Street → Indooroopilly"
        live
        time="7:59 pm → 8:12 pm"
        minutes={21}
        later="8:14   8:29"
        href="/train/station/roma-street"
      />,
    )
    const link = screen.getByRole('link', { name: /Train.*Roma Street → Indooroopilly.*in 21 mins/ })
    expect(link).toHaveAttribute('href', '/train/station/roma-street')
    expect(screen.getByText('LIVE')).toBeInTheDocument()
    expect(screen.getByText('Then')).toBeInTheDocument()
    expect(screen.getByText('in 21 mins')).toBeInTheDocument()
  })

  it('empty state replaces the time row', () => {
    render(
      <SavedTripCard
        mode="bus"
        label="Bus"
        title="Stop 1"
        empty="No more departures today."
        href="/bus/stop/1"
      />,
    )
    expect(screen.getByText('No more departures today.')).toBeInTheDocument()
  })
})

describe('ModeAlertCard', () => {
  it('a network-wide notice has no mode and an impact highlights the card', () => {
    const { container } = render(
      <ModeAlertCard
        mode={null}
        scope="ALL SERVICES"
        severity="planned"
        title="Christmas timetable"
        impact="Affects a saved stop"
      />,
    )
    expect(container.querySelector('[data-mode="all"]')?.className).toContain('border-ferry-orange')
    expect(screen.getByText('PLANNED')).toBeInTheDocument()
  })
})

describe('ChipFilter and SectionTabs', () => {
  it('chips report the chosen value and mark it pressed', async () => {
    const onChange = vi.fn()
    render(
      <ChipFilter
        label="Modes"
        value="all"
        onChange={onChange}
        options={[
          { value: 'all', label: 'All' },
          { value: 'bus', label: 'Bus', count: 2 },
        ]}
      />,
    )
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: /Bus/ }))
    expect(onChange).toHaveBeenCalledWith('bus')
  })

  it('section tabs mark the current section', () => {
    render(
      <SectionTabs
        label="Bus sections"
        active="map"
        items={[
          { key: 'home', label: 'My stops', href: '/bus' },
          { key: 'map', label: 'Map', href: '/bus/map' },
        ]}
      />,
    )
    expect(screen.getByRole('link', { name: 'Map' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('navigation', { name: 'Bus sections' })).toBeInTheDocument()
  })
})

describe('useGeolocation', () => {
  afterEach(() => vi.unstubAllGlobals())

  function stubGeo(permission: PermissionState, result: 'ok' | 'denied') {
    const getCurrentPosition = vi.fn((ok: PositionCallback, err: PositionErrorCallback) =>
      result === 'ok'
        ? ok({ coords: { latitude: -27.47, longitude: 153.02, accuracy: 12 } } as GeolocationPosition)
        : err({ code: 1, PERMISSION_DENIED: 1 } as GeolocationPositionError),
    )
    vi.stubGlobal('navigator', {
      geolocation: { getCurrentPosition },
      permissions: { query: async () => ({ state: permission }) },
    })
    return getCurrentPosition
  }

  it('does not prompt on load unless permission was already granted', async () => {
    const get = stubGeo('prompt', 'ok')
    const { result } = renderHook(() => useGeolocation())
    await act(async () => {})
    expect(get).not.toHaveBeenCalled()
    expect(result.current.geo.state).toBe('idle')
    act(() => result.current.locate())
    expect(result.current.geo).toMatchObject({ state: 'ok', lat: -27.47 })
  })

  it('locates straight away when granted; reports denied', async () => {
    stubGeo('granted', 'ok')
    const granted = renderHook(() => useGeolocation())
    await act(async () => {})
    expect(granted.result.current.geo.state).toBe('ok')
    stubGeo('prompt', 'denied')
    const denied = renderHook(() => useGeolocation())
    act(() => denied.result.current.locate())
    expect(denied.result.current.geo.state).toBe('denied')
  })

  it('a fixed position skips GPS', () => {
    const get = stubGeo('granted', 'ok')
    const { result } = renderHook(() => useGeolocation({ lat: 1, lon: 2 }))
    expect(result.current.geo).toMatchObject({ state: 'ok', lat: 1, lon: 2 })
    expect(get).not.toHaveBeenCalled()
  })
})
