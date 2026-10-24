// @vitest-environment jsdom
/**
 * Release 17 review (Codex r1, P2-1..P2-3): a failure never reads as live, or as an empty or geographic result.
 *  - the stop page's map (the desktop idle panel) and the route page show no pulsing buses and claim nothing live from
 *    errored or old positions, only "Live bus positions are unavailable right now.";
 *  - /map?stop= whose departures request fails (positions healthy) says it can't tell which buses, never LIVE;
 *  - home's Near you says its stop tiles failed (with Try again), or that the list may be incomplete, never "No bus
 *    stops within 2 km.".
 * SafeMap is a stand-in listing its markers (MapLibre needs WebGL); requests go through a stubbed fetch.
 */
import type { Departure, VehiclesResponse } from '@bft/core/contract'
import { deviceNow, reportOnline } from '@bft/ui/connectivity'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { createRoutesStub } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import NearYou from '../app/components/NearYou.tsx'
import StopMap from '../app/components/StopMap.tsx'
import MapPage from '../app/routes/map.tsx'
import RoutePage from '../app/routes/route.tsx'

vi.mock('@bft/ui/safe-map', () => ({
  default: ({ markers, label }: { markers: Array<{ id: string; pulse?: boolean }>; label: string }) => (
    <ul aria-label={label} data-testid="map">
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
const pulsing = () => screen.queryAllByTestId('map').flatMap((m) => [...m.querySelectorAll('[data-pulse]')])

beforeEach(() => reportOnline())
afterEach(() => {
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
  it('healthy positions, failed departures: says it cannot tell, no LIVE, no bus count', async () => {
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

  it('an answer whose TransLink source is an hour old: no buses, no LIVE, positions unavailable', async () => {
    serve({ '/v1/bus/vehicles': () => ({ ...vehicles(), rtSourceTimestamp: nowS() - 3_600 }) })
    mountRoute()
    expect(await screen.findByText('Live bus positions are unavailable right now.')).toBeTruthy()
    expect(screen.getByText('0 buses on route 66')).toBeTruthy()
    expect(screen.queryByText('LIVE')).toBeNull()
  })
})
