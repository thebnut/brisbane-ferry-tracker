// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
// @ts-expect-error The legacy Vercel helper is plain JS without types; imported to prove allowlist parity.
import { isAllowedOrigin as legacyAllowed } from '../../../api/_cors.js'
import { handleLegacy, isAllowedOrigin } from '../workers/legacy.ts'

const env = (over: Partial<Env> = {}): Env =>
  ({
    ASSETS: {} as Fetcher,
    API_BASE: 'https://api.example',
    SITE_URL: 'https://www.brisbaneferry.com',
    ...over,
  }) as Env

afterEach(() => vi.restoreAllMocks())

describe('legacy endpoints on the ferry origin (cutover blocker)', () => {
  it('CORS allowlist is identical to api/_cors.js', () => {
    for (const o of [
      'https://www.brisbaneferry.com',
      'https://brisbaneferry.com',
      'capacitor://localhost',
      'https://brisbane-ferry-tracker-git-x-starblaze.vercel.app',
      'https://evil.example',
      null,
    ]) {
      expect(isAllowedOrigin(o), String(o)).toBe(legacyAllowed(o))
    }
  })

  it('/api/gtfs-proxy forwards to the API binding with the query and adds CORS', async () => {
    const calls: string[] = []
    const api = {
      fetch: async (r: Request) => {
        calls.push(r.url)
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { 'content-type': 'application/octet-stream' },
        })
      },
    } as unknown as Fetcher
    const res = (await handleLegacy(
      new Request('https://www.brisbaneferry.com/api/gtfs-proxy?endpoint=TripUpdates', {
        headers: { origin: 'capacitor://localhost' },
      }),
      env({ API: api }),
    )) as Response
    expect(calls).toEqual(['https://bft-api/api/gtfs-proxy?endpoint=TripUpdates'])
    expect(res.status).toBe(200)
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
    expect(res.headers.get('access-control-allow-origin')).toBe('capacitor://localhost')
  })

  it('/api/feedback validates and relays to n8n with the auth header', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'))
    const e = env({ N8N_WEBHOOK_URL: 'https://n8n.example/hook', N8N_AUTH_TOKEN: 'tok' })
    const post = (body: unknown) =>
      handleLegacy(
        new Request('https://www.brisbaneferry.com/api/feedback', {
          method: 'POST',
          body: JSON.stringify(body),
          headers: { 'content-type': 'application/json', origin: 'https://www.brisbaneferry.com' },
        }),
        e,
      ) as Promise<Response>
    expect((await post({ feedback: 'short' })).status).toBe(400)
    expect((await post({ feedback: 'This is long enough feedback', email: 'bad' })).status).toBe(400)
    const ok = await post({ feedback: 'This is long enough feedback', email: 'a@b.co', name: 'N' })
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ success: true, message: 'Thank you for your feedback!' })
    const [url, init] = spy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://n8n.example/hook')
    expect((init.headers as Record<string, string>)['bris-ferry-prod']).toBe('tok')
    expect(JSON.parse(String(init.body))).toMatchObject({
      feedback: 'This is long enough feedback',
      source: 'brisbane-ferry-tracker',
    })
  })

  it('/api/feedback without secrets is a 500, preflight is a 200, other paths are not handled', async () => {
    const r = (await handleLegacy(
      new Request('https://x/api/feedback', { method: 'POST', body: '{}' }),
      env(),
    )) as Response
    expect(r.status).toBe(500)
    const pre = (await handleLegacy(
      new Request('https://x/api/feedback', { method: 'OPTIONS' }),
      env(),
    )) as Response
    expect(pre.status).toBe(200)
    expect(await handleLegacy(new Request('https://x/terminal/bulimba'), env())).toBeNull()
  })
})
