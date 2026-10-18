import {
  LIVE_GUARD_CSS,
  liveGuardScript,
  NO_SCRIPT_LIVE_CSS,
  useLiveGuardRelease,
  useRefetchOnReconnect,
} from '@bft/ui/connectivity'
import { QueryClientProvider } from '@tanstack/react-query'
import { type ReactNode, useState } from 'react'
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
import { Footer, SiteHeader } from './components/Chrome.tsx'
import { cloudflareContext } from './lib/context.ts'
import { makeQueryClient } from './lib/queries.ts'
import { getEnv, isFixtureMode } from './lib/server.server.ts'
import { themeFromCookie } from './lib/storage.ts'

// No web-font request: Inter/Poppins are used when installed, otherwise system-ui (a render-blocking font
// stylesheet would cost LCP). The lockup's wordmark is live text in Poppins with system fallbacks.
export const links: Route.LinksFunction = () => [
  { rel: 'icon', href: '/favicon.ico', sizes: '48x48' },
  { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
  { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
  { rel: 'manifest', href: '/manifest.webmanifest' },
]

export function loader({ request, context }: Route.LoaderArgs) {
  const env = getEnv(context)
  const fixtures = isFixtureMode(request, env)
  // The trip socket's DO serves the Worker-wide data mode only: no socket for per-visitor fixtures or a forced rtState.
  const sameMode = fixtures === (env?.FIXTURES === '1') && !new URL(request.url).searchParams.get('rt')
  return {
    /** The per-request CSP nonce, for the inline scripts below (workers/security.ts). */
    nonce: context.get(cloudflareContext).nonce,
    theme: themeFromCookie(request.headers.get('cookie')),
    fixtures,
    // null = poll; '' = this Worker's TripSocket DO (same origin); otherwise a wss:// base.
    tripWs: env?.TRIP_WS === '1' && sameMode ? (env.API_WS_BASE ?? '') : null,
    /** When this HTML was rendered: the live guard compares it with the device clock (R2-T7). */
    renderedAt: Date.now(),
  }
}

/** System theme: set the class before first paint so dark-mode users never see a light flash. */
const THEME_SCRIPT =
  "try{if(!document.documentElement.classList.contains('light')&&!document.documentElement.classList.contains('dark')&&matchMedia('(prefers-color-scheme: dark)').matches)document.documentElement.classList.add('dark')}catch(e){}"

export function Layout({ children }: { children: ReactNode }) {
  const data = useRouteLoaderData<typeof loader>('root')
  const theme = data?.theme ?? 'system'
  const nonce = data?.nonce
  const renderedAt = data?.renderedAt ?? 0
  return (
    <html lang="en-AU" className={theme === 'system' ? undefined : theme} suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#FF6B35" />
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: constant inline script, no user input. */}
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
  // Back online: refetch the live boards at once, not at the next poll (R3-X9).
  useRefetchOnReconnect(client)
  return (
    <QueryClientProvider client={client}>
      <Outlet />
    </QueryClientProvider>
  )
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const notFound = isRouteErrorResponse(error) && error.status === 404
  const title = notFound ? 'Page not found' : 'Something went wrong'
  return (
    <>
      {/* React 19 hoists these into <head>; error pages must never be indexed. */}
      <title>{`${title} | BrisbaneTrain`}</title>
      <meta name="robots" content="noindex" />
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-xl font-bold text-aqua-text dark:text-ferry-aqua-light">{title}</h1>
        <p className="mt-2 text-gray-700 dark:text-night-text/80">
          {notFound ? "That page or station doesn't exist. " : ''}
          <a className="underline" href="/stations">
            Find a station
          </a>{' '}
          or go to the{' '}
          <a className="underline" href="/">
            home page
          </a>
          .
        </p>
      </main>
      <Footer />
    </>
  )
}
