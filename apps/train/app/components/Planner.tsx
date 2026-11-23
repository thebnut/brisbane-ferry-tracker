/**
 * Train home's journey planner (@bft/ui/planner, as Ferry's): From (the nearest station once the device's position is
 * known, else "Choose start"), To (Popular chips, the destination sheet with landmark search, or the last destination
 * on this device), swap, and the answer: the station board with that destination for a direct train, else where to
 * change (one change at most), with a link to each leg's board. Picking the last of the two opens the board when a
 * direct train runs. The sheets are their own chunk, loaded when first opened.
 */
import type { GeoState } from '@bft/ui'
import { PlanLink, PlannerCard } from '@bft/ui/planner'
import { type ReactNode, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { isDirect, nearestStart, POPULAR_TO, planTrip, readLastTo, writeLastTo } from '../lib/journey.ts'
import { boardHref, type Station, stationByKey } from '../lib/network.ts'
import type PlannerSheets from './PlannerSheets.tsx'

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

const LEG =
  'flex min-h-12 items-center justify-between gap-3 rounded-card bg-white px-3 py-2 text-[15px] font-bold text-inherit no-underline shadow-card dark:bg-night-2'

export default function Planner({
  geo,
  locate,
  initialTo,
  initialFrom = null,
}: {
  geo: GeoState
  locate: () => void
  /** "Plan a trip there" (`?plan=to&to=<key>`): the destination, in the server render too. */
  initialTo: string | null
  /** A board's "Somewhere else?" (`?plan=from&start=<key>`): the start, then To opens. */
  initialFrom?: string | null
}) {
  const navigate = useNavigate()
  const [fromKey, setFromKey] = useState<string | null>(() => stationByKey(initialFrom)?.key ?? null)
  const [toKey, setToKey] = useState<string | null>(() => stationByKey(initialTo)?.key ?? null)
  const [toHint, setToHint] = useState<string | null>(null)
  const [sheet, setSheet] = useState<'from' | 'to' | null>(null)
  const [Sheets, setSheets] = useState<typeof PlannerSheets | null>(null)

  const open = (which: 'from' | 'to') => {
    setSheet(which)
    if (!Sheets)
      import('./PlannerSheets.tsx').then(
        (m) => setSheets(() => m.default),
        () => setSheet(null), // Offline before the chunk was cached: nothing opens; the next tap tries again.
      )
  }
  // After hydration: the last destination on this device, unless the link named one or a start (then To opens).
  // biome-ignore lint/correctness/useExhaustiveDependencies: once on mount.
  useEffect(() => {
    if (stationByKey(initialFrom)) open('to')
    else if (!initialTo) setToKey((k) => k ?? readLastTo()?.key ?? null)
  }, [])

  const here = geo.state === 'ok' ? geo : null
  const from = stationByKey(fromKey) ?? (here ? nearestStart(here.lat, here.lon, toKey) : null)
  const to = stationByKey(toKey)

  /** Both ends known by a pick: a direct train opens its board; otherwise the answer shows on the card. */
  const settle = (f: Station | null, t: Station | null) => {
    if (f && t && isDirect(f.key, t.key)) {
      setSheet(null)
      navigate(boardHref(f.key, t.key))
    } else if (t && !f) setSheet('from')
    else setSheet(null)
  }

  /** `hint`: the landmark it came from ("for Suncorp Stadium"). */
  const pickTo = (key: string, hint?: string | null) => {
    const t = stationByKey(key)
    if (!t) return
    setToKey(t.key)
    setToHint(hint ?? null)
    writeLastTo(t.key)
    const f = stationByKey(fromKey) ?? (here ? nearestStart(here.lat, here.lon, t.key) : null)
    if (!f) open('from')
    else settle(f, t)
  }

  const pickFrom = (key: string) => {
    const f = stationByKey(key)
    if (!f) return
    setFromKey(f.key)
    if (to) settle(f, to)
    else setSheet(null)
  }

  const swap = () => {
    if (!from || !to) return
    setFromKey(to.key)
    setToKey(from.key)
    setToHint(null)
    writeLastTo(from.key)
  }

  const plan = from && to ? planTrip(from.key, to.key) : null
  return (
    <>
      <PlannerCard
        from={from ? { name: from.name, hint: fromKey ? null : 'Nearest station' } : null}
        to={to ? { name: to.name, hint: toHint } : null}
        fromEmpty="Choose start"
        toEmpty="Pick a station"
        onFrom={() => open('from')}
        onTo={() => open('to')}
        onSwap={from && to ? swap : undefined}
        popular={POPULAR_TO.map((k) => stationByKey(k))
          .filter((s): s is Station => !!s)
          .map((s) => ({ id: s.key, name: s.name }))}
        onPopular={(key) => pickTo(key)}
      >
        {!from || !to || !plan ? null : plan.kind === 'same' ? (
          <p data-plan="same" className="text-sm text-gray-700 dark:text-night-text/80">
            You're already there. Pick another destination.
          </p>
        ) : plan.kind === 'direct' ? (
          <PlanLink href={boardHref(from.key, to.key)} renderLink={renderLink}>
            Trains to {to.name}
          </PlanLink>
        ) : plan.kind === 'change' ? (
          <div data-plan="change" className="flex flex-col gap-2">
            <p className="text-sm font-semibold">
              No direct train. Change at <strong>{plan.via.name}</strong>.
            </p>
            <ol
              className="flex flex-col gap-2"
              aria-label={`${from.name} to ${to.name}, changing at ${plan.via.name}`}
            >
              <li>
                <Link to={boardHref(from.key, plan.via.key)} className={LEG} data-leg="1">
                  <span>
                    1. {from.name} → {plan.via.name}
                  </span>
                  <span className="shrink-0 text-sm text-aqua-text dark:text-ferry-aqua-light">Board ›</span>
                </Link>
              </li>
              <li>
                <Link to={boardHref(plan.via.key, to.key)} className={LEG} data-leg="2">
                  <span>
                    2. {plan.via.name} → {to.name}
                  </span>
                  <span className="shrink-0 text-sm text-aqua-text dark:text-ferry-aqua-light">Board ›</span>
                </Link>
              </li>
            </ol>
          </div>
        ) : (
          <p data-plan="none" className="text-sm text-gray-700 dark:text-night-text/80">
            No train goes from {from.name} to {to.name} with one change. Try starting from another station.
          </p>
        )}
      </PlannerCard>
      {Sheets ? (
        <Sheets
          sheet={sheet}
          // Only the sheet still open: a sheet's close event arrives after the next one opened (To, then From).
          onClose={(which) => setSheet((s) => (s === which ? null : s))}
          from={from}
          to={to}
          geo={geo}
          locate={locate}
          onPickTo={pickTo}
          onPickFrom={pickFrom}
        />
      ) : null}
    </>
  )
}
