/**
 * Isolate cache for the stop directory (stop-directory.ts), built from data/bus/stops.json (~1.6 MB). The same rules
 * as the route index's cache (route-index.server.ts): only a good directory is kept, for DIRECTORY_TTL_MS from when
 * its fetch began; a failure is fetched again next time; no in-flight fetch is shared; fixtures bypass it.
 */
import type { ApiFetcher } from './api.ts'
import { type Directory, directoryFromIndexText } from './stop-directory.ts'

export const DIRECTORY_TTL_MS = 300_000

let hit: { dir: Directory; started: number; until: number } | null = null

/** The directory from the stop index, or a throw when the index can't be read or names no stop. */
export async function loadDirectory(fetcher: ApiFetcher, signal?: AbortSignal): Promise<Directory> {
  const res = await fetcher('/data/bus/stops.json', { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status} for /data/bus/stops.json`)
  const dir = directoryFromIndexText(await res.text())
  if (dir.size === 0) throw new Error('no stops in /data/bus/stops.json')
  return dir
}

export async function cachedDirectory(
  load: () => Promise<Directory>,
  opts: { cache?: boolean } = {},
): Promise<Directory> {
  if (opts.cache === false) return load()
  if (hit && Date.now() < hit.until) return hit.dir
  const started = Date.now()
  const dir = await load()
  if (!hit || started >= hit.started) hit = { dir, started, until: started + DIRECTORY_TTL_MS }
  return dir
}

/** Tests only: forget the cached directory. */
export function resetDirectoryCache() {
  hit = null
}
