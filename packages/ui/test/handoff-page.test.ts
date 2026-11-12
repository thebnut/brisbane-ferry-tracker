// @vitest-environment node
/** P6b: the mode host's handoff page and its static script, run against fake browser storage. */
import { describe, expect, it } from 'vitest'
import { decodeHandoff, HANDOFF_PREFIX, MAX_HANDOFF_BYTES } from '../src/handoff-codec.ts'
import {
  HANDOFF_COOKIE,
  handoffPage,
  handoffScript,
  type RedirectEnv,
  type RedirectMode,
  transitRedirect,
  wantsHandoff,
} from '../src/redirect.ts'

const BASE = 'https://bft-transit.brisbanetransit.workers.dev'
const ON: RedirectEnv = { REDIRECT_TO_TRANSIT: '1', TRANSIT_SITE_URL: BASE }
const CHROME = 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36'
const browser = (path: string, headers: Record<string, string> = {}, method = 'GET') =>
  new Request(`https://mode.test${path}`, {
    method,
    headers: { 'sec-fetch-mode': 'navigate', 'user-agent': CHROME, accept: 'text/html,*/*', ...headers },
  })

class FakeStorage {
  constructor(readonly items: Record<string, string> = {}) {}
  getItem(k: string) {
    return Object.hasOwn(this.items, k) ? (this.items[k] as string) : null
  }
  setItem(k: string, v: string) {
    this.items[k] = String(v)
  }
}

/** Runs a mode's handoff script with this storage; where it went and the cookie it set. */
/** document.cookie for one origin: what the script sets, and what it reads back. */
class Jar {
  readonly values = new Map<string, string>()
  readonly writes: string[] = []
  get cookie() {
    return [...this.values].map(([k, v]) => `${k}=${v}`).join('; ')
  }
  set cookie(v: string) {
    this.writes.push(v)
    const [pair = ''] = v.split(';')
    const at = pair.indexOf('=')
    this.values.set(pair.slice(0, at), pair.slice(at + 1))
  }
}

/** Runs a mode's handoff script with this storage; where it went and the handed-off cookie it set ('' if none). */
function run(
  mode: RedirectMode,
  local: Record<string, string> | FakeStorage | 'blocked',
  session: Record<string, string> | 'blocked' = {},
  jar = new Jar(),
) {
  const href = `${BASE}/${mode}?x=1`
  let went: string | null = null
  const document = {
    getElementById: (id: string) => (id === 'bft-go' ? { href } : null),
    get cookie() {
      return jar.cookie
    },
    set cookie(v: string) {
      jar.cookie = v
    },
  }
  const window = {
    get localStorage(): FakeStorage {
      if (local === 'blocked') throw new Error('SecurityError')
      return local instanceof FakeStorage ? local : new FakeStorage(local)
    },
  }
  const location = { replace: (u: string) => (went = u) }
  const sessionStorage =
    session === 'blocked'
      ? {
          getItem: () => {
            throw new Error('SecurityError')
          },
        }
      : new FakeStorage(session)
  new Function('document', 'window', 'location', 'sessionStorage', handoffScript(mode))(
    document,
    window,
    location,
    sessionStorage,
  )
  if (went === null) throw new Error('did not navigate')
  const url = went as string
  const at = url.indexOf('#')
  return {
    url,
    base: at < 0 ? url : url.slice(0, at),
    payload: at < 0 ? null : decodeHandoff(url.slice(at)),
    cookie: jar.writes.find((w) => w.startsWith(`${HANDOFF_COOKIE}=`)) ?? '',
  }
}

const COOKIE = `${HANDOFF_COOKIE}=1; Max-Age=31536000; Path=/; Secure; SameSite=Lax`

describe('handoff script', () => {
  it('bus: hands over the saved stops and goes to the server-rendered link; no cookie while it has favourites', () => {
    const saved = [
      { id: '10802', name: 'Cultural Centre station, platform 1' },
      { id: '1832', name: 'King George Square station' },
    ]
    const r = run('bus', { 'bft-bus-saved': JSON.stringify(saved) })
    expect(r.base).toBe(`${BASE}/bus?x=1`)
    expect(r.url.slice(r.base.length).startsWith(HANDOFF_PREFIX)).toBe(true)
    expect(r.payload).toEqual({ v: 1, bus: saved })
    // Transit's storing isn't confirmed to this origin, so every visit hands over again (transit's ledger dedupes).
    expect(r.cookie).toBe('')
  })

  it('train: favourites, dropping items in another shape', () => {
    const favs = [
      { from: 'roma-street', to: 'indooroopilly' },
      { from: 'central' },
      { from: 'BAD', to: null },
      7,
    ]
    const r = run('train', { 'bft-train-favourites': JSON.stringify(favs) })
    expect(r.payload).toEqual({
      v: 1,
      train: [
        { from: 'roma-street', to: 'indooroopilly' },
        { from: 'central', to: null },
      ],
    })
  })

  it('ferry: the remembered pair (localStorage = remember), else this session’s', () => {
    const pair = { outbound: { id: '317584', name: 'Bulimba' }, inbound: { id: '317590', name: 'Riverside' } }
    expect(run('ferry', { 'brisbane-ferry-selected-stops': JSON.stringify(pair) }).payload).toEqual({
      v: 1,
      ferry: { pair, remember: true },
    })
    expect(
      run('ferry', {}, { 'brisbane-ferry-selected-stops-session': JSON.stringify(pair) }).payload,
    ).toEqual({
      v: 1,
      ferry: { pair, remember: false },
    })
    // Numeric ids from an old build are kept as strings.
    const old = { outbound: { id: 317584, name: 'Bulimba' }, inbound: { id: 317590 } }
    expect(
      run('ferry', { 'brisbane-ferry-selected-stops': JSON.stringify(old) }).payload?.ferry?.pair,
    ).toEqual({
      outbound: { id: '317584', name: 'Bulimba' },
      inbound: { id: '317590', name: '' },
    })
  })

  it('reads only its own mode’s keys', () => {
    const local = {
      'bft-bus-saved': JSON.stringify([{ id: '1', name: 'a' }]),
      'bft-train-favourites': JSON.stringify([{ from: 'central', to: null }]),
    }
    expect(run('train', local).payload).toEqual({ v: 1, train: [{ from: 'central', to: null }] })
    expect(run('ferry', local).payload).toBeNull()
  })

  it.each([
    ['nothing saved', {}],
    ['an empty list', { 'bft-bus-saved': '[]' }],
    ['malformed JSON', { 'bft-bus-saved': '{oops' }],
    ['the wrong type', { 'bft-bus-saved': '{"id":"1"}' }],
    [
      'only bad items',
      {
        'bft-bus-saved': JSON.stringify([
          { id: '../x', name: 'a' },
          { id: '1', name: 'a\u0000' },
        ]),
      },
    ],
  ])('%s: the plain link, cookie still set', (_, local) => {
    const r = run('bus', local)
    expect(r.url).toBe(`${BASE}/bus?x=1`)
    expect(r.cookie).toBe(COOKIE)
  })

  it('storage that can’t be read: the plain link but no cookie, so a later visit tries again', () => {
    for (const r of [run('bus', 'blocked'), run('ferry', {}, 'blocked')]) {
      expect(r.payload).toBeNull()
      expect(r.cookie).toBe('')
    }
    const throwing = new FakeStorage()
    throwing.getItem = () => {
      throw new Error('SecurityError')
    }
    const r = run('train', throwing)
    expect(r.url).toBe(`${BASE}/train?x=1`)
    expect(r.cookie).toBe('')
  })

  it('a list too long for one fragment goes over in turns until every stop has moved', () => {
    const saved = Array.from({ length: 80 }, (_, i) => ({
      id: `${10000 + i}`,
      name: `${'Stop name '.repeat(11)}${i}`,
    }))
    const local = new FakeStorage({ 'bft-bus-saved': JSON.stringify(saved) })
    const jar = new Jar()
    const seen = new Set<string>()
    let turns = 0
    while (seen.size < saved.length && turns < 10) {
      const r = run('bus', local, {}, jar)
      const got = r.payload?.bus ?? []
      expect(got.length).toBeGreaterThan(20)
      expect(new TextEncoder().encode(JSON.stringify(r.payload)).length).toBeLessThanOrEqual(
        MAX_HANDOFF_BYTES,
      )
      expect(r.cookie).toBe('')
      for (const s of got) seen.add(s.id)
      turns++
    }
    expect(seen.size).toBe(saved.length)
    expect(turns).toBeGreaterThan(1)
    expect(turns).toBeLessThan(5)
  })

  it('more than 50 short stops also go over in turns (50 a time), wrapping round', () => {
    const saved = Array.from({ length: 60 }, (_, i) => ({ id: `${i}`, name: 'a' }))
    // localStorage full: the turn marker is a cookie, so the turns still advance.
    const local = new FakeStorage({ 'bft-bus-saved': JSON.stringify(saved) })
    local.setItem = () => {
      throw new Error('QuotaExceededError')
    }
    const jar = new Jar()
    expect(run('bus', local, {}, jar).payload?.bus?.map((s) => s.id)).toEqual(
      saved.slice(0, 50).map((s) => s.id),
    )
    expect(jar.values.get('bft-handoff-next')).toBe('50')
    expect(run('bus', local, {}, jar).payload?.bus?.map((s) => s.id)).toEqual(
      [...saved.slice(50), ...saved.slice(0, 40)].map((s) => s.id),
    )
    expect(jar.values.get('bft-handoff-next')).toBe('40')
    expect(jar.writes.find((w) => w.startsWith('bft-handoff-next='))).toBe(
      'bft-handoff-next=50; Max-Age=31536000; Path=/; Secure; SameSite=Lax',
    )
  })

  it('a stale turn marker (the list shrank) starts again from the top', () => {
    const jar = new Jar()
    jar.cookie = 'bft-handoff-next=57'
    const local = new FakeStorage({ 'bft-bus-saved': JSON.stringify([{ id: '1', name: 'a' }]) })
    expect(run('bus', local, {}, jar).payload?.bus).toEqual([{ id: '1', name: 'a' }])
  })

  it('is static: no request data in it', () => {
    for (const mode of ['ferry', 'train', 'bus'] as const) {
      expect(handoffScript(mode)).toBe(handoffScript(mode))
      expect(handoffScript(mode)).not.toMatch(/mode\.test|bft-transit|<\/script/i)
    }
  })
})

describe('handoff page', () => {
  it('noindex, no-store, nonce on the script, a noscript refresh and a link to the same URL', async () => {
    const res = handoffPage(`${BASE}/bus/stop/1?route=66&pick=1`, 'bus', 'abc123==')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(res.headers.get('x-robots-tag')).toBe('noindex')
    expect(res.headers.get('content-type')).toContain('text/html')
    const html = await res.text()
    const href = `${BASE}/bus/stop/1?route=66&amp;pick=1`
    expect(html).toContain('<meta name="robots" content="noindex">')
    expect(html).toContain(`<noscript><meta http-equiv="refresh" content="0;url=${href}"></noscript>`)
    expect(html).toContain(`<a id="bft-go" href="${href}">`)
    expect(html).toContain('<script nonce="abc123==">')
    expect(html.match(/<script/g)).toHaveLength(1)
    expect(html).not.toMatch(/<script[^>]+src=/)
  })

  it('a hostile query string stays inside the escaped attribute', async () => {
    const res = transitRedirect(browser("/stop/1?a=\"><script>alert(1)</script>&b='x'"), 'bus', ON, 'n0nce')
    const html = (await res?.text()) ?? ''
    expect(html.match(/<script/g)).toHaveLength(1)
    // The URL parser percent-encodes the query; the attribute is escaped as well, so the link stays one attribute.
    const href = /<a id="bft-go" href="([^"]*)">/.exec(html)?.[1] ?? ''
    expect(href.startsWith(`${BASE}/bus/stop/1?a=`)).toBe(true)
    expect(href).not.toMatch(/[<>"]/)
    expect(html).toContain('%22%3E%3Cscript%3Ealert(1)%3C/script%3E')
  })
})

describe('wantsHandoff / transitRedirect with a nonce', () => {
  it('a browser navigation without the cookie gets the handoff page', async () => {
    const res = transitRedirect(browser('/stop/10802'), 'bus', ON, 'n')
    expect(res?.status).toBe(200)
    expect(await res?.text()).toContain(`href="${BASE}/bus/stop/10802"`)
  })

  it('no Fetch Metadata but asking for HTML (older browsers) also gets it', () => {
    const req = new Request('https://mode.test/', { headers: { 'user-agent': CHROME, accept: 'text/html' } })
    expect(wantsHandoff(req)).toBe(true)
  })

  it.each([
    ['the cookie', browser('/', { cookie: `a=b; ${HANDOFF_COOKIE}=1; c=d` })],
    ['HEAD', browser('/', {}, 'HEAD')],
    ['Googlebot', browser('/', { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' })],
    ['a link unfurler', browser('/', { 'user-agent': 'facebookexternalhit/1.1' })],
    ['no user agent', browser('/', { 'user-agent': '' })],
    ['curl', new Request('https://mode.test/', { headers: { 'user-agent': 'curl/8.7.1', accept: '*/*' } })],
  ])('%s: the plain 302', (_, req) => {
    expect(wantsHandoff(req)).toBe(false)
    const res = transitRedirect(req, 'bus', ON, 'n')
    expect(res?.status).toBe(302)
    expect(res?.headers.get('location')).toBe(`${BASE}/bus/`)
  })

  // Real user agents, as sent (Google's crawler docs, OpenAI's, Anthropic's, Perplexity's): each gets the 301 with
  // no noindex handoff page, so Search Console's URL Inspection and AI assistants' cited links see the move.
  it.each([
    'Mozilla/5.0 (compatible; Google-InspectionTool/1.0;)',
    'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/W.X.Y.Z Mobile Safari/537.36 (compatible; Google-InspectionTool/1.0;)',
    'GoogleOther',
    'Mozilla/5.0 (compatible; GoogleOther)',
    'AdsBot-Google (+http://www.google.com/adsbot.html)',
    'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/W.X.Y.Z Mobile Safari/537.36 (compatible; AdsBot-Google-Mobile; +http://www.google.com/mobile/adsbot.html)',
    'Mozilla/5.0 (X11; Linux x86_64; Storebot-Google/1.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/W.X.Y.Z Safari/537.36',
    'Mediapartners-Google',
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot',
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot',
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.1; +https://openai.com/gptbot',
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +Claude-User@anthropic.com)',
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)',
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user)',
    'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
    'Mozilla/5.0 (compatible; Applebot/0.1; +http://www.apple.com/go/applebot)',
  ])('crawler %s: the plain 301, not the handoff page', (ua) => {
    const req = browser('/station/central', { 'user-agent': ua })
    expect(wantsHandoff(req)).toBe(false)
    const res = transitRedirect(req, 'train', { ...ON, REDIRECT_STATUS: '301' }, 'n')
    expect(res?.status).toBe(301)
    expect(res?.headers.get('location')).toBe(`${BASE}/train/station/central`)
    expect(res?.headers.get('x-robots-tag')).toBeNull()
  })

  it.each([
    CHROME,
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
    // The Google app and Chrome on Android are browsers, not crawlers.
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/340.0.0 Mobile/15E148 Safari/604.1',
  ])('a real browser still gets the handoff page: %s', async (ua) => {
    const req = browser('/station/central', { 'user-agent': ua })
    expect(wantsHandoff(req)).toBe(true)
    const res = transitRedirect(req, 'train', { ...ON, REDIRECT_STATUS: '301' }, 'n')
    expect(res?.status).toBe(200)
    expect(res?.headers.get('x-robots-tag')).toBe('noindex')
    expect(await res?.text()).toContain(`href="${BASE}/train/station/central"`)
  })

  it('a cookie with another value, or another cookie, is not the handed-off flag', () => {
    expect(wantsHandoff(browser('/', { cookie: `${HANDOFF_COOKIE}=0` }))).toBe(true)
    expect(wantsHandoff(browser('/', { cookie: `x${HANDOFF_COOKIE}=1` }))).toBe(true)
  })

  it('without a nonce (P6a callers), always the redirect', () => {
    expect(transitRedirect(browser('/'), 'bus', ON)?.status).toBe(302)
  })

  it('excluded paths and a disabled flag are untouched by the handoff too', () => {
    expect(transitRedirect(browser('/v1/bus/stops/1/departures'), 'bus', ON, 'n')).toBeNull()
    expect(transitRedirect(browser('/'), 'bus', { ...ON, REDIRECT_TO_TRANSIT: '0' }, 'n')).toBeNull()
  })
})
