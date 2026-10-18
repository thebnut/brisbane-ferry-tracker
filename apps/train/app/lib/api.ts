/**
 * Typed /v1 client. Responses are validated against the @bft/core zod contract on the server, before any UI sees
 * them: in SSR loaders (contract.server.ts) and in the Worker's same-origin /v1 proxy (workers/app.ts), which
 * answers 502 when the API drifts from the contract. The browser bundle carries only the contract's types, not zod.
 */
import type { AlertsResponse, DeparturesResponse, TripResponse, VehiclesResponse } from '@bft/core/contract'
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

/** Fetches a /v1 path (starting with "/v1/") and returns the Response. */
export type ApiFetcher = (path: string, init?: { signal?: AbortSignal }) => Promise<Response>

/** Validates a parsed body, throwing on contract failure. Identity in the browser (the proxy validated it). */
export type Validate<T> = (body: unknown) => T

const trusted = <T>(body: unknown) => body as T

/** Browser fetcher: same-origin /v1 proxy, or the fixture API under /__fixtures. */
export function browserFetcher(opts: { fixtures: boolean; rt?: string | null }): ApiFetcher {
  return (path, init) => {
    let url = opts.fixtures ? `/__fixtures${path}` : path
    if (opts.fixtures && opts.rt) url += `${url.includes('?') ? '&' : '?'}rt=${encodeURIComponent(opts.rt)}`
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

export const DEPARTURE_LIMIT = 12

export function departuresPath(
  from: string,
  to: string | null,
  opts: { limit?: number; at?: number | null } = {},
) {
  const q = new URLSearchParams()
  if (to) q.set('to', to)
  q.set('limit', String(opts.limit ?? DEPARTURE_LIMIT))
  if (opts.at) q.set('at', String(opts.at))
  return `/v1/train/stops/${encodeURIComponent(from)}/departures?${q}`
}

export const fetchDepartures = (
  fetcher: ApiFetcher,
  from: string,
  to: string | null,
  opts: {
    limit?: number
    at?: number | null
    signal?: AbortSignal
    validate?: Validate<DeparturesResponse>
  } = {},
) => getJson(fetcher, departuresPath(from, to, opts), opts.validate, opts.signal)

export const fetchTrip = (
  fetcher: ApiFetcher,
  tripInstance: string,
  opts: { signal?: AbortSignal; validate?: Validate<TripResponse> } = {},
) => getJson(fetcher, `/v1/train/trips/${encodeURIComponent(tripInstance)}`, opts.validate, opts.signal)

export const fetchVehicles = (fetcher: ApiFetcher, signal?: AbortSignal) =>
  getJson<VehiclesResponse>(fetcher, '/v1/train/vehicles', undefined, signal)

export const fetchAlerts = (
  fetcher: ApiFetcher,
  opts: { signal?: AbortSignal; validate?: Validate<AlertsResponse> } = {},
) => getJson(fetcher, '/v1/alerts?mode=train', opts.validate, opts.signal)
