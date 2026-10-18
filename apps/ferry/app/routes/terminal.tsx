/**
 * /terminal/:slug: server-rendered terminal page. Keeps the legacy URL, title, description, canonical, OG tags and
 * JSON-LD (scripts/postbuild.mjs), with live departure rows in the HTML from the loader instead of a build-time
 * timetable.
 */
import type { Departure } from '@bft/core/contract'
import { formatClock } from '@bft/ui'
import { data } from 'react-router'
import { Footer, SECTION } from '../components/Chrome.tsx'
import { FerryBoards } from '../components/FerryBoards.tsx'
import { fetchDepartures } from '../lib/api.ts'
import { at } from '../lib/base.ts'
import { validateDepartures } from '../lib/contract.server.ts'
import { cleanStopName } from '../lib/names.ts'
import { pageMeta, SITE_URL, terminalJsonLd, terminalMeta, terminalRoutes } from '../lib/seo.ts'
import { loaderEnv, settle } from '../lib/server.server.ts'
import { pairFromCookie } from '../lib/storage.ts'
import {
  nearbyTerminals,
  pairForTerminal,
  TERMINALS,
  terminalBySlug,
  terminalHref,
} from '../lib/terminals.ts'
import type { Route } from './+types/terminal'

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const terminal = terminalBySlug(params.slug)
  if (!terminal) throw data(null, { status: 404 })
  const { fixtures, rt, fetcher, env, fallback } = loaderEnv(request, context)
  const pair = pairForTerminal(terminal, pairFromCookie(request.headers.get('cookie')))
  const [outbound, inbound, all] = await Promise.all([
    settle((signal) =>
      fetchDepartures(fetcher, pair.outbound.id, pair.inbound.id, { signal, validate: validateDepartures }),
    ),
    settle((signal) =>
      fetchDepartures(fetcher, pair.inbound.id, pair.outbound.id, { signal, validate: validateDepartures }),
    ),
    settle((signal) =>
      fetchDepartures(fetcher, terminal.id, '', { limit: 40, signal, validate: validateDepartures }),
    ),
  ])
  return {
    terminal,
    pair,
    outbound,
    inbound,
    upcoming: all?.departures ?? [],
    renderedAt: Date.now(),
    // After an API failure with FIXTURE_FALLBACK the browser polls the fixture API too (and shows the demo notice).
    mode: { fixtures: fixtures || fallback.used, rt },
    siteUrl: env?.SITE_URL ?? SITE_URL,
  }
}

export function headers() {
  return { 'cache-control': 'private, no-store' }
}

export const meta: Route.MetaFunction = ({ loaderData }) => {
  if (!loaderData)
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

function TerminalSection({
  terminal,
  upcoming,
}: {
  terminal: Route.ComponentProps['loaderData']['terminal']
  upcoming: Departure[]
}) {
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
  return (
    <>
      <FerryBoards
        key={loaderData.terminal.id}
        pair={loaderData.pair}
        outbound={loaderData.outbound}
        inbound={loaderData.inbound}
        renderedAt={loaderData.renderedAt}
        mode={loaderData.mode}
        terminalPage
      >
        <TerminalSection terminal={loaderData.terminal} upcoming={loaderData.upcoming} />
      </FerryBoards>
      <Footer />
    </>
  )
}
