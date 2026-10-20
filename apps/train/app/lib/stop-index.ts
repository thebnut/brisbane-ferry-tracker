/**
 * The station index file (data/train/stops.json) for the /stations search. Optional: the stations ship with the app
 * (network.ts), so the page works without it. A plain fetch, not the tracked one, so a failure here never marks the
 * app offline. Anything but a 200 with a stop list throws: an error body (the edge's 503 `{ error }` when R2 is slow)
 * must never become the query's data, where `.stops.map` would take the page down to the error boundary.
 */
import type { StopIndexFile } from '@bft/core/contract'

export const STOP_INDEX_PATH = '/data/train/stops.json'

export async function fetchStationIndex(
  signal?: AbortSignal,
  fetchFn: typeof fetch = fetch,
): Promise<StopIndexFile> {
  const res = await fetchFn(STOP_INDEX_PATH, { signal, headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${STOP_INDEX_PATH}`)
  const body = (await res.json()) as { stops?: unknown } | null
  // Each entry too (~150 stations): the page reads key and name off every one.
  const ok = (s: unknown) =>
    typeof (s as { key?: unknown } | null)?.key === 'string' &&
    typeof (s as { name?: unknown }).name === 'string'
  if (!Array.isArray(body?.stops) || !body.stops.every(ok))
    throw new Error(`No stop list in ${STOP_INDEX_PATH}`)
  return body as StopIndexFile
}
