/**
 * Publish a build directory to a target. Content-addressed files (blobs, shards) and generation indexes are uploaded
 * only when the target doesn't have them; client data and legacy files are overwritten; manifest.staging.json and
 * then manifest.json go last, so the generation switch is atomic for readers.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { GenerationIndex, Manifest, Mode } from '@bft/core'
import { blobKey, shardKey } from '../build/blobs.ts'
import { AssetsTarget, DirTarget, listFiles, metaFor, type PublishTarget, readJson } from './targets.ts'

export interface PublishStats {
  /** PUTs (R2 Class A operations). */
  puts: number
  /** Existence checks (R2 Class B). */
  checks: number
  skipped: number
  bytes: number
}

export async function publish(fromDir: string, target: PublishTarget, log: (m: string) => void = () => {}) {
  const src = new DirTarget(fromDir)
  const stats: PublishStats = { puts: 0, checks: 0, skipped: 0, bytes: 0 }
  const shardsOnly = target instanceof AssetsTarget
  const manifests = [
    await readJson<Manifest>(src, 'manifest.json'),
    await readJson<Manifest>(src, 'manifest.staging.json'),
  ]
  if (!manifests[0]) throw new Error(`${fromDir} has no manifest.json; run a build first`)

  const generations = new Map<string, Mode>()
  for (const m of manifests) {
    for (const [mode, e] of Object.entries(m?.modes ?? {})) {
      if (!e) continue
      generations.set(`${e.current}|${mode}`, mode as Mode)
      if (e.previous) generations.set(`${e.previous}|${mode}`, mode as Mode)
    }
  }

  const put = async (key: string, body: Uint8Array) => {
    await target.put(key, body, metaFor(key))
    stats.puts++
    stats.bytes += body.length
  }
  const putIfMissing = async (key: string) => {
    stats.checks++
    if (await target.exists(key)) {
      stats.skipped++
      return
    }
    const body = await src.get(key)
    if (!body) throw new Error(`build output is missing ${key}`)
    await put(key, body)
  }

  for (const [gm, mode] of generations) {
    const generation = gm.split('|')[0] as string
    const indexKey = `static/${generation}/${mode}/index.json`
    const index = await readJson<GenerationIndex>(src, indexKey)
    if (!index) {
      // A previous generation from an earlier run that this build directory doesn't hold: the target has it already.
      log(`skip ${indexKey}: not in this build`)
      continue
    }
    const keys = new Set<string>()
    const useShards = shardsOnly && index.shards
    for (const date of index.serviceDates) {
      const shards = (index.shards?.byDate[date] ?? []).filter((s): s is string => s !== null)
      // The assets backend carries shards instead of per-stop blobs for sharded modes; R2 and dirs carry both.
      if (!useShards) for (const sha of Object.values(index.blobs[date] ?? {})) keys.add(blobKey(sha))
      for (const sha of shards) keys.add(shardKey(sha))
      const ti = index.tripIndex?.[date]
      if (ti) keys.add(blobKey(ti))
    }
    for (const k of [...keys].sort()) await putIfMissing(k)
    await putIfMissing(indexKey)
    log(`${mode} ${generation}: ${keys.size} content files`)
  }

  const files = await listFiles(fromDir)
  for (const f of files) {
    if (f.startsWith('data/') || f.startsWith('legacy/') || f.startsWith('staging/'))
      await put(f, new Uint8Array(await readFile(join(fromDir, f))))
  }
  if (manifests[1])
    await put('manifest.staging.json', new Uint8Array(await readFile(join(fromDir, 'manifest.staging.json'))))
  await put('manifest.json', new Uint8Array(await readFile(join(fromDir, 'manifest.json'))))
  await target.finish?.()
  return stats
}
