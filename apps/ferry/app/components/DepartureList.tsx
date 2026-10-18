/** One departure board: header strip, cards (5, then up to 13 with "More departures"), empty and error states. */
import type { Departure } from '@bft/core/contract'
import { BoardHeader, DepartureCard, EmptyState, ErrorState, MoreButton } from '@bft/ui'
import { type ReactNode, useState } from 'react'
import { cardModel } from '../lib/departures.ts'

export interface DepartureListProps {
  id: string
  /** Accessible board name, e.g. "Bulimba to Riverside". */
  label: string
  header: ReactNode
  onSwap?: () => void
  trailing?: ReactNode
  departures: Departure[] | null
  nowMs: number
  loading: boolean
  error: boolean
  onRetry: () => void
  onSelect: (d: Departure) => void
}

export function DepartureList({
  id,
  label,
  header,
  onSwap,
  trailing,
  departures,
  nowMs,
  loading,
  error,
  onRetry,
  onSelect,
}: DepartureListProps) {
  const [more, setMore] = useState(false)
  const list = departures ?? []
  const shown = list.slice(0, more ? 13 : 5)
  return (
    <section aria-label={label} className="flex flex-col gap-3" data-board={id}>
      <BoardHeader onSwap={onSwap} trailing={trailing}>
        {header}
      </BoardHeader>
      {departures == null && loading ? (
        <div className="rounded-card bg-white/90 px-4 py-8 text-center shadow-card" role="status">
          <span
            aria-hidden="true"
            className="mx-auto mb-3 block size-10 animate-spin rounded-full border-b-2 border-ferry-orange"
          />
          <span className="text-sched-text">Loading departures…</span>
        </div>
      ) : departures == null && error ? (
        <ErrorState onRetry={onRetry}>Check your connection. We'll keep trying every 15 seconds.</ErrorState>
      ) : list.length === 0 ? (
        <EmptyState title="No upcoming departures found">Services may have finished for today</EmptyState>
      ) : (
        <>
          <ol className="flex flex-col gap-3" aria-label="Departures">
            {shown.map((d) => {
              const { key, ...card } = cardModel(d, nowMs)
              return (
                <li key={key} data-testid="departure">
                  <DepartureCard {...card} onSelect={() => onSelect(d)} />
                </li>
              )
            })}
          </ol>
          {list.length > 5 ? (
            <MoreButton onClick={() => setMore((m) => !m)} aria-expanded={more}>
              {more ? 'Show fewer' : `More departures (${Math.min(list.length - 5, 8)} more)`}
            </MoreButton>
          ) : null}
        </>
      )}
    </section>
  )
}
