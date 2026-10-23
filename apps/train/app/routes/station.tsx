/**
 * /station/:slug (?to=destination): server-rendered station departures (T-Departures, T-Desktop). The departure rows
 * are in the HTML from the loader; the board then polls every 15 s. With a destination, desktop shows both
 * directions side by side. Unknown stations are 404s; an unreachable `to` is dropped.
 */

import type { DeparturesResponse } from '@bft/core/contract'
import { BoardHeader, Chip, chipClass, FilterRow, formatAge, formatClock, Icon, NowChip } from '@bft/ui'
import { AlertCountLink, useCurrentAlerts } from '@bft/ui/alert-count'
import { sourceTimeS, usePageCheck, VIA_NETWORK } from '@bft/ui/connectivity'
import { DestinationSheet } from '@bft/ui/destination-sheet'
import { StarButton } from '@bft/ui/star'
import { useCallback, useEffect, useState } from 'react'
import { data, Link, useNavigate } from 'react-router'
import { SECTION, Shell } from '../components/Chrome.tsx'
import { UpdatedStrip } from '../components/header.tsx'
import { ReachableList } from '../components/ReachableList.tsx'
import { StationBoard, useStar } from '../components/StationBoard.tsx'
import { stationAlerts } from '../lib/alerts.ts'
import { fetchDepartures } from '../lib/api.ts'
import { at, BASE } from '../lib/base.ts'
import { validateDepartures } from '../lib/contract.server.ts'
import { boardState, type ServiceFilter } from '../lib/departures.ts'
import { lineLabel } from '../lib/lineNames.ts'
import {
  boardHref,
  isReachable,
  lineCount,
  platformsText,
  reachableFrom,
  STATIONS,
  type Station,
  stationByKey,
  stationHref,
} from '../lib/network.ts'
import { type DataMode, useAlerts, useFetcher } from '../lib/queries.ts'
import { pageMeta, stationJsonLd, stationMeta } from '../lib/seo.ts'
import { loaderEnv, settle, siteInfo } from '../lib/server.server.ts'
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
    via: VIA_NETWORK,
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

/**
 * BrisbaneTransit: the alert count in the board header, linking to the train alerts (THE-118 PR 3: Alerts left the
 * section bar). Mounted only in that build, so the standalone site makes no extra request.
 */
function StationAlerts({ station, mode, nowMs }: { station: Station; mode: DataMode; nowMs: number }) {
  const data = useCurrentAlerts(useAlerts(useFetcher(mode), mode, null))
  const count = data ? stationAlerts(data.alerts, station, Math.floor(nowMs / 1000)).length : null
  return (
    <AlertCountLink
      count={count}
      href={at('/alerts')}
      renderLink={({ href, className, children }) => (
        <Link to={href} prefetch="intent" className={className}>
          {children}
        </Link>
      )}
    />
  )
}

export default function StationPage({ loaderData }: Route.ComponentProps) {
  const { station, to, outbound, inbound, mode, renderedAt } = loaderData
  const nowMs = useNow(renderedAt, 1000)
  const navigate = useNavigate()
  const [filter, setFilter] = useState<ServiceFilter>('all')
  // "Depart from" (the Now ▾ chip, THE-118 PR 5): null is now, which the loader's rows are for.
  const [departAt, setDepartAt] = useState<number | null>(null)
  const [picker, setPicker] = useState(false)
  const [latest, setLatest] = useState<DeparturesResponse | undefined>(outbound ?? undefined)
  const onData = useCallback((r: DeparturesResponse | undefined) => r && setLatest(r), [])
  const page = usePageCheck()
  const src = sourceTimeS(latest, { nowMs, ...page })
  // Reset the filter when moving between stations.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the trip.
  useEffect(() => setFilter('all'), [station.key, to?.key])
  const title = `${station.name}${to ? ` → ${to.name}` : ''}`
  // The star saves the board as it is: the station, with "Going to" when set (THE-118 PR 1).
  const star = useStar({ from: station.key, to: to?.key ?? null }, title, () => setPicker(true))
  // With a destination, ⇄ flips the direction (phones have no return board beside it).
  const reverse = to && isReachable(to.key, station.key) ? to : null
  const lines = lineCount(station.key)
  const go = (k: string | null) => {
    setPicker(false)
    navigate(boardHref(station.key, k))
  }

  // The header pill follows the boards: from the loader data until each StationBoard reports (useReportLive).
  const seeded = [outbound, to ? inbound : null].every((r) => !r || boardState(r, false, nowMs, page) == null)
  return (
    // No outbound answer from the loader (it timed out): BrisbaneTransit says "Connecting…", not LIVE (THE-118).
    <Shell active="stations" live={seeded} pending={!outbound}>
      <div className={to && inbound ? 'flex flex-col gap-2.5' : 'mx-auto flex max-w-2xl flex-col gap-2.5'}>
        <BoardHeader
          kicker="Train station"
          as="h2"
          name={station.name}
          facts={[
            platformsText(station.platforms.map((p) => p.code)),
            lines ? `${lines} line${lines === 1 ? '' : 's'}` : null,
            BASE ? <StationAlerts key="alerts" station={station} mode={mode} nowMs={nowMs} /> : null,
          ]}
          star={<StarButton saved={star.saved} onToggle={star.toggle} name={title} />}
        >
          <FilterRow label="Filter trains">
            <Chip pressed={filter === 'all'} onClick={() => setFilter('all')}>
              All
            </Chip>
            <Chip opens on={!!to} onClick={() => setPicker(true)}>
              {to ? `To ${to.name}` : 'Going to…'}
            </Chip>
            {reverse ? (
              <Chip
                icon="swap"
                label="Swap direction"
                onClick={() => navigate(boardHref(reverse.key, station.key))}
              />
            ) : null}
            <Chip pressed={filter === 'express'} onClick={() => setFilter('express')}>
              Express
            </Chip>
            <Link to={`${at('/map')}?station=${station.key}`} className={chipClass()}>
              <Icon name="map" size={18} />
              Map
            </Link>
            <NowChip value={departAt} onChange={setDepartAt} nowMs={nowMs} />
          </FilterRow>
        </BoardHeader>
        <UpdatedStrip
          board
          updated={
            <>
              Updated{' '}
              <strong className="text-aqua-text dark:text-ferry-aqua-light">
                {formatClock(Math.floor((latest?.generatedAt ?? renderedAt) / 1000))}
              </strong>
            </>
          }
          detail={src ? formatAge(src, nowMs) : undefined}
        />
        <div className={to && inbound ? 'grid grid-cols-1 gap-5 md:grid-cols-2' : undefined}>
          <StationBoard
            key={`${station.key}:${to?.key ?? ''}`}
            from={station}
            to={to}
            initial={outbound}
            nowMs={nowMs}
            mode={mode}
            filter={filter}
            onData={onData}
            at={departAt}
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
                at={departAt}
                returnBoard
                alerts={BASE ? <StationAlerts station={to} mode={mode} nowMs={nowMs} /> : undefined}
              />
            </div>
          ) : null}
        </div>
      </div>
      {star.toast}
      <DestinationSheet
        open={picker}
        onClose={() => setPicker(false)}
        title={`Going to, from ${station.name}`}
        note="Only stations with a direct train are shown."
        onAny={to ? () => go(null) : undefined}
      >
        <ReachableList from={station} selected={to?.key ?? null} onPick={go} />
      </DestinationSheet>
      <StationAbout station={station} />
    </Shell>
  )
}
