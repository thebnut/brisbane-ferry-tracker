/**
 * bft-transit Worker entry. Static files never reach this code: Workers static assets answer them first (their headers
 * come from public/_headers). Every response here gets the security headers, and HTML the nonce CSP.
 *  - GET /v1/*, /data/*   same-origin proxy to the API Worker (service binding in staging, HTTP in dev), contract-checked
 *  - POST /v1/ask         Ask box → bft-api /v1/ask with the visitor's IP (per-IP quota) and Turnstile token
 *  - /__fixtures/*        recorded responses for fixture mode (only when ALLOW_FIXTURES or FIXTURES is "1")
 *  - /robots.txt          disallow: the mode pages' canonical copies are the standalone apps
 *  - www.<SITE_URL host>  301 to SITE_URL (path and query kept); unless INDEXABLE is "1" every response is X-Robots-Tag: noindex
 *  - everything else      React Router SSR, with a per-request CSP nonce (workers/security.ts). The mounted mode pages are the standalone apps' route modules, so their
 *                         loaders read their own app's context: each gets this Env with its own canonical SITE_URL
 *                         (modeSiteUrl: the standalone app's, or this site's page under the mode prefix).
 */
import { cloudflareContext as busContext } from '@bft/bus/app/lib/context.ts'
import { withBuild } from '@bft/core/build'
import { cloudflareContext as ferryContext } from '@bft/ferry/app/lib/context.ts'
import { handleLegacy } from '@bft/ferry/workers/legacy.ts'
import { cloudflareContext as trainContext } from '@bft/train/app/lib/context.ts'
import { gaId } from '@bft/ui/analytics-config'
import { DEMO_HEADER } from '@bft/ui/connectivity'
import { createRequestHandler, RouterContextProvider } from 'react-router'
import { cloudflareContext } from '../app/lib/context.ts'
import { validateProxied } from '../app/lib/contract.server.ts'
import { fixtureAsk, handleFixtureApi } from '../app/lib/fixtures.server.ts'
import { MODE_BASES, type MountedMode } from '../app/lib/modes.ts'
import { apiFetch, isFixtureMode } from '../app/lib/server.server.ts'
import {
  canonicalRedirect,
  newNonce,
  withRobotsTag,
  withSecurityHeaders,
  wwwRedirectLocation,
} from './security.ts'
import { ASK_TIMEOUT_MS, proxied, withTimeout } from './timeouts.ts'

const requestHandler = createRequestHandler(
  () => import('virtual:react-router/server-build'),
  import.meta.env.MODE,
)

const noStore = { 'cache-control': 'no-store' }

export async function proxyApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  try {
    // The deadline covers the body read and validation too, not just the response headers (Codex review).
    // The visitor's abort and the deadline both reach the API (R8-F1).
    return await proxied(request, async (signal) =>
      validateProxied(
        url.pathname,
        await apiFetch(env, `${url.pathname}${url.search}`, {
          headers: { accept: 'application/json' },
          signal,
        }),
      ),
    )
  } catch (error) {
    return Response.json(
      { error: 'upstream_unavailable', detail: error instanceof Error ? error.message : String(error) },
      { status: 502, headers: noStore },
    )
  }
}

const ASK_MAX_BYTES = 2048

/**
 * The request body as text, or null when it is over `max` bytes or can't be read. Stops reading (and cancels the
 * stream) at the limit, so an oversized body never sits in Worker memory (Codex review of #50, finding 4).
 */
export async function readLimited(request: Request, max: number): Promise<string | null> {
  const declared = Number(request.headers.get('content-length'))
  if (declared > max) return null
  if (!request.body) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > max) {
        // Don't wait for the stream to acknowledge: answer 413 now.
        void reader.cancel().catch(() => {})
        return null
      }
      chunks.push(value)
    }
  } catch {
    return null
  }
  const all = new Uint8Array(size)
  let at = 0
  for (const c of chunks) {
    all.set(c, at)
    at += c.byteLength
  }
  try {
    // Strict: malformed UTF-8 is rejected rather than expanded with replacement characters.
    return new TextDecoder('utf-8', { fatal: true }).decode(all)
  } catch {
    return null
  }
}

/** POST /v1/ask: body passed through (≤ 2 KB); the API sees the visitor's IP for its per-IP quota and Turnstile. */
export async function proxyAsk(request: Request, env: Env): Promise<Response> {
  const body = await readLimited(request, ASK_MAX_BYTES)
  if (body == null) return Response.json({ error: 'bad_request' }, { status: 413, headers: noStore })
  const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json' }
  const ip = request.headers.get('cf-connecting-ip')
  if (ip) headers['cf-connecting-ip'] = ip
  try {
    const checked = await withTimeout(
      Promise.resolve(
        apiFetch(env, '/v1/ask', {
          method: 'POST',
          headers,
          body,
          signal: AbortSignal.timeout(ASK_TIMEOUT_MS),
        }),
      ).then((res) => validateProxied('/v1/ask', res)),
      ASK_TIMEOUT_MS,
    )
    checked.headers.set('cache-control', 'no-store')
    return checked
  } catch (error) {
    return Response.json(
      { error: 'upstream_unavailable', detail: error instanceof Error ? error.message : String(error) },
      { status: 502, headers: noStore },
    )
  }
}

const fixturesAllowed = (env: Env) => env.ALLOW_FIXTURES === '1' || env.FIXTURES === '1'

export default {
  async fetch(request, env, ctx) {
    // One nonce per request: the CSP header and every context (transit's root and the mounted apps) share it.
    const nonce = newNonce()
    const www = wwwRedirectLocation(request.url, env.SITE_URL)
    const res = www ? canonicalRedirect(www) : await guarded(() => route(request, env, ctx, nonce))
    return withBuild(
      withRobotsTag(
        withSecurityHeaders(res, nonce, gaId(env.GA_MEASUREMENT_ID) != null),
        env.INDEXABLE === '1',
      ),
      env.BUILD_SHA,
    )
  },
} satisfies ExportedHandler<Env>

async function guarded(handle: () => Promise<Response>): Promise<Response> {
  try {
    return await handle()
  } catch (error) {
    // A throw would become Cloudflare's own error page, without the security headers or the build marker.
    console.error('worker error', error instanceof Error ? error.message : String(error))
    return new Response('Internal error', {
      status: 500,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    })
  }
}

const MODE_SITE_URL = { ferry: 'FERRY_SITE_URL', train: 'TRAIN_SITE_URL', bus: 'BUS_SITE_URL' } as const

/**
 * The canonical site of a mounted mode page: the standalone app's own (<MODE>_SITE_URL) while it is the indexable
 * copy, else this site's page under the mode prefix (P6: the mode hosts redirect here, so links stay internal).
 */
export function modeSiteUrl(env: Env, mode: MountedMode): string {
  return env[MODE_SITE_URL[mode]] ?? `${env.SITE_URL}${MODE_BASES[mode]}`
}

async function route(request: Request, env: Env, ctx: ExecutionContext, nonce: string): Promise<Response> {
  const url = new URL(request.url)
  // The mounted Ferry screens include the feedback sheet, which posts to /api/feedback on this origin.
  const legacy = await handleLegacy(request, env, { app: 'transit' })
  if (legacy) return legacy
  if (url.pathname === '/v1/ask' && request.method === 'POST') return proxyAsk(request, env)
  if (request.method === 'GET' && (url.pathname.startsWith('/v1/') || url.pathname.startsWith('/data/')))
    return proxyApi(request, env)
  if (url.pathname.startsWith('/__fixtures/')) {
    if (!fixturesAllowed(env)) return new Response('Not found', { status: 404 })
    if (url.pathname === '/__fixtures/v1/ask' && request.method === 'POST') {
      const b = (await request.json().catch(() => null)) as { question?: unknown } | null
      return fixtureAsk(typeof b?.question === 'string' ? b.question : '')
    }
    return handleFixtureApi(url, Date.now(), env)
  }
  if (url.pathname === '/robots.txt')
    return new Response('User-agent: *\nDisallow: /\n', {
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' },
    })
  const context = new RouterContextProvider()
  context.set(cloudflareContext, { env, ctx, nonce })
  context.set(ferryContext, { env: { ...env, SITE_URL: modeSiteUrl(env, 'ferry') }, ctx, nonce })
  context.set(trainContext, { env: { ...env, SITE_URL: modeSiteUrl(env, 'train') }, ctx, nonce })
  context.set(busContext, { env: { ...env, SITE_URL: modeSiteUrl(env, 'bus') }, ctx, nonce })
  const res = await requestHandler(request, context)
  // A visitor's demo session (not FIXTURES=1 for everyone): marked so no cache keeps it (R7-B1).
  if (env.FIXTURES === '1' || !isFixtureMode(request, env)) return res
  const marked = new Response(res.body, res)
  marked.headers.set(DEMO_HEADER, '1')
  marked.headers.set('cache-control', 'private, no-store')
  return marked
}
