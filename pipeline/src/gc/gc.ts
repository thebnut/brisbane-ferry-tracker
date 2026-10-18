/**
 * Garbage collection of pipeline-created objects in the R2 bucket (ADR-0002 "a weekly garbage-collection step").
 *
 * Only three kinds of key are ever candidates (hard-coded allow-list): `static/blobs/*`, `static/shards/*` and
 * `static/{generation}/*` (generation indexes). Everything else in the bucket (manifest*.json, data/, legacy/, rt/,
 * anything new) is never selected, whatever the store lists.
 *
 * Retained, never deleted:
 * - every generation named by manifest.json or manifest.staging.json (current, previous and quarantined, all modes);
 * - every generation with any object uploaded in the last RETENTION_DAYS;
 * - every blob, trip index and shard referenced by any index under a retained generation;
 * - any object uploaded less than GRACE_HOURS ago (an in-flight publish whose manifest isn't written yet).
 *
 * Safety rails abort with nothing deleted: missing or unparseable manifest.json, an unreadable index for a current
 * generation (or any retained index that exists but doesn't parse), or a candidate set over `maxFraction` of all
 * objects under static/. Deletes go in batches of at most DELETE_BATCH keys and every key is reported.
 */
import { GenerationIndex, Manifest } from '@bft/core'
import { contentKeys } from '../publish/publish.ts'

export const RETENTION_DAYS = 14
export const GRACE_HOURS = 48
export const DEFAULT_MAX_FRACTION = 0.6
export const DELETE_BATCH = 1000

export interface ListedObject {
  key: string
  size: number
  /** Upload time, epoch ms. */
  uploaded: number
}

export interface GcStore {
  readonly name: string
  /** Every object whose key starts with `prefix` (the store pages internally). */
  list(prefix: string): Promise<ListedObject[]>
  get(key: string): Promise<Uint8Array | null>
  /** Delete up to DELETE_BATCH keys. */
  deleteMany(keys: string[]): Promise<void>
}

export class GcAbort extends Error {
  override readonly name = 'GcAbort'
}

const GENERATION_KEY = /^static\/([^/]+)\/.+$/
const INDEX_KEY = /^static\/([^/]+)\/([^/]+)\/index\.json$/
const CONTENT_DIRS = new Set(['blobs', 'shards'])

export type GcPrefix = 'static/blobs/' | 'static/shards/' | 'static/{generation}/'

/** The allow-list. Returns which collectable prefix a key falls under, or null if it must never be deleted. */
export function collectablePrefix(key: string): GcPrefix | null {
  if (/^static\/blobs\/[^/]+$/.test(key)) return 'static/blobs/'
  if (/^static\/shards\/[^/]+$/.test(key)) return 'static/shards/'
  const g = GENERATION_KEY.exec(key)?.[1]
  if (g && !CONTENT_DIRS.has(g) && g !== '.' && g !== '..') return 'static/{generation}/'
  return null
}

/** The generation directory a key belongs to (static/{generation}/...), or null for blobs, shards and others. */
export function generationOf(key: string): string | null {
  return collectablePrefix(key) === 'static/{generation}/' ? (GENERATION_KEY.exec(key)?.[1] ?? null) : null
}

interface PrefixTotals {
  objects: number
  bytes: number
}

export interface GcPlan {
  store: string
  now: string
  settings: { retentionDays: number; graceHours: number; maxFraction: number }
  /** Objects per top-level prefix before collection (the whole bucket listing). */
  before: Record<string, PrefixTotals>
  staticObjects: number
  retainedGenerations: Array<{ generation: string; why: string[] }>
  referencedKeys: number
  /** Unreferenced but kept because they are younger than the grace period. */
  keptYoung: number
  /** When the oldest of those passes the grace period (ISO), or null. */
  nextEligibleAt: string | null
  candidates: ListedObject[]
  byPrefix: Record<GcPrefix, PrefixTotals>
  fraction: number
  warnings: string[]
}

export interface PlanOptions {
  nowMs?: number
  maxFraction?: number
  log?: (m: string) => void
}

function topPrefix(key: string): string {
  const i = key.indexOf('/')
  return i < 0 ? key : key.slice(0, i + 1)
}

async function readManifest(store: GcStore, key: string, required: boolean): Promise<Manifest | null> {
  let bytes: Uint8Array | null
  try {
    bytes = await store.get(key)
  } catch (e) {
    throw new GcAbort(`cannot read ${key}: ${e instanceof Error ? e.message : e}`)
  }
  if (!bytes) {
    if (required) throw new GcAbort(`${key} is missing`)
    return null
  }
  let json: unknown
  try {
    json = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new GcAbort(`${key} is not valid JSON`)
  }
  const parsed = Manifest.safeParse(json)
  if (!parsed.success)
    throw new GcAbort(`${key} does not match the Manifest contract: ${parsed.error.message}`)
  return parsed.data
}

async function readIndex(store: GcStore, key: string): Promise<GenerationIndex> {
  let bytes: Uint8Array | null
  try {
    bytes = await store.get(key)
  } catch (e) {
    throw new GcAbort(`cannot read ${key}: ${e instanceof Error ? e.message : e}`)
  }
  if (!bytes) throw new GcAbort(`${key} is listed but could not be read`)
  let json: unknown
  try {
    json = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new GcAbort(`${key} is not valid JSON`)
  }
  const parsed = GenerationIndex.safeParse(json)
  if (!parsed.success) throw new GcAbort(`${key} does not match the GenerationIndex contract`)
  return parsed.data
}

/** Work out what to delete. Throws GcAbort (nothing deleted) when a safety rail trips. */
export async function planGc(store: GcStore, opts: PlanOptions = {}): Promise<GcPlan> {
  const log = opts.log ?? (() => {})
  const nowMs = opts.nowMs ?? Date.now()
  const maxFraction = opts.maxFraction ?? DEFAULT_MAX_FRACTION
  if (!(maxFraction > 0 && maxFraction <= 1)) throw new GcAbort(`bad maxFraction ${maxFraction}`)
  const warnings: string[] = []

  // Manifests first: nothing is listed or deleted without a readable live manifest.
  const live = await readManifest(store, 'manifest.json', true)
  const staging = await readManifest(store, 'manifest.staging.json', false)

  const all = await store.list('')
  const before: Record<string, PrefixTotals> = {}
  for (const o of all) {
    const p = topPrefix(o.key)
    const t = before[p] ?? { objects: 0, bytes: 0 }
    t.objects++
    t.bytes += o.size
    before[p] = t
  }
  const statics = all.filter((o) => o.key.startsWith('static/'))
  const listed = new Map(statics.map((o) => [o.key, o]))

  // Retained generations.
  const why = new Map<string, Set<string>>()
  const retain = (g: string, reason: string) => {
    if (!why.has(g)) why.set(g, new Set())
    why.get(g)?.add(reason)
  }
  const currentIndexKeys: string[] = []
  const manifestRefs: Array<[string, string]> = []
  for (const [name, m] of [
    ['manifest.json', live],
    ['manifest.staging.json', staging],
  ] as const) {
    if (!m) continue
    for (const [mode, e] of Object.entries(m.modes)) {
      if (!e) continue
      retain(e.current, `${name} ${mode} current`)
      manifestRefs.push([e.current, mode])
      if (name === 'manifest.json') currentIndexKeys.push(`static/${e.current}/${mode}/index.json`)
      if (e.previous) {
        retain(e.previous, `${name} ${mode} previous`)
        manifestRefs.push([e.previous, mode])
      }
    }
    for (const q of m.quarantined) {
      retain(q.generation, `${name} ${q.mode} quarantined`)
      manifestRefs.push([q.generation, q.mode])
    }
  }
  const retentionCutoff = nowMs - RETENTION_DAYS * 86_400_000
  for (const o of statics) {
    const g = generationOf(o.key)
    // Unknown upload time counts as recent.
    if (g && !(o.uploaded < retentionCutoff)) retain(g, `uploaded within ${RETENTION_DAYS} days`)
  }

  // Rail: every current generation's index must be readable.
  for (const k of currentIndexKeys) {
    if (!listed.has(k)) throw new GcAbort(`current generation index ${k} is not in the bucket`)
  }
  for (const [g, mode] of manifestRefs) {
    const k = `static/${g}/${mode}/index.json`
    if (!listed.has(k) && !currentIndexKeys.includes(k))
      warnings.push(`manifest names ${k}, which is not in the bucket`)
  }

  // Everything referenced by any index under a retained generation.
  const referenced = new Set<string>()
  for (const o of statics) {
    const m = INDEX_KEY.exec(o.key)
    if (!m || !why.has(m[1] as string)) continue
    const idx = await readIndex(store, o.key)
    for (const k of contentKeys(idx)) referenced.add(k)
  }
  log(`${why.size} retained generations reference ${referenced.size} content objects`)

  const graceCutoff = nowMs - GRACE_HOURS * 3_600_000
  const candidates: ListedObject[] = []
  const byPrefix: Record<GcPrefix, PrefixTotals> = {
    'static/blobs/': { objects: 0, bytes: 0 },
    'static/shards/': { objects: 0, bytes: 0 },
    'static/{generation}/': { objects: 0, bytes: 0 },
  }
  let keptYoung = 0
  let oldestYoung = Number.POSITIVE_INFINITY
  for (const o of statics) {
    const prefix = collectablePrefix(o.key)
    if (!prefix) continue
    const g = generationOf(o.key)
    if (g && why.has(g)) continue
    if (referenced.has(o.key)) continue
    // Unknown or future upload times are treated as young.
    if (!(o.uploaded < graceCutoff)) {
      keptYoung++
      if (o.uploaded < oldestYoung) oldestYoung = o.uploaded
      continue
    }
    candidates.push(o)
    byPrefix[prefix].objects++
    byPrefix[prefix].bytes += o.size
  }
  candidates.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))

  const fraction = statics.length ? candidates.length / statics.length : 0
  if (fraction > maxFraction)
    throw new GcAbort(
      `${candidates.length} of ${statics.length} objects under static/ (${(fraction * 100).toFixed(1)}%) would be ` +
        `deleted, over the ${(maxFraction * 100).toFixed(0)}% limit; rerun with --max-fraction if this is expected`,
    )

  return {
    store: store.name,
    now: new Date(nowMs).toISOString(),
    settings: { retentionDays: RETENTION_DAYS, graceHours: GRACE_HOURS, maxFraction },
    before,
    staticObjects: statics.length,
    retainedGenerations: [...why]
      .map(([generation, w]) => ({ generation, why: [...w].sort() }))
      .sort((a, b) => (a.generation < b.generation ? -1 : 1)),
    referencedKeys: referenced.size,
    keptYoung,
    nextEligibleAt: Number.isFinite(oldestYoung)
      ? new Date(oldestYoung + GRACE_HOURS * 3_600_000).toISOString()
      : null,
    candidates,
    byPrefix,
    fraction,
    warnings,
  }
}

/** Delete a plan's candidates in batches. Every key is re-checked against the allow-list first. */
export async function applyGc(
  store: GcStore,
  plan: GcPlan,
  log: (m: string) => void = () => {},
): Promise<string[]> {
  const keys = plan.candidates.map((c) => c.key)
  for (const k of keys)
    if (!collectablePrefix(k)) throw new GcAbort(`refusing to delete ${k}: outside the allow-listed prefixes`)
  const deleted: string[] = []
  for (let i = 0; i < keys.length; i += DELETE_BATCH) {
    const batch = keys.slice(i, i + DELETE_BATCH)
    await store.deleteMany(batch)
    deleted.push(...batch)
    log(`  deleted ${deleted.length}/${keys.length}`)
  }
  return deleted
}

export function formatPlan(plan: GcPlan, sample = 10): string {
  const mb = (b: number) => `${(b / 1e6).toFixed(1)} MB`
  const lines = [
    `GC plan for ${plan.store} at ${plan.now}`,
    `  bucket before: ${Object.entries(plan.before)
      .map(([p, t]) => `${p} ${t.objects} (${mb(t.bytes)})`)
      .join(', ')}`,
    `  retained generations: ${plan.retainedGenerations.map((g) => g.generation).join(', ') || 'none'}`,
    `  referenced content objects kept: ${plan.referencedKeys}; unreferenced but younger than ${GRACE_HOURS} h: ${plan.keptYoung}${plan.nextEligibleAt ? ` (first eligible ${plan.nextEligibleAt})` : ''}`,
    `  candidates: ${plan.candidates.length} of ${plan.staticObjects} under static/ (${(plan.fraction * 100).toFixed(1)}%)`,
  ]
  for (const [p, t] of Object.entries(plan.byPrefix))
    lines.push(`    ${p.padEnd(22)} ${t.objects} objects, ${mb(t.bytes)}`)
  if (plan.candidates.length) {
    lines.push('  sample:')
    for (const c of plan.candidates.slice(0, sample))
      lines.push(`    ${c.key}  ${c.size} B  ${new Date(c.uploaded).toISOString()}`)
  }
  for (const w of plan.warnings) lines.push(`  warning: ${w}`)
  return lines.join('\n')
}
