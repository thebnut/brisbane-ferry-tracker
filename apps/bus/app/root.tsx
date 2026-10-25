import { useFixtureCookie } from '@bft/ui'
import { gaRootData } from '@bft/ui/analytics-config'
import emblem from '@bft/ui/assets/emblem-bus.svg?url'
import {
  LIVE_GUARD_CSS,
  liveGuardScript,
  NO_SCRIPT_LIVE_CSS,
  stampNavigation,
  useLiveGuardRelease,
  useRefetchOnReconnect,
} from '@bft/ui/connectivity'
import { QueryClientProvider } from '@tanstack/react-query'
import { type ComponentType, type ReactNode, useEffect, useMemo, useState } from 'react'
import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteLoaderData,
} from 'react-router'
import type { Route } from './+types/root'
import './app.css'
import { Footer, SiteHeader } from './components/Shell.tsx'
import { cloudflareContext } from './lib/context.ts'
import { makeQueryClient } from './lib/queries.ts'
import { getEnv, isFixtureMode } from './lib/server.server.ts'
import { FIXTURE_COOKIE, THEME_SCRIPT, themeFromCookie } from './lib/storage.ts'

// No web-font request: Inter is first in the font stack and used when installed, otherwise system-ui (a
// render-blocking Google Fonts stylesheet would cost LCP). The wordmark falls back the same way.
/** Client navigations' live data is stamped with its arrival, or kept as an offline copy (R15-S1). */
export const clientMiddleware: Route.ClientMiddlewareFunction[] = [stampNavigation]

export const links: Route.LinksFunction = () => [
  { rel: 'icon', type: 'image/svg+xml', href: emblem },
  { rel: 'icon', type: 'image/png', href: '/favicon-32.png', sizes: '32x32' },
  { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
  { rel: 'manifest', href: '/manifest.webmanifest' },
]

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = getEnv(context)
  const fixtures = isFixtureMode(request, env)
  return {
    /** The per-request CSP nonce, for the inline scripts below (workers/security.ts). */
    nonce: context.get(cloudflareContext).nonce,
    mode: { fixtures, rt: fixtures ? new URL(request.url).searchParams.get('rt') : null },
    /** FIXTURES=1: demo data for everyone (development, tests), no demo session to start or end. */
    fixturesForced: env?.FIXTURES === '1',
    /** ALLOW_FIXTURES: this Worker lets visitors switch demo mode on (never in production). */
    demoAllowed: env?.ALLOW_FIXTURES === '1',
    theme: themeFromCookie(request.headers.get('cookie')),
    /** `ga`: GA4's inline bootstrap, only when GA_MEASUREMENT_ID is set (@bft/ui/analytics-config). */
    ...gaRootData(env?.GA_MEASUREMENT_ID, 'bus', env?.GA_DEBUG === '1'),
    /** When this HTML was rendered: the live guard compares it with the device clock (R2-T7). */
    renderedAt: Date.now(),
  }
}

export function Layout({ children }: { children: ReactNode }) {
  const data = useRouteLoaderData('root') as Awaited<ReturnType<typeof loader>> | undefined
  const nonce = data?.nonce
  const renderedAt = data?.renderedAt ?? 0
  return (
    <html lang="en-AU" className={data?.theme === 'dark' ? 'dark' : undefined} suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#FF6B35" />
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: constant script, sets the dark class before paint. */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: constant script, hides stale LIVE claims before paint. */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: liveGuardScript(renderedAt) }} />
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: GA4's bootstrap (server-built), only when on. */}
        {data?.ga ? <script nonce={nonce} dangerouslySetInnerHTML={{ __html: data.ga }} /> : null}
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
  const rootData = useRouteLoaderData<typeof loader>('root')
  useFixtureCookie(
    FIXTURE_COOKIE,
    rootData?.mode.fixtures === true,
    rootData?.fixturesForced === true,
    rootData?.demoAllowed === true,
  )
  // Back online: refetch the live boards at once, not at the next poll (R3-X9).
  useRefetchOnReconnect(client)
  const [Onboarding, setOnboarding] = useState<ComponentType | null>(null)
  useEffect(() => {
    // First-visit onboarding (P4), off the first load: a device that hasn't answered the prompt loads it now, and it
    // checks the rest (nothing saved, no import) and waits for an idle moment. The key is @bft/ui/onboarding's
    // ONBOARDING_KEY, spelled here so that module stays off the first load.
    try {
      if (!localStorage.getItem('bft-onboarding'))
        import('./components/Onboarding.tsx').then(
          (m) => setOnboarding(() => m.default),
          () => {},
        )
    } catch {
      // Storage blocked: never asked.
    }
  }, [])
  return (
    <QueryClientProvider client={client}>
      <Outlet />
      {Onboarding ? <Onboarding /> : null}
    </QueryClientProvider>
  )
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const notFound = isRouteErrorResponse(error) && error.status === 404
  const title = notFound ? 'Page not found' : 'Something went wrong'
  const client = useMemo(makeQueryClient, [])
  return (
    <QueryClientProvider client={client}>
      {/* React 19 hoists these into <head>; error pages must never be indexed. */}
      <title>{`${title} | BrisbaneBus`}</title>
      <meta name="robots" content="noindex" />
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-xl font-bold text-aqua-text">{title}</h1>
        <p className="mt-2 text-gray-700 dark:text-night-text/80">
          {notFound ? "We couldn't find that stop or page. " : null}
          <a className="underline" href="/">
            Search for a stop
          </a>
        </p>
      </main>
      <Footer />
    </QueryClientProvider>
  )
}
