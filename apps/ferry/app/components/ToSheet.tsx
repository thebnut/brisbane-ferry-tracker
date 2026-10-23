/**
 * The ferry board's "To…" sheet (THE-118 PR 5): Train's "Going to" sheet (@bft/ui/destination-sheet) with the terminals
 * this one reaches directly. Its own lazy chunk, off the board's first load.
 */
import { DestinationChoices, DestinationSheet } from '@bft/ui/destination-sheet'
import { cleanStopName } from '../lib/names.ts'
import { type StopChoice, TERMINALS } from '../lib/terminals.ts'

export default function ToSheet({
  from,
  to,
  onPick,
  onClose,
}: {
  from: StopChoice
  to: StopChoice | null
  /** A terminal, or null for any destination. */
  onPick: (id: string | null) => void
  onClose: () => void
}) {
  const reach = new Set(TERMINALS.find((t) => t.id === from.id)?.destinations)
  const options = TERMINALS.filter((t) => reach.has(t.id))
    .map((t) => ({ id: t.id, name: cleanStopName(t.name) }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const name = cleanStopName(from.name)
  return (
    <DestinationSheet
      open
      onClose={onClose}
      title={`To, from ${name}`}
      note="Only terminals with a direct ferry are shown."
      onAny={to ? () => onPick(null) : undefined}
    >
      <DestinationChoices
        label={`Terminals with a direct ferry from ${name}`}
        options={options}
        selected={to?.id ?? null}
        onPick={onPick}
      />
    </DestinationSheet>
  )
}
