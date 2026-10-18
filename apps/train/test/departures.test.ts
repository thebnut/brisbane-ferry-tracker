import type { Departure } from '@bft/core/contract'
import { describe, expect, it } from 'vitest'
import { asScheduled, offlineRows, platformChanges, shortArrival, trainCard } from '../app/lib/departures.ts'
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
    expect(c.label).toContain('platform 1')
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
  })
  it('a platform change carries both platforms into the card and the banner list', () => {
    const d = dep({ stopId: platform('central', '4'), platform: '4', scheduledPlatform: '1' })
    const c = trainCard(d, NOW, 'central', null)
    expect(c).toMatchObject({ platform: '4', scheduledPlatform: '1' })
    expect(c.label).toContain('platform 4, changed from 1')
    expect(platformChanges([d, dep()])).toEqual([d])
  })
  it('cancelled rows have no countdown and say so', () => {
    const c = trainCard(dep({ status: 'cancelled', estDep: null }), NOW, 'central', null)
    expect(c).toMatchObject({ cancelled: true, minutes: null, note: 'This service is cancelled' })
    expect(c.badges).toContain('cancelled')
  })
  it('arrival time drops a repeated am/pm', () => {
    expect(shortArrival('2:45 pm', '2:56 pm')).toBe('2:56')
    expect(shortArrival('11:55 am', '12:10 pm')).toBe('12:10 pm')
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
