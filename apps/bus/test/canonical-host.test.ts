/** www → apex 301 and the INDEXABLE soft-launch flag, through the Worker's fetch handler. */
import { describe, expect, it, vi } from 'vitest'
import worker from '../workers/app.ts'
import { wwwRedirectLocation } from '../workers/security.ts'

vi.mock('virtual:react-router/server-build', () => ({}))

const SITE = 'https://brisbanebus.com'
const envWith = (vars: Record<string, string> = {}) =>
  ({ SITE_URL: SITE, API_BASE: 'http://x', ...vars }) as unknown as Env
const get = (url: string, env: Env) =>
  worker.fetch(new Request(url), env, {} as ExecutionContext) as Promise<Response>

describe('wwwRedirectLocation', () => {
  it('sends www to the apex with the path and query kept (hosts are case-insensitive)', () => {
    expect(wwwRedirectLocation('https://www.brisbanebus.com/a?x=1&y=2', SITE)).toBe(`${SITE}/a?x=1&y=2`)
    expect(wwwRedirectLocation('http://WWW.BRISBANEBUS.COM/', SITE)).toBe(`${SITE}/`)
  })

  it('leaves the apex and every other host alone', () => {
    for (const u of [
      'https://brisbanebus.com/a',
      'https://bft-bus-prod.brisbanetransit.workers.dev/a',
      'https://www.brisbanetrain.com/a',
      'https://www.brisbanebus.com.evil.example/a',
      'https://evil.example/www.brisbanebus.com',
    ])
      expect(wwwRedirectLocation(u, SITE), u).toBeNull()
  })

  it('does nothing for a www canonical or a bad SITE_URL', () => {
    expect(wwwRedirectLocation('https://www.www.brisbanebus.com/', 'https://www.brisbanebus.com')).toBeNull()
    expect(wwwRedirectLocation('https://www.brisbanebus.com/', 'not a url')).toBeNull()
  })
})

describe('canonical host', () => {
  it('301s www to the fixed apex, keeping path and query, with the security headers', async () => {
    const res = await get('https://www.brisbanebus.com/a/b?x=1', envWith())
    expect(res.status).toBe(301)
    expect(res.headers.get('location')).toBe(`${SITE}/a/b?x=1`)
    expect(res.headers.get('strict-transport-security')).toContain('max-age=')
  })

  it('never redirects to a host taken from the request', async () => {
    const res = await get('https://www.brisbanebus.com//evil.example/x', envWith())
    expect(new URL(res.headers.get('location') ?? '').host).toBe('brisbanebus.com')
    const other = await get('https://www.brisbanebus.com.evil.example/robots.txt', envWith())
    expect(other.status).toBe(200)
  })
})

describe('INDEXABLE soft launch', () => {
  it('unset or "0": X-Robots-Tag noindex and robots.txt disallows all', async () => {
    for (const env of [envWith(), envWith({ INDEXABLE: '0' })]) {
      const res = await get(`${SITE}/robots.txt`, env)
      expect(res.headers.get('x-robots-tag')).toBe('noindex')
      expect(await res.text()).toBe('User-agent: *\nDisallow: /\n')
    }
  })

  it('"1": no noindex header and robots.txt allows crawling with the sitemap', async () => {
    const res = await get(`${SITE}/robots.txt`, envWith({ INDEXABLE: '1' }))
    expect(res.headers.get('x-robots-tag')).toBeNull()
    const body = await res.text()
    expect(body).toContain('Allow: /')
    expect(body).toContain(`Sitemap: ${SITE}/sitemap.xml`)
  })
})
