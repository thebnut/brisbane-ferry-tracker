import { describe, expect, it } from 'vitest'
import {
  MAX_PLACE_STOPS,
  normalizeQuestion,
  parseQuestion,
  type StopCandidate,
  type StopResolver,
} from '../../src/ask/parser.ts'
import questions from './questions.json' with { type: 'json' }
import { testResolver } from './resolver.ts'

interface Q {
  q: string
  kind: string
  from?: string
  to?: string
}

describe('deterministic parser on the 200-question set', () => {
  const results = (questions as Q[]).map((x) => ({ x, r: parseQuestion(x.q, testResolver) }))
  const handled = results.filter(({ r }) => r.ok)
  const wrong = results.filter(({ x, r }) => {
    if (!r.ok) return false
    if (x.kind === 'llm') return true // parsed something we said needs the LLM
    if (r.intent.kind !== x.kind) return true
    if (r.intent.kind === 'next_departure') {
      if (x.from && r.intent.from.key !== x.from) return true
      if (x.to && r.intent.to.key !== x.to) return true
    }
    if (r.intent.kind === 'departures_at' && x.from && r.intent.at.key !== x.from) return true
    return false
  })

  it('handles at least 70% of questions without an LLM', () => {
    const coverage = handled.length / results.length
    expect(coverage, `parser coverage ${handled.length}/${results.length}`).toBeGreaterThanOrEqual(0.7)
  })

  it('never returns a wrong intent or stop for a question it handles (precision first)', () => {
    expect(wrong.map(({ x, r }) => ({ q: x.q, expected: x.kind, got: r.ok ? r.intent : r }))).toEqual([])
  })
})

describe('parser details', () => {
  it('normalises for the intent cache', () => {
    expect(normalizeQuestion("  When's the NEXT train from Bowen Hills stn?? ")).toBe(
      'when is the next train from bowen hills station',
    )
  })
  it('a fuzzy typo still resolves', () => {
    const r = parseQuestion('next train from bowen hils to the airport', testResolver)
    expect(r.ok && r.intent.kind === 'next_departure' && r.intent.to?.key).toBe('international-airport')
  })
  it('an ambiguous stop across modes is not guessed', () => {
    const r = parseQuestion('departures at toowong', testResolver)
    expect(r.ok ? r.intent : r.reason).toBe('ambiguous_stop')
  })
  it('names the stop it could not find (explicit from/to, from, at shapes)', () => {
    const cases: Array<[string, string]> = [
      ['next ferry from zzyzx to bulimba', 'zzyzx'],
      ['next ferry from bulimba to nowhereville', 'nowhereville'],
      ['next train to bowen hills from nowhereville', 'nowhereville'],
      ['when is the next train from nowhereville', 'nowhereville'],
      ['departures at nowhereville ferry terminal', 'nowhereville'],
      ['next ferry from bulimba to zzyzx now', 'zzyzx'],
      ['next ferry to zzyzx from bulimba right now', 'zzyzx'],
    ]
    for (const [q, term] of cases) {
      const r = parseQuestion(q, testResolver)
      expect(r.ok ? r.intent : [r.reason, r.detail], q).toEqual(['unresolved_stop', term])
    }
  })
  it('trailing fillers do not break a known stop', () => {
    for (const q of [
      'next ferry from bulimba to south bank now',
      'next ferry to south bank from bulimba soon',
    ]) {
      const r = parseQuestion(q, testResolver)
      expect(r.ok && r.intent.kind === 'next_departure' && [r.intent.from.key, r.intent.to.key], q).toEqual([
        '317584',
        '317586',
      ])
    }
  })
  it('looser shapes without from/at do not guess a stop name', () => {
    const r = parseQuestion('what is the weather going to be', testResolver)
    expect(r.ok ? r.intent : [r.reason, r.detail]).toEqual(['no_match', undefined])
  })
  it('trip planning is flagged unsupported, not invented', () => {
    const r = parseQuestion('how do I get from Bulimba to the airport', testResolver)
    expect(r.ok && r.intent.kind).toBe('trip_plan_unsupported')
  })
  it('two near-equal stops in the same mode are not guessed (Codex PR review)', () => {
    const twoQueenSt = () => [
      { mode: 'bus' as const, key: 'A', name: 'Queen Street stop 41', score: 0.9 },
      { mode: 'bus' as const, key: 'B', name: 'Queen Street stop 42', score: 0.9 },
    ]
    for (const q of ['departures at queen street bus', 'show me departures queen street bus']) {
      const r = parseQuestion(q, twoQueenSt)
      expect(r.ok ? r.intent : r.reason, q).toBe('ambiguous_stop')
    }
  })
  it('first/last/clock-time questions are not answered as "next departures" (Codex PR review)', () => {
    for (const q of [
      'when is the last ferry from bulimba',
      'first train from central tomorrow',
      'ferry from bulimba at 5:30pm',
    ]) {
      const r = parseQuestion(q, testResolver)
      expect(r.ok, q).toBe(false)
    }
  })
  it('keeps bare route numbers as a restriction (Codex review round 5)', () => {
    const a = parseQuestion('next bus 199 from cultural centre', testResolver)
    expect(a.ok && a.intent.kind === 'departures_at' && a.intent.route).toBe('199')
    const c = parseQuestion('bus 199 departures at cultural centre', testResolver)
    expect(c.ok && c.intent.kind === 'departures_at' && c.intent.route).toBe('199')
    expect(parseQuestion('departures at cultural centre 42 please', testResolver).ok).toBe(false)
    const b = parseQuestion('next F11 from bulimba to riverside', testResolver)
    expect(b.ok && b.intent.kind === 'next_departure' && b.intent.route).toBe('F11')
  })
  it('alerts questions keep a named route as the line (first live run)', () => {
    const r = parseQuestion('are there any disruptions affecting the F1 citycat right now', testResolver)
    expect(r.ok && r.intent.kind === 'alerts' && r.intent.line).toBe('f1')
    // Compound or stop-number scopes are refused, never narrowed (Codex review, post-approval).
    const sh = parseQuestion('any problems on the Shorncliffe line today', testResolver)
    expect(sh.ok && sh.intent.kind === 'alerts' && sh.intent.line).toBe('shorncliffe')
    const cl = parseQuestion('cleveland line alerts', testResolver)
    expect(cl.ok && cl.intent.kind === 'alerts' && cl.intent.line).toBe('cleveland')
    expect(parseQuestion('alerts on F1 and F11', testResolver).ok).toBe(false)
    expect(parseQuestion('alerts at stop 1853 for route 66', testResolver).ok).toBe(false)
  })
})

describe('one place, several stops (R11-A1)', () => {
  const cc = ['10802', '11168', '12111']
  const bus = (
    key: string,
    name: string,
    score: number,
    extra: Partial<StopCandidate> = {},
  ): StopCandidate => ({
    mode: 'bus',
    key,
    name,
    score,
    ...extra,
  })
  // The edge resolver returns a busway station's platforms as one candidate carrying every stop key.
  const grouped: StopResolver = (text, mode) =>
    text === 'cultural centre' && mode !== 'train' && mode !== 'ferry'
      ? [bus('10802', 'Cultural Centre station', 1, { stopKeys: cc })]
      : testResolver(text, mode)

  it('"next bus from cultural centre" answers for the station, every platform', () => {
    const r = parseQuestion('next bus from cultural centre', grouped)
    expect(r.ok && r.intent).toMatchObject({
      kind: 'departures_at',
      mode: 'bus',
      at: { key: '10802', name: 'Cultural Centre station', stopKeys: cc },
    })
  })

  it('the same stop listed twice by a resolver is one candidate, not an ambiguity', () => {
    const twice: StopResolver = () => [
      bus('10802', 'Cultural Centre', 0.9),
      bus('10802', 'Cultural Centre', 0.9),
    ]
    const r = parseQuestion('departures at cultural centre bus', twice)
    expect(r.ok && r.intent.kind === 'departures_at' && r.intent.at.key).toBe('10802')
  })

  it('"to the airport" by train is International Airport (first reached), and the answer says so', () => {
    for (const q of [
      'next train from bowen hills to the airport',
      'next train to the airport from bowen hills',
    ]) {
      const r = parseQuestion(q, testResolver)
      expect(r.ok && r.intent, q).toMatchObject({
        kind: 'next_departure',
        mode: 'train',
        from: { key: 'bowen-hills' },
        to: { key: 'international-airport' },
        note: 'Airport trains stop at International Airport, then continue to Domestic Airport.',
      })
    }
  })

  it('"to the airport" from International Airport is Domestic Airport', () => {
    const r = parseQuestion('next train from international airport to the airport', testResolver)
    expect(r.ok && r.intent.kind === 'next_departure' && [r.intent.to.key, r.intent.note]).toEqual([
      'domestic-airport',
      undefined,
    ])
  })

  it('"from the airport" asks which airport station, naming both', () => {
    for (const q of ['next train from the airport to bowen hills', 'train departures at the airport']) {
      const r = parseQuestion(q, testResolver)
      expect(r.ok ? r.intent : r, q).toMatchObject({
        reason: 'ambiguous_stop',
        detail: 'airport',
        mode: 'train',
        options: ['Domestic Airport', 'International Airport'],
      })
    }
  })

  it('distinct places with one name still ask, naming them (stop numbers when names repeat)', () => {
    const queenSt: StopResolver = () => [
      bus('1882', 'Queen Street station', 0.9, { stopKeys: ['1882', '1883'] }),
      bus('319473', 'Queen Street station (Southport)', 0.9, { stopKeys: ['319473', '319474'] }),
      bus('A', 'Queen St near Wellington St', 0.88, { code: '005501' }),
      bus('B', 'Queen St near Wellington St', 0.88, { code: '005502' }),
    ]
    const r = parseQuestion('next bus from queen street', queenSt)
    expect(r.ok ? r.intent : r).toMatchObject({
      reason: 'ambiguous_stop',
      detail: 'queen street',
      mode: 'bus',
      options: [
        'Queen Street station',
        'Queen Street station (Southport)',
        'Queen St near Wellington St (stop 5501)',
      ],
    })
  })

  it('across modes, each option names its mode; no mode in the question means none in the result', () => {
    const r = parseQuestion('departures at toowong', testResolver)
    expect(r.ok ? r.intent : r).toMatchObject({ reason: 'ambiguous_stop', detail: 'toowong' })
    if (!r.ok) {
      expect(r.mode).toBeUndefined()
      expect(r.options?.every((o) => / \((train|bus|ferry)\)$/.test(o))).toBe(true)
    }
  })

  it(`a station with more than ${MAX_PLACE_STOPS} stops asks for the stop number, naming the station`, () => {
    const keys = Array.from({ length: 15 }, (_, i) => String(1000 + i))
    const big: StopResolver = () => [bus('1000', 'Queen Street station', 1, { stopKeys: keys })]
    const r = parseQuestion('next bus from queen street station', big)
    expect(r.ok ? r.intent : r).toMatchObject({
      reason: 'ambiguous_stop',
      station: { name: 'Queen Street station', stops: 15 },
    })
  })
})

describe('a named platform or stop is passed to the resolver, not stripped (Codex r3)', () => {
  const seen = (q: string) => {
    const calls: Array<[string, string | undefined]> = []
    parseQuestion(q, (text, mode, opts) => {
      calls.push([text, opts?.platform])
      return testResolver(text, mode)
    })
    return calls
  }
  it.each([
    ['next bus from cultural centre platform 2', 'cultural centre', '2'],
    ['next bus from strathpine bus station stop a', 'strathpine', 'a'],
    ['next bus from carindale bay 3', 'carindale', '3'],
    ['next bus from queen street station platform 1 (southport)', 'queen street (southport)', '1'],
  ])('%s → %s + platform %s', (q, text, platform) => {
    expect(seen(q)[0]).toEqual([text, platform])
  })
  it('"stop 1234" alone is a stop number: no platform', () => {
    expect(seen('next bus from stop 1234')[0]).toEqual(['1234', undefined])
  })
})
