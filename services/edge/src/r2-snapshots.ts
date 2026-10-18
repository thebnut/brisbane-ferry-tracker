/**
 * Snapshot reads from R2 (when DATA_BUCKET is bound): `rt/latest.json`, then the snapshot it points at, only when
 * its seq is newer than the isolate's. Keeps the Durable Object off the read path entirely: on Workers Free the DO
 * has 100k requests a day, while R2 has 10M Class B reads a month.
 */
import { type DataSource, decodeJson, readBytes } from './data/source.ts'
import { type PullResult, R2_LATEST_KEY, type R2Pointer } from './rt/hub-core.ts'

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
  const pointer = (await decodeJson(pointerBytes)) as R2Pointer
  if (pointer.seq === sinceSeq) return { seq: pointer.seq, json: null, status: pointer.status }
  const bytes = await readBytes(src, pointer.key)
  if (!bytes) throw new Error(`${pointer.key} missing`)
  const json =
    bytes[0] === 0x1f && bytes[1] === 0x8b
      ? JSON.stringify(await decodeJson(bytes))
      : new TextDecoder().decode(bytes)
  return { seq: pointer.seq, json, status: pointer.status }
}
