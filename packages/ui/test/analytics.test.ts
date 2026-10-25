import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GA_CSP,
  GA_DOMAINS,
  gaBootstrap,
  gaId,
  gaPageTitle,
  gaSources,
  type SiteMode,
} from '../src/analytics-config.ts'
import {
  BOARD_SELECTOR,
  ENGAGED_KEY,
  ENGAGED_MS,
  gaSender,
  RETURNING_KEY,
  SESSION_KEY,
  start,
  startEngaged,
  startPageViews,
  startReturnVisit,
} from '../src/analytics-run.ts'

const ID = 'G-MEG3CX0SFC'
type Win = Window & { gtag?: unknown; dataLayer?: unknown[]; __bftGa?: unknown; g?: unknown; s?: unknown }
const win = window as Win

let visibility: DocumentVisibilityState = 'visible'
function setVisibility(v: DocumentVisibilityState) {
  visibility = v
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  vi.useFakeTimers()
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
  sessionStorage.clear()
  localStorage.clear()
  document.body.innerHTML = ''
})

afterEach(() => {
  for (const stop of stops.splice(0)) stop()
  vi.useRealTimers()
  delete win.gtag
  delete win.dataLayer
  delete win.__bftGa
  for (const el of document.head.querySelectorAll('script')) el.remove()
})

/** A sender that records what it was asked to send (gaSender's shape: site_mode is added by gaSender itself). */
const recorder = () => {
  const sent: Array<[string, Record<string, unknown>]> = []
  return { sent, send: (name: string, params: Record<string, unknown>) => sent.push([name, params]) }
}
const engagedCount = (sent: Array<[string, unknown]>) => sent.filter(([n]) => n === 'engaged_visit').length
/** Every timer a test starts, stopped after it (their listeners are on the shared document). */
const stops: Array<() => void> = []
const engaged = (...args: Parameters<typeof startEngaged>) => {
  const stop = startEngaged(...args)
  stops.push(stop)
  return stop
}
/** The timer's clock: the fake timers' clock. */
const now = () => Date.now()

describe('gaBootstrap (the root inline script)', () => {
  it('is null, so no tag and no CSP origins, when GA_MEASUREMENT_ID is unset or not a GA4 id', () => {
    expect(gaBootstrap(undefined, 'ferry')).toBeNull()
    expect(gaBootstrap('', 'ferry')).toBeNull()
    expect(gaBootstrap('UA-1234-1', 'ferry')).toBeNull()
    expect(gaBootstrap('G-X"</script>', 'ferry')).toBeNull()
    expect(gaId(undefined)).toBeNull()
    expect(gaId(ID)).toBe(ID)
  })

  it('configures one property with site_mode, no automatic page_view, privacy defaults and the four domains', () => {
    const js = gaBootstrap(ID, 'transit') as string
    const config = JSON.parse(/var c=(\{.*?\});/.exec(js)?.[1] ?? 'null')
    expect(config).toEqual({
      send_page_view: false,
      site_mode: 'transit',
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      linker: { domains: GA_DOMAINS },
    })
    expect(GA_DOMAINS).toEqual([
      'brisbaneferry.com',
      'brisbanebus.com',
      'brisbanetrain.com',
      'brisbanetransit.com',
    ])
    // GA treats any debug_mode as on: only staging sends it.
    expect(js).not.toContain('debug_mode')
    expect(gaBootstrap(ID, 'bus', true)).toContain('"debug_mode":true')
  })

  it('sets up gtag, loads gtag.js, defines saveStop with site_mode, and leaks no other globals', () => {
    history.replaceState(null, '', '/bus/stop/10802')
    new Function(gaBootstrap(ID, 'bus') as string)()
    expect(typeof win.gtag).toBe('function')
    expect(win.g).toBeUndefined()
    expect(win.s).toBeUndefined()
    const tag = document.head.querySelector('script[src]') as HTMLScriptElement
    expect(tag.src).toBe(`https://www.googletagmanager.com/gtag/js?id=${ID}`)
    expect(tag.async).toBe(true)
    window.__bftGa?.saveStop('bus', '10802')
    const calls = (win.dataLayer as IArguments[]).map((a) => [...a])
    expect(calls[0]?.[0]).toBe('js')
    // The cleaned URL and path title, set for every event (gtag's own too) before the config; none of it in the
    // config, which would outrank "set" after a route change.
    expect(calls[1]).toEqual([
      'set',
      { page_location: `${location.origin}/bus/stop/10802`, page_title: 'bus stop 10802' },
    ])
    expect(calls[2]?.slice(0, 2)).toEqual(['config', ID])
    for (const k of ['page_location', 'page_title', 'page_referrer'])
      expect(calls[2]?.[2]).not.toHaveProperty(k)
    expect(calls[3]).toEqual([
      'event',
      'save_stop',
      {
        site_mode: 'bus',
        page_location: `${location.origin}/bus/stop/10802`,
        page_title: 'bus stop 10802',
        mode: 'bus',
        stop_id: '10802',
        value: 3,
        currency: 'AUD',
      },
    ])
  })

  it('no event carries the full query string: lat/lon and anything unknown are dropped, ids and Ads ids kept', () => {
    history.replaceState(
      null,
      '',
      '/bus/map?lat=-27.47171&lon=153.02061&q=my%20house&gclid=abc&utm_source=g&to=600#x',
    )
    new Function(gaBootstrap(ID, 'bus') as string)()
    const clean = window.__bftGa?.clean as (u: string) => string
    expect(clean(location.href)).toBe(`${location.origin}/bus/map?gclid=abc&utm_source=g&to=600`)
    expect(clean('https://www.google.com/search?q=ferry')).toBe('https://www.google.com/search')
    expect(clean('not a url at all')).toMatch(/^http/)
    const set = (win.dataLayer as IArguments[]).map((a) => [...a]).find((c) => c[0] === 'set')?.[1]
    expect(set).toMatchObject({
      page_location: `${location.origin}/bus/map?gclid=abc&utm_source=g&to=600`,
    })
    expect(JSON.stringify(win.dataLayer)).not.toMatch(/lat=|lon=|my%20house|153\.02/)
  })

  it('keeps the early signals for /ga.js: the first page, visible time and any interaction', () => {
    history.replaceState(null, '', '/ferry?to=317590&fixtures=1')
    new Function(gaBootstrap(ID, 'ferry') as string)()
    const ga = window.__bftGa as NonNullable<typeof window.__bftGa>
    expect(ga.paths).toEqual(['/ferry?to=317590&fixtures=1'])
    history.pushState(null, '', '/bus')
    history.replaceState(null, '', '/bus?route=60')
    history.replaceState(null, '', '/bus?route=60')
    history.pushState(null, '', '/ferry?to=317590&fixtures=1')
    expect(ga.paths).toEqual([
      '/ferry?to=317590&fixtures=1',
      '/bus',
      '/bus?route=60',
      '/ferry?to=317590&fixtures=1',
    ])
    ga.paths = null
    history.pushState(null, '', '/train')
    expect(ga.paths).toBeNull()
    expect(ga.since).not.toBeNull()
    expect(ga.act).toBe(false)
    vi.advanceTimersByTime(4_000)
    setVisibility('hidden')
    expect(ga.since).toBeNull()
    expect(ga.vis).toBeGreaterThan(0)
    setVisibility('visible')
    expect(ga.since).not.toBeNull()
    document.dispatchEvent(new Event('pointerdown'))
    expect(ga.act).toBe(true)
  })

  it('saveStop never throws into the save handler', () => {
    new Function(gaBootstrap(ID, 'ferry') as string)()
    win.gtag = () => {
      throw new Error('blocked')
    }
    expect(() => window.__bftGa?.saveStop('ferry', '317584')).not.toThrow()
  })
})

describe('gaSources (the CSP)', () => {
  it('adds the Google origins only when GA is on', () => {
    expect(gaSources(false, 'script')).toBe('')
    expect(gaSources(false, 'connect')).toBe('')
    expect(gaSources(true, 'script')).toBe(' https://www.googletagmanager.com')
    expect(gaSources(true, 'connect')).toBe(` ${GA_CSP.connect.join(' ')}`)
    // GA4 hits for this property go to the bare host (analytics.google.com/g/collect).
    expect(GA_CSP.connect).toContain('https://analytics.google.com')
    expect(GA_CSP.connect).not.toContain('https://www.google.com')
    expect(gaSources(true, 'img')).toBe(' https://*.google-analytics.com https://*.googletagmanager.com')
  })
})

describe('gaSender', () => {
  it('is null without gtag or the bootstrap (GA off, blocked, SSR), and start() is then a no-op', () => {
    expect(gaSender({})).toBeNull()
    expect(gaSender({ gtag: () => {} })).toBeNull()
    expect(() => start(window)).not.toThrow()
    vi.advanceTimersByTime(60_000)
  })

  it('puts site_mode on every event and swallows gtag errors', () => {
    const gtag = vi.fn()
    gaSender({ gtag, __bftGa: { siteMode: 'train' } })?.('page_view', { page_path: '/' })
    expect(gtag).toHaveBeenCalledWith('event', 'page_view', { site_mode: 'train', page_path: '/' })
    const broken = gaSender({
      gtag: () => {
        throw new Error('x')
      },
      __bftGa: { siteMode: 'train' },
    })
    expect(() => broken?.('engaged_visit', {})).not.toThrow()
  })
})

describe('startEngaged', () => {
  /** A marked board; laid out unless `hidden` (jsdom lays nothing out, so client rects are stubbed). */
  const board = (hidden = false) => {
    const ol = document.createElement('ol')
    ol.setAttribute('data-ga-board', '')
    const rects = hidden ? [] : [new DOMRect(0, 0, 100, 100)]
    ol.getClientRects = () => rects as unknown as DOMRectList
    document.body.append(ol)
  }

  it('sends once at 10 s visible with a board seen, with value and currency', () => {
    board()
    const { sent, send } = recorder()
    engaged(send, { now })
    vi.advanceTimersByTime(ENGAGED_MS - 1)
    expect(sent).toEqual([])
    vi.advanceTimersByTime(1)
    expect(sent).toEqual([['engaged_visit', { value: 1, currency: 'AUD' }]])
    document.dispatchEvent(new Event('pointerdown'))
    vi.advanceTimersByTime(60_000)
    expect(engagedCount(sent)).toBe(1)
    expect(sessionStorage.getItem(ENGAGED_KEY)).toBe('1')
  })

  it('sends once at 10 s visible after an interaction, and at the first interaction when it comes later', () => {
    const a = recorder()
    const stopA = engaged(a.send, { now })
    vi.advanceTimersByTime(3_000)
    document.dispatchEvent(new KeyboardEvent('keydown'))
    vi.advanceTimersByTime(7_000)
    expect(engagedCount(a.sent)).toBe(1)
    stopA()

    sessionStorage.clear()
    const b = recorder()
    engaged(b.send, { now })
    vi.advanceTimersByTime(15_000)
    expect(engagedCount(b.sent)).toBe(0)
    document.dispatchEvent(new Event('pointerdown'))
    expect(engagedCount(b.sent)).toBe(1)
  })

  it('does not send at 10 s with neither a board nor an interaction, nor at 9 s with both', () => {
    const a = recorder()
    const stopA = engaged(a.send, { now })
    vi.advanceTimersByTime(60_000)
    expect(a.sent).toEqual([])
    stopA()

    board()
    const b = recorder()
    engaged(b.send, { now })
    document.dispatchEvent(new Event('pointerdown'))
    vi.advanceTimersByTime(9_000)
    expect(b.sent).toEqual([])
  })

  it('pauses while the page is hidden, and counts visible time already spent (credit)', () => {
    board()
    const { sent, send } = recorder()
    engaged(send, { now })
    vi.advanceTimersByTime(5_000)
    setVisibility('hidden')
    vi.advanceTimersByTime(60_000)
    expect(sent).toEqual([])
    setVisibility('visible')
    vi.advanceTimersByTime(4_999)
    expect(sent).toEqual([])
    vi.advanceTimersByTime(1)
    expect(engagedCount(sent)).toBe(1)

    sessionStorage.clear()
    const c = recorder()
    engaged(c.send, { now, credit: 8_000 })
    vi.advanceTimersByTime(2_000)
    expect(engagedCount(c.sent)).toBe(1)
  })

  it('counts a board only while visible, including one rendered later (a route change)', async () => {
    const { sent, send } = recorder()
    engaged(send, { now })
    vi.advanceTimersByTime(ENGAGED_MS)
    expect(sent).toEqual([])
    board()
    await Promise.resolve()
    expect(engagedCount(sent)).toBe(1)
  })

  it('counts a scroll past the threshold, not a nudge', () => {
    const { sent, send } = recorder()
    engaged(send, { now })
    vi.advanceTimersByTime(ENGAGED_MS)
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 20 })
    document.dispatchEvent(new Event('scroll'))
    expect(sent).toEqual([])
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 200 })
    document.dispatchEvent(new Event('scroll'))
    expect(engagedCount(sent)).toBe(1)
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 })
  })

  it('sends nothing in a session that already has', () => {
    board()
    sessionStorage.setItem(ENGAGED_KEY, '1')
    const { sent, send } = recorder()
    engaged(send, { now })
    vi.advanceTimersByTime(60_000)
    expect(sent).toEqual([])
  })

  it('with storage blocked, still sends once for the page load', () => {
    board()
    const blocked = () => {
      throw new DOMException('denied', 'SecurityError')
    }
    const { sent, send } = recorder()
    engaged(send, { now, storage: blocked as () => Storage })
    vi.advanceTimersByTime(ENGAGED_MS)
    document.dispatchEvent(new Event('pointerdown'))
    vi.advanceTimersByTime(60_000)
    expect(engagedCount(sent)).toBe(1)
  })

  it('does not count a CSS-hidden board (the other layout of the page)', () => {
    board(true)
    const { sent, send } = recorder()
    engaged(send, { now })
    vi.advanceTimersByTime(60_000)
    expect(sent).toEqual([])
  })

  it('uses the board marker the board components render', () => {
    expect(BOARD_SELECTOR).toBe('[data-ga-board]')
  })
})

describe('gaPageTitle', () => {
  const CASES: [string, SiteMode, string][] = [
    ['/', 'transit', 'transit home'],
    ['/', 'bus', 'bus home'],
    ['/nearby', 'transit', 'transit nearby'],
    ['/bus', 'transit', 'bus home'],
    ['/bus/stop/10802', 'transit', 'bus stop 10802'],
    ['/stop/10813', 'bus', 'bus stop 10813'],
    ['/train/station/roma-street', 'transit', 'train station roma-street'],
    ['/station/central', 'train', 'train station central'],
    ['/ferry/terminal/bulimba', 'transit', 'ferry terminal bulimba'],
    ['/terminal/bulimba', 'ferry', 'ferry terminal bulimba'],
    ['/route/60', 'bus', 'bus route 60'],
    ['/train/trip/39393737-QR%2026_27-44449-DK64%4020261025', 'transit', 'train trip'],
    ['/bus/stop/10802?lat=-27.47&lon=153.02#x', 'transit', 'bus stop 10802'],
    ['/bus/stop/a%20b%3Cscript%3E', 'transit', 'bus stop'],
    ['/bus/stop/%E0%A4%A', 'transit', 'transit'],
    ['/Weird Page', 'transit', 'transit page'],
    ['/privacy', 'ferry', 'ferry privacy'],
  ]
  it.each(CASES)('%s on %s is "%s", and the bootstrap agrees', (path, mode, want) => {
    expect(gaPageTitle(path, mode)).toBe(want)
    new Function(gaBootstrap(ID, mode) as string)()
    expect(window.__bftGa?.title(path)).toBe(want)
  })
})

describe('startPageViews', () => {
  const routerStub = () => {
    let fn: ((s: { location: { pathname: string; search: string } }) => void) | null = null
    return {
      subscribe: (f: typeof fn) => {
        fn = f
        return () => {
          fn = null
        }
      },
      emit: (pathname: string, search = '') => fn?.({ location: { pathname, search } }),
    }
  }

  /** The bootstrap's URL cleaner. */
  const bootClean = () => {
    new Function(gaBootstrap(ID, 'transit') as string)()
    return window.__bftGa?.clean as (u: string) => string
  }
  /** The bootstrap's path-based title. */
  const bootTitle = () => window.__bftGa?.title as (p: string) => string

  it('sends one page_view on load, one per route change, none on a re-render or hash-only change', () => {
    history.replaceState(null, '', '/ferry?to=317590')
    document.title = 'Ferry | BrisbaneTransit'
    const router = routerStub()
    const { sent, send } = recorder()
    const titles: string[] = []
    startPageViews(send, {
      router,
      clean: bootClean(),
      title: bootTitle(),
      setPage: (p) => titles.push(`${new URL(p.page_location).pathname} ${p.page_title}`),
    })
    vi.advanceTimersByTime(200)
    expect(sent).toEqual([
      [
        'page_view',
        {
          page_location: `${location.origin}/ferry?to=317590`,
          page_path: '/ferry?to=317590',
          page_title: 'ferry home',
        },
      ],
    ])
    // A fetcher, a revalidation or a hash change: the router's state changes, the location doesn't.
    router.emit('/ferry', '?to=317590')
    router.emit('/ferry', '?to=317590')
    vi.advanceTimersByTime(200)
    expect(sent).toHaveLength(1)
    // The board's own title names the stop: GA never gets it.
    document.title = 'Cultural Centre, platform 1 (stop 010802) | BrisbaneTransit'
    router.emit('/bus/stop/10802')
    vi.advanceTimersByTime(200)
    expect(sent).toHaveLength(2)
    expect(sent[1]?.[1]).toMatchObject({ page_path: '/bus/stop/10802', page_title: 'bus stop 10802' })
    // Set for gtag's own events before each page_view: the new page's URL and title.
    expect(titles).toEqual(['/ferry ferry home', '/bus/stop/10802 bus stop 10802'])
    expect(JSON.stringify(sent)).not.toContain('Cultural Centre')
    router.emit('/bus/stop/10802', '?route=60')
    vi.advanceTimersByTime(200)
    expect(sent).toHaveLength(3)
    // Nearby's map link carries the position: the route change counts, the position is never sent.
    router.emit('/bus/map', '?lat=-27.47171&lon=153.02061')
    vi.advanceTimersByTime(200)
    expect(sent[3]?.[1]).toMatchObject({
      page_location: `${location.origin}/bus/map`,
      page_path: '/bus/map',
      page_title: 'bus map',
    })
  })

  it('still counts every route the visit took before /ga.js loaded, back to the first page too', () => {
    history.replaceState(null, '', '/train')
    document.title = 'Train | BrisbaneTransit'
    const a = recorder()
    startPageViews(a.send, {
      router: routerStub(),
      clean: bootClean(),
      title: bootTitle(),
      early: ['/', '/bus', '/train'],
    })
    vi.advanceTimersByTime(200)
    // Each page's own title from its path, the pages left before /ga.js loaded too.
    expect(a.sent.map(([, p]) => [p.page_path, p.page_title])).toEqual([
      ['/', 'transit home'],
      ['/bus', 'bus home'],
      ['/train', 'train home'],
    ])
    history.replaceState(null, '', '/')
    const b = recorder()
    startPageViews(b.send, { router: routerStub(), clean: bootClean(), early: ['/', '/bus'] })
    vi.advanceTimersByTime(200)
    expect(b.sent.map(([, p]) => p.page_path)).toEqual(['/', '/bus', '/'])
  })
})

describe('startReturnVisit', () => {
  const sent = () => {
    const calls: Array<[string, Record<string, unknown>]> = []
    return { send: (name: string, params: Record<string, unknown>) => calls.push([name, params]), calls }
  }

  it('the first session sends nothing and leaves the flag; a later session sends return_visit once', () => {
    const a = sent()
    expect(startReturnVisit(a.send)).toBe(false)
    expect(a.calls).toEqual([])
    expect(localStorage.getItem(RETURNING_KEY)).toBe('1')
    expect(sessionStorage.getItem(SESSION_KEY)).toBe('1')
    // Later pages of the same session: nothing.
    expect(startReturnVisit(a.send)).toBe(false)
    expect(a.calls).toEqual([])
    // A new session (sessionStorage is per tab session) on a browser that has visited before.
    sessionStorage.clear()
    const b = sent()
    expect(startReturnVisit(b.send)).toBe(true)
    expect(b.calls).toEqual([['return_visit', { value: 2, currency: 'AUD' }]])
    expect(startReturnVisit(b.send)).toBe(false)
    expect(b.calls).toHaveLength(1)
  })

  it('never sends, and never throws, when storage is blocked', () => {
    const blocked = () => {
      throw new DOMException('denied', 'SecurityError')
    }
    const c = sent()
    localStorage.setItem(RETURNING_KEY, '1')
    expect(startReturnVisit(c.send, { session: blocked })).toBe(false)
    expect(startReturnVisit(c.send, { local: blocked })).toBe(false)
    sessionStorage.clear()
    const throwing = { getItem: () => null, setItem: blocked } as unknown as Storage
    expect(startReturnVisit(c.send, { local: () => throwing })).toBe(false)
    expect(c.calls).toEqual([])
  })
})

describe('start (/ga.js)', () => {
  it('starts once per page load with site_mode on every event', () => {
    const gtag = vi.fn()
    Object.assign(win, { gtag, __bftGa: { siteMode: 'ferry', vis: 0, since: null, act: false } })
    start(window)
    start(window)
    vi.advanceTimersByTime(200)
    expect(gtag.mock.calls.filter((c) => c[1] === 'page_view')).toHaveLength(1)
    for (const c of gtag.mock.calls.filter((c) => c[0] === 'event'))
      expect(c[2]).toMatchObject({ site_mode: 'ferry' })
  })

  it('every event carries the path-based title, set for gtag first; never document.title', () => {
    const gtag = vi.fn()
    history.replaceState(null, '', '/stop/10802?route=60')
    document.title = 'Cultural Centre, platform 1 (stop 010802) | BrisbaneBus'
    new Function(gaBootstrap(ID, 'bus') as string)()
    const ga = window.__bftGa as NonNullable<typeof window.__bftGa>
    Object.assign(win, { gtag, __bftGa: { ...ga, vis: 10_000, since: null, act: true } })
    start(window)
    vi.advanceTimersByTime(200)
    expect(gtag.mock.calls.find((c) => c[0] === 'set')).toEqual([
      'set',
      { page_location: `${location.origin}/stop/10802?route=60`, page_title: 'bus stop 10802' },
    ])
    const events = gtag.mock.calls.filter((c) => c[0] === 'event')
    expect(events.map((c) => c[1])).toEqual(['page_view', 'engaged_visit'])
    for (const c of events) expect(c[2]).toMatchObject({ page_title: 'bus stop 10802' })
    expect(JSON.stringify(gtag.mock.calls)).not.toContain('Cultural Centre')
  })

  it('sends return_visit with site_mode on a returning browser’s first page of a session, once', () => {
    const gtag = vi.fn()
    localStorage.setItem(RETURNING_KEY, '1')
    Object.assign(win, { gtag, __bftGa: { siteMode: 'train', vis: 0, since: null, act: false } })
    start(window)
    const returns = () => gtag.mock.calls.filter((c) => c[0] === 'event' && c[1] === 'return_visit')
    expect(returns()).toHaveLength(1)
    expect(returns()[0]?.[2]).toMatchObject({ value: 2, currency: 'AUD', site_mode: 'train' })
    // A reload in the same session: not again.
    Object.assign(win, { __bftGa: { siteMode: 'train', vis: 0, since: null, act: false } })
    start(window)
    expect(returns()).toHaveLength(1)
  })

  it('counts the visible time and the interaction the bootstrap saw before it loaded', () => {
    const gtag = vi.fn()
    // 8 s visible, then hidden, before /ga.js: 2 s more once visible again. An early tap qualifies on its own.
    Object.assign(win, { gtag, __bftGa: { siteMode: 'bus', vis: 8_000, since: null, act: true } })
    setVisibility('hidden')
    start(window)
    setVisibility('visible')
    vi.advanceTimersByTime(1_999)
    expect(gtag.mock.calls.filter((c) => c[1] === 'engaged_visit')).toHaveLength(0)
    vi.advanceTimersByTime(1)
    expect(gtag.mock.calls.filter((c) => c[1] === 'engaged_visit')).toHaveLength(1)
  })
})
