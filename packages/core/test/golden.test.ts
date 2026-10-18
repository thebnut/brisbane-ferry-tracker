/**
 * Golden fixtures (transit-architecture.md §3.7): real stop-day files built by @bft/pipeline from the TransLink SEQ
 * feed of 17 Oct 2026 (feed_info 20261017–20261216). Regenerate with `pnpm --filter @bft/pipeline golden`.
 */
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { brisbaneDate, downstreamOf, gtfsToEpoch, mergeDepartures, StaticStopDay } from '../src/index.ts'

const dir = join(import.meta.dirname, '../fixtures/golden')
const load = (name: string): StaticStopDay =>
  StaticStopDay.parse(JSON.parse(gunzipSync(readFileSync(join(dir, `${name}.json.gz`))).toString('utf8')))
const gzSize = (name: string) => statSync(join(dir, `${name}.json.gz`)).size
const hhmm = (s: number) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`

/** Downstream [stopIdx, arrOffset, dropOff, seqDelta] quadruples of one event. */
function downstream(ev: StaticStopDay['events'][number], day: StaticStopDay) {
  const ds = downstreamOf(day, ev)
  const out: Array<{ stop: number; arrOffset: number; dropOff: number; seqDelta: number }> = []
  for (let i = 0; i < ds.length; i += 4)
    out.push({
      stop: ds[i] as number,
      arrOffset: ds[i + 1] as number,
      dropOff: ds[i + 2] as number,
      seqDelta: ds[i + 3] as number,
    })
  return out
}

function checkInvariants(day: StaticStopDay) {
  let prev = -1
  for (const ev of day.events) {
    const [tripIdx, seq, arrS, depS, routeIdx, headsignIdx, platformIdx, pickup] = ev
    expect(day.trips[tripIdx]).toBeDefined()
    expect(day.routes[routeIdx]).toBeDefined()
    expect(day.headsigns[headsignIdx]).toBeDefined()
    expect(day.stops[platformIdx]).toBeDefined()
    expect(pickup).not.toBe(1)
    expect(arrS).toBeLessThanOrEqual(depS)
    expect(depS).toBeGreaterThanOrEqual(prev)
    prev = depS
    for (const d of downstream(ev, day)) {
      expect(day.stops[d.stop]).toBeDefined()
      expect(d.dropOff).not.toBe(1)
      expect(d.seqDelta).toBeGreaterThan(0)
      expect(d.arrOffset).toBeGreaterThanOrEqual(0)
      expect(seq + d.seqDelta).toBeGreaterThan(seq)
    }
  }
}

describe('golden: Bulimba ferry (express vs all-stops)', () => {
  const day = load('ferry-bulimba')
  it('has the expected shape and counts', () => {
    checkInvariants(day)
    expect(day).toMatchObject({ mode: 'ferry', stopKey: '317584', serviceDate: '20261020' })
    expect(day.events).toHaveLength(209)
    expect(day.routes.map((r) => r.short).sort()).toEqual(['F1', 'F11', 'F21'])
    expect(hhmm(day.events[0]?.[3] as number)).toBe('5:36')
    expect(hhmm(day.events.at(-1)?.[3] as number)).toBe('23:44')
  })
  it('express rows reach Riverside faster than all-stops rows', () => {
    const riverside = day.stops.findIndex((s) => s.id === '317590')
    const offsetTo = (short: string) =>
      day.events
        .filter((e) => day.routes[e[4]]?.short === short)
        .flatMap((e) => downstream(e, day).filter((d) => d.stop === riverside))
        .map((d) => d.arrOffset)
    const express = offsetTo('F11')
    const allStops = offsetTo('F1')
    expect(express.length).toBe(9)
    expect(allStops.length).toBe(62)
    expect(Math.max(...express)).toBeLessThan(Math.min(...allStops))
    // Every express towards Riverside skips the intermediate terminals the all-stops service calls at.
    const exp = day.events.find(
      (e) => day.routes[e[4]]?.short === 'F11' && downstream(e, day).some((d) => d.stop === riverside),
    )
    const all = day.events.find(
      (e) => day.routes[e[4]]?.short === 'F1' && downstream(e, day).some((d) => d.stop === riverside),
    )
    const stopsBefore = (e: typeof exp) =>
      downstream(e as NonNullable<typeof e>, day).findIndex((d) => d.stop === riverside)
    expect(stopsBefore(exp)).toBeLessThan(stopsBefore(all))
  })
  it('merges into departures to Riverside with arrival times', () => {
    const nowS = gtfsToEpoch('20261020', 7 * 3600)
    const rows = mergeDepartures([day], null, {
      nowS,
      rtState: 'unavailable',
      toStopIds: new Set(['317590']),
      limit: 5,
    })
    expect(rows).toHaveLength(5)
    for (const r of rows) expect((r.schedArrTo as number) - r.schedDep).toBeGreaterThan(0)
  })
})

describe('golden: Central (multi-platform)', () => {
  const day = load('train-central')
  it('keys by station slug with a platform on every boarding stop', () => {
    checkInvariants(day)
    expect(day).toMatchObject({ mode: 'train', stopKey: 'central', serviceDate: '20261020' })
    expect(day.events).toHaveLength(687)
    const platforms = new Set(day.events.map((e) => day.stops[e[6]]?.platform))
    expect([...platforms].sort()).toEqual(['1', '2', '3', '4', '5', '6'])
    for (const e of day.events) expect(day.stops[e[6]]?.key).toBe('central')
  })
  it('puts 24:xx departures on the next calendar day', () => {
    const late = day.events.filter((e) => e[3] >= 86400)
    expect(late).toHaveLength(15)
    expect(hhmm(day.events.at(-1)?.[3] as number)).toBe('25:01')
    for (const e of late) expect(brisbaneDate(gtfsToEpoch(day.serviceDate, e[3]) * 1000)).toBe('20261021')
  })
})

describe('golden: Bowen Hills (branching)', () => {
  const day = load('train-bowen-hills')
  it('serves several branches from one station', () => {
    checkInvariants(day)
    expect(day.events).toHaveLength(651)
    const nextStations = new Set(day.events.map((e) => day.stops[downstream(e, day)[0]?.stop as number]?.key))
    expect(nextStations.size).toBeGreaterThanOrEqual(5)
    expect(new Set(day.events.map((e) => day.stops[e[6]]?.platform)).size).toBe(4)
  })
})

describe('golden: Domestic Airport (end of the line, last trains)', () => {
  const day = load('train-domestic-airport')
  it('has first and last trains and no post-midnight service in this feed', () => {
    checkInvariants(day)
    expect(day).toMatchObject({ mode: 'train', stopKey: 'domestic-airport', serviceDate: '20261023' })
    expect(day.events).toHaveLength(50)
    expect(hhmm(day.events[0]?.[3] as number)).toBe('5:04')
    expect(hhmm(day.events.at(-1)?.[3] as number)).toBe('22:04')
    expect(day.events.every((e) => e[3] < 86400)).toBe(true)
    // The last arrival downstream of the last departure is still on the same calendar day.
    const last = day.events.at(-1) as StaticStopDay['events'][number]
    const lastArr = last[3] + Math.max(...downstream(last, day).map((d) => d.arrOffset))
    expect(brisbaneDate(gtfsToEpoch(day.serviceDate, lastArr) * 1000)).toBe('20261023')
  })
})

describe('golden: Cultural Centre busway platform 2 (the largest stop)', () => {
  const day = load('bus-cultural-centre-p2')
  it('has the expected counts', () => {
    checkInvariants(day)
    expect(day).toMatchObject({ mode: 'bus', stopKey: '11168' })
    expect(day.events).toHaveLength(1435)
    expect(day.routes).toHaveLength(22)
    expect(day.stops[day.events[0]?.[6] as number]).toMatchObject({ id: '11168', platform: '2' })
  })
  it('is under 30 KB gz', () => {
    // Downstream vectors are deduped per file and downstream-only StopRefs carry no name (transit-architecture.md §5).
    expect(gzSize('bus-cultural-centre-p2')).toBeLessThan(30 * 1024)
  })
  it('names boarding stops only', () => {
    const boarding = new Set(day.events.map((e) => e[6]))
    for (const [i, s] of day.stops.entries()) expect(s.name !== undefined).toBe(boarding.has(i))
    expect(day.downstreams.length).toBeLessThan(day.events.length / 5)
  })
})

describe('golden: Parkwood (bus route past midnight)', () => {
  const day = load('bus-parkwood-301200')
  it('keeps 24:xx departures on the service day and lands them on the next calendar day', () => {
    checkInvariants(day)
    expect(day.events).toHaveLength(31)
    const late = day.events.filter((e) => e[3] >= 86400)
    expect(late).toHaveLength(14)
    expect(hhmm(day.events.at(-1)?.[3] as number)).toBe('28:28')
    for (const e of late) expect(brisbaneDate(gtfsToEpoch(day.serviceDate, e[3]) * 1000)).toBe('20261021')
  })
})
