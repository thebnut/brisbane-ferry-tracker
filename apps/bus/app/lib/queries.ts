/** TanStack Query hooks: 15 s polling while the page is visible (paused when hidden), offline fallback. */
import type { AlertsResponse, DeparturesResponse, TripResponse } from '@bft/core/contract'
import {
  asOfflineCopy,
  bestOfflineCopy,
  dropDeparted,
  isNetworkAnswer,
  isOnline,
  type LiveState,
  liveState,
  type OfflineCopy,
  pollEvery,
  replacesBoard,
  timetableStatus,
} from '@bft/ui/connectivity'
import { QueryClient, type QueryFunctionContext, useQueries, useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import {
  type ApiFetcher,
  browserFetcher,
  fetchAlerts,
  fetchDepartures,
  fetchGeoTile,
  fetchLines,
  fetchStopIndex,
  fetchTrip,
  fetchVehicles,
  OFFLINE_LIMIT,
} from './api.ts'
import type { GeoTileFile } from './data-contract.ts'
import { buildSearchIndex } from './search.ts'
import { readOffline, writeOffline } from './storage.ts'

export const POLL_MS = 15_000
/** Live data polling, backing off while calls fail (@bft/ui pollEvery). */
const poll = pollEvery(POLL_MS)
const pollAlerts = pollEvery(60_000)
/** Saved stops refresh their offline timetable copy at most this often. */
const OFFLINE_REFRESH_MS = 3 * 3600_000

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Polling stops while the tab is hidden (TanStack's focus manager watches visibilitychange).
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: true,
        retry: 1,
        staleTime: 10_000,
        // Let the service worker's cache answer when the network is down.
        networkMode: 'offlineFirst',
      },
    },
  })
}

export interface DataMode {
  fixtures: boolean
  rt: string | null
}

export function useFetcher(mode: DataMode): ApiFetcher {
  return useMemo(() => browserFetcher(mode), [mode])
}

// Browser only (true during SSR): navigator.onLine, failed API calls and service-worker cache hits (@bft/ui).
const offline = () => !isOnline()

/**
 * Keep a longer timetable for every stop viewed online (saved stops and recent views, storage.ts caps them), so the
 * board still shows scheduled times offline. Without it an unsaved stop had only the 20 rows on screen (R6-B1).
 */
export function refreshOfflineCopy(fetcher: ApiFetcher, stopId: string): Promise<void> {
  // One refresh per stop at a time: an older answer arriving last must not overwrite a newer copy (Codex review).
  let running = refreshing.get(stopId)
  if (!running) {
    running = keepOfflineCopy(fetcher, stopId).finally(() => refreshing.delete(stopId))
    refreshing.set(stopId, running)
  }
  return running
}
const refreshing = new Map<string, Promise<void>>()

async function keepOfflineCopy(fetcher: ApiFetcher, stopId: string): Promise<void> {
  if (offline()) return
  const prev = readOffline(stopId)
  if (prev && Date.now() - prev.savedAt < OFFLINE_REFRESH_MS) return
  try {
    const res = await fetchDepartures(fetcher, stopId, { limit: OFFLINE_LIMIT })
    // Only a network answer, never older than the copy kept now (read again after the fetch): an offline reload can
    // start with navigator.onLine true, and the service worker's old cached answer must not replace the timetable.
    const kept = readOffline(stopId)?.body as { generatedAt?: number } | undefined
    if (!isNetworkAnswer(res) || (kept?.generatedAt != null && res.generatedAt < kept.generatedAt)) return
    writeOffline(stopId, res)
  } catch {
    // Best effort.
  }
}

/** A board built from copies on hand while offline (client only, never from the API). */
export type Board = DeparturesResponse & OfflineCopy

/**
 * Offline view of a stop, as scheduled-only rows (no live estimates or GPS) without departures that have already
 * gone. Of the copies on hand (the given responses, e.g. the board on screen and the service worker's cached answer,
 * and the saved stop's longer timetable copy) it uses the one with the most departures still to come (@bft/ui
 * bestOfflineCopy), so an hours-old cached answer never empties a board that still has rows. Its `generatedAt` stays
 * the copy's own, for the "Updated" time. Copies were contract-checked by the proxy when first fetched.
 */
export function asOfflineTimetable(
  stopId: string,
  res: DeparturesResponse | ReadonlyArray<DeparturesResponse | null | undefined> | null,
  nowMs: number,
  /** The board on screen it replaces, whose server time it keeps (@bft/ui asOfflineCopy). */
  shown: Board | null | undefined,
): Board | null {
  const copy = readOffline(stopId)?.body as DeparturesResponse | undefined
  const base = bestOfflineCopy([...(Array.isArray(res) ? res : [res]), copy], nowMs)
  if (!base) return null
  return asOfflineCopy(asTimetable(base, nowMs, 'unavailable'), shown)
}

/** A response as timetable times only: no live estimates or GPS, nothing that has already left. */
export function asTimetable(
  res: DeparturesResponse,
  nowMs: number,
  rtState: DeparturesResponse['rtState'],
): DeparturesResponse {
  return {
    ...res,
    rtState,
    rtSourceTimestamp: null,
    departures: dropDeparted(res.departures, (d) => d.schedDep, nowMs, false).map((d) => ({
      ...d,
      status: timetableStatus(d.status),
      estDep: null,
      estArrTo: null,
      gps: false,
    })),
  }
}

export function departuresOptions(
  fetcher: ApiFetcher,
  mode: DataMode,
  stopId: string,
  initial: DeparturesResponse | null,
) {
  const queryKey = ['bus', 'departures', mode.fixtures, mode.rt, stopId] as const
  return {
    queryKey,
    queryFn: async ({ signal, client }: QueryFunctionContext<typeof queryKey>): Promise<Board> => {
      // The board on screen: offline, it may be fresher than any cached copy.
      const shown = client.getQueryData<Board>(queryKey)
      try {
        const res = await fetchDepartures(fetcher, stopId, { signal })
        // A network answer, judged on this response (not on the connection flag, which another request may have just
        // cleared) and never older than the server board on screen (R6-B1). Not against the kept timetable: a network
        // answer from the edge cache can be a little older than it (release review).
        if (replacesBoard(res, shown)) {
          void refreshOfflineCopy(fetcher, stopId)
          return res
        }
        // Offline but the service worker answered from its cache (maybe hours old): never show its stale live
        // estimates, and keep the board on screen if it has more departures to come.
        return asOfflineTimetable(stopId, [shown, res], Date.now(), shown) ?? res
      } catch (error) {
        // Offline with no cached response: the board on screen or the saved timetable copy.
        if (offline()) {
          const fallback = asOfflineTimetable(stopId, [shown], Date.now(), shown)
          if (fallback) return fallback
        }
        throw error
      }
    },
    initialData: initial ?? undefined,
    initialDataUpdatedAt: initial?.generatedAt,
    refetchInterval: poll,
  }
}

/**
 * What a stop board shows for a response (shared rule, @bft/ui liveState): live as sent; otherwise timetable times
 * with the state for the banner. Offline uses the saved stop's longer copy. Pure, from `online` (useOnline) and
 * `nowMs` (useNow), so the first client render matches the server HTML even for a page reloaded from the cache.
 */
export function liveView(
  stopId: string,
  res: Board | undefined,
  nowMs: number,
  online: boolean,
  /** useUnconfirmedBefore(): data that came with a cached page isn't live (R2-T7). */
  unconfirmedBefore: number | null = null,
): { data: DeparturesResponse | undefined; state: LiveState } {
  // A board built offline (Board.offline) stays offline in liveState until its own network answer replaces it.
  const state = liveState(res, { offline: !online, nowMs, unconfirmedBefore })
  if (!res || state == null) return { data: res, state }
  if (state === 'offline') return { data: asOfflineTimetable(stopId, res, nowMs, res) ?? res, state }
  return { data: asTimetable(res, nowMs, state), state }
}

export function useDepartures(
  fetcher: ApiFetcher,
  mode: DataMode,
  stopId: string,
  initial: DeparturesResponse | null,
) {
  return useQuery(departuresOptions(fetcher, mode, stopId, initial))
}

export function useManyDepartures(
  fetcher: ApiFetcher,
  mode: DataMode,
  stopIds: string[],
  initial: Record<string, DeparturesResponse | null>,
) {
  return useQueries({
    queries: stopIds.map((id) => departuresOptions(fetcher, mode, id, initial[id] ?? null)),
  })
}

export function useTrip(
  fetcher: ApiFetcher,
  mode: DataMode,
  tripInstance: string,
  initial: TripResponse | null,
) {
  return useQuery({
    queryKey: ['bus', 'trip', mode.fixtures, mode.rt, tripInstance],
    queryFn: ({ signal }) => fetchTrip(fetcher, tripInstance, { signal }),
    initialData: initial ?? undefined,
    initialDataUpdatedAt: initial?.generatedAt,
    refetchInterval: poll,
  })
}

export function useVehicles(fetcher: ApiFetcher, mode: DataMode, route: string | null, enabled = true) {
  return useQuery({
    queryKey: ['bus', 'vehicles', mode.fixtures, mode.rt, route],
    queryFn: ({ signal }) => fetchVehicles(fetcher, route, signal),
    enabled,
    refetchInterval: poll,
  })
}

export function useAlerts(fetcher: ApiFetcher, mode: DataMode, initial: AlertsResponse | null = null) {
  return useQuery({
    queryKey: ['bus', 'alerts', mode.fixtures, mode.rt],
    queryFn: ({ signal }) => fetchAlerts(fetcher, { signal }),
    initialData: initial ?? undefined,
    initialDataUpdatedAt: initial?.generatedAt,
    staleTime: 60_000,
    refetchInterval: pollAlerts,
  })
}

/**
 * The stop search index (data/bus/stops.json, ~300 KB gz), fetched lazily after first paint (`enabled` turns on
 * after hydration) and kept for the session; the service worker keeps it across visits.
 */
export function useStopIndex(fetcher: ApiFetcher, mode: DataMode, enabled: boolean) {
  const q = useQuery({
    queryKey: ['bus', 'stop-index', mode.fixtures],
    queryFn: ({ signal }) => fetchStopIndex(fetcher, signal),
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    retry: 2,
  })
  const index = useMemo(() => (q.data ? buildSearchIndex(q.data.stops) : null), [q.data])
  const byKey = useMemo(() => new Map((q.data?.stops ?? []).map((s) => [s.key, s])), [q.data])
  return { ...q, index, byKey }
}

export function useLines(fetcher: ApiFetcher, mode: DataMode, enabled = true) {
  return useQuery({
    queryKey: ['bus', 'lines', mode.fixtures],
    queryFn: ({ signal }) => fetchLines(fetcher, { signal }),
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
  })
}

/** Geohash tiles (own + neighbours) for nearby. Missing tiles (no stops) resolve to null. */
export function useGeoTiles(fetcher: ApiFetcher, mode: DataMode, geohashes: string[]) {
  const results = useQueries({
    queries: geohashes.map((gh) => ({
      queryKey: ['bus', 'geo', mode.fixtures, gh],
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchGeoTile(fetcher, gh, signal),
      staleTime: Number.POSITIVE_INFINITY,
    })),
  })
  const loading = results.some((r) => r.isPending)
  const error = results.find((r) => r.error)?.error ?? null
  const tiles = results.map((r) => r.data).filter((t): t is GeoTileFile => !!t)
  return { tiles, loading, error }
}
