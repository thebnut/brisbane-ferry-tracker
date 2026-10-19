/**
 * Snapshot reads from R2 (when DATA_BUCKET is bound). A mode is one read of `rt/{mode}/latest.json` while that object
 * is fresh, plus `rt/latest.json` for the hub status when the mode's content hasn't changed lately; alerts (and older
 * hubs) go through `rt/latest.json` and then the document it names, only when its seq moved. Keeps the Durable Object
 * off the read path entirely: on Workers Free the DO has 100k requests a day, while R2 has 10M Class B reads a month.
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
  nowMs: number = Date.now(),
): Promise<PullResult> {
  // Modes: one read of rt/{mode}/latest.json, which the hub overwrites whenever that mode's content changes
  // (single-read refresh). Fall back to the pointer when it isn't there (an older hub, or a mode the hub doesn't
  // publish), and when it is older than DIRECT_FRESH_MS.
  let direct: { key: string; json: string } | null = null
  if (scope && scope !== 'alerts') {
    const key = modeLatestKey(scope)
    const json = await readSnapshot(src, key)
    const seq = json != null ? snapshotSeq(json) : null
    if (json != null && seq != null) {
      const status = statusOf(json, seq)
      if (status.fetchedAt == null || nowMs - status.fetchedAt <= DIRECT_FRESH_MS) {
        return { seq, json: seq === sinceSeq ? null : json, status }
      }
      // Older: either the mode's content hasn't changed for a while (its header times are as old as the content,
      // so the hub status comes from the pointer), or the object was abandoned (the hub rolled back to a ring
      // publisher, which never deletes it) and must not freeze readers (Codex review of #49). The pointer says which;
      // the object just read is reused if the pointer names it.
      direct = { key, json }
    }
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
  // Unchanged shortcut only for ring slots: an overwritten latest object can be newer than the pointer says, so its
  // actual seq is read below before deciding (Codex review of #49).
  const isLatest = (k: string) => k.endsWith('/latest.json')
  if (!isLatest(e.key) && e.seq === sinceSeq) return { seq: e.seq, json: null, status: pointer.status }
  // Snapshots live in rings of overwritten keys: the slot must hold the seq the pointer names. A mismatch means
  // the hub published between our two reads, so re-read the pointer and try once more.
  for (let attempt = 0; attempt < 2; attempt++) {
    const json = attempt === 0 && direct?.key === e.key ? direct.json : await readSnapshot(src, e.key)
    const got = json != null ? snapshotSeq(json) : null
    // Ring slots must hold exactly the named seq. An overwritten latest object may be newer than the pointer after
    // a partial publish; it is still that scope's newest committed content (Codex review of #49).
    if (json != null && got != null && (isLatest(e.key) ? got >= e.seq : got === e.seq)) {
      // Freshness from the pointer's hub status (the upstream source time as of the pointer), unless the document
      // was written after it. An unchanged document's own header is as old as its content (see publishR2).
      const status = got > (pointer.status.seq ?? pointer.seq) ? statusOf(json, got) : pointer.status
      return { seq: got, json: got === sinceSeq ? null : json, status }
    }
    if (attempt === 0) {
      const again = await readBytes(src, R2_LATEST_KEY)
      if (!again) break
      pointer = (await decodeJson(again)) as R2Pointer
      const next = entry(pointer)
      if (!next) return { seq: null, json: null, status: pointer.status }
      e = next
      if (!isLatest(e.key) && e.seq === sinceSeq) return { seq: e.seq, json: null, status: pointer.status }
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

/**
 * A per-mode latest object whose header is at most this old is used with its own status, in one read. Past it, the
 * pointer gives the status (and says whether the object was abandoned). A mode whose content changes every poll is
 * rewritten every 15 s in production; on staging (30 s polls) about half the refreshes also read the pointer.
 */
export const DIRECT_FRESH_MS = 20_000

async function readSnapshot(src: DataSource, key: string): Promise<string | null> {
  const bytes = await readBytes(src, key)
  if (!bytes) return null
  return bytes[0] === 0x1f && bytes[1] === 0x8b
    ? JSON.stringify(await decodeJson(bytes))
    : new TextDecoder().decode(bytes)
}
