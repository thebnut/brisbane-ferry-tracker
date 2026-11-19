/**
 * The ferry planner's sheets (@bft/ui/planner-sheets) with the ferry's places: every terminal A to Z with its routes,
 * the landmarks (@bft/core/landmarks) resolved to the terminal to get off at, and for the start the closest terminals
 * once the position is known, each marked "direct" or "change at …" for the chosen destination. Its own chunk, loaded
 * when a sheet first opens, so the landmark list is never on /ferry's first load.
 */
import { type Landmark, matchLandmarks } from '@bft/core/landmarks'
import type { GeoState } from '@bft/ui'
import { formatDistance } from '@bft/ui'
import { DestinationPicker, StartPicker } from '@bft/ui/planner-sheets'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { BASE } from '../lib/base.ts'
import { closedNote, closestTerminals, planTrip } from '../lib/journey.ts'
import { cleanStopName } from '../lib/names.ts'
import { TERMINALS, type Terminal, terminalBySlug } from '../lib/terminals.ts'

const name = (t: Terminal) => cleanStopName(t.name)
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
const AZ = [...TERMINALS].sort((a, b) => name(a).localeCompare(name(b)))

/**
 * The Train tab's planner with that station as To, in BrisbaneTransit (never its board, which lists departures *from*
 * it: the confusion the planner fixes, Codex review of #227); the standalone ferry site has no train pages.
 */
const trainHref = (key: string) => (BASE ? `/train/?plan=to&to=${key}` : undefined)

const either = (list: readonly string[]) =>
  list.length < 2 ? (list[0] ?? '') : `${list.slice(0, -1).join(', ')} or ${list[list.length - 1]}`

/** A landmark as a destination-sheet card: the terminal to get off at, or, not near a ferry, the better way. */
export function landmarkResult(l: Landmark) {
  const ferries = l.ferry.map((s) => terminalBySlug(s)).filter((t): t is Terminal => !!t)
  const first = ferries[0]
  if (first) {
    const more = ferries.slice(1).map(name)
    const walk = l.walk?.ferry ? ` · ${l.walk.ferry}` : ''
    return {
      key: l.id,
      name: l.name,
      text: `Get off at ${name(first)} for ${l.short ?? l.name}${more.length ? ` (or ${either(more)})` : ''}${walk}`,
      pick: first.id,
      hint: `for ${l.short ?? l.name}`,
    }
  }
  const station = l.train[0]
  const train = l.train.length
    ? `Take the train to ${either(l.train.map((s) => s.name))}${l.walk?.train ? `, ${l.walk.train}` : ''}.`
    : ''
  const href = station ? trainHref(station.key) : undefined
  return {
    key: l.id,
    name: l.name,
    text: ['Not near a ferry terminal.', l.bus, train].filter(Boolean).join(' '),
    href,
    linkText: href && station ? `Plan a train trip to ${station.name}` : undefined,
  }
}

export default function PlannerSheets({
  sheet,
  onClose,
  from,
  to,
  nowMs,
  geo,
  locate,
  onPickTo,
  onPickFrom,
}: {
  sheet: 'from' | 'to' | null
  onClose: (which: 'from' | 'to') => void
  from: Terminal | null
  to: Terminal | null
  nowMs: number
  geo: GeoState
  locate: () => void
  onPickTo: (id: string, hint?: string | null) => void
  onPickFrom: (id: string) => void
}) {
  const towards = (t: Terminal) => {
    if (!to || t.id === to.id || closedNote(t.id, nowMs)) return null
    const p = planTrip(t.id, to.id, nowMs)
    return p.kind === 'direct' ? 'direct' : p.kind === 'change' ? `change at ${name(p.via)}` : null
  }
  const here = geo.state === 'ok' ? geo : null
  const closest = here
    ? closestTerminals(here.lat, here.lon, nowMs)
        .filter((c) => c.terminal.id !== to?.id)
        .map((c) => ({
          id: c.terminal.id,
          name: name(c.terminal),
          detail: formatDistance(c.metres),
          tag: towards(c.terminal),
        }))
    : null
  return (
    <>
      <DestinationPicker
        open={sheet === 'to'}
        onClose={() => onClose('to')}
        what="terminals"
        options={AZ.map((t) => ({
          id: t.id,
          name: name(t),
          tag: t.routes.join(' · '),
          detail: closedNote(t.id, nowMs),
        }))}
        selected={to?.id ?? null}
        results={(q) => matchLandmarks(q).map(landmarkResult)}
        onPick={(id, from) => onPickTo(id, from?.hint)}
        renderLink={renderLink}
      />
      <StartPicker
        open={sheet === 'from'}
        onClose={() => onClose('from')}
        goingTo={to ? name(to) : null}
        what="terminal"
        locate={{ state: geo.state, onLocate: locate }}
        closest={closest}
        options={AZ.filter((t) => t.id !== to?.id).map((t) => ({
          id: t.id,
          name: name(t),
          tag: towards(t),
          detail: closedNote(t.id, nowMs),
        }))}
        selected={from?.id ?? null}
        onPick={onPickFrom}
      />
    </>
  )
}
