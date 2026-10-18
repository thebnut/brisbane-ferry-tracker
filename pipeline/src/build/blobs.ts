/**
 * Content-addressed gzip blobs: `static/blobs/{sha256}.json.gz` and `static/shards/{sha256}.json.gz`, where the hash
 * is over the gz bytes. Compression is fflate (pure JS) with a fixed level and mtime 0, so the bytes, and therefore
 * the hashes, are identical on every machine and CPU (Node's bundled zlib varies the gzip OS byte by platform).
 */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { gzipSync } from 'fflate'

export const GZIP_LEVEL = 9

const enc = new TextEncoder()

export function gzipJson(json: string): Uint8Array {
  return gzipSync(enc.encode(json), { level: GZIP_LEVEL, mtime: 0 })
}

export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export const blobKey = (sha: string) => `static/blobs/${sha}.json.gz`
export const shardKey = (sha: string) => `static/shards/${sha}.json.gz`

export interface BlobInfo {
  sha: string
  key: string
  rawBytes: number
  gzBytes: number
  /** False when an identical blob was already present in the output. */
  isNew: boolean
}

/** Writes content-addressed blobs into an output directory, skipping ones already there. */
export class BlobWriter {
  readonly written = new Set<string>()
  newCount = 0
  existingCount = 0
  constructor(readonly outDir: string) {}

  async put(kind: 'blob' | 'shard', json: string): Promise<BlobInfo> {
    const gz = gzipJson(json)
    const sha = sha256Hex(gz)
    const key = kind === 'blob' ? blobKey(sha) : shardKey(sha)
    const path = join(this.outDir, key)
    let isNew = false
    if (!this.written.has(key)) {
      this.written.add(key)
      if (existsSync(path)) this.existingCount++
      else {
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, gz)
        this.newCount++
        isNew = true
      }
    }
    return { sha, key, rawBytes: Buffer.byteLength(json), gzBytes: gz.length, isNew }
  }
}
