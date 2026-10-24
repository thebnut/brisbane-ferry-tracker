// @vitest-environment jsdom
/**
 * Release 17 review (Codex r1, P2-1/P2-2) for train:
 *  - /map?station= whose departures request fails (positions healthy) says it can't tell which trains stop there and
 *    offers All trains; never LIVE with "No trains at X have live positions";
 *  - the station's idle-panel map says positions are unavailable when they are, never "0 live trains".
 * R39-P2-2: the message stays through vehicle refreshes and each departures retry (in flight included), and the
 * filtered view comes back once departures answer.
 * SafeMap is a stand-in listing its markers (MapLibre needs WebGL); requests go through a stubbed fetch.
 */
import type { Departure, VehiclesResponse } from '@bft/core/contract'
import { deviceNow, reportOnline } from '@bft/ui/connectivity'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { createRoutesStub } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import StationMap from '../app/components/StationMap.tsx'
import { type Station, stationByKey } from '../app/lib/network.ts'
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
  mode: 'train',
  vehicles: [
    { id: 'train-1', label: 'IMU 101', tripKey: 'trip-1@20261024', lat: -27.466, lon: 153.026, ts: nowS() },
  ],
})
const departure = {
  tripInstance: 'trip-1@20261024',
  route: { short: 'BRBN' },
  headsign: 'Bowen Hills',
} as unknown as Departure
const departures = () => ({
  ...envelope(),
  mode: 'train',
  stop: { key: 'central', name: 'Central', stopIds: ['central'] },
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

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })
function mount(children: ReactNode, client = newClient()) {
  const Stub = createRoutesStub([
    { path: '/', Component: () => <QueryClientProvider client={client}>{children}</QueryClientProvider> },
  ])
  return render(<Stub initialEntries={['/']} />)
}
/** A fresh answer kept in the cache, due a refresh (which the test fails). */
function keptFresh(client: QueryClient) {
  client.setQueryData(
    ['train', 'vehicles', false, null],
    { ...vehicles(), receivedAt: deviceNow() },
    { updatedAt: Date.now() - 60_000 },
  )
}
const pulsing = () => screen.queryAllByTestId('map').flatMap((m) => [...m.querySelectorAll('[data-pulse]')])
const mode = { fixtures: false, rt: null }
const mapPage = () => (
  <MapPage {...({ loaderData: { station: 'central', trip: null, mode, siteUrl: '' } } as never)} />
)

beforeEach(() => reportOnline())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('/map?station= with a failed departures request', () => {
  it('healthy positions, failed departures: says it cannot tell, offers All trains, no LIVE', async () => {
    serve({ '/v1/train/vehicles': vehicles, '/departures': () => 503 })
    mount(mapPage())
    const why = await screen.findByText(/Can't tell which trains stop at Central right now\./)
    expect(screen.queryByText(/have live positions right now/)).toBeNull()
    expect(screen.queryByText('LIVE')).toBeNull()
    expect(screen.queryByText(/with live positions/)).toBeNull()
    expect(pulsing()).toHaveLength(0)
    fireEvent.click(why.querySelector('button') as HTMLButtonElement)
    expect(await screen.findByText('1 with live positions')).toBeTruthy()
    expect(screen.getByText('LIVE')).toBeTruthy()
    expect(pulsing()).toHaveLength(1)
  })

  it('positions kept after their refresh failed: none shown, no LIVE', async () => {
    serve({ '/v1/train/vehicles': () => 503, '/departures': departures })
    const client = newClient()
    keptFresh(client)
    mount(mapPage(), client)
    expect(await screen.findByText('Live positions are unavailable right now.')).toBeTruthy()
    expect(screen.queryByText('LIVE')).toBeNull()
    expect(pulsing()).toHaveLength(0)
  })

  it('healthy positions and departures: the trains at the station, LIVE', async () => {
    serve({ '/v1/train/vehicles': vehicles, '/departures': departures })
    mount(mapPage())
    expect(await screen.findByText('1 with live positions')).toBeTruthy()
    expect(screen.getByText('LIVE')).toBeTruthy()
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
        if (url.includes('/v1/train/vehicles')) return Response.json(vehicles())
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
        expect(screen.queryByText(/Can't tell which trains stop at Central right now\./)).toBeTruthy()
        expect(screen.queryByText('LIVE')).toBeNull()
        expect(screen.queryByText('Connecting…')).toBeNull()
        expect(document.querySelector('[data-map-count]')?.textContent ?? '').not.toMatch(
          /with live positions/,
        )
        expect(pulsing()).toHaveLength(0)
      }
      mount(mapPage())
      await until(() => !!screen.queryByText(/Can't tell which trains stop at Central right now\./))
      // Three vehicle refreshes and two departures retries later (each settled), every sample still says it can't tell: no count, no LIVE, no "Connecting…".
      await until(
        () => vehicleCalls() >= 4 && asked.length >= 3 && Date.now() - start - (asked.at(-1) ?? 0) > 1_500,
        saysSo,
      )
      // Asked again on the poll (15 s, backing off while it fails), never in a tight loop.
      expect(asked.length).toBeGreaterThanOrEqual(3)
      for (let i = 1; i < asked.length; i++) expect(asked[i] - asked[i - 1]).toBeGreaterThanOrEqual(12_000)
      // Departures answer again: the trains there, LIVE, with no reload.
      failing = false
      await until(() => !!screen.queryByText('1 with live positions'))
      expect(screen.queryByText(/Can't tell/)).toBeNull()
      expect(screen.getByText('LIVE')).toBeTruthy()
      expect(pulsing()).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a successful empty answer stays "No trains at Central have live positions right now."', async () => {
    serve({ '/v1/train/vehicles': vehicles, '/departures': () => ({ ...departures(), departures: [] }) })
    mount(mapPage())
    expect(await screen.findByText('No trains at Central have live positions right now.')).toBeTruthy()
  })
})

describe("the station's idle-panel map", () => {
  const panel = () => (
    <StationMap
      station={stationByKey('central') as Station}
      departures={[departure]}
      mode={{ fixtures: false, rt: null }}
      nowMs={Date.now()}
    />
  )

  it('a fresh answer: the live trains on its departures', async () => {
    serve({ '/v1/train/vehicles': vehicles })
    mount(panel())
    expect(await screen.findByText(/1 live train/)).toBeTruthy()
    expect(pulsing()).toHaveLength(1)
  })

  it('a failed positions request: unavailable, never "0 live trains"', async () => {
    serve({ '/v1/train/vehicles': () => 503 })
    mount(panel())
    expect(await screen.findByText('Live train positions are unavailable right now.')).toBeTruthy()
    expect(screen.queryByText(/0 live trains/)).toBeNull()
  })

  it('a fresh answer kept after its refresh failed: no positions, unavailable', async () => {
    serve({ '/v1/train/vehicles': () => 503 })
    const client = newClient()
    keptFresh(client)
    mount(panel(), client)
    expect(await screen.findByText('Live train positions are unavailable right now.')).toBeTruthy()
    expect(pulsing()).toHaveLength(0)
  })

  it('an answer whose TransLink source is an hour old: no positions, unavailable', async () => {
    serve({ '/v1/train/vehicles': () => ({ ...vehicles(), rtSourceTimestamp: nowS() - 3_600 }) })
    mount(panel())
    expect(await screen.findByText('Live train positions are unavailable right now.')).toBeTruthy()
    expect(pulsing()).toHaveLength(0)
  })
})
