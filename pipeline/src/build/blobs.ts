/**
 * Content-addressed gzip blobs: `static/blobs/{sha256}.json.gz` and `static/shards/{sha256}.json.gz`, where the hash
 * is over the gz bytes.
 *
 * Compression is Node's zlib at level 9 / memLevel 9: about 7% smaller than fflate on the largest stop-days, which is
 * what keeps Cultural Centre under 30 KB. The header is normalised (mtime 0, OS byte 0xff "unknown"), so output is
 * byte-identical for the same input on the same platform. zlib doesn't promise an identical deflate stream across
 * CPU architectures; CI (ubuntu x86-64) is the canonical builder, and a different machine at worst re-uploads blobs.
 */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { constants, gzipSync } from 'node:zlib'

export const GZIP_LEVEL = 9

export function gzipJson(json: string): Uint8Array {
  const gz = gzipSync(json, { level: GZIP_LEVEL, memLevel: 9, strategy: constants.Z_DEFAULT_STRATEGY })
  gz[4] = 0
  gz[5] = 0
  gz[6] = 0
  gz[7] = 0
  gz[9] = 0xff
  return new Uint8Array(gz.buffer, gz.byteOffset, gz.length)
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
