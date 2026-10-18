/**
 * Budget Durable Object (transit-architecture.md §3.9, ADR-0008): the strongly consistent AI spend ledger.
 * One instance ("global") holds the monthly dollar budget and the per-IP daily quotas. Every provider attempt
 * reserves its worst-case cost here first and reconciles afterwards, so concurrent calls can't overshoot.
 */
import { DurableObject } from 'cloudflare:workers'
import {
  type BudgetConfig,
  type BudgetState,
  brisbaneDate,
  emptyBudgetState,
  type ReserveResult,
  reconcile,
  reserve,
  rollBudget,
} from '@bft/core'
import { admitStored, type VerifyWindow } from './verify-window.ts'

const KEY = 'ledger'

export class Budget extends DurableObject {
  private state: BudgetState | null = null
  /** Only used on the VERIFY_BUDGET_NAME instance (verify-window.ts); the AI ledger instance never touches it. */
  private verifyWindow: VerifyWindow | null = null

  /**
   * One admission for POST /v1/turnstile/verify's aggregate budget (single-threaded, so globally consistent; the
   * window is persisted, so an eviction doesn't reset it). A storage failure throws, and the route fails closed.
   */
  async admitVerify(limit: number, windowMs: number): Promise<boolean> {
    try {
      const r = await admitStored(this.ctx.storage, this.verifyWindow, Date.now(), limit, windowMs)
      this.verifyWindow = r.window
      return r.ok
    } catch (error) {
      this.verifyWindow = null
      throw error
    }
  }

  private async load(now: number): Promise<BudgetState> {
    const day = brisbaneDate(now)
    if (!this.state) this.state = (await this.ctx.storage.get<BudgetState>(KEY)) ?? emptyBudgetState(day)
    this.state = rollBudget(this.state, day, now)
    return this.state
  }

  private async save(s: BudgetState): Promise<void> {
    this.state = s
    await this.ctx.storage.put(KEY, s)
  }

  async reserve(
    cfg: BudgetConfig,
    id: string,
    usd: number,
    ip: string | null,
    countQuestion: boolean,
  ): Promise<ReserveResult> {
    const now = Date.now()
    const r = reserve(await this.load(now), cfg, id, usd, ip, countQuestion, now)
    if (r.result.ok) {
      try {
        await this.save(r.state)
      } catch {
        // Never let a storage failure turn into an unrecorded spend: fail closed.
        this.state = null
        return { ok: false, reason: 'capacity' }
      }
    }
    return r.result
  }

  async reconcile(id: string, usd: number): Promise<void> {
    await this.save(reconcile(await this.load(Date.now()), id, usd))
  }

  async status(): Promise<{ month: string; spentUsd: number; reservedUsd: number; alerted: boolean }> {
    const s = await this.load(Date.now())
    return { month: s.month, spentUsd: s.spentUsd, reservedUsd: s.reservedUsd, alerted: s.alerted }
  }
}
