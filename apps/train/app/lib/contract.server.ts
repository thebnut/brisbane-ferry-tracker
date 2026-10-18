/** Server-side /v1 contract validation (zod stays out of the browser bundle). */
import {
  AlertsResponse,
  DeparturesResponse,
  ErrorResponse,
  TripResponse,
  VehiclesResponse,
} from '@bft/core/contract'
import type { z } from 'zod'
import { ApiError, type Validate } from './api.ts'

export function validator<S extends z.ZodType>(schema: S, what: string): Validate<z.infer<S>> {
  return (body) => {
    const parsed = schema.safeParse(body)
    if (!parsed.success) throw new ApiError('contract', `${what} failed the /v1 contract`)
    return parsed.data
  }
}

export const validateDepartures = validator(DeparturesResponse, 'departures')
export const validateTrip = validator(TripResponse, 'trip')
export const validateAlerts = validator(AlertsResponse, 'alerts')

/** Schema for a proxied /v1 path, or null when the path has no contract (passed through untouched). */
export function schemaForPath(pathname: string): z.ZodType | null {
  if (/^\/v1\/[a-z]+\/stops\/[^/]+\/departures$/.test(pathname)) return DeparturesResponse
  if (/^\/v1\/[a-z]+\/trips\/[^/]+$/.test(pathname)) return TripResponse
  if (/^\/v1\/[a-z]+\/vehicles$/.test(pathname)) return VehiclesResponse
  if (pathname === '/v1/alerts') return AlertsResponse
  return null
}

/**
 * Validate a proxied API response. 2xx bodies must match the contract (else 502 contract_mismatch); error bodies
 * must be an ErrorResponse. Headers (cache-control from the API) are kept.
 */
export async function validateProxied(pathname: string, res: Response): Promise<Response> {
  const schema = schemaForPath(pathname)
  if (!schema) return res
  const headers = new Headers(res.headers)
  headers.delete('content-length')
  headers.delete('content-encoding')
  headers.delete('set-cookie')
  let body: unknown
  try {
    body = await res.json()
  } catch {
    return Response.json({ error: 'contract_mismatch', detail: 'invalid JSON' }, { status: 502 })
  }
  const ok = res.ok ? schema.safeParse(body).success : ErrorResponse.safeParse(body).success
  if (!ok) {
    return Response.json(
      { error: 'contract_mismatch', detail: `${pathname} did not match the /v1 contract` },
      { status: 502, headers: { 'cache-control': 'no-store' } },
    )
  }
  headers.set('content-type', 'application/json; charset=utf-8')
  return new Response(JSON.stringify(body), { status: res.status, headers })
}
