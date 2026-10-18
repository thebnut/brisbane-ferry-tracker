/** Server-only helpers for the transit pages' loaders: bindings, fixture mode and the API fetcher. */
import type { RouterContextProvider } from 'react-router'
import type { ApiFetcher } from './api.ts'
import { cloudflareContext } from './context.ts'
import { handleFixtureApi } from './fixtures.server.ts'
import { FIXTURE_COOKIE, getCookie } from './storage.ts'

/** Bindings, or null when rendering outside the Worker. */
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

/** The upstream API: the service binding in staging, HTTP elsewhere. */
export function apiFetch(env: Env | null, path: string, init: RequestInit = {}): Promise<Response> {
  const binding = env?.API
  const base = env?.API_BASE ?? 'https://bft-api.brisbanetransit.workers.dev'
  return binding ? binding.fetch(new Request(`https://bft-api${path}`, init)) : fetch(`${base}${path}`, init)
}

export function loaderEnv(request: Request, context: Readonly<RouterContextProvider>) {
  const env = getEnv(context)
  const fixtures = isFixtureMode(request, env)
  const rt = fixtures ? new URL(request.url).searchParams.get('rt') : null
  const fetcher: ApiFetcher = fixtures
    ? (path) => {
        const url = new URL(`http://fixtures/__fixtures${path}`)
        if (rt && path.startsWith('/v1/')) url.searchParams.set('rt', rt)
        return handleFixtureApi(url, Date.now(), env)
      }
    : (path, init) => apiFetch(env, path, { signal: init?.signal, headers: { accept: 'application/json' } })
  return { env, fixtures, rt, fetcher }
}

/** Settle a fetch with a time budget so a slow API never blocks the HTML (the client polls anyway). */
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
