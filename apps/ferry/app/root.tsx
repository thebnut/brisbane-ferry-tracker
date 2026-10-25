import { gaRootData } from '@bft/ui/analytics-config'
import {
  LIVE_GUARD_CSS,
  liveGuardScript,
  NO_SCRIPT_LIVE_CSS,
  stampNavigation,
  useLiveGuardRelease,
  useRefetchOnReconnect,
} from '@bft/ui/connectivity'
import { QueryClientProvider } from '@tanstack/react-query'
import { type ComponentType, type ReactNode, useEffect, useState } from 'react'
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
/** Client navigations' live data is stamped with its arrival, or kept as an offline copy (R15-S1). */
export const clientMiddleware: Route.ClientMiddlewareFunction[] = [stampNavigation]

export const links: Route.LinksFunction = () => [
  { rel: 'icon', href: '/favicon.ico', sizes: '48x48' },
  { rel: 'icon', type: 'image/png', href: '/bf_favicon.png', sizes: '32x32' },
  { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
  { rel: 'manifest', href: '/manifest.webmanifest' },
]

export function loader({ context }: Route.LoaderArgs) {
  const cf = context.get(cloudflareContext)
  return {
    /** The per-request CSP nonce, for the inline scripts below (workers/security.ts). */
    nonce: cf.nonce,
    /** Public Turnstile sitekey for the feedback sheet (wrangler.jsonc); null in local dev. */
    turnstileSitekey: cf.env.TURNSTILE_SITEKEY ?? null,
    /** `ga`: GA4's inline bootstrap, only when GA_MEASUREMENT_ID is set (@bft/ui/analytics-config). */
    ...gaRootData(cf.env.GA_MEASUREMENT_ID, 'ferry', cf.env.GA_DEBUG === '1'),
    /** When this HTML was rendered: the live guard compares it with the device clock (R2-T7). */
    renderedAt: Date.now(),
  }
}

export function Layout({ children }: { children: ReactNode }) {
  const data = useRouteLoaderData<typeof loader>('root')
  const nonce = data?.nonce
  const renderedAt = data?.renderedAt ?? 0
  return (
    // suppressHydrationWarning: the live guard may mark <html> before hydration.
    <html lang="en-AU" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#FF6B35" />
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
  // Back online: refetch the live boards at once, not at the next poll (R3-X9).
  useRefetchOnReconnect(client)
  const [Onboarding, setOnboarding] = useState<ComponentType | null>(null)
  useEffect(() => {
    // First-visit onboarding (P4), off the first load: a device that hasn't answered the prompt loads it now, and it
    // checks the rest (home board, nothing saved, selector never opened) and waits for an idle moment. The key is
    // @bft/ui/onboarding's ONBOARDING_KEY, spelled here so that module stays off the first load.
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
