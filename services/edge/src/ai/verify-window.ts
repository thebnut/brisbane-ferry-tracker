/**
 * The aggregate budget for POST /v1/turnstile/verify (Codex review of #66, round 2): one fixed window counted in a
 * single Durable Object instance (Budget, name VERIFY_BUDGET_NAME), so it holds across every Cloudflare location,
 * unlike the Workers rate-limit binding, whose counters are per location and eventually consistent.
 * The window lives in the instance's memory: a flood keeps the instance awake, and an eviction (only after it has
 * been idle) just starts a fresh window, so no storage write is needed per request.
 */
export const VERIFY_BUDGET_NAME = 'turnstile-verify'
export const VERIFY_BUDGET = { limit: 300, windowMs: 60_000 }

export interface VerifyWindow {
  start: number
  count: number
}

/** Admit one request into the window (or a new one); returns the next window and whether it was admitted. */
export function admitInWindow(
  w: VerifyWindow | null,
  now: number,
  limit: number,
  windowMs: number,
): { window: VerifyWindow; ok: boolean } {
  const cur = w && now - w.start < windowMs ? w : { start: now, count: 0 }
  if (cur.count >= limit) return { window: cur, ok: false }
  return { window: { start: cur.start, count: cur.count + 1 }, ok: true }
}
