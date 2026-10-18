import { describe, expect, it } from 'vitest'
import {
  actualUsd,
  DEFAULT_BUDGET,
  emptyBudgetState,
  reconcile,
  reserve,
  rollBudget,
  worstCaseUsd,
} from '../../src/ask/budget.ts'
import { anthropicTools, FinalAnswerInput, isGroundedAnswer } from '../../src/ask/tools.ts'

const on = { ...DEFAULT_BUDGET, enabled: true, monthlyBudgetUsd: 0.01 }

describe('budget ledger', () => {
  it('is off by default (kill switch on, no budget)', () => {
    const r = reserve(emptyBudgetState('20261018'), DEFAULT_BUDGET, 'a', 0.001, 'ip', true, 0)
    expect(r.result).toEqual({ ok: false, reason: 'disabled' })
  })
  it('in-flight reservations count, so concurrent calls cannot overshoot', () => {
    let s = emptyBudgetState('20261018')
    const results = []
    for (let i = 0; i < 20; i++) {
      const r = reserve(s, on, `r${i}`, 0.002, `ip${i}`, true, 0)
      s = r.state
      results.push(r.result.ok)
    }
    expect(results.filter(Boolean)).toHaveLength(5)
    expect(s.reservedUsd).toBeCloseTo(0.01)
  })
  it('reconciling releases the unused part of the reservation', () => {
    let s = reserve(emptyBudgetState('20261018'), on, 'a', 0.002, 'ip', true, 0).state
    s = reconcile(s, 'a', 0.0005)
    expect(s.reservedUsd).toBe(0)
    expect(s.spentUsd).toBeCloseTo(0.0005)
  })
  it('enforces the per-IP daily quota, retries do not count, and the quota resets daily', () => {
    let s = emptyBudgetState('20261018')
    const big = { ...on, monthlyBudgetUsd: 100 }
    for (let i = 0; i < 10; i++) s = reserve(s, big, `q${i}`, 0.001, 'ipA', true, 0).state
    expect(reserve(s, big, 'q10', 0.001, 'ipA', true, 0).result).toEqual({ ok: false, reason: 'ip_quota' })
    expect(reserve(s, big, 'retry', 0.001, 'ipA', false, 0).result.ok).toBe(true)
    expect(reserve(rollBudget(s, '20261019', 0), big, 'q11', 0.001, 'ipA', true, 0).result.ok).toBe(true)
  })
  it('alerts once at 80% and resets monthly', () => {
    let s = emptyBudgetState('20261018')
    const r1 = reserve(s, on, 'a', 0.008, null, false, 0)
    expect(r1.result).toMatchObject({ ok: true, alert: true })
    s = r1.state
    expect(reserve(s, on, 'b', 0.001, null, false, 0).result).toMatchObject({ ok: true, alert: false })
    // Spend resets monthly; unreconciled reservations carry over (see the rollover test below).
    expect(rollBudget(s, '20261101', 0).spentUsd).toBe(0)
    expect(rollBudget(s, '20261101', 0).reservedUsd).toBeCloseTo(s.reservedUsd)
  })
  it('charges stale reservations from crashed callers in full (never refunds an uncertain call)', () => {
    const s = reserve(emptyBudgetState('20261018'), on, 'a', 0.002, null, false, 0).state
    const rolled = rollBudget(s, '20261018', 10 * 60_000)
    expect(rolled.reservedUsd).toBe(0)
    expect(rolled.spentUsd).toBeCloseTo(0.002)
    // A late reconcile doesn't double-charge (Codex review round 2): smaller actual adds nothing, larger adds the excess.
    expect(reconcile(rolled, 'a', 0.0005).spentUsd).toBeCloseTo(0.002)
    expect(reconcile(rolled, 'a', 0.003).spentUsd).toBeCloseTo(0.003)
    // Repeated reconciles are idempotent (Codex review round 3).
    const twice = reconcile(reconcile(rolled, 'a', 0.001), 'a', 0.001)
    expect(twice.spentUsd).toBeCloseTo(0.002)
    const normal = reserve(emptyBudgetState('20261018'), on, 'b', 0.002, null, false, 0).state
    expect(reconcile(reconcile(normal, 'b', 0.001), 'b', 0.001).spentUsd).toBeCloseTo(0.001)
  })
  it('carries in-flight reservations across the month rollover (Codex review round 5)', () => {
    const cfg = { ...on, monthlyBudgetUsd: 10 }
    const oct = reserve(
      emptyBudgetState('20261031'),
      cfg,
      'late',
      0.5,
      null,
      false,
      Date.parse('2026-10-31T13:59:00Z'),
    ).state
    const nov = rollBudget(oct, '20261101', Date.parse('2026-10-31T14:00:00Z'))
    expect(nov.spentUsd).toBe(0)
    expect(nov.reservedUsd).toBeCloseTo(0.5)
    // The new month can only reserve what's left after the carried reservation.
    expect(reserve(nov, cfg, 'big', 9.6, null, false, Date.parse('2026-10-31T14:00:00Z')).result.ok).toBe(
      false,
    )
    expect(reconcile(nov, 'late', 0.4).spentUsd).toBeCloseTo(0.4)
  })
  it('keeps settlement records bounded: pruned after 24 h (Codex review round 8)', () => {
    const cfg = { ...on, monthlyBudgetUsd: 1000 }
    let st = emptyBudgetState('20261018')
    for (let i = 0; i < 1000; i++) {
      st = reserve(st, cfg, `r${i}`, 0.001, null, false, 0).state
      st = reconcile(st, `r${i}`, 0.0005, 0)
    }
    expect(Object.keys(st.settled ?? {})).toHaveLength(1000)
    const later = rollBudget(st, '20261019', 25 * 3600_000)
    expect(Object.keys(later.settled ?? {})).toHaveLength(0)
    expect(later.spentUsd).toBeCloseTo(0.5)
  })
  it('ledger stays well under the 2 MB DO value limit at same-day volume (Codex review round 9)', () => {
    const cfg = { ...on, monthlyBudgetUsd: 1000, perIpDailyQuota: 10 }
    // A busy day: 20,000 distinct IPs already counted and 5,000 recent settlements.
    let st = emptyBudgetState('20261018')
    st = {
      ...st,
      perIp: Object.fromEntries(
        Array.from({ length: 20000 }, (_, i) => [`ip-hash-${i}-0123456789abcdef`, 3]),
      ),
      settled: Object.fromEntries(
        Array.from({ length: 5000 }, (_, i) => [crypto.randomUUID(), { usd: 0.00016, at: i }]),
      ),
    }
    st = reserve(st, cfg, 'next', 0.0002, 'ip-hash-1-0123456789abcdef', true, 6000).state
    st = reconcile(st, 'next', 0.00016, 6000)
    expect(Object.keys(st.settled ?? {}).length).toBeLessThanOrEqual(2000)
    expect(st.settled?.next).toBeDefined()
    expect(JSON.stringify(st).length).toBeLessThan(1_500_000)
    // New IPs beyond the cap fail closed (existing ones still get their quota).
    expect(reserve(st, cfg, 'x', 0.0002, 'brand-new-ip', true, 1).result).toEqual({
      ok: false,
      reason: 'capacity',
    })
    expect(reserve(st, cfg, 'y', 0.0002, 'ip-hash-2-0123456789abcdef', true, 1).result.ok).toBe(true)
  })
  it('worst case for one round (3k in, 400 out) is about $0.0005', () => {
    expect(worstCaseUsd(3000, 400)).toBeCloseTo(0.0005, 6)
    expect(actualUsd(1000, 100)).toBeLessThan(worstCaseUsd(3000, 400))
  })
})

describe('tools', () => {
  it('exports JSON schemas for the four tools', () => {
    expect(anthropicTools().map((t) => t.name)).toEqual([
      'search_stops',
      'get_departures',
      'get_trip',
      'get_alerts',
    ])
  })
  it('accepts only final answers whose refs came from successful tool calls', () => {
    const ev = {
      departures: new Set(['d1', 'd2']),
      alerts: new Set(['a1']),
      empty: new Map<string, 'get_alerts' | 'get_departures'>([
        ['e3', 'get_alerts'],
        ['e4', 'get_departures'],
      ]),
    }
    expect(isGroundedAnswer({ kind: 'departures', refs: ['d1'] }, ev)).toBe(true)
    expect(isGroundedAnswer({ kind: 'departures', refs: ['d9'] }, ev)).toBe(false)
    expect(isGroundedAnswer({ kind: 'alerts', refs: ['a1'] }, ev)).toBe(true)
    // Negative claims must cite the specific empty query of the right tool (Codex review rounds 3-4).
    expect(isGroundedAnswer({ kind: 'no_alerts', emptyRef: 'e3' }, ev)).toBe(true)
    expect(isGroundedAnswer({ kind: 'no_alerts', emptyRef: 'e4' }, ev)).toBe(false)
    expect(isGroundedAnswer({ kind: 'no_alerts', emptyRef: 'e9' }, ev)).toBe(false)
    expect(isGroundedAnswer({ kind: 'no_service', emptyRef: 'e4' }, ev)).toBe(true)
    expect(isGroundedAnswer({ kind: 'no_service', emptyRef: 'e3' }, ev)).toBe(false)
    expect(isGroundedAnswer({ kind: 'cannot_answer', reason: 'trip_planning' }, ev)).toBe(true)
    expect(FinalAnswerInput.safeParse({ kind: 'alerts', refs: [] }).success).toBe(false)
    expect(FinalAnswerInput.safeParse({ kind: 'departures', refs: [] }).success).toBe(false)
  })
})
