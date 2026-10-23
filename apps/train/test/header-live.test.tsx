// @vitest-environment jsdom
/**
 * The standalone header never claims LIVE before any answer (release review of addfc59, P2): a station loader that
 * timed out (no outbound answer) rendered LIVE in the server HTML and through early hydration. While the page waits
 * for its first answer the header says "Connecting…" (BrisbaneTransit's state, THE-118): neither LIVE nor OFFLINE.
 */
import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import type { ComponentType } from 'react'
import { renderToString } from 'react-dom/server'
import {
  createRoutesStub,
  createStaticHandler,
  createStaticRouter,
  Outlet,
  RouterContextProvider,
  StaticRouterProvider,
  useLoaderData,
  useParams,
} from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cloudflareContext } from '../app/lib/context.ts'
import { makeQueryClient } from '../app/lib/queries.ts'
import * as station from '../app/routes/station.tsx'
import * as trip from '../app/routes/trip.tsx'

const ENV = { API_BASE: 'http://api.invalid', SITE_URL: 'https://standalone.example' } as unknown as Env

/** The API: down while the loader runs (no answer for it), then never answering the page's own requests. */
let loading = true
function api() {
  loading = true
  vi.stubGlobal('fetch', () =>
    loading ? Promise.reject(new TypeError('fetch failed')) : new Promise(() => {}),
  )
}

function Page({ Component }: { Component: ComponentType<{ loaderData: unknown; params: unknown }> }) {
  return <Component loaderData={useLoaderData()} params={useParams()} />
}

// biome-ignore lint/suspicious/noExplicitAny: route modules have per-route generated types.
function routes(path: string, module: { default: ComponentType<any>; loader: (args: any) => unknown }) {
  const context = new RouterContextProvider()
  context.set(cloudflareContext, { env: ENV, ctx: {} as ExecutionContext, nonce: '' })
  return [
    {
      id: 'root',
      path: '/',
      loader: () => ({ mode: { fixtures: false, rt: null }, fixtures: false, tripWs: null, theme: 'system' }),
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

const header = (html: string) => html.match(/<header[\s\S]*?<\/header>/)?.[0] ?? ''

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('standalone train header before any answer', () => {
  it('server render: a station whose loader got no answer shows Connecting…, not LIVE', async () => {
    api()
    const handler = createStaticHandler(routes('station/:slug', station))
    const ctx = await handler.query(new Request('https://standalone.example/station/roma-street'))
    if (ctx instanceof Response) throw new Error(`unexpected ${ctx.status}`)
    const html = renderToString(
      <QueryClientProvider client={makeQueryClient()}>
        <StaticRouterProvider router={createStaticRouter(handler.dataRoutes, ctx)} context={ctx} />
      </QueryClientProvider>,
    )
    const head = header(html)
    expect(head).toContain('<header')
    expect(head).not.toContain('data-live-claim')
    expect(head).not.toMatch(/>LIVE</)
    expect(head).not.toContain('OFFLINE')
    expect(head).toContain('Connecting…')
  })

  it('hydrated: a station board still waiting for its first answer shows Connecting…, not LIVE or OFFLINE', async () => {
    api()
    const Stub = createRoutesStub(routes('station/:slug', station))
    render(
      <QueryClientProvider client={makeQueryClient()}>
        <Stub initialEntries={['/station/roma-street']} />
      </QueryClientProvider>,
    )
    const head = await screen.findByRole('banner')
    expect(await screen.findByText('Connecting…')).toBeInTheDocument()
    expect(head.querySelector('[data-live-claim]')).toBeNull()
    expect(head).not.toHaveTextContent('OFFLINE')
  })

  it('hydrated: a service page still loading shows Connecting…, not LIVE', async () => {
    api()
    const Stub = createRoutesStub(routes('trip/:tripInstance', trip))
    render(
      <QueryClientProvider client={makeQueryClient()}>
        <Stub initialEntries={['/trip/T1-123@20261020']} />
      </QueryClientProvider>,
    )
    const head = await screen.findByRole('banner')
    expect(await screen.findByText('Loading service…')).toBeInTheDocument()
    expect(head.querySelector('[data-live-claim]')).toBeNull()
    expect(head).toHaveTextContent('Connecting…')
  })
})
