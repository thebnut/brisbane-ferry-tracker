/**
 * Snapshot reads from R2 (when DATA_BUCKET is bound): `rt/latest.json`, then the snapshot it points at, only when
 * its seq is newer than the isolate's. Keeps the Durable Object off the read path entirely: on Workers Free the DO
 * has 100k requests a day, while R2 has 10M Class B reads a month.
 */
import { type DataSource, decodeJson, readBytes } from './data/source.ts'
import { type PullResult, R2_LATEST_KEY, type R2Pointer, snapshotSeq } from './rt/hub-core.ts'

export async function pullFromR2(src: DataSource, sinceSeq: number | null): Promise<PullResult> {
  const pointerBytes = await readBytes(src, R2_LATEST_KEY)
  if (!pointerBytes) {
    return {
      seq: null,
      json: null,
      status: {
        seq: null,
        sourceTimestamp: null,
        fetchedAt: null,
        lastCycleAt: null,
        lastError: 'no rt/latest.json',
        stats: null,
        generations: {},
      },
    }
  }
  let pointer = (await decodeJson(pointerBytes)) as R2Pointer
  if (pointer.seq === sinceSeq) return { seq: pointer.seq, json: null, status: pointer.status }
  // Snapshots live in a ring of overwritten keys: the slot must hold the seq the pointer names. A mismatch means
  // the hub published between our two reads, so re-read the pointer and try once more.
  for (let attempt = 0; attempt < 2; attempt++) {
    const json = await readSnapshot(src, pointer.key)
    if (json != null && snapshotSeq(json) === pointer.seq)
      return { seq: pointer.seq, json, status: pointer.status }
    if (attempt === 0) {
      const again = await readBytes(src, R2_LATEST_KEY)
      if (!again) break
      pointer = (await decodeJson(again)) as R2Pointer
      if (pointer.seq === sinceSeq) return { seq: pointer.seq, json: null, status: pointer.status }
    }
  }
  throw new Error(`snapshot for seq ${pointer.seq} not found at ${pointer.key}`)
}

async function readSnapshot(src: DataSource, key: string): Promise<string | null> {
  const bytes = await readBytes(src, key)
  if (!bytes) return null
  return bytes[0] === 0x1f && bytes[1] === 0x8b
    ? JSON.stringify(await decodeJson(bytes))
    : new TextDecoder().decode(bytes)
}
