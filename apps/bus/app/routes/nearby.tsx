/**
 * /nearby: stops around you without a server (ADR-0004). Your position picks a geohash-5 tile; that tile and its 8
 * neighbours are fetched from data/bus/geo/ and sorted by haversine distance, so stops just across a tile edge
 * still appear. The position never leaves the browser. `?lat=&lon=` sets a position (links, tests).
 */
import { EmptyState, Icon, PrimaryButton, SkeletonRows, StopResultCard, useGeolocation } from '@bft/ui'
import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router'
import { resultMeta } from '../components/SearchPanel.tsx'
import { BusNav, DesktopNav, Footer, SiteHeader, UpdatedStrip } from '../components/Shell.tsx'
import { linkRenderer } from '../components/StopBoard.tsx'
import { at } from '../lib/base.ts'
import {
  formatDistance,
  geohashEncode,
  geohashNeighbourhood,
  nearest,
  positionFromParams,
} from '../lib/geo.ts'
import { useApi } from '../lib/mode.ts'
import { useGeoTiles, useStopIndex } from '../lib/queries.ts'
import { pageMeta, SITE_URL } from '../lib/seo.ts'
import { stopHref } from '../lib/stops.ts'
import { useNow } from '../lib/useNow.ts'
import type { Route } from './+types/nearby'

export const meta: Route.MetaFunction = () =>
  pageMeta({
    title: 'Bus stops near me - live departures | BrisbaneBus',
    description: 'Find the Brisbane bus stops nearest to you and their next buses.',
    url: `${SITE_URL}/nearby`,
  })

export const NEARBY_LIMIT = 20
export const NEARBY_MAX_M = 2000

export default function Nearby() {
  const [params] = useSearchParams()
  const { geo, locate } = useGeolocation(positionFromParams(params))
  const { mode, fetcher } = useApi()
  const now = useNow(Date.now(), 60_000)
  const cells = useMemo(
    () => (geo.state === 'ok' ? geohashNeighbourhood(geohashEncode(geo.lat, geo.lon, 5)) : []),
    [geo],
  )
  const tiles = useGeoTiles(fetcher, mode, cells)
  const { byKey } = useStopIndex(fetcher, mode, geo.state === 'ok')
  const stops = useMemo(() => {
    if (geo.state !== 'ok') return []
    return nearest(
      geo.lat,
      geo.lon,
      tiles.tiles.flatMap((t) => t.stops),
      { limit: NEARBY_LIMIT, maxMetres: NEARBY_MAX_M },
    )
  }, [geo, tiles.tiles])

  return (
    <>
      <SiteHeader />
      <UpdatedStrip updatedAt={null} sourceS={null} nowMs={now}>
        <DesktopNav active="nearby" />
      </UpdatedStrip>
      <main className="mx-auto flex max-w-3xl flex-col gap-3 px-4 pt-3.5 pb-28">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-xl font-extrabold">Stops near you</h1>
          {geo.state === 'ok' ? (
            <Link
              to={`${at('/map')}?lat=${geo.lat.toFixed(5)}&lon=${geo.lon.toFixed(5)}`}
              className="flex h-9 items-center gap-1.5 rounded-full border border-ferry-orange/20 bg-white px-3 text-sm font-semibold text-aqua-text dark:bg-night-card dark:text-ferry-aqua-light"
            >
              <Icon name="map" size={16} />
              Map
            </Link>
          ) : null}
        </div>
        {geo.state === 'idle' || geo.state === 'locating' ? (
          <section className="flex flex-col items-start gap-3 rounded-card bg-white/90 p-4 shadow-card dark:bg-night-card">
            <p className="flex items-center gap-2 font-semibold">
              <Icon name="nearby" size={20} className="text-ferry-orange-dark" />
              Find the bus stops around you
            </p>
            <p className="text-sm text-gray-700 dark:text-night-text/80">
              Your browser will ask to share your location. It's used on this device only, to pick the nearby
              stops; it is never sent to us.
            </p>
            <PrimaryButton onClick={locate} disabled={geo.state === 'locating'}>
              {geo.state === 'locating' ? 'Finding you…' : 'Use my location'}
            </PrimaryButton>
          </section>
        ) : null}
        {geo.state === 'denied' ? (
          <EmptyState title="Location is turned off for this site">
            Allow location for this site in your browser settings, or{' '}
            <Link to={at('/')} className="font-semibold underline">
              search by stop name or number
            </Link>
            .
          </EmptyState>
        ) : null}
        {geo.state === 'unavailable' ? (
          <EmptyState title="We couldn't find your location">
            <button type="button" className="font-semibold underline" onClick={locate}>
              Try again
            </button>{' '}
            or{' '}
            <Link to={at('/')} className="font-semibold underline">
              search for a stop
            </Link>
            .
          </EmptyState>
        ) : null}
        {geo.state === 'ok' ? (
          tiles.loading && stops.length === 0 ? (
            <SkeletonRows count={4} label="Finding stops…" />
          ) : tiles.error && stops.length === 0 ? (
            <EmptyState title="Couldn't load nearby stops">Check your connection and try again.</EmptyState>
          ) : stops.length === 0 ? (
            <EmptyState title="No bus stops within 2 km">
              <Link to={at('/')} className="font-semibold underline">
                Search for a stop
              </Link>{' '}
              instead.
            </EmptyState>
          ) : (
            <ul className="flex flex-col gap-2.5" aria-label="Nearby stops">
              {stops.map((s, i) => {
                const full = byKey.get(s.key)
                return (
                  <StopResultCard
                    key={s.key}
                    name={s.name}
                    meta={resultMeta(full ?? { ...s, routes: [] })}
                    platform={full?.platforms?.[0]?.code}
                    routes={full?.routes ?? []}
                    distance={formatDistance(s.metres)}
                    best={i === 0}
                    href={stopHref(s.key)}
                    renderLink={linkRenderer}
                  />
                )
              })}
            </ul>
          )
        ) : null}
      </main>
      <Footer />
      <BusNav active="nearby" />
    </>
  )
}
