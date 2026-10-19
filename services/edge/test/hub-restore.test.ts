import type { Mode } from '@bft/core'
import { describe, expect, it } from 'vitest'
import { COMBINED_KEY, decodeCombined, encodeCombined, parseIndex } from '../src/rt/combined.ts'
import { parseRtModes } from '../src/rt/feeds.ts'
import { CYCLE_MS, HubCore, modeLatestKey, R2_LATEST_KEY, scopeKey, snapshotSeq } from '../src/rt/hub-core.ts'
import {
  alert,
  buildTree,
  Clock,
  D,
  epoch,
  FakeStorage,
  FakeUpstream,
  feed,
  storeFor,
  tripUpdate,
  vehicle,
} from './fixtures.ts'

/** An R2 fake whose reads of one key can be held open, and that records the header seq of every PUT. */
class GatedR2 {
  readonly files = new Map<string, string>()
  /** `key@seq` per PUT, in order. */
  readonly puts: string[] = []
  /** Reads per key. */
  readonly gets = new Map<string, number>()
  failGets = 0
  private gate: { key: string; open: Promise<void> } | null = null
  /** Hold every read of `key` until the returned release() is called. */
  hold(key: string): () => void {
    let release = () => {}
    const open = new Promise<void>((r) => {
      release = r
    })
    this.gate = { key, open }
    return () => {
      this.gate = null
      release()
    }
  }
  /** PUTs of these keys fail (after nothing is written). */
  readonly failPuts = new Set<string>()
  async put(key: string, value: Uint8Array | string) {
    if (this.failPuts.has(key)) throw new Error(`r2 put ${key} failed`)
    const text = typeof value === 'string' ? value : new TextDecoder().decode(value)
    this.puts.push(
      `${key}@${key === R2_LATEST_KEY ? JSON.parse(text).seq : key === COMBINED_KEY ? combinedSeq(text) : snapshotSeq(text)}`,
    )
    this.files.set(key, text)
  }
  async get(key: string) {
    this.gets.set(key, (this.gets.get(key) ?? 0) + 1)
    if (this.gate?.key === key) await this.gate.open
    if (this.failGets > 0) {
      this.failGets--
      throw new Error('r2 get failed')
    }
    const t = this.files.get(key)
    return t != null ? { text: async () => t } : null
  }
}

/** The index seq of a combined object held as text (it is JSON and spaces throughout). */
const combinedSeq = (text: string) => parseIndex(new TextEncoder().encode(text), undefined)?.seq ?? null

const TU = 'TripUpdates/Ferry'
const VP = 'VehiclePositions/Ferry'

function setup(modes = 'ferry', layout: 'documents' | 'combined' = 'documents') {
  const clock = new Clock(epoch(D, '07:55:00') * 1000)
  const tree = buildTree()
  const up = new FakeUpstream()
  const storage = new FakeStorage()
  const r2 = new GatedR2()
  const mk = (l = layout) =>
    new HubCore({
      storage,
      fetch: up.fetch,
      now: clock.now,
      store: storeFor(tree, clock.now),
      config: parseRtModes(modes),
      upstream: 'https://up.test/api/realtime/SEQ',
      fetchTimeoutMs: 50,
      r2,
      layout: l,
    })
  const nowS = () => Math.floor(clock.t / 1000)
  /** New feed content, so the next cycle rebuilds (and publishes) a new seq. */
  const change = (n: number) => {
    up.set(
      TU,
      feed(nowS(), [
        tripUpdate('e1', { tripId: 'T1', startDate: D, routeId: 'F1-4055' }, [
          { seq: 1, stopId: '317584', depTime: epoch(D, '08:02:00') + n },
        ]),
      ]),
    )
    up.set(VP, feed(nowS(), [vehicle('V1', 'T1', D, -27.45, 153.05 + n / 1e4)]))
  }
  change(0)
  up.set('alerts', feed(nowS(), [alert('a1', 'Bulimba works', 'F1-4055')]))
  return { clock, up, storage, r2, mk, change, nowS }
}

/**
 * Let every runnable promise chain finish: enough macrotask turns for a whole cycle (the trip-index gunzip takes a
 * few), so a cycle that did not wait for the held restore would have built and published by now.
 */
async function settle() {
  for (let i = 0; i < 50; i++) await new Promise((r) => setTimeout(r, 0))
}

const docSeq = (r2: GatedR2) => snapshotSeq(r2.files.get(modeLatestKey('ferry')) as string)
/** The seqs of the ferry document's PUTs, in order. */
const ferryPuts = (r2: GatedR2) =>
  r2.puts.filter((p) => p.startsWith(`${modeLatestKey('ferry')}@`)).map((p) => Number(p.split('@')[1]))

/** A hub that has published a few seqs, then a fresh instance (eviction or deploy) over the same storage and R2. */
async function restarted(modes = 'ferry', layout: 'documents' | 'combined' = 'documents') {
  const h = setup(modes, layout)
  const first = h.mk()
  for (let i = 1; i <= 3; i++) {
    h.change(i)
    await first.alarm()
    h.clock.advance(CYCLE_MS)
  }
  const published = (
    layout === 'combined' ? combinedSeq(h.r2.files.get(COMBINED_KEY) as string) : docSeq(h.r2)
  ) as number
  expect(published).toBeGreaterThan(0)
  h.change(10)
  return { ...h, published, hub: h.mk() }
}

describe('RtHub restore: one shared in-flight restore (Codex r1/r2 on #96)', () => {
  it('a cycle during a slow restore waits for it, then publishes past the restored seq', async () => {
    const { r2, hub, published } = await restarted()
    const putsBefore = r2.puts.length
    const release = r2.hold(R2_LATEST_KEY)
    // A pull (from the API) starts the restore and is held on the pointer read; the alarm's cycle arrives meanwhile.
    const pull = hub.pull(null)
    const alarm = hub.alarm()
    await settle()
    // Nothing built or published yet: the cycle is waiting on the same restore.
    expect(r2.puts.length).toBe(putsBefore)
    expect(hub.status().seq).toBeNull()
    release()
    const [pulled] = await Promise.all([pull, alarm])
    expect(pulled.seq).toBe(published)
    expect(docSeq(r2)).toBe(published + 1)
    expect((await hub.pull(null)).seq).toBe(published + 1)
    // The restored hub's first publish writes every document and the pointer (its change-only state starts empty).
    const after = r2.puts.slice(putsBefore).map((p) => p.split('@')[0] as string)
    expect(after).toEqual(expect.arrayContaining([modeLatestKey('ferry'), R2_LATEST_KEY]))
    expect(after.some((k) => k.startsWith('rt/alerts/'))).toBe(true)
    expect(after.at(-1)).toBe(R2_LATEST_KEY)
  })

  it('the restore cannot overwrite a newer state: a later pull sees the cycle’s seq, not the restored one', async () => {
    const { r2, hub, published } = await restarted()
    // The restore has read the pointer and the ferry document and is held on the alerts ring slot when the alarm's
    // cycle arrives (holding the ferry read instead would let the restore pick up the cycle's own newer document).
    const pointer = JSON.parse(r2.files.get(R2_LATEST_KEY) as string)
    const release = r2.hold(pointer.files.alerts.key)
    const pull = hub.pull(null)
    await settle()
    const alarm = hub.alarm()
    await settle()
    release()
    await Promise.all([pull, alarm])
    const now = await hub.pull(null)
    expect(now.seq).toBe(published + 1)
    expect(JSON.parse(now.json as string).header.seq).toBe(published + 1)
    expect(docSeq(r2)).toBe(published + 1)
  })

  it('concurrent callers share one restore (the pointer is read once)', async () => {
    const { r2, hub } = await restarted()
    const release = r2.hold(R2_LATEST_KEY)
    r2.gets.clear()
    const all = Promise.all([hub.pull(null), hub.ensureRunning(), hub.cycle(), hub.pull(null, 'ferry')])
    await settle()
    release()
    await all
    // One restore: each of the pointer, the ferry document, the alerts document and (for its seq only, Codex r11)
    // the combined object's key is read once.
    expect([...r2.gets.values()]).toEqual([1, 1, 1, 1])
    expect(r2.gets.get(R2_LATEST_KEY)).toBe(1)
  })

  it('seq is monotonic across restarts (storage lost), concurrent restores and cycles', async () => {
    const { r2, mk, change, clock, storage, published } = await restarted()
    let hub = mk()
    for (let round = 0; round < 3; round++) {
      // The object's own storage is lost too, so R2 is the only record of the published seq.
      storage.data.clear()
      const release = r2.hold(R2_LATEST_KEY)
      const calls = [hub.pull(null), hub.alarm(), hub.ensureRunning()]
      await settle()
      release()
      await Promise.all(calls)
      for (let i = 0; i < 2; i++) {
        clock.advance(CYCLE_MS)
        change(100 * round + i)
        await hub.alarm()
      }
      hub = mk() // evicted again
    }
    const seqs = ferryPuts(r2)
    for (let i = 1; i < seqs.length; i++) expect(seqs[i]).toBeGreaterThan(seqs[i - 1] as number)
    expect(seqs.at(-1)).toBeGreaterThanOrEqual(published + 9)
  })

  it('a failed restore applies nothing and is retried by the next call', async () => {
    const { r2, hub, published } = await restarted()
    // The pointer read succeeds, the ferry document read fails: the seq it already learnt must not leak in.
    const puts = r2.puts.length
    const orig = r2.get.bind(r2)
    let failed = false
    r2.get = async (key: string) => {
      if (key === modeLatestKey('ferry') && !failed) {
        failed = true
        throw new Error('r2 get failed')
      }
      return orig(key)
    }
    await expect(hub.pull(null)).rejects.toThrow('r2 get failed')
    expect(hub.status().seq).toBeNull()
    // The alarm swallows the error into lastError and keeps the chain; nothing is published from a failed restore.
    expect(r2.puts.length).toBe(puts)
    const retried = await hub.pull(null)
    expect(retried.seq).toBe(published)
    await hub.alarm()
    expect(docSeq(r2)).toBe(published + 1)
  })

  it('an alarm whose restore fails records the error and the next alarm restores and publishes', async () => {
    const { r2, hub, clock, published } = await restarted()
    r2.failGets = 1
    await hub.alarm()
    expect(hub.status().lastError).toContain('r2 get failed')
    expect(docSeq(r2)).toBe(published)
    clock.advance(CYCLE_MS)
    await hub.alarm()
    expect(docSeq(r2)).toBe(published + 1)
    expect(hub.status().lastError).toBeNull()
  })

  it('a malformed stored snapshot counts as missing: the restore completes and seq continues (Codex r1)', async () => {
    const h = setup()
    h.storage.data.set('meta', { seq: 12, lastCycleAt: 0, lastError: null, alertsAt: 0, snapChunks: 1 })
    h.storage.data.set('snap:0', '{invalid')
    const hub = new HubCore({
      storage: h.storage,
      fetch: h.up.fetch,
      now: h.clock.now,
      store: storeFor(buildTree(), h.clock.now),
      config: parseRtModes('ferry'),
      upstream: 'https://up.test/api/realtime/SEQ',
      fetchTimeoutMs: 50,
    })
    expect((await hub.pull(null)).seq).toBeNull()
    await hub.alarm()
    expect((await hub.pull(null)).seq).toBe(13)
  })

  it('a malformed R2 document counts as missing: the restore completes and publishes past the pointer', async () => {
    const { r2, hub, published } = await restarted()
    r2.files.set(modeLatestKey('ferry'), `{"header":{"schemaVersion":1,"seq":${published},`)
    expect((await hub.pull(null)).seq).toBeNull()
    await hub.alarm()
    expect(docSeq(r2)).toBe(published + 1)
  })

  it('an unusable mode document does not stop the restore reading the others’ seqs (Codex r2)', async () => {
    const { r2, hub, storage, published } = await restarted('ferry,train')
    // The train document is newer than the pointer (#97 skips pointer writes), the ferry one is malformed, and the
    // object's own storage is lost: only the train document's header says how far the seq has gone.
    const train = r2.files.get(modeLatestKey('train')) as string
    const trainSeq = snapshotSeq(train) as number
    r2.files.set(modeLatestKey('train'), train.replace(`"seq":${trainSeq},`, `"seq":${published + 5},`))
    r2.files.set(modeLatestKey('ferry'), `{"header":{"schemaVersion":1,"seq":${published},`)
    storage.data.clear()
    await hub.alarm()
    expect(docSeq(r2)).toBe(published + 6)
  })

  it('an alerts document with a malformed alert restores without alerts, and a scoped pull works (Codex r6)', async () => {
    const { r2, hub, published } = await restarted()
    const pointer = JSON.parse(r2.files.get(R2_LATEST_KEY) as string)
    const slot = JSON.parse(r2.files.get(pointer.files.alerts.key) as string)
    slot.alerts = [{}]
    r2.files.set(pointer.files.alerts.key, JSON.stringify(slot))
    const ferry = await hub.pull(null, 'ferry')
    expect(ferry.seq).toBe(published)
    expect(JSON.parse(ferry.json as string).alerts).toEqual([])
    // Alerts are refetched on the next cycle (the restore marked them stale).
    await hub.alarm()
    expect(docSeq(r2)).toBe(published + 1)
    expect(JSON.parse((await hub.pull(null, 'alerts')).json as string).alerts.length).toBe(1)
  })

  it('a document whose header seq is not a number counts as missing; later documents are still read (Codex r8)', async () => {
    const { r2, hub, storage, published } = await restarted('ferry,train')
    // Ferry's seq is an object that can't be compared; train's document is ahead of the pointer.
    r2.files.set(modeLatestKey('ferry'), '{"header":{"seq":{"valueOf":null,"toString":null}}}')
    const train = r2.files.get(modeLatestKey('train')) as string
    const trainSeq = snapshotSeq(train) as number
    r2.files.set(modeLatestKey('train'), train.replace(`"seq":${trainSeq},`, `"seq":${published + 3},`))
    storage.data.clear()
    expect((await hub.pull(null)).seq).toBeNull()
    await hub.alarm()
    expect(docSeq(r2)).toBe(published + 4)
  })

  it('a vehicle whose mode is not a known mode counts the document as missing (Codex r9)', async () => {
    const { r2, hub, published } = await restarted()
    const doc = JSON.parse(r2.files.get(modeLatestKey('ferry')) as string)
    expect(doc.vehicles.length).toBeGreaterThan(0)
    doc.vehicles[0].mode = 'constructor'
    r2.files.set(modeLatestKey('ferry'), JSON.stringify(doc))
    expect((await hub.pull(null, 'ferry')).seq).toBeNull()
    await hub.alarm()
    expect(docSeq(r2)).toBe(published + 1)
    expect((await hub.pull(null, 'ferry')).seq).toBe(published + 1)
  })

  it('a trip whose `until` is not a number, or a non-string service date, counts the document as missing', async () => {
    for (const edit of [
      (doc: { trips: Record<string, { until?: unknown }> }) => {
        const first = Object.keys(doc.trips)[0] as string
        ;(doc.trips[first] as { until?: unknown }).until = { valueOf: null }
      },
      (doc: { header: { serviceDates: unknown[] } }) => {
        doc.header.serviceDates = [{ toString: null }]
      },
    ]) {
      const { r2, hub, published } = await restarted()
      const doc = JSON.parse(r2.files.get(modeLatestKey('ferry')) as string)
      edit(doc)
      r2.files.set(modeLatestKey('ferry'), JSON.stringify(doc))
      expect((await hub.pull(null, 'ferry')).seq).toBeNull()
      await hub.alarm()
      expect(docSeq(r2)).toBe(published + 1)
    }
  })

  it('a non-string staticGeneration value counts the document as missing (Codex r10)', async () => {
    const { r2, hub, published } = await restarted()
    const doc = JSON.parse(r2.files.get(modeLatestKey('ferry')) as string)
    doc.header.staticGeneration.ferry = { bad: true }
    r2.files.set(modeLatestKey('ferry'), JSON.stringify(doc))
    expect((await hub.pull(null, 'ferry')).seq).toBeNull()
    await hub.alarm()
    expect(docSeq(r2)).toBe(published + 1)
  })
})

describe('RtHub restore, combined layout (RT_R2_LAYOUT=combined, #99)', () => {
  const objSeq = (r2: GatedR2) => combinedSeq(r2.files.get(COMBINED_KEY) as string)

  it('a cycle during a restore held on the combined object waits for it, then publishes past it', async () => {
    const { r2, hub, published } = await restarted('ferry', 'combined')
    expect(JSON.parse(r2.files.get(R2_LATEST_KEY) as string).combined.key).toBe(COMBINED_KEY)
    const putsBefore = r2.puts.length
    const release = r2.hold(COMBINED_KEY)
    const pull = hub.pull(null)
    const alarm = hub.alarm()
    await settle()
    expect(r2.puts.length).toBe(putsBefore)
    expect(hub.status().seq).toBeNull()
    release()
    const [pulled] = await Promise.all([pull, alarm])
    expect(pulled.seq).toBe(published)
    expect(objSeq(r2)).toBe(published + 1)
    expect((await hub.pull(null)).seq).toBe(published + 1)
    // The first publish after the restore rewrites the combined object, the alerts slot and the pointer, pointer last.
    const after = r2.puts.slice(putsBefore).map((p) => p.split('@')[0] as string)
    expect(after).toEqual(expect.arrayContaining([COMBINED_KEY, R2_LATEST_KEY]))
    expect(after.some((k) => k.startsWith('rt/alerts/'))).toBe(true)
    expect(after.at(-1)).toBe(R2_LATEST_KEY)
  })

  it('the restore cannot overwrite a newer state (held on the alerts slot after reading the object)', async () => {
    const { r2, hub, published } = await restarted('ferry', 'combined')
    const pointer = JSON.parse(r2.files.get(R2_LATEST_KEY) as string)
    const release = r2.hold(pointer.files.alerts.key)
    const pull = hub.pull(null)
    await settle()
    const alarm = hub.alarm()
    await settle()
    release()
    await Promise.all([pull, alarm])
    const now = await hub.pull(null)
    expect(now.seq).toBe(published + 1)
    expect(JSON.parse(now.json as string).header.seq).toBe(published + 1)
  })

  it('an unusable combined object still contributes its index seq (never reuse a published seq)', async () => {
    const { r2, hub, storage, published } = await restarted('ferry', 'combined')
    // The object is ahead of the pointer and one section is corrupt; the object's own storage is lost.
    const text = r2.files.get(COMBINED_KEY) as string
    const index = text
      .slice(0, 1024)
      .trimEnd()
      .replace(`"seq":${published},`, `"seq":${published + 5},`)
    const body = text.slice(1024).replace('{"header"', 'X"header"')
    r2.files.set(COMBINED_KEY, index.padEnd(1024, ' ') + body)
    storage.data.clear()
    expect((await hub.pull(null)).seq).toBeNull()
    await hub.alarm()
    expect(objSeq(r2)).toBe(published + 6)
  })

  /** The restarted hub's combined object with its index edited (re-padded to the index size) and body replaced. */
  function editObject(
    r2: GatedR2,
    index: (idx: Record<string, unknown>) => void,
    body?: (b: string) => string,
  ) {
    const text = r2.files.get(COMBINED_KEY) as string
    const idx = JSON.parse(text.slice(0, 1024))
    index(idx)
    const rest = text.slice(1024)
    r2.files.set(COMBINED_KEY, JSON.stringify(idx).padEnd(1024, ' ') + (body ? body(rest) : rest))
  }

  it('an index with an invalid section range still gives its seq (Codex r4)', async () => {
    const { r2, hub, storage, published } = await restarted('ferry', 'combined')
    editObject(r2, (idx) => {
      idx.seq = published + 1
      ;(idx.sections as Record<string, number[]>).ferry = [0, 1, published + 1]
    })
    storage.data.clear()
    expect((await hub.pull(null)).seq).toBeNull()
    await hub.alarm()
    expect(objSeq(r2)).toBe(published + 2)
  })

  it('a malformed index (sections: null) counts as missing, not a restore that fails forever (Codex r4)', async () => {
    const { r2, hub, published } = await restarted('ferry', 'combined')
    editObject(r2, (idx) => {
      idx.sections = null
    })
    expect((await hub.pull(null)).seq).toBeNull()
    await hub.alarm()
    expect(objSeq(r2)).toBe(published + 1)
  })

  it('a section that is JSON but not a snapshot (no trips) counts as missing (Codex r4)', async () => {
    const { r2, hub, published } = await restarted('ferry', 'combined')
    // Same length, so the index's offsets still hold: the section parses but has no `trips`.
    editObject(
      r2,
      () => {},
      (b) => b.replace('"trips":', '"tripz":'),
    )
    expect((await hub.pull(null)).seq).toBeNull()
    await hub.alarm()
    expect(objSeq(r2)).toBe(published + 1)
  })

  it('a section with a malformed trip record counts as missing, so it cannot poison the next build (Codex r5)', async () => {
    const { r2, hub, clock, change, published } = await restarted('ferry', 'combined')
    // Re-encoded (valid offsets and seqs) with the ferry document's first trip record replaced by null.
    const got = decodeCombined(new TextEncoder().encode(r2.files.get(COMBINED_KEY) as string))
    if (!got) throw new Error('combined object did not decode')
    const sections = got.docs.map((d) => {
      const doc = JSON.parse(d.json)
      const first = Object.keys(doc.trips)[0] as string
      doc.trips[first] = null
      return { ...d, json: JSON.stringify(doc) }
    })
    r2.files.set(COMBINED_KEY, new TextDecoder().decode(encodeCombined({ ...got.index }, sections)))
    expect((await hub.pull(null)).seq).toBeNull()
    await hub.alarm()
    expect(objSeq(r2)).toBe(published + 1)
    clock.advance(CYCLE_MS)
    change(20)
    await hub.alarm()
    expect(objSeq(r2)).toBe(published + 2)
  })

  it('an index without a valid seq is rejected, and its section seqs still count (Codex r7)', async () => {
    const { r2, hub, storage, mk, published } = await restarted('ferry', 'combined')
    // Move the object past the pointer: its section is at a later seq than the pointer names.
    const got = decodeCombined(new TextEncoder().encode(r2.files.get(COMBINED_KEY) as string))
    if (!got) throw new Error('combined object did not decode')
    const ahead = published + 2
    const sections = got.docs.map((d) => ({
      ...d,
      seq: ahead,
      json: d.json.replace(`"seq":${d.seq},`, `"seq":${ahead},`),
    }))
    const bytes = encodeCombined({ ...got.index, seq: ahead }, sections)
    r2.files.set(COMBINED_KEY, new TextDecoder().decode(bytes))
    editObject(r2, (idx) => {
      delete idx.seq
    })
    storage.data.clear()
    expect((await hub.pull(null)).seq).toBeNull()
    await hub.alarm()
    expect(objSeq(r2)).toBe(ahead + 1)
    // With a valid index the same object restores, and the next build still goes past it.
    const fresh = mk()
    storage.data.clear()
    expect((await fresh.pull(null)).seq).toBe(ahead + 1)
  })

  it('a section under an unknown mode name makes the object unusable (Codex r10)', async () => {
    const { r2, hub, published } = await restarted('ferry', 'combined')
    const got = decodeCombined(new TextEncoder().encode(r2.files.get(COMBINED_KEY) as string))
    if (!got) throw new Error('combined object did not decode')
    const sections = got.docs.map((d) => ({ ...d, mode: 'constructor' as Mode }))
    r2.files.set(COMBINED_KEY, new TextDecoder().decode(encodeCombined({ ...got.index }, sections)))
    expect((await hub.pull(null, 'ferry')).seq).toBeNull()
    await hub.alarm()
    expect(objSeq(r2)).toBe(published + 1)
    expect((await hub.pull(null, 'ferry')).seq).toBe(published + 1)
  })
})

describe('RtHub restore across a layout switch whose pointer PUT failed (Codex r11)', () => {
  const combinedSeqOf = (r2: GatedR2) => combinedSeq(r2.files.get(COMBINED_KEY) as string)

  for (const [from, to] of [
    ['documents', 'combined'],
    ['combined', 'documents'],
  ] as const) {
    it(`${from} → ${to}: the new layout's seq is never reused after DO storage is lost`, async () => {
      const { r2, mk, storage, clock, change, published } = await restarted('ferry', from)
      // The switched hub's first publish lands its object (and alerts) at published + 1, but not the pointer.
      r2.failPuts.add(R2_LATEST_KEY)
      const switched = mk(to)
      await switched.alarm()
      const landed = to === 'combined' ? combinedSeqOf(r2) : docSeq(r2)
      expect(landed).toBe(published + 1)
      // The pointer (written on its heartbeat) is still behind, and names the old layout.
      expect(JSON.parse(r2.files.get(R2_LATEST_KEY) as string).seq).toBeLessThan(published + 1)
      // Evicted with its storage lost; the pointer recovers.
      r2.failPuts.clear()
      storage.data.clear()
      const fresh = mk(to)
      clock.advance(CYCLE_MS)
      change(30)
      await fresh.alarm()
      const next = to === 'combined' ? combinedSeqOf(r2) : docSeq(r2)
      expect(next).toBe(published + 2)
    })
  }
})

describe('RtHub restore after DO storage loss: an alerts slot only it records (Codex r12)', () => {
  for (const layout of ['documents', 'combined'] as const) {
    it(`${layout}: an alerts PUT that landed while the mode PUT failed keeps its seq`, async () => {
      const { r2, mk, up, storage, clock, change, nowS, published } = await restarted('ferry', layout)
      // New alerts, and the mode PUT fails: only the alerts slot lands, at published + 1, and no pointer follows.
      const modeKey = layout === 'combined' ? COMBINED_KEY : modeLatestKey('ferry')
      r2.failPuts.add(modeKey)
      const hub = mk()
      clock.advance(CYCLE_MS)
      up.set('alerts', feed(nowS(), [alert('a2', 'Riverside closed', 'F1-4055')]))
      await hub.alarm()
      const slot = scopeKey('alerts', published + 1)
      expect(snapshotSeq(r2.files.get(slot) as string)).toBe(published + 1)
      expect(JSON.parse(r2.files.get(R2_LATEST_KEY) as string).seq).toBeLessThan(published + 1)
      // Storage lost; the next build must go past the alerts slot's seq, not reuse it.
      r2.failPuts.clear()
      storage.data.clear()
      const fresh = mk()
      clock.advance(CYCLE_MS)
      change(40)
      await fresh.alarm()
      expect((await fresh.pull(null)).seq).toBe(published + 2)
      expect(snapshotSeq(r2.files.get(slot) as string)).toBe(published + 1)
    })
  }
})
