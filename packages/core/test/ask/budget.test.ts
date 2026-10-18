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
import { anthropicTools, isGrounded } from '../../src/ask/tools.ts'

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
    expect(rollBudget(s, '20261101', 0).spentUsd + rollBudget(s, '20261101', 0).reservedUsd).toBe(0)
  })
  it('releases stale reservations from crashed callers', () => {
    const s = reserve(emptyBudgetState('20261018'), on, 'a', 0.002, null, false, 0).state
    expect(rollBudget(s, '20261018', 10 * 60_000).reservedUsd).toBe(0)
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
  it('rejects ungrounded answers', () => {
    expect(isGrounded([], [])).toBe(false)
    expect(isGrounded([{ tripInstance: 'X@20261018' }], [{ tool: 'get_departures', departures: [] }])).toBe(
      false,
    )
    expect(
      isGrounded(
        [{ tripInstance: 'X@20261018' }],
        [{ tool: 'get_departures', departures: [{ tripInstance: 'X@20261018' }] }],
      ),
    ).toBe(true)
  })
})
