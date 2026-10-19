/** Server-only helpers for loaders: bindings, fixture mode and the API fetcher. */
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
  let api: ApiFetcher
  if (fixtures) {
    api = (path) => {
      const url = new URL(`http://fixtures/__fixtures${path}`)
      if (rt && path.startsWith('/v1/')) url.searchParams.set('rt', rt)
      return handleFixtureApi(url, Date.now(), env)
    }
  } else {
    const binding = env?.API
    const base = env?.API_BASE ?? 'https://bft-api.brisbanetransit.workers.dev'
    const live: ApiFetcher = (path, init) =>
      binding
        ? binding.fetch(new Request(`https://bft-api${path}`, { signal: init?.signal }))
        : fetch(`${base}${path}`, { signal: init?.signal })
    // Development only (fixtureFallbackOn): an API error is answered from fixtures (responses then carry a fixture-*
    // generation, and DataBanner says "Demo data"). Never for a call cut off by its time budget (settle): a slow
    // API is not a failed one, and staging showed "Demo data" that way (R7-B1).
    api = fixtureFallbackOn(env)
      ? async (path, init) => {
          const res = await live(path, init).catch((error: unknown) => {
            if (init?.signal?.aborted) throw error
            return null
          })
          if (res && res.status < 500) return res
          return handleFixtureApi(new URL(`http://fixtures/__fixtures${path}`), Date.now(), env)
        }
      : live
  }
  // Client data (/data/bus/*): the build's static copy first (free, no API hop), then the API or fixtures.
  const fetcher: ApiFetcher = async (path, init) => {
    if (path.startsWith('/data/') && env?.ASSETS) {
      const local = await env.ASSETS.fetch(new Request(`https://assets${path}`, { signal: init?.signal }))
      if (local.ok) return local
    }
    return api(path, init)
  }
  return { env, fixtures, rt, fetcher }
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
