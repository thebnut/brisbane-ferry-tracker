// @vitest-environment jsdom
/**
 * Release review C2: a saved card built offline with no response on hand is stamped with the device clock. Five
 * minutes fast, that stamp used to hold every network answer back ("Offline · scheduled") until server time caught
 * up. Now the answer replaces the card at the first poll back online. liveState still judges against the device clock
 * (a known follow-up), so a fast clock shows the card as delayed, never a false LIVE.
 */
import type { Departure, DeparturesResponse } from '@bft/core/contract'
import { liveState, reportOnline } from '@bft/ui/connectivity'
import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { savedOptions } from '../app/lib/queries.ts'
import { type SavedItem, writeSavedCopy } from '../app/lib/saved.ts'

const SERVER_NOW = Date.UTC(2026, 9, 20, 0, 0, 0)
const item: SavedItem = {
  id: 'bus:1832',
  mode: 'bus',
  key: '1832',
  to: null,
  title: 'Stop 1832',
  href: '/bus/1832',
}
const row = (schedDep: number) =>
  ({
    tripInstance: `t${schedDep}@20261020`,
    stopSequence: 1,
    route: { id: '66-1', short: '66', long: 'UQ Lakes - RBWH' },
    headsign: 'UQ Lakes',
    directionId: 0,
    stopId: '1832',
    platform: null,
    schedDep,
    estDep: null,
    schedArrTo: null,
    estArrTo: null,
    status: 'scheduled',
    gps: false,
    vehicleId: null,
  }) as Departure
const body = (generatedAt: number): DeparturesResponse => ({
  schemaVersion: 1,
  staticGeneration: 'g',
  serviceDates: ['20261020'],
  rtSourceTimestamp: Math.floor(generatedAt / 1000),
  rtState: 'live',
  generatedAt,
  mode: 'bus',
  stop: { key: '1832', name: 'Stop 1832', stopIds: ['1832'] },
  to: null,
  departures: [row(Math.floor(SERVER_NOW / 1000) + 3600)],
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
  it('the network answer replaces the offline card at the first poll', async () => {
    vi.useFakeTimers({ now: SERVER_NOW + skew, toFake: ['Date'] })
    writeSavedCopy(item, body(SERVER_NOW - 3600_000))
    let answer: () => Response
    const fetcher = async () => answer()
    const opts = savedOptions(fetcher, { fixtures: false, rt: null }, item)
    const client = new QueryClient()
    const run = () =>
      opts.queryFn({ signal: new AbortController().signal, client, queryKey: opts.queryKey, meta: undefined })

    // Offline with nothing on screen: the card is the device's copy, stamped by the device clock.
    setOnLine(false)
    answer = () => {
      throw new TypeError('Failed to fetch')
    }
    const offline = await run()
    expect(offline.offline).toBe(true)
    expect(offline.generatedAt).toBe(SERVER_NOW + skew)
    expect(offline.serverGeneratedAt).toBeNull()
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

it('R6-B1 still holds between server times: an older answer than the card on screen waits', async () => {
  vi.useFakeTimers({ now: SERVER_NOW, toFake: ['Date'] })
  const opts = savedOptions(
    async () => Response.json(body(SERVER_NOW - 30_000)),
    { fixtures: false, rt: null },
    item,
  )
  const client = new QueryClient()
  client.setQueryData(opts.queryKey, body(SERVER_NOW - 10_000))
  const out = await opts.queryFn({
    signal: new AbortController().signal,
    client,
    queryKey: opts.queryKey,
    meta: undefined,
  })
  expect(out.offline).toBe(true)
  expect(out.serverGeneratedAt).toBe(SERVER_NOW - 10_000)
})
