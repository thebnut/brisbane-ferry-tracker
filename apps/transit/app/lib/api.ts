/**
 * Typed /v1 and /data client for the transit pages. Responses are contract-checked on the server before the browser
 * sees them (the Worker's same-origin proxy, contract.server.ts), so the browser bundle carries only types, not zod.
 */
import type { AlertsResponse, DeparturesResponse, GeoTileFile, Mode, StopIndexFile } from '@bft/core/contract'
import { trackedFetch } from '@bft/ui/connectivity'

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

/** Fetches a same-origin path (starting with "/v1/" or "/data/"). */
export type ApiFetcher = (path: string, init?: { signal?: AbortSignal }) => Promise<Response>
export type Validate<T> = (body: unknown) => T
const trusted = <T>(body: unknown) => body as T

/** Browser fetcher: the same-origin proxy, or the fixture API under /__fixtures. */
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
    body = await res.json()
  } catch {
    throw new ApiError('contract', `Invalid JSON from ${path}`)
  }
  return validate(body)
}

export const departuresPath = (
  mode: Mode,
  key: string,
  opts: { to?: string | null; limit?: number } = {},
) => {
  const q = new URLSearchParams({ limit: String(opts.limit ?? 3) })
  if (opts.to) q.set('to', opts.to)
  return `/v1/${mode}/stops/${encodeURIComponent(key)}/departures?${q}`
}

export const fetchDepartures = (
  fetcher: ApiFetcher,
  mode: Mode,
  key: string,
  opts: {
    to?: string | null
    limit?: number
    signal?: AbortSignal
    validate?: Validate<DeparturesResponse>
  } = {},
) => getJson(fetcher, departuresPath(mode, key, opts), opts.validate, opts.signal)

/** Every mode's alerts in one response (the API's /v1/alerts without a mode filter). */
export const fetchAlerts = (
  fetcher: ApiFetcher,
  opts: { signal?: AbortSignal; validate?: Validate<AlertsResponse> } = {},
) => getJson(fetcher, '/v1/alerts', opts.validate, opts.signal)

/** A geohash-5 tile; a cell with no stops has no file (404), which is an empty tile, not an error. */
export async function fetchGeoTile(fetcher: ApiFetcher, mode: Mode, geohash: string, signal?: AbortSignal) {
  try {
    return await getJson<GeoTileFile>(fetcher, `/data/${mode}/geo/${geohash}.json`, undefined, signal)
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null
    throw error
  }
}

export const fetchStopIndex = (fetcher: ApiFetcher, mode: Mode, signal?: AbortSignal) =>
  getJson<StopIndexFile>(fetcher, `/data/${mode}/stops.json`, undefined, signal)
