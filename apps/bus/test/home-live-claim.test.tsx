// @vitest-environment jsdom
/**
 * R36-L1 (P-13b327f-L1): bus home's header says LIVE only over a departure the page marks LIVE. A saved stop's card
 * marks its next bus (its pill); its "Then" times carry no marker, so a live bus there never makes the header LIVE
 * over a card that says nothing live (prod, 24 Oct: "222 … Departing", a live 61 after it, header LIVE).
 */
import type { Departure } from '@bft/core/contract'
import { reportOnline, VIA_NETWORK } from '@bft/ui/connectivity'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, waitFor } from '@testing-library/react'
import { createRoutesStub } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Home from '../app/routes/home.tsx'

const nowS = () => Math.floor(Date.now() / 1000)
const row = (route: string, inS: number, status: 'live' | 'scheduled') =>
  ({
    tripInstance: `trip-${route}`,
    route: { short: route },
    headsign: 'Roma Street station',
    platform: '1',
    vehicleId: null,
    schedDep: nowS() + inS,
    estDep: status === 'live' ? nowS() + inS : null,
    schedArrTo: null,
    estArrTo: null,
    status,
  }) as unknown as Departure
const answer = (rows: Departure[]) => ({
  schemaVersion: 1 as const,
  staticGeneration: 'g',
  serviceDates: ['20261024'],
  rtSourceTimestamp: nowS() - 10,
  rtState: 'live',
  generatedAt: Date.now(),
  mode: 'bus',
  stop: { key: '10802', name: 'Cultural Centre', stopIds: ['10802'] },
  to: null,
  departures: rows,
})

function mount(rows: Departure[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) =>
      String(input).includes('/departures')
        ? Response.json(answer(rows))
        : new Response('no', { status: 404 }),
    ),
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const loaderData = { serverSaved: [], initial: {}, renderedAt: Date.now(), via: VIA_NETWORK, siteUrl: '' }
  const Stub = createRoutesStub([
    {
      path: '/',
      Component: () => (
        <QueryClientProvider client={client}>
          {/* biome-ignore lint/suspicious/noExplicitAny: the route's generated props. */}
          <Home {...({ loaderData, params: {}, matches: [] } as any)} />
        </QueryClientProvider>
      ),
    },
  ])
  return render(<Stub initialEntries={['/']} />)
}

const header = () => document.querySelector('header') as HTMLElement
const card = () => document.querySelector('[data-home-section=saved] a') as HTMLElement
const headerLive = () => header().querySelector('[data-live-claim]') != null
const cardLive = () => card().querySelector('[data-live-claim]') != null

beforeEach(() => {
  reportOnline()
  localStorage.setItem('bft-bus-saved', JSON.stringify([{ id: '10802', name: 'Cultural Centre' }]))
})
afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe("bus home's header and saved card agree (R36-L1)", () => {
  it('the next bus timetabled ("Departing"), a live one after it: no pill on the card, no LIVE in the header', async () => {
    mount([row('222', 0, 'scheduled'), row('61', 30, 'live'), row('555', 90, 'live')])
    await waitFor(() => expect(card()).toHaveTextContent('222 to Roma Street station'))
    await waitFor(() => expect(card()).toHaveTextContent('Then'))
    // Let the card's report reach the header.
    await new Promise((r) => setTimeout(r, 50))
    expect(cardLive()).toBe(false)
    expect(headerLive()).toBe(false)
  })

  it('the next bus live: LIVE on the card and in the header', async () => {
    mount([row('61', 30, 'live'), row('222', 120, 'scheduled')])
    await waitFor(() => expect(cardLive()).toBe(true))
    await waitFor(() => expect(headerLive()).toBe(true))
  })
})
