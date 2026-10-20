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
import {
  type DataSource,
  decodeJson,
  decodeText,
  type RangeRead,
  type RangeSource,
  readBytes,
  supportsRange,
} from './data/source.ts'
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

/** A read that found the pointer naming the other layout, with that pointer (so it isn't read again). */
interface Redirect {
  redirect: R2Pointer
}
const isRedirect = (r: PullResult | Redirect): r is Redirect => 'redirect' in r

/**
 * The layout this isolate last found the hub publishing (RT_R2_LAYOUT), tried first so a steady-state refresh is one
 * GET in either layout; whenever a pointer names the other layout the read switches over (Codex review A2 r2).
 */
let layoutHint: 'documents' | 'combined' = 'documents'

export async function pullFromR2(
  src: DataSource,
  sinceSeq: number | null,
  scope?: SnapshotScope,
  nowMs: number = Date.now(),
): Promise<PullResult> {
  if (!scope || scope === 'alerts') return pullDocuments(src, sinceSeq, scope, nowMs) as Promise<PullResult>
  let known: R2Pointer | undefined
  // This read's own layout: concurrent refreshes of other scopes share the hint, so a redirect's target comes from
  // the pointer itself, never from toggling (Codex review A2 r3).
  let layout = layoutHint
  // At most one switch each way within a read (the hub switching twice inside one read means try again later).
  for (let hop = 0; hop < 3; hop++) {
    const r =
      layout === 'combined'
        ? await pullCombined(src, sinceSeq, scope, nowMs, known)
        : await pullDocuments(src, sinceSeq, scope, nowMs, known)
    if (!isRedirect(r)) {
      layoutHint = layout
      return r
    }
    known = r.redirect
    layout = r.redirect.combined ? 'combined' : 'documents'
  }
  throw new Error('rt layout changed during the read')
}

/**
 * A mode from the combined object. A current object answers alone (one ranged GET). Anything else (none,
 * inconsistent, older than one poll) is settled by the pointer, which names the layout the hub publishes now (Codex
 * review A2 r1): without `combined` it redirects to the per-mode documents, so an abandoned object (even a corrupt
 * one) is ignored.
 */
async function pullCombined(
  src: DataSource,
  sinceSeq: number | null,
  scope: SnapshotScope,
  nowMs: number,
  known?: R2Pointer,
): Promise<PullResult | Redirect> {
  const answer = (s: SectionRead, status: HubStatus): PullResult =>
    s.json == null
      ? { seq: null, json: null, status }
      : { seq: s.seq, json: s.seq === sinceSeq ? null : s.json, status }
  const c = await readCombined(src, scope).catch(() => 'inconsistent' as const)
  if (!known && c && c !== 'inconsistent' && nowMs - c.index.fetchedAt <= freshFor(c.index)) {
    return answer(c, indexStatus(c))
  }
  const pointer = known ?? (await readPointer(src))
  if (!pointer) return noPointer()
  if (!pointer.combined) return { redirect: pointer }
  // Our read may predate the pointer (a publish in between, or the first combined publish): read it again.
  const cur =
    c && c !== 'inconsistent' && c.index.seq >= pointer.combined.seq ? c : await readCombined(src, scope)
  if (!cur || cur.index.seq < pointer.combined.seq) {
    throw new Error(`combined object older than the pointer's seq ${pointer.combined.seq}`)
  }
  const fresher = (pointer.status.seq ?? pointer.seq) >= cur.index.seq
  return answer(cur, fresher ? pointer.status : indexStatus(cur))
}

const noPointer = (): PullResult => ({
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
})

/**
 * The per-scope document path: alerts, and modes while the hub publishes per-mode documents. For a mode, a pointer
 * naming the combined object redirects there (with that pointer), at the first read or the retry.
 */
async function pullDocuments(
  src: DataSource,
  sinceSeq: number | null,
  scope: SnapshotScope | undefined,
  nowMs: number,
  known?: R2Pointer,
): Promise<PullResult | Redirect> {
  const mode = scope != null && scope !== 'alerts'
  // Modes: one read of rt/{mode}/latest.json, which the hub overwrites whenever that mode's content changes
  // (single-read refresh). Fall back to the pointer when it isn't there (an older hub, or a mode the hub doesn't
  // publish), and when it is older than DIRECT_FRESH_MS.
  let direct: { key: string; json: string } | null = null
  if (mode && !known) {
    const key = modeLatestKey(scope)
    // A document that doesn't decompress counts as missing here, so the pointer decides (it may be an abandoned
    // object of the other layout); I/O errors still propagate.
    const json = await readSnapshot(src, key, true)
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
  let pointer = known ?? (await readPointer(src))
  if (!pointer) return noPointer()
  if (mode && pointer.combined) return { redirect: pointer }
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
      const again = await readPointer(src)
      if (!again) break
      pointer = again
      if (mode && pointer.combined) return { redirect: pointer }
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
export const resetRangeHints = () => {
  rangeHints.clear()
  layoutHint = 'documents'
}

/**
 * This mode's section of the combined object, or null when there is no combined object. Usually one ranged GET
 * (index and section together); a second, pinned to the first one's etag, when the section lies past the first. An
 * index that disagrees with the object's size, a section past its end, a replaced object or a section whose seq
 * doesn't match is retried once from the start, then thrown: the caller keeps its copy (stale), never a misparse.
 */
async function readCombined(src: DataSource, scope: SnapshotScope): Promise<SectionRead | null> {
  if (!supportsRange(src)) {
    // One whole read: index and section from the same bytes, so one version (Codex review A2 r1).
    const all = await readBytes(src, COMBINED_KEY)
    if (!all) return null
    const index = parseIndex(all, all.byteLength)
    const sec = index?.sections[scope as keyof CombinedIndex['sections']]
    if (index && !sec) return { index, json: null, seq: index.seq }
    const json = index && sec ? await decodeSection(all.subarray(sec[0], sec[0] + sec[1]), sec[2]) : null
    if (index && sec && json != null) return { index, json, seq: sec[2] }
    throw new Error(`combined object ${COMBINED_KEY} inconsistent for ${scope}`)
  }
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
    const json = await decodeSection(bytes, seq)
    if (json != null) return { index, json, seq }
  }
  throw new Error(`combined object ${COMBINED_KEY} inconsistent for ${scope}`)
}

/** A ranged read (only on a RangeSource; others read the whole object, see readCombined). */
async function readRange(
  src: DataSource & RangeSource,
  key: string,
  offset: number,
  length: number,
  etag?: string,
): Promise<RangeRead | 'changed' | null> {
  return src.getRange(key, offset, length, etag)
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

/** The hub status in the published pointer, as /v1/health and unchanged-document readers see it (watchdog). */
export async function readPublishedStatus(src: DataSource): Promise<HubStatus | null> {
  return (await readPointer(src))?.status ?? null
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

/**
 * A document's JSON text, gunzipped when it is stored compressed (RT_R2_COMPRESS; plain documents from before it read
 * the same way). A corrupt or truncated gzip document throws like a failed read: the caller keeps its copy (stale).
 */
async function readSnapshot(src: DataSource, key: string, corruptAsMissing = false): Promise<string | null> {
  const bytes = await readBytes(src, key)
  if (!bytes) return null
  return corruptAsMissing ? decodeText(bytes).catch(() => null) : decodeText(bytes)
}
