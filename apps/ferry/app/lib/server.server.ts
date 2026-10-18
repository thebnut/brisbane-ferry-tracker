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
  let fetcher: ApiFetcher
  if (fixtures) {
    fetcher = (path) => {
      const url = new URL(`http://fixtures/__fixtures${path}`)
      if (rt) url.searchParams.set('rt', rt)
      return handleFixtureApi(url, Date.now())
    }
  } else if (env?.API) {
    const api = env.API
    fetcher = (path, init) => api.fetch(new Request(`https://bft-api${path}`, { signal: init?.signal }))
  } else {
    const base = env?.API_BASE ?? 'https://bft-api.brisbanetransit.workers.dev'
    fetcher = (path, init) => fetch(`${base}${path}`, { signal: init?.signal })
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
