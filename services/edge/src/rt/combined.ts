/**
 * One R2 object for every mode document (hub R2 PUT budget, 20 Oct): the hub writes it once per poll in which any
 * mode's content changed, instead of one object per mode. A reader fetches only its own mode's bytes with ranged GETs.
 *
 * Layout: an ASCII JSON index padded with spaces to INDEX_BYTES, then each mode document's JSON, smallest first, so
 * a ferry reader's single ranged GET of `[0, end of ferry)` stays small. The index names each section's byte range
 * and the seq of the document it holds (a document unchanged since an earlier poll keeps its seq), and carries the
 * hub's freshness at the write (seq, source timestamp, fetchedAt, cycle), so a reader needs no pointer read while
 * the object is current.
 *
 * Integrity: the index records the whole object's size. A reader checks it against R2's own size for the version it
 * read, checks every section lies inside it, and checks the section's header seq; a second ranged GET is pinned to
 * the first one's etag. Any mismatch is a failed read (the caller retries once, then keeps its copy), never a
 * misparse.
 */
import type { Mode } from '@bft/core'
import { snapshotSeq } from './hub-core.ts'

/** Logical key (remapped by RT_R2_PREFIX like every rt/ key). */
export const COMBINED_KEY = 'rt/modes/combined.dat'
export const INDEX_BYTES = 1024
export const COMBINED_VERSION = 1

export interface CombinedIndex {
  v: typeof COMBINED_VERSION
  /** Snapshot seq at the write. */
  seq: number
  sourceTimestamp: number
  fetchedAt: number
  /** The hub's poll interval, so readers know how old a current object can be. */
  cycleMs: number
  /** Whole object, bytes. */
  size: number
  /** mode → [offset, length, document seq]. */
  sections: Partial<Record<Mode, [number, number, number]>>
}

export interface CombinedSection {
  mode: Mode
  json: string
  seq: number
}

/** Build the object. Throws if the index outgrows INDEX_BYTES (it is a few hundred bytes for four modes). */
export function encodeCombined(
  head: Pick<CombinedIndex, 'seq' | 'sourceTimestamp' | 'fetchedAt' | 'cycleMs'>,
  sections: CombinedSection[],
): Uint8Array {
  const enc = new TextEncoder()
  const parts = sections.map((s) => ({ ...s, bytes: enc.encode(s.json) }))
  parts.sort((a, b) => a.bytes.byteLength - b.bytes.byteLength)
  const index: CombinedIndex = { v: COMBINED_VERSION, ...head, size: 0, sections: {} }
  let at = INDEX_BYTES
  for (const p of parts) {
    index.sections[p.mode] = [at, p.bytes.byteLength, p.seq]
    at += p.bytes.byteLength
  }
  index.size = at
  const indexBytes = enc.encode(JSON.stringify(index))
  if (indexBytes.byteLength > INDEX_BYTES)
    throw new Error(`combined index too large: ${indexBytes.byteLength} bytes`)
  const out = new Uint8Array(at)
  out.fill(0x20, 0, INDEX_BYTES)
  out.set(indexBytes, 0)
  for (const p of parts) out.set(p.bytes, (index.sections[p.mode] as [number, number, number])[0])
  return out
}

/** The index from the object's first bytes, or null when it is missing, malformed or disagrees with `objectSize`. */
export function parseIndex(bytes: Uint8Array, objectSize: number | undefined): CombinedIndex | null {
  if (bytes.byteLength < INDEX_BYTES) return null
  let idx: CombinedIndex
  try {
    idx = JSON.parse(new TextDecoder().decode(bytes.subarray(0, INDEX_BYTES))) as CombinedIndex
  } catch {
    return null
  }
  if (idx?.v !== COMBINED_VERSION || !Number.isSafeInteger(idx.size) || typeof idx.sections !== 'object')
    return null
  if (objectSize != null && objectSize !== idx.size) return null
  for (const s of Object.values(idx.sections)) {
    if (!Array.isArray(s) || s.length !== 3 || !s.every(Number.isSafeInteger)) return null
    const [off, len] = s
    if (off < INDEX_BYTES || len <= 0 || off + len > idx.size) return null
  }
  return idx
}

/** A section's JSON, checked against the seq the index names; null when it doesn't match. */
export function decodeSection(bytes: Uint8Array, seq: number): string | null {
  const json = new TextDecoder().decode(bytes)
  return snapshotSeq(json) === seq && json.endsWith('}') ? json : null
}

/** Split a whole object into its mode documents (hub restore); null when it is inconsistent. */
export function decodeCombined(bytes: Uint8Array): { index: CombinedIndex; docs: CombinedSection[] } | null {
  const index = parseIndex(bytes, bytes.byteLength)
  if (!index) return null
  const docs: CombinedSection[] = []
  for (const [mode, [off, len, seq]] of Object.entries(index.sections) as Array<
    [Mode, [number, number, number]]
  >) {
    const json = decodeSection(bytes.subarray(off, off + len), seq)
    if (json == null) return null
    docs.push({ mode, json, seq })
  }
  return { index, docs }
}
