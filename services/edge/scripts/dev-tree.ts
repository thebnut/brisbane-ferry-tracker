/**
 * Dev-only output tree for `wrangler dev`, the Phase 0 spike and local shadow diffs, built straight from an
 * unzipped GTFS directory until the real pipeline (`pipeline/`, bft-pipeline) publishes trees. Same key layout and
 * core shapes; not the production builder (no validators, no client data beyond stops.json).
 *
 *   node --experimental-transform-types scripts/dev-tree.ts --gtfs /tmp/bft-gtfs/x --out ../data/out \
 *     --dates 20261017,20261018 --modes ferry,train [--legacy path/to/latest.json]
 */
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { gzipSync } from 'node:zlib'
import {
  type GenerationIndex,
  type Manifest,
  type Mode,
  type StaticStopDay,
  type StopEventTuple,
  type StopRef,
  slugify,
  type TripIndexDay,
} from '@bft/core'
import { buildTripIndexes } from './lib/gtfs-trip-index.ts'

const arg = (name: string, def?: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? (process.argv[i + 1] ?? '') : def
}

interface StopRow {
  id: string
  name: string
  parent: string
  platform: string
}

async function readStops(dir: string): Promise<Map<string, StopRow>> {
  const text = (await readFile(join(dir, 'stops.txt'), 'utf8')).replace(/^﻿/, '')
  const [head, ...lines] = text.split(/\r?\n/).filter(Boolean)
  const cols = (head as string).split(',')
  const ix = (n: string) => cols.indexOf(n)
  const out = new Map<string, StopRow>()
  for (const line of lines) {
    const v: string[] = []
    let cur = ''
    let q = false
    for (const c of line) {
      if (c === '"') q = !q
      else if (c === ',' && !q) {
        v.push(cur)
        cur = ''
      } else cur += c
    }
    v.push(cur)
    const id = v[ix('stop_id')] as string
    out.set(id, {
      id,
      name: (v[ix('stop_name')] ?? '').trim(),
      parent: (v[ix('parent_station')] ?? '').trim(),
      platform: (v[ix('platform_code')] ?? '').trim(),
    })
  }
  return out
}

/** Train boards by parent station slug; everything else by stop_id. */
function stopKeyFor(mode: Mode, stopId: string, stops: Map<string, StopRow>): string {
  if (mode !== 'train') return stopId
  const s = stops.get(stopId)
  const parent = s?.parent ? stops.get(s.parent) : undefined
  return slugify(parent?.name ?? s?.name ?? stopId)
}

export function stopDays(day: TripIndexDay, stops: Map<string, StopRow>): Map<string, StaticStopDay> {
  const out = new Map<string, StaticStopDay>()
  const idx = new Map<
    StaticStopDay,
    {
      trips: Map<string, number>
      routes: Map<number, number>
      heads: Map<string, number>
      stops: Map<string, number>
      downstreams: Map<string, number>
    }
  >()
  const file = (key: string) => {
    let f = out.get(key)
    if (!f) {
      f = {
        schemaVersion: 1,
        mode: day.mode,
        stopKey: key,
        serviceDate: day.serviceDate,
        trips: [],
        routes: [],
        headsigns: [],
        stops: [],
        downstreams: [],
        events: [],
      }
      out.set(key, f)
      idx.set(f, {
        trips: new Map(),
        routes: new Map(),
        heads: new Map(),
        stops: new Map(),
        downstreams: new Map(),
      })
    }
    return f
  }
  const intern = <K>(m: Map<K, number>, arr: unknown[], k: K, v: () => unknown) => {
    let i = m.get(k)
    if (i == null) {
      i = arr.push(v()) - 1
      m.set(k, i)
    }
    return i
  }
  const stopRef = (id: string): StopRef => {
    const s = stops.get(id)
    const ref: StopRef = { id, name: s?.name ?? id, key: stopKeyFor(day.mode, id, stops) }
    if (s?.platform) ref.platform = s.platform
    return ref
  }
  for (const t of day.trips) {
    const n = t.st.length / 6
    for (let i = 0; i < n; i++) {
      const [si, seq, arr, dep, pickup] = t.st.slice(i * 6, i * 6 + 5) as number[]
      if (pickup === 1) continue
      const stopId = day.stops[si as number] as string
      const f = file(stopKeyFor(day.mode, stopId, stops))
      const ix = idx.get(f) as NonNullable<ReturnType<typeof idx.get>>
      const ds: number[] = []
      for (let j = i + 1; j < n; j++) {
        const [dsi, dseq, darr, , , dropOff] = t.st.slice(j * 6, j * 6 + 6) as number[]
        if (dropOff === 1) continue
        const did = day.stops[dsi as number] as string
        ds.push(
          intern(ix.stops, f.stops, did, () => stopRef(did)),
          (darr as number) - (dep as number),
          dropOff as number,
          (dseq as number) - (seq as number),
        )
      }
      const ev: StopEventTuple = [
        intern(ix.trips, f.trips, t.id, () => t.id),
        seq as number,
        arr as number,
        dep as number,
        intern(ix.routes, f.routes, t.r, () => day.routes[t.r]),
        intern(ix.heads, f.headsigns, t.h, () => t.h),
        intern(ix.stops, f.stops, stopId, () => stopRef(stopId)),
        (pickup as 0 | 1 | 2 | 3) ?? 0,
        t.d,
        intern(ix.downstreams, f.downstreams, ds.join(','), () => ds),
      ]
      f.events.push(ev)
    }
  }
  for (const f of out.values()) f.events.sort((a, b) => a[3] - b[3] || a[0] - b[0])
  return out
}

async function main() {
  const gtfs = arg('gtfs', '/tmp/bft-gtfs/x') as string
  const outDir = arg('out', '../data/out') as string
  const dates = (arg('dates', '20261017,20261018') as string).split(',')
  const modes = (arg('modes', 'ferry,train') as string).split(',') as Mode[]
  const generation = arg('generation', `dev-${dates[0]}`) as string
  const [indexes, stops] = await Promise.all([buildTripIndexes(gtfs, dates, generation), readStops(gtfs)])
  const write = async (key: string, bytes: Uint8Array | string) => {
    const p = join(outDir, key)
    await mkdir(dirname(p), { recursive: true })
    await writeFile(p, bytes)
  }
  const blob = async (value: unknown) => {
    const gz = gzipSync(JSON.stringify(value), { level: 9 })
    const sha = createHash('sha256').update(gz).digest('hex')
    await write(`static/blobs/${sha}.json.gz`, gz)
    return sha
  }
  const manifest: Manifest = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    modes: {},
    quarantined: [],
  }
  for (const mode of modes) {
    const index: GenerationIndex = {
      schemaVersion: 1,
      generation,
      mode,
      feedVersion: 'dev',
      builtAt: new Date().toISOString(),
      serviceDates: dates,
      blobs: {},
      tripIndex: {},
    }
    const search = new Map<string, { key: string; name: string }>()
    for (const date of dates) {
      const day = indexes.get(`${mode}|${date}`)
      if (!day) continue
      ;(index.tripIndex as Record<string, string>)[date] = await blob(day)
      const files = stopDays(day, stops)
      const b: Record<string, string> = {}
      for (const [k, f] of files) {
        b[k] = await blob(f)
        search.set(k, { key: k, name: f.stops.find((s) => s.key === k)?.name ?? k })
      }
      index.blobs[date] = b
    }
    await write(`static/${generation}/${mode}/index.json`, JSON.stringify(index))
    await write(
      `data/${mode}/stops.json`,
      JSON.stringify({ schemaVersion: 1, mode, generation, stops: [...search.values()] }),
    )
    manifest.modes[mode] = { current: generation, serviceDates: dates }
  }
  const legacy = arg('legacy')
  if (legacy) {
    await mkdir(join(outDir, 'legacy'), { recursive: true })
    await copyFile(legacy, join(outDir, 'legacy/latest.json'))
  }
  await write('manifest.json', JSON.stringify(manifest))
  console.error(`wrote ${outDir} (${generation}, ${modes.join(',')}, ${dates.join(',')})`)
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
