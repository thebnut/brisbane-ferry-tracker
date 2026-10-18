import { existsSync } from 'node:fs'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { GenerationIndex } from '@bft/core'
import { beforeAll, describe, expect, it } from 'vitest'
import { blobKey, shardKey } from '../src/build/blobs.ts'
import { type BuildResult, runBuild } from '../src/build/build.ts'
import { publish } from '../src/publish/publish.ts'
import {
  AssetsTarget,
  DirTarget,
  HttpReader,
  IMMUTABLE,
  listFiles,
  metaFor,
  R2Target,
} from '../src/publish/targets.ts'
import { parseAll } from './helpers.ts'
import { baseFeed, NOW, writeFeed } from './synth.ts'

const tmp = () => mkdtemp(join(tmpdir(), 'bft-pub-'))
let out: string
let res: BuildResult
const bus = () => res.modes.find((m) => m.mode === 'bus')?.index as GenerationIndex

beforeAll(async () => {
  out = await tmp()
  res = await runBuild({ feedDir: await writeFeed(baseFeed()), outDir: out, nowMs: NOW })
})

describe('dir target', () => {
  it('uploads everything once, then only the mutable files', async () => {
    const to = await tmp()
    const first = await publish(out, new DirTarget(to))
    expect(first.skipped).toBe(0)
    expect(await listFiles(to)).toEqual(await listFiles(out))
    const second = await publish(out, new DirTarget(to))
    expect(second.skipped).toBe(second.checks)
    expect(second.puts).toBe(
      (await listFiles(out)).filter((f) => /^(data|legacy)\/|^manifest/.test(f)).length,
    )
  })
})

describe('assets target', () => {
  it('lays out shards instead of per-stop bus blobs, with _headers', async () => {
    const to = await tmp()
    await publish(out, new AssetsTarget(to))
    const idx = bus()
    for (const date of idx.serviceDates) {
      for (const sha of Object.values(idx.blobs[date] ?? {}))
        expect(existsSync(join(to, blobKey(sha)))).toBe(false)
      const shards = (idx.shards?.byDate[date] ?? []).filter((s): s is string => s !== null)
      expect(shards.length).toBeGreaterThan(0)
      for (const sha of shards) expect(existsSync(join(to, shardKey(sha)))).toBe(true)
      expect(existsSync(join(to, blobKey(idx.tripIndex?.[date] as string)))).toBe(true)
    }
    const ferry = res.modes.find((m) => m.mode === 'ferry')?.index as GenerationIndex
    expect(existsSync(join(to, blobKey(Object.values(ferry.blobs['20261020'] ?? {})[0] as string)))).toBe(
      true,
    )
    const headers = await readFile(join(to, '_headers'), 'utf8')
    expect(headers).toContain(`/static/*\n  Cache-Control: ${IMMUTABLE}`)
    expect(headers).toContain('/manifest.json\n  Cache-Control: public, max-age=60')
    const counts = await parseAll(to)
    expect(counts.headers).toBe(1)
    expect(counts.stopDay).toBeGreaterThan(0)
  })

  it('refuses a layout over the per-version file limit', async () => {
    await expect(publish(out, new AssetsTarget(await tmp(), 10))).rejects.toThrow(
      /over the Workers limit of 10/,
    )
  })
})

describe('R2 target (S3 API)', () => {
  it('HEADs content files, PUTs only missing ones with metadata, and signs every request', async () => {
    const store = new Map<string, { body: Uint8Array; type: string; cache: string }>()
    const calls: string[] = []
    const fake: typeof fetch = async (input, init) => {
      const req = input instanceof Request ? input : new Request(input, init)
      const key = decodeURIComponent(new URL(req.url).pathname.replace(/^\/bucket\//, ''))
      expect(req.headers.get('authorization')).toMatch(
        /^AWS4-HMAC-SHA256 Credential=AKID\/\d{8}\/auto\/s3\/aws4_request/,
      )
      calls.push(`${req.method} ${key}`)
      if (req.method === 'HEAD') return new Response(null, { status: store.has(key) ? 200 : 404 })
      if (req.method === 'GET') {
        const v = store.get(key)
        return v ? new Response(v.body) : new Response(null, { status: 404 })
      }
      store.set(key, {
        body: new Uint8Array(await req.arrayBuffer()),
        type: req.headers.get('content-type') ?? '',
        cache: req.headers.get('cache-control') ?? '',
      })
      return new Response(null, { status: 200 })
    }
    const target = new R2Target(
      {
        accountId: 'acct',
        bucket: 'bucket',
        accessKeyId: 'AKID',
        secretAccessKey: 'secret',
        endpoint: 'https://r2.test',
      },
      fake,
    )
    const first = await publish(out, target)
    expect(first.puts).toBe(store.size)
    expect(calls.at(-1)).toBe('PUT manifest.json')
    const blob = [...store.entries()].find(([k]) => k.startsWith('static/blobs/'))?.[1]
    expect(blob).toMatchObject({ type: 'application/gzip', cache: IMMUTABLE })
    expect(store.get('manifest.json')?.cache).toBe('public, max-age=60')
    expect(await target.get('manifest.json')).not.toBeNull()

    calls.length = 0
    const second = await publish(out, target)
    expect(second.skipped).toBe(second.checks)
    expect(calls.filter((c) => c.startsWith('PUT static/'))).toEqual([])
  })
})

describe('metaFor and HttpReader', () => {
  it('assigns cache rules by key', () => {
    expect(metaFor('static/blobs/ab.json.gz').cacheControl).toBe(IMMUTABLE)
    expect(metaFor('static/g/bus/index.json').cacheControl).toBe(IMMUTABLE)
    expect(metaFor('manifest.json').cacheControl).toBe('public, max-age=60')
    expect(metaFor('data/bus/stops.json').cacheControl).toBe('public, max-age=300')
  })
  it('reads the previous manifest over HTTP and maps 404 to null', async () => {
    const r = new HttpReader('https://data.test/', async (u) =>
      String(u).endsWith('manifest.json') ? new Response('{"a":1}') : new Response(null, { status: 404 }),
    )
    expect(new TextDecoder().decode((await r.get('manifest.json')) as Uint8Array)).toBe('{"a":1}')
    expect(await r.get('nope')).toBeNull()
  })
})
