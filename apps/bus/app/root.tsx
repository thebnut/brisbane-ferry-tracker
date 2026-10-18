import emblem from '@bft/ui/assets/emblem-bus.svg?url'
import {
  LIVE_GUARD_CSS,
  liveGuardScript,
  useLiveGuardRelease,
  useRefetchOnReconnect,
} from '@bft/ui/connectivity'
import { QueryClientProvider } from '@tanstack/react-query'
import { type ReactNode, useMemo, useState } from 'react'
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
import { THEME_SCRIPT, themeFromCookie } from './lib/storage.ts'

// No web-font request: Inter is first in the font stack and used when installed, otherwise system-ui (a
// render-blocking Google Fonts stylesheet would cost LCP). The wordmark falls back the same way.
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
    theme: themeFromCookie(request.headers.get('cookie')),
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
        {/* The guard's rule without the stylesheet: an unstyled page still hides live claims (R3-F1). */}
        <style>{LIVE_GUARD_CSS}</style>
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
