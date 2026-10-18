import { describe, expect, it } from 'vitest'
import {
  BASE_SECURITY_HEADERS,
  contentSecurityPolicy,
  newNonce,
  withSecurityHeaders,
} from '../workers/security.ts'

describe('security headers (cutover gate: at least as strict as vercel.json)', () => {
  it('HTML gets the nonce CSP and the base headers; script-src has no unsafe-inline', () => {
    const nonce = newNonce()
    const res = withSecurityHeaders(
      new Response('<html></html>', { headers: { 'content-type': 'text/html' } }),
      nonce,
    )
    const csp = res.headers.get('content-security-policy') ?? ''
    expect(csp).toContain(`script-src 'self' 'nonce-${nonce}'`)
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/)
    for (const d of ["frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'"])
      expect(csp).toContain(d)
    for (const [k, v] of Object.entries(BASE_SECURITY_HEADERS)) expect(res.headers.get(k)).toBe(v)
  })
  it("the only external origin added for scripts and frames is Turnstile, exactly per Cloudflare's CSP reference", () => {
    const d = contentSecurityPolicy('n').split('; ')
    expect(d).toContain("script-src 'self' 'nonce-n' https://challenges.cloudflare.com")
    expect(d).toContain('frame-src https://challenges.cloudflare.com')
    expect(d).toContain("connect-src 'self' https://tiles.openfreemap.org")
    expect(d.filter((x) => x.includes('challenges.cloudflare.com'))).toHaveLength(2)
  })
  it('non-HTML responses get the base headers without a CSP', () => {
    const res = withSecurityHeaders(Response.json({}), 'n')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('content-security-policy')).toBeNull()
  })
  it('nonces are unique and base64', () => {
    const a = newNonce()
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/)
    expect(newNonce()).not.toBe(a)
    expect(contentSecurityPolicy(a)).toContain(a)
  })
})
