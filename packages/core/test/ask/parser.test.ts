import { describe, expect, it } from 'vitest'
import { normalizeQuestion, parseQuestion } from '../../src/ask/parser.ts'
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
    expect(r.ok && r.intent.kind === 'next_departure' && r.intent.to?.key).toBe('domestic-airport')
  })
  it('an ambiguous stop across modes is not guessed', () => {
    const r = parseQuestion('departures at toowong', testResolver)
    expect(r.ok ? r.intent : r.reason).toBe('ambiguous_stop')
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
  })
})
