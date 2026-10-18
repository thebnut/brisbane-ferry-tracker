// @vitest-environment jsdom
import type { Departure, DeparturesResponse } from '@bft/core/contract'
import { reportOffline, reportOnline } from '@bft/ui/connectivity'
import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { asOfflineTimetable, departuresOptions, liveView } from '../app/lib/queries.ts'
import { writeOffline } from '../app/lib/storage.ts'

const NOW = 1_792_300_000_000
const row = (offsetS: number, over: Partial<Departure> = {}): Departure => ({
  tripInstance: `t${offsetS}@20261018`,
  stopSequence: 1,
  route: { id: '66-1', short: '66' },
  headsign: 'UQ Lakes',
  directionId: 0,
  stopId: '10802',
  platform: '1',
  schedDep: NOW / 1000 + offsetS,
  estDep: NOW / 1000 + offsetS + 120,
  schedArrTo: null,
  estArrTo: null,
  status: 'live',
  gps: true,
  vehicleId: 'v',
  ...over,
})
const res = (rows: Departure[]): DeparturesResponse => ({
  schemaVersion: 1,
  staticGeneration: 'g',
  serviceDates: ['20261018'],
  rtSourceTimestamp: NOW / 1000 - 10,
  rtState: 'live',
  generatedAt: NOW - 30 * 60_000,
  mode: 'bus',
  stop: { key: '10802', name: 'Cultural Centre', stopIds: ['10802'] },
  to: null,
  departures: rows,
})

beforeEach(() => localStorage.clear())

describe('offline timetable', () => {
  it('turns a cached live response into scheduled rows and drops departed buses', () => {
    const out = asOfflineTimetable(
      '10802',
      res([row(-1800), row(-30), row(300), row(600, { status: 'cancelled' })]),
      NOW,
    )
    expect(out?.rtState).toBe('unavailable')
    expect(out?.rtSourceTimestamp).toBeNull()
    // Offline nothing confirms a bus is still at the stop, so one that left 30 s ago is gone too.
    expect(out?.departures.map((d) => d.status)).toEqual(['scheduled', 'cancelled'])
    expect(out?.departures.every((d) => d.estDep == null && !d.gps)).toBe(true)
  })
  it('prefers the longer saved timetable copy', () => {
    writeOffline('10802', res([row(300), row(900), row(1500), row(2100)]))
    expect(asOfflineTimetable('10802', res([row(300)]), NOW)?.departures).toHaveLength(4)
  })
  it('returns null with nothing to show', () => {
    expect(asOfflineTimetable('10802', null, NOW)).toBeNull()
  })
})

describe('liveView (B3/B4)', () => {
  it('fresh live data passes through; old data loses live claims but keeps unknown, skipped and cancelled', () => {
    const r = res([
      row(300),
      row(400, { status: 'unknown' }),
      row(500, { status: 'skipped' }),
      row(600, { status: 'cancelled' }),
    ])
    expect(liveView('10802', { ...r, generatedAt: NOW }, NOW, true)).toMatchObject({ state: null })
    const old = liveView('10802', { ...r, generatedAt: NOW - 120_000 }, NOW, true)
    expect(old.state).toBe('stale')
    expect(old.data?.rtState).toBe('stale')
    expect(old.data?.departures.map((d) => d.status)).toEqual([
      'scheduled',
      'unknown',
      'skipped',
      'cancelled',
    ])
    expect(old.data?.departures.every((d) => d.estDep == null && !d.gps)).toBe(true)
  })
  it('offline uses the saved timetable view', () => {
    const view = liveView('10802', { ...res([row(300)]), generatedAt: NOW }, NOW, false)
    expect(view.state).toBe('offline')
    expect(view.data?.departures[0]?.status).toBe('scheduled')
  })
})

describe('offline poll answered by an old service-worker copy (R2-B6)', () => {
  afterEach(() => {
    reportOnline()
    vi.useRealTimers()
  })
  const mode = { fixtures: false, rt: null }
  // The service worker's copy is from 9:06 pm (94 min ago): every row has gone.
  const swCopy = { ...res([row(-5000), row(-4000), row(-3000)]), generatedAt: NOW - 94 * 60_000 }
  const swFetcher = async () => {
    reportOffline() // trackedFetch does this for a response marked x-bft-cache
    return new Response(JSON.stringify(swCopy))
  }
  const poll = (client: QueryClient) => {
    const opts = departuresOptions(swFetcher, mode, '10813', null)
    return opts.queryFn({
      signal: new AbortController().signal,
      client,
      queryKey: opts.queryKey,
      meta: undefined,
    })
  }

  it('keeps the board on screen (as timetable times, with its own Updated time) for an unsaved stop', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
    const client = new QueryClient()
    const shown = { ...res([row(300), row(900)]), generatedAt: NOW - 60_000 }
    client.setQueryData(departuresOptions(swFetcher, mode, '10813', null).queryKey, shown)
    const out = await poll(client)
    expect(out.generatedAt).toBe(shown.generatedAt)
    expect(out.rtState).toBe('unavailable')
    expect(out.departures.map((d) => d.status)).toEqual(['scheduled', 'scheduled'])
  })
  it('with nothing else on hand the old copy is shown empty, and the board says so honestly', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
    const out = await poll(new QueryClient())
    expect(out.departures).toHaveLength(0)
    expect(out.generatedAt).toBe(swCopy.generatedAt)
  })
})
