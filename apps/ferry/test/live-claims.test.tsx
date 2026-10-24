// @vitest-environment jsdom
/**
 * Release 17 review (Codex r1, P2-1/P2-2) for ferry:
 *  - /map?terminal= whose departures request fails (positions healthy) says it can't tell which ferries serve the
 *    terminal and offers All ferries; never LIVE with "No ferries from X have GPS";
 *  - the terminal's idle-panel map says positions are unavailable when they are, never "0 live ferries".
 * SafeMap is a stand-in listing its markers (MapLibre needs WebGL); requests go through a stubbed fetch.
 */
import type { Departure, VehiclesResponse } from '@bft/core/contract'
import { reportOnline } from '@bft/ui/connectivity'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { createRoutesStub } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TerminalMap from '../app/components/TerminalMap.tsx'
import MapPage from '../app/routes/map.tsx'

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

const BULIMBA = '317584'
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
  mode: 'ferry',
  vehicles: [
    {
      id: 'ferry_Mooroolbin II',
      tripKey: 'trip-1',
      routeId: 'F1-4055',
      lat: -27.45,
      lon: 153.05,
      ts: nowS(),
    },
  ],
})
const departure = {
  tripInstance: 'trip-1',
  route: { short: 'F1' },
  headsign: 'Riverside',
} as unknown as Departure
const departures = () => ({
  ...envelope(),
  mode: 'ferry',
  stop: { key: BULIMBA, name: 'Bulimba', stopIds: [BULIMBA] },
  to: null,
  departures: [departure],
})

/** fetch answers by path: a body, or an HTTP status for a failure; anything else is a 404. */
function serve(answers: Record<string, () => unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const hit = Object.keys(answers).find((p) => String(input).includes(p))
      const body = hit ? answers[hit]() : 404
      return typeof body === 'number' ? new Response('no', { status: body }) : Response.json(body)
    }),
  )
}

function mount(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const Stub = createRoutesStub([
    { path: '/', Component: () => <QueryClientProvider client={client}>{children}</QueryClientProvider> },
  ])
  return render(<Stub initialEntries={['/']} />)
}
const pulsing = () => screen.queryAllByTestId('map').flatMap((m) => [...m.querySelectorAll('[data-pulse]')])
const mode = { fixtures: false, rt: null, forced: false, allowed: false }
const mapPage = () => (
  <MapPage {...({ loaderData: { terminal: BULIMBA, trip: null, mode, siteUrl: '' } } as never)} />
)

beforeEach(() => {
  reportOnline()
  // The idle panel's map renders only at 1024 px and wider.
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('/map?terminal= with a failed departures request', () => {
  it('healthy positions, failed departures: says it cannot tell, offers All ferries, no LIVE', async () => {
    serve({ '/v1/ferry/vehicles': vehicles, '/departures': () => 503 })
    mount(mapPage())
    const why = await screen.findByText(/Can't tell which ferries serve Bulimba right now\./)
    expect(screen.queryByText(/have GPS right now/)).toBeNull()
    expect(screen.queryByText('LIVE')).toBeNull()
    expect(screen.queryByText(/ferr(y|ies) with GPS/)).toBeNull()
    expect(pulsing()).toHaveLength(0)
    // All ferries: every ferry's position, live.
    fireEvent.click(why.querySelector('button') as HTMLButtonElement)
    expect(await screen.findByText('1 ferry with GPS')).toBeTruthy()
    expect(screen.getByText('LIVE')).toBeTruthy()
    expect(pulsing()).toHaveLength(1)
  })

  it('healthy positions and departures: the ferries from the terminal, LIVE', async () => {
    serve({ '/v1/ferry/vehicles': vehicles, '/departures': departures })
    mount(mapPage())
    expect(await screen.findByText('1 ferry with GPS')).toBeTruthy()
    expect(screen.getByText('LIVE')).toBeTruthy()
  })

  it('a successful empty answer stays "No ferries from Bulimba have GPS right now."', async () => {
    serve({ '/v1/ferry/vehicles': vehicles, '/departures': () => ({ ...departures(), departures: [] }) })
    mount(mapPage())
    expect(await screen.findByText('No ferries from Bulimba have GPS right now.')).toBeTruthy()
  })
})

describe("the terminal's idle-panel map", () => {
  const panel = (live = true) => (
    <TerminalMap
      terminal={{ id: BULIMBA, name: 'Bulimba' }}
      live={live}
      departures={[departure]}
      mode={{ fixtures: false, rt: null }}
    />
  )

  it('a fresh answer: the live ferries on its departures', async () => {
    serve({ '/v1/ferry/vehicles': vehicles })
    mount(panel())
    expect(await screen.findByText(/1 live ferry/)).toBeTruthy()
    expect(pulsing()).toHaveLength(1)
  })

  it('a failed positions request: unavailable, never "0 live ferries"', async () => {
    serve({ '/v1/ferry/vehicles': () => 503 })
    mount(panel())
    expect(await screen.findByText('Live ferry positions are unavailable right now.')).toBeTruthy()
    expect(screen.queryByText(/0 live ferries/)).toBeNull()
  })

  it('an answer whose TransLink source is an hour old: no positions, unavailable', async () => {
    serve({ '/v1/ferry/vehicles': () => ({ ...vehicles(), rtSourceTimestamp: nowS() - 3_600 }) })
    mount(panel())
    expect(await screen.findByText('Live ferry positions are unavailable right now.')).toBeTruthy()
    expect(pulsing()).toHaveLength(0)
  })
})
