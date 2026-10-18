/**
 * Snapshot reads from R2 (when DATA_BUCKET is bound). A mode is one read of `rt/{mode}/latest.json`; alerts (and
 * older hubs) go through `rt/latest.json` and then the document it names, only when its seq moved. Keeps the Durable Object off the read path entirely: on Workers Free the DO
 * has 100k requests a day, while R2 has 10M Class B reads a month.
 */

import type { RtSnapshot } from '@bft/core'
import { type DataSource, decodeJson, readBytes } from './data/source.ts'
import {
  type HubStatus,
  modeLatestKey,
  type PullResult,
  R2_LATEST_KEY,
  type R2Pointer,
  snapshotSeq,
} from './rt/hub-core.ts'
import type { SnapshotScope } from './rt/split.ts'

export async function pullFromR2(
  src: DataSource,
  sinceSeq: number | null,
  scope?: SnapshotScope,
): Promise<PullResult> {
  // Modes: one read of rt/{mode}/latest.json, which the hub overwrites every poll (single-read refresh). Fall back
  // to the pointer when it isn't there (an older hub, or a mode the hub doesn't publish).
  if (scope && scope !== 'alerts') {
    const json = await readSnapshot(src, modeLatestKey(scope))
    const seq = json != null ? snapshotSeq(json) : null
    if (json != null && seq != null)
      return { seq, json: seq === sinceSeq ? null : json, status: statusOf(json, seq) }
  }
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
  // The document this reader wants: one scope's (per-mode split), or the combined snapshot of an older hub.
  const entry = (p: R2Pointer) =>
    scope && p.files ? p.files[scope] : p.key ? { key: p.key, seq: p.seq } : undefined
  let e = entry(pointer)
  // A scope the hub doesn't publish (a mode it doesn't poll): no snapshot, but the hub status still applies.
  if (!e) return { seq: null, json: null, status: pointer.status }
  if (e.seq === sinceSeq) return { seq: e.seq, json: null, status: pointer.status }
  // Snapshots live in rings of overwritten keys: the slot must hold the seq the pointer names. A mismatch means
  // the hub published between our two reads, so re-read the pointer and try once more.
  for (let attempt = 0; attempt < 2; attempt++) {
    const json = await readSnapshot(src, e.key)
    if (json != null && snapshotSeq(json) === e.seq) return { seq: e.seq, json, status: pointer.status }
    if (attempt === 0) {
      const again = await readBytes(src, R2_LATEST_KEY)
      if (!again) break
      pointer = (await decodeJson(again)) as R2Pointer
      const next = entry(pointer)
      if (!next) return { seq: null, json: null, status: pointer.status }
      e = next
      if (e.seq === sinceSeq) return { seq: e.seq, json: null, status: pointer.status }
    }
  }
  throw new Error(`snapshot for seq ${e.seq} not found at ${e.key}`)
}

/** Hub status from a document's header (parsing only the header: JSON.stringify writes it first). */
function statusOf(json: string, seq: number): HubStatus {
  const end = json.indexOf(',"trips":')
  const h = (JSON.parse(end > 0 ? `${json.slice(0, end)}}` : json) as Pick<RtSnapshot, 'header'>).header
  return {
    seq,
    sourceTimestamp: h.sourceTimestamp,
    fetchedAt: h.fetchedAt,
    lastCycleAt: null,
    lastError: null,
    stats: h.stats ?? null,
    generations: h.staticGeneration,
  }
}

async function readSnapshot(src: DataSource, key: string): Promise<string | null> {
  const bytes = await readBytes(src, key)
  if (!bytes) return null
  return bytes[0] === 0x1f && bytes[1] === 0x8b
    ? JSON.stringify(await decodeJson(bytes))
    : new TextDecoder().decode(bytes)
}
