/**
 * /terminal/:slug (?to=<slug>): server-rendered terminal board (THE-118 PR 5): the terminal's departures, or with "To"
 * only the ferries going there (and the return board on desktop). Keeps the legacy URL, title, description,
 * canonical, OG tags and JSON-LD (scripts/postbuild.mjs) whatever `?to=` says, with live departure rows in the HTML
 * from the loader instead of a build-time timetable. An unknown or unreachable `to` is dropped.
 *
 * A layout over the board URL and the trip URL (THE-118 PR 7): at 1024 px and wider a row's trip opens in the board's
 * right panel, so the board stays as it is (not fetched again) while the trip opens and closes. On a trip URL the
 * board is the terminal it was opened from (`?from=`, `?to=`); below 1024, or with `?full=1`, the trip is its own page.
 */

import type { Departure } from '@bft/core/contract'
import { formatClock } from '@bft/ui'
import { VIA_NETWORK } from '@bft/ui/connectivity'
import {
  FULL,
  PanelProvider,
  panelControls,
  samePlace,
  showBoard,
  usePanelFocus,
  useWide,
} from '@bft/ui/panel'
import {
  data,
  Outlet,
  type ShouldRevalidateFunctionArgs,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router'
import { Footer, SECTION } from '../components/Chrome.tsx'
import { FerryBoards } from '../components/FerryBoards.tsx'
import { DEPARTURE_LIMIT, fetchDepartures } from '../lib/api.ts'
import { at } from '../lib/base.ts'
import { validateDepartures } from '../lib/contract.server.ts'
import { cleanStopName } from '../lib/names.ts'
import { pageMeta, SITE_URL, terminalJsonLd, terminalMeta, terminalRoutes } from '../lib/seo.ts'
import { loaderEnv, settle } from '../lib/server.server.ts'
import {
  boardHref,
  choice,
  destinationParam,
  nearbyTerminals,
  TERMINALS,
  type Terminal,
  terminalById,
  terminalByParam,
  terminalBySlug,
  terminalHref,
} from '../lib/terminals.ts'
import type { Route } from './+types/terminal'

/** A trip URL's board: the terminal it was opened from and its "To" (`?from=`, `?to=`), or null. */
function tripPlace(url: URL) {
  const terminal = terminalByParam(url.searchParams.get('from'))
  const to = terminal ? destinationParam(terminal, url.searchParams.get('to')) : null
  return terminal ? { terminal, to } : null
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const url = new URL(request.url)
  const { fixtures, rt, fetcher, env, fallback } = loaderEnv(request, context)
  if (!params.slug) {
    // The trip URL: the board beside it is fetched by the browser, and only on desktop (a phone shows the trip alone).
    const place = tripPlace(url)
    return {
      terminal: place?.terminal ?? null,
      to: place?.to ? choice(place.to) : null,
      outbound: null,
      inbound: null,
      upcoming: null,
      renderedAt: Date.now(),
      via: VIA_NETWORK,
      mode: { fixtures, rt, forced: env?.FIXTURES === '1', allowed: env?.ALLOW_FIXTURES === '1' },
      siteUrl: env?.SITE_URL ?? SITE_URL,
    }
  }
  const terminal = terminalBySlug(params.slug)
  if (!terminal) throw data(null, { status: 404 })
  const to = destinationParam(terminal, url.searchParams.get('to'))
  const [outbound, inbound, all] = await Promise.all([
    to
      ? settle((signal) =>
          fetchDepartures(fetcher, terminal.id, to.id, { signal, validate: validateDepartures }),
        )
      : null,
    to?.destinations.includes(terminal.id)
      ? settle((signal) =>
          fetchDepartures(fetcher, to.id, terminal.id, { signal, validate: validateDepartures }),
        )
      : null,
    settle((signal) =>
      fetchDepartures(fetcher, terminal.id, '', { limit: 40, signal, validate: validateDepartures }),
    ),
  ])
  return {
    terminal,
    to: to ? choice(to) : null,
    // Without "To", the board's rows are the first of the timetable's (the same answer at the board's own limit).
    outbound: to ? outbound : all && { ...all, departures: all.departures.slice(0, DEPARTURE_LIMIT) },
    inbound,
    upcoming: all?.departures ?? [],
    renderedAt: Date.now(),
    via: VIA_NETWORK,
    // After an API failure with FIXTURE_FALLBACK the browser polls the fixture API too (and shows the demo notice).
    // FIXTURES=1 or a fallback answer: demo data without a visitor's demo session (useFixtureCookie).
    mode: {
      fixtures: fixtures || fallback.used,
      rt,
      forced: env?.FIXTURES === '1' || fallback.used,
      allowed: env?.ALLOW_FIXTURES === '1',
    },
    siteUrl: env?.SITE_URL ?? SITE_URL,
  }
}

export function headers() {
  return { 'cache-control': 'private, no-store' }
}

/** Not again for a trip opening or closing beside the board, only for another terminal or "To" (THE-118 PR 7). */
export function shouldRevalidate(args: ShouldRevalidateFunctionArgs) {
  return samePlace(args, 'terminal') ? false : args.defaultShouldRevalidate
}

export const meta: Route.MetaFunction = ({ loaderData }) => {
  if (!loaderData?.terminal)
    return [{ title: 'Page not found | Brisbane Ferry' }, { name: 'robots', content: 'noindex' }]
  const m = terminalMeta(loaderData.terminal, loaderData.siteUrl)
  return [
    ...pageMeta({ ...m, siteUrl: loaderData.siteUrl }),
    { 'script:ld+json': terminalJsonLd(loaderData.terminal, m, loaderData.siteUrl) },
  ]
}

const formatDistance = (m: number) =>
  m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`
const T = {
  table: 'mt-2 w-full max-w-xl text-left text-sm',
  th: 'border-b border-gray-300 py-1 pr-4 font-semibold text-gray-700',
  td: 'border-b border-gray-100 py-1 pr-4 tabular',
}

function TerminalSection({ terminal, upcoming }: { terminal: Terminal; upcoming: Departure[] }) {
  const routes = terminalRoutes(terminal)
  const others = TERMINALS.filter((t) => t.id !== terminal.id)
  return (
    <section
      className={SECTION.section}
      data-terminal-page={terminal.slug}
      aria-labelledby="terminal-heading"
    >
      <nav aria-label="Breadcrumb" className="text-xs text-gray-600">
        <a className="underline hover:text-ferry-orange-deep" href={at('/')}>
          Brisbane Ferry
        </a>{' '}
        › {terminal.name} ferry terminal
      </nav>
      <h1 id="terminal-heading" className={SECTION.heading}>
        Next ferry from {terminal.name}
      </h1>
      <p className={SECTION.text}>
        Live CityCat and ferry departures from {terminal.name} ferry terminal on the Brisbane River.
        {routes.length ? ` It is served by ${routes.map((r) => `${r.code} (${r.label})`).join(', ')}.` : ''}{' '}
        The board above updates with real-time TransLink data; pick any destination to see services in both
        directions.
      </p>
      {routes.length ? (
        <>
          <h2 className={SECTION.subheading}>Routes</h2>
          <ul className={`${SECTION.text} list-disc pl-5`}>
            {routes.map((r) => (
              <li key={r.code}>
                <strong>{r.code}</strong> {r.label}: {r.stops.join(', ')}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <h2 className={SECTION.subheading}>Next departures from {terminal.name}</h2>
      {upcoming.length ? (
        <div className="mt-2 max-h-96 max-w-xl overflow-y-auto rounded-card border border-ferry-orange/20 bg-white/80 px-3">
          <table className={T.table}>
            <thead>
              <tr>
                <th scope="col" className={T.th}>
                  Departs
                </th>
                <th scope="col" className={T.th}>
                  Route
                </th>
                <th scope="col" className={T.th}>
                  Towards
                </th>
              </tr>
            </thead>
            <tbody>
              {upcoming.map((d) => (
                <tr key={`${d.tripInstance}:${d.stopSequence}`} data-testid="timetable-row">
                  <td className={T.td}>
                    {formatClock(d.estDep ?? d.schedDep)}
                    {d.status === 'live' ? ' (live)' : d.status === 'cancelled' ? ' (cancelled)' : ''}
                  </td>
                  <td className={T.td}>{d.route.short}</td>
                  <td className={T.td}>{cleanStopName(d.headsign) || 'Unknown'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className={SECTION.text}>
          Live times are not available right now. The board above will retry automatically.
        </p>
      )}
      <h2 className={SECTION.subheading}>Nearby terminals</h2>
      <ul className={SECTION.list}>
        {nearbyTerminals(terminal).map((t) => (
          <li key={t.id}>
            <a className={SECTION.link} href={terminalHref(t.slug)}>
              {t.name}
            </a>{' '}
            <span className="text-xs text-gray-600">{formatDistance(t.meters)}</span>
          </li>
        ))}
      </ul>
      <h2 className={SECTION.subheading}>All ferry terminals</h2>
      <ul className={SECTION.list}>
        {others.map((t) => (
          <li key={t.id}>
            <a className={SECTION.link} href={terminalHref(t.slug)}>
              {t.name}
            </a>
          </li>
        ))}
      </ul>
      <p className={SECTION.text}>
        <a className="underline hover:text-ferry-orange-deep" href={at('/')}>
          Live departure boards for every Brisbane ferry terminal
        </a>
      </p>
    </section>
  )
}

export default function TerminalPage({ loaderData }: Route.ComponentProps) {
  const { terminal } = loaderData
  const trip = useParams().tripInstance
  const wide = useWide()
  const [search] = useSearchParams()
  const { pathname, search: query } = useLocation()
  const navigate = useNavigate()
  // ✕ and "Open full page" for the trip beside the board; focus into the panel and back to the row.
  const controls = panelControls(
    (to, opts) => navigate(to, opts),
    () => navigate(-1),
    terminal ? boardHref(terminal.id, loaderData.to?.id) : '',
    `${pathname}${query}`,
  )
  const alone = !wide || !terminal || search.has(FULL)
  usePanelFocus(alone ? undefined : trip, controls.close)
  // The trip alone: a phone or tablet, its full page, or a trip with no terminal to show the board of.
  if (trip && alone) return <Outlet />
  if (!terminal) return null
  showBoard('terminal', {
    from: terminal.slug,
    to: loaderData.to ? (terminalById(loaderData.to.id)?.slug ?? null) : null,
    filter: null,
  })
  return (
    <>
      <FerryBoards
        key={`${terminal.id}:${loaderData.to?.id ?? ''}`}
        from={choice(terminal)}
        to={loaderData.to}
        outbound={loaderData.outbound}
        inbound={loaderData.inbound}
        renderedAt={loaderData.renderedAt}
        mode={loaderData.mode}
        trip={trip}
        panel={
          trip ? (
            <PanelProvider value={controls}>
              <Outlet />
            </PanelProvider>
          ) : null
        }
      >
        {loaderData.upcoming ? <TerminalSection terminal={terminal} upcoming={loaderData.upcoming} /> : null}
      </FerryBoards>
      <Footer />
    </>
  )
}
