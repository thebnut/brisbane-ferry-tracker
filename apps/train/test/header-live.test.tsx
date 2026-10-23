// @vitest-environment jsdom
/**
 * The standalone header never claims LIVE before any answer (release review of addfc59, P2): a station loader that
 * timed out (no outbound answer) rendered LIVE in the server HTML and through early hydration, and /map and /alerts
 * claimed LIVE with no answer at all. While a page waits for its first answer the header says "Connecting…"
 * (BrisbaneTransit's state, THE-118): neither LIVE nor OFFLINE. Each case renders the real route on the server, then
 * hydrates that HTML.
 */
import { reportOnline, resetUnconfirmedBefore } from '@bft/ui/connectivity'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, waitFor } from '@testing-library/react'
import type { ComponentType } from 'react'
import { hydrateRoot, type Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import {
  createMemoryRouter,
  createStaticHandler,
  createStaticRouter,
  Outlet,
  RouterContextProvider,
  RouterProvider,
  StaticRouterProvider,
  useLoaderData,
  useParams,
} from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cloudflareContext } from '../app/lib/context.ts'
import { handleFixtureApi } from '../app/lib/fixtures.server.ts'
import { makeQueryClient } from '../app/lib/queries.ts'
import * as alerts from '../app/routes/alerts.tsx'
import * as map from '../app/routes/map.tsx'
import * as station from '../app/routes/station.tsx'
import * as trip from '../app/routes/trip.tsx'

/** Tuesday 20 Oct 2026, 8:30 am Brisbane: the fixtures have live services. */
const NOW_MS = Date.UTC(2026, 9, 19, 22, 30)

// biome-ignore lint/suspicious/noExplicitAny: route modules have per-route generated types.
type RouteModule = { default: ComponentType<any>; loader: (args: any) => unknown }

/** The API: down while the loader runs (no answer for it), then `after` for the page's own requests. */
let loading = true
function apiDown(after: 'hang' | 'fail') {
  loading = true
  vi.stubGlobal('fetch', () =>
    loading || after === 'fail' ? Promise.reject(new TypeError('fetch failed')) : new Promise(() => {}),
  )
}

/** Fixture mode at a fixed time: a live answer for the loader and for the page. */
function apiLive() {
  vi.useFakeTimers({ toFake: ['Date', 'performance'] })
  vi.setSystemTime(NOW_MS)
  vi.spyOn(performance, 'timeOrigin', 'get').mockReturnValue(NOW_MS)
  resetUnconfirmedBefore()
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input.toString(), 'http://localhost')
    return handleFixtureApi(new URL(`${url.pathname}${url.search}`, 'http://fixtures'), NOW_MS)
  })
}

function Page({ Component }: { Component: ComponentType<{ loaderData: unknown; params: unknown }> }) {
  return <Component loaderData={useLoaderData()} params={useParams()} />
}

function routes(path: string, module: RouteModule, fixtures = false) {
  const env = fixtures
    ? {
        ALLOW_FIXTURES: '1',
        FIXTURES: '1',
        API_BASE: 'http://api.invalid',
        SITE_URL: 'https://standalone.example',
      }
    : { API_BASE: 'http://api.invalid', SITE_URL: 'https://standalone.example' }
  const context = new RouterContextProvider()
  context.set(cloudflareContext, { env: env as unknown as Env, ctx: {} as ExecutionContext, nonce: '' })
  return [
    {
      id: 'root',
      path: '/',
      loader: () => ({ mode: { fixtures, rt: null }, fixtures, tripWs: null, theme: 'system' }),
      Component: () => <Outlet />,
      children: [
        {
          path,
          loader: async (args: { request: Request; params: Record<string, string> }) => {
            const data = await module.loader({ ...args, context })
            loading = false
            return data
          },
          Component: () => <Page Component={module.default} />,
        },
      ],
    },
  ]
}

const roots: Root[] = []

/** Server-renders `url`, then hydrates that HTML with the same loader data, as the browser does. */
async function serveAndHydrate(path: string, module: RouteModule, url: string, fixtures = false) {
  const tree = routes(path, module, fixtures)
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

/** Neither LIVE nor OFFLINE: "Connecting…". */
function expectConnecting(header: string | HTMLElement) {
  const html = typeof header === 'string' ? header : header.outerHTML
  expect(html).toContain('<header')
  expect(html).not.toContain('data-live-claim')
  expect(html).not.toMatch(/>LIVE</)
  expect(html).not.toContain('OFFLINE')
  expect(html).toContain('Connecting…')
}

afterEach(() => {
  // A failed request marks the API unreachable for the whole module: the next test starts online again.
  reportOnline()
  for (const root of roots.splice(0)) act(() => root.unmount())
  document.body.innerHTML = ''
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('standalone train header before any answer', () => {
  it('station whose loader got no answer: Connecting… in the server HTML and after hydration', async () => {
    apiDown('hang')
    const page = await serveAndHydrate('station/:slug', station, '/station/roma-street')
    expectConnecting(page.serverHeader)
    expect(page.hydrationErrors).toEqual([])
    // The board has reported (useReportLive) by now: still waiting, so still Connecting… (no OFFLINE flash).
    expectConnecting(page.header())
  })

  it('station whose first answer then fails: OFFLINE, never LIVE on the way', async () => {
    apiDown('fail')
    const page = await serveAndHydrate('station/:slug', station, '/station/roma-street')
    expectConnecting(page.serverHeader)
    await waitFor(() => expect(page.header()).toHaveTextContent('OFFLINE'), { timeout: 10_000 })
    expect(page.header().querySelector('[data-live-claim]')).toBeNull()
  })

  it('station with a live answer: LIVE in the server HTML and after hydration (no claim lost)', async () => {
    apiLive()
    const page = await serveAndHydrate('station/:slug', station, '/station/roma-street', true)
    expect(page.serverHeader).toContain('data-live-claim')
    expect(page.hydrationErrors).toEqual([])
    expect(page.header().querySelector('[data-live-claim]')).toHaveTextContent('LIVE')
    expect(page.header()).not.toHaveTextContent('Connecting…')
  })

  it('service page still loading: Connecting…, not LIVE', async () => {
    apiDown('hang')
    const page = await serveAndHydrate('trip/:tripInstance', trip, '/trip/T1-123@20261020')
    expectConnecting(page.serverHeader)
    expect(page.hydrationErrors).toEqual([])
    expectConnecting(page.header())
  })

  it('alerts whose loader got no answer: Connecting…, not LIVE', async () => {
    apiDown('hang')
    const page = await serveAndHydrate('alerts', alerts, '/alerts')
    expectConnecting(page.serverHeader)
    expect(page.hydrationErrors).toEqual([])
    expectConnecting(page.header())
  })

  it('map before the trains answer: Connecting…, not LIVE', async () => {
    apiDown('hang')
    const page = await serveAndHydrate('map', map, '/map')
    expectConnecting(page.serverHeader)
    expect(page.hydrationErrors).toEqual([])
    expectConnecting(page.header())
  })
})
