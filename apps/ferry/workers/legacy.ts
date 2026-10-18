/**
 * Legacy endpoints that www.brisbaneferry.com must keep serving after the hosting move (cutover runbook): old iOS
 * builds and the legacy web app call them on this origin.
 *  - /api/gtfs-proxy?endpoint=…  raw GTFS-RT from the API Worker's hub (never its own upstream fetch)
 *  - /api/feedback (POST)        relays feedback to the n8n webhook, exactly like api/feedback.js
 * CORS matches api/_cors.js byte for byte (same allowlist, headers and preflight).
 */
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
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version',
  )
  return h
}

const withCors = (res: Response, origin: string | null, allowAll: boolean): Response => {
  const out = new Response(res.body, res)
  for (const [k, v] of legacyCorsHeaders(origin, allowAll)) out.headers.set(k, v)
  return out
}

export async function handleLegacy(request: Request, env: Env): Promise<Response | null> {
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

  // /api/feedback
  const json = (body: unknown, status: number) => withCors(Response.json(body, { status }), origin, allowAll)
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  if (!env.N8N_WEBHOOK_URL || !env.N8N_AUTH_TOKEN)
    return json({ error: 'Server configuration error. Please contact support.' }, 500)
  let parsed: unknown
  try {
    parsed = await request.json()
  } catch {
    parsed = null
  }
  // A missing, null or non-object body fails validation like an empty feedback (Codex review: it used to throw).
  const body = (parsed && typeof parsed === 'object' ? parsed : {}) as {
    feedback?: unknown
    email?: unknown
    name?: unknown
  }
  const { feedback, email, name } = body
  if (!feedback || typeof feedback !== 'string' || feedback.trim().length < 10)
    return json({ error: 'Feedback must be at least 10 characters long' }, 400)
  if (feedback.length > 1000) return json({ error: 'Feedback must be less than 1000 characters' }, 400)
  if (email && (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))
    return json({ error: 'Invalid email format' }, 400)
  try {
    const res = await fetch(env.N8N_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'bris-ferry-prod': env.N8N_AUTH_TOKEN },
      body: JSON.stringify({
        feedback: feedback.trim(),
        email: email || null,
        name: name || null,
        timestamp: new Date().toISOString(),
        source: 'brisbane-ferry-tracker',
        url: request.headers.get('referer') || 'unknown',
        userAgent: request.headers.get('user-agent') || 'unknown',
      }),
    })
    if (!res.ok) throw new Error(`Webhook responded with ${res.status}`)
    return json({ success: true, message: 'Thank you for your feedback!' }, 200)
  } catch (error) {
    console.error('Feedback submission error:', error instanceof Error ? error.message : String(error))
    return json({ error: 'Failed to submit feedback. Please try again later.' }, 500)
  }
}
