/**
 * One saved ferry trip on ferry home (THE-118 PR 8): its next departures (a few rows, polled like a board), judged
 * like a board (timetable only unless live and fresh), reported to the page header, as a My Transit card.
 */
import type { DeparturesResponse } from '@bft/core/contract'
import { awaitingSeedAnswer, type LiveState, usePageCheck } from '@bft/ui/connectivity'
import { type HomeCard, homeCard, useReportLive } from '@bft/ui/mode-home'
import { boardState, visibleRows } from './departures.ts'
import { cleanStopName } from './names.ts'
import { type DataMode, useDepartures, useFetcher } from './queries.ts'
import { boardHref, terminalById } from './terminals.ts'
import { useOnline } from './useNow.ts'

export interface Trip {
  from: string
  to: string | null
}

/** Rows a card asks for: the next departure and the two after it, with room for departed ones. */
export const CARD_ROWS = 5

const name = (id: string) => cleanStopName(terminalById(id)?.name ?? '')
export const tripTitle = (t: Trip) => (t.to ? `${name(t.from)} → ${name(t.to)}` : name(t.from))

export function useTripCard(
  trip: Trip,
  initial: DeparturesResponse | null,
  nowMs: number,
  mode: DataMode,
): { card: HomeCard; href: string; empty: string | null; loading: boolean; state: LiveState } {
  const fetcher = useFetcher(mode)
  const q = useDepartures(fetcher, mode, trip.from, trip.to ?? '', null, initial, true, CARD_ROWS)
  const online = useOnline()
  const page = usePageCheck()
  const state = boardState(q.data, !online, nowMs, page)
  // A card with no answer yet, or a non-live seed whose own refetch is out, waits (R32-RT1).
  useReportLive(
    `ferry:${trip.from}>${trip.to ?? ''}`,
    state == null && q.data != null,
    (!q.data && !q.isError) || awaitingSeedAnswer(q, state),
    q.isError || q.failureCount > 0,
  )
  const data = q.data && { ...q.data, departures: visibleRows(q.data.departures, state, nowMs) }
  const card = homeCard('ferry', data, nowMs, tripTitle(trip), trip.from)
  return {
    card,
    href: boardHref(trip.from, trip.to),
    state,
    loading: q.isPending,
    empty: q.isPending
      ? 'Getting live departures…'
      : q.isError && !q.data
        ? "Live times aren't loading. Open the board for the timetable."
        : card.time
          ? null
          : state === 'offline'
            ? 'Offline: no saved timetable with times to come.'
            : 'No more departures today.',
  }
}
