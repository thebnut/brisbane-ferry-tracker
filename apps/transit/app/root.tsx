import { AppHeader } from '@bft/ui'
import emblem from '@bft/ui/assets/emblem-transit.svg?url'
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
import { makeQueryClient } from './lib/query-client.ts'
import { getEnv, isFixtureMode } from './lib/server.server.ts'
import { getCookie, THEME_COOKIE } from './lib/storage.ts'

// No web-font request (as in the standalone apps): Inter and Poppins are used when installed, else system-ui.
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
    mode: { fixtures, rt },
    fixtures,
    tripWs: null,
    theme: t === 'light' || t === 'dark' ? t : ('system' as const),
    turnstileSitekey: env?.TURNSTILE_SITEKEY ?? null,
  }
}

/** System theme: set the class before first paint so dark-mode users never see a light flash. */
const THEME_SCRIPT =
  "try{var c=document.documentElement.classList;if(!c.contains('light')&&!c.contains('dark')&&matchMedia('(prefers-color-scheme: dark)').matches)c.add('dark')}catch(e){}"

export function Layout({ children }: { children: ReactNode }) {
  const data = useRouteLoaderData('root') as Awaited<ReturnType<typeof loader>> | undefined
  const theme = data?.theme ?? 'system'
  return (
    <html lang="en-AU" className={theme === 'system' ? undefined : theme} suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#FF6B35" />
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: constant script, sets the dark class before paint. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  )
}

export default function App() {
  const [client] = useState(makeQueryClient)
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
      <title>{`${title} | BrisbaneTransit`}</title>
      <meta name="robots" content="noindex" />
      <AppHeader mode="transit" logoSrc={emblem} />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-xl font-bold text-aqua-text dark:text-ferry-aqua-light">{title}</h1>
        <p className="mt-2 text-gray-700 dark:text-night-text/80">
          {notFound ? "We couldn't find that page. " : null}
          <a className="underline" href="/">
            Back to your saved trips
          </a>
        </p>
      </main>
    </QueryClientProvider>
  )
}
