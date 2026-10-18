/**
 * Legacy endpoints that www.brisbaneferry.com must keep serving after the hosting move (cutover runbook): old iOS
 * builds and the legacy web app call them on this origin.
 *  - /api/gtfs-proxy?endpoint=…  raw GTFS-RT from the API Worker's hub (never its own upstream fetch)
 *  - /api/feedback (POST)        relays feedback to the Discord webhook (FEEDBACK_DISCORD_WEBHOOK_URL), per-IP rate
 *                                limited by the FEEDBACK_LIMITER binding; shares api/_feedback-discord.js with the
 *                                legacy Vercel route (api/feedback.js). Web posts need a Turnstile token, verified
 *                                by bft-api's /v1/turnstile/verify over the API binding (this Worker holds no
 *                                Turnstile secret); the iOS app posts token-less (trade-off in api/_turnstile.js)
 * CORS matches api/_cors.js byte for byte (same allowlist, headers and preflight).
 */
import {
  feedbackApp,
  RATE_LIMITED_BODY,
  relayFeedback,
  UNAVAILABLE_BODY,
} from '../../../api/_feedback-discord.js'
import { checkTurnstile, IOS_CLIENT_HEADER, verifyWithApi } from '../../../api/_turnstile.js'

const STATIC_ALLOWED = new Set([
  'https://brisbaneferry.com',
  'https://www.brisbaneferry.com',
  'https://ferry.lifemap.au',
  'https://www.ferry.lifemap.au',
  'http://localhost:5173',
  'http://localhost:4173',
  'capacitor://localhost',
  'ionic://localhost',
  'http://localhost',
])
const VERCEL_PREVIEW_RE = /^https:\/\/brisbane-ferry-tracker(-[a-z0-9-]+)?-starblaze\.vercel\.app$/

export function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false
  return STATIC_ALLOWED.has(origin) || VERCEL_PREVIEW_RE.test(origin)
}

export function legacyCorsHeaders(origin: string | null, allowAll = false): Headers {
  const h = new Headers()
  if (allowAll) h.set('Access-Control-Allow-Origin', '*')
  else if (isAllowedOrigin(origin)) {
    h.set('Access-Control-Allow-Origin', origin as string)
    h.set('Vary', 'Origin')
  }
  h.set('Access-Control-Allow-Credentials', 'true')
  h.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  h.set(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, X-BFT-Client',
  )
  return h
}

const withCors = (res: Response, origin: string | null, allowAll: boolean): Response => {
  const out = new Response(res.body, res)
  for (const [k, v] of legacyCorsHeaders(origin, allowAll)) out.headers.set(k, v)
  return out
}

/** bft-api's POST /v1/turnstile/verify: in-process through the API binding, or over HTTPS when it's absent. */
function postVerify(env: Env, body: string, signal: AbortSignal): Promise<Response> {
  const init: RequestInit = { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal }
  return env.API
    ? env.API.fetch(new Request('https://bft-api/v1/turnstile/verify', init))
    : fetch(`${env.API_BASE}/v1/turnstile/verify`, init)
}

export interface LegacyOptions {
  /** Which app's Worker serves the request, for the feedback title (the iOS app is detected from its Origin). */
  app?: 'ferry' | 'transit'
}

export async function handleLegacy(
  request: Request,
  env: Env,
  opts: LegacyOptions = {},
): Promise<Response | null> {
  const url = new URL(request.url)
  if (url.pathname !== '/api/gtfs-proxy' && url.pathname !== '/api/feedback') return null
  const origin = request.headers.get('origin')
  const allowAll = env.CORS_ALLOW_ALL === 'true'
  if (request.method === 'OPTIONS') return withCors(new Response(null, { status: 200 }), origin, allowAll)

  if (url.pathname === '/api/gtfs-proxy') {
    if (request.method !== 'GET')
      return withCors(Response.json({ error: 'Method not allowed' }, { status: 405 }), origin, allowAll)
    const target = `/api/gtfs-proxy${url.search}`
    const init: RequestInit = { method: 'GET' }
    try {
      const res = env.API
        ? await env.API.fetch(new Request(`https://bft-api${target}`, init))
        : await fetch(`${env.API_BASE}${target}`, init)
      return withCors(res, origin, allowAll)
    } catch (error) {
      // Same body and status as api/gtfs-proxy.js on failure (Codex review).
      console.error('Proxy error:', error instanceof Error ? error.message : String(error))
      return withCors(
        Response.json({ error: 'Failed to fetch data from TransLink API' }, { status: 500 }),
        origin,
        allowAll,
      )
    }
  }

  // /api/feedback: CORS, POST only, rate limit, then the shared validation and Discord relay.
  const json = (body: unknown, status: number, extra?: HeadersInit) =>
    withCors(Response.json(body, { status, headers: extra }), origin, allowAll)
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  if (env.FEEDBACK_LIMITER) {
    const ip = request.headers.get('cf-connecting-ip') ?? 'unknown'
    let success: boolean
    try {
      ;({ success } = await env.FEEDBACK_LIMITER.limit({ key: ip }))
    } catch (error) {
      // A bound limiter that errors fails closed: no unthrottled path to the webhook.
      console.error(`[feedback] FEEDBACK_LIMITER failed (${error instanceof Error ? error.name : 'error'})`)
      return json(UNAVAILABLE_BODY, 503)
    }
    if (!success) {
      console.warn('[feedback] rate limited')
      return json(RATE_LIMITED_BODY, 429, { 'retry-after': '60' })
    }
  } else {
    // Bound in every deployed env (wrangler.jsonc); only local dev and tests may lack it.
    console.warn('[feedback] FEEDBACK_LIMITER binding missing; not rate limiting')
  }
  let parsed: unknown = null
  try {
    parsed = await request.json()
  } catch {
    // A missing or malformed body fails validation like an empty feedback (Codex review: it used to throw).
  }
  const denied = await checkTurnstile({
    origin,
    clientHeader: request.headers.get(IOS_CLIENT_HEADER),
    body: parsed,
    host: url.host,
    remoteip: request.headers.get('cf-connecting-ip'),
    verify: (token, remoteip) =>
      verifyWithApi((body, signal) => postVerify(env, body, signal), token, remoteip),
  })
  if (denied) return json(denied.body, denied.status)
  const { status, body } = await relayFeedback({
    webhookUrl: env.FEEDBACK_DISCORD_WEBHOOK_URL,
    body: parsed,
    app: feedbackApp(origin, opts.app ?? 'ferry'),
    referer: request.headers.get('referer'),
    userAgent: request.headers.get('user-agent'),
  })
  return json(body, status)
}
