/** The Worker's proxy, contract checks and fixture dispatch (no network: the API is a stub Fetcher). */
import { AlertsResponse, GeoTileFile } from '@bft/core/contract'
import { describe, expect, it, vi } from 'vitest'
import { schemaForPath, validateProxied } from '../app/lib/contract.server.ts'
import { fixtureAsk, fixtureData, handleFixtureApi } from '../app/lib/fixtures.server.ts'
import { proxyApi, proxyAsk, readLimited } from '../workers/app.ts'

vi.mock('virtual:react-router/server-build', () => ({}))

const NOW = Date.UTC(2026, 9, 19, 22, 30)

function envWith(api: (req: Request) => Response | Promise<Response>): Env {
  return { API: { fetch: vi.fn(api) } as unknown as Fetcher, API_BASE: 'http://x' } as unknown as Env
}

describe('contract at the proxy', () => {
  it('has a schema for every path transit reads', () => {
    for (const p of [
      '/v1/bus/stops/1832/departures',
      '/v1/train/trips/x@20261020',
      '/v1/ferry/vehicles',
      '/v1/alerts',
      '/v1/ask',
      '/data/train/stops.json',
      '/data/ferry/geo/r7hgd.json',
      '/data/bus/lines.json',
    ])
      expect(schemaForPath(p), p).not.toBeNull()
  })

  it('a drifted /v1 body becomes 502 contract_mismatch', async () => {
    const r = await validateProxied('/v1/alerts', Response.json({ alerts: 'nope' }))
    expect(r.status).toBe(502)
    expect(await r.json()).toMatchObject({ error: 'contract_mismatch' })
  })

  it('a missing geo tile stays a plain 404 (an empty cell)', async () => {
    const r = await validateProxied(
      '/data/bus/geo/r7hgd.json',
      Response.json({ error: 'not found' }, { status: 404 }),
    )
    expect(r.status).toBe(404)
  })
})

describe('POST /v1/ask proxy', () => {
  it('passes the body and the visitor IP to bft-api and never caches', async () => {
    let seen: Request | null = null
    const env = envWith(async (req) => {
      seen = req
      return fixtureAsk('next ferry from Bulimba')
    })
    const req = new Request('https://t/v1/ask', {
      method: 'POST',
      headers: { 'cf-connecting-ip': '203.0.113.9', 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'next ferry from Bulimba', turnstileToken: 't' }),
    })
    const res = await proxyAsk(req, env)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect((seen as unknown as Request).headers.get('cf-connecting-ip')).toBe('203.0.113.9')
    expect(await (seen as unknown as Request).json()).toEqual({
      question: 'next ferry from Bulimba',
      turnstileToken: 't',
    })
  })

  it('keeps the 403 turnstile_failed hint and the 429 body for the box to explain', async () => {
    const r403 = await proxyAsk(
      new Request('https://t/v1/ask', { method: 'POST', body: '{"question":"q"}' }),
      envWith(() => fixtureAsk('q #reason:turnstile_failed')),
    )
    expect(r403.status).toBe(403)
    expect(await r403.json()).toMatchObject({ ai: { reason: 'turnstile_failed' } })
    const r429 = await proxyAsk(
      new Request('https://t/v1/ask', { method: 'POST', body: '{"question":"q"}' }),
      envWith(() => fixtureAsk('#429')),
    )
    expect(r429.status).toBe(429)
  })

  it('rejects an oversized body without calling the API', async () => {
    const env = envWith(() => new Response('x'))
    const res = await proxyAsk(
      new Request('https://t/v1/ask', { method: 'POST', body: 'x'.repeat(3000) }),
      env,
    )
    expect(res.status).toBe(413)
    expect(env.API?.fetch).not.toHaveBeenCalled()
  })

  it('stops reading a streamed body at the limit, without a content-length', async () => {
    let pulls = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        pulls++
        c.enqueue(new Uint8Array(1024))
        if (pulls > 1000) c.close()
      },
    })
    const req = new Request('https://t/v1/ask', {
      method: 'POST',
      body: stream,
      duplex: 'half',
    } as RequestInit)
    expect(await readLimited(req, 2048)).toBeNull()
    expect(pulls).toBeLessThan(10)
    expect(await readLimited(new Request('https://t', { method: 'POST', body: '{"q":1}' }), 2048)).toBe(
      '{"q":1}',
    )
    const declared = new Request('https://t', {
      method: 'POST',
      body: 'x',
      headers: { 'content-length': '99999' },
    })
    expect(await readLimited(declared, 2048)).toBeNull()
  })

  it('GET proxy answers 502 when the API is down', async () => {
    const res = await proxyApi(
      new Request('https://t/v1/alerts'),
      envWith(() => Promise.reject(new Error('down'))),
    )
    expect(res.status).toBe(502)
  })
})

describe('fixtures', () => {
  it('merged alerts carry every app’s alerts, each tagged with its mode', async () => {
    const res = await handleFixtureApi(new URL('http://f/__fixtures/v1/alerts'), NOW)
    const body = AlertsResponse.parse(await res.json())
    const modes = new Set(body.alerts.flatMap((a) => a.modes))
    expect(modes.has('train')).toBe(true)
    expect(modes.has('bus')).toBe(true)
  })

  it('ferry and train geo tiles come from the apps’ stop lists; empty cells are 404', async () => {
    const ferry = fixtureData('/data/ferry/geo/r7hgd.json')
    expect(GeoTileFile.parse(await ferry?.json()).stops.length).toBeGreaterThan(0)
    const train = fixtureData('/data/train/geo/r7hgd.json')
    expect(GeoTileFile.parse(await train?.json()).stops.some((s) => s.key === 'central')).toBe(true)
    expect(fixtureData('/data/ferry/geo/zzzzz.json')?.status).toBe(404)
  })

  it('each mode is answered by its own app’s fixture API', async () => {
    for (const p of [
      '/v1/ferry/stops/317584/departures',
      '/v1/train/stops/central/departures',
      '/v1/bus/stops/10802/departures',
    ]) {
      const r = await handleFixtureApi(new URL(`http://f/__fixtures${p}`), NOW)
      expect(r.status, p).toBe(200)
      expect((await r.json()).mode).toBe(p.split('/')[2])
    }
  })
})
