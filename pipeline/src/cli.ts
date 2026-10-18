#!/usr/bin/env node
/**
 * bft-pipeline build   [--gtfs url|zip|dir] [--out dir] [--date YYYYMMDD] [--now ISO] [--modes ferry,train,tram,bus]
 *                      [--shards 512] [--previous r2|uploader | --previous-url URL] [--accept gen[,gen]] [--no-legacy]
 * bft-pipeline publish --from dir --target r2|uploader|dir|assets [--to dir|url] [--concurrency n]
 * bft-pipeline gc      [--target r2|uploader] [--apply] [--report file.json] [--max-fraction 0.6] [--sample n]
 *                      Dry run unless --apply (see src/gc/gc.ts for what is ever deleted).
 *
 * Exit codes: 0 published, 2 structural failure (nothing published), 3 quarantined (live manifest kept the
 * previous generation for the quarantined modes; the new one is in manifest.staging.json), 4 gc aborted by a safety
 * rail (nothing deleted), 1 anything else.
 */
import { writeFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import type { Mode } from '@bft/core'
import { ALL_MODES, DEFAULT_SHARDS, runBuild } from './build/build.ts'
import { StructuralError } from './feed/load.ts'
import { resolveFeed } from './feed/source.ts'
import {
  applyGc,
  DEFAULT_MAX_FRACTION,
  formatPlan,
  GcAbort,
  GcBatchError,
  type GcStore,
  planGc,
} from './gc/gc.ts'
import { publish } from './publish/publish.ts'
import {
  AssetsTarget,
  DirTarget,
  HttpReader,
  type PublishTarget,
  R2Target,
  type Reader,
  r2CredentialsFromApiToken,
  UploaderTarget,
} from './publish/targets.ts'
import { StructuralFailure } from './validate/validators.ts'

export const EXIT = { ok: 0, error: 1, structural: 2, quarantined: 3, gcAborted: 4 } as const

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv
  if (cmd === 'build') return build(rest)
  if (cmd === 'publish') return publishCmd(rest)
  if (cmd === 'gc') return gcCmd(rest)
  console.error('usage: cli.ts build|publish|gc [options]  (see the header of src/cli.ts)')
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
      previous: { type: 'string' },
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

  // Where the previous manifest and indexes live (for quarantine checks and manifest.previous): the publish target.
  let previous: Reader | undefined
  if (values['previous-url']) previous = new HttpReader(values['previous-url'])
  else if (values.previous && values.previous !== 'out') previous = await remoteTarget(values.previous)

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
      ...(previous ? { previous } : {}),
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

export const DEFAULT_BUCKET = 'bft-transit-data'

/**
 * Remote targets. r2: S3 API with R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY, or credentials derived from
 * CLOUDFLARE_API_TOKEN (account from R2_ACCOUNT_ID or CLOUDFLARE_ACCOUNT_ID, bucket from R2_BUCKET).
 * uploader: the local `wrangler dev` uploader (UPLOADER_URL, UPLOADER_TOKEN), see scripts/publish-r2-local.sh.
 */
export async function remoteTarget(kind: string, to?: string): Promise<PublishTarget> {
  const env = (k: string) => process.env[k] || undefined
  const bucket = env('R2_BUCKET') ?? DEFAULT_BUCKET
  if (kind === 'r2') {
    const accountId = env('R2_ACCOUNT_ID') ?? env('CLOUDFLARE_ACCOUNT_ID')
    if (!accountId) throw new Error('R2_ACCOUNT_ID or CLOUDFLARE_ACCOUNT_ID is not set')
    let creds = { accessKeyId: env('R2_ACCESS_KEY_ID'), secretAccessKey: env('R2_SECRET_ACCESS_KEY') }
    if (!creds.accessKeyId || !creds.secretAccessKey) {
      const token = env('CLOUDFLARE_API_TOKEN')
      if (!token) throw new Error('set R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY, or CLOUDFLARE_API_TOKEN')
      creds = await r2CredentialsFromApiToken(token, accountId)
    }
    return new R2Target({
      accountId,
      bucket,
      accessKeyId: creds.accessKeyId as string,
      secretAccessKey: creds.secretAccessKey as string,
    })
  }
  if (kind === 'uploader') {
    const url = to ?? env('UPLOADER_URL') ?? 'http://127.0.0.1:8799'
    const token = env('UPLOADER_TOKEN')
    if (!token) throw new Error('UPLOADER_TOKEN is not set (scripts/publish-r2-local.sh sets it)')
    return new UploaderTarget(url, token, bucket)
  }
  throw new Error(`unknown remote target ${kind}`)
}

async function publishCmd(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      from: { type: 'string', default: 'out' },
      target: { type: 'string', default: 'dir' },
      to: { type: 'string' },
      concurrency: { type: 'string' },
    },
  })
  let target: PublishTarget
  if (values.target === 'dir' || values.target === 'assets') {
    if (!values.to) throw new Error('--to <dir> is required for dir and assets targets')
    target = values.target === 'dir' ? new DirTarget(values.to) : new AssetsTarget(values.to)
  } else target = await remoteTarget(values.target as string, values.to)
  const t0 = performance.now()
  const stats = await publish(values.from as string, target, {
    log: (m) => console.log(m),
    ...(values.concurrency ? { concurrency: Number(values.concurrency) } : {}),
  })
  console.log(
    `published to ${target.name} in ${((performance.now() - t0) / 1000).toFixed(0)}s: ${stats.puts} PUTs (Class A, ` +
      `${(stats.bytes / 1e6).toFixed(1)} MB), ${stats.reads} GETs (Class B), ${stats.skipped} content files already present`,
  )
  return EXIT.ok
}

async function gcCmd(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      target: { type: 'string' },
      apply: { type: 'boolean', default: false },
      report: { type: 'string', default: 'gc-report.json' },
      'max-fraction': { type: 'string' },
      sample: { type: 'string', default: '10' },
    },
  })
  const env = (k: string) => process.env[k] || undefined
  const kind =
    values.target ??
    (env('R2_ACCESS_KEY_ID') || env('CLOUDFLARE_API_TOKEN')
      ? 'r2'
      : env('UPLOADER_TOKEN')
        ? 'uploader'
        : undefined)
  if (kind !== 'r2' && kind !== 'uploader')
    throw new Error(
      'gc needs --target r2|uploader (or R2/Cloudflare credentials, or UPLOADER_TOKEN, in the env)',
    )
  const store = (await remoteTarget(kind)) as PublishTarget & GcStore
  let maxFraction = DEFAULT_MAX_FRACTION
  if (values['max-fraction'] !== undefined) {
    maxFraction = Number(values['max-fraction'])
    console.log(`--max-fraction override: ${maxFraction} (default ${DEFAULT_MAX_FRACTION})`)
  }
  const report: Record<string, unknown> = { mode: values.apply ? 'apply' : 'dry-run', store: store.name }
  const save = () => writeFile(values.report as string, `${JSON.stringify(report, null, 2)}\n`)
  try {
    const plan = await planGc(store, { maxFraction, log: (m) => console.log(m) })
    Object.assign(report, plan)
    console.log(formatPlan(plan, Number(values.sample)))
    if (!values.apply) {
      console.log(`dry run: nothing deleted (rerun with --apply). Report: ${values.report}`)
      await save()
      return EXIT.ok
    }
    report.deleted = []
    try {
      report.deleted = await applyGc(store, plan, {
        log: (m) => console.log(m),
        onBatch: async (deleted) => {
          report.deleted = [...deleted]
          await save()
        },
      })
    } catch (e) {
      if (e instanceof GcBatchError) {
        report.deleted = e.deleted
        report.failed = { error: e.message, outcomeUnknown: e.unknown }
        await save()
        console.error(
          `GC STOPPED after ${e.deleted.length} deletions: ${e.message}` +
            (e.unknown.length
              ? ` (${e.unknown.length} keys in the failed batch may or may not be deleted)`
              : ''),
        )
        return EXIT.error
      }
      throw e
    }
    await save()
    const after: Record<string, number> = {}
    for (const o of await store.list('')) {
      const i = o.key.indexOf('/')
      const p = i < 0 ? o.key : o.key.slice(0, i + 1)
      after[p] = (after[p] ?? 0) + 1
    }
    report.after = after
    const gone = new Set(report.deleted as string[])
    const deletedBytes = plan.candidates.reduce((n, c) => n + (gone.has(c.key) ? c.size : 0), 0)
    report.deletedBytes = deletedBytes
    console.log(
      `deleted ${(report.deleted as string[]).length} objects (${(deletedBytes / 1e6).toFixed(1)} MB); ` +
        `bucket after: ${Object.entries(after)
          .map(([p, n]) => `${p} ${n}`)
          .join(', ')}. Report: ${values.report}`,
    )
    await save()
    return EXIT.ok
  } catch (e) {
    if (e instanceof GcAbort) {
      report.aborted = e.message
      await save()
      console.error(`GC ABORTED (nothing deleted): ${e.message}`)
      return EXIT.gcAborted
    }
    throw e
  }
}

main(process.argv.slice(2).filter((a) => a !== '--')).then(
  (code) => process.exit(code),
  (e) => {
    console.error(e instanceof Error ? (e.stack ?? e.message) : e)
    process.exit(EXIT.error)
  },
)
