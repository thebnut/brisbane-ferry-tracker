/** Skipped services (not stopping here) are never offered as boardable (Codex review of #50, finding 2). */
import type { Departure } from '@bft/core/contract'
import { describe, expect, it } from 'vitest'
import { askRowProps } from '../app/components/AskAnswer.tsx'
import { asScheduled } from '../app/lib/saved.ts'
import { upcoming } from '../app/routes/nearby.tsx'
import { cardModel } from '../app/routes/saved.tsx'

const NOW = Date.UTC(2026, 9, 19, 9, 30)
const s = NOW / 1000
const dep = (o: Partial<Departure>): Departure =>
  ({
    tripInstance: `t${o.schedDep}@20261019`,
    stopSequence: 1,
    route: { id: '66-1', short: '66', long: '' },
    headsign: 'UQ Lakes',
    directionId: 0,
    stopId: '1832',
    platform: null,
    schedDep: s + 120,
    estDep: null,
    schedArrTo: null,
    estArrTo: null,
    status: 'scheduled',
    gps: false,
    vehicleId: null,
    ...o,
  }) as Departure

describe('skipped services', () => {
  const rows = [dep({ status: 'skipped', schedDep: s + 60 }), dep({ schedDep: s + 300 })]

  it('Saved: the next card is the next service that stops', () => {
    const item = { id: 'bus:1832', mode: 'bus' as const, key: '1832', to: null, title: 'CC', href: '' }
    const res = { rtState: 'live', stop: { key: '1832', name: 'CC', stopIds: ['1832'] }, departures: rows }
    expect(cardModel(item, res as never, NOW).minutes).toBe(5)
  })

  it('Saved offline: a skipped service stays skipped, so the card still picks the next one that stops', () => {
    const item = { id: 'bus:1832', mode: 'bus' as const, key: '1832', to: null, title: 'CC', href: '' }
    const offline = asScheduled(rows, NOW)
    expect(offline.map((d) => d.status)).toEqual(['skipped', 'scheduled'])
    const res = {
      rtState: 'unavailable',
      stop: { key: '1832', name: 'CC', stopIds: ['1832'] },
      departures: offline,
    }
    expect(cardModel(item, res as never, NOW).minutes).toBe(5)
  })

  it('Around you: no countdown or cue for a skipped service', () => {
    expect(upcoming(rows, NOW).map((d) => d.status)).toEqual(['scheduled'])
  })

  it('Ask rows: "Not stopping here", SKIPPED badge, no countdown, never highlighted', () => {
    const p = askRowProps({
      tripInstance: 't',
      route: '66',
      headsign: 'UQ Lakes',
      platform: null,
      departs: '7:31 pm',
      inMinutes: 1,
      arrives: '7:50 pm',
      status: 'skipped',
    })
    expect(p).toMatchObject({
      badges: ['skipped'],
      minutes: null,
      note: 'Not stopping here',
      boardable: false,
    })
  })
})
