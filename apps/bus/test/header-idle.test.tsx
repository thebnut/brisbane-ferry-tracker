// @vitest-environment jsdom
/**
 * A page with no live data of its own claims nothing in the standalone header (Dev, 23 Oct): neither LIVE nor OFFLINE
 * while online, as BrisbaneTransit's connectionState. It defaulted to LIVE. Offline still says OFFLINE, and a page
 * with live data still says LIVE. Each case renders the real route on the server, then hydrates that HTML
 * (apps/train/test/header-live.test.tsx's approach).
 */
import { reportOffline, reportOnline } from '@bft/ui/connectivity'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import type { ComponentType } from 'react'
import { hydrateRoot, type Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import {
  createMemoryRouter,
  createStaticHandler,
  createStaticRouter,
  MemoryRouter,
  Outlet,
  RouterContextProvider,
  RouterProvider,
  StaticRouterProvider,
  useLoaderData,
  useParams,
  useRouteError,
} from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SiteHeader } from '../app/components/header.tsx'
import { cloudflareContext } from '../app/lib/context.ts'
import { makeQueryClient } from '../app/lib/queries.ts'
import { ErrorBoundary } from '../app/root.tsx'
import * as about from '../app/routes/about.tsx'
import * as home from '../app/routes/home.tsx'
import * as map from '../app/routes/map.tsx'
import * as nearby from '../app/routes/nearby.tsx'
import * as whatsNew from '../app/routes/whats-new.tsx'

// biome-ignore lint/suspicious/noExplicitAny: route modules have per-route generated types.
type RouteModule = { default: ComponentType<any>; loader?: (args: any) => unknown }

/** A page whose loader throws a 404: the root error boundary renders. */
const missing: RouteModule = {
  default: () => null,
  loader: () => {
    throw new Response('Not found', { status: 404 })
  },
}

function Page({ Component }: { Component: ComponentType<{ loaderData: unknown; params: unknown }> }) {
  return <Component loaderData={useLoaderData()} params={useParams()} />
}

function routes(path: string, module: RouteModule) {
  const env = { API_BASE: 'http://api.invalid', SITE_URL: 'https://standalone.example' }
  const context = new RouterContextProvider()
  context.set(cloudflareContext, { env: env as unknown as Env, ctx: {} as ExecutionContext, nonce: '' })
  return [
    {
      id: 'root',
      path: '/',
      loader: () => ({ mode: { fixtures: false, rt: null }, theme: 'system', renderedAt: Date.now() }),
      Component: () => <Outlet />,
      ErrorBoundary: () => <ErrorBoundary error={useRouteError()} params={{}} loaderData={undefined} />,
      children: [
        {
          path,
          loader: async (args: { request: Request; params: Record<string, string> }) =>
            (await module.loader?.({ ...args, context })) ?? null,
          Component: () => <Page Component={module.default} />,
        },
      ],
    },
  ]
}

const roots: Root[] = []

/** Server-renders `url`, then hydrates that HTML with the same loader data, as the browser does. */
async function serveAndHydrate(path: string, module: RouteModule, url: string, online = true) {
  const tree = routes(path, module)
  const handler = createStaticHandler(tree)
  const ctx = await handler.query(new Request(`https://standalone.example${url}`))
  if (ctx instanceof Response) throw new Error(`unexpected ${ctx.status}`)
  const html = renderToString(
    <QueryClientProvider client={makeQueryClient()}>
      <StaticRouterProvider
        router={createStaticRouter(handler.dataRoutes, ctx)}
        context={ctx}
        hydrate={false}
      />
    </QueryClientProvider>,
  )
  if (!online) reportOffline()
  const container = document.createElement('div')
  container.innerHTML = html
  document.body.append(container)
  const hydrationErrors: unknown[] = []
  const router = createMemoryRouter(tree, {
    initialEntries: [url],
    hydrationData: { loaderData: ctx.loaderData, actionData: ctx.actionData, errors: ctx.errors },
  })
  await act(async () => {
    roots.push(
      hydrateRoot(
        container,
        <QueryClientProvider client={makeQueryClient()}>
          <RouterProvider router={router} />
        </QueryClientProvider>,
        { onRecoverableError: (e) => hydrationErrors.push(e) },
      ),
    )
  })
  const header = () => container.querySelector('header') as HTMLElement
  return { serverHeader: html.match(/<header[\s\S]*?<\/header>/)?.[0] ?? '', header, hydrationErrors }
}

/** No claim at all: neither LIVE, OFFLINE nor "Connecting…" (BrisbaneTransit's connectionState: null). */
function expectNoClaim(header: string | HTMLElement) {
  const html = typeof header === 'string' ? header : header.outerHTML
  expect(html).toContain('<header')
  expect(html).not.toContain('data-live-claim')
  expect(html).not.toMatch(/>LIVE</)
  expect(html).not.toContain('OFFLINE')
  expect(html).not.toContain('Connecting…')
}

afterEach(() => {
  // reportOffline marks the API unreachable for the whole module: the next test starts online again.
  reportOnline()
  for (const root of roots.splice(0)) act(() => root.unmount())
  document.body.innerHTML = ''
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('standalone bus header on a page without live data', () => {
  const pages: [string, string, RouteModule, string][] = [
    ['map', 'map', map, '/map'],
    ["what's new", 'whats-new', whatsNew, '/whats-new'],
    ['home with nothing saved', '', home, '/'],
    ['nearby', 'nearby', nearby, '/nearby'],
    ['about', 'about', about, '/about'],
    ['the error boundary', 'missing', missing, '/missing'],
  ]
  for (const [name, path, module, url] of pages) {
    it(`${name}: no pill in the server HTML or after hydration`, async () => {
      // Nothing answers: a page that waited on the API would show it.
      vi.stubGlobal('fetch', () => new Promise(() => {}))
      const page = await serveAndHydrate(path, module, url)
      expectNoClaim(page.serverHeader)
      expect(page.hydrationErrors).toEqual([])
      expectNoClaim(page.header())
    })
  }

  it("offline: what's new still says OFFLINE", async () => {
    vi.stubGlobal('fetch', () => new Promise(() => {}))
    const page = await serveAndHydrate('whats-new', whatsNew, '/whats-new', false)
    await waitFor(() => expect(page.header()).toHaveTextContent('OFFLINE'))
    expect(page.header().querySelector('[data-live-claim]')).toBeNull()
  })

  it('a page whose data is live still says LIVE (control)', () => {
    const { container } = render(
      <MemoryRouter>
        <SiteHeader live />
      </MemoryRouter>,
    )
    expect(container.querySelector('[data-live-claim]')).toHaveTextContent('LIVE')
  })
})
