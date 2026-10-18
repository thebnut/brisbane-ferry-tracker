import { createHash } from 'node:crypto'
import { type GenerationIndex, type Manifest, SCHEMA_VERSION } from '@bft/core'
import { describe, expect, it } from 'vitest'
// @ts-expect-error untyped local Worker module
import uploader from '../r2-uploader/worker.js'
import { blobKey, shardKey } from '../src/build/blobs.ts'
import {
  applyGc,
  collectablePrefix,
  DELETE_BATCH,
  GcAbort,
  GcBatchError,
  type GcStore,
  generationOf,
  type ListedObject,
  planGc,
} from '../src/gc/gc.ts'
import { parseListObjectsV2, R2Target, UploaderTarget } from '../src/publish/targets.ts'

const NOW = Date.parse('2026-10-25T17:15:00Z')
const H = 3_600_000
const D = 24 * H
const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const enc = (v: unknown) => new TextEncoder().encode(typeof v === 'string' ? v : JSON.stringify(v))

class MemStore implements GcStore {
  readonly name = 'mem'
  readonly objects = new Map<string, { body: Uint8Array; uploaded: number }>()
  readonly batches: string[][] = []
  put(key: string, body: unknown, ageMs: number) {
    this.objects.set(key, { body: enc(body), uploaded: NOW - ageMs })
  }
  async list(prefix: string): Promise<ListedObject[]> {
    return [...this.objects]
      .filter(([k]) => k.startsWith(prefix))
      .map(([key, o]) => ({ key, size: o.body.length, uploaded: o.uploaded }))
  }
  async get(key: string) {
    return this.objects.get(key)?.body ?? null
  }
  async deleteMany(keys: string[]) {
    expect(keys.length).toBeLessThanOrEqual(DELETE_BATCH)
    this.batches.push(keys)
    for (const k of keys) this.objects.delete(k)
  }
}

function index(
  generation: string,
  mode: 'ferry' | 'bus',
  refs: { blobs?: string[]; shards?: string[]; trip?: string },
) {
  const date = '20261025'
  const idx: GenerationIndex = {
    schemaVersion: SCHEMA_VERSION,
    generation,
    mode,
    feedVersion: 'v',
    builtAt: '2026-10-01T00:00:00Z',
    serviceDates: [date],
    blobs: { [date]: Object.fromEntries((refs.blobs ?? []).map((b, i) => [`s${i}`, b])) },
    ...(refs.trip ? { tripIndex: { [date]: refs.trip } } : {}),
    ...(refs.shards
      ? { shards: { count: 4, hash: 'fnv1a32' as const, byDate: { [date]: [...refs.shards, null] } } }
      : {}),
  }
  return idx
}

function manifest(modes: Manifest['modes'], quarantined: Manifest['quarantined'] = []): Manifest {
  return { schemaVersion: SCHEMA_VERSION, updatedAt: '2026-10-25T17:00:00Z', modes, quarantined }
}

const b = (n: string) => sha(`blob-${n}`)
const s = (n: string) => sha(`shard-${n}`)

/** A bucket with every kind of object the brief lists. */
function fixture() {
  const st = new MemStore()
  const old = 30 * D
  // Live manifest: ferry current + previous, bus current, plus a quarantined ferry generation.
  st.put(
    'manifest.json',
    manifest(
      {
        ferry: {
          current: '20261017-20261216-3305c5ea-0000000000f2',
          previous: '20261017-20261216-3305c5ea-0000000000f1',
          serviceDates: ['20261025'],
        },
        bus: { current: '20261017-20261216-3305c5ea-0000000000b2', serviceDates: ['20261025'] },
      },
      [{ generation: '20261017-20261216-3305c5ea-00000000aa01', mode: 'ferry', reasons: ['swing'] }],
    ),
    old,
  )
  // Staging manifest names a quarantined build awaiting promotion.
  st.put(
    'manifest.staging.json',
    manifest({ ferry: { current: '20261017-20261216-3305c5ea-00000000aa02', serviceDates: ['20261025'] } }),
    old,
  )
  st.put(
    'static/20261017-20261216-3305c5ea-0000000000f2/ferry/index.json',
    index('20261017-20261216-3305c5ea-0000000000f2', 'ferry', {
      blobs: [b('cur'), b('shared')],
      trip: b('trip-cur'),
    }),
    20 * D,
  )
  st.put(
    'static/20261017-20261216-3305c5ea-0000000000f1/ferry/index.json',
    index('20261017-20261216-3305c5ea-0000000000f1', 'ferry', { blobs: [b('prev'), b('shared')] }),
    40 * D,
  )
  st.put(
    'static/20261017-20261216-3305c5ea-0000000000b2/bus/index.json',
    index('20261017-20261216-3305c5ea-0000000000b2', 'bus', { shards: [s('cur')], trip: b('trip-bus') }),
    20 * D,
  )
  st.put(
    'static/20261017-20261216-3305c5ea-00000000aa01/ferry/index.json',
    index('20261017-20261216-3305c5ea-00000000aa01', 'ferry', { blobs: [b('qlive')] }),
    40 * D,
  )
  st.put(
    'static/20261017-20261216-3305c5ea-00000000aa02/ferry/index.json',
    index('20261017-20261216-3305c5ea-00000000aa02', 'ferry', { blobs: [b('qstage')] }),
    20 * D,
  )
  // Not in any manifest, but uploaded 5 days ago: retained for the 14-day window, with what it references.
  st.put(
    'static/20261017-20261216-3305c5ea-00000000cc01/ferry/index.json',
    index('20261017-20261216-3305c5ea-00000000cc01', 'ferry', { blobs: [b('young-ref')] }),
    5 * D,
  )
  // Not in any manifest and old: collectable, along with anything else under its directory.
  st.put(
    'static/20261017-20261216-3305c5ea-00000000dd01/ferry/index.json',
    index('20261017-20261216-3305c5ea-00000000dd01', 'ferry', { blobs: [b('old-ref')] }),
    old,
  )
  st.put(
    'static/20261017-20261216-3305c5ea-00000000dd01/bus/index.json',
    index('20261017-20261216-3305c5ea-00000000dd01', 'bus', { shards: [s('old-ref')] }),
    old,
  )
  st.put('static/20261017-20261216-3305c5ea-00000000dd01/ferry/stray.json', '{}', old)
  for (const n of [
    'cur',
    'shared',
    'trip-cur',
    'prev',
    'trip-bus',
    'qlive',
    'qstage',
    'young-ref',
    'old-ref',
    'orphan',
  ])
    st.put(blobKey(b(n)), `blob ${n}`, old)
  st.put(shardKey(s('cur')), 'shard cur', old)
  st.put(shardKey(s('old-ref')), 'shard old', old)
  st.put(shardKey(s('orphan')), 'shard orphan', old)
  // Unreferenced but younger than 48 h: an in-flight publish.
  st.put(blobKey(b('inflight')), 'blob inflight', 10 * H)
  st.put(shardKey(s('inflight')), 'shard inflight', 47 * H)
  st.put(
    'static/20261017-20261216-3305c5ea-00000000ee01/ferry/index.json',
    index('20261017-20261216-3305c5ea-00000000ee01', 'ferry', {}),
    1 * H,
  )
  // Never candidates, however old.
  for (const k of [
    'data/ferry/stops.json',
    'data/bus/geo/r7hg1.json',
    'legacy/latest.json',
    'rt/ferry/snapshot.json',
    'other/static/blobs/x.json.gz',
    'staging/thing.json',
    'static/blobs/nested/x.json.gz',
    'static/shards/nested/x.json.gz',
    'static/README',
    'statics/blobs/x.json.gz',
  ])
    st.put(k, 'keep', 400 * D)
  // Padding so the real candidates stay under the 60% rail.
  for (let i = 0; i < 20; i++) st.put(blobKey(b(`young-pad-${i}`)), 'pad', H)
  return st
}

const EXPECTED = [
  blobKey(b('old-ref')),
  blobKey(b('orphan')),
  shardKey(s('old-ref')),
  shardKey(s('orphan')),
  'static/20261017-20261216-3305c5ea-00000000dd01/bus/index.json',
  'static/20261017-20261216-3305c5ea-00000000dd01/ferry/index.json',
  'static/20261017-20261216-3305c5ea-00000000dd01/ferry/stray.json',
].sort()

describe('allow-list', () => {
  it.each([
    ['static/blobs/abc.json.gz', 'static/blobs/'],
    ['static/shards/abc.json.gz', 'static/shards/'],
    ['static/20261017-20261216-3305c5ea-0123456789ab/ferry/index.json', 'static/{generation}/'],
    ['static/x-x-0123abcd-0123456789ab/bus/index.json', 'static/{generation}/'],
    ['static/20261017-20261216-3305c5ea-0123456789ab/anything', 'static/{generation}/'],
    ['static/g1/ferry/index.json', null],
    ['static/backups/keep.json', null],
    ['static/20261017-20261216-3305c5ea-0123456789abx/ferry/index.json', null],
    ['manifest.json', null],
    ['manifest.staging.json', null],
    ['data/ferry/stops.json', null],
    ['legacy/latest.json', null],
    ['rt/ferry/x', null],
    ['static/README', null],
    ['static/blobs/nested/x', null],
    ['static/shards/', null],
    ['static/../manifest.json', null],
    ['statics/blobs/x', null],
    ['x/static/blobs/y', null],
    ['', null],
  ])('%s → %s', (key, want) => {
    expect(collectablePrefix(key)).toBe(want)
  })
  it('names generations only for generation directories', () => {
    expect(generationOf('static/20261017-20261216-3305c5ea-0123456789ab/ferry/index.json')).toBe(
      '20261017-20261216-3305c5ea-0123456789ab',
    )
    expect(generationOf('static/g1/ferry/index.json')).toBeNull()
    expect(generationOf('static/blobs/x')).toBeNull()
    expect(generationOf('data/g1/x')).toBeNull()
  })
})

describe('planGc', () => {
  it('selects exactly the unreferenced, old, allow-listed objects', async () => {
    const st = fixture()
    const plan = await planGc(st, { nowMs: NOW })
    expect(plan.candidates.map((c) => c.key)).toEqual(EXPECTED)
    expect(plan.retainedGenerations.map((g) => g.generation)).toEqual(
      [
        '20261017-20261216-3305c5ea-0000000000b2',
        '20261017-20261216-3305c5ea-0000000000f1',
        '20261017-20261216-3305c5ea-0000000000f2',
        '20261017-20261216-3305c5ea-00000000ee01',
        '20261017-20261216-3305c5ea-00000000aa01',
        '20261017-20261216-3305c5ea-00000000aa02',
        '20261017-20261216-3305c5ea-00000000cc01',
      ].sort(),
    )
    expect(plan.keptYoung).toBe(22)
    // The oldest young object is the 47 h shard.
    expect(plan.nextEligibleAt).toBe(new Date(NOW - 47 * H + 48 * H).toISOString())
    expect(plan.byPrefix['static/blobs/'].objects).toBe(2)
    expect(plan.byPrefix['static/shards/'].objects).toBe(2)
    expect(plan.byPrefix['static/{generation}/'].objects).toBe(3)
    expect(plan.before['data/']?.objects).toBe(2)
    expect(plan.before['manifest.json']?.objects).toBe(1)
  })

  it('never selects anything outside the allow-list, even when nothing references it', async () => {
    const st = fixture()
    const plan = await planGc(st, { nowMs: NOW + 1000 * D, maxFraction: 1 })
    for (const c of plan.candidates) expect(collectablePrefix(c.key)).not.toBeNull()
    const keys = new Set(plan.candidates.map((c) => c.key))
    for (const k of st.objects.keys()) if (!collectablePrefix(k)) expect(keys.has(k)).toBe(false)
  })

  it('keeps every key referenced by a retained generation and everything younger than 48 h', async () => {
    const st = fixture()
    const keys = new Set((await planGc(st, { nowMs: NOW })).candidates.map((c) => c.key))
    for (const n of [
      'cur',
      'shared',
      'trip-cur',
      'prev',
      'trip-bus',
      'qlive',
      'qstage',
      'young-ref',
      'inflight',
    ])
      expect(keys.has(blobKey(b(n))), n).toBe(false)
    expect(keys.has(shardKey(s('cur')))).toBe(false)
    expect(keys.has(shardKey(s('inflight')))).toBe(false)
  })

  it('treats an unknown upload time as young', async () => {
    const st = fixture()
    const list = st.list.bind(st)
    st.list = async (p) =>
      (await list(p)).map((o) => (o.key === blobKey(b('orphan')) ? { ...o, uploaded: Number.NaN } : o))
    const keys = (await planGc(st, { nowMs: NOW })).candidates.map((c) => c.key)
    expect(keys).not.toContain(blobKey(b('orphan')))
  })

  it('collects references from every date in an index, not only serviceDates', async () => {
    const st = fixture()
    const key = 'static/20261017-20261216-3305c5ea-0000000000f2/ferry/index.json'
    const idx = JSON.parse(new TextDecoder().decode(st.objects.get(key)?.body)) as GenerationIndex
    idx.tripIndex = { ...idx.tripIndex, '20261101': b('orphan') }
    idx.blobs['20261102'] = { x: b('old-ref') }
    st.put(key, idx, 20 * D)
    const keys = (await planGc(st, { nowMs: NOW })).candidates.map((c) => c.key)
    expect(keys).not.toContain(blobKey(b('orphan')))
    expect(keys).not.toContain(blobKey(b('old-ref')))
  })

  it('never selects directories under static/ that are not named like a generation', async () => {
    const st = fixture()
    for (const k of [
      'static/backups/keep.json',
      'static/gOld/ferry/index.json',
      'static/2026-x/a',
      'static/./a',
    ])
      st.put(k, 'keep', 400 * D)
    const keys = (await planGc(st, { nowMs: NOW })).candidates.map((c) => c.key)
    expect(keys).toEqual(EXPECTED)
  })
})

describe('safety rails abort with nothing deleted', () => {
  const aborts = async (st: MemStore, re: RegExp, maxFraction?: number) => {
    const before = st.objects.size
    await expect(planGc(st, { nowMs: NOW, ...(maxFraction ? { maxFraction } : {}) })).rejects.toThrow(GcAbort)
    await expect(planGc(st, { nowMs: NOW, ...(maxFraction ? { maxFraction } : {}) })).rejects.toThrow(re)
    expect(st.objects.size).toBe(before)
    expect(st.batches).toEqual([])
  }
  it('manifest.json missing', async () => {
    const st = fixture()
    st.objects.delete('manifest.json')
    await aborts(st, /manifest.json is missing/)
  })
  it('manifest.json not JSON', async () => {
    const st = fixture()
    st.put('manifest.json', '{"modes":', D * 30)
    await aborts(st, /not valid JSON/)
  })
  it('manifest.json off-contract', async () => {
    const st = fixture()
    st.put('manifest.json', { schemaVersion: 99, modes: {} }, D * 30)
    await aborts(st, /Manifest contract/)
  })
  it('manifest.json unreadable', async () => {
    const st = fixture()
    st.get = async () => {
      throw new Error('HTTP 500')
    }
    await aborts(st, /cannot read manifest.json/)
  })
  it('manifest.staging.json present but broken', async () => {
    const st = fixture()
    st.put('manifest.staging.json', 'nope', D * 30)
    await aborts(st, /manifest.staging.json is not valid JSON/)
  })
  it.each([
    ['current', '0000000000b2/bus'],
    ['previous', '0000000000f1/ferry'],
    ['live-quarantined', '00000000aa01/ferry'],
    ['staging current', '00000000aa02/ferry'],
  ])('a manifest-referenced (%s) generation index missing', async (_, path) => {
    const st = fixture()
    st.objects.delete(`static/20261017-20261216-3305c5ea-${path}/index.json`)
    await aborts(st, /manifest-referenced generation index/)
  })
  it('a current generation index unparseable', async () => {
    const st = fixture()
    st.put('static/20261017-20261216-3305c5ea-0000000000f2/ferry/index.json', '{', 20 * D)
    await aborts(st, /20261017-20261216-3305c5ea-0000000000f2\/ferry\/index.json is not valid JSON/)
  })
  it('a current generation index unreadable', async () => {
    const st = fixture()
    const get = st.get.bind(st)
    st.get = async (k) =>
      k === 'static/20261017-20261216-3305c5ea-0000000000f2/ferry/index.json' ? null : get(k)
    await aborts(st, /listed but could not be read/)
  })
  it('a retained (young) index off-contract', async () => {
    const st = fixture()
    st.put(
      'static/20261017-20261216-3305c5ea-00000000cc01/ferry/index.json',
      { generation: '20261017-20261216-3305c5ea-00000000cc01' },
      5 * D,
    )
    await aborts(st, /GenerationIndex contract/)
  })
  it('candidates over 60% of static/, unless --max-fraction allows it', async () => {
    const st = fixture()
    for (let i = 0; i < 100; i++) st.put(blobKey(b(`old-orphan-${i}`)), 'x', 30 * D)
    await aborts(st, /over the 60% limit/)
    const plan = await planGc(st, { nowMs: NOW, maxFraction: 0.9 })
    expect(plan.candidates).toHaveLength(EXPECTED.length + 100)
  })
  it('a bad max fraction', async () => {
    await expect(planGc(fixture(), { nowMs: NOW, maxFraction: 0 })).rejects.toThrow(/bad maxFraction/)
    await expect(planGc(fixture(), { nowMs: NOW, maxFraction: 1.5 })).rejects.toThrow(/bad maxFraction/)
  })
})

describe('applyGc', () => {
  it('deletes exactly the plan, in batches of at most 1,000', async () => {
    const st = fixture()
    for (let i = 0; i < 2500; i++) st.put(blobKey(b(`bulk-${i}`)), 'x', 30 * D)
    const plan = await planGc(st, { nowMs: NOW, maxFraction: 1 })
    const keep = [...st.objects.keys()].filter((k) => !plan.candidates.some((c) => c.key === k))
    const deleted = await applyGc(st, plan, { nowMs: () => NOW })
    expect(deleted).toHaveLength(2500 + EXPECTED.length)
    expect(st.batches.map((x) => x.length)).toEqual([1000, 1000, 507])
    expect([...st.objects.keys()].sort()).toEqual(keep.sort())
    expect(st.objects.has('manifest.json')).toBe(true)
  })
  it('refuses a tampered plan with a key outside the allow-list', async () => {
    const st = fixture()
    const plan = await planGc(st, { nowMs: NOW })
    plan.candidates.push({ key: 'manifest.json', size: 1, uploaded: 0 })
    await expect(applyGc(st, plan, { nowMs: () => NOW })).rejects.toThrow(/outside the allow-listed prefixes/)
    expect(st.batches).toEqual([])
  })
  it('skips a key re-uploaded after planning, and one that is gone', async () => {
    const st = fixture()
    const plan = await planGc(st, { nowMs: NOW })
    st.put(blobKey(b('orphan')), 'republished', 0)
    st.objects.delete(shardKey(s('orphan')))
    const deleted = await applyGc(st, plan, { nowMs: () => NOW })
    expect(deleted).toEqual(EXPECTED.filter((k) => k !== blobKey(b('orphan')) && k !== shardKey(s('orphan'))))
    expect(st.objects.has(blobKey(b('orphan')))).toBe(true)
  })
  it('stops before the next batch when the manifests change', async () => {
    const st = fixture()
    for (let i = 0; i < 1500; i++) st.put(blobKey(b(`bulk-${i}`)), 'x', 30 * D)
    const plan = await planGc(st, { nowMs: NOW, maxFraction: 1 })
    const err = await applyGc(st, plan, {
      nowMs: () => NOW,
      onBatch: () => st.put('manifest.json', manifest({}), 0),
    }).catch((e) => e)
    expect(err).toBeInstanceOf(GcBatchError)
    expect(err.message).toMatch(/manifests changed/)
    expect(err.deleted).toHaveLength(1000)
    expect(st.batches).toHaveLength(1)
  })
  it('reports what was deleted, and the failed batch as unknown, when a batch fails', async () => {
    const st = fixture()
    for (let i = 0; i < 1500; i++) st.put(blobKey(b(`bulk-${i}`)), 'x', 30 * D)
    const plan = await planGc(st, { nowMs: NOW, maxFraction: 1 })
    const del = st.deleteMany.bind(st)
    st.deleteMany = async (keys) => {
      if (st.batches.length) throw new Error('HTTP 500')
      await del(keys)
    }
    const reports: number[] = []
    const err = await applyGc(st, plan, {
      nowMs: () => NOW,
      onBatch: (d) => void reports.push(d.length),
    }).catch((e) => e)
    expect(err).toBeInstanceOf(GcBatchError)
    expect(reports).toEqual([1000])
    expect(err.deleted).toHaveLength(1000)
    expect(err.unknown).toHaveLength(plan.candidates.length - 1000)
  })
})

describe('stores', () => {
  it('parses ListObjectsV2 pages', () => {
    const xml = `<?xml version="1.0"?><ListBucketResult><IsTruncated>true</IsTruncated>
      <Contents><Key>static/blobs/a&amp;b.json.gz</Key><Size>12</Size><LastModified>2026-10-18T05:00:00.000Z</LastModified></Contents>
      <Contents><Key>manifest.json</Key><Size>3</Size><LastModified>2026-10-18T06:00:00Z</LastModified></Contents>
      <NextContinuationToken>tok/1=</NextContinuationToken></ListBucketResult>`
    expect(parseListObjectsV2(xml)).toEqual({
      objects: [
        { key: 'static/blobs/a&b.json.gz', size: 12, uploaded: Date.parse('2026-10-18T05:00:00Z') },
        { key: 'manifest.json', size: 3, uploaded: Date.parse('2026-10-18T06:00:00Z') },
      ],
      next: 'tok/1=',
    })
    expect(() => parseListObjectsV2('<IsTruncated>true</IsTruncated>')).toThrow(/continuation token/)
  })

  it('R2 target pages LIST and sends signed DeleteObjects with Content-MD5', async () => {
    const seen: Request[] = []
    const fetchImpl = (async (input: Request) => {
      seen.push(input)
      const url = new URL(input.url)
      if (input.method === 'GET') {
        const second = url.searchParams.get('continuation-token') === 't2'
        return new Response(
          `<ListBucketResult><IsTruncated>${!second}</IsTruncated><Contents><Key>${second ? 'b' : 'a'}</Key><Size>1</Size><LastModified>2026-10-18T05:00:00Z</LastModified></Contents>${second ? '' : '<NextContinuationToken>t2</NextContinuationToken>'}</ListBucketResult>`,
        )
      }
      return new Response('<DeleteResult></DeleteResult>')
    }) as unknown as typeof fetch
    const t = new R2Target(
      {
        accountId: 'acc',
        bucket: 'bkt',
        accessKeyId: 'k',
        secretAccessKey: 's',
        endpoint: 'https://r2.test',
      },
      fetchImpl,
    )
    expect((await t.list('static/')).map((o) => o.key)).toEqual(['a', 'b'])
    expect(new URL(seen[0]?.url as string).searchParams.get('prefix')).toBe('static/')
    await t.deleteMany(['static/blobs/x.json.gz'])
    const del = seen.at(-1) as Request
    expect(del.method).toBe('POST')
    expect(del.url).toBe('https://r2.test/bkt?delete')
    expect(del.headers.get('authorization')).toMatch(/^AWS4-HMAC-SHA256 /)
    const body = await del.text()
    expect(body).toContain('<Key>static/blobs/x.json.gz</Key>')
    expect(del.headers.get('content-md5')).toBe(createHash('md5').update(body).digest('base64'))
    await expect(t.deleteMany(Array.from({ length: 1001 }, (_, i) => `static/blobs/${i}`))).rejects.toThrow(
      /1000/,
    )
  })

  it('R2 target throws when DeleteObjects reports per-key errors', async () => {
    const t = new R2Target(
      { accountId: 'a', bucket: 'b', accessKeyId: 'k', secretAccessKey: 's', endpoint: 'https://r2.test' },
      (async () =>
        new Response(
          '<DeleteResult><Error><Key>x</Key><Code>AccessDenied</Code></Error></DeleteResult>',
        )) as unknown as typeof fetch,
    )
    await expect(t.deleteMany(['static/blobs/x'])).rejects.toThrow(/reported errors/)
  })

  it('uploader Worker lists with cursors and refuses deletes outside the allow-list', async () => {
    const deleted: string[][] = []
    const env = {
      UPLOADER_TOKEN: 'tok',
      DATA: {
        async list({ cursor }: { cursor?: string }) {
          const o = { key: cursor ? 'b' : 'a', size: 1, uploaded: new Date('2026-10-18T05:00:00Z') }
          return { objects: [o], truncated: !cursor, cursor: cursor ? undefined : 'c2' }
        },
        async delete(keys: string[]) {
          deleted.push(keys)
        },
      },
    }
    const fetchImpl = ((url: string, init: RequestInit) =>
      uploader.fetch(new Request(url, init), env)) as unknown as typeof fetch
    const t = new UploaderTarget('http://up.test', 'tok', 'bkt', fetchImpl)
    expect(await t.list('')).toEqual([
      { key: 'a', size: 1, uploaded: Date.parse('2026-10-18T05:00:00Z') },
      { key: 'b', size: 1, uploaded: Date.parse('2026-10-18T05:00:00Z') },
    ])
    await t.deleteMany([
      'static/blobs/x.json.gz',
      'static/20261017-20261216-3305c5ea-0123456789ab/ferry/index.json',
    ])
    expect(deleted).toEqual([
      ['static/blobs/x.json.gz', 'static/20261017-20261216-3305c5ea-0123456789ab/ferry/index.json'],
    ])
    for (const bad of [
      'manifest.json',
      'data/x',
      'legacy/latest.json',
      'rt/x',
      'static/README',
      'static/../x/y',
      'static/backups/keep.json',
    ])
      await expect(t.deleteMany([bad]), bad).rejects.toThrow(/HTTP 400/)
    expect(deleted).toHaveLength(1)
    const forbidden = await uploader.fetch(
      new Request('http://up.test/?op=list', { headers: { 'x-uploader-token': 'no' } }),
      env,
    )
    expect(forbidden.status).toBe(403)
  })
})
