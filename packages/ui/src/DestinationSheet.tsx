/**
 * The board's destination sheet (THE-118 PR 5): Train's "Going to…" sheet, which Ferry's "To…" chip opens too. A
 * bottom sheet with "Any destination" when one is set, then the places reachable directly: the mode's own list
 * (train's stations by line), or `DestinationChoices`. Its own entry (`@bft/ui/destination-sheet`), so a board that
 * opens it lazily keeps it off its first load.
 */
import type { ReactNode } from 'react'
import { BottomSheet } from './BottomSheet.tsx'
import { SecondaryButton } from './board.tsx'
import { cx } from './cx.ts'

export function DestinationSheet({
  open,
  onClose,
  title,
  note,
  onAny,
  children,
}: {
  open: boolean
  onClose: () => void
  /** "Going to, from Central". */
  title: string
  /** "Only stations with a direct train are shown." */
  note: string
  /** Clears the destination; offered only when one is set. */
  onAny?: () => void
  children: ReactNode
}) {
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={title}
      subtitle={<span className="text-xs text-sched-text dark:text-night-text/70">{note}</span>}
    >
      <div className="flex flex-col gap-3 px-4 py-4">
        {onAny ? (
          <SecondaryButton className="min-h-11 self-start px-4 text-sm" onClick={onAny}>
            Any destination
          </SecondaryButton>
        ) : null}
        {children}
      </div>
    </BottomSheet>
  )
}

/** A plain list of places to pick from (ferry terminals), the chosen one pressed. */
export function DestinationChoices({
  label,
  options,
  selected,
  onPick,
}: {
  label: string
  options: Array<{ id: string; name: string }>
  selected: string | null
  onPick: (id: string) => void
}) {
  return (
    <ul aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => (
        <li key={o.id}>
          <button
            type="button"
            onClick={() => onPick(o.id)}
            aria-pressed={selected === o.id}
            className={cx(
              'min-h-11 rounded-full border px-4 text-sm font-semibold',
              selected === o.id
                ? 'border-ferry-orange-aa bg-ferry-orange-aa text-white'
                : 'border-[#EADBD2] bg-[#F7F2EF] text-charcoal hover:border-ferry-orange dark:border-night-2 dark:bg-night-2 dark:text-night-text',
            )}
          >
            {o.name}
          </button>
        </li>
      ))}
    </ul>
  )
}
