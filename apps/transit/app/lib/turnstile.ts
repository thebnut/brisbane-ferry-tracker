/**
 * Invisible Cloudflare Turnstile for the Ask box. The script loads only when the box is first used (never on the
 * first-load path). A token is fetched ahead when the field gets focus, used once, then the widget resets.
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

export interface InvisibleTurnstile {
  /** Start loading and solving in the background (on focus), so a token is ready by submit. */
  warm: () => void
  /** A fresh token, or null when Turnstile can't load or answer in time (the deterministic path still works). */
  token: (timeoutMs?: number) => Promise<string | null>
  dispose: () => void
}

export function invisibleTurnstile(sitekey: string, container: () => HTMLElement | null): InvisibleTurnstile {
  let api: TurnstileApi | null = null
  let id: string | null = null
  let ready: { token: string; at: number } | null = null
  let inflight: Promise<string | null> | null = null
  let settle: ((t: string | null) => void) | null = null

  const finish = (t: string | null) => {
    if (t) ready = { token: t, at: Date.now() }
    settle?.(t)
    settle = null
  }

  async function solve(timeoutMs: number): Promise<string | null> {
    try {
      api ??= await loadScript()
      const el = container()
      if (!el) return null
      if (id == null)
        id = api.render(el, {
          sitekey,
          execution: 'execute',
          appearance: 'interaction-only',
          action: 'ask',
          callback: (t: string) => finish(t),
          'error-callback': () => finish(null),
          'expired-callback': () => {
            ready = null
          },
          'timeout-callback': () => finish(null),
        })
      else api.reset(id)
      const result = new Promise<string | null>((resolve) => {
        settle = resolve
      })
      api.execute(id)
      const timer = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs))
      return await Promise.race([result, timer])
    } catch {
      return null
    }
  }

  const fresh = () => (ready && Date.now() - ready.at < TOKEN_TTL_MS ? ready.token : null)

  return {
    warm() {
      if (fresh() || inflight) return
      inflight = solve(15_000).finally(() => {
        inflight = null
      })
    },
    async token(timeoutMs = 8000) {
      let t = fresh()
      if (!t) t = await (inflight ?? solve(timeoutMs))
      // Single use: drop it and start on the next one.
      ready = null
      return t
    },
    dispose() {
      if (api && id != null) api.remove(id)
      id = null
    },
  }
}
