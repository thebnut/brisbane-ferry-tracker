import type { Departure } from '@bft/core/contract'
import { describe, expect, it } from 'vitest'
import {
  asScheduled,
  boardState,
  offlineRows,
  platformChanges,
  trainCard,
  visibleRows,
} from '../app/lib/departures.ts'
import { corridorFor, stationByKey } from '../app/lib/network.ts'

const NOW = Date.UTC(2026, 9, 19, 22, 0) // 8:00 am Brisbane, 20 Oct
const nowS = NOW / 1000
const central = stationByKey('central')
const platform = (key: string, code: string) =>
  stationByKey(key)?.platforms.find((p) => p.code === code)?.id ?? ''

function dep(over: Partial<Departure> = {}): Departure {
  const calls = corridorFor(['central', 'ferny-grove']).slice(1)
  return {
    tripInstance: 'T1@20261020',
    stopSequence: 5,
    route: { id: 'BRFG-1', short: 'BRFG', long: 'Brisbane City - Ferny Grove', color: 'D53E45' },
    headsign: 'Ferny Grove station',
    directionId: 0,
    stopId: central?.platforms[0]?.id ?? '',
    platform: '1',
    schedDep: nowS + 4 * 60,
    estDep: nowS + 4 * 60,
    schedArrTo: null,
    estArrTo: null,
    status: 'live',
    gps: true,
    vehicleId: 'fx1',
    stopsAfter: calls.map((k) => stationByKey(k)?.platforms[0]?.id ?? ''),
    ...over,
  }
}

describe('trainCard', () => {
  it('builds the T-Departures row: badges, countdown, line, strip from here to the terminus', () => {
    const c = trainCard(dep(), NOW, 'central', null)
    expect(c.badges).toEqual(['live', 'gps'])
    expect(c.minutes).toBe(4)
    expect(c.line.name).toBe('Ferny Grove')
    expect(c.headsign).toBe('Ferny Grove')
    expect(c.strip[0]?.id).toBe('central')
    expect(c.express).toBe(false)
    // THE-118 PR 4: one fact, the line; with a destination, "arr 8:16 am" (the line moves to the wide row).
    expect(c.status.text).toBe('Live · on time')
    expect(c.fact).toBe('Ferny Grove line')
    const going = trainCard(dep({ schedArrTo: nowS + 16 * 60 }), NOW, 'central', 'ferny-grove')
    expect(going).toMatchObject({ fact: 'arr 8:16 am', lineFact: 'Ferny Grove line' })
  })
  it('marks an express and counts the stations it runs through', () => {
    const all = corridorFor(['central', 'ferny-grove']).slice(1)
    const express = all.filter((_, i) => i % 3 === 0 || i === all.length - 1)
    const c = trainCard(
      dep({ stopsAfter: express.map((k) => stationByKey(k)?.platforms[0]?.id ?? '') }),
      NOW,
      'central',
      null,
    )
    expect(c.express).toBe(true)
    expect(c.skips).toBeGreaterThan(0)
    expect(c.fact).toBe('Ferny Grove express')
  })
  it('a platform change carries both platforms into the card and the banner list', () => {
    const d = dep({ stopId: platform('central', '4'), platform: '4', scheduledPlatform: '1' })
    const c = trainCard(d, NOW, 'central', null)
    expect(c).toMatchObject({ platform: '4', scheduledPlatform: '1' })
    // Live: the status line says so (the row's tile gets the orange ring).
    expect(c.status.text).toBe('Live · platform changed from 1')
    const late = trainCard({ ...d, estDep: d.schedDep + 180 }, NOW, 'central', null)
    expect(late.status.text).toBe('Live · 3 min late · platform changed from 1')
    // Not live (offline, stale): asScheduled drops the change, so no claim of one.
    expect(trainCard(asScheduled(d), NOW, 'central', null).status.text).toBe('Scheduled')
    expect(platformChanges([d, dep()])).toEqual([d])
  })
  it('cancelled rows have no countdown and say so', () => {
    const c = trainCard(dep({ status: 'cancelled', estDep: null }), NOW, 'central', null)
    expect(c).toMatchObject({ cancelled: true, minutes: null })
    expect(c.status).toMatchObject({ status: 'cancelled', dot: 'cancelled', text: 'Cancelled' })
    expect(c.badges).toContain('cancelled')
    const next = dep({ tripInstance: 'n@20261018', schedDep: nowS + 20 * 60, estDep: nowS + 20 * 60 })
    const withNext = trainCard(dep({ status: 'cancelled', estDep: null }), NOW, 'central', null, next)
    expect(withNext.status.text).toMatch(/^Cancelled · next .+ line in 20 min$/)
  })
  it('arrival time always has am/pm, and the journey is the difference of the shown minutes (T4, F2)', () => {
    // Departs 8:04:50, arrives 8:16:10: shown "8:04 am → 8:16 am", so 12 mins (not round(11.33) = 11).
    const c = trainCard(
      dep({ estDep: nowS + 4 * 60 + 50, schedArrTo: nowS + 16 * 60 + 10 }),
      NOW,
      'central',
      null,
    )
    expect(c.time).toBe('8:04 am')
    expect(c.arrival?.time).toBe('8:16 am')
    expect(c.journey).toBe('12 mins')
  })
  it('never shows an arrival before the departure (big early prediction at the destination)', () => {
    const c = trainCard(
      dep({ estDep: nowS + 300, estArrTo: nowS + 200, schedArrTo: nowS + 900 }),
      NOW,
      'central',
      null,
    )
    expect(c.arrival?.time).toBe(c.time)
    expect(c.journey).toBeNull()
  })
})

describe('offline', () => {
  it('asScheduled drops live claims and restores the timetabled platform', () => {
    const s = asScheduled(dep({ platform: '4', scheduledPlatform: '1', estDep: nowS + 500 }))
    expect(s).toMatchObject({ status: 'scheduled', platform: '1', estDep: null, gps: false })
    expect(s.scheduledPlatform).toBeUndefined()
  })
  it('offlineRows keeps only what is still to come, as scheduled', () => {
    const rows = [dep({ schedDep: nowS - 600 }), dep({ schedDep: nowS + 60 }), dep({ schedDep: nowS + 900 })]
    const out = offlineRows(rows, nowS, 5)
    expect(out).toHaveLength(2)
    expect(out.every((d) => d.status === 'scheduled')).toBe(true)
  })
})

describe('board state (F3/T5)', () => {
  const res = (over: Record<string, unknown> = {}) => ({
    schemaVersion: 1 as const,
    staticGeneration: 'g',
    serviceDates: [],
    rtSourceTimestamp: nowS - 20,
    rtState: 'live' as const,
    generatedAt: NOW - 5_000,
    mode: 'train' as const,
    stop: { key: 'central', name: 'Central', stopIds: [] },
    to: null,
    departures: [],
    ...over,
  })
  it('is live only while online and the data itself is fresh', () => {
    expect(boardState(res(), false, NOW)).toBeNull()
    expect(boardState(res(), true, NOW)).toBe('offline')
    // A copy generated 2 minutes ago (service worker cache, offline reload) is not live, whenever it was fetched.
    expect(boardState(res({ generatedAt: NOW - 120_000 }), false, NOW)).toBe('stale')
  })
  it('not live: rows lose live claims and trains that have left are dropped', () => {
    const rows = [dep({ estDep: nowS - 30, schedDep: nowS - 30 }), dep({ tripInstance: 'T2@20261020' })]
    expect(visibleRows(rows, null, NOW)).toHaveLength(2)
    const stale = visibleRows(rows, 'stale', NOW)
    expect(stale.map((d) => d.tripInstance)).toEqual(['T2@20261020'])
    expect(stale.every((d) => d.status === 'scheduled' && d.estDep == null && !d.gps)).toBe(true)
  })
})
