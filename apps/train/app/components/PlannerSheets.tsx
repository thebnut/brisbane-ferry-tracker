/**
 * The train planner's sheets (@bft/ui/planner-sheets) with the train's places: every station A to Z, the landmarks
 * (@bft/core/landmarks) resolved to the station to get off at, and for the start the closest stations once the position
 * is known, each marked "direct" or "change at …" for the chosen destination. Its own chunk, loaded when a sheet first
 * opens, so the landmark list is never on /train's first load.
 */
import { type Landmark, matchLandmarks } from '@bft/core/landmarks'
import { formatDistance, type GeoState } from '@bft/ui'
import { DestinationPicker, StartPicker } from '@bft/ui/planner-sheets'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { BASE } from '../lib/base.ts'
import { closestStations, planTrip } from '../lib/journey.ts'
import { STATIONS, type Station, stationByKey } from '../lib/network.ts'

const AZ = [...STATIONS].sort((a, b) => a.name.localeCompare(b.name))
const renderLink = ({
  href,
  className,
  children,
}: {
  href: string
  className: string
  children: ReactNode
}) => (
  <Link to={href} className={className}>
    {children}
  </Link>
)

/**
 * The Ferry tab's planner with that terminal as To, in BrisbaneTransit (never its board, which lists departures *from*
 * it: the confusion the planner fixes, Codex review); the standalone train site has no ferry pages.
 */
const ferryHref = (slug: string) => (BASE ? `/ferry/?plan=to&to=${slug}` : undefined)
/** The ferry terminals the landmarks name, by slug (no ferry data in the train app). */
const FERRY_NAMES: Record<string, string> = {
  'qut-gardens-point': 'QUT Gardens Point',
  'south-bank': 'South Bank',
  'howard-smith-wharves': 'Howard Smith Wharves',
  'northshore-hamilton': 'Northshore Hamilton',
  'new-farm-park': 'New Farm Park',
  'holman-street': 'Holman Street',
  'uq-st-lucia': 'UQ St Lucia',
}

const either = (list: readonly string[]) =>
  list.length < 2 ? (list[0] ?? '') : `${list.slice(0, -1).join(', ')} or ${list[list.length - 1]}`

/** A landmark as a destination-sheet card: the station to get off at, or, not near a train, the better way. */
export function landmarkResult(l: Landmark) {
  const stations = l.train.map((s) => stationByKey(s.key)).filter((s): s is Station => !!s)
  const first = stations[0]
  if (first) {
    const more = stations.slice(1).map((s) => s.name)
    const walk = l.walk?.train ? ` · ${l.walk.train}` : ''
    return {
      key: l.id,
      name: l.name,
      text: `Get off at ${first.name} for ${l.short ?? l.name}${more.length ? ` (or ${either(more)})` : ''}${walk}`,
      pick: first.key,
      hint: `for ${l.short ?? l.name}`,
    }
  }
  const slug = l.ferry[0]
  const ferry = l.ferry.length ? `Take the ferry to ${either(l.ferry.map((s) => FERRY_NAMES[s] ?? s))}.` : ''
  const href = slug ? ferryHref(slug) : undefined
  return {
    key: l.id,
    name: l.name,
    text: ['Not near a train station.', l.bus, ferry].filter(Boolean).join(' '),
    href,
    linkText: href && slug ? `Plan a ferry trip to ${FERRY_NAMES[slug] ?? slug}` : undefined,
  }
}

export default function PlannerSheets({
  sheet,
  onClose,
  from,
  to,
  geo,
  locate,
  onPickTo,
  onPickFrom,
}: {
  sheet: 'from' | 'to' | null
  onClose: (which: 'from' | 'to') => void
  from: Station | null
  to: Station | null
  geo: GeoState
  locate: () => void
  onPickTo: (key: string, hint?: string | null) => void
  onPickFrom: (key: string) => void
}) {
  const towards = (s: Station) => {
    if (!to || s.key === to.key) return null
    const p = planTrip(s.key, to.key)
    return p.kind === 'direct' ? 'direct' : p.kind === 'change' ? `change at ${p.via.name}` : null
  }
  const here = geo.state === 'ok' ? geo : null
  const closest = here
    ? closestStations(here.lat, here.lon)
        .filter((c) => c.station.key !== to?.key)
        .map((c) => ({
          id: c.station.key,
          name: c.station.name,
          detail: formatDistance(c.metres),
          tag: towards(c.station),
        }))
    : null
  return (
    <>
      <DestinationPicker
        open={sheet === 'to'}
        onClose={() => onClose('to')}
        what="stations"
        options={AZ.map((s) => ({ id: s.key, name: s.name }))}
        selected={to?.key ?? null}
        results={(q) => matchLandmarks(q).map(landmarkResult)}
        onPick={(key, r) => onPickTo(key, r?.hint)}
        renderLink={renderLink}
      />
      {/* Only while open: "direct or change" for every station is worked out from the stopping patterns. */}
      <StartPicker
        open={sheet === 'from'}
        onClose={() => onClose('from')}
        goingTo={to ? to.name : null}
        what="station"
        locate={{ state: geo.state, onLocate: locate }}
        closest={closest}
        options={AZ.filter((s) => s.key !== to?.key).map((s) => ({
          id: s.key,
          name: s.name,
          tag: sheet === 'from' ? towards(s) : null,
        }))}
        selected={from?.key ?? null}
        onPick={onPickFrom}
      />
    </>
  )
}
