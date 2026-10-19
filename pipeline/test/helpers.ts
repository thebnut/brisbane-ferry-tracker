import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import {
  GenerationIndex,
  GeoTileFile,
  LinesFile,
  Manifest,
  RouteFile,
  RouteIndexFile,
  StaticShard,
  StaticStopDay,
  StopIndexFile,
  TripIndexDay,
} from '@bft/core'
import { listFiles } from '../src/publish/targets.ts'

export const gunzipJson = (b: Uint8Array) => JSON.parse(gunzipSync(b).toString('utf8'))

export async function readGz(dir: string, key: string) {
  return gunzipJson(await readFile(join(dir, key)))
}

export async function readJsonFile<T = unknown>(dir: string, key: string): Promise<T> {
  return JSON.parse(await readFile(join(dir, key), 'utf8')) as T
}

/** zod-parse every file the build wrote. Returns counts by kind. */
export async function parseAll(dir: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  const bump = (k: string) => {
    counts[k] = (counts[k] ?? 0) + 1
  }
  for (const f of await listFiles(dir)) {
    if (f.startsWith('static/blobs/')) {
      const v = await readGz(dir, f)
      if ('stopKey' in v) {
        StaticStopDay.parse(v)
        bump('stopDay')
      } else {
        TripIndexDay.parse(v)
        bump('tripIndex')
      }
    } else if (f.startsWith('static/shards/')) {
      StaticShard.parse(await readGz(dir, f))
      bump('shard')
    } else if (/^static\/[^/]+\/[^/]+\/index\.json$/.test(f)) {
      GenerationIndex.parse(await readJsonFile(dir, f))
      bump('index')
    } else if (f === 'manifest.json' || f === 'manifest.staging.json') {
      Manifest.parse(await readJsonFile(dir, f))
      bump('manifest')
    } else if (/(^|\/)data\/[^/]+\/stops\.json$/.test(f)) {
      StopIndexFile.parse(await readJsonFile(dir, f))
      bump('stops')
    } else if (/(^|\/)data\/[^/]+\/lines\.json$/.test(f)) {
      LinesFile.parse(await readJsonFile(dir, f))
      bump('lines')
    } else if (/(^|\/)data\/[^/]+\/geo\/[0-9a-z]{5}\.json$/.test(f)) {
      GeoTileFile.parse(await readJsonFile(dir, f))
      bump('geo')
    } else if (/(^|\/)data\/bus\/routes\/[\w-]{1,12}\.json$/.test(f)) {
      const r = RouteFile.parse(await readJsonFile(dir, f))
      if (!f.endsWith(`/routes/${r.short}.json`)) throw new Error(`${f} holds route ${r.short}`)
      bump('route')
    } else if (/(^|\/)data\/bus\/routes\.json$/.test(f)) {
      RouteIndexFile.parse(await readJsonFile(dir, f))
      bump('routeIndex')
    } else if (/(^|\/)legacy\/latest\.json$/.test(f)) {
      await readJsonFile(dir, f)
      bump('legacy')
    } else if (f === '_headers') bump('headers')
    else throw new Error(`unexpected file in build output: ${f}`)
  }
  return counts
}
