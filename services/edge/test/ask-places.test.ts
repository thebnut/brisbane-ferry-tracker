/**
 * R11-A1: Ask treats a busway station's platforms as one place, "the airport" by train as International Airport, and
 * replies to a genuinely ambiguous name by naming the places. Stop names and coordinates are the SEQ feed's (17 Oct
 * 2026) unless marked synthetic.
 */
import {
  type DeparturesResponse,
  type Intent,
  MAX_PLACE_STOPS,
  type Mode,
  parseQuestion,
  type StopIndexEntry,
} from '@bft/core'
import { describe, expect, it } from 'vitest'
import { ASK_EXAMPLES } from '../../../apps/transit/app/lib/ask-examples.ts'
import { answerIntent } from '../src/ai/answer.ts'
import { buildIndex, placeName, resolverFor, searchStops } from '../src/ai/resolver.ts'
import { ambiguityReply } from '../src/ai/routes.ts'

const stop = (key: string, name: string, lat: number, lon: number, code?: string): StopIndexEntry => ({
  key,
  name,
  lat,
  lon,
  routes: [],
  ...(code ? { code } : {}),
})

const QUEEN_ST_BUSWAY: Array<[string, string, number, number]> = [
  ['919', 'Queen Street station', -27.470717, 153.023825],
  ['929', 'Queen Street station', -27.470269, 153.024518],
  ['996', 'Queen Street station, 1a', -27.470815, 153.023906],
  ['997', 'Queen Street station, 1b', -27.47067, 153.024082],
  ['998', 'Queen Street station, 1c', -27.470526, 153.024283],
  ['999', 'Queen Street station, 1d', -27.470427, 153.024472],
  ['1001', 'Queen Street station, 1e', -27.470552, 153.024575],
  ['1002', 'Queen Street station, 1f', -27.470675, 153.024755],
  ['1003', 'Queen Street station, 1g', -27.470652, 153.024996],
  ['1004', 'Queen Street station, 1h', -27.470526, 153.025195],
  ['1008', 'Queen Street station, 3b', -27.470357, 153.025136],
  ['1009', 'Queen Street station, 3a', -27.470371, 153.024839],
  ['1010', 'Queen Street station, 2a', -27.470161, 153.02477],
  ['1011', 'Queen Street station, 2b', -27.47007, 153.02489],
  ['1013', 'Queen Street station, 2c', -27.469899, 153.025115],
]

const STOPS: Record<Mode, StopIndexEntry[]> = {
  ferry: [stop('317584', 'Bulimba ferry terminal', -27.4528, 153.0574, '317584')],
  train: [
    stop('ferny-grove', 'Ferny Grove station', -27.4006, 152.9354),
    stop('bowen-hills', 'Bowen Hills station', -27.4366, 153.0384),
    stop('domestic-airport', 'Domestic Airport station', -27.384928, 153.119077),
    stop('international-airport', 'International Airport station', -27.402924, 153.108816),
  ],
  bus: [
    stop('10802', 'Cultural Centre station, platform 1', -27.473232, 153.019415, '010802'),
    stop('11168', 'Cultural Centre station, platform 2', -27.473455, 153.019148, '011168'),
    stop('12111', 'Cultural Centre station, platform 3', -27.474196, 153.017901, '012111'),
    ...QUEEN_ST_BUSWAY.map(([k, n, lat, lon]) => stop(k, n, lat, lon, k.padStart(6, '0'))),
    stop('319473', 'Queen Street station (Southport)', -27.970092, 153.394337, '319473'),
    stop('600827', 'Queen Street station, platform 1 (Southport)', -27.970174, 153.394395, '600827'),
    // Synthetic: one name at two places ~5 km apart (must stay two candidates).
    stop('FAR-A', 'Main Rd at Shops', -27.5, 153.0),
    stop('FAR-B', 'Main Rd at Shops', -27.545, 153.0),
    stop('320357', 'Brisbane Domestic Airport', -27.3853, 153.118508, '320357'),
    stop('320358', 'Brisbane International Airport', -27.404467, 153.108597, '320358'),
  ],
  tram: [],
}
const indexes = (['ferry', 'train', 'bus'] as const).map((m) => buildIndex(m, STOPS[m]))
const resolver = resolverFor(indexes)

describe('the home page example chips (apps/transit ASK_EXAMPLES)', () => {
  it.each(ASK_EXAMPLES)('"%s" gets a real answer: no ambiguous or unresolved stop', (q) => {
    const r = parseQuestion(q, resolver)
    expect(r.ok ? r.intent.kind : r).toMatch(/^(next_departure|departures_at|alerts)$/)
  })
})

describe('placeName', () => {
  it.each([
    ['Cultural Centre station, platform 1', 'Cultural Centre station'],
    ['Queen Street station, 1e', 'Queen Street station'],
    ['Queen Street station', 'Queen Street station'],
    ['Queen Street station, platform 2 (Southport)', 'Queen Street station (Southport)'],
    ['Strathpine bus station, stop D', 'Strathpine bus station'],
    ['King George Square, 1a', 'King George Square'],
    ['Sandgate Rd at Nundah, stop 3', 'Sandgate Rd at Nundah'],
    // Compound stop numbers and plain names are kept whole.
    ['Junction Rd at Eagle Junction station, stop 28/1', 'Junction Rd at Eagle Junction station, stop 28/1'],
    ['Brisbane Rd at Ebbw Vale station', 'Brisbane Rd at Ebbw Vale station'],
  ])('%s → %s', (name, place) => expect(placeName(name)).toBe(place))
})

describe('the Ask resolver groups one place (bus)', () => {
  it('"cultural centre" is one candidate: the station, every platform', () => {
    const [best, second] = resolver('cultural centre', 'bus')
    expect(best).toEqual({
      mode: 'bus',
      key: '10802',
      name: 'Cultural Centre station',
      score: 1,
      stopKeys: ['10802', '11168', '12111'],
    })
    expect(second).toBeUndefined()
  })

  it('the search_stops tool still lists platforms one by one', () => {
    expect(searchStops(indexes, 'cultural centre', 'bus').map((c) => c.key)).toEqual([
      '10802',
      '11168',
      '12111',
    ])
  })

  it('a stop number names that one platform, never the station', () => {
    expect(resolver('011168', 'bus')).toEqual([
      { mode: 'bus', key: '11168', name: 'Cultural Centre station, platform 2', score: 1, code: '011168' },
    ])
  })

  it('same-named stops far apart stay separate places (negative)', () => {
    const c = resolver('main rd at shops', 'bus')
    expect(c.map((x) => [x.key, x.stopKeys])).toEqual([
      ['FAR-A', undefined],
      ['FAR-B', undefined],
    ])
    const r = parseQuestion('next bus from main rd at shops', resolver)
    expect(r.ok ? r.intent : r.reason).toBe('ambiguous_stop')
  })

  it('Queen Street (Brisbane) and Queen Street (Southport) are different places', () => {
    const c = resolver('queen street station', 'bus')
    const brisbane = c.find((x) => x.name === 'Queen Street station')
    const southport = c.find((x) => x.name === 'Queen Street station (Southport)')
    expect(brisbane?.stopKeys).toHaveLength(15)
    expect(southport?.stopKeys).toEqual(['319473', '600827'])
  })

  it(`a place with more than ${MAX_PLACE_STOPS} stops asks for the stop number, naming the station`, () => {
    const big = buildIndex(
      'bus',
      QUEEN_ST_BUSWAY.map(([k, n, lat, lon]) => stop(k, n, lat, lon)),
    )
    const r = parseQuestion('next bus from queen street station', resolverFor([big]))
    expect(r.ok ? r.intent : r).toMatchObject({
      reason: 'ambiguous_stop',
      station: { name: 'Queen Street station', stops: 15 },
    })
    if (!r.ok)
      expect(ambiguityReply(r)).toBe(
        "'Queen Street station' has 15 stops, too many to answer for at once. Ask with the stop number from the sign at your platform.",
      )
  })
})

describe('the reported questions (smoke round 11)', () => {
  it('"next bus from cultural centre" resolves to the station', () => {
    const r = parseQuestion('next bus from cultural centre', resolver)
    expect(r.ok && r.intent).toMatchObject({
      kind: 'departures_at',
      at: { name: 'Cultural Centre station', stopKeys: ['10802', '11168', '12111'] },
    })
  })

  it('"next train from bowen hills to the airport" goes to International Airport, with the note', () => {
    const r = parseQuestion('next train from bowen hills to the airport', resolver)
    expect(r.ok && r.intent).toMatchObject({
      kind: 'next_departure',
      from: { key: 'bowen-hills' },
      to: { key: 'international-airport' },
      note: 'Airport trains stop at International Airport, then continue to Domestic Airport.',
    })
  })

  it('"next train from the airport" asks which, naming both stations', () => {
    const r = parseQuestion('next train from the airport', resolver)
    expect(r.ok).toBe(false)
    if (!r.ok)
      expect(ambiguityReply(r)).toBe(
        "'airport' matches more than one station. Did you mean 'Domestic Airport station' or 'International Airport station'? Use the full name.",
      )
  })

  it('the bus airport stops are still asked about by name (no train rule for buses)', () => {
    const r = parseQuestion('next bus from the airport', resolver)
    expect(r.ok ? r.intent : r).toMatchObject({
      reason: 'ambiguous_stop',
      options: ['Brisbane Domestic Airport', 'Brisbane International Airport'],
    })
  })
})

describe('ambiguityReply', () => {
  it('sanitises names it echoes', () => {
    expect(ambiguityReply({ detail: 'x', mode: 'bus', options: ["<b>O'Brien</b>", 'Plain\u0000Name'] })).toBe(
      "'x' matches more than one stop. Did you mean 'b OBrien /b' or 'Plain Name'? Use the full name or the stop number on the sign.",
    )
  })
  it('three options read as a list', () => {
    expect(ambiguityReply({ detail: 'q', mode: 'bus', options: ['A', 'B', 'C'] })).toContain(
      "Did you mean 'A', 'B' or 'C'?",
    )
  })
})

// ---------------------------------------------------------------- the answer for a place

const NOW = 1_760_900_000

function body(
  key: string,
  rows: Array<[string, number]>,
  rtState: 'live' | 'stale' = 'live',
): DeparturesResponse {
  return {
    rtState,
    stop: { key, name: `Cultural Centre station, platform ${key}`, stopIds: [key] },
    to: null,
    departures: rows.map(([trip, dep]) => ({
      tripInstance: trip,
      route: { short: trip.split('-')[0] as string },
      headsign: 'City',
      schedDep: dep,
      status: 'scheduled',
    })),
  } as unknown as DeparturesResponse
}

const place = (keys: string[]) => ({
  mode: 'bus' as const,
  key: keys[0] as string,
  name: 'Cultural Centre station',
  score: 1,
  stopKeys: keys,
})

describe('answerIntent for a place: every platform, in parallel', () => {
  it('merges the platforms, earliest first, and names the station', async () => {
    const calls: string[] = []
    const fetchApi = async (path: string) => {
      calls.push(path)
      const key = /stops\/(\w+)\//.exec(path)?.[1] as string
      const rows: Record<string, Array<[string, number]>> = {
        P1: [['60-a', NOW + 600]],
        P2: [['61-b', NOW + 120]],
        P3: [['199-c', NOW + 300]],
      }
      return Response.json(body(key, rows[key] ?? []))
    }
    const intent: Intent = { kind: 'departures_at', mode: 'bus', at: place(['P1', 'P2', 'P3']) }
    const a = await answerIntent(intent, fetchApi, NOW)
    expect(calls).toHaveLength(3)
    expect(a.answer).toMatch(
      /^Next buses from Cultural Centre station: 61 to City in 2 min .*; 199 to City in 5 min .*; 60 to City in 10 min /,
    )
    expect(a.stop).toEqual({ mode: 'bus', key: 'P1', name: 'Cultural Centre station' })
  })

  it('a slow platform does not hold the answer up: it goes out with the others, and says so', async () => {
    let release: () => void = () => {}
    const fetchApi = async (path: string) => {
      const key = /stops\/(\w+)\//.exec(path)?.[1] as string
      if (key === 'P3') await new Promise<void>((r) => (release = r))
      return Response.json(body(key, [[`60-${key}`, NOW + 120]]))
    }
    const intent: Intent = { kind: 'departures_at', mode: 'bus', at: place(['P1', 'P2', 'P3']) }
    const t0 = Date.now()
    const a = await answerIntent(intent, fetchApi, NOW, { platformGraceMs: 20 })
    expect(Date.now() - t0).toBeLessThan(1_000)
    expect(a.rows?.map((d) => d.tripInstance)).toEqual(['60-P1', '60-P2'])
    expect(a.answer).toContain("Some platforms at Cultural Centre station didn't answer in time")
    release()
  })

  it('a failed platform is skipped; all failed is the usual sorry', async () => {
    const intent: Intent = { kind: 'departures_at', mode: 'bus', at: place(['P1', 'P2']) }
    const some = await answerIntent(
      intent,
      async (p) =>
        p.includes('/P1/')
          ? new Response('x', { status: 503 })
          : Response.json(body('P2', [['60-x', NOW + 60]])),
      NOW,
    )
    expect(some.rows?.map((d) => d.tripInstance)).toEqual(['60-x'])
    expect(some.answer).toContain("didn't answer in time")
    const none = await answerIntent(intent, async () => new Response('x', { status: 503 }), NOW)
    expect(none.answer).toBe("Sorry, I couldn't load departures for Cultural Centre station right now.")
  })

  it('a place as the destination is one comma-separated `to`; the note is in the answer', async () => {
    const calls: string[] = []
    const fetchApi = async (path: string) => {
      calls.push(path)
      return Response.json({
        ...body('bowen-hills', [['BNBD-1', NOW + 240]]),
        to: { key: 'international-airport', name: 'International Airport station' },
      })
    }
    const intent: Intent = {
      kind: 'next_departure',
      mode: 'train',
      from: { mode: 'train', key: 'bowen-hills', name: 'Bowen Hills station', score: 1 },
      to: { mode: 'train', key: 'international-airport', name: 'International Airport station', score: 1 },
      note: 'Airport trains stop at International Airport, then continue to Domestic Airport.',
    }
    const a = await answerIntent(intent, fetchApi, NOW)
    expect(calls).toEqual(['/v1/train/stops/bowen-hills/departures?limit=5&to=international-airport'])
    expect(a.answer).toMatch(
      /to International Airport station: .*\. Airport trains stop at International Airport, then continue to Domestic Airport\.$/,
    )

    calls.length = 0
    await answerIntent(
      {
        kind: 'next_departure',
        mode: 'bus',
        from: place(['P1']),
        to: { ...place(['10802', '11168']), key: '10802' },
      },
      fetchApi,
      NOW,
    )
    expect(calls).toEqual(['/v1/bus/stops/P1/departures?limit=5&to=10802%2C11168'])
  })
})
