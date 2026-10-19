import { describe, expect, it } from 'vitest'
import {
  BASE_SECURITY_HEADERS,
  contentSecurityPolicy,
  newNonce,
  withSecurityHeaders,
} from '../workers/security.ts'

describe('security headers (same pattern and strictness as the ferry Worker)', () => {
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

describe('HTML caching', () => {
  it('HTML without its own Cache-Control becomes private, no-store; an explicit one is kept', () => {
    const html = (h: Record<string, string> = {}) =>
      new Response('<html></html>', { headers: { 'content-type': 'text/html', ...h } })
    expect(withSecurityHeaders(html(), 'n').headers.get('cache-control')).toBe('private, no-store')
    expect(withSecurityHeaders(html({ 'cache-control': 'no-cache' }), 'n').headers.get('cache-control')).toBe(
      'no-cache',
    )
    expect(withSecurityHeaders(Response.json({}), 'n').headers.get('cache-control')).toBeNull()
  })
})
