/**
 * Typed /v1 and /data client. Responses are validated against the zod contracts on the server before any UI sees
 * them: in SSR loaders (contract.server.ts) and in the Worker's same-origin /v1 and /data proxy (workers/app.ts),
 * which answers 502 when the API drifts from the contract. The browser bundle carries only the types, not zod.
 */
import type { AlertsResponse, DeparturesResponse } from '@bft/core/contract'
import { noteCacheCopy, trackedFetch } from '@bft/ui/connectivity'
import type { LinesFile, RouteFile, RouteIndexFile, StopIndexFile } from './data-contract.ts'

export type ApiErrorKind = 'network' | 'http' | 'contract'

export class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly status: number | undefined
  constructor(kind: ApiErrorKind, message: string, status?: number) {
    super(message)
    this.name = 'ApiError'
    this.kind = kind
    this.status = status
  }
}

/** Fetches a same-origin path (starting with "/v1/" or "/data/") and returns the Response. */
export type ApiFetcher = (path: string, init?: { signal?: AbortSignal }) => Promise<Response>

/** Validates a parsed body, throwing on contract failure. Identity in the browser (the proxy validated it). */
export type Validate<T> = (body: unknown) => T

const trusted = <T>(body: unknown) => body as T

/** Browser fetcher: same-origin proxy, or the fixture API under /__fixtures. */
export function browserFetcher(opts: { fixtures: boolean; rt?: string | null }): ApiFetcher {
  return (path, init) => {
    let url = opts.fixtures ? `/__fixtures${path}` : path
    if (opts.fixtures && opts.rt && path.startsWith('/v1/'))
      url += `${url.includes('?') ? '&' : '?'}rt=${encodeURIComponent(opts.rt)}`
    return trackedFetch(url, { signal: init?.signal, headers: { accept: 'application/json' } })
  }
}

export async function getJson<T>(
  fetcher: ApiFetcher,
  path: string,
  validate: Validate<T> = trusted,
  signal?: AbortSignal,
): Promise<T> {
  let res: Response
  try {
    res = await fetcher(path, { signal })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new ApiError('network', error instanceof Error ? error.message : String(error))
  }
  if (!res.ok) throw new ApiError('http', `HTTP ${res.status} for ${path}`, res.status)
  let body: unknown
  try {
    body = noteCacheCopy(res, await res.json())
  } catch {
    throw new ApiError('contract', `Invalid JSON from ${path}`)
  }
  return validate(body)
}

export const DEPARTURE_LIMIT = 20
/** A longer list kept for saved stops so they work offline ("Offline · scheduled"). */
export const OFFLINE_LIMIT = 100

/** `route`: only that route's departures, filtered by the API before the limit (the stop page's ?route=). */
export const departuresPath = (stopId: string, limit = DEPARTURE_LIMIT, route?: string) =>
  `/v1/bus/stops/${encodeURIComponent(stopId)}/departures?limit=${limit}${route ? `&route=${encodeURIComponent(route)}` : ''}`

export const fetchDepartures = (
  fetcher: ApiFetcher,
  stopId: string,
  opts: {
    limit?: number
    route?: string
    signal?: AbortSignal
    validate?: Validate<DeparturesResponse>
  } = {},
) => getJson(fetcher, departuresPath(stopId, opts.limit, opts.route), opts.validate, opts.signal)

export const fetchAlerts = (
  fetcher: ApiFetcher,
  opts: { signal?: AbortSignal; validate?: Validate<AlertsResponse> } = {},
) => getJson(fetcher, '/v1/alerts?mode=bus', opts.validate, opts.signal)

export const fetchStopIndex = (fetcher: ApiFetcher, signal?: AbortSignal) =>
  getJson<StopIndexFile>(fetcher, '/data/bus/stops.json', undefined, signal)

export const fetchLines = (
  fetcher: ApiFetcher,
  opts: { signal?: AbortSignal; validate?: Validate<LinesFile> } = {},
) => getJson(fetcher, '/data/bus/lines.json', opts.validate, opts.signal)

export const fetchRoute = (
  fetcher: ApiFetcher,
  short: string,
  opts: { signal?: AbortSignal; validate?: Validate<RouteFile> } = {},
) => getJson(fetcher, `/data/bus/routes/${encodeURIComponent(short)}.json`, opts.validate, opts.signal)

/** The short names of the current routes: a route file whose name is not here is left over from an older feed. */
export const fetchRouteIndex = (
  fetcher: ApiFetcher,
  opts: { signal?: AbortSignal; validate?: Validate<RouteIndexFile> } = {},
) => getJson(fetcher, '/data/bus/routes.json', opts.validate, opts.signal)
