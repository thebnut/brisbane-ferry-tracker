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

// Inter is self-hosted from app.css (@fontsource-variable/inter, font-display: swap), so no third-party, render-
// blocking font stylesheet. Ferry's wordmark is the lockup image, so Poppins isn't needed here.
export const links: Route.LinksFunction = () => [
  { rel: 'icon', href: '/favicon.ico', sizes: '48x48' },
  { rel: 'icon', type: 'image/png', href: '/bf_favicon.png', sizes: '32x32' },
  { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
  { rel: 'manifest', href: '/manifest.webmanifest' },
]

/** The per-request CSP nonce, for the inline scripts below (workers/security.ts). */
export function loader({ context }: Route.LoaderArgs) {
  return { nonce: context.get(cloudflareContext).nonce }
}

export function Layout({ children }: { children: ReactNode }) {
  const nonce = useRouteLoaderData<typeof loader>('root')?.nonce
  return (
    <html lang="en-AU">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#FF6B35" />
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
  return (
    <QueryClientProvider client={client}>
      <Outlet />
    </QueryClientProvider>
  )
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const title =
    isRouteErrorResponse(error) && error.status === 404 ? 'Page not found' : 'Something went wrong'
  return (
    <>
      {/* React 19 hoists these into <head>; error pages must never be indexed. */}
      <title>{`${title} | Brisbane Ferry`}</title>
      <meta name="robots" content="noindex" />
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-xl font-bold text-aqua-text">{title}</h1>
        <p className="mt-2 text-gray-700">
          <a className="underline" href="/">
            Back to the live departure boards
          </a>
        </p>
      </main>
      <Footer />
    </>
  )
}
