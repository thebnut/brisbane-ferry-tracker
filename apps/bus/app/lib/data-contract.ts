/**
 * Static client data contract: `data/bus/stops.json`, `data/bus/geo/{geohash5}.json`, `data/bus/lines.json`.
 *
 * These schemas mirror the pipeline's additions to `@bft/core/contract` (branch feat/p1-static-pipeline:
 * StopIndexEntry, StopIndexFile, GeoTileFile, StopPattern, Line, LinesFile) field for field, so the app reads the
 * pipeline's output unchanged. They live here until that branch lands in this stack; then this file becomes a
 * re-export of `@bft/core/contract`. Zod stays server-side (Worker + tests); the browser imports only the types.
 */
import { z } from 'zod'

const Mode = z.enum(['ferry', 'train', 'bus', 'tram'])

export const StopIndexEntry = z.object({
  /** Stop key (train: parent station slug; otherwise stop_id). */
  key: z.string(),
  name: z.string(),
  /** Public stop code (bus stop number, e.g. "010802"), if any. */
  code: z.string().optional(),
  lat: z.number(),
  lon: z.number(),
  /** Platforms (train stations, busway platforms): stop_id and platform code. */
  platforms: z.array(z.object({ id: z.string(), code: z.string().optional() })).optional(),
  /** Route short names serving this stop in the build window. */
  routes: z.array(z.string()),
})
export type StopIndexEntry = z.infer<typeof StopIndexEntry>

export const StopIndexFile = z.object({
  schemaVersion: z.literal(1),
  mode: Mode,
  generation: z.string(),
  stops: z.array(StopIndexEntry),
})
export type StopIndexFile = z.infer<typeof StopIndexFile>

export const GeoTileFile = z.object({
  schemaVersion: z.literal(1),
  mode: Mode,
  generation: z.string(),
  geohash: z.string().length(5),
  stops: z.array(StopIndexEntry.pick({ key: true, name: true, code: true, lat: true, lon: true })),
})
export type GeoTileFile = z.infer<typeof GeoTileFile>

export const StopPattern = z.object({
  directionId: z.union([z.literal(0), z.literal(1), z.literal(-1)]),
  headsign: z.string(),
  /** Stop keys in order. */
  stops: z.array(z.string()),
  /** Trips using this pattern across the build window. */
  trips: z.number().int(),
})
export type StopPattern = z.infer<typeof StopPattern>

const Hex = z
  .string()
  .regex(/^[0-9A-Fa-f]{6}$/)
  .optional()

export const Line = z.object({
  /** route_short_name; one line groups every route_id that shares it. */
  short: z.string(),
  long: z.string().optional(),
  color: Hex,
  textColor: Hex,
  routeIds: z.array(z.string()),
  patterns: z.array(StopPattern),
})
export type Line = z.infer<typeof Line>

export const LinesFile = z.object({
  schemaVersion: z.literal(1),
  mode: Mode,
  generation: z.string(),
  lines: z.array(Line),
})
export type LinesFile = z.infer<typeof LinesFile>

/**
 * data/{mode}/routes/{short}.json: one line with its main stopping patterns (the two busiest per direction) and the
 * stops' names and positions, so a route page renders without the whole stop index. Not in the pipeline yet:
 * proposed in the PR; `pnpm data` builds it for this app meanwhile.
 */
export const RouteStop = StopIndexEntry.pick({ key: true, name: true, code: true, lat: true, lon: true })
export type RouteStop = z.infer<typeof RouteStop>

export const RouteFile = z.object({
  schemaVersion: z.literal(1),
  mode: Mode,
  generation: z.string(),
  short: z.string(),
  long: z.string().optional(),
  color: Hex,
  textColor: Hex,
  patterns: z.array(StopPattern.omit({ stops: true }).extend({ stops: z.array(RouteStop) })),
})
export type RouteFile = z.infer<typeof RouteFile>

/** Schema for a `/data/bus/...` path, or null when the path has no contract. */
export function dataSchemaForPath(pathname: string): z.ZodType | null {
  if (/\/data\/bus\/stops\.json$/.test(pathname)) return StopIndexFile
  if (/\/data\/bus\/lines\.json$/.test(pathname)) return LinesFile
  if (/\/data\/bus\/routes\/[^/]+\.json$/.test(pathname)) return RouteFile
  if (/\/data\/bus\/geo\/[0-9b-hjkmnp-z]{5}\.json$/.test(pathname)) return GeoTileFile
  return null
}
