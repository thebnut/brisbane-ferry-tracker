// @vitest-environment jsdom
/**
 * Release review C2: a board built from the saved day carries the device's `savedAt`, not a server time. With the
 * device clock five minutes fast, that stamp used to hold every network answer back ("Offline · scheduled") until
 * server time caught up. Now the network answer replaces it at the first poll back online; liveState still judges the
 * answer against the device clock (a known follow-up), so a fast clock shows "Live times delayed", never a false LIVE.
 */
import type { DeparturesResponse } from '@bft/core/contract'
import { liveState, reportOnline } from '@bft/ui/connectivity'
import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { departuresOptions } from '../app/lib/queries.ts'
import { writeOfflineDay } from '../app/lib/storage.ts'

const SERVER_NOW = Date.UTC(2026, 9, 20, 0, 0, 0)
const body = (generatedAt: number): DeparturesResponse => ({
  schemaVersion: 1,
  staticGeneration: 'g',
  serviceDates: ['20261020'],
  rtSourceTimestamp: Math.floor(generatedAt / 1000),
  rtState: 'live',
  generatedAt,
  mode: 'train',
  stop: { key: 'central', name: 'Central', stopIds: ['600016'] },
  to: null,
  departures: [],
})

const setOnLine = (value: boolean) =>
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => value })

afterEach(() => {
  vi.useRealTimers()
  setOnLine(true)
  reportOnline()
  localStorage.clear()
})

describe.each([
  ['+5 min', 5 * 60_000, 'stale'],
  ['−5 min', -5 * 60_000, null],
] as const)('device clock %s, then reconnect', (_, skew, state) => {
  it('the network answer replaces the saved-day board at the first poll', async () => {
    vi.useFakeTimers({ now: SERVER_NOW + skew, toFake: ['Date'] })
    writeOfflineDay({
      savedAt: Date.now(),
      serviceDate: '20261020',
      from: 'central',
      to: null,
      departures: [],
    })
    let answer: () => Response
    const fetcher = async () => answer()
    const opts = departuresOptions(fetcher, { fixtures: false, rt: null }, 'central', null, 20, null)
    const client = new QueryClient()
    const run = () =>
      opts.queryFn({ signal: new AbortController().signal, client, queryKey: opts.queryKey, meta: undefined })

    // Offline with nothing cached: the board is built from the saved day (device stamp).
    setOnLine(false)
    answer = () => {
      throw new TypeError('Failed to fetch')
    }
    const offline = await run()
    expect(offline.offline).toBe(true)
    expect(offline.generatedAt).toBe(SERVER_NOW + skew)
    client.setQueryData(opts.queryKey, offline)

    // Back online: an edge-cached answer a few seconds old by server time.
    setOnLine(true)
    answer = () => Response.json(body(SERVER_NOW - 5_000))
    const back = await run()
    expect(back.offline).toBeUndefined()
    expect(back.generatedAt).toBe(SERVER_NOW - 5_000)
    expect(liveState(back, { offline: false, nowMs: Date.now() })).toBe(state)
  })
})

it('offline, a server copy is the base even when the saved day is stamped later by a fast device clock', async () => {
  vi.useFakeTimers({ now: SERVER_NOW + 5 * 60_000, toFake: ['Date'] })
  writeOfflineDay({ savedAt: Date.now(), serviceDate: '20261020', from: 'central', to: null, departures: [] })
  const cached = body(SERVER_NOW - 60_000)
  const fetcher = async () => new Response(JSON.stringify(cached), { headers: { 'x-bft-cache': 'sw' } })
  const opts = departuresOptions(fetcher, { fixtures: false, rt: null }, 'central', null, 20, null)
  const out = await opts.queryFn({
    signal: new AbortController().signal,
    client: new QueryClient(),
    queryKey: opts.queryKey,
    meta: undefined,
  })
  expect(out.offline).toBe(true)
  expect(out.generatedAt).toBe(SERVER_NOW - 60_000)
  expect(out.deviceStamped).toBeUndefined()
})

describe('R6-B1 still holds between server times', () => {
  it('an answer older than the server board on screen does not replace it', async () => {
    vi.useFakeTimers({ now: SERVER_NOW, toFake: ['Date'] })
    const fetcher = async () => Response.json(body(SERVER_NOW - 30_000))
    const opts = departuresOptions(fetcher, { fixtures: false, rt: null }, 'central', null, 20, null)
    const client = new QueryClient()
    client.setQueryData(opts.queryKey, body(SERVER_NOW - 10_000))
    const out = await opts.queryFn({
      signal: new AbortController().signal,
      client,
      queryKey: opts.queryKey,
      meta: undefined,
    })
    expect(out.offline).toBe(true)
    expect(out.generatedAt).toBe(SERVER_NOW - 10_000)
    // The offline board keeps that server time: an answer still older than it waits, a newer one replaces it.
    expect(out.serverGeneratedAt).toBe(SERVER_NOW - 10_000)
  })
})
