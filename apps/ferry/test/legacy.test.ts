// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'
// @ts-expect-error The legacy Vercel helper is plain JS without types; imported to prove allowlist parity.
import { isAllowedOrigin as legacyAllowed } from '../../../api/_cors.js'
import {
  buildDiscordPayload,
  DISCORD_LIMITS,
  type DiscordEmbed,
  sanitizeText,
  truncate,
} from '../../../api/_feedback-discord.js'
import { handleLegacy, isAllowedOrigin } from '../workers/legacy.ts'

const HOOK = 'https://discord.test/api/webhooks/0/test-token-secret'

const env = (over: Partial<Env> = {}): Env =>
  ({
    ASSETS: {} as Fetcher,
    API_BASE: 'https://api.example',
    SITE_URL: 'https://www.brisbaneferry.com',
    ...over,
  }) as Env

/** Every test starts with the network refused, so a regression can never reach a real host (Codex review). */
let fetchSpy: MockInstance<typeof fetch>
beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network disabled in tests'))
})
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

  it('error paths return the legacy JSON bodies with CORS instead of throwing (Codex review)', async () => {
    const api = {
      fetch: async () => {
        throw new Error('binding down')
      },
    } as unknown as Fetcher
    const r = (await handleLegacy(
      new Request('https://x/api/gtfs-proxy?endpoint=TripUpdates', {
        headers: { origin: 'capacitor://localhost' },
      }),
      env({ API: api }),
    )) as Response
    expect(r.status).toBe(500)
    expect(await r.json()).toEqual({ error: 'Failed to fetch data from TransLink API' })
    expect(r.headers.get('access-control-allow-origin')).toBe('capacitor://localhost')
    const spy = fetchSpy
    const e = env({ FEEDBACK_DISCORD_WEBHOOK_URL: HOOK })
    for (const body of ['null', '"text"', 'not json']) {
      const f = (await handleLegacy(
        new Request('https://x/api/feedback', {
          method: 'POST',
          body,
          headers: { origin: 'https://www.brisbaneferry.com' },
        }),
        e,
      )) as Response
      expect(f.status, body).toBe(400)
      expect(f.headers.get('access-control-allow-origin')).toBe('https://www.brisbaneferry.com')
    }
    expect(spy).not.toHaveBeenCalled()
  })

  it('/api/feedback preflight is a 200, GET is a 405, other paths are not handled', async () => {
    expect(((await handleLegacy(new Request('https://x/api/feedback'), env())) as Response).status).toBe(405)
    const pre = (await handleLegacy(
      new Request('https://x/api/feedback', { method: 'OPTIONS' }),
      env(),
    )) as Response
    expect(pre.status).toBe(200)
    expect(await handleLegacy(new Request('https://x/terminal/bulimba'), env())).toBeNull()
  })
})

describe('/api/feedback → Discord webhook', () => {
  const NOW = new Date('2026-10-19T01:02:03.000Z')
  const limiter = (success: boolean) => ({ limit: vi.fn(async () => ({ success })) })
  const post = (body: unknown, e: Env, headers: Record<string, string> = {}) =>
    handleLegacy(
      new Request('https://www.brisbaneferry.com/api/feedback', {
        method: 'POST',
        body: typeof body === 'string' ? body : JSON.stringify(body),
        headers: {
          'content-type': 'application/json',
          origin: 'https://www.brisbaneferry.com',
          referer: 'https://www.brisbaneferry.com/terminal/bulimba',
          'user-agent': 'TestUA/1.0',
          'cf-connecting-ip': '203.0.113.7',
          ...headers,
        },
      }),
      e,
    ) as Promise<Response>
  const good = { feedback: 'This is long enough feedback', email: 'rider@example.com', name: 'Rider' }
  /** Every console line written during a test, to prove the webhook URL never reaches the logs. */
  let logged: string[]
  beforeEach(() => {
    logged = []
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const)
      vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
        logged.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
      })
  })
  afterEach(() => {
    vi.useRealTimers()
    for (const line of logged) {
      expect(line).not.toContain('discord.test')
      expect(line).not.toContain('test-token-secret')
    }
  })

  it('happy path: posts the embed to the secret URL with ?wait=true and no mentions allowed', async () => {
    const spy = fetchSpy.mockResolvedValue(new Response('{}', { status: 200 }))
    const lim = limiter(true)
    const res = await post(good, env({ FEEDBACK_DISCORD_WEBHOOK_URL: HOOK, FEEDBACK_LIMITER: lim as never }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, message: 'Thank you for your feedback!' })
    expect(res.headers.get('access-control-allow-origin')).toBe('https://www.brisbaneferry.com')
    expect(lim.limit).toHaveBeenCalledWith({ key: '203.0.113.7' })
    expect(spy).toHaveBeenCalledTimes(1)
    const [url, init] = spy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${HOOK}?wait=true`)
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect(JSON.parse(String(init.body))).toEqual({
      content: '',
      username: 'Brisbane Ferry feedback',
      allowed_mentions: { parse: [] },
      embeds: [
        {
          title: 'Feedback: BrisbaneFerry (new ferry app)',
          description: 'This is long enough feedback',
          color: 0xf59e0b,
          fields: [
            { name: 'Page', value: '`https://www.brisbaneferry.com/terminal/bulimba`', inline: false },
            { name: 'Contact', value: '`rider@example.com` Rider', inline: false },
            { name: 'User agent', value: '`TestUA/1.0`', inline: false },
          ],
          footer: { text: 'brisbane-ferry-tracker' },
          timestamp: NOW.toISOString(),
        },
      ],
    })
  })

  it('titles: iOS from the Capacitor Origin, transit from the mounting Worker; body url when no Referer', async () => {
    const spy = fetchSpy.mockResolvedValue(new Response('{}'))
    const e = env({ FEEDBACK_DISCORD_WEBHOOK_URL: HOOK })
    await post({ ...good, url: 'https://app/page' }, e, { origin: 'capacitor://localhost', referer: '' })
    await handleLegacy(
      new Request('https://bft-transit.example/api/feedback', {
        method: 'POST',
        body: JSON.stringify({ feedback: 'Transit sheet feedback here' }),
      }),
      e,
      { app: 'transit' },
    )
    const sent = spy.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)).embeds[0])
    expect(sent[0].title).toBe('Feedback: BrisbaneFerry iOS app')
    expect(sent[0].fields[0].value).toBe('`https://app/page`')
    expect(sent[1].title).toBe('Feedback: BrisbaneTransit')
    expect(sent[1].fields.map((f: { name: string }) => f.name)).toEqual(['Page', 'User agent'])
    expect(sent[1].fields[0].value).toBe('`unknown`')
  })

  it('neutralises @everyone, @here, user/role/channel mentions and masked links', async () => {
    const spy = fetchSpy.mockResolvedValue(new Response('{}'))
    await post(
      {
        feedback: 'hey @everyone and @here <@123> <@&456> <#789> [click](https://evil.example)',
        name: '@here',
      },
      env({ FEEDBACK_DISCORD_WEBHOOK_URL: HOOK }),
    )
    const payload = JSON.parse(String((spy.mock.calls[0] as [string, RequestInit])[1].body))
    expect(payload.allowed_mentions).toEqual({ parse: [] })
    const text = `${payload.embeds[0].description} ${payload.embeds[0].fields[1].value}`
    for (const bad of ['@everyone', '@here', '<@123>', '<@&456>', '<#789>', '[click]('])
      expect(text).not.toContain(bad)
    expect(text).toContain('@\u200beveryone')
    expect(text).toContain('<\u200b@\u200b123>')
    expect(text).toContain('\\[click\\]\\(')
  })

  it('unset secret: 503 with a clear log line and no fetch', async () => {
    const spy = fetchSpy
    const res = await post(good, env())
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({
      error: 'Feedback is temporarily unavailable. Please try again later.',
    })
    expect(spy).not.toHaveBeenCalled()
    expect(logged.join('\n')).toContain('FEEDBACK_DISCORD_WEBHOOK_URL is not set')
  })

  it.each([
    [400, 502],
    [404, 502],
    [500, 502],
    [429, 503],
  ])('Discord %i → %i, logging the status only', async (discord, ours) => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ message: 'nope', retry_after: 1 }), { status: discord }),
    )
    const res = await post(good, env({ FEEDBACK_DISCORD_WEBHOOK_URL: HOOK }))
    expect(res.status).toBe(ours)
    expect((await res.json()).error).toMatch(/Please try again later/)
    expect(logged.join('\n')).toContain(String(discord))
    expect(logged.join('\n')).not.toContain('nope')
  })

  it('network error → 502 with the error name only in the log', async () => {
    fetchSpy.mockRejectedValue(new TypeError(`fetch failed for ${HOOK}?wait=true`))
    const res = await post(good, env({ FEEDBACK_DISCORD_WEBHOOK_URL: HOOK }))
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'Failed to submit feedback. Please try again later.' })
    expect(logged.join('\n')).toContain('TypeError')
  })

  it('a malformed secret is a 503, not a throw, and is not logged', async () => {
    const spy = fetchSpy
    const res = await post(good, env({ FEEDBACK_DISCORD_WEBHOOK_URL: 'discord.test test-token-secret' }))
    expect(res.status).toBe(503)
    expect(spy).not.toHaveBeenCalled()
  })

  it('validation errors (unchanged messages) make no fetch', async () => {
    const spy = fetchSpy
    const e = env({ FEEDBACK_DISCORD_WEBHOOK_URL: HOOK })
    const cases: [unknown, string][] = [
      [{ feedback: 'short' }, 'Feedback must be at least 10 characters long'],
      [{ feedback: '          x' }, 'Feedback must be at least 10 characters long'],
      [{ feedback: 'x'.repeat(1001) }, 'Feedback must be less than 1000 characters'],
      [{ feedback: 'This is long enough feedback', email: 'bad' }, 'Invalid email format'],
      [{ feedback: 'This is long enough feedback', email: 42 }, 'Invalid email format'],
      ['not json', 'Feedback must be at least 10 characters long'],
    ]
    for (const [body, error] of cases) {
      const res = await post(body, e)
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error })
    }
    expect(spy).not.toHaveBeenCalled()
  })

  it('rate limited: 429 with CORS, before validation, and no fetch', async () => {
    const spy = fetchSpy
    const res = await post(
      good,
      env({ FEEDBACK_DISCORD_WEBHOOK_URL: HOOK, FEEDBACK_LIMITER: limiter(false) as never }),
    )
    expect(res.status).toBe(429)
    expect((await res.json()).error).toMatch(/^Too many requests/)
    expect(res.headers.get('retry-after')).toBe('60')
    expect(res.headers.get('access-control-allow-origin')).toBe('https://www.brisbaneferry.com')
    expect(spy).not.toHaveBeenCalled()
  })

  it('a limiter that errors fails closed with a 503 and no fetch', async () => {
    const broken = { limit: vi.fn(async () => Promise.reject(new Error('limiter down'))) }
    const res = await post(
      good,
      env({ FEEDBACK_DISCORD_WEBHOOK_URL: HOOK, FEEDBACK_LIMITER: broken as never }),
    )
    expect(res.status).toBe(503)
    expect(res.headers.get('access-control-allow-origin')).toBe('https://www.brisbaneferry.com')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(logged.join('\n')).toContain('FEEDBACK_LIMITER failed (Error)')
  })

  it('a missing limiter binding (local dev) fails open and says so', async () => {
    fetchSpy.mockResolvedValue(new Response('{}'))
    const res = await post(good, env({ FEEDBACK_DISCORD_WEBHOOK_URL: HOOK }))
    expect(res.status).toBe(200)
    expect(logged.join('\n')).toContain('FEEDBACK_LIMITER binding missing')
  })
})

describe('Discord payload limits (api/_feedback-discord.js)', () => {
  const L = DISCORD_LIMITS
  const size = (e: DiscordEmbed) =>
    e.title.length +
    e.description.length +
    e.footer.text.length +
    e.fields.reduce((n, f) => n + f.name.length + f.value.length, 0)

  it('truncates every part with an ellipsis and keeps the embed total ≤ 6000', () => {
    const p = buildDiscordPayload({
      app: 'x'.repeat(400),
      feedback: 'f'.repeat(9000),
      name: 'n'.repeat(3000),
      email: `${'e'.repeat(2000)}@example.com`,
      pageUrl: `https://x/${'p'.repeat(3000)}`,
      userAgent: 'u'.repeat(3000),
    })
    const e = p.embeds[0] as DiscordEmbed
    expect(e.title.length).toBe(L.title)
    expect(e.title.endsWith('…')).toBe(true)
    expect(e.description.length).toBeLessThanOrEqual(L.description)
    expect(e.description.endsWith('…')).toBe(true)
    expect(e.fields.length).toBeLessThanOrEqual(L.fields)
    for (const f of e.fields) {
      expect(f.name.length).toBeLessThanOrEqual(L.fieldName)
      expect(f.value.length).toBeLessThanOrEqual(L.fieldValue)
    }
    expect(e.fields.find((f) => f.name === 'User agent')?.value).toMatch(/…`$/)
    expect(e.footer.text.length).toBeLessThanOrEqual(L.footer)
    expect(size(e)).toBeLessThanOrEqual(L.total)
  })

  it('a description over 4096 is cut to exactly 4096, and short values are untouched', () => {
    const e = buildDiscordPayload({ app: 'ferry', feedback: 'a'.repeat(5000) }).embeds[0] as DiscordEmbed
    expect(e.description.length).toBe(L.description)
    expect(e.description.endsWith('a…')).toBe(true)
    expect(size(e)).toBeLessThanOrEqual(L.total)
  })

  it('truncate never splits a surrogate pair or leaves a dangling escape', () => {
    expect(truncate('abc', 3)).toBe('abc')
    expect(truncate('abcdef', 4)).toBe('abc…')
    expect(truncate('ab😀cd', 4)).toBe('ab…')
    expect(truncate('ab\\*cd', 4)).toBe('ab…')
    expect(sanitizeText('a\\b')).toBe('a\\\\b')
  })
})
