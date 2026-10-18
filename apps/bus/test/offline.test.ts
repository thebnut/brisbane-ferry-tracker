// @vitest-environment jsdom
import type { Departure, DeparturesResponse } from '@bft/core/contract'
import { beforeEach, describe, expect, it } from 'vitest'
import { asOfflineTimetable } from '../app/lib/queries.ts'
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
