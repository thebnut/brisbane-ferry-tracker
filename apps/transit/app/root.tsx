import { useFixtureCookie } from '@bft/ui'
import emblem from '@bft/ui/assets/emblem-transit.svg?url'
import {
  isOfflineFailure,
  isOnline,
  LIVE_GUARD_CSS,
  liveGuardScript,
  NO_SCRIPT_LIVE_CSS,
  savePageCopy,
  stampNavigation,
  useLiveGuardRelease,
  useRefetchOnReconnect,
} from '@bft/ui/connectivity'
import { QueryClientProvider } from '@tanstack/react-query'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  type ShouldRevalidateFunctionArgs,
  useLocation,
  useRouteLoaderData,
} from 'react-router'
import type { Route } from './+types/root'
import './app.css'
import { ModeHeader } from './components/ModeHeader.tsx'
import { OfflineRouteScreen } from './components/OfflineRoute.tsx'
import { makeQueryClient } from './lib/query-client.ts'
import { getEnv, getNonce, isFixtureMode } from './lib/server.server.ts'
import { FIXTURE_COOKIE, getCookie, THEME_COOKIE } from './lib/storage.ts'

// No web-font request (as in the standalone apps): Inter and Poppins are used when installed, else system-ui.
/** Client navigations' live data is stamped with its arrival, or kept as an offline copy (R15-S1). */
export const clientMiddleware: Route.ClientMiddlewareFunction[] = [stampNavigation]

export const links: Route.LinksFunction = () => [
  { rel: 'icon', type: 'image/svg+xml', href: emblem },
  { rel: 'icon', type: 'image/png', href: '/favicon-32.png', sizes: '32x32' },
  { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
  { rel: 'manifest', href: '/manifest.webmanifest' },
]

/**
 * Root data in the union of the shapes the mounted apps read with useRouteLoaderData('root'): bus reads `mode`,
 * train reads `fixtures`, `theme` and `tripWs` (null: service detail polls; the WebSocket prototype is train-only).
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const env = getEnv(context)
  const fixtures = isFixtureMode(request, env)
  const rt = fixtures ? new URL(request.url).searchParams.get('rt') : null
  const t = getCookie(request.headers.get('cookie'), THEME_COOKIE)
  return {
    /** The per-request CSP nonce, for the inline scripts below (workers/security.ts). */
    nonce: getNonce(context),
    mode: { fixtures, rt },
    fixtures,
    /** FIXTURES=1: demo data for everyone (development, tests), no demo session to start or end. */
    fixturesForced: env?.FIXTURES === '1',
    /** ALLOW_FIXTURES: this Worker lets visitors switch demo mode on (never in production). */
    demoAllowed: env?.ALLOW_FIXTURES === '1',
    tripWs: null,
    theme: t === 'light' || t === 'dark' ? t : ('system' as const),
    turnstileSitekey: env?.TURNSTILE_SITEKEY ?? null,
    /** When this HTML was rendered: the live guard compares it with the device clock (R2-T7). */
    renderedAt: Date.now(),
  }
}

/** The search parameters the root loader reads: a navigation that changes one of them re-runs it. */
const ROOT_PARAMS = ['fixtures', 'rt'] as const

/**
 * The root data (nonce, data mode, theme, sitekey) is per visit, not per page, so a client navigation doesn't fetch
 * it again (R7-T2): offline, that request failed and took the whole app to "Something went wrong" whichever tab was
 * opened. It re-runs for an explicit revalidation, after a form action, and when ?fixtures= or ?rt= changes.
 */
export function shouldRevalidate({
  currentUrl,
  nextUrl,
  formMethod,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  if (formMethod && formMethod !== 'GET') return defaultShouldRevalidate
  if (currentUrl.href === nextUrl.href) return defaultShouldRevalidate
  return ROOT_PARAMS.some((k) => currentUrl.searchParams.get(k) !== nextUrl.searchParams.get(k))
}

/** System theme: set the class before first paint so dark-mode users never see a light flash. */
const THEME_SCRIPT =
  "try{var c=document.documentElement.classList;if(!c.contains('light')&&!c.contains('dark')&&matchMedia('(prefers-color-scheme: dark)').matches)c.add('dark')}catch(e){}"

export function Layout({ children }: { children: ReactNode }) {
  const data = useRouteLoaderData('root') as Awaited<ReturnType<typeof loader>> | undefined
  const theme = data?.theme ?? 'system'
  const nonce = data?.nonce
  const renderedAt = data?.renderedAt ?? 0
  return (
    <html lang="en-AU" className={theme === 'system' ? undefined : theme} suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#FF6B35" />
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: constant script, sets the dark class before paint. */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: constant script, hides stale LIVE claims before paint. */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: liveGuardScript(renderedAt) }} />
        {/* The guard's rule without the stylesheet: an unstyled page still hides live claims (R3-F1). */}
        <style>{LIVE_GUARD_CSS}</style>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: constant style; no JavaScript, no LIVE claims. */}
        <noscript dangerouslySetInnerHTML={{ __html: NO_SCRIPT_LIVE_CSS }} />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration nonce={nonce} />
        <Scripts nonce={nonce} />
      </body>
    </html>
  )
}

export default function App() {
  const [client] = useState(makeQueryClient)
  // The live guard (liveGuardScript) lifts only once this app has rendered its own live judgement (R2-T7).
  useLiveGuardRelease()
  // Demo mode lasts an hour from ?fixtures=1 and ends with ?fixtures=0 (R7-B1).
  const rootData = useRouteLoaderData('root') as
    | { fixtures?: boolean; fixturesForced?: boolean; demoAllowed?: boolean }
    | undefined
  useFixtureCookie(
    FIXTURE_COOKIE,
    rootData?.fixtures === true,
    rootData?.fixturesForced === true,
    rootData?.demoAllowed === true,
  )
  // Back online: refetch the live boards at once, not at the next poll (R3-X9).
  useRefetchOnReconnect(client)
  useKeepPageCopies()
  // Effects run only once hydration has committed: tests wait for this marker (tests/csp.ts).
  useEffect(() => {
    document.documentElement.dataset.hydrated = ''
  }, [])
  return (
    <QueryClientProvider client={client}>
      <Outlet />
    </QueryClientProvider>
  )
}

/** The service worker's page cache (app/sw.ts); entry.client.tsx saves the first page view into it. */
const PAGES_CACHE = 'transit-pages'
/** Its maxEntries in app/sw.ts. */
const PAGES_MAX = 40
/** Pages that only redirect, never worth a copy. */
const NO_COPY = /^\/(?:ask|feedback)$|^\/__/
/** Demo and test switches: a copy of such a page would come back under an ordinary visit's history. */
const NO_COPY_PARAMS = ['fixtures', 'rt']

/**
 * Saves a copy of every page this visit navigates to (R7): client navigations fetch only their loader data, so a page
 * reached through the Mode Tabs or a saved card had no copy, and reloading it offline gave the service worker's
 * offline page. A plain fetch (not a navigation) once the page has settled, online only; the service worker still
 * uses a copy only if this build precaches its assets (#61).
 */
function useKeepPageCopies() {
  const { pathname, search } = useLocation()
  const [first] = useState(() => pathname + search)
  useEffect(() => {
    const path = pathname + search
    if (path === first || NO_COPY.test(pathname) || !navigator.serviceWorker?.controller) return
    const params = new URLSearchParams(search)
    if (NO_COPY_PARAMS.some((k) => params.has(k))) return
    const id = setTimeout(() => {
      if (!isOnline()) return
      void savePageCopy(PAGES_CACHE, path)
        .then(async (saved) => {
          if (!saved) return
          const cache = await caches.open(PAGES_CACHE)
          // Written outside Workbox, so its expiration doesn't count these: keep the cache within its limit (oldest
          // first; Cache Storage lists entries in insertion order), as app/sw.ts configures it (Codex review).
          const keys = await cache.keys()
          await Promise.all(keys.slice(0, Math.max(0, keys.length - PAGES_MAX)).map((k) => cache.delete(k)))
        })
        .catch(() => {})
    }, 1_500)
    return () => clearTimeout(id)
  }, [pathname, search, first])
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return isOfflineFailure(error) ? <RootOfflineScreen /> : <ErrorPage error={error} />
}

function ErrorPage({ error }: { error: unknown }) {
  const notFound = isRouteErrorResponse(error) && error.status === 404
  const title = notFound ? 'Page not found' : 'Something went wrong'
  const client = useMemo(makeQueryClient, [])
  return (
    <QueryClientProvider client={client}>
      {/* React 19 hoists these into <head>; error pages must never be indexed. */}
      <title>{`${title} | BrisbaneTransit`}</title>
      <meta name="robots" content="noindex" />
      <ModeHeader />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-xl font-bold text-aqua-text dark:text-ferry-aqua-light">{title}</h1>
        <p className="mt-2 text-gray-700 dark:text-night-text/80">
          {notFound ? "We couldn't find that page. " : null}
          <a className="underline" href="/">
            Back to My Transit
          </a>
        </p>
      </main>
    </QueryClientProvider>
  )
}

/** The root boundary's offline screen: nothing above it (the Mode Tabs come with the mode layout's boundary). */
function RootOfflineScreen() {
  const client = useMemo(makeQueryClient, [])
  return (
    <QueryClientProvider client={client}>
      <ModeHeader />
      <main>
        <OfflineRouteScreen />
      </main>
    </QueryClientProvider>
  )
}
