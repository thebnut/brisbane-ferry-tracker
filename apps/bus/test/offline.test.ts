// @vitest-environment jsdom
import type { Departure, DeparturesResponse } from '@bft/core/contract'
import { reportOffline, reportOnline } from '@bft/ui/connectivity'
import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { asOfflineTimetable, departuresOptions, liveView, refreshOfflineCopy } from '../app/lib/queries.ts'
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

describe('a cached answer while another request reaches the network (R6-B1)', () => {
  afterEach(() => {
    reportOnline()
    vi.useRealTimers()
  })
  const mode = { fixtures: false, rt: null }
  // The service worker's copy, from when the device went offline (10:51 pm in Dev's session).
  const swCopy = { ...res([row(300), row(900)]), generatedAt: NOW - 20 * 60_000 }
  // trackedFetch reports offline for the marked response, then the alerts poll (same tick) reaches the network.
  const racingFetcher = async () => {
    reportOffline()
    const marked = new Response(JSON.stringify(swCopy), { headers: { 'x-bft-cache': 'sw' } })
    reportOnline()
    return marked
  }
  const poll = (client: QueryClient, fetcher = racingFetcher) => {
    const opts = departuresOptions(fetcher, mode, '10802', null)
    return opts.queryFn({
      signal: new AbortController().signal,
      client,
      queryKey: opts.queryKey,
      meta: undefined,
    })
  }

  it('the old body is an offline copy, never shown as live or "Live times delayed"', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
    const out = await poll(new QueryClient())
    expect(out.offline).toBe(true)
    expect(out.rtState).toBe('unavailable')
    expect(out.departures.every((d) => d.status === 'scheduled' && d.estDep == null)).toBe(true)
    // Rendered while the connection flag says online: still the offline board, with its rows.
    const view = liveView('10802', out, NOW, true)
    expect(view.state).toBe('offline')
    expect(view.data?.departures).toHaveLength(2)
  })
  it('a body older than the board on screen never replaces it, even unmarked', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
    const client = new QueryClient()
    const shown = { ...res([row(300), row(900), row(1500)]), generatedAt: NOW - 30_000 }
    client.setQueryData(departuresOptions(racingFetcher, mode, '10802', null).queryKey, shown)
    const out = await poll(client, async () => new Response(JSON.stringify(swCopy)))
    expect(out.offline).toBe(true)
    expect(out.generatedAt).toBe(shown.generatedAt)
  })
  it('a fresh network answer replaces the offline board', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
    const client = new QueryClient()
    client.setQueryData(
      departuresOptions(racingFetcher, mode, '10802', null).queryKey,
      asOfflineTimetable('10802', swCopy, NOW),
    )
    const fresh = { ...res([row(300)]), generatedAt: NOW }
    const out = await poll(client, async () => new Response(JSON.stringify(fresh)))
    expect(out.offline).toBeUndefined()
    expect(liveView('10802', out, NOW, true).state).toBeNull()
  })
})

describe('offline copies for viewed stops (R6-B1)', () => {
  it('keeps the newest unsaved copies, and saved stops always', async () => {
    const { OFFLINE_UNSAVED_MAX, hasTimetableCopy, readOffline, toggleSaved } = await import(
      '../app/lib/storage.ts'
    )
    toggleSaved({ id: 'saved1', name: 'Saved' })
    writeOffline('saved1', res([row(300)]))
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
    for (let i = 0; i < OFFLINE_UNSAVED_MAX + 3; i++) {
      vi.setSystemTime(NOW + i * 1000)
      writeOffline(`s${i}`, res(i === 0 ? [] : [row(300)]))
    }
    vi.useRealTimers()
    expect(readOffline('saved1')).not.toBeNull()
    expect(readOffline('s0')).toBeNull()
    expect(readOffline(`s${OFFLINE_UNSAVED_MAX + 2}`)).not.toBeNull()
    expect(hasTimetableCopy(`s${OFFLINE_UNSAVED_MAX + 2}`)).toBe(true)
    writeOffline('empty', res([]))
    expect(hasTimetableCopy('empty')).toBe(false)
    toggleSaved({ id: 'saved1', name: 'Saved' })
  })
})

describe('the kept timetable copy is only replaced by a network answer (Codex review)', () => {
  afterEach(() => vi.useRealTimers())
  it('a cached (old, empty) answer during an offline reload leaves the saved copy alone', async () => {
    const { readOffline } = await import('../app/lib/storage.ts')
    vi.useFakeTimers({ now: NOW - 4 * 3600_000, toFake: ['Date'] })
    writeOffline('10802', { ...res([row(4 * 3600 + 300)]), generatedAt: NOW - 4 * 3600_000 })
    vi.setSystemTime(NOW)
    const cached = { ...res([]), generatedAt: NOW - 12 * 3600_000 }
    // navigator.onLine still reads true, but the service worker answered from its cache.
    await refreshOfflineCopy(
      async () => new Response(JSON.stringify(cached), { headers: { 'x-bft-cache': 'sw' } }),
      '10802',
    )
    expect(readOffline('10802')?.savedAt).toBe(NOW - 4 * 3600_000)
    // A real network answer does replace it.
    const fresh = { ...res([row(300)]), generatedAt: NOW }
    await refreshOfflineCopy(async () => new Response(JSON.stringify(fresh)), '10802')
    expect(readOffline('10802')?.savedAt).toBe(NOW)
  })
})

describe('overlapping copy refreshes (Codex review round 2)', () => {
  it('one refresh per stop at a time, so an older answer arriving last cannot overwrite a newer copy', async () => {
    const { readOffline } = await import('../app/lib/storage.ts')
    let calls = 0
    let release: (r: Response) => void = () => {}
    const fetcher = () => {
      calls++
      return new Promise<Response>((resolve) => {
        release = resolve
      })
    }
    const a = refreshOfflineCopy(fetcher, '20000')
    const b = refreshOfflineCopy(fetcher, '20000')
    expect(b).toBe(a)
    await Promise.resolve()
    expect(calls).toBe(1)
    release(new Response(JSON.stringify({ ...res([row(300)]), generatedAt: NOW })))
    await a
    expect((readOffline('20000')?.body as { generatedAt?: number } | undefined)?.generatedAt).toBe(NOW)
  })
})

describe('the kept copy the board may show counts too (Codex review round 4)', () => {
  afterEach(() => vi.useRealTimers())
  it('a kept timetable stamped after an edge-cached answer never holds that answer back (release review L4)', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
    const mode = { fixtures: false, rt: null }
    const fetcher = async () =>
      new Response(JSON.stringify({ ...res([row(300)]), generatedAt: NOW - 20_000 }))
    const opts = departuresOptions(fetcher, mode, '30000', null)
    const client = new QueryClient()
    client.setQueryData(opts.queryKey, { ...res([row(300)]), generatedAt: NOW - 60_000 })
    writeOffline('30000', { ...res([row(300), row(900)]), generatedAt: NOW - 10_000 })
    const out = await opts.queryFn({
      signal: new AbortController().signal,
      client,
      queryKey: opts.queryKey,
      meta: undefined,
    })
    expect(out.offline).toBeUndefined()
    expect(out.generatedAt).toBe(NOW - 20_000)
  })
})
