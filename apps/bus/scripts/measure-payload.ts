/**
 * Busiest-stop payload check against a pipeline output tree (read-only), using the same @bft/core merge the edge's
 * /v1/{mode}/stops/{key}/departures handler runs, validated with the contract.
 *
 *   pnpm tsx scripts/measure-payload.ts <pipelineOutDir> [stopKey...] [--at=epochMs]
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import {
  addDays,
  DeparturesResponse,
  GenerationIndex,
  mergeDepartures,
  overlappingServiceDates,
  SCHEMA_VERSION,
  type StaticStopDay,
} from '@bft/core'

const [out, ...rest] = process.argv.slice(2)
if (!out) throw new Error('usage: measure-payload.ts <pipelineOutDir> [stopKey...]')
const atArg = rest.find((a) => a.startsWith('--at='))
const keys = rest.filter((a) => !a.startsWith('--'))
const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'))
const generation = manifest.modes.bus.current as string
const index = GenerationIndex.passthrough().parse(
  JSON.parse(readFileSync(join(out, 'static', generation, 'bus', 'index.json'), 'utf8')),
)
const shards = (
  index as unknown as { shards?: { count: number; byDate: Record<string, Array<string | null>> } }
).shards

function shardOf(stopKey: string, count: number): number {
  let h = 0x811c9dc5
  for (let i = 0; i < stopKey.length; i++) {
    h ^= stopKey.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0) % count
}

function stopDay(date: string, key: string): StaticStopDay | null {
  const blob = index.blobs[date]?.[key]
  if (blob)
    return JSON.parse(
      gunzipSync(readFileSync(join(out as string, 'static/blobs', `${blob}.json.gz`))).toString(),
    )
  if (!shards) return null
  const sha = shards.byDate[date]?.[shardOf(key, shards.count)]
  if (!sha) return null
  const shard = JSON.parse(
    gunzipSync(readFileSync(join(out as string, 'static/shards', `${sha}.json.gz`))).toString(),
  )
  return shard[key] ?? null
}

// Weekday 8:15 am peak on the first full weekday in the window unless --at is given.
const nowMs = atArg ? Number(atArg.slice(5)) : Date.UTC(2026, 9, 19, 22, 15)
const nowS = Math.floor(nowMs / 1000)
for (const key of keys.length ? keys : ['11168', '10802', '19064', '10819']) {
  const dates = overlappingServiceDates(nowMs).filter((d) => index.serviceDates.includes(d))
  const days = dates.map((d) => stopDay(d, key)).filter((d): d is StaticStopDay => !!d)
  const next = addDays(dates.at(-1) as string, 1)
  for (const limit of [20, 100]) {
    const departures = mergeDepartures(days, null, { nowS, limit, rtState: 'unavailable' })
    const body = DeparturesResponse.parse({
      schemaVersion: SCHEMA_VERSION,
      staticGeneration: generation,
      serviceDates: dates,
      rtSourceTimestamp: null,
      rtState: 'unavailable',
      generatedAt: nowMs,
      mode: 'bus',
      stop: { key, name: days[0]?.stops.find((s) => s.id === key)?.name ?? key, stopIds: [key] },
      to: null,
      departures,
    })
    const json = JSON.stringify(body)
    const blobGz = gzipSync(JSON.stringify(days[0] ?? {})).length
    console.log(
      `${key} ${body.stop.name}: limit ${limit}: ${departures.length} rows, ${(json.length / 1024).toFixed(1)} KB raw, ${(gzipSync(json).length / 1024).toFixed(1)} KB gz (stop-day file ${(blobGz / 1024).toFixed(1)} KB gz; next day ${next})`,
    )
  }
}
