/**
 * /station/:slug (?to=destination): server-rendered station departures (T-Departures, T-Desktop). The departure rows
 * are in the HTML from the loader; the board then polls every 15 s. With a destination, desktop shows both
 * directions side by side. Unknown stations are 404s; an unreachable `to` is dropped.
 */
import type { DeparturesResponse } from '@bft/core/contract'
import { FilterPills, formatAge, formatClock, Icon, StatusStrip } from '@bft/ui'
import { useCallback, useEffect, useState } from 'react'
import { data, Link } from 'react-router'
import { SECTION, Shell } from '../components/Chrome.tsx'
import { StationBoard } from '../components/StationBoard.tsx'
import { fetchDepartures } from '../lib/api.ts'
import { at } from '../lib/base.ts'
import { validateDepartures } from '../lib/contract.server.ts'
import { boardState, type ServiceFilter } from '../lib/departures.ts'
import { lineLabel } from '../lib/lineNames.ts'
import {
  isReachable,
  reachableFrom,
  STATIONS,
  type Station,
  stationByKey,
  stationHref,
} from '../lib/network.ts'
import { pageMeta, stationJsonLd, stationMeta } from '../lib/seo.ts'
import { loaderEnv, settle, siteInfo } from '../lib/server.server.ts'
import { type Favourite, readFavourites, sameFavourite, toggleFavourite } from '../lib/storage.ts'
import { useNow } from '../lib/useNow.ts'
import type { Route } from './+types/station'

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const station = stationByKey(params.slug)
  if (!station) throw data(null, { status: 404 })
  const toKey = new URL(request.url).searchParams.get('to')
  const to = toKey && toKey !== station.key && isReachable(station.key, toKey) ? stationByKey(toKey) : null
  const { fixtures, rt, fetcher, env } = loaderEnv(request, context)
  const reverse = to && isReachable(to.key, station.key) ? to : null
  const [outbound, inbound] = await Promise.all([
    settle((signal) =>
      fetchDepartures(fetcher, station.key, to?.key ?? null, { signal, validate: validateDepartures }),
    ),
    reverse
      ? settle((signal) =>
          fetchDepartures(fetcher, reverse.key, station.key, { signal, validate: validateDepartures }),
        )
      : Promise.resolve(null),
  ])
  return {
    station,
    to,
    outbound,
    inbound,
    renderedAt: Date.now(),
    mode: { fixtures, rt },
    site: siteInfo(env),
  }
}

export function headers() {
  return { 'cache-control': 'private, no-store' }
}

export const meta: Route.MetaFunction = ({ loaderData }) => {
  if (!loaderData)
    return [{ title: 'Station not found | BrisbaneTrain' }, { name: 'robots', content: 'noindex' }]
  const m = stationMeta(loaderData.station, loaderData.site.siteUrl, loaderData.to)
  return [
    ...pageMeta({ ...m, site: loaderData.site }),
    { 'script:ld+json': stationJsonLd(loaderData.station, m, loaderData.site.siteUrl) },
  ]
}

const haversine = (a: Station, b: Station) => {
  const R = 6371000
  const r = (d: number) => (d * Math.PI) / 180
  const x =
    Math.sin(r(b.lat - a.lat) / 2) ** 2 +
    Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(x))
}

function useFavourite(f: Favourite) {
  const [list, setList] = useState<Favourite[]>([])
  useEffect(() => setList(readFavourites()), [])
  const saved = list.some((x) => sameFavourite(x, f))
  return { saved, toggle: () => setList((l) => toggleFavourite(l, f)) }
}

function StationAbout({ station }: { station: Station }) {
  const groups = reachableFrom(station.key)
  const lines = [...new Map(groups.map((g) => [g.line.name, g.line])).values()]
  const nearby = STATIONS.filter((s) => s.key !== station.key)
    .map((s) => ({ s, m: haversine(station, s) }))
    .sort((a, b) => a.m - b.m)
    .slice(0, 4)
  return (
    <section className={`${SECTION.section} mt-6 px-0`} aria-labelledby="station-about">
      <nav aria-label="Breadcrumb" className="text-xs text-gray-600 dark:text-night-text/70">
        <Link className="underline" to={at('/')}>
          BrisbaneTrain
        </Link>{' '}
        ›{' '}
        <Link className="underline" to={at('/stations')}>
          Stations
        </Link>{' '}
        › {station.name}
      </nav>
      <h1 id="station-about" className={`${SECTION.heading} mt-1`}>
        Next train from {station.name}
      </h1>
      <p className={SECTION.text}>
        Live departures, platforms and platform changes for {station.name} station
        {station.platforms.length > 1 ? `, which has ${station.platforms.length} platforms` : ''}. The board
        updates with real-time Translink data every 15 seconds; choose a destination to see only the trains
        that go there directly.
      </p>
      {lines.length ? (
        <>
          <h2 className={SECTION.subheading}>Lines</h2>
          <p className={SECTION.text}>{lines.map((l) => lineLabel(l.name)).join(', ')}</p>
        </>
      ) : null}
      <h2 className={SECTION.subheading}>Nearby stations</h2>
      <ul className={SECTION.list}>
        {nearby.map(({ s, m }) => (
          <li key={s.key}>
            <Link className={SECTION.link} to={stationHref(s.key)}>
              {s.name}
            </Link>{' '}
            <span className="text-xs text-gray-600 dark:text-night-text/70">
              {m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default function StationPage({ loaderData }: Route.ComponentProps) {
  const { station, to, outbound, inbound, mode, renderedAt } = loaderData
  const nowMs = useNow(renderedAt, 1000)
  const [filter, setFilter] = useState<ServiceFilter>('all')
  const [latest, setLatest] = useState<DeparturesResponse | undefined>(outbound ?? undefined)
  const onData = useCallback((r: DeparturesResponse | undefined) => r && setLatest(r), [])
  const fav = useFavourite({ from: station.key, to: to?.key ?? null })
  const src = latest?.rtSourceTimestamp ?? null
  // Reset the filter when moving between stations.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the trip.
  useEffect(() => setFilter('all'), [station.key, to?.key])

  const strip = (
    <StatusStrip
      updated={
        <>
          Updated{' '}
          <strong className="text-aqua-text dark:text-ferry-aqua-light">
            {formatClock(Math.floor((latest?.generatedAt ?? renderedAt) / 1000))}
          </strong>
        </>
      }
      detail={src ? formatAge(src, nowMs) : undefined}
    >
      <FilterPills
        label="Services"
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: 'All' },
          { value: 'express', label: 'Express' },
        ]}
      />
      <Link
        to={`${at('/map')}?station=${station.key}`}
        className="flex h-9 items-center rounded-full border border-ferry-orange/20 bg-white px-3 text-xs font-semibold text-aqua-text md:text-sm dark:bg-night-card dark:text-ferry-aqua-light"
      >
        Map
      </Link>
      <button
        type="button"
        onClick={fav.toggle}
        aria-pressed={fav.saved}
        aria-label={fav.saved ? 'Remove from favourites' : 'Save as favourite'}
        className="flex size-9 items-center justify-center rounded-full border border-ferry-orange/20 bg-white text-ferry-orange-aa dark:bg-night-card"
      >
        <Icon name="star" size={18} fill={fav.saved ? 'currentColor' : 'none'} />
      </button>
    </StatusStrip>
  )

  // The header pill follows the boards: from the loader data until each StationBoard reports (useReportLive).
  const seeded = [outbound, to ? inbound : null].every((r) => !r || boardState(r, false, nowMs) == null)
  return (
    <Shell active="stations" strip={strip} live={seeded}>
      <div className={to && inbound ? 'grid grid-cols-1 gap-5 md:grid-cols-2' : 'mx-auto max-w-2xl'}>
        <StationBoard
          key={`${station.key}:${to?.key ?? ''}`}
          from={station}
          to={to}
          initial={outbound}
          nowMs={nowMs}
          mode={mode}
          filter={filter}
          onData={onData}
        />
        {to && inbound ? (
          <div className="hidden md:block">
            <StationBoard
              key={`${to.key}:${station.key}`}
              from={to}
              to={station}
              initial={inbound}
              nowMs={nowMs}
              mode={mode}
              filter={filter}
              compactHeader
            />
          </div>
        ) : null}
      </div>
      <StationAbout station={station} />
    </Shell>
  )
}
