/** Server-only helpers for loaders: bindings, fixture mode and the API fetcher. */
import { fixtureNow } from '@bft/core/fixture-clock'
import type { RouterContextProvider } from 'react-router'
import type { ApiFetcher } from './api.ts'
import { cloudflareContext } from './context.ts'
import { handleFixtureApi } from './fixtures.server.ts'
import { FIXTURE_COOKIE, getCookie } from './storage.ts'

export interface LoaderEnv {
  env: Env | null
  fixtures: boolean
  /** Forced rtState for fixture mode (?rt=unavailable etc.). */
  rt: string | null
  fetcher: ApiFetcher
  /** Set when FIXTURE_FALLBACK answered for an unavailable API: the page must then say it shows demo data. */
  fallback: { used: boolean }
}

/** Bindings, or null when rendering outside the Worker (prerender at build time). */
export function getEnv(context: Readonly<RouterContextProvider>): Env | null {
  try {
    return context.get(cloudflareContext).env
  } catch {
    return null
  }
}

/**
 * FIXTURE_FALLBACK (answer with fixtures when the API fails) is a development switch: it counts only where demo data is
 * allowed at all (ALLOW_FIXTURES), so a stray value can never put demo data on a production page (R7-B1).
 */
export const fixtureFallbackOn = (env: Pick<Env, 'ALLOW_FIXTURES' | 'FIXTURE_FALLBACK'> | null | undefined) =>
  env?.ALLOW_FIXTURES === '1' && env?.FIXTURE_FALLBACK === '1'

export function isFixtureMode(request: Request, env: Env | null): boolean {
  if (!env) return false
  if (env.FIXTURES === '1') return true
  if (env.ALLOW_FIXTURES !== '1') return false
  const q = new URL(request.url).searchParams.get('fixtures')
  if (q === '1') return true
  if (q === '0') return false
  return getCookie(request.headers.get('cookie'), FIXTURE_COOKIE) === '1'
}

export function loaderEnv(request: Request, context: Readonly<RouterContextProvider>): LoaderEnv {
  const env = getEnv(context)
  const fixtures = isFixtureMode(request, env)
  const rt = fixtures ? new URL(request.url).searchParams.get('rt') : null
  // Fixture mode only: ?fixtureNow= pins the fixtures' clock (deterministic budget tests).
  const now = () => (fixtures ? fixtureNow(new URL(request.url)) : Date.now())
  const fixtureFetcher: ApiFetcher = (path) => {
    const url = new URL(`http://fixtures/__fixtures${path}`)
    if (rt) url.searchParams.set('rt', rt)
    return handleFixtureApi(url, now())
  }
  const fallback = { used: false }
  let fetcher: ApiFetcher
  if (fixtures) {
    fetcher = fixtureFetcher
  } else {
    const api = env?.API
    const base = env?.API_BASE ?? 'https://bft-api.brisbanetransit.workers.dev'
    const live: ApiFetcher = (path, init) =>
      api
        ? api.fetch(new Request(`https://bft-api${path}`, { signal: init?.signal }))
        : fetch(`${base}${path}`, { signal: init?.signal })
    // Development only (fixtureFallbackOn), and never for a call cut off by its time budget (settle, R7-B1).
    fetcher = fixtureFallbackOn(env)
      ? async (path, init) => {
          const res = await live(path, init).catch((error: unknown) => {
            if (init?.signal?.aborted) throw error
            return null
          })
          if (res && res.status < 500) return res
          fallback.used = true
          return fixtureFetcher(path, init)
        }
      : live
  }
  return { env, fixtures, rt, fetcher, fallback }
}

/** Settle a fetch with a 2.5 s budget so a slow API never blocks the HTML (the client polls anyway). */
export async function settle<T>(p: (signal: AbortSignal) => Promise<T>, ms = 2500): Promise<T | null> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), ms)
  try {
    return await p(ctl.signal)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
