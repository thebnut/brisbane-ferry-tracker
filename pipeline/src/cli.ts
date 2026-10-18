#!/usr/bin/env node
/**
 * bft-pipeline build   [--gtfs url|zip|dir] [--out dir] [--date YYYYMMDD] [--now ISO] [--modes ferry,train,tram,bus]
 *                      [--shards 512] [--previous-url URL] [--accept gen[,gen]] [--no-legacy]
 * bft-pipeline publish --from dir --target dir|assets|r2 [--to dir]
 *
 * Exit codes: 0 published, 2 structural failure (nothing published), 3 quarantined (live manifest kept the
 * previous generation for the quarantined modes; the new one is in manifest.staging.json), 1 anything else.
 */
import { parseArgs } from 'node:util'
import type { Mode } from '@bft/core'
import { ALL_MODES, DEFAULT_SHARDS, runBuild } from './build/build.ts'
import { StructuralError } from './feed/load.ts'
import { resolveFeed } from './feed/source.ts'
import { publish } from './publish/publish.ts'
import { AssetsTarget, DirTarget, HttpReader, type PublishTarget, R2Target } from './publish/targets.ts'
import { StructuralFailure } from './validate/validators.ts'

export const EXIT = { ok: 0, error: 1, structural: 2, quarantined: 3 } as const

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv
  if (cmd === 'build') return build(rest)
  if (cmd === 'publish') return publishCmd(rest)
  console.error('usage: cli.ts build|publish [options]  (see the header of src/cli.ts)')
  return EXIT.error
}

async function build(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      gtfs: { type: 'string' },
      out: { type: 'string', default: 'out' },
      date: { type: 'string' },
      now: { type: 'string' },
      modes: { type: 'string' },
      shards: { type: 'string' },
      'previous-url': { type: 'string' },
      accept: { type: 'string' },
      'no-legacy': { type: 'boolean', default: false },
      'work-dir': { type: 'string' },
    },
  })
  const nowMs = values.now ? Date.parse(values.now) : Date.now()
  if (Number.isNaN(nowMs)) throw new Error(`bad --now ${values.now}`)
  if (values.date && !/^\d{8}$/.test(values.date)) throw new Error(`bad --date ${values.date}`)
  const modes = values.modes ? (values.modes.split(',') as Mode[]) : ALL_MODES
  for (const m of modes) if (!ALL_MODES.includes(m)) throw new Error(`unknown mode ${m}`)

  const t0 = performance.now()
  const feed = await resolveFeed(values.gtfs, values['work-dir'])
  try {
    const res = await runBuild({
      feedDir: feed.dir,
      outDir: values.out as string,
      nowMs,
      ...(values.date ? { date: values.date } : {}),
      modes,
      shards: values.shards ? Number(values.shards) : DEFAULT_SHARDS,
      ...(values['previous-url'] ? { previous: new HttpReader(values['previous-url']) } : {}),
      accept: values.accept ? values.accept.split(',').map((s) => s.trim()) : [],
      legacy: !values['no-legacy'],
      log: (m) => console.log(m),
    })
    const secs = ((performance.now() - t0) / 1000).toFixed(1)
    const rss = (process.resourceUsage().maxRSS / 1024).toFixed(0)
    console.log(
      `built ${res.modes.length} modes for ${res.serviceDates[0]}..${res.serviceDates.at(-1)} in ${secs}s, peak RSS ${rss} MB; ` +
        `${res.blobsWritten} new blobs, ${res.blobsExisting} already present`,
    )
    const summary = {
      feedVersion: res.feedVersion,
      zipSha256: feed.zipSha256,
      modes: res.modes.map((m) => ({
        mode: m.mode,
        generation: m.generation,
        quarantined: m.quarantined,
        accepted: m.accepted,
      })),
    }
    console.log(JSON.stringify(summary, null, 2))
    const quarantined = res.modes.filter((m) => m.quarantined.length && !m.accepted)
    if (quarantined.length) {
      for (const q of quarantined)
        console.error(`QUARANTINED ${q.mode} ${q.generation}:\n  ${q.quarantined.join('\n  ')}`)
      return EXIT.quarantined
    }
    return EXIT.ok
  } catch (e) {
    if (e instanceof StructuralFailure || e instanceof StructuralError) {
      console.error(`STRUCTURAL FAILURE (nothing published):\n${e.message}`)
      return EXIT.structural
    }
    throw e
  }
}

async function publishCmd(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      from: { type: 'string', default: 'out' },
      target: { type: 'string', default: 'dir' },
      to: { type: 'string' },
    },
  })
  let target: PublishTarget
  if (values.target === 'dir' || values.target === 'assets') {
    if (!values.to) throw new Error('--to <dir> is required for dir and assets targets')
    target = values.target === 'dir' ? new DirTarget(values.to) : new AssetsTarget(values.to)
  } else if (values.target === 'r2') {
    const env = (k: string) => {
      const v = process.env[k]
      if (!v) throw new Error(`${k} is not set`)
      return v
    }
    target = new R2Target({
      accountId: env('R2_ACCOUNT_ID'),
      bucket: env('R2_BUCKET'),
      accessKeyId: env('R2_ACCESS_KEY_ID'),
      secretAccessKey: env('R2_SECRET_ACCESS_KEY'),
    })
  } else throw new Error(`unknown --target ${values.target}`)
  const stats = await publish(values.from as string, target, (m) => console.log(m))
  console.log(
    `published to ${target.name}: ${stats.puts} puts (${(stats.bytes / 1e6).toFixed(1)} MB), ${stats.skipped} of ${stats.checks} content files already present`,
  )
  return EXIT.ok
}

main(process.argv.slice(2).filter((a) => a !== '--')).then(
  (code) => process.exit(code),
  (e) => {
    console.error(e instanceof Error ? (e.stack ?? e.message) : e)
    process.exit(EXIT.error)
  },
)
