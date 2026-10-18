import type { Alert, Departure } from '@bft/core/contract'
import { describe, expect, it } from 'vitest'
import { detourRoutes, isActive, noteFor, routesIn, rowLabel, rowViews } from '../app/lib/departures.ts'

const NOW = 1_792_300_000_000
const nowS = NOW / 1000
const dep = (over: Partial<Departure>): Departure => ({
  tripInstance: `t${Math.random()}@20261018`,
  stopSequence: 3,
  route: { id: '66-1', short: '66' },
  headsign: 'UQ Lakes',
  directionId: 0,
  stopId: '10802',
  platform: '1',
  schedDep: nowS + 300,
  estDep: null,
  schedArrTo: null,
  estArrTo: null,
  status: 'scheduled',
  gps: false,
  vehicleId: null,
  ...over,
})
const alert = (over: Partial<Alert>): Alert => ({
  id: 'a',
  header: 'Detour',
  activePeriods: [],
  routes: ['111-1'],
  stops: [],
  modes: ['bus'],
  effect: 'DETOUR',
  ...over,
})

describe('departure notes', () => {
  it('live: late, early, on time, GPS', () => {
    expect(noteFor(dep({ status: 'live', estDep: nowS + 420 }), [], NOW, new Map())).toEqual({
      note: '+2 min late',
      tone: 'late',
    })
    expect(noteFor(dep({ status: 'live', estDep: nowS + 240 }), [], NOW, new Map())).toEqual({
      note: '1 min early',
      tone: 'info',
    })
    expect(noteFor(dep({ status: 'live', estDep: nowS + 300 }), [], NOW, new Map()).note).toBe('On time')
    expect(noteFor(dep({ status: 'live', estDep: nowS + 300, gps: true }), [], NOW, new Map()).note).toBe(
      'GPS · On time',
    )
  })
  it('cancelled points at the next bus on the same route', () => {
    const c = dep({ status: 'cancelled', route: { id: '111-1', short: '111' } })
    const next = dep({ route: { id: '111-1', short: '111' }, schedDep: nowS + 18 * 60 })
    expect(noteFor(c, [c, next], NOW, new Map()).note).toBe('Next 111 in 18 min')
  })
  it('detours from active alerts', () => {
    const d = detourRoutes([alert({})], nowS)
    expect(noteFor(dep({ route: { id: '111-1', short: '111' } }), [], NOW, d).note).toBe('Detour: see alerts')
    expect(detourRoutes([alert({ activePeriods: [{ start: nowS + 3600 }] })], nowS).size).toBe(0)
    expect(isActive(alert({ activePeriods: [{ start: nowS - 10, end: nowS + 10 }] }), nowS)).toBe(true)
  })
})

describe('row views', () => {
  it('highlights the first bus that is running and filters by route', () => {
    const rows = [
      dep({ status: 'cancelled', schedDep: nowS + 30 }),
      dep({ schedDep: nowS + 60 }),
      dep({ route: { id: 'M2-1', short: 'M2' } }),
    ]
    const v = rowViews(rows, NOW)
    expect(v.map((x) => x.highlighted)).toEqual([false, true, false])
    expect(rowViews(rows, NOW, { routes: new Set(['M2']) })).toHaveLength(1)
    expect(routesIn(rows)).toEqual(['66', 'M2'])
    expect(rowLabel(v[1] as (typeof v)[number])).toBe(`Route 66 to UQ Lakes, in 1 minutes, ${v[1]?.time}`)
  })
})

describe('smoke round 2', () => {
  it('rows follow the times shown once live estimates are dropped (R2-B8)', () => {
    // The API sorted by estimate: M1 (sched 11:01, est 10:59) above 222 (sched 11:00); offline both are timetable.
    const m1 = dep({ route: { id: 'M1-1', short: 'M1' }, schedDep: nowS + 660 })
    const r222 = dep({ route: { id: '222-1', short: '222' }, schedDep: nowS + 600 })
    expect(rowViews([m1, r222], NOW).map((v) => v.departure.route.short)).toEqual(['222', 'M1'])
  })
  it('an empty board says which days have no buses (R2-B7)', async () => {
    const { noneDue } = await import('../app/components/StopBoard.tsx')
    // NOW is 18 Oct 2026, 15:46 Brisbane.
    expect(noneDue(['20261018'], NOW, false)).toBe('No buses from this stop for the rest of today.')
    expect(noneDue(['20261018', '20261019'], NOW, false)).toBe(
      'No buses from this stop for the rest of today or tomorrow (19/10).',
    )
    expect(noneDue(['20261018', '20261019'], NOW, true)).toMatch(/^No buses on this route/)
  })
})
