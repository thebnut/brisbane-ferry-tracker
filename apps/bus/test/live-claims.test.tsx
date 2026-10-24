// @vitest-environment jsdom
/**
 * Release 17 review (Codex r1, P2-1..P2-3): a failure never reads as live, or as an empty or geographic result.
 *  - the stop page's map (the desktop idle panel) and the route page show no pulsing buses and claim nothing live from
 *    errored or old positions, only "Live bus positions are unavailable right now.";
 *  - /map?stop= whose departures request fails (positions healthy) says it can't tell which buses, never LIVE; it
 *    keeps saying so through vehicle refreshes and each departures retry, Try again asks at once, and the buses come
 *    back once departures answer (R39-P2-2);
 *  - home's Near you says its stop tiles failed (with Try again), or that the list may be incomplete, never "No bus
 *    stops within 2 km.".
 * SafeMap is a stand-in listing its markers (MapLibre needs WebGL); requests go through a stubbed fetch.
 */
import type { Departure, VehiclesResponse } from '@bft/core/contract'
import { deviceNow, reportOnline } from '@bft/ui/connectivity'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { createRoutesStub } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import NearYou from '../app/components/NearYou.tsx'
import StopMap from '../app/components/StopMap.tsx'
import MapPage from '../app/routes/map.tsx'
import RoutePage from '../app/routes/route.tsx'

/**
 * SafeMap stand-in: lists its markers, and reports a city-zoom view once mounted (the bus map then hints "Zoom in to
 * see bus stops").
 */
vi.mock('@bft/ui/safe-map', () => ({
  default: ({
    markers,
    label,
    onViewChange,
  }: {
    markers: Array<{ id: string; pulse?: boolean }>
    label: string
    onViewChange?: (b: unknown, zoom: number) => void
  }) => (
    <ul
      aria-label={label}
      data-testid="map"
      ref={(el) => {
        if (!el || el.dataset.viewed) return
        el.dataset.viewed = '1'
        onViewChange?.({ west: 153, south: -27.5, east: 153.1, north: -27.4 }, 10)
      }}
    >
      {markers.map((m) => (
        <li key={m.id} data-pulse={m.pulse ? '' : undefined}>
          {m.id}
        </li>
      ))}
    </ul>
  ),
}))

const nowS = () => Math.floor(Date.now() / 1000)
const envelope = () => ({
  schemaVersion: 1 as const,
  staticGeneration: 'g',
  serviceDates: ['20261024'],
  rtSourceTimestamp: nowS() - 10,
  rtState: 'live' as const,
  generatedAt: Date.now(),
})
const vehicles = (): VehiclesResponse => ({
  ...envelope(),
  mode: 'bus',
  vehicles: [{ id: 'bus-1', tripKey: 'trip-1', routeId: '66-1', lat: -27.47, lon: 153.02, ts: nowS() }],
})
const departure = {
  tripInstance: 'trip-1',
  route: { short: '66', long: 'UQ Lakes - RBWH' },
  headsign: 'RBWH',
} as unknown as Departure
const departures = () => ({
  ...envelope(),
  mode: 'bus',
  stop: { key: 's1', name: 'Cultural Centre', stopIds: ['s1'] },
  to: null,
  departures: [departure],
})

type Answer = unknown | number
/** fetch answers by path: a body, or an HTTP status for a failure; anything else is a 404. */
function serve(answers: Record<string, () => Answer>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const path = String(input)
      const hit = Object.keys(answers).find((p) => path.includes(p))
      const body = hit ? answers[hit]() : 404
      return typeof body === 'number' ? new Response('no', { status: body }) : Response.json(body)
    }),
  )
}

function mount(children: ReactNode, url = '/', client = newClient()) {
  const Stub = createRoutesStub([
    {
      path: '/',
      Component: () => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    },
  ])
  return render(<Stub initialEntries={[url]} />)
}
const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })
/** A fresh answer kept in the cache, due a refresh (which the test fails). */
function keptFresh(client: QueryClient, key: unknown[], body: object) {
  client.setQueryData(key, { ...body, receivedAt: deviceNow() }, { updatedAt: Date.now() - 60_000 })
}
const pulsing = () => screen.queryAllByTestId('map').flatMap((m) => [...m.querySelectorAll('[data-pulse]')])

beforeEach(() => reportOnline())
afterEach(() => {
  // A test that timed out with fake timers on never leaves them to the next.
  vi.useRealTimers()
  cleanup()
  vi.unstubAllGlobals()
})

describe('stop map (the stop page idle panel)', () => {
  it('shows the live buses on their way from a fresh answer', async () => {
    serve({ '/v1/bus/vehicles': vehicles })
    mount(<StopMap stopId="s1" name="Cultural Centre" live departures={[departure]} />)
    expect(await screen.findByText(/1 live bus on the way/)).toBeTruthy()
    expect(pulsing()).toHaveLength(1)
  })

  it('an hour-old answer kept after a failed refresh: no pulsing buses, no live wording', async () => {
    serve({ '/v1/bus/vehicles': () => 503 })
    const client = newClient()
    const old = { ...vehicles(), generatedAt: Date.now() - 3_600_000, rtSourceTimestamp: nowS() - 3_610 }
    client.setQueryData(
      ['bus', 'vehicles', false, null, null],
      { ...old, receivedAt: deviceNow() - 3_600_000 },
      { updatedAt: Date.now() - 3_600_000 },
    )
    mount(<StopMap stopId="s1" name="Cultural Centre" live departures={[departure]} />, '/', client)
    await waitFor(() =>
      expect(client.getQueryState(['bus', 'vehicles', false, null, null])?.status).toBe('error'),
    )
    expect(screen.getByText('Live bus positions are unavailable right now.')).toBeTruthy()
    expect(screen.queryByText(/live bus(es)? on the way/)).toBeNull()
    expect(pulsing()).toHaveLength(0)
  })

  it('a fresh answer kept after its refresh failed: no pulsing buses, no live wording', async () => {
    serve({ '/v1/bus/vehicles': () => 503 })
    const client = newClient()
    keptFresh(client, ['bus', 'vehicles', false, null, null], vehicles())
    mount(<StopMap stopId="s1" name="Cultural Centre" live departures={[departure]} />, '/', client)
    expect(await screen.findByText('Live bus positions are unavailable right now.')).toBeTruthy()
    expect(screen.queryByText(/live bus(es)? on the way/)).toBeNull()
    expect(pulsing()).toHaveLength(0)
  })

  it('a live answer whose TransLink source is an hour old is not live either', async () => {
    serve({ '/v1/bus/vehicles': () => ({ ...vehicles(), rtSourceTimestamp: nowS() - 3_600 }) })
    mount(<StopMap stopId="s1" name="Cultural Centre" live departures={[departure]} />)
    expect(await screen.findByText('Live bus positions are unavailable right now.')).toBeTruthy()
    expect(pulsing()).toHaveLength(0)
  })

  it('a failed positions request with nothing kept: unavailable, never "0 live buses"', async () => {
    serve({ '/v1/bus/vehicles': () => 503 })
    mount(<StopMap stopId="s1" name="Cultural Centre" live departures={[departure]} />)
    expect(await screen.findByText('Live bus positions are unavailable right now.')).toBeTruthy()
    expect(screen.queryByText(/0 live buses/)).toBeNull()
  })

  it('a board that is not live shows no positions', async () => {
    serve({ '/v1/bus/vehicles': vehicles })
    mount(<StopMap stopId="s1" name="Cultural Centre" live={false} departures={[departure]} />)
    expect(await screen.findByText('Live bus positions are unavailable right now.')).toBeTruthy()
    expect(pulsing()).toHaveLength(0)
  })
})

describe('/map?stop= with a failed departures request', () => {
  // Codex r1 (this PR): at city zoom the page hinted "Zoom in to see bus stops" over the failure.
  it('healthy positions, failed departures: says it cannot tell (even at city zoom), no LIVE, no bus count', async () => {
    serve({ '/v1/bus/vehicles': vehicles, '/departures': () => 503, '/data/bus/stops.json': () => 503 })
    mount(<MapPage />, '/?stop=s1')
    expect(
      await screen.findByText(/Can't tell which buses are heading to this stop right now\./),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
    expect(screen.queryByText('LIVE')).toBeNull()
    expect(screen.queryByText(/with live positions/)).toBeNull()
    expect(pulsing()).toHaveLength(0)
  })

  it('keeps saying so through vehicle refreshes and departures retries, until departures answer (R39-P2-2)', async () => {
    vi.useFakeTimers()
    try {
      let failing = true
      const asked: number[] = []
      const start = Date.now()
      // Each departures answer takes a second, so the page is also sampled while a retry is in flight.
      const fetch = vi.fn(async (input: string) => {
        const url = String(input)
        if (url.includes('/v1/bus/vehicles')) return Response.json(vehicles())
        if (!url.includes('/departures')) return new Response('no', { status: 404 })
        asked.push(Date.now() - start)
        await new Promise((done) => setTimeout(done, 1_000))
        return failing ? new Response('no', { status: 503 }) : Response.json(departures())
      })
      vi.stubGlobal('fetch', fetch)
      const vehicleCalls = () => fetch.mock.calls.filter(([u]) => String(u).includes('/vehicles')).length
      /** Steps fake time 250 ms at a time (`check` after each) until `done`, for at most two minutes. */
      const until = async (done: () => boolean, check = () => {}) => {
        for (let t = 0; !done(); t += 250) {
          expect(t).toBeLessThan(120_000)
          await act(async () => {
            await vi.advanceTimersByTimeAsync(250)
          })
          check()
        }
      }
      const saysSo = () => {
        expect(screen.queryByText(/Can't tell which buses are heading to this stop right now\./)).toBeTruthy()
        expect(screen.queryByText('LIVE')).toBeNull()
        expect(screen.queryByText('Connecting…')).toBeNull()
        expect(document.querySelector('[data-map-count]')?.textContent ?? '').not.toMatch(
          /with live positions/,
        )
        expect(pulsing()).toHaveLength(0)
      }
      mount(<MapPage />, '/?stop=s1')
      await until(() => !!screen.queryByText(/Can't tell which buses are heading to this stop right now\./))
      // Three vehicle refreshes and two departures retries later (each settled), every sample still says it can't tell: no count, no LIVE, no "Connecting…".
      await until(
        () => vehicleCalls() >= 4 && asked.length >= 3 && Date.now() - start - (asked.at(-1) ?? 0) > 1_500,
        saysSo,
      )
      // Asked again on the poll (15 s, backing off while it fails), never in a tight loop.
      expect(asked.length).toBeGreaterThanOrEqual(3)
      for (let i = 1; i < asked.length; i++) expect(asked[i] - asked[i - 1]).toBeGreaterThanOrEqual(12_000)
      // Try again asks at once, and the message stays while it does.
      const before = asked.length
      const clicked = Date.now()
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
      await until(() => Date.now() - clicked >= 1_500, saysSo)
      expect(asked.length).toBe(before + 1)
      expect(asked.at(-1) ?? 0).toBeLessThan(clicked - start + 250)
      // Departures answer again: the buses there, LIVE, with no reload.
      failing = false
      await until(() => !!screen.queryByText('1 with live positions'))
      expect(screen.queryByText(/Can't tell/)).toBeNull()
      expect(screen.getByText('LIVE')).toBeTruthy()
      expect(pulsing()).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
    // About 250 fake-time steps, each a render: slower than the 5 s default on CI runners.
  }, 30_000)

  it('positions kept after their refresh failed: no buses, no LIVE', async () => {
    serve({ '/v1/bus/vehicles': () => 503, '/departures': departures })
    const client = newClient()
    keptFresh(client, ['bus', 'vehicles', false, null, null], vehicles())
    mount(<MapPage />, '/?stop=s1', client)
    expect(await screen.findByText('Live positions are unavailable right now.')).toBeTruthy()
    expect(screen.queryByText('LIVE')).toBeNull()
    expect(pulsing()).toHaveLength(0)
  })

  it('healthy positions and departures: the buses heading there, LIVE', async () => {
    serve({ '/v1/bus/vehicles': vehicles, '/departures': departures })
    mount(<MapPage />, '/?stop=s1')
    expect(await screen.findByText('1 with live positions')).toBeTruthy()
    expect(screen.getByText('LIVE')).toBeTruthy()
    expect(pulsing()).toHaveLength(1)
  })
})

describe("home's Near you", () => {
  const tile = { stops: [{ key: 's1', name: 'Near stop', lat: -27.4705, lon: 153.0235 }] }

  it('every tile failed: a load failure with Try again, never "No bus stops within 2 km."', async () => {
    serve({ '/data/bus/geo/': () => 503 })
    mount(<NearYou lat={-27.4705} lon={153.0235} nowMs={Date.now()} />)
    expect(await screen.findByText(/Couldn't load stops near you\./)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
    expect(screen.queryByText('No bus stops within 2 km.')).toBeNull()
  })

  it('some tiles failed: the stops found, and the list may be incomplete', async () => {
    let n = 0
    serve({ '/data/bus/geo/': () => (n++ === 0 ? tile : 503) })
    mount(<NearYou lat={-27.4705} lon={153.0235} nowMs={Date.now()} />)
    expect(await screen.findByText(/this list may be incomplete/)).toBeTruthy()
    expect(screen.getByText('Near stop')).toBeTruthy()
  })

  it('no tile failed and none has a stop: no bus stops within 2 km', async () => {
    serve({})
    mount(<NearYou lat={-27.4705} lon={153.0235} nowMs={Date.now()} />)
    expect(await screen.findByText('No bus stops within 2 km.')).toBeTruthy()
  })
})

describe('route page', () => {
  function mountRoute(client = newClient()) {
    const route = {
      short: '66',
      patterns: [
        {
          directionId: 0,
          headsign: 'RBWH',
          trips: 9,
          stops: [{ key: 's1', name: 'Cultural Centre', lat: -27.47, lon: 153.02 }],
        },
      ],
    }
    const Stub = createRoutesStub([
      {
        path: '/',
        Component: () => (
          <QueryClientProvider client={client}>
            <RoutePage {...({ loaderData: { route, renderedAt: Date.now(), siteUrl: '' } } as never)} />
          </QueryClientProvider>
        ),
      },
    ])
    return render(<Stub initialEntries={['/']} />)
  }

  it('a fresh answer: its buses and LIVE', async () => {
    serve({ '/v1/bus/vehicles': vehicles })
    mountRoute()
    expect(await screen.findByText('1 bus on route 66')).toBeTruthy()
    expect(screen.getAllByText('LIVE').length).toBeGreaterThan(0)
  })

  it('a fresh answer kept after its refresh failed: no buses, no LIVE', async () => {
    serve({ '/v1/bus/vehicles': () => 503 })
    const client = newClient()
    keptFresh(client, ['bus', 'vehicles', false, null, '66'], vehicles())
    mountRoute(client)
    expect(await screen.findByText('Live bus positions are unavailable right now.')).toBeTruthy()
    expect(screen.queryByText('LIVE')).toBeNull()
  })

  it('an answer whose TransLink source is an hour old: no buses, no LIVE, positions unavailable', async () => {
    serve({ '/v1/bus/vehicles': () => ({ ...vehicles(), rtSourceTimestamp: nowS() - 3_600 }) })
    mountRoute()
    expect(await screen.findByText('Live bus positions are unavailable right now.')).toBeTruthy()
    expect(screen.getByText('0 buses on route 66')).toBeTruthy()
    expect(screen.queryByText('LIVE')).toBeNull()
  })
})
