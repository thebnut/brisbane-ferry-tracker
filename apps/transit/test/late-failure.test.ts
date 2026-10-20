// @vitest-environment jsdom
/**
 * Late-failure fix (Codex r1): a failure from a call started before the network last answered no longer marks the
 * connection down, so a saved card must judge its own failure. Online by the flag, its request failing for want of a
 * network still gives "Offline · scheduled", never its old LIVE answer; an HTTP error still fails the query.
 */
import type { Departure, DeparturesResponse } from '@bft/core/contract'
import { isOnline, liveState, reportOnline } from '@bft/ui/connectivity'
import { QueryClient } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import { savedOptions } from '../app/lib/queries.ts'
import type { SavedItem } from '../app/lib/saved.ts'

const NOW = Date.UTC(2026, 9, 20, 0, 0, 0)
const item: SavedItem = {
  id: 'bus:1832',
  mode: 'bus',
  key: '1832',
  to: null,
  title: 'Stop 1832',
  href: '/bus/1832',
}
const row = {
  tripInstance: 't1@20261020',
  stopSequence: 1,
  route: { id: '66-1', short: '66', long: 'UQ Lakes - RBWH' },
  headsign: 'UQ Lakes',
  directionId: 0,
  stopId: '1832',
  platform: null,
  schedDep: Math.floor(NOW / 1000) + 600,
  estDep: Math.floor(NOW / 1000) + 660,
  schedArrTo: null,
  estArrTo: null,
  status: 'live',
  gps: false,
  vehicleId: null,
} as unknown as Departure
const live: DeparturesResponse = {
  schemaVersion: 1,
  staticGeneration: 'g',
  serviceDates: ['20261020'],
  rtSourceTimestamp: Math.floor(NOW / 1000) - 10,
  rtState: 'live',
  generatedAt: NOW - 5_000,
  mode: 'bus',
  stop: { key: '1832', name: 'Stop 1832', stopIds: ['1832'] },
  to: null,
  departures: [row],
}

afterEach(() => {
  vi.useRealTimers()
  reportOnline()
  localStorage.clear()
})

const run = async (fetcher: () => Promise<Response>) => {
  const opts = savedOptions(fetcher, { fixtures: false, rt: null }, item)
  const client = new QueryClient()
  client.setQueryData(opts.queryKey, live)
  return opts.queryFn({
    signal: new AbortController().signal,
    client,
    queryKey: opts.queryKey,
    meta: undefined,
  })
}

it('a network failure while the flag says online: the card becomes its offline copy, not its old LIVE data', async () => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
  expect(isOnline()).toBe(true)
  const out = await run(async () => {
    throw new TypeError('Failed to fetch')
  })
  expect(out.offline).toBe(true)
  expect(liveState(out, { offline: !isOnline(), nowMs: NOW })).toBe('offline')
})

it('an HTTP error still fails the query (not a connection failure)', async () => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
  await expect(run(async () => new Response('busy', { status: 503 }))).rejects.toThrow()
})
