/**
 * Train stations on the map picker (P3), lazy from the station search (/stations). The 150-odd stations ship with the
 * app (network.ts), so nothing loads but the map and, on a tap, the station's next trains. Save is a favourite
 * station with no destination (storage.ts, unchanged), Open the station board.
 */
import { type PickerStop, writeMapPref } from '@bft/ui/stop-picker'
import StopPickerMap, { type CardDeparture, useWide } from '@bft/ui/stop-picker-map'
import { useCallback, useEffect, useState } from 'react'
import { Link, useRouteLoaderData } from 'react-router'
import { fetchDepartures } from '../lib/api.ts'
import { lineLabel } from '../lib/lineNames.ts'
import { cleanStopName } from '../lib/names.ts'
import { lineFor, STATIONS, stationHref } from '../lib/network.ts'
import { useFetcher } from '../lib/queries.ts'
import { type Favourite, readFavourites, sameFavourite, toggleFavourite } from '../lib/storage.ts'

const platformsText = (codes: string[]) =>
  codes.length === 0
    ? undefined
    : codes.length === 1
      ? `Platform ${codes[0]}`
      : `Platforms ${codes.join(', ')}`

const STOPS: PickerStop[] = STATIONS.map((s) => ({
  id: s.key,
  name: s.name,
  lat: s.lat,
  lon: s.lon,
  detail: platformsText([...new Set(s.platforms.map((p) => p.code).filter(Boolean))]),
}))

export default function StationPicker({
  slot,
  onClose,
  notice,
  onRetry,
}: {
  slot: 'wide' | 'narrow'
  onClose: () => void
  /** The page's "couldn't load the station list" line with its Try again, which the sheet covers on phones. */
  notice?: string | null
  onRetry?: (() => void) | null
}) {
  const wide = useWide()
  const root = useRouteLoaderData('root') as { fixtures?: boolean } | undefined
  const [mode] = useState(() => ({ fixtures: root?.fixtures === true, rt: null }))
  const fetcher = useFetcher(mode)
  // Both layout slots mount a picker (only one shows), so read the store fresh whenever this one starts showing and
  // on every toggle: a stale snapshot must never overwrite favourites saved from the other (Codex review).
  const [favourites, setFavourites] = useState(readFavourites)
  const showing = wide === (slot === 'wide')
  useEffect(() => {
    if (showing) setFavourites(readFavourites())
  }, [showing])
  const loadDepartures = useCallback(
    (s: PickerStop, signal: AbortSignal) =>
      fetchDepartures(fetcher, s.id, null, { limit: 3, signal }).then((r) =>
        r.departures.map(
          (d): CardDeparture => ({
            id: d.tripInstance,
            route: lineLabel(lineFor(d.route, d.headsign).name),
            headsign: cleanStopName(d.headsign),
            dep: d.estDep ?? d.schedDep,
            platform: d.platform,
          }),
        ),
      ),
    [fetcher],
  )
  if (!showing) return null
  const fav = (s: PickerStop): Favourite => ({ from: s.id, to: null })
  const isSaved = (s: PickerStop) => favourites.some((f) => sameFavourite(f, fav(s)))
  const picker = (
    <StopPickerMap
      title="Train stations"
      noun="station"
      shape="square"
      stops={STOPS}
      zoom={13}
      notice={notice}
      onRetry={onRetry}
      loadDepartures={loadDepartures}
      renderOpen={(s, className) => (
        <Link to={stationHref(s.id)} className={className}>
          Open
        </Link>
      )}
      save={{
        label: (s) => (isSaved(s) ? 'Saved' : 'Save'),
        pressed: isSaved,
        onClick: (s) => {
          const f = fav(s)
          const adding = !readFavourites().some((x) => sameFavourite(x, f))
          setFavourites(toggleFavourite(readFavourites(), f))
          // Only a save storage kept (R27-S1).
          if (adding && readFavourites().some((x) => sameFavourite(x, f)))
            window.__bftGa?.saveStop('train', f.from)
        },
      }}
      onClose={() => {
        writeMapPref(false)
        onClose()
      }}
    />
  )
  return wide ? <div className="h-[70vh] min-w-0 flex-1">{picker}</div> : picker
}
