/**
 * Server-side contract checks for everything the transit Worker proxies (zod stays out of the browser bundle):
 * /v1 responses and the client data files against @bft/core/contract, and /v1/ask against AskResponse below.
 */
import {
  AlertsResponse,
  DeparturesResponse,
  ErrorResponse,
  GeoTileFile,
  LinesFile,
  TripResponse,
  VehiclesResponse,
} from '@bft/core/contract'
import { FastStopIndex } from '@bft/bus/app/lib/contract.server.ts'
import { z } from 'zod'
import { ApiError, type Validate } from './api.ts'

export function validator<S extends z.ZodType>(schema: S, what: string): Validate<z.infer<S>> {
  return (body) => {
    const parsed = schema.safeParse(body)
    if (!parsed.success) throw new ApiError('contract', `${what} failed the contract`)
    return parsed.data
  }
}

export const validateDepartures = validator(DeparturesResponse, 'departures')
export const validateAlerts = validator(AlertsResponse, 'alerts')

/** /v1/ask (bft-api feat/p8-ai-layer routes.ts): mirrors app/lib/ask.ts. Extra fields (intent) pass through. */
export const AskResponse = z.looseObject({
  schemaVersion: z.literal(1),
  question: z.string(),
  normalized: z.string(),
  source: z.enum(['cache', 'deterministic', 'llm', 'fallback']),
  answer: z.string(),
  departures: z
    .array(
      z.object({
        tripInstance: z.string(),
        route: z.string(),
        headsign: z.string(),
        platform: z.string().nullable(),
        departs: z.string(),
        inMinutes: z.number(),
        arrives: z.string().nullable(),
        status: z.enum(['scheduled', 'live', 'skipped', 'cancelled', 'unknown']),
      }),
    )
    .optional(),
  ai: z.object({ enabled: z.boolean(), reason: z.string().optional() }).optional(),
  rounds: z.number().optional(),
  costUsd: z.number().optional(),
})

const DATA = /^\/data\/(ferry|train|bus)\//

/** Schema for a proxied path, or null when the path has no contract (passed through untouched). */
export function schemaForPath(pathname: string): z.ZodType | null {
  if (/^\/v1\/[a-z]+\/stops\/[^/]+\/departures$/.test(pathname)) return DeparturesResponse
  if (/^\/v1\/[a-z]+\/trips\/[^/]+$/.test(pathname)) return TripResponse
  if (/^\/v1\/[a-z]+\/vehicles$/.test(pathname)) return VehiclesResponse
  if (pathname === '/v1/alerts') return AlertsResponse
  if (pathname === '/v1/ask') return AskResponse
  if (DATA.test(pathname)) {
    // Bus stops.json is 12k entries: checked by hand within the Workers CPU budget (apps/bus contract.server.ts).
    if (pathname.endsWith('/stops.json')) return FastStopIndex
    if (pathname.endsWith('/lines.json')) return LinesFile
    if (/\/geo\/[0-9b-hjkmnp-z]{5}\.json$/.test(pathname)) return GeoTileFile
  }
  return null
}

/** An error body: the API's ErrorResponse, or /v1/ask's hint body (403 turnstile_failed) which is an AskResponse. */
const isErrorBody = (pathname: string, body: unknown) =>
  ErrorResponse.safeParse(body).success || (pathname === '/v1/ask' && AskResponse.safeParse(body).success)

/**
 * Validate a proxied API response. 2xx bodies must match the contract (else 502 contract_mismatch); error bodies
 * must be an ErrorResponse. Headers (cache-control from the API) are kept.
 */
export async function validateProxied(pathname: string, res: Response): Promise<Response> {
  const schema = schemaForPath(pathname)
  if (!schema) return res
  // A missing tile or stop is a plain 404; the client treats it as "no stops here".
  if (res.status === 404 && DATA.test(pathname)) return new Response('Not found', { status: 404 })
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
  const ok = res.ok ? schema.safeParse(body).success : isErrorBody(pathname, body)
  if (!ok) {
    return Response.json(
      { error: 'contract_mismatch', detail: `${pathname} did not match the contract` },
      { status: 502, headers: { 'cache-control': 'no-store' } },
    )
  }
  headers.set('content-type', 'application/json; charset=utf-8')
  return new Response(JSON.stringify(body), { status: res.status, headers })
}
