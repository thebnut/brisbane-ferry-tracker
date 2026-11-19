/**
 * Ferry home's journey planner (@bft/ui/planner): From (the nearest open terminal once the device's position is known,
 * else "Choose start"), To (Popular chips, the destination sheet with landmark search, or the last destination on this
 * device), swap, and the answer: the from-to board for a direct ferry, else where to change (ChangePlan, one change at
 * most). Picking the last of the two opens the board when a direct ferry runs; otherwise the answer shows here.
 * The sheets and the change panel are their own chunks, loaded when needed.
 */
import type { GeoState } from '@bft/ui'
import { PlanLink, PlannerCard } from '@bft/ui/planner'
import { lazy, type ReactNode, Suspense, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import {
  closedNote,
  isDirect,
  nearestStart,
  planTrip,
  popularTerminals,
  readLastTo,
  writeLastTo,
} from '../lib/journey.ts'
import { cleanStopName } from '../lib/names.ts'
import type { DataMode } from '../lib/queries.ts'
import { boardHref, type Terminal, terminalById, terminalBySlug } from '../lib/terminals.ts'
import type PlannerSheets from './PlannerSheets.tsx'

const ChangePlan = lazy(() => import('./ChangePlan.tsx'))

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
  <Link to={href} className={className} prefetch="intent">
    {children}
  </Link>
)

export default function Planner({
  nowMs,
  geo,
  locate,
  mode,
  initialTo,
  initialFrom = null,
}: {
  nowMs: number
  geo: GeoState
  locate: () => void
  mode: DataMode
  /** "Plan a trip there" (`?plan=to&to=<slug>`): the destination, in the server render too. */
  initialTo: string | null
  /** A board's "Somewhere else?" (`?plan=from&start=<slug>`): the start, then To opens. */
  initialFrom?: string | null
}) {
  const navigate = useNavigate()
  const [fromId, setFromId] = useState<string | null>(() => terminalBySlug(initialFrom ?? '')?.id ?? null)
  const [toId, setToId] = useState<string | null>(() => terminalBySlug(initialTo ?? '')?.id ?? null)
  const [toHint, setToHint] = useState<string | null>(null)
  const [sheet, setSheet] = useState<'from' | 'to' | null>(null)
  const [Sheets, setSheets] = useState<typeof PlannerSheets | null>(null)
  // After hydration: the last destination on this device, unless the link named one or a start (then To opens).
  // biome-ignore lint/correctness/useExhaustiveDependencies: once on mount.
  useEffect(() => {
    if (initialFrom && terminalBySlug(initialFrom)) open('to')
    else if (!initialTo) setToId((id) => id ?? readLastTo()?.id ?? null)
  }, [])

  const here = geo.state === 'ok' ? geo : null
  const nearest = !fromId && here ? nearestStart(here.lat, here.lon, toId, nowMs) : null
  const from = terminalById(fromId ?? '') ?? nearest
  const to = terminalById(toId ?? '')

  const open = (which: 'from' | 'to') => {
    setSheet(which)
    if (!Sheets)
      import('./PlannerSheets.tsx').then(
        (m) => setSheets(() => m.default),
        () => setSheet(null), // Offline before the chunk was cached: nothing opens; the next tap tries again.
      )
  }

  /** Both ends known by a pick: a direct ferry opens its board; otherwise the answer shows on the card. */
  const settle = (f: Terminal | null, t: Terminal | null) => {
    if (f && t && isDirect(f.id, t.id) && !closedNote(f.id, nowMs) && !closedNote(t.id, nowMs)) {
      setSheet(null)
      navigate(boardHref(f.id, t.id))
    } else if (t && !f) setSheet('from')
    else setSheet(null)
  }

  /** `hint`: the landmark it came from ("for Eat Street"). */
  const pickTo = (id: string, hint?: string | null) => {
    const t = terminalById(id)
    if (!t) return
    setToId(t.id)
    setToHint(hint ?? null)
    writeLastTo(t.slug)
    // The nearest start may change with the destination (the closest with a direct ferry there).
    const f = terminalById(fromId ?? '') ?? (here ? nearestStart(here.lat, here.lon, t.id, nowMs) : null)
    if (!f) open('from')
    else settle(f, t)
  }

  const pickFrom = (id: string) => {
    const f = terminalById(id)
    if (!f) return
    setFromId(f.id)
    if (to) settle(f, to)
    else setSheet(null)
  }

  const swap = () => {
    if (!from || !to) return
    setFromId(to.id)
    setToId(from.id)
    setToHint(null)
    writeLastTo(from.slug)
  }

  const plan = from && to ? planTrip(from.id, to.id, nowMs) : null
  const closed = [from, to].find((t) => t && closedNote(t.id, nowMs))
  return (
    <>
      <PlannerCard
        from={
          from
            ? {
                name: name(from),
                hint: closedNote(from.id, nowMs) ?? (fromId ? null : 'Nearest terminal'),
              }
            : null
        }
        to={to ? { name: name(to), hint: closedNote(to.id, nowMs) ?? toHint } : null}
        fromEmpty="Choose start"
        toEmpty="Pick a terminal"
        onFrom={() => open('from')}
        onTo={() => open('to')}
        onSwap={from && to ? swap : undefined}
        popular={popularTerminals(nowMs).map((t) => ({ id: t.id, name: name(t) }))}
        onPopular={(id) => pickTo(id)}
      >
        {!from || !to || !plan ? null : closed ? (
          <p data-plan="closed" className="text-sm text-gray-700 dark:text-night-text/80">
            {name(closed)} is closed for works. TransLink has no services there in the current timetable.
          </p>
        ) : plan.kind === 'same' ? (
          <p data-plan="same" className="text-sm text-gray-700 dark:text-night-text/80">
            You're already there. Pick another destination.
          </p>
        ) : plan.kind === 'direct' ? (
          <PlanLink href={boardHref(from.id, to.id)} renderLink={renderLink}>
            Ferries to {name(to)}
          </PlanLink>
        ) : plan.kind === 'change' ? (
          <Suspense
            fallback={
              <p data-plan="change" className="text-sm font-semibold">
                No direct ferry. Change at {name(plan.via)}.
              </p>
            }
          >
            <ChangePlan from={from} via={plan.via} to={to} nowMs={nowMs} mode={mode} />
          </Suspense>
        ) : (
          <p data-plan="none" className="text-sm text-gray-700 dark:text-night-text/80">
            No ferry goes from {name(from)} to {name(to)} with one change. Try starting from another terminal.
          </p>
        )}
      </PlannerCard>
      {Sheets ? (
        <Sheets
          sheet={sheet}
          onClose={() => setSheet(null)}
          from={from}
          to={to}
          nowMs={nowMs}
          geo={geo}
          locate={locate}
          onPickTo={pickTo}
          onPickFrom={pickFrom}
        />
      ) : null}
    </>
  )
}
