import { describe, expect, it, vi } from 'vitest'
import worker from '../workers/app.ts'
import {
  BASE_SECURITY_HEADERS,
  contentSecurityPolicy,
  newNonce,
  TURNSTILE_ORIGIN,
  withSecurityHeaders,
} from '../workers/security.ts'

vi.mock('virtual:react-router/server-build', () => ({}))

// The ferry Worker's CSP (apps/ferry/workers/security.ts, #52/#53): transit's must equal it plus only Turnstile.
const FERRY_CSP = (nonce: string) => [
  "default-src 'self'",
  `script-src 'self' 'nonce-${nonce}'`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://tiles.openfreemap.org",
  "font-src 'self' data:",
  "connect-src 'self' https://tiles.openfreemap.org",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  'upgrade-insecure-requests',
]

describe('security headers (same pattern and strictness as the ferry Worker)', () => {
  it('HTML gets the nonce CSP and the base headers; script-src has no unsafe-inline', () => {
    const nonce = newNonce()
    const res = withSecurityHeaders(
      new Response('<html></html>', { headers: { 'content-type': 'text/html' } }),
      nonce,
    )
    const csp = res.headers.get('content-security-policy') ?? ''
    expect(csp).toContain(`script-src 'self' 'nonce-${nonce}' ${TURNSTILE_ORIGIN};`)
    expect(csp).not.toMatch(/script-src[^;]*unsafe-(inline|eval)/)
    for (const d of ["frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'"])
      expect(csp).toContain(d)
    for (const [k, v] of Object.entries(BASE_SECURITY_HEADERS)) expect(res.headers.get(k)).toBe(v)
  })

  it("is ferry's CSP plus only the Turnstile origin, in script-src and frame-src", () => {
    const ours = contentSecurityPolicy('n').split('; ')
    const ferry = FERRY_CSP('n')
    const extra = ours.filter((d) => !ferry.includes(d))
    expect(extra).toEqual([
      `script-src 'self' 'nonce-n' ${TURNSTILE_ORIGIN}`,
      `frame-src ${TURNSTILE_ORIGIN}`,
    ])
    expect(ferry.filter((d) => !ours.includes(d))).toEqual(["script-src 'self' 'nonce-n'"])
    expect(TURNSTILE_ORIGIN).toBe('https://challenges.cloudflare.com')
  })

  it('non-HTML responses get the base headers without a CSP', () => {
    const res = withSecurityHeaders(Response.json({}), 'n')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('content-security-policy')).toBeNull()
  })

  it('keeps status, body and other headers', async () => {
    const res = withSecurityHeaders(
      new Response('nope', { status: 413, headers: { 'cache-control': 'no-store' } }),
      'n',
    )
    expect(res.status).toBe(413)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.text()).toBe('nope')
  })

  it('nonces are unique and base64', () => {
    const a = newNonce()
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/)
    expect(newNonce()).not.toBe(a)
    expect(contentSecurityPolicy(a)).toContain(a)
  })
})

describe('the Worker wraps every response', () => {
  const env = { API_BASE: 'http://x', ALLOW_FIXTURES: '0', FIXTURES: '0' } as unknown as Env
  const ctx = {} as ExecutionContext
  it('robots.txt, a disabled fixture path and an oversized Ask all carry the base headers', async () => {
    for (const req of [
      new Request('http://t/robots.txt'),
      new Request('http://t/__fixtures/v1/ferry'),
      new Request('http://t/v1/ask', { method: 'POST', body: 'x'.repeat(3000) }),
    ]) {
      const res = await worker.fetch(req as Request<unknown, IncomingRequestCfProperties>, env, ctx)
      expect(res.headers.get('strict-transport-security'), req.url).toBe(
        BASE_SECURITY_HEADERS['Strict-Transport-Security'],
      )
      expect(res.headers.get('x-content-type-options'), req.url).toBe('nosniff')
      expect(res.headers.get('content-security-policy'), req.url).toBeNull()
    }
  })
})
