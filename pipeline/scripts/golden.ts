/**
 * Regenerate packages/core/fixtures/golden/ from a real SEQ feed:
 *   pnpm --filter @bft/pipeline golden [--gtfs /tmp/bft-gtfs/x]
 * Each fixture is the exact content-addressed stop-day blob the pipeline publishes (gzip JSON).
 */
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { gunzipSync } from 'node:zlib'
import type { Mode } from '@bft/core'
import { shardOf } from '@bft/core'
import { blobKey, gzipJson, sha256Hex, shardKey } from '../src/build/blobs.ts'
import { runBuild } from '../src/build/build.ts'
import { resolveFeed } from '../src/feed/source.ts'

export const GOLDEN: Array<{ name: string; mode: Mode; key: string; date: string; note: string }> = [
  {
    name: 'ferry-bulimba',
    mode: 'ferry',
    key: '317584',
    date: '20261020',
    note: 'Bulimba: F11 express vs F1 all-stops',
  },
  {
    name: 'train-central',
    mode: 'train',
    key: 'central',
    date: '20261020',
    note: 'Central: six platforms, 24:xx departures',
  },
  {
    name: 'train-bowen-hills',
    mode: 'train',
    key: 'bowen-hills',
    date: '20261020',
    note: 'Bowen Hills: branching lines',
  },
  {
    name: 'train-domestic-airport',
    mode: 'train',
    key: 'domestic-airport',
    date: '20261023',
    note: 'Domestic Airport, Friday: last trains (none after 24:00 in the 17 Oct 2026 feed)',
  },
  {
    name: 'bus-cultural-centre-p2',
    mode: 'bus',
    key: '11168',
    date: '20261020',
    note: 'Cultural Centre busway platform 2: the largest stop-day file',
  },
  {
    name: 'bus-parkwood-301200',
    mode: 'bus',
    key: '301200',
    date: '20261020',
    note: 'Greenacre Dr at Parkwood station: routes running past midnight (24:xx)',
  },
]

const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: { gtfs: { type: 'string', default: '/tmp/bft-gtfs/x' } },
})
const out = resolve(import.meta.dirname, '../../packages/core/fixtures/golden')
const work = await mkdtemp(join(tmpdir(), 'bft-golden-'))
try {
  const feed = await resolveFeed(values.gtfs, work)
  const res = await runBuild({
    feedDir: feed.dir,
    outDir: join(work, 'out'),
    nowMs: Date.parse('2026-10-19T17:15:00Z'),
    date: '20261020',
    modes: ['ferry', 'train', 'bus'],
    legacy: false,
    golden: false,
  })
  await mkdir(out, { recursive: true })
  const index: Record<string, unknown> = {}
  for (const g of GOLDEN) {
    const idx = res.modes.find((m) => m.mode === g.mode)?.index
    let sha = idx?.blobs[g.date]?.[g.key]
    if (sha) await copyFile(join(work, 'out', blobKey(sha)), join(out, `${g.name}.json.gz`))
    else if (idx?.shards) {
      // Bus is shards only: re-encode the stop's StaticStopDay exactly as a per-stop blob would be.
      const shardSha = idx.shards.byDate[g.date]?.[shardOf(g.key, idx.shards.count)]
      const shard = shardSha
        ? JSON.parse(gunzipSync(await readFile(join(work, 'out', shardKey(shardSha)))).toString('utf8'))
        : {}
      if (!shard[g.key]) throw new Error(`no stop-day for ${g.mode} ${g.key} on ${g.date}`)
      const gz = gzipJson(JSON.stringify(shard[g.key]))
      sha = sha256Hex(gz)
      await writeFile(join(out, `${g.name}.json.gz`), gz)
    } else throw new Error(`no blob for ${g.mode} ${g.key} on ${g.date}`)
    index[g.name] = { mode: g.mode, stopKey: g.key, serviceDate: g.date, sha256: sha, note: g.note }
  }
  const feedInfo = (await readFile(join(feed.dir, 'feed_info.txt'), 'utf8')).split(/\r?\n/)[1]
  await writeFile(
    join(out, 'index.json'),
    `${JSON.stringify({ source: 'TransLink SEQ GTFS', feedVersion: res.feedVersion, feedInfo, fixtures: index }, null, 2)}\n`,
  )
  console.log(`wrote ${GOLDEN.length} fixtures to ${out}`)
} finally {
  await rm(work, { recursive: true, force: true })
}
