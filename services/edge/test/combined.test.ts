import { describe, expect, it } from 'vitest'
import { MemoryDataSource, type RangeRead } from '../src/data/source.ts'
import { pullFromR2, resetRangeHints } from '../src/r2-snapshots.ts'
import {
  COMBINED_KEY,
  type CombinedSection,
  decodeCombined,
  encodeCombined,
  INDEX_BYTES,
  parseIndex,
} from '../src/rt/combined.ts'
import { R2_LATEST_KEY } from '../src/rt/hub-core.ts'
import { SnapshotClient } from '../src/snapshot-client.ts'

const NOW = 1_792_448_000_000
const doc = (seq: number, trips: number, pad = '') =>
  JSON.stringify({
    header: {
      schemaVersion: 1,
      seq,
      staticGeneration: {},
      serviceDates: [],
      sourceTimestamp: Math.floor(NOW / 1000) - 20,
      fetchedAt: NOW - 1000,
    },
    trips: Object.fromEntries(
      Array.from({ length: trips }, (_, i) => [
        `T${i}${pad}`,
        { key: `T${i}`, rel: 'SCHEDULED', ts: 1, updates: [] },
      ]),
    ),
    vehicles: [],
    alerts: [],
  })
const head = { seq: 7, sourceTimestamp: Math.floor(NOW / 1000) - 20, fetchedAt: NOW - 1000, cycleMs: 15_000 }
const sections = (): CombinedSection[] => [
  { mode: 'bus', json: doc(7, 400), seq: 7 },
  { mode: 'ferry', json: doc(5, 3), seq: 5 },
  { mode: 'train', json: doc(7, 40), seq: 7 },
]
const pointer = (combinedSeq = 7) =>
  new TextEncoder().encode(
    JSON.stringify({
      seq: 7,
      files: {},
      combined: { key: COMBINED_KEY, seq: combinedSeq },
      fetchedAt: NOW,
      status: { seq: 7, sourceTimestamp: head.sourceTimestamp, fetchedAt: head.fetchedAt, generations: {} },
    }),
  )
const files = (object = encodeCombined(head, sections())) =>
  new Map<string, Uint8Array>([
    [COMBINED_KEY, object],
    [R2_LATEST_KEY, pointer()],
  ])

describe('combined mode object format', () => {
  it('round trips, smallest section first, with a padded ASCII index', () => {
    const bytes = encodeCombined(head, sections())
    const got = decodeCombined(bytes)
    expect(got?.index).toMatchObject({ v: 1, seq: 7, size: bytes.byteLength, cycleMs: 15_000 })
    expect(got?.docs.map((d) => d.mode)).toEqual(['ferry', 'train', 'bus'])
    for (const s of sections()) expect(got?.docs.find((d) => d.mode === s.mode)).toEqual(s)
    expect(got?.index.sections.ferry?.[0]).toBe(INDEX_BYTES)
    expect(bytes[INDEX_BYTES - 1]).toBe(0x20)
  })

  it('carries non-ASCII text by byte offsets', () => {
    const s: CombinedSection[] = [
      { mode: 'ferry', json: doc(1, 2, 'é→'), seq: 1 },
      { mode: 'tram', json: doc(1, 1, '🚋'), seq: 1 },
    ]
    expect(
      decodeCombined(encodeCombined({ ...head, seq: 1 }, s))
        ?.docs.map((d) => d.json)
        .sort(),
    ).toEqual(s.map((d) => d.json).sort())
  })

  it('rejects an index that disagrees with the object, and sections outside it', () => {
    const bytes = encodeCombined(head, sections())
    expect(parseIndex(bytes, bytes.byteLength + 1)).toBeNull()
    expect(decodeCombined(bytes.subarray(0, bytes.byteLength - 10))).toBeNull()
    const bad = JSON.parse(new TextDecoder().decode(bytes.subarray(0, INDEX_BYTES)))
    bad.sections.ferry[1] = bytes.byteLength
    const forged = bytes.slice()
    forged.fill(0x20, 0, INDEX_BYTES)
    forged.set(new TextEncoder().encode(JSON.stringify(bad)), 0)
    expect(parseIndex(forged, forged.byteLength)).toBeNull()
    expect(parseIndex(new TextEncoder().encode('not json'.padEnd(INDEX_BYTES)), INDEX_BYTES)).toBeNull()
  })

  it('a garbled section fails its seq check rather than parse as another document', () => {
    const bytes = encodeCombined(head, sections())
    const index = parseIndex(bytes, bytes.byteLength)
    const [off] = index?.sections.ferry ?? [0]
    const garbled = bytes.slice()
    garbled.set(new TextEncoder().encode('{"header":{"schemaVersion":1,"seq":9'), off)
    expect(decodeCombined(garbled)).toBeNull()
  })
})

describe('combined object reads (pullFromR2)', () => {
  it('cold: index then section; warm: one ranged GET of index + section; seq-unchanged answers carry no JSON', async () => {
    resetRangeHints()
    const src = new MemoryDataSource(files())
    const a = await pullFromR2(src, null, 'ferry', NOW)
    expect(a.seq).toBe(5)
    expect(a.json).toBe(doc(5, 3))
    expect(a.status).toMatchObject({
      seq: 7,
      sourceTimestamp: head.sourceTimestamp,
      fetchedAt: head.fetchedAt,
    })
    // A cold isolate assumes per-mode documents (the default layout): its probe misses, the pointer names the
    // combined object, then the index and its section (pinned to the same object version). From then on it starts
    // with the combined object.
    expect(src.reads).toEqual([
      'rt/ferry/latest.json',
      R2_LATEST_KEY,
      `${COMBINED_KEY}@0+${INDEX_BYTES}`,
      expect.stringMatching(/@1024\+\d+$/),
    ])
    src.reads.length = 0
    const b = await pullFromR2(src, 5, 'ferry', NOW)
    expect(b).toMatchObject({ seq: 5, json: null })
    expect(src.reads).toHaveLength(1)
    // The ferry read stays small: the index and the ferry section, not the bus one.
    const n = Number(/\+(\d+)$/.exec(src.reads[0] as string)?.[1])
    expect(n).toBeLessThan(INDEX_BYTES + doc(5, 3).length * 2 + 8192)
  })

  it('a mode the object has no section for reads as no snapshot, with the hub status', async () => {
    const r = await pullFromR2(new MemoryDataSource(files()), null, 'tram', NOW)
    expect(r).toMatchObject({ seq: null, json: null })
    expect(r.status.seq).toBe(7)
  })

  it('a truncated object fails safe: retried, then an error (the client keeps its copy, stale)', async () => {
    resetRangeHints()
    const whole = encodeCombined(head, sections())
    const src = new MemoryDataSource(files(whole.slice(0, whole.byteLength - 100)))
    await expect(pullFromR2(src, null, 'bus', NOW)).rejects.toThrow(/inconsistent/)
    // Two probes, the pointer (which still names the combined layout), two more: bounded.
    expect(src.reads.filter((r) => r.startsWith(`${COMBINED_KEY}@0+`))).toHaveLength(4)
    expect(src.reads.filter((r) => r === R2_LATEST_KEY)).toHaveLength(1)
    // Through the client: a good copy, then the object is truncated. The copy is kept and turns stale, never null.
    let t = NOW
    const good = new MemoryDataSource(files(whole))
    const client = new SnapshotClient(
      { pull: (s, sc) => pullFromR2(good, s, sc, t), getRaw: async () => null },
      () => t,
      () => {},
      null,
      'bus',
      60_000,
    )
    expect((await client.get())?.seq).toBe(7)
    good.files.set(COMBINED_KEY, whole.slice(0, whole.byteLength - 100))
    t += 70_000
    const kept = await client.get()
    expect(kept?.seq).toBe(7)
    expect(client.expired).toBe(true)
  })

  it('an object replaced between the index read and the section read is re-read, never mixed', async () => {
    resetRangeHints()
    const src = new MemoryDataSource(files())
    const next: CombinedSection[] = sections().map((s) =>
      s.mode === 'bus' ? { mode: 'bus', json: doc(8, 410), seq: 8 } : s,
    )
    const replaced = encodeCombined({ ...head, seq: 8 }, next)
    // The first read of the cold path (index only) sees the old object; then the hub replaces it.
    const realRange = src.getRange.bind(src)
    let reads = 0
    src.getRange = async (key: string, offset: number, length: number, etag?: string) => {
      const r: RangeRead | 'changed' | null = await realRange(key, offset, length, etag)
      if (++reads === 1) src.files.set(COMBINED_KEY, replaced)
      return r
    }
    const r = await pullFromR2(src, null, 'bus', NOW)
    expect(r.seq).toBe(8)
    expect(r.json).toBe(doc(8, 410))
    // index (old), section pinned to the old etag ('changed'), then a fresh index + section of the new object.
    expect(reads).toBeGreaterThanOrEqual(3)
  })

  it('an old object takes its status from the pointer; a pointer naming a newer object makes it re-read', async () => {
    const src = new MemoryDataSource(files())
    const later = NOW + 120_000
    const r = await pullFromR2(src, null, 'ferry', later)
    expect(r.seq).toBe(5)
    expect(src.reads.at(-1)).toBe(R2_LATEST_KEY)
    // The pointer already names seq 9 (written after our object read): re-read, and with nothing newer, fail safe.
    src.files.set(R2_LATEST_KEY, pointer(9))
    await expect(pullFromR2(src, null, 'ferry', later)).rejects.toThrow(/older than the pointer/)
  })

  it('a source without ranged reads gets the same answer from one whole read', async () => {
    const mem = new MemoryDataSource(files())
    const plain = { kind: 'memory' as const, get: (k: string) => mem.get(k) }
    const r = await pullFromR2(plain, null, 'train', NOW)
    expect(r).toMatchObject({ seq: 7, json: doc(7, 40) })
  })

  it('Codex A2 r1: the first combined publish landing between the probe and the pointer read is followed', async () => {
    resetRangeHints()
    const object = encodeCombined(head, sections())
    const src = new MemoryDataSource(new Map([[R2_LATEST_KEY, pointer()]]))
    const realRange = src.getRange.bind(src)
    src.getRange = async (key: string, offset: number, length: number, etag?: string) => {
      const r = await realRange(key, offset, length, etag)
      src.files.set(COMBINED_KEY, object) // the hub publishes right after our first probe
      return r
    }
    const r = await pullFromR2(src, null, 'ferry', NOW)
    expect(r).toMatchObject({ seq: 5, json: doc(5, 3) })
  })

  it('Codex A2 r1: a corrupt abandoned combined object never blocks the per-mode documents the pointer names', async () => {
    const whole = encodeCombined(head, sections())
    const legacyDoc = doc(9, 2)
    const legacyPointer = {
      seq: 9,
      files: { ferry: { key: 'rt/ferry/latest.json', seq: 9 } },
      fetchedAt: NOW,
      status: { seq: 9, sourceTimestamp: head.sourceTimestamp, fetchedAt: NOW - 1000, generations: {} },
    }
    const src = new MemoryDataSource(
      new Map([
        [COMBINED_KEY, whole.slice(0, whole.byteLength - 100)],
        [R2_LATEST_KEY, new TextEncoder().encode(JSON.stringify(legacyPointer))],
        ['rt/ferry/latest.json', new TextEncoder().encode(legacyDoc)],
      ]),
    )
    expect(await pullFromR2(src, null, 'ferry', NOW)).toMatchObject({ seq: 9, json: legacyDoc })
  })

  it('Codex A2 r1: without ranged reads, index and section come from one whole read (one version)', async () => {
    const mem = new MemoryDataSource(files())
    // Each whole read sees a different version: the second moves train into ferry's former bytes.
    const swapped = encodeCombined(head, [
      { mode: 'ferry', json: doc(7, 40), seq: 7 },
      { mode: 'train', json: doc(5, 3), seq: 5 },
      { mode: 'bus', json: doc(7, 400), seq: 7 },
    ])
    let n = 0
    const plain = {
      kind: 'memory' as const,
      get: async (k: string) => {
        const o = await mem.get(k)
        if (k === COMBINED_KEY && ++n === 1) mem.files.set(COMBINED_KEY, swapped)
        return o
      },
    }
    const r = await pullFromR2(plain, null, 'ferry', NOW)
    expect(r).toMatchObject({ seq: 5, json: doc(5, 3) })
    expect(n).toBe(1)
  })

  it('Codex A2 r2: the hub switching to combined between a documents pointer read and its retry is followed', async () => {
    resetRangeHints()
    const object = encodeCombined(head, sections())
    const docsPointer = {
      seq: 4,
      files: { ferry: { key: 'rt/ferry/latest.json', seq: 4 } },
      fetchedAt: NOW,
      status: { seq: 4, sourceTimestamp: head.sourceTimestamp, fetchedAt: NOW - 1000, generations: {} },
    }
    // No per-mode object yet holds seq 4 (it is being written), so the documents path re-reads the pointer; by then
    // the hub has switched to the combined object.
    const src = new MemoryDataSource(
      new Map([[R2_LATEST_KEY, new TextEncoder().encode(JSON.stringify(docsPointer))]]),
    )
    const realGet = src.get.bind(src)
    let pointerReads = 0
    src.get = async (k: string) => {
      if (k === R2_LATEST_KEY && ++pointerReads === 2) {
        src.files.set(COMBINED_KEY, object)
        src.files.set(R2_LATEST_KEY, pointer())
      }
      return realGet(k)
    }
    const r = await pullFromR2(src, null, 'ferry', NOW)
    expect(r).toMatchObject({ seq: 5, json: doc(5, 3) })
  })

  it('steady state is one GET per refresh in either layout', async () => {
    resetRangeHints()
    // Combined: learned after the first read.
    const c = new MemoryDataSource(files())
    await pullFromR2(c, null, 'ferry', NOW)
    c.reads.length = 0
    await pullFromR2(c, 5, 'ferry', NOW)
    expect(c.reads).toHaveLength(1)
    // Per-mode documents (the default layout): a fresh per-mode object is one GET, with no combined probe.
    resetRangeHints()
    const legacy = new MemoryDataSource(
      new Map([
        ['rt/ferry/latest.json', new TextEncoder().encode(doc(9, 2))],
        [R2_LATEST_KEY, pointer()],
      ]),
    )
    await pullFromR2(legacy, null, 'ferry', NOW)
    expect(legacy.reads).toEqual(['rt/ferry/latest.json'])
  })
})
