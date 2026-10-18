/** Train-only alert helpers that need the train network file (loaded on demand, see alerts.ts). */

import type { Alert } from '@bft/core/contract'
import { linesOfAlert } from '@bft/train/app/lib/alerts.ts'
import { lineLabel } from '@bft/train/app/lib/lineNames.ts'
import { platformOf, stationByKey } from '@bft/train/app/lib/network.ts'

export const trainLinesOf = (a: Alert): string[] => linesOfAlert(a).map(lineLabel)
/** Is this stop id a train platform? (alerts.ts stopModeOf) */
export const isTrainPlatform = (stopId: string) => platformOf(stopId) != null
export const platformsOf = (station: string | null): string[] =>
  stationByKey(station)?.platforms.map((p) => p.id) ?? []
