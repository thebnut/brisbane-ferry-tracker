/**
 * Invisible Cloudflare Turnstile, shared by the feedback sheet (here; also mounted by transit) and transit's Ask box
 * (apps/transit/app/lib/turnstile.ts re-exports this). The script loads only when the sheet opens or the box is first
 * used (never on the first-load path). A token is fetched ahead, used once, then the widget resets.
 * Tokens are single-use and valid for 300 s; ours are refreshed after 240 s.
 */

interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string
  execute: (id: string) => void
  reset: (id: string) => void
  remove: (id: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

export const TURNSTILE_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
const TOKEN_TTL_MS = 240_000

let script: Promise<TurnstileApi> | null = null

function loadScript(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  script ??= new Promise<TurnstileApi>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = TURNSTILE_SRC
    s.async = true
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile missing')))
    s.onerror = () => {
      script = null
      reject(new Error('turnstile failed to load'))
    }
    document.head.appendChild(s)
  })
  return script
}

/** `p`, or null once `ms` have passed. */
export function within<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms)
  })
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer))
}

export interface InvisibleTurnstile {
  /** Start loading and solving in the background (on focus), so a token is ready by submit. */
  warm: () => void
  /** A fresh token, or null when Turnstile can't load or answer in time (the deterministic path still works). */
  token: (timeoutMs?: number) => Promise<string | null>
  dispose: () => void
}

/** `action` is echoed by siteverify; the feedback relays require 'feedback' (api/_turnstile.js). */
export function invisibleTurnstile(
  sitekey: string,
  container: () => HTMLElement | null,
  action = 'ask',
): InvisibleTurnstile {
  let api: TurnstileApi | null = null
  let id: string | null = null
  let ready: { token: string; at: number } | null = null
  let inflight: Promise<string | null> | null = null
  let settle: ((t: string | null) => void) | null = null
  /**
   * Bumped by dispose(). Work started under an older generation (a script still loading, a widget callback) is
   * ignored, so a sheet closed mid-load can't render into, or answer for, the next one (Codex review of #66). The
   * instance stays usable: the next warm()/token() starts a fresh generation's widget.
   */
  let gen = 0

  const finish = (g: number, t: string | null) => {
    if (g !== gen) return
    if (t) ready = { token: t, at: Date.now() }
    settle?.(t)
    settle = null
  }

  /**
   * Load (once), render or reset, execute. Never awaited without `within()`: a script request that stalls without
   * load or error events must not leave the Ask box "Asking…" (Codex review of #50, finding 3).
   */
  async function solve(): Promise<string | null> {
    const g = gen
    try {
      api ??= await loadScript()
      if (g !== gen) return null
      const el = container()
      if (!el) return null
      if (id == null)
        id = api.render(el, {
          sitekey,
          execution: 'execute',
          appearance: 'interaction-only',
          action,
          callback: (t: string) => finish(g, t),
          'error-callback': () => finish(g, null),
          'expired-callback': () => {
            if (g === gen) ready = null
          },
          'timeout-callback': () => finish(g, null),
        })
      else api.reset(id)
      const result = new Promise<string | null>((resolve) => {
        settle = resolve
      })
      api.execute(id)
      return await result
    } catch {
      return null
    }
  }

  const fresh = () => (ready && Date.now() - ready.at < TOKEN_TTL_MS ? ready.token : null)

  return {
    warm() {
      if (fresh() || inflight) return
      const p = within(solve(), 15_000).finally(() => {
        if (inflight === p) inflight = null
      })
      inflight = p
    },
    async token(timeoutMs = 8000) {
      let t = fresh()
      // The whole wait is bounded, including the script load and a warm-up already in flight.
      if (!t) t = await within(inflight ?? solve(), timeoutMs)
      // Single use: drop it and start on the next one.
      ready = null
      return t
    },
    dispose() {
      gen++
      settle?.(null)
      settle = null
      inflight = null
      ready = null
      if (api && id != null) api.remove(id)
      id = null
    },
  }
}
