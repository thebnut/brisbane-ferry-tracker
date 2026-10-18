/**
 * The aggregate budget for POST /v1/turnstile/verify (Codex review of #66, round 2): one fixed window counted in a
 * single Durable Object instance (Budget, name VERIFY_BUDGET_NAME), so it holds across every Cloudflare location,
 * unlike the Workers rate-limit binding, whose counters are per location and eventually consistent.
 * The window is persisted in the instance's storage on every admission (Codex review round 3): an idle DO is evicted
 * after about 10 s, and an in-memory window would then restart mid-minute. Rejections write nothing. The read and
 * write run inside one DO event, and input gates keep other events out between them, so admissions can't race.
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

export const VERIFY_WINDOW_KEY = 'verify-window'

/** The slice of DurableObjectStorage this needs (injectable for tests). */
export interface WindowStore {
  get<T>(key: string): Promise<T | undefined>
  put<T>(key: string, value: T): Promise<void>
}

/**
 * Admit one request against the persisted window. `cached` is the instance's last known window (null after an
 * eviction, when it is read back from storage). Throws if storage fails, so the caller fails closed.
 */
export async function admitStored(
  store: WindowStore,
  cached: VerifyWindow | null,
  now: number,
  limit: number,
  windowMs: number,
): Promise<{ window: VerifyWindow; ok: boolean }> {
  const w = cached ?? (await store.get<VerifyWindow>(VERIFY_WINDOW_KEY)) ?? null
  const r = admitInWindow(w, now, limit, windowMs)
  if (r.ok) await store.put(VERIFY_WINDOW_KEY, r.window)
  return r
}
