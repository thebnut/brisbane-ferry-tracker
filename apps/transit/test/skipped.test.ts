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

  it('Ask rows: "Not stopping here", no countdown, never highlighted', () => {
    const row0 = {
      tripInstance: 't',
      route: '66',
      headsign: 'UQ Lakes',
      platform: null,
      departs: '7:31 pm',
      inMinutes: 1,
      arrives: '7:50 pm',
      status: 'skipped' as const,
    }
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
      status: { status: 'skipped', dot: 'cancelled', text: 'Not stopping here', claim: false },
      fact: null,
      minutes: null,
      boardable: false,
    })
    // A live Ask row has no timetabled time: it says "Live", never "on time" (THE-118 PR 4).
    expect(askRowProps({ ...row0, status: 'live' }).status.text).toBe('Live')
  })

  it('Ask rows mark next-day times like the boards (X6)', () => {
    const lateNight = Date.UTC(2026, 9, 18, 13, 50) // 11:50 pm Sun 18 Oct, Brisbane
    const row = {
      tripInstance: 't',
      route: 'F1',
      headsign: 'UQ St Lucia',
      platform: null,
      departs: '5:49 am',
      inMinutes: 359,
      arrives: '6:30 am',
      status: 'scheduled' as const,
    }
    expect(askRowProps(row, lateNight)).toMatchObject({
      dayMarker: '(19/10)',
      arrival: { time: '6:30 am', dayMarker: '(19/10)' },
    })
    // Leaves tonight, arrives after midnight.
    const p = askRowProps({ ...row, departs: '11:55 pm', inMinutes: 5, arrives: '12:20 am' }, lateNight)
    expect(p.dayMarker).toBeNull()
    expect(p.arrival?.dayMarker).toBe('(19/10)')
  })
})
