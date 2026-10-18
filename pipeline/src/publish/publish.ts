/**
 * Publish a build directory to a target. Content-addressed files (blobs, shards) and generation indexes are uploaded
 * only when the target doesn't have them; client data and legacy files are overwritten; manifest.staging.json and
 * then manifest.json go last, so the generation switch is atomic for readers.
 *
 * To stay inside R2's free tier, a remote target is never HEADed per object: every content key referenced by the
 * generations the target's own manifest already lists is known to be present (content files are immutable), and the
 * rest are PUT directly. A next-day run on an unchanged feed is then ~13k PUTs and a handful of GETs.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { GenerationIndex, Manifest, Mode } from '@bft/core'
import { blobKey, shardKey } from '../build/blobs.ts'
import {
  AssetsTarget,
  DirTarget,
  listFiles,
  metaFor,
  type PublishTarget,
  type Reader,
  readJson,
} from './targets.ts'

export interface PublishStats {
  /** PUTs (R2 Class A operations). */
  puts: number
  /** Existence checks (HEADs; only for local directory targets). */
  checks: number
  /** Content files not uploaded because the target already has them. */
  skipped: number
  /** GETs of the target's manifest and indexes (R2 Class B). */
  reads: number
  bytes: number
}

export interface PublishOptions {
  log?: (m: string) => void
  concurrency?: number
}

/** Content keys a generation index references (blobs, shards, trip indexes), plus the index itself. */
export function contentKeys(index: GenerationIndex, shardsOnly = false): string[] {
  const keys = new Set<string>()
  const useShards = shardsOnly && index.shards
  for (const date of index.serviceDates) {
    // The assets backend carries shards instead of per-stop blobs for sharded modes; R2 and dirs carry both.
    if (!useShards) for (const sha of Object.values(index.blobs[date] ?? {})) keys.add(blobKey(sha))
    for (const sha of index.shards?.byDate[date] ?? []) if (sha) keys.add(shardKey(sha))
    const ti = index.tripIndex?.[date]
    if (ti) keys.add(blobKey(ti))
  }
  return [...keys].sort()
}

const indexKeyOf = (generation: string, mode: string) => `static/${generation}/${mode}/index.json`

function generationsOf(manifests: Array<Manifest | null>): Array<[string, Mode]> {
  const out = new Map<string, [string, Mode]>()
  for (const m of manifests)
    for (const [mode, e] of Object.entries(m?.modes ?? {})) {
      if (!e) continue
      for (const g of [e.current, e.previous]) if (g) out.set(`${g}|${mode}`, [g, mode as Mode])
    }
  return [...out.values()]
}

async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const worker = async () => {
    while (next < items.length) await fn(items[next++] as T)
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, worker))
}

export async function publish(
  fromDir: string,
  target: PublishTarget,
  opts: PublishOptions = {},
): Promise<PublishStats> {
  const log = opts.log ?? (() => {})
  const src = new DirTarget(fromDir)
  const remote = !(target instanceof DirTarget)
  const concurrency = opts.concurrency ?? (remote ? 24 : 8)
  const stats: PublishStats = { puts: 0, checks: 0, skipped: 0, reads: 0, bytes: 0 }
  const shardsOnly = target instanceof AssetsTarget
  const manifests = [
    await readJson<Manifest>(src, 'manifest.json'),
    await readJson<Manifest>(src, 'manifest.staging.json'),
  ]
  if (!manifests[0]) throw new Error(`${fromDir} has no manifest.json; run a build first`)

  // What the target already holds, from its own manifests.
  const known = new Set<string>()
  if (remote) {
    const counted: Reader = {
      name: target.name,
      get: (k) => {
        stats.reads++
        return target.get(k)
      },
    }
    const theirs = [
      await readJson<Manifest>(counted, 'manifest.json'),
      await readJson<Manifest>(counted, 'manifest.staging.json'),
    ]
    for (const [g, mode] of generationsOf(theirs)) {
      const idx = await readJson<GenerationIndex>(counted, indexKeyOf(g, mode))
      if (!idx) continue
      known.add(indexKeyOf(g, mode))
      for (const k of contentKeys(idx, shardsOnly)) known.add(k)
    }
    log(`${target.name}: ${known.size} content files already referenced by its manifests`)
  }

  const put = async (key: string, body: Uint8Array) => {
    await target.put(key, body, metaFor(key))
    stats.puts++
    stats.bytes += body.length
    if (stats.puts % 5000 === 0) log(`  … ${stats.puts} puts`)
  }
  const ensure = async (key: string) => {
    if (known.has(key)) {
      stats.skipped++
      return
    }
    if (!remote) {
      stats.checks++
      if (await target.exists(key)) {
        stats.skipped++
        return
      }
    }
    const body = await src.get(key)
    if (!body) throw new Error(`build output is missing ${key}`)
    await put(key, body)
    known.add(key)
  }

  for (const [generation, mode] of generationsOf(manifests)) {
    const indexKey = indexKeyOf(generation, mode)
    const index = await readJson<GenerationIndex>(src, indexKey)
    if (!index) {
      // A previous generation from an earlier run that this build directory doesn't hold: the target has it already.
      log(`skip ${indexKey}: not in this build`)
      continue
    }
    const keys = contentKeys(index, shardsOnly)
    await pool(keys, concurrency, ensure)
    // The index goes up only after every file it references.
    await ensure(indexKey)
    log(`${mode} ${generation}: ${keys.length} content files`)
  }

  const mutable = (await listFiles(fromDir)).filter(
    (f) => f.startsWith('data/') || f.startsWith('legacy/') || f.startsWith('staging/'),
  )
  await pool(mutable, concurrency, async (f) => put(f, new Uint8Array(await readFile(join(fromDir, f)))))
  if (manifests[1])
    await put('manifest.staging.json', new Uint8Array(await readFile(join(fromDir, 'manifest.staging.json'))))
  await put('manifest.json', new Uint8Array(await readFile(join(fromDir, 'manifest.json'))))
  await target.finish?.()
  return stats
}
