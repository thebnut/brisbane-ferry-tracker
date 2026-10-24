// @vitest-environment jsdom
/**
 * Codex release review r2 (P2): train home's Near you rows whose departures request fails say "Departures
 * unavailable" with a Try again beside the board link, never "No more departures today" and never LIVE. The message
 * holds through each poll's request in flight, Try again asks at once, and the next successful answer shows the
 * departure with no reload. "No more departures today" only from a successful answer with none to come.
 */
import type { Departure } from '@bft/core/contract'
import { reportOnline } from '@bft/ui/connectivity'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createRoutesStub } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Shell } from '../app/components/Chrome.tsx'
import NearYou from '../app/components/NearYou.tsx'
import { STATIONS } from '../app/lib/network.ts'

const CENTRAL = STATIONS.find((s) => s.name.startsWith('Central')) as (typeof STATIONS)[number]
const nowS = () => Math.floor(Date.now() / 1000)
const departure = (inS: number) =>
  ({
    tripInstance: `trip-${inS}`,
    route: { short: 'BRCL' },
    headsign: 'Ipswich station',
    schedDep: nowS() + inS,
    estDep: nowS() + inS,
    status: 'live',
  }) as unknown as Departure
const answer = (rows: Departure[], rtState = 'live') => ({
  schemaVersion: 1 as const,
  staticGeneration: 'g',
  serviceDates: ['20261024'],
  rtSourceTimestamp: nowS() - 10,
  rtState,
  generatedAt: Date.now(),
  mode: 'train',
  stop: { key: 's', name: 'S', stopIds: ['s'] },
  to: null,
  departures: rows,
})

const mode = { fixtures: false, rt: null }
const DEPS = (input: string) => String(input).includes('/departures')
/** No other requests here. */
const TILE = (_input: string): unknown => null
/** The page header claims LIVE (train's rows report to its Shell). */
const liveClaimed = () => document.querySelector('header [data-live-claim]') != null

function mount(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const Stub = createRoutesStub([
    {
      path: '/',
      Component: () => (
        <QueryClientProvider client={client}>
          <Shell active="stations" live={false}>
            <NearYou lat={CENTRAL.lat} lon={CENTRAL.lon} nowMs={Date.now()} mode={mode} />
          </Shell>
        </QueryClientProvider>
      ),
    },
  ])
  return render(<Stub initialEntries={['/']} />)
}

beforeEach(() => {
  reportOnline()
})
afterEach(() => {
  vi.useRealTimers()
  cleanup()
  vi.unstubAllGlobals()
})

describe("train home's Near you, departures failing", () => {
  it('unavailable with Try again through every retry in flight, then the departure once it answers', async () => {
    vi.useFakeTimers()
    let failing = true
    const asked: number[] = []
    const start = Date.now()
    // Each answer takes a second, so the rows are also sampled while a request is in flight.
    const fetch = vi.fn(async (input: string) => {
      if (!DEPS(input)) return TILE(input) ? Response.json(TILE(input)) : new Response('no', { status: 404 })
      asked.push(Date.now() - start)
      await new Promise((done) => setTimeout(done, 1_000))
      return failing ? new Response('no', { status: 503 }) : Response.json(answer([departure(600)]))
    })
    vi.stubGlobal('fetch', fetch)
    const until = async (done: () => boolean, check = () => {}) => {
      for (let t = 0; !done(); t += 250) {
        expect(t).toBeLessThan(120_000)
        await act(async () => {
          await vi.advanceTimersByTimeAsync(250)
        })
        check()
      }
    }
    const unavailable = () => screen.queryAllByText(/Departures unavailable/).length
    const saysSo = () => {
      expect(unavailable()).toBe(3)
      expect(screen.queryByText(/No more departures today/)).toBeNull()
      expect(screen.queryByText(/Getting departures/)).toBeNull()
      expect(liveClaimed()).toBe(false)
    }
    mount()
    await until(() => unavailable() === 3)
    // Every row stays a link to its board, with its own Try again beside it.
    expect(screen.getByRole('list', { name: 'Nearest stations' }).querySelectorAll('a')).toHaveLength(3)
    expect(screen.getAllByRole('button', { name: /^Try again: / })).toHaveLength(3)
    // Two more polls per row (each settled): every sample still says so.
    await until(() => asked.length >= 9 && Date.now() - start - (asked.at(-1) ?? 0) > 1_500, saysSo)
    // Try again asks for that row at once, and the message stays while it does.
    const before = asked.length
    const clicked = Date.now()
    fireEvent.click(screen.getAllByRole('button', { name: /^Try again: / })[0] as HTMLElement)
    await until(() => Date.now() - clicked >= 1_500, saysSo)
    expect(asked.filter((t) => t >= clicked - start && t < clicked - start + 250)).toHaveLength(1)
    expect(asked.length).toBeLessThanOrEqual(before + 4)
    // Departures answer: each row's departure, LIVE, with no reload.
    failing = false
    await until(() => screen.queryAllByText('Ipswich').length === 3)
    expect(unavailable()).toBe(0)
    expect(screen.queryByRole('button', { name: /^Try again/ })).toBeNull()
    expect(liveClaimed()).toBe(true)
  }, 30_000)

  it('a successful answer with none to come: "No more departures today", no Try again', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => Response.json(DEPS(input) ? answer([]) : TILE(input))),
    )
    mount()
    await waitFor(() => expect(screen.getAllByText(/No more departures today/)).toHaveLength(3))
    expect(screen.queryByText(/Departures unavailable/)).toBeNull()
    expect(screen.queryByRole('button', { name: /^Try again/ })).toBeNull()
  })

  it('an answer that is not live with none to show: unavailable, never "No more departures today"', async () => {
    for (const rtState of ['stale', 'reloading', 'unavailable']) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string) => Response.json(DEPS(input) ? answer([], rtState) : TILE(input))),
      )
      mount()
      await waitFor(() => expect(screen.getAllByText(/Departures unavailable/)).toHaveLength(3))
      expect(screen.queryByText(/No more departures today/)).toBeNull()
      cleanup()
    }
  })

  it('an answer whose rows have all left since: waits for the next poll, never "No more departures today"', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => Response.json(DEPS(input) ? answer([departure(-600)]) : TILE(input))),
    )
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    mount(client)
    // Once every row's answer is in, not while it's on its way.
    const answered = () => client.getQueryCache().findAll({ queryKey: ['train', 'departures'] })
    await waitFor(() => {
      expect(answered()).toHaveLength(3)
      expect(answered().every((q) => q.state.status === 'success')).toBe(true)
    })
    expect(screen.getAllByText(/Getting departures…/)).toHaveLength(3)
    expect(screen.queryByText(/No more departures today/)).toBeNull()
  })
})
