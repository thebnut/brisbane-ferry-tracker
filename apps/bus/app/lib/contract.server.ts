/** Server-side contract validation for /v1 and /data (zod stays out of the browser bundle). */
import {
  AlertsResponse,
  DeparturesResponse,
  ErrorResponse,
  TripResponse,
  VehiclesResponse,
} from '@bft/core/contract'
import { z } from 'zod'
import { ApiError, type Validate } from './api.ts'
import { dataSchemaForPath, LinesFile, RouteFile, StopIndexFile } from './data-contract.ts'

export function validator<S extends z.ZodType>(schema: S, what: string): Validate<z.infer<S>> {
  return (body) => {
    const parsed = schema.safeParse(body)
    if (!parsed.success) throw new ApiError('contract', `${what} failed the contract`)
    return parsed.data
  }
}

export const validateDepartures = validator(DeparturesResponse, 'departures')
export const validateTrip = validator(TripResponse, 'trip')
export const validateAlerts = validator(AlertsResponse, 'alerts')
export const validateLines = validator(LinesFile, 'lines')
export const validateRoute = validator(RouteFile, 'route')

const isStr = (v: unknown): v is string => typeof v === 'string'
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * Every StopIndexEntry field, checked by hand: zod over 12k entries costs tens of ms, too much for the Workers Free
 * 10 ms CPU budget on a proxied copy (normally the file is a static asset and never reaches the Worker). Same rules
 * as the zod schema, which the unit tests also run on the whole file.
 */
export function isStopEntry(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false
  const s = e as Record<string, unknown>
  if (!isStr(s.key) || !isStr(s.name) || !isNum(s.lat) || !isNum(s.lon)) return false
  if (s.code !== undefined && !isStr(s.code)) return false
  if (!Array.isArray(s.routes) || !s.routes.every(isStr)) return false
  if (s.platforms !== undefined) {
    if (!Array.isArray(s.platforms)) return false
    for (const p of s.platforms as unknown[]) {
      const q = p as Record<string, unknown> | null
      if (!q || !isStr(q.id) || (q.code !== undefined && !isStr(q.code))) return false
    }
  }
  return true
}

export const FastStopIndex = StopIndexFile.extend({ stops: z.array(z.unknown()) }).refine(
  (f) => f.stops.every(isStopEntry),
  'stop entries',
)

/** Schema for a proxied path, or null when the path has no contract (passed through untouched). */
export function schemaForPath(pathname: string): z.ZodType | null {
  if (/^\/v1\/[a-z]+\/stops\/[^/]+\/departures$/.test(pathname)) return DeparturesResponse
  if (/^\/v1\/[a-z]+\/trips\/[^/]+$/.test(pathname)) return TripResponse
  if (/^\/v1\/[a-z]+\/vehicles$/.test(pathname)) return VehiclesResponse
  if (pathname === '/v1/alerts') return AlertsResponse
  if (/\/data\/bus\/stops\.json$/.test(pathname)) return FastStopIndex
  return dataSchemaForPath(pathname)
}

/**
 * Validate a proxied response. 2xx bodies must match the contract (else 502 contract_mismatch); error bodies on
 * /v1 must be an ErrorResponse. Headers (cache-control from the API) are kept.
 */
export async function validateProxied(pathname: string, res: Response): Promise<Response> {
  const schema = schemaForPath(pathname)
  if (!schema) return res
  const headers = new Headers(res.headers)
  headers.delete('content-length')
  headers.delete('content-encoding')
  headers.delete('set-cookie')
  if (!res.ok && pathname.startsWith('/data/')) return new Response(null, { status: res.status, headers })
  let body: unknown
  try {
    body = await res.json()
  } catch {
    return Response.json({ error: 'contract_mismatch', detail: 'invalid JSON' }, { status: 502 })
  }
  const ok = res.ok ? schema.safeParse(body).success : ErrorResponse.safeParse(body).success
  if (!ok) {
    return Response.json(
      { error: 'contract_mismatch', detail: `${pathname} did not match the contract` },
      { status: 502, headers: { 'cache-control': 'no-store' } },
    )
  }
  headers.set('content-type', 'application/json; charset=utf-8')
  return new Response(JSON.stringify(body), { status: res.status, headers })
}
