import { describe, expect, it } from 'vitest'
import {
  BASE_SECURITY_HEADERS,
  contentSecurityPolicy,
  newNonce,
  withSecurityHeaders,
  wsOriginOf,
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

describe('trip WebSocket origin', () => {
  it('same-origin sockets add nothing to connect-src; a wss:// API_WS_BASE adds exactly its origin', () => {
    expect(wsOriginOf('')).toBeNull()
    expect(wsOriginOf(undefined)).toBeNull()
    expect(wsOriginOf('https://bft-api.example')).toBeNull()
    expect(wsOriginOf('not a url')).toBeNull()
    expect(wsOriginOf('wss://bft-api.brisbanetransit.workers.dev/v1')).toBe(
      'wss://bft-api.brisbanetransit.workers.dev',
    )
    expect(contentSecurityPolicy('n')).toContain("connect-src 'self' https://tiles.openfreemap.org;")
    expect(contentSecurityPolicy('n', 'wss://a.example')).toContain(
      "connect-src 'self' https://tiles.openfreemap.org wss://a.example;",
    )
  })
})
