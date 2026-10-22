/** TanStack Query hooks: 15 s polling while the page is visible (paused when hidden), offline fallback. */
import type { AlertsResponse, DeparturesResponse } from '@bft/core/contract'
import {
  asOfflineCopy,
  bestOfflineCopy,
  dropDeparted,
  isNetworkAnswer,
  isOnline,
  type LiveState,
  liveState,
  type OfflineCopy,
  type PageCheck,
  pollEvery,
  replacesBoard,
  seedUpdatedAt,
  timetableStatus,
} from '@bft/ui/connectivity'
import { QueryClient, type QueryFunctionContext, useQueries, useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import {
  type ApiFetcher,
  browserFetcher,
  fetchAlerts,
  fetchDepartures,
  fetchLines,
  fetchStopIndex,
  OFFLINE_LIMIT,
} from './api.ts'
import { readOffline, writeOffline } from './storage.ts'

export const POLL_MS = 15_000
/** Live data polling, backing off while calls fail (@bft/ui pollEvery). */
export const poll = pollEvery(POLL_MS)
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
  /** Only this route's departures (the stop page's ?route=). */
  route?: string,
) {
  const queryKey = ['bus', 'departures', mode.fixtures, mode.rt, stopId, route] as const
  return {
    queryKey,
    queryFn: async ({ signal, client }: QueryFunctionContext<typeof queryKey>): Promise<Board> => {
      // The board on screen: offline, it may be fresher than any cached copy.
      const shown = client.getQueryData<Board>(queryKey)
      try {
        const res = await fetchDepartures(fetcher, stopId, { signal, route })
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
    initialDataUpdatedAt: seedUpdatedAt(initial),
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
  /** usePageCheck(): data that came with a cached page isn't live (R2-T7), and how old page data is (R15-S1). */
  page: PageCheck | null = null,
): { data: DeparturesResponse | undefined; state: LiveState } {
  // A board built offline (Board.offline) stays offline in liveState until its own network answer replaces it.
  const state = liveState(res, { offline: !online, nowMs, ...page })
  if (!res || state == null) return { data: res, state }
  if (state === 'offline') return { data: asOfflineTimetable(stopId, res, nowMs, res) ?? res, state }
  return { data: asTimetable(res, nowMs, state), state }
}

export function useDepartures(
  fetcher: ApiFetcher,
  mode: DataMode,
  stopId: string,
  initial: DeparturesResponse | null,
  route?: string,
) {
  return useQuery(departuresOptions(fetcher, mode, stopId, initial, route))
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
 * after hydration) and kept for the session; the service worker keeps it across visits. The fuzzy search code
 * (search.ts with uFuzzy) loads alongside it, so it isn't on any page's first load either.
 */
export function useStopIndex(fetcher: ApiFetcher, mode: DataMode, enabled: boolean) {
  const [search, setSearch] = useState<typeof import('./search.ts') | null>(null)
  // A search chunk that can't load (offline before it was cached) is an error, retried when the browser is back
  // online, never an endless "Loading stops…" (Codex review).
  const [searchFailed, setSearchFailed] = useState(false)
  useEffect(() => {
    if (!enabled || search) return
    if (searchFailed) {
      const retry = () => setSearchFailed(false)
      window.addEventListener('online', retry)
      return () => window.removeEventListener('online', retry)
    }
    let live = true
    import('./search.ts').then(
      (m) => live && setSearch(m),
      () => live && setSearchFailed(true),
    )
    return () => {
      live = false
    }
  }, [enabled, search, searchFailed])
  const q = useQuery({
    queryKey: ['bus', 'stop-index', mode.fixtures],
    queryFn: ({ signal }) => fetchStopIndex(fetcher, signal),
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    retry: 1,
  })
  const index = useMemo(
    () => (q.data && search ? search.buildSearchIndex(q.data.stops) : null),
    [q.data, search],
  )
  const byKey = useMemo(() => new Map((q.data?.stops ?? []).map((s) => [s.key, s])), [q.data])
  const retry = () => {
    setSearchFailed(false)
    if (q.isError) q.refetch()
  }
  return { ...q, isError: q.isError || searchFailed, retry, index, byKey, searchStops: search?.searchStops }
}

/** The bus /data lists one screen can show failing together: stop search, route search, map tiles (R16-D1). */
const LISTS = new Set(['stop-index', 'route-index', 'lines', 'geo'])

/**
 * Refetches every failed bus /data list on screen (still observed) that isn't already loading, so one Try again brings
 * back all of them; a list that fails again keeps its own notice. Through an observer, like the list's own retry: a
 * list whose notice still shows may be disabled by now (the route search's long names after the query changed), which
 * `refetchQueries` would skip (Codex review). Never the /v1 live queries, which keep their own backoff. The stop
 * index's search code is retried by useStopIndex's own `retry`, so call that first.
 */
export async function retryFailedLists(client: QueryClient): Promise<void> {
  const failed = client.getQueryCache().findAll({
    predicate: (q) =>
      q.queryKey[0] === 'bus' &&
      LISTS.has(String(q.queryKey[1])) &&
      q.state.status === 'error' &&
      q.state.fetchStatus === 'idle',
  })
  await Promise.all(failed.map((q) => q.observers[0]?.refetch()))
}

export function useLines(fetcher: ApiFetcher, mode: DataMode, enabled = true) {
  return useQuery({
    queryKey: ['bus', 'lines', mode.fixtures],
    queryFn: ({ signal }) => fetchLines(fetcher, { signal }),
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
  })
}
