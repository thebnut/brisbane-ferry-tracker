/**
 * Feed input: a GTFS zip URL (default: TransLink SEQ), a local zip, or an already-extracted directory.
 * Everything downstream reads from a directory of .txt files.
 */
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, type WriteStream } from 'node:fs'
import { mkdir, mkdtemp, readdir, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Unzip, UnzipInflate, UnzipPassThrough } from 'fflate'

export const DEFAULT_GTFS_URL = 'https://gtfsrt.api.translink.com.au/GTFS/SEQ_GTFS.zip'

export interface FeedSource {
  dir: string
  /** sha256 hex of the zip bytes when the input was a zip, else null. */
  zipSha256: string | null
}

export async function resolveFeed(input: string | undefined, workDir?: string): Promise<FeedSource> {
  const src = input ?? DEFAULT_GTFS_URL
  if (/^https?:\/\//.test(src)) {
    const dir = workDir ?? (await mkdtemp(join(tmpdir(), 'bft-gtfs-')))
    await mkdir(dir, { recursive: true })
    const zipPath = join(dir, 'feed.zip')
    const res = await fetch(src)
    if (!res.ok || !res.body) throw new Error(`GTFS download failed: HTTP ${res.status} ${src}`)
    await writeFile(zipPath, res.body as unknown as AsyncIterable<Uint8Array>)
    return extractZip(zipPath, join(dir, 'x'))
  }
  const st = await stat(src)
  if (st.isDirectory()) return { dir: src, zipSha256: null }
  const dir = workDir ?? (await mkdtemp(join(tmpdir(), 'bft-gtfs-')))
  return extractZip(src, join(dir, 'x'))
}

/** Stream-extract the top-level .txt files of a GTFS zip, hashing the zip bytes on the way. */
export async function extractZip(zipPath: string, outDir: string): Promise<FeedSource> {
  await mkdir(outDir, { recursive: true })
  const hash = createHash('sha256')
  const writers: Promise<void>[] = []
  const unzip = new Unzip((file) => {
    const name = file.name.split('/').pop() ?? ''
    if (!/^[a-z_]+\.txt$/.test(name)) return
    const ws: WriteStream = createWriteStream(join(outDir, name))
    writers.push(
      new Promise((resolve, reject) => {
        ws.on('finish', () => resolve())
        ws.on('error', reject)
        file.ondata = (err, chunk, final) => {
          if (err) return reject(err)
          ws.write(chunk)
          if (final) ws.end()
        }
      }),
    )
    file.start()
  })
  unzip.register(UnzipInflate)
  unzip.register(UnzipPassThrough)
  for await (const chunk of createReadStream(zipPath, { highWaterMark: 1 << 20 })) {
    hash.update(chunk as Buffer)
    unzip.push(chunk as Uint8Array)
  }
  unzip.push(new Uint8Array(0), true)
  await Promise.all(writers)
  return { dir: outDir, zipSha256: hash.digest('hex') }
}

/**
 * Content hash of the feed: sha256 over every .txt file (name, length, bytes) in name order. The same feed gives the
 * same hash whether it arrives as a zip or a directory, and a re-zip of identical content doesn't change it.
 */
export async function feedContentHash(dir: string): Promise<string> {
  const names = (await readdir(dir)).filter((n) => n.endsWith('.txt')).sort()
  const hash = createHash('sha256')
  for (const name of names) {
    const st = await stat(join(dir, name))
    hash.update(`${name}\0${st.size}\0`)
    for await (const chunk of createReadStream(join(dir, name), { highWaterMark: 1 << 20 }))
      hash.update(chunk as Buffer)
  }
  return hash.digest('hex')
}

export function feedFile(dir: string, name: string): string | null {
  const p = join(dir, name)
  return existsSync(p) ? p : null
}
