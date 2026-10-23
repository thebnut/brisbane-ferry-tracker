/**
 * The board's alert count beside Map. BrisbaneFerry has no alerts page, so nothing here; BrisbaneTransit swaps this
 * module for its own (apps/transit/modes.config.ts, THE-118 PR 3), which links to its Alerts. Loaded after hydration
 * (FerryBoards.tsx), never on the first load.
 */

import type { ApiFetcher } from '../lib/api.ts'
import type { DataMode } from '../lib/queries.ts'

/** The board's own fetcher and data mode, so the count needs no API client of its own. */
export interface BoardAlertsProps {
  fetcher: ApiFetcher
  mode: DataMode
}

export default function BoardAlerts(_: BoardAlertsProps) {
  return null
}
