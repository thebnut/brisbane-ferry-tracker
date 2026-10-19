/**
 * Snapshot reads from R2 (when DATA_BUCKET is bound). A mode is one ranged GET of the combined mode object
 * (`rt/modes/combined.dat`, see rt/combined.ts) covering its index and that mode's section, while the object is
 * current; past that, `rt/latest.json` too, for the hub status. Alerts go through `rt/latest.json` and then the
 * document it names, only when its seq moved. Hubs from before the combined object (per-mode
 * `rt/{mode}/latest.json` documents) are still read, chosen by the pointer, so a deploy or a rollback in either
 * direction keeps readers served. Keeps the Durable Object off the read path entirely: on Workers Free the DO has 100k
 * requests a day, while R2 has 10M Class B reads a month.
 */

import type { RtSnapshot } from '@bft/core'
import { type DataSource, decodeJson, type RangeRead, readBytes, supportsRange } from './data/source.ts'
import { COMBINED_KEY, type CombinedIndex, decodeSection, INDEX_BYTES, parseIndex } from './rt/combined.ts'
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
  if (!scope || scope === 'alerts') return pullDocuments(src, sinceSeq, scope, nowMs)
  const c = await readCombined(src, scope)
  if (c) {
    const answer = (s: SectionRead, status: HubStatus): PullResult =>
      s.json == null
        ? { seq: null, json: null, status }
        : { seq: s.seq, json: s.seq === sinceSeq ? null : s.json, status }
    if (nowMs - c.index.fetchedAt <= freshFor(c.index)) return answer(c, indexStatus(c))
    // Older than one poll: the content hasn't changed for a while (the index times are as old as it), or the hub
    // went back to per-mode documents and abandoned this object. The pointer says which, and has the current status.
    const pointer = await readPointer(src)
    if (pointer?.combined) {
      let cur: SectionRead | null = c
      // The object was replaced since our read (a publish in between): read it again.
      if (cur.index.seq < pointer.combined.seq) cur = await readCombined(src, scope)
      if (!cur || cur.index.seq < pointer.combined.seq) {
        throw new Error(`combined object older than the pointer's seq ${pointer.combined.seq}`)
      }
      const fresher = (pointer.status.seq ?? pointer.seq) >= cur.index.seq
      return answer(cur, fresher ? pointer.status : indexStatus(cur))
    }
  }
  return pullDocuments(src, sinceSeq, scope, nowMs)
}

/** The per-scope document path: alerts, and modes of hubs before the combined object. */
async function pullDocuments(
  src: DataSource,
  sinceSeq: number | null,
  scope: SnapshotScope | undefined,
  nowMs: number,
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

interface SectionRead {
  index: CombinedIndex
  /** null: the object has no section for this mode (the hub doesn't publish it). */
  json: string | null
  seq: number
}

/** Bytes each mode's reader asks for first: last time's end of its section, plus room to grow (per isolate). */
const rangeHints = new Map<SnapshotScope, number>()
/** Tests: forget the learned first-read sizes. */
export const resetRangeHints = () => rangeHints.clear()

/**
 * This mode's section of the combined object, or null when there is no combined object. Usually one ranged GET
 * (index and section together); a second, pinned to the first one's etag, when the section lies past the first. An
 * index that disagrees with the object's size, a section past its end, a replaced object or a section whose seq
 * doesn't match is retried once from the start, then thrown: the caller keeps its copy (stale), never a misparse.
 */
async function readCombined(src: DataSource, scope: SnapshotScope): Promise<SectionRead | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const first = await readRange(src, COMBINED_KEY, 0, rangeHints.get(scope) ?? INDEX_BYTES)
    if (first == null) return null
    if (first === 'changed') continue
    const index = parseIndex(first.bytes, first.size)
    if (!index) continue
    const sec = index.sections[scope as keyof CombinedIndex['sections']]
    if (!sec) return { index, json: null, seq: index.seq }
    const [off, len, seq] = sec
    rangeHints.set(scope, off + len + Math.ceil(len / 4) + 4096)
    let bytes: Uint8Array
    if (off + len <= first.bytes.byteLength) bytes = first.bytes.subarray(off, off + len)
    else {
      const rest = await readRange(src, COMBINED_KEY, off, len, first.etag)
      if (rest == null || rest === 'changed' || rest.bytes.byteLength !== len) continue
      bytes = rest.bytes
    }
    const json = decodeSection(bytes, seq)
    if (json != null) return { index, json, seq }
  }
  throw new Error(`combined object ${COMBINED_KEY} inconsistent for ${scope}`)
}

/** A ranged read; a source without range support reads the whole object (one version, so no etag pin needed). */
async function readRange(
  src: DataSource,
  key: string,
  offset: number,
  length: number,
  etag?: string,
): Promise<RangeRead | 'changed' | null> {
  if (supportsRange(src)) return src.getRange(key, offset, length, etag)
  const all = await readBytes(src, key)
  return all ? { bytes: all.slice(offset, offset + length), size: all.byteLength, etag: '' } : null
}

/** A combined object is current for one poll (plus slack) after it was written. */
const freshFor = (index: CombinedIndex) => Math.max(DIRECT_FRESH_MS, index.cycleMs + 5_000)

/** Hub status from the index (freshness at the write) and the section's header (stats, generations). */
function indexStatus(s: SectionRead): HubStatus {
  const base = s.json != null ? statusOf(s.json, s.seq) : null
  return {
    seq: s.index.seq,
    sourceTimestamp: s.index.sourceTimestamp,
    fetchedAt: s.index.fetchedAt,
    lastCycleAt: null,
    lastError: null,
    stats: base?.stats ?? null,
    generations: base?.generations ?? {},
  }
}

async function readPointer(src: DataSource): Promise<R2Pointer | null> {
  const bytes = await readBytes(src, R2_LATEST_KEY)
  return bytes ? ((await decodeJson(bytes)) as R2Pointer) : null
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
