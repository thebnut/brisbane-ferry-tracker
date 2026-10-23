/**
 * Renders a mode page exactly as the router would: the app's own route module (loader + component) under a root route
 * that provides the root loader data both builds supply, with every /v1 and /__fixtures request answered by that app's
 * fixture API at a fixed time. Returns normalised markup for comparison with the committed golden file.
 */

import { join } from 'node:path'
import { resetUnconfirmedBefore } from '@bft/ui/connectivity'
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import type { ComponentType } from 'react'
import {
  type RouterContextProvider as Ctx,
  createRoutesStub,
  Outlet,
  RouterContextProvider,
  useLoaderData,
  useParams,
} from 'react-router'
import { expect, vi } from 'vitest'
import { makeQueryClient } from '../../app/lib/queries.ts'

/** Tuesday 20 Oct 2026, 8:30 am Brisbane: a weekday, so every fixture day has services. */
export const NOW_MS = Date.UTC(2026, 9, 19, 22, 30)

export const FIXTURE_ENV = {
  ALLOW_FIXTURES: '1',
  FIXTURES: '1',
  API_BASE: 'http://api.invalid',
  SITE_URL: 'https://standalone.example',
} as unknown as Env

export interface PageSpec {
  /** The app's prefix in BrisbaneTransit ("/bus"); empty in the standalone build. */
  base: string
  /** Route pattern and URL inside the app, e.g. "/stop/:stopId" and "/stop/10802". */
  pattern: string
  url: string
  // biome-ignore lint/suspicious/noExplicitAny: route modules have per-route generated types.
  module: { default: ComponentType<any>; loader: (args: any) => unknown }
  // biome-ignore lint/suspicious/noExplicitAny: each app's own context key.
  contextKey: any
  fixtures: (url: URL, nowMs: number) => Promise<Response>
  /** Text that shows once the page has its rows. */
  ready: RegExp
  /** The page is a board: inside BrisbaneTransit its header has the alert count (THE-118 PR 3). */
  boardAlerts?: boolean
}

export function withFixtureFetch(fixtures: PageSpec['fixtures']) {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input.toString(), 'http://localhost')
    return fixtures(new URL(`${url.pathname}${url.search}`, 'http://fixtures'), NOW_MS)
  })
}

export async function renderPage(spec: PageSpec): Promise<string> {
  vi.useFakeTimers({ toFake: ['Date', 'performance'] })
  vi.setSystemTime(NOW_MS)
  // The device clock connectivity ages data by (deviceNow) starts from these fakes, not from when the module loaded
  // (Codex r6: "updated 13 s" or "14 s ago" depending on timing).
  vi.spyOn(performance, 'timeOrigin', 'get').mockReturnValue(NOW_MS)
  resetUnconfirmedBefore()
  withFixtureFetch(spec.fixtures)
  const context = new RouterContextProvider() as unknown as Ctx
  context.set(spec.contextKey, { env: FIXTURE_ENV, ctx: {} })
  const Page = spec.module.default
  const Stub = createRoutesStub([
    {
      id: 'root',
      path: '/',
      loader: () => ({ mode: { fixtures: true, rt: null }, fixtures: true, tripWs: null, theme: 'system' }),
      Component: () => <Outlet />,
      children: [
        {
          path: `${spec.base}${spec.pattern}`.replace(/^\//, ''),
          loader: async (args: { request: Request; params: Record<string, string> }) =>
            spec.module.loader({ ...args, context }),
          Component: () => <PageWithData Page={Page} />,
        },
      ],
    },
  ])
  const { container } = render(
    <QueryClientProvider client={makeQueryClient()}>
      <Stub initialEntries={[`${spec.base}${spec.url}`]} />
    </QueryClientProvider>,
  )
  await screen.findAllByText(spec.ready, undefined, { timeout: 5000 })
  await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).toBeNull())
  // The header and the "Updated" strip are intended differences too (THE-118 PR 2): BrisbaneTransit's one header and
  // status line (modes/<mode>-header.tsx) replace each app's own.
  expect(container.querySelector('[data-status-line]') != null).toBe(!!spec.base)
  const copy = container.cloneNode(true) as HTMLElement
  for (const el of copy.querySelectorAll('header, [data-status-strip]')) el.remove()
  const raw = copy.innerHTML
  if (spec.base) {
    // Not vacuous: the transit build really links under its prefix, really swapped the nav module (no section bar,
    // THE-118 PR 3) and really shows the board's alert count.
    expect(raw).toContain(`href="${spec.base}/`)
    expect(raw).not.toMatch(/<nav aria-label="[^"]*[Ss]ections"/)
    if (spec.boardAlerts) expect(raw).toContain('data-board-alerts')
  } else expect(raw).not.toMatch(/href="\/(ferry|train|bus)\//)
  return normalise(raw, spec.base)
}

function PageWithData({ Page }: { Page: ComponentType<{ loaderData: unknown; params: unknown }> }) {
  return <Page loaderData={useLoaderData()} params={useParams()} />
}

/**
 * The intended differences only: the mount prefix in links, navigation (the standalone app's own bottom/section nav;
 * BrisbaneTransit has none, THE-118 PR 3) and the transit board header's alert count; renderPage has already removed
 * the header and the status strip. Everything else must be byte-identical.
 */
export function normalise(html: string, base: string): string {
  let out = html
  // Navigation landmarks: the standalone apps' nav module (bus "Main"/"Sections", train "Main").
  out = out.replace(/<nav aria-label="(Main|Sections)"[\s\S]*?<\/nav>/g, '<nav/>')
  // The bus and train apps wrap their phone nav in a div.
  out = out.replace(/<div class="md:hidden"><nav\/><\/div>/g, '<nav/>')
  // Where and how many nav landmarks each build has is part of the intended difference too: the standalone train app
  // adds header links on desktop (T-Desktop). BrisbaneTransit's lack of a section bar is asserted in renderPage.
  out = out.replaceAll('<nav/>', '')
  // BrisbaneTransit's alert count in the board header (AlertCountLink; train wraps it in BoardHeader's `sub` line).
  out = out.replace(
    /<div class="flex basis-full items-center"><span data-board-alerts="" class="contents">[\s\S]*?<\/a><\/span><\/div>|<span data-board-alerts="" class="contents">[\s\S]*?<\/a><\/span>/g,
    '',
  )
  // Asset URLs in tests are absolute file paths (/@fs/<checkout>/packages/…): drop the checkout location.
  out = out.replaceAll(`/@fs${join(process.cwd(), '..', '..')}/`, '/@fs/')
  if (base) out = out.replaceAll(`href="${base}/`, 'href="/').replaceAll(`href="${base}"`, 'href="/"')
  return out.replace(/></g, '>\n<')
}
