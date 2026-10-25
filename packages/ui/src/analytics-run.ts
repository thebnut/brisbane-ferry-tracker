/**
 * /ga.js: the GA4 page views and the engaged-visit timer, built as its own file (vite/ga-module.ts) and loaded by the
 * root's bootstrap only when GA is on, once the page has loaded and gone idle (analytics-config.ts gaBootstrap). So
 * none of this is on any page's first load. It imports nothing: a module the app's chunks share would be split into a
 * chunk of its own, which the pages carrying a star would then load too.
 *
 *  - `page_view`: one for the page it loads on, then one per React Router location change (pathname and search; a
 *    hash-only change or a re-render sends none).
 *  - `engaged_visit`: once per session (sessionStorage; once per page load when storage is blocked), when the page has
 *    been visible for 10 s in all (the count pauses while hidden and carries across route changes) and the visitor has
 *    seen a departures board (an element marked `data-ga-board`, which the board components render only with
 *    departures, and laid out: not the CSS-hidden other layout) or interacted (a pointer down, a key, a search input
 *    or a scroll past 50 px, as the legacy app).
 */

import type { BftGa } from './analytics-config.ts'

type Params = Record<string, unknown>
type Send = (name: string, params: Params) => void

interface GaGlobal {
  gtag?: (...args: unknown[]) => void
  __bftGa?: Partial<BftGa>
  __reactRouterDataRouter?: {
    subscribe(fn: (state: { location: { pathname: string; search: string } }) => void): () => void
  }
}

export const ENGAGED_KEY = 'bft-ga-engaged'
export const ENGAGED_MS = 10_000
export const BOARD_SELECTOR = '[data-ga-board]'
const SCROLL_PX = 50
/** Lets React commit the new route before its title is read. */
const TITLE_SETTLE_MS = 100

/** Origin and path only: the fallback cleaner when the bootstrap's isn't there (tests). */
const noQuery = (url: string) => {
  const u = new URL(url)
  return u.origin + u.pathname
}

/**
 * The event sender, or null when GA isn't set up here. Every event carries site_mode and the page's cleaned URL
 * (BftGa.clean: no lat/lon, nothing typed), so gtag never falls back to the full address.
 */
export function gaSender(g: GaGlobal = globalThis as GaGlobal): Send | null {
  const ga = g.__bftGa
  const siteMode = ga?.siteMode
  if (!siteMode || typeof g.gtag !== 'function') return null
  const clean = ga.clean ?? noQuery
  const here = () => (g as { location?: Location }).location?.href
  return (name, params) => {
    try {
      const href = here()
      g.gtag?.('event', name, {
        site_mode: siteMode,
        ...(href ? { page_location: clean(href) } : {}),
        ...params,
      })
    } catch {
      // Analytics never breaks the page.
    }
  }
}

/**
 * One page_view for each page the visit was on before this started (`early`, from the bootstrap), one for where it is
 * now, then one per route change; returns a stop function. Routes are compared on their
 * pathname and search; what's sent is cleaned (`clean`: only GA_QUERY_KEEP parameters).
 */
export function startPageViews(
  send: Send,
  {
    win = window,
    router,
    clean = noQuery,
    early = [],
  }: {
    win?: Window
    router?: GaGlobal['__reactRouterDataRouter']
    clean?: (url: string) => string
    early?: readonly string[]
  } = {},
): () => void {
  router ??= (win as unknown as GaGlobal).__reactRouterDataRouter
  let last = ''
  const pending: ReturnType<typeof setTimeout>[] = []
  const view = (path: string, title?: string) => {
    if (path === last) return
    last = path
    const timer = setTimeout(() => {
      const location = clean(`${win.location.origin}${path}`)
      const u = new URL(location)
      send('page_view', {
        page_location: location,
        page_path: u.pathname + u.search,
        page_title: title ?? win.document.title,
      })
    }, TITLE_SETTLE_MS)
    pending.push(timer)
  }
  const here = () => win.location.pathname + win.location.search
  // Pages left before /ga.js loaded have no title to read any more.
  const now = here()
  for (const path of early.at(-1) === now ? early.slice(0, -1) : early) view(path, '')
  view(now)
  // React Router's own router (set by HydratedRouter): its location, so a re-render or fetcher sends nothing. Without
  // it (never expected), the address bar is checked once a second instead.
  let stop: () => void
  if (router?.subscribe) {
    stop = router.subscribe(({ location }) => view(location.pathname + location.search))
  } else {
    const id = setInterval(() => view(here()), 1_000)
    stop = () => clearInterval(id)
  }
  return () => {
    stop()
    for (const t of pending) clearTimeout(t)
  }
}

export interface EngagedOptions {
  win?: Window
  now?: () => number
  storage?: () => Storage
  thresholdMs?: number
  /** Visible time already spent before this started (the bootstrap counted it). */
  credit?: number
  /** The visitor interacted before this started (the bootstrap watched). */
  interacted?: boolean
}

/** The engaged-visit timer; returns a stop function. Sends at most once, and never in a session that already has. */
export function startEngaged(
  send: Send,
  {
    win = window,
    now = () => win.performance.now(),
    storage = () => win.sessionStorage,
    thresholdMs = ENGAGED_MS,
    credit = 0,
    interacted: early = false,
  }: EngagedOptions = {},
): () => void {
  const doc = win.document
  try {
    if (storage().getItem(ENGAGED_KEY)) return () => {}
  } catch {
    // Storage blocked: once for this page load.
  }
  let visibleMs = credit
  let since: number | null = null
  let timeUp = false
  let board = false
  let interacted = early
  let done = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let observer: MutationObserver | undefined

  const isVisible = () => doc.visibilityState === 'visible'
  const spent = () => visibleMs + (since == null ? 0 : now() - since)
  const arm = () => {
    clearTimeout(timer)
    if (since == null || timeUp) return
    timer = setTimeout(tick, Math.max(0, thresholdMs - spent()))
  }
  const tick = () => {
    if (spent() >= thresholdMs) {
      timeUp = true
      maybeSend()
    } else arm()
  }
  const maybeSend = () => {
    if (done || !timeUp || !(board || interacted)) return
    done = true
    stop()
    try {
      storage().setItem(ENGAGED_KEY, '1')
    } catch {
      // Blocked: `done` keeps it to once for this page load.
    }
    send('engaged_visit', { value: 1, currency: 'AUD' })
  }
  const checkBoard = () => {
    if (board || !isVisible() || !boardShown(doc)) return
    board = true
    observer?.disconnect()
    maybeSend()
  }
  const onVisibility = () => {
    if (isVisible()) {
      if (since == null) since = now()
      arm()
      checkBoard()
    } else if (since != null) {
      visibleMs += now() - since
      since = null
      clearTimeout(timer)
    }
  }
  const interact = () => {
    if (interacted) return
    interacted = true
    for (const t of INTERACTIONS) doc.removeEventListener(t, interact, true)
    doc.removeEventListener('scroll', onScroll, true)
    maybeSend()
  }
  const onScroll = (e: Event) => {
    const t = e.target
    const top = t === doc || t === doc.documentElement ? win.scrollY : ((t as Element).scrollTop ?? 0)
    if (top > SCROLL_PX) interact()
  }
  const stop = () => {
    clearTimeout(timer)
    observer?.disconnect()
    doc.removeEventListener('visibilitychange', onVisibility)
    for (const t of INTERACTIONS) doc.removeEventListener(t, interact, true)
    doc.removeEventListener('scroll', onScroll, true)
  }

  doc.addEventListener('visibilitychange', onVisibility)
  if (!interacted) {
    for (const t of INTERACTIONS) doc.addEventListener(t, interact, { capture: true, passive: true })
    doc.addEventListener('scroll', onScroll, { capture: true, passive: true })
  }
  if (typeof MutationObserver === 'function' && doc.body) {
    observer = new MutationObserver(checkBoard)
    observer.observe(doc.body, { childList: true, subtree: true })
  }
  if (isVisible()) since = now()
  arm()
  checkBoard()
  return stop
}

const INTERACTIONS = ['pointerdown', 'keydown', 'input'] as const

/**
 * A marked board that is laid out: the desktop and phone layouts keep both mounted and hide one with CSS
 * (display:none has no client rects), as the legacy app's isRendered (#185).
 */
function boardShown(doc: Document): boolean {
  try {
    for (const el of doc.querySelectorAll(BOARD_SELECTOR)) if (el.getClientRects().length > 0) return true
  } catch {
    // Never breaks the page.
  }
  return false
}

/** Starts both, once per page load, when the bootstrap has set GA up. */
export function start(win: Window = window): void {
  const g = win as unknown as GaGlobal
  const send = gaSender(g)
  if (!send || g.__bftGa?.started) return
  if (g.__bftGa) g.__bftGa.started = true
  try {
    const ga = g.__bftGa ?? {}
    const early = ga.paths ?? []
    // From here the router's subscription counts routes; the bootstrap stops noting them.
    ga.paths = null
    startPageViews(send, { win, clean: ga.clean, early })
    // What the bootstrap saw before this loaded counts too: visible time so far and any interaction.
    const credit = (ga.vis ?? 0) + (ga.since != null ? win.performance.now() - ga.since : 0)
    startEngaged(send, { win, credit, interacted: ga.act === true })
  } catch {
    // Analytics never breaks the page.
  }
}

if (typeof window !== 'undefined') start()
