/**
 * The AI budget ledger (transit-architecture.md §3.9 "Hard cost controls", ADR-0008, Codex finding 13).
 *
 * Pure state machine; the `Budget` Durable Object in services/edge wraps it so every operation is strongly
 * consistent. Before each provider attempt the caller reserves a worst-case cost; afterwards it reconciles with the
 * actual token usage. Concurrent calls can't overshoot by more than the in-flight reservations.
 */

export interface BudgetConfig {
  /** Kill switch. Defaults to false: no paid AI until Brett picks a cap. */
  enabled: boolean
  /** Global monthly budget in USD. 0 means deterministic-only. */
  monthlyBudgetUsd: number
  /** LLM questions per hashed IP prefix per Brisbane day. */
  perIpDailyQuota: number
  /** Fraction of budget at which to raise an alert. */
  alertAt: number
}

export const DEFAULT_BUDGET: BudgetConfig = {
  enabled: false,
  monthlyBudgetUsd: 0,
  perIpDailyQuota: 10,
  alertAt: 0.8,
}

export interface BudgetState {
  month: string // YYYYMM
  day: string // YYYYMMDD
  spentUsd: number
  reservedUsd: number
  reservations: Record<string, { usd: number; ip: string | null; at: number }>
  perIp: Record<string, number>
  alerted: boolean
  /** Reservations already charged in full as stale: a late reconcile only adds any excess (idempotent). */
  settled?: Record<string, { usd: number; at: number }>
}

export const emptyBudgetState = (day: string): BudgetState => ({
  month: day.slice(0, 6),
  day,
  spentUsd: 0,
  reservedUsd: 0,
  reservations: {},
  perIp: {},
  alerted: false,
})

export type ReserveResult =
  | { ok: true; id: string; alert: boolean }
  | { ok: false; reason: 'disabled' | 'budget_exhausted' | 'ip_quota' | 'capacity' }

/** Haiku 5.5 list prices used for worst-case reservations (USD per million tokens); keep in config, not code paths. */
export const HAIKU_PRICE = { inputPerM: 0.1, outputPerM: 0.5 }

/** Worst case for one provider round: capped input plus max_tokens output. */
export function worstCaseUsd(maxInputTokens: number, maxOutputTokens: number, price = HAIKU_PRICE): number {
  return (maxInputTokens * price.inputPerM + maxOutputTokens * price.outputPerM) / 1_000_000
}

export function actualUsd(inputTokens: number, outputTokens: number, price = HAIKU_PRICE): number {
  return (inputTokens * price.inputPerM + outputTokens * price.outputPerM) / 1_000_000
}

/**
 * Roll the day / month windows forward. Reservations older than `staleMs` belong to crashed callers whose provider
 * call may still have been billed, so they are charged in full (never refunded) (Codex PR review).
 */
export function rollBudget(state: BudgetState, day: string, now: number, staleMs = 5 * 60_000): BudgetState {
  let s = state
  if (s.month !== day.slice(0, 6)) {
    // New month: spend resets, but in-flight reservations and settlement records carry over and count against the
    // new month, so a late previous-month call can't push the new month past its cap (Codex review round 5).
    s = {
      ...emptyBudgetState(day),
      reservations: s.reservations,
      reservedUsd: s.reservedUsd,
      settled: s.settled,
    }
  }
  if (s.day !== day) s = { ...s, day, perIp: {} }
  const reservations = { ...s.reservations }
  let reservedUsd = s.reservedUsd
  let spentUsd = s.spentUsd
  let settled = s.settled ?? {}
  for (const [id, r] of Object.entries(reservations)) {
    if (now - r.at > staleMs) {
      reservedUsd -= r.usd
      spentUsd += r.usd
      settled = { ...settled, [id]: { usd: r.usd, at: now } }
      delete reservations[id]
    }
  }
  // Settlement records only need to outlive late reconciles (callers finish in seconds; stale is 5 min). Keep them
  // 24 h so the ledger value stays small (Durable Object values are capped at 2 MB; Codex review round 8). A
  // reconcile arriving later than that is charged again: over-counting is the safe direction for a hard cap.
  const pruned: Record<string, { usd: number; at: number }> = {}
  for (const [id, v] of Object.entries(settled)) if (now - v.at <= SETTLED_RETENTION_MS) pruned[id] = v
  return { ...s, reservations, reservedUsd: Math.max(0, reservedUsd), spentUsd, settled: capSettled(pruned) }
}

/**
 * Reserve `usd` for one provider attempt. `ip` is a hashed IP prefix (null for system jobs such as alert summaries,
 * which still count against the global budget). `countQuestion` is true for the first attempt of a user question only,
 * so retries don't burn the user's quota but do reserve budget.
 */
export function reserve(
  state: BudgetState,
  cfg: BudgetConfig,
  id: string,
  usd: number,
  ip: string | null,
  countQuestion: boolean,
  now: number,
): { state: BudgetState; result: ReserveResult } {
  if (!cfg.enabled || cfg.monthlyBudgetUsd <= 0) return { state, result: { ok: false, reason: 'disabled' } }
  if (state.spentUsd + state.reservedUsd + usd > cfg.monthlyBudgetUsd) {
    return { state, result: { ok: false, reason: 'budget_exhausted' } }
  }
  if (ip && countQuestion && (state.perIp[ip] ?? 0) >= cfg.perIpDailyQuota) {
    return { state, result: { ok: false, reason: 'ip_quota' } }
  }
  if (Object.keys(state.reservations).length >= MAX_OUTSTANDING) {
    return { state, result: { ok: false, reason: 'capacity' } }
  }
  if (ip && countQuestion && state.perIp[ip] == null && Object.keys(state.perIp).length >= MAX_IPS_PER_DAY) {
    return { state, result: { ok: false, reason: 'capacity' } }
  }
  const perIp = ip && countQuestion ? { ...state.perIp, [ip]: (state.perIp[ip] ?? 0) + 1 } : state.perIp
  const next: BudgetState = {
    ...state,
    perIp,
    reservedUsd: state.reservedUsd + usd,
    reservations: { ...state.reservations, [id]: { usd, ip, at: now } },
  }
  const alert = !state.alerted && next.spentUsd + next.reservedUsd >= cfg.alertAt * cfg.monthlyBudgetUsd
  return { state: alert ? { ...next, alerted: true } : next, result: { ok: true, id, alert } }
}

export const SETTLED_RETENTION_MS = 24 * 3600_000
/**
 * Hard bounds that keep the ledger (one Durable Object value, max 2 MB) well under 1 MB (Codex review rounds 8-9):
 * at most MAX_SETTLED settlement records (newest kept; an evicted id that reconciles again is charged again, which
 * only over-counts), and at most MAX_IPS_PER_DAY per-IP counters (new IPs beyond that fail closed to deterministic
 * answers for the rest of the day).
 */
export const MAX_SETTLED = 2000
export const MAX_IPS_PER_DAY = 20000
/** Outstanding (in-flight) reservations: far above real concurrency; beyond it, fail closed (Codex review round 10). */
export const MAX_OUTSTANDING = 500

function capSettled(
  settled: Record<string, { usd: number; at: number }>,
): Record<string, { usd: number; at: number }> {
  const entries = Object.entries(settled)
  if (entries.length <= MAX_SETTLED) return settled
  entries.sort((a, b) => b[1].at - a[1].at)
  return Object.fromEntries(entries.slice(0, MAX_SETTLED))
}

/** Replace a reservation with the actual cost. Unknown ids (already released) still record the spend. */
export function reconcile(state: BudgetState, id: string, usd: number, now = Date.now()): BudgetState {
  const charged = state.settled?.[id]?.usd
  if (charged != null) {
    // Already recorded (stale charge or an earlier reconcile): add only spend not yet recorded. Idempotent.
    if (usd <= charged) return state
    return {
      ...state,
      settled: capSettled({ ...state.settled, [id]: { usd, at: now } }),
      spentUsd: state.spentUsd + (usd - charged),
    }
  }
  const r = state.reservations[id]
  const reservations = { ...state.reservations }
  delete reservations[id]
  return {
    ...state,
    reservations,
    settled: capSettled({ ...state.settled, [id]: { usd, at: now } }),
    reservedUsd: Math.max(0, state.reservedUsd - (r?.usd ?? 0)),
    spentUsd: state.spentUsd + usd,
  }
}
