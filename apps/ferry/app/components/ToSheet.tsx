/**
 * The ferry board's "Where are you going from here?" sheet (THE-118 PR 5): Train's "Going to" sheet
 * (@bft/ui/destination-sheet) with the terminals this one reaches directly, and for anywhere else the ferry home's
 * planner from here (it finds where to change). Its own lazy chunk, off the board's first load.
 */
import { DestinationChoices, DestinationSheet } from '@bft/ui/destination-sheet'
import { Link } from 'react-router'
import { closedNote } from '../lib/journey.ts'
import { cleanStopName } from '../lib/names.ts'
import { planHref, type StopChoice, TERMINALS } from '../lib/terminals.ts'

export default function ToSheet({
  open,
  from,
  to,
  onPick,
  onClose,
}: {
  open: boolean
  from: StopChoice
  to: StopChoice | null
  /** A terminal, or null for any destination. */
  onPick: (id: string | null) => void
  onClose: () => void
}) {
  const here = TERMINALS.find((t) => t.id === from.id)
  const reach = new Set(here?.destinations)
  // A terminal closed for works has no ferries to offer (Codex release review): left out, as the planner leaves it out.
  const nowMs = Date.now()
  const options = TERMINALS.filter((t) => reach.has(t.id) && !closedNote(t.id, nowMs))
    .map((t) => ({ id: t.id, name: cleanStopName(t.name) }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const name = cleanStopName(from.name)
  return (
    <DestinationSheet
      open={open}
      onClose={onClose}
      title={`Where are you going from ${name}?`}
      note="Only terminals with a direct ferry are shown."
      onAny={to ? () => onPick(null) : undefined}
    >
      <DestinationChoices
        label={`Terminals with a direct ferry from ${name}`}
        options={options}
        selected={to?.id ?? null}
        onPick={onPick}
      />
      {here ? (
        <p className="text-sm text-sched-text dark:text-night-text/80">
          Somewhere else?{' '}
          <Link
            to={planHref('from', here.slug)}
            className="font-bold text-aqua-text no-underline hover:underline dark:text-ferry-aqua-light"
          >
            Plan a trip with a change ›
          </Link>
        </p>
      ) : null}
    </DestinationSheet>
  )
}
