/**
 * Adversarial fixtures (transit-architecture.md §3.7): loop, 6-minute headways, cancelled trip, SKIPPED stop,
 * NO_DATA stop, ADDED trip, planned closure, a 00:30 query needing yesterday's service day, a 03:00 feed swap.
 */
import { describe, expect, it } from 'vitest'
import {
  gtfsToEpoch,
  mergeDepartures,
  overlappingServiceDates,
  predictStop,
  type RtSnapshot,
  type RtTrip,
  rtStateFor,
  ServiceCalendar,
  StaticStopDay,
  TripMatcher,
} from '../src/index.ts'
import { type SynthTrip, stopDay, tripIndex } from './helpers.ts'

const D = '20261020'
const D0 = '20261019'
const t = (date: string, hms: string) => {
  const [h, m, s] = hms.split(':').map(Number)
  return gtfsToEpoch(date, (h as number) * 3600 + (m as number) * 60 + (s ?? 0))
}

function snapshot(trips: Record<string, RtTrip>, sourceTimestamp: number): RtSnapshot {
  return {
    header: {
      schemaVersion: 1,
      seq: 1,
      staticGeneration: { ferry: 'g1' },
      serviceDates: [D],
      sourceTimestamp,
      fetchedAt: sourceTimestamp * 1000,
    },
    trips,
    vehicles: [],
    alerts: [],
  }
}

describe('time', () => {
  it('maps GTFS times past 24:00 onto the next calendar day', () => {
    // 25:10 on the 19th is 01:10 on the 20th, Brisbane (UTC+10) = 15:10Z on the 19th.
    expect(new Date(t(D0, '25:10:00') * 1000).toISOString()).toBe('2026-10-19T15:10:00.000Z')
  })
  it('a 00:30 query looks at yesterday and today', () => {
    expect(overlappingServiceDates(Date.parse('2026-10-19T14:30:00Z'))).toEqual([D0, D])
  })
  it('a midday query only looks at today', () => {
    expect(overlappingServiceDates(Date.parse('2026-10-20T02:00:00Z'))).toEqual([D])
  })
})

describe('contract', () => {
  it('synthetic stop-day files satisfy the zod schema', () => {
    const day = stopDay(D, 'A', [
      {
        id: 'T1',
        route: 'F1-1',
        stops: [
          ['A', '08:00:00'],
          ['B', '08:10:00'],
        ],
      },
    ])
    expect(StaticStopDay.parse(day)).toEqual(day)
  })
})

describe('00:30 query needs yesterday', () => {
  const late: SynthTrip = {
    id: 'LATE',
    route: 'F1-1',
    stops: [
      ['A', '24:40:00'],
      ['B', '24:55:00'],
    ],
  }
  const early: SynthTrip = {
    id: 'EARLY',
    route: 'F1-1',
    stops: [
      ['A', '05:30:00'],
      ['B', '05:45:00'],
    ],
  }
  it('shows a 24:40 departure from yesterday before 05:30 today, once each', () => {
    const now = t(D, '00:30:00')
    const days = overlappingServiceDates(now * 1000).map((d) => stopDay(d, 'A', [late, early]))
    const rows = mergeDepartures(days, null, { nowS: now, rtState: 'unavailable', toStopIds: new Set(['B']) })
    expect(rows.map((r) => r.tripInstance)).toEqual(['LATE@20261019', 'EARLY@20261020', 'LATE@20261020'])
    expect(rows[0]?.schedDep).toBe(t(D, '00:40:00'))
  })
})

describe('loop that repeats a stop', () => {
  // A -> B -> C -> A -> D: boarding at A twice.
  const loop: SynthTrip = {
    id: 'LOOP',
    route: 'B100-1',
    stops: [
      ['A', '08:00:00'],
      ['B', '08:05:00'],
      ['C', '08:10:00'],
      ['A', '08:15:00'],
      ['D', '08:20:00'],
    ],
  }
  it('to D: keeps only the later boarding (shortest ride), with the right arrival', () => {
    const rows = mergeDepartures([stopDay(D, 'A', [loop])], null, {
      nowS: t(D, '07:00:00'),
      rtState: 'unavailable',
      toStopIds: new Set(['D']),
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.stopSequence).toBe(4)
    expect(rows[0]?.schedArrTo).toBe(t(D, '08:20:00'))
  })
  it('to B: only the first boarding reaches B', () => {
    const rows = mergeDepartures([stopDay(D, 'A', [loop])], null, {
      nowS: t(D, '07:00:00'),
      rtState: 'unavailable',
      toStopIds: new Set(['B']),
    })
    expect(rows.map((r) => r.stopSequence)).toEqual([1])
  })
  it('RT for the second visit uses its own stop_sequence', () => {
    const rt: RtTrip = {
      key: `LOOP@${D}`,
      rel: 'SCHEDULED',
      ts: 0,
      updates: [
        { seq: 1, rel: 'SCHEDULED', depDelay: 0, arrDelay: 0 },
        { seq: 4, rel: 'SCHEDULED', depDelay: 240, arrDelay: 240 },
      ],
    }
    const now = t(D, '07:59:00')
    const rows = mergeDepartures([stopDay(D, 'A', [loop])], snapshot({ [rt.key]: rt }, now), {
      nowS: now,
      rtState: 'live',
    })
    expect(rows.map((r) => [r.stopSequence, (r.estDep ?? 0) - r.schedDep])).toEqual([
      [1, 0],
      [4, 240],
    ])
  })
})

describe('frequent route with 6-minute headways', () => {
  const trips: SynthTrip[] = Array.from({ length: 10 }, (_, i) => ({
    id: `H${i}`,
    route: 'B200-1',
    stops: [
      ['A', `08:${String(i * 6).padStart(2, '0')}:00`],
      ['B', `08:${String(i * 6 + 4).padStart(2, '0')}:00`],
    ],
  }))
  const matcher = new TripMatcher('bus', [tripIndex(D, trips)])
  it('tier 4 is ambiguous when an RT time sits between two scheduled trips, so it stays unmatched', () => {
    // 08:15 at stop A: H2 (08:12) and H3 (08:18) are both within ±5 minutes.
    const r = matcher.match({ routeId: 'B200-9', directionId: 0, startDate: D }, [
      { seq: 1, stopId: 'A', dep: t(D, '08:15:00') },
    ])
    expect(r).toEqual({ kind: 'ambiguous', tier: 4, candidates: 2 })
  })
  it('tier 4 matches when exactly one candidate is in the window', () => {
    const r = matcher.match({ routeId: 'B200-9', directionId: 0, startDate: D }, [
      { seq: 1, stopId: 'A', dep: t(D, '08:12:30') },
    ])
    expect(r).toMatchObject({ kind: 'matched', tier: 4, key: `H2@${D}` })
  })
  it('tier 1 is exact', () => {
    expect(matcher.match({ tripId: 'H7', startDate: D }, [])).toMatchObject({
      kind: 'matched',
      tier: 1,
      key: `H7@${D}`,
    })
  })
  it('tier 2 uses start time and needs exactly one instance', () => {
    expect(
      matcher.match({ routeId: 'B200-9', directionId: 0, startTime: '08:24:00', startDate: D }, []),
    ).toMatchObject({
      kind: 'matched',
      tier: 2,
      key: `H4@${D}`,
    })
  })
})

describe('branches and opposite directions at shared stops', () => {
  const trips: SynthTrip[] = [
    {
      id: 'NB',
      route: 'R1-1',
      dir: 0,
      stops: [
        ['S', '09:00:00'],
        ['X', '09:10:00'],
      ],
    },
    {
      id: 'SB',
      route: 'R1-1',
      dir: 1,
      stops: [
        ['X', '08:55:00'],
        ['S', '09:02:00'],
      ],
    },
    {
      id: 'BR',
      route: 'R1-1',
      dir: 0,
      stops: [
        ['S', '09:01:00'],
        ['Y', '09:12:00'],
      ],
    },
  ]
  const m = new TripMatcher('train', [tripIndex(D, trips)])
  it('direction filters the opposite trip, pattern filters the branch', () => {
    expect(
      m.match({ routeId: 'R1-2', directionId: 0, startDate: D }, [
        { seq: 1, stopId: 'S', dep: t(D, '09:01:00') },
        { seq: 2, stopId: 'X' },
      ]),
    ).toMatchObject({
      kind: 'matched',
      key: `NB@${D}`,
    })
  })
  it('without direction or pattern it is ambiguous', () => {
    expect(
      m.match({ routeId: 'R1-2', startDate: D }, [{ seq: 1, stopId: 'S', dep: t(D, '09:01:00') }]),
    ).toMatchObject({ kind: 'ambiguous' })
  })
  it('rail tier 3 matches the trip-ID prefix after a suffix rotation', () => {
    const rail = new TripMatcher('train', [
      tripIndex(D, [
        {
          id: '39390611-ATS 26-1',
          route: 'R610-1',
          stops: [
            ['S', '09:00:00'],
            ['X', '09:10:00'],
          ],
        },
      ]),
    ])
    expect(
      rail.match({ tripId: '39390611-ATS 26-2', routeId: 'R610-9', startDate: D }, [{ seq: 2, stopId: 'X' }]),
    ).toMatchObject({
      kind: 'matched',
      tier: 3,
    })
  })
})

describe('stop-event state machine', () => {
  const sched = 1000
  const base = (updates: RtTrip['updates'], rel: RtTrip['rel'] = 'SCHEDULED'): RtTrip => ({
    key: 'k',
    rel,
    ts: 0,
    updates,
  })
  it('propagates a delay downstream until the next explicit update', () => {
    const trip = base([
      { seq: 2, rel: 'SCHEDULED', depDelay: 120 },
      { seq: 5, rel: 'SCHEDULED', depDelay: 30 },
    ])
    expect(predictStop(trip, 3, sched, sched, 'live').estDep).toBe(sched + 120)
    expect(predictStop(trip, 6, sched, sched, 'live').estDep).toBe(sched + 30)
  })
  it('never propagates through NO_DATA', () => {
    const trip = base([
      { seq: 2, rel: 'SCHEDULED', depDelay: 120 },
      { seq: 3, rel: 'NO_DATA' },
    ])
    expect(predictStop(trip, 4, sched, sched, 'live')).toEqual({
      estArr: null,
      estDep: null,
      status: 'scheduled',
    })
  })
  it('a SKIPPED stop renders as skipped and is transparent for propagation', () => {
    const trip = base([
      { seq: 2, rel: 'SCHEDULED', depDelay: 60 },
      { seq: 3, rel: 'SKIPPED' },
    ])
    expect(predictStop(trip, 3, sched, sched, 'live').status).toBe('skipped')
    expect(predictStop(trip, 4, sched, sched, 'live').estDep).toBe(sched + 60)
  })
  it('a cancelled trip shows cancelled, and unknown once RT is stale', () => {
    const trip = base([], 'CANCELED')
    expect(predictStop(trip, 1, sched, sched, 'live').status).toBe('cancelled')
    expect(predictStop(trip, 1, sched, sched, 'stale').status).toBe('unknown')
  })
  it('stale RT falls back to scheduled for ordinary rows', () => {
    expect(
      predictStop(base([{ seq: 1, rel: 'SCHEDULED', depDelay: 300 }]), 1, sched, sched, 'stale').status,
    ).toBe('scheduled')
  })
  it('a generation mismatch serves scheduled-only rows (reloading)', () => {
    expect(rtStateFor(100, 110, false)).toBe('reloading')
    expect(
      predictStop(base([{ seq: 1, rel: 'SCHEDULED', depDelay: 300 }]), 1, sched, sched, 'reloading').status,
    ).toBe('scheduled')
  })
  it('rtState goes stale after 5 minutes', () => {
    expect(rtStateFor(100, 400, true)).toBe('live')
    expect(rtStateFor(100, 401, true)).toBe('stale')
    expect(rtStateFor(null, 401, true)).toBe('unavailable')
  })
})

describe('departures merge with RT', () => {
  const trips: SynthTrip[] = [
    {
      id: 'C1',
      route: 'F1-1',
      stops: [
        ['A', '10:00:00'],
        ['B', '10:10:00'],
        ['C', '10:20:00'],
      ],
    },
    {
      id: 'S1',
      route: 'F1-1',
      stops: [
        ['A', '10:05:00'],
        ['B', '10:15:00'],
        ['C', '10:25:00'],
      ],
    },
    {
      id: 'N1',
      route: 'F1-1',
      stops: [
        ['A', '10:08:00'],
        ['B', '10:18:00'],
      ],
    },
  ]
  const now = t(D, '09:50:00')
  const rt = snapshot(
    {
      [`C1@${D}`]: { key: `C1@${D}`, rel: 'CANCELED', ts: now, until: t(D, '10:20:00'), updates: [] },
      [`S1@${D}`]: {
        key: `S1@${D}`,
        rel: 'SCHEDULED',
        ts: now,
        updates: [
          { seq: 1, rel: 'SCHEDULED', depDelay: 60 },
          { seq: 2, rel: 'SKIPPED' },
        ],
      },
    },
    now,
  )
  it('cancelled stays listed as cancelled; skipping the destination drops the row', () => {
    const rows = mergeDepartures([stopDay(D, 'A', trips)], rt, {
      nowS: now,
      rtState: 'live',
      toStopIds: new Set(['B']),
    })
    expect(rows.map((r) => [r.tripInstance, r.status])).toEqual([
      [`C1@${D}`, 'cancelled'],
      [`N1@${D}`, 'scheduled'],
    ])
  })
  it('to C: the skipped intermediate stop does not matter and the delay propagates to the arrival', () => {
    const rows = mergeDepartures([stopDay(D, 'A', trips)], rt, {
      nowS: now,
      rtState: 'live',
      toStopIds: new Set(['C']),
    })
    const s1 = rows.find((r) => r.tripInstance === `S1@${D}`)
    expect(s1?.estDep).toBe(t(D, '10:06:00'))
    expect(s1?.estArrTo).toBe(t(D, '10:26:00'))
  })
  it('limit and ordering use the effective departure', () => {
    const rows = mergeDepartures([stopDay(D, 'A', trips)], rt, { nowS: now, rtState: 'live', limit: 2 })
    expect(rows).toHaveLength(2)
  })
})

describe('ADDED trip', () => {
  it('an ADDED trip with an unknown trip id is not matched (the hub counts and drops it)', () => {
    const m = new TripMatcher('bus', [tripIndex(D, [{ id: 'X', route: 'B1-1', stops: [['A', '08:00:00']] }])])
    expect(
      m.match({ tripId: 'NEW-1', routeId: 'B9-1', startDate: D }, [
        { seq: 1, stopId: 'Q', dep: t(D, '08:00:00') },
      ]),
    ).toEqual({ kind: 'unmatched' })
  })
})

describe('planned closure', () => {
  it('calendar_dates removal is reported as an explained closure', () => {
    const cal = new ServiceCalendar(
      [
        {
          service_id: 'WK',
          monday: '1',
          tuesday: '1',
          wednesday: '1',
          thursday: '1',
          friday: '1',
          saturday: '0',
          sunday: '0',
          start_date: '20261001',
          end_date: '20261231',
        },
      ],
      [{ service_id: 'WK', date: D, exception_type: '2' }],
    )
    expect(cal.activeServices(D).has('WK')).toBe(false)
    expect(cal.isExplicitlyRemoved('WK', D)).toBe(true)
    expect(cal.activeServices('20261021').has('WK')).toBe(true)
    expect(cal.activeServices('20261024').has('WK')).toBe(false)
  })
})

describe('03:00 feed swap', () => {
  it('trip IDs rotate in a new generation: old-generation RT is not merged (reloading), then matches again', () => {
    const oldGen = tripIndex(
      D,
      [
        {
          id: 'T-OLD',
          route: 'F1-1',
          stops: [
            ['A', '08:00:00'],
            ['B', '08:10:00'],
          ],
        },
      ],
      'g1',
    )
    const newGen = tripIndex(
      D,
      [
        {
          id: 'T-NEW',
          route: 'F1-1',
          stops: [
            ['A', '08:00:00'],
            ['B', '08:10:00'],
          ],
        },
      ],
      'g2',
    )
    // The hub still holds g1; the Worker has g2 static files: generations differ, so rtState is reloading.
    expect(rtStateFor(1, 2, oldGen.generation === newGen.generation)).toBe('reloading')
    // After reload the hub matches RT "T-OLD" by route/start time against g2 (tier 2) rather than mixing.
    const m = new TripMatcher('ferry', [newGen])
    expect(
      m.match({ tripId: 'T-OLD', routeId: 'F1-1', directionId: 0, startTime: '08:00:00', startDate: D }, []),
    ).toMatchObject({
      kind: 'matched',
      tier: 2,
      key: `T-NEW@${D}`,
    })
  })
})

describe('Codex PR38 review regressions', () => {
  it('tier 4 compares arrivals with arrivals: an arrival-only observation shared by two trips stays ambiguous', () => {
    const m = new TripMatcher('bus', [
      tripIndex(D, [
        {
          id: 'P',
          route: 'B5-1',
          stops: [
            ['A', '08:00:00', '08:01:00'],
            ['B', '08:20:00'],
          ],
        },
        {
          id: 'Q',
          route: 'B5-1',
          stops: [
            ['A', '08:00:00', '08:10:00'],
            ['B', '08:30:00'],
          ],
        },
      ]),
    ])
    expect(
      m.match({ routeId: 'B5-1', directionId: 0, startDate: D }, [
        { seq: 1, stopId: 'A', arr: t(D, '08:00:00') },
      ]),
    ).toMatchObject({
      kind: 'ambiguous',
      tier: 4,
    })
    expect(
      m.match({ routeId: 'B5-1', directionId: 0, startDate: D }, [
        { seq: 1, stopId: 'A', dep: t(D, '08:10:30') },
      ]),
    ).toMatchObject({
      kind: 'matched',
      key: `Q@${D}`,
    })
  })

  it('a resolvable ADDED trip appears as a live row; scheduled-only when RT is not live', () => {
    const now = t(D, '09:00:00')
    const added: RtTrip = {
      key: `rt:EXTRA@${D}`,
      rel: 'ADDED',
      ts: now,
      updates: [],
      added: {
        route: { id: 'F1-1', short: 'F1' },
        headsign: 'Northshore',
        directionId: 0,
        stops: [
          { stopId: 'A', seq: 1, arr: t(D, '09:10:00'), dep: t(D, '09:10:00') },
          { stopId: 'B', seq: 2, arr: t(D, '09:25:00'), dep: t(D, '09:25:00') },
        ],
      },
    }
    const day = stopDay(D, 'A', [
      {
        id: 'S',
        route: 'F1-1',
        stops: [
          ['A', '09:30:00'],
          ['B', '09:45:00'],
        ],
      },
    ])
    const rows = mergeDepartures([day], snapshot({ [added.key]: added }, now), {
      nowS: now,
      rtState: 'live',
      toStopIds: new Set(['B']),
    })
    expect(rows.map((r) => [r.tripInstance, r.status, r.estArrTo])).toEqual([
      [`rt:EXTRA@${D}`, 'live', t(D, '09:25:00')],
      [`S@${D}`, 'scheduled', null],
    ])
    expect(
      mergeDepartures([day], snapshot({ [added.key]: added }, now), { nowS: now, rtState: 'stale' }),
    ).toHaveLength(1)
  })

  it('a skipped second loop visit does not hide the usable first boarding', () => {
    const loop: SynthTrip = {
      id: 'L2',
      route: 'B9-1',
      stops: [
        ['A', '08:00:00'],
        ['X', '08:05:00'],
        ['A', '08:10:00'],
        ['B', '08:20:00'],
      ],
    }
    const rt: RtTrip = {
      key: `L2@${D}`,
      rel: 'SCHEDULED',
      ts: 0,
      updates: [
        { seq: 1, rel: 'SCHEDULED', depDelay: 0 },
        { seq: 3, rel: 'SKIPPED' },
      ],
    }
    const now = t(D, '07:50:00')
    const rows = mergeDepartures([stopDay(D, 'A', [loop])], snapshot({ [rt.key]: rt }, now), {
      nowS: now,
      rtState: 'live',
      toStopIds: new Set(['B']),
    })
    expect(rows.map((r) => [r.stopSequence, r.status])).toEqual([[1, 'live']])
  })

  it('departure is clamped to the predicted arrival', () => {
    const trip: RtTrip = {
      key: 'k',
      rel: 'SCHEDULED',
      ts: 0,
      updates: [{ seq: 1, rel: 'SCHEDULED', arrDelay: 300, depDelay: 0 }],
    }
    expect(predictStop(trip, 1, 1000, 1060, 'live')).toEqual({ estArr: 1300, estDep: 1300, status: 'live' })
  })

  it('a clamped departure over an hour off the timetable is untrusted (smoke round 9)', () => {
    const trip: RtTrip = {
      key: 'k',
      rel: 'SCHEDULED',
      ts: 0,
      updates: [{ seq: 2, rel: 'SCHEDULED', arrDelay: 79 * 60, depDelay: 0 }],
    }
    expect(predictStop(trip, 2, 1000, 1000, 'live')).toEqual({
      estArr: null,
      estDep: null,
      status: 'scheduled',
    })
  })

  it('a delay stated at the stop is shown at any size; propagated, it is capped at an hour', () => {
    const trip: RtTrip = {
      key: 'k',
      rel: 'SCHEDULED',
      ts: 0,
      updates: [{ seq: 1, rel: 'SCHEDULED', depDelay: 3 * 3600 }],
    }
    expect(predictStop(trip, 1, 1000, 1000, 'live')).toMatchObject({
      estDep: 1000 + 3 * 3600,
      status: 'live',
    })
    expect(predictStop(trip, 2, 2000, 2000, 'live').status).toBe('scheduled')
    const hour: RtTrip = { ...trip, updates: [{ seq: 1, rel: 'SCHEDULED', depDelay: -3600 }] }
    expect(predictStop(hour, 2, 9000, 9000, 'live')).toMatchObject({ estDep: 5400, status: 'live' })
  })
})

describe('serviceDayStartEpoch memo', () => {
  it('returns the same Brisbane midnight-ish reference on repeat calls and across dates', async () => {
    const { serviceDayStartEpoch } = await import('../src/time/index.ts')
    const a = serviceDayStartEpoch('20261018')
    expect(serviceDayStartEpoch('20261018')).toBe(a)
    // 2026-10-17T14:00:00Z = 2026-10-18 00:00 Brisbane (UTC+10, no DST)
    expect(a).toBe(Date.UTC(2026, 9, 17, 14) / 1000)
    expect(serviceDayStartEpoch('20261019') - a).toBe(86400)
  })
})
