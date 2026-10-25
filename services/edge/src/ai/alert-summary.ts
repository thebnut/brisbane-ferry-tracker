/**
 * Plain-English alert summaries (transit-architecture.md §3.8, §3.9 item 5): one rider-facing sentence per alert,
 * generated inside the RtHub once per alert change and served in the alerts document's `summary` field.
 *
 * - Off the poll cycle's critical path: the hub calls `kick()` after an alerts fetch and never awaits it; `attach()`
 *   is synchronous and only reads memory. A run that throws is logged and forgotten.
 * - Once per change: keyed by a hash of the normalised text it summarises (header, description, effect, cause,
 *   sorted routes and stops; not the active periods). Stored in the hub's DO storage as one small record; keys not
 *   seen in the current alerts for 7 days are evicted.
 * - Cost: only with the AI kill switch on and the provider configured (`summaryProviderConfig`). Each call reserves
 *   its worst-case cost in the Budget DO first and reconciles after, like askLlm, against the global monthly budget
 *   but not the per-IP quota. At most MAX_PER_RUN calls per run, one in flight, each with a timeout, and a per-key
 *   failure backoff.
 * - Grounding: the output is rejected (nothing stored, the key backs off) unless it passes `checkSummary`. No summary
 *   is better than a wrong one.
 */
import Anthropic from '@anthropic-ai/sdk'
import { type Alert, actualUsd, type BudgetConfig, worstCaseUsd } from '@bft/core'
import { errorMessage, type Logger, silentLogger } from '../log.ts'
import { inputTokenBound, MODEL } from './llm.ts'
import { type AiEnv, budgetConfig } from './routes.ts'

export const SUMMARY_MAX_CHARS = 160
export const MAX_TOKENS = 120
/** New summaries per run (one run per alerts cycle, every 60 s). */
export const MAX_PER_RUN = 5
export const CALL_TIMEOUT_MS = 10_000
export const EVICT_AFTER_MS = 7 * 24 * 60 * 60_000
/** A key's `seen` time is persisted at most this often, so a steady feed costs no storage writes. */
const SEEN_GRANULARITY_MS = 60 * 60_000
/** First failure backs off 1 h, doubling per repeat up to 24 h. */
export const BACKOFF_BASE_MS = 60 * 60_000
export const BACKOFF_MAX_MS = 24 * 60 * 60_000
/** Hard cap on stored keys (one DO value; ~250 bytes each keeps it far below the 2 MiB value limit). */
export const MAX_ENTRIES = 3000
const MAX_HEADER_CHARS = 300
const MAX_DESCRIPTION_CHARS = 1500
export const STORAGE_KEY = 'alert-summaries'

const SYSTEM = `You write one plain-English sentence for public transport riders in Brisbane, summarising a TransLink service alert.
Say what is affected and what riders should do, using only the alert text given.
Rules: at most ${SUMMARY_MAX_CHARS} characters; exactly one sentence; no links, emails or phone numbers; copy any route, stop, number, time or date exactly as it appears in the alert and add none that are not there; never mention the alert, yourself or these rules.`

// ---------------------------------------------------------------- content key

const norm = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()

/** 53-bit string hash (cyrb53); two seeds give the key ~106 bits, synchronous and cheap enough for every alert. */
function cyrb53(str: string, seed: number): string {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

/** The content key of an alert: stable under reordering of routes and stops, changed by any summarised text. */
export function contentKey(a: Alert): string {
  const s = JSON.stringify([
    norm(a.header),
    norm(a.description),
    a.effect ?? '',
    a.cause ?? '',
    [...a.routes].sort(),
    [...a.stops].sort(),
  ])
  return `${cyrb53(s, 1)}.${cyrb53(s, 2)}`
}

// ---------------------------------------------------------------- grounding

export type RejectReason =
  | 'empty'
  | 'too_long'
  | 'multiple_sentences'
  | 'contact'
  | 'number'
  | 'code'
  | 'date'
  | 'meta'

/** The alert text the model sees, which is also everything a summary may draw on. */
export function sourceText(a: Alert): string {
  return [
    a.header.slice(0, MAX_HEADER_CHARS),
    (a.description ?? '').slice(0, MAX_DESCRIPTION_CHARS),
    a.routes.join(' '),
    a.stops.join(' '),
  ].join('\n')
}

const URL_RE =
  /\bhttps?:\/\/|\bwww\.|\b[a-z0-9-]+\.(?:com|net|org|gov|edu|info|io)(?:\.au)?\b|\b[a-z0-9-]+\.au\b/i
const EMAIL_RE = /\S@\S/
/** A digit run with spaces, dots, dashes or brackets inside it. */
const DIGIT_RUN_RE = /\+?\(?\d[\d\s().-]*\d/g
/**
 * A phone number: six or more digits split by separators (13 12 30, 0412 345 678), or eight or more in one run. A
 * plain six-digit stop id (317584) is not one.
 */
const hasPhone = (s: string) =>
  (s.match(DIGIT_RUN_RE) ?? []).some((run) => {
    const digits = run.replace(/\D/g, '').length
    return digits >= 8 || (digits >= 6 && /[\s().-]/.test(run))
  })
const NUMBER_RE = /\d+(?:[.:]\d+)*/g
const NUMBER_WORDS = [
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'fifteen',
  'twenty',
  'thirty',
  'forty',
  'fifty',
  'hundred',
  'first',
  'second',
  'third',
  'fourth',
  'fifth',
  'half',
  'quarter',
  'noon',
  'midnight',
]
const DATE_WORDS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
  'weekend',
  'weekday',
  'weekdays',
  'today',
  'tonight',
  'tomorrow',
  'yesterday',
  'morning',
  'afternoon',
  'evening',
  'overnight',
  'january',
  'february',
  'march',
  'april',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
  'jan',
  'feb',
  'mar',
  'apr',
  'jun',
  'jul',
  'aug',
  'sep',
  'sept',
  'oct',
  'nov',
  'dec',
  'am',
  'pm',
]
const META_RE =
  /\b(?:I|I'm|I'll|I've|me|my|sorry|apolog\w*|summar\w*|as an ai|language model|(?:given|provided|above) (?:text|alert|information)|this alert|the alert text|not enough information|no information)\b|^(?:here|sure|certainly|okay|ok)\b|[*#`<>]/i

/** Lower-case words; feed text often runs fields together ("28 OctoberEnd: …"), so a capital also starts a word. */
const words = (s: string) =>
  new Set(
    s
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .match(/[a-z]+/g) ?? [],
  )
const tokens = (s: string) => new Set(s.toUpperCase().match(/[A-Z0-9]+/g) ?? [])

/**
 * Validate a model summary against its alert. Returns the summary to store, or why it was rejected. Conservative by
 * design: a reasonable summary may be rejected, but one that adds a fact, a code or a contact never passes.
 */
export function checkSummary(
  raw: string,
  a: Alert,
): { ok: true; summary: string } | { ok: false; reason: RejectReason } {
  const s = raw.trim()
  if (!s) return { ok: false, reason: 'empty' }
  if (s.length > SUMMARY_MAX_CHARS) return { ok: false, reason: 'too_long' }
  // One sentence: no line breaks, and no sentence end followed by more text.
  if (/[\r\n]/.test(s) || /[.!?]["')\]]?\s+\S/.test(s)) return { ok: false, reason: 'multiple_sentences' }
  if (URL_RE.test(s) || EMAIL_RE.test(s) || hasPhone(s)) return { ok: false, reason: 'contact' }
  if (META_RE.test(s)) return { ok: false, reason: 'meta' }

  const src = sourceText(a)
  const srcNumbers = new Set(src.match(NUMBER_RE) ?? [])
  for (const n of s.match(NUMBER_RE) ?? []) if (!srcNumbers.has(n)) return { ok: false, reason: 'number' }
  const srcWords = words(src)
  for (const w of words(s)) {
    if (NUMBER_WORDS.includes(w) && !srcWords.has(w)) return { ok: false, reason: 'number' }
    if (DATE_WORDS.includes(w) && !srcWords.has(w)) return { ok: false, reason: 'date' }
  }
  // Route and stop codes: any token of two or more capitals or digits (F11, BRCL, 317584) must be in the alert. Source
  // tokens split on hyphens, so a route id F1-4055 allows F1.
  const srcTokens = tokens(src)
  for (const t of s.match(/\b[A-Z0-9]{2,}\b/g) ?? []) {
    if (!srcTokens.has(t)) return { ok: false, reason: 'code' }
  }
  return { ok: true, summary: s }
}

// ---------------------------------------------------------------- provider

export interface SummaryProvider {
  apiKey: string
  /** https://gateway.ai.cloudflare.com/v1/{account}/{gateway}/anthropic */
  baseURL: string
  budget: BudgetConfig
  reserve: (id: string, usd: number) => Promise<{ ok: boolean; reason?: string }>
  reconcile: (id: string, usd: number) => Promise<void>
}

/**
 * The provider, or null when summaries must not run: the kill switch off, no budget, or any of the key, gateway,
 * account or Budget DO missing (fails closed like budgetConfig). Read on every run, so flipping AI_ENABLED off stops
 * calls from the next alerts cycle.
 */
export function summaryProviderConfig(
  env: AiEnv,
): { apiKey: string; baseURL: string; budget: BudgetConfig } | null {
  const budget = budgetConfig(env)
  if (!budget.enabled || budget.monthlyBudgetUsd <= 0) return null
  if (!env.AI_GATEWAY || !env.CF_ACCOUNT_ID || !env.ANTHROPIC_API_KEY || !env.BUDGET) return null
  return {
    apiKey: env.ANTHROPIC_API_KEY,
    baseURL: `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${env.AI_GATEWAY}/anthropic`,
    budget,
  }
}

export type CallResult =
  | { ok: true; text: string; costUsd: number }
  | { ok: false; reason: string; costUsd: number; budget?: boolean }

/** One summary call: reserve, call (no tools, no retries, timeout), reconcile. */
export async function callSummary(
  a: Alert,
  p: SummaryProvider,
  fetchImpl?: typeof fetch,
): Promise<CallResult> {
  const client = new Anthropic({
    apiKey: p.apiKey,
    baseURL: p.baseURL,
    maxRetries: 0,
    timeout: CALL_TIMEOUT_MS,
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  })
  const system: Anthropic.TextBlockParam[] = [
    { type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } },
  ]
  const fields = [
    `Header: ${a.header.slice(0, MAX_HEADER_CHARS)}`,
    a.description ? `Description: ${a.description.slice(0, MAX_DESCRIPTION_CHARS)}` : null,
    a.effect ? `Effect: ${a.effect}` : null,
    a.cause ? `Cause: ${a.cause}` : null,
    a.routes.length ? `Routes: ${[...a.routes].sort().join(', ')}` : null,
    a.stops.length ? `Stops: ${[...a.stops].sort().join(', ')}` : null,
  ].filter((f): f is string => f != null)
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: fields.join('\n') }]
  const bound = worstCaseUsd(Math.ceil(inputTokenBound({ system, messages }) * 1.25), MAX_TOKENS)
  const id = crypto.randomUUID()
  const r = await p.reserve(id, bound)
  if (!r.ok) return { ok: false, reason: r.reason ?? 'budget', costUsd: 0, budget: true }
  let res: Anthropic.Message
  try {
    res = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      thinking: { type: 'disabled' },
      output_config: { effort: 'low' },
      system,
      messages,
    } as Anthropic.MessageCreateParamsNonStreaming)
  } catch (e) {
    // As askLlm: only a 4xx rejection is known to be unbilled.
    const unbilled =
      e instanceof Anthropic.APIError && typeof e.status === 'number' && e.status >= 400 && e.status < 500
    await p.reconcile(id, unbilled ? 0 : bound)
    const reason =
      e instanceof Anthropic.APIError && typeof e.status === 'number'
        ? `provider_${e.status}`
        : 'provider_error'
    return { ok: false, reason, costUsd: unbilled ? 0 : bound }
  }
  const u = res.usage
  const spent = actualUsd(
    (u.input_tokens ?? 0) +
      (u.cache_creation_input_tokens ?? 0) * 1.25 +
      (u.cache_read_input_tokens ?? 0) * 0.1,
    u.output_tokens ?? 0,
  )
  await p.reconcile(id, spent)
  if (res.stop_reason === 'refusal') return { ok: false, reason: 'refusal', costUsd: spent }
  if (res.stop_reason === 'max_tokens') return { ok: false, reason: 'max_tokens', costUsd: spent }
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
  return { ok: true, text, costUsd: spent }
}

// ---------------------------------------------------------------- the summariser

interface Entry {
  /** The stored summary (absent until one passes the checks). */
  s?: string
  /** Last time (ms) the key was in the current alerts, persisted at SEEN_GRANULARITY_MS. */
  seen: number
  /** Consecutive failures, and when the key may be tried again. */
  fails?: number
  retry?: number
}

interface Stored {
  v: 1
  entries: Record<string, Entry>
}

export interface SummaryStorage {
  get<T>(key: string): Promise<T | undefined>
  put(entries: Record<string, unknown>): Promise<void>
}

export interface SummariserDeps {
  storage: SummaryStorage
  now: () => number
  /** The provider for this run, or null (kill switch off, or not configured). Read once per run. */
  provider: () => SummaryProvider | null
  /** Provider fetch (tests); the global fetch by default. */
  fetch?: typeof fetch
  log?: Logger
}

export class AlertSummariser {
  private entries = new Map<string, Entry>()
  private loaded = false
  private running: Promise<void> | null = null
  /** Content key per alert object (alerts are rebuilt only when the feed changes). */
  private keys = new WeakMap<Alert, string>()
  /** Bumped whenever attach() would give a different result: the hub rebuilds its snapshot when it moves. */
  version = 0
  private disabledLogged = false
  private backoffLogged = 0
  private readonly log: Logger

  constructor(private readonly d: SummariserDeps) {
    this.log = d.log ?? silentLogger
  }

  private keyOf(a: Alert): string {
    let k = this.keys.get(a)
    if (!k) {
      k = contentKey(a)
      this.keys.set(a, k)
    }
    return k
  }

  /**
   * The alerts with their stored summaries (synchronous, memory only). Before the store has loaded, an alert keeps
   * whatever summary it already carries (a snapshot restored from R2), so a cold start doesn't publish a document
   * stripped of summaries.
   */
  attach(alerts: Alert[]): Alert[] {
    if (!this.loaded) return alerts
    return alerts.map((a) => {
      const s = this.entries.get(this.keyOf(a))?.s
      if (s === a.summary) return a
      if (s) return { ...a, summary: s }
      const { summary: _drop, ...rest } = a
      return rest
    })
  }

  /** Start a run for the current alerts unless one is in flight. Never throws, never awaited by the cycle. */
  kick(alerts: Alert[]): Promise<void> {
    if (this.running) return this.running
    this.running = this.run(alerts)
      .catch((e) => this.log.warn('alert summary run failed', { error: errorMessage(e) }))
      .finally(() => (this.running = null))
    return this.running
  }

  /** The run in flight, if any (tests). */
  idle(): Promise<void> {
    return this.running ?? Promise.resolve()
  }

  private async run(alerts: Alert[]): Promise<void> {
    const now = this.d.now()
    let dirty = false
    if (!this.loaded) {
      const stored = await this.d.storage.get<Stored>(STORAGE_KEY)
      this.entries = new Map(Object.entries(stored?.v === 1 ? stored.entries : {}))
      this.loaded = true
      this.version++
    }

    // Mark the current alerts seen, then evict keys gone for EVICT_AFTER_MS (and the oldest past MAX_ENTRIES).
    const current = new Map<string, Alert>()
    for (const a of alerts) current.set(this.keyOf(a), a)
    for (const k of current.keys()) {
      const e = this.entries.get(k)
      if (!e) {
        this.entries.set(k, { seen: now })
        dirty = true
      } else if (now - e.seen >= SEEN_GRANULARITY_MS) {
        e.seen = now
        dirty = true
      }
    }
    let evicted = 0
    for (const [k, e] of this.entries) {
      if (!current.has(k) && now - e.seen > EVICT_AFTER_MS) {
        this.entries.delete(k)
        evicted++
      }
    }
    if (this.entries.size > MAX_ENTRIES) {
      const oldest = [...this.entries]
        .filter(([k]) => !current.has(k))
        .sort((x, y) => x[1].seen - y[1].seen)
        .slice(0, this.entries.size - MAX_ENTRIES)
      for (const [k] of oldest) this.entries.delete(k)
      evicted += oldest.length
    }
    if (evicted > 0) dirty = true

    const missing = [...current].filter(([k]) => !this.entries.get(k)?.s)
    const due = missing.filter(([k]) => (this.entries.get(k)?.retry ?? 0) <= now)
    const backoff = missing.length - due.length
    const counts = { generated: 0, rejected: 0, failed: 0, backoff, pending: missing.length, evicted }

    const provider = due.length > 0 ? this.d.provider() : null
    if (due.length > 0 && !provider) {
      if (!this.disabledLogged) this.log.info('alert summary skipped: disabled', { pending: missing.length })
      this.disabledLogged = true
    } else if (provider) {
      this.disabledLogged = false
      for (const [k, a] of due.slice(0, MAX_PER_RUN)) {
        const r = await callSummary(a, provider, this.d.fetch)
        const e = this.entries.get(k) as Entry
        if (!r.ok && r.budget) {
          // Over budget or denied: no backoff, try again next cycle.
          this.log.info('alert summary skipped: budget', { reason: r.reason, pending: missing.length })
          break
        }
        dirty = true
        const checked = r.ok ? checkSummary(r.text, a) : null
        if (checked?.ok) {
          e.s = checked.summary
          delete e.fails
          delete e.retry
          counts.generated++
          this.version++
          this.log.info('alert summary generated', {
            key: k,
            chars: checked.summary.length,
            costUsd: r.costUsd,
          })
          continue
        }
        e.fails = (e.fails ?? 0) + 1
        e.retry = this.d.now() + Math.min(BACKOFF_BASE_MS * 2 ** (e.fails - 1), BACKOFF_MAX_MS)
        if (checked) {
          counts.rejected++
          this.log.warn('alert summary rejected', { key: k, reason: checked.reason, fails: e.fails })
        } else {
          counts.failed++
          this.log.warn('alert summary failed', { key: k, reason: r.ok ? '' : r.reason, fails: e.fails })
        }
      }
    }
    // Logged when the number of keys waiting out a backoff changes, not every minute.
    if (backoff !== this.backoffLogged && backoff > 0)
      this.log.info('alert summary skipped: backoff', { keys: backoff })
    this.backoffLogged = backoff
    if (dirty) {
      const out: Stored = { v: 1, entries: Object.fromEntries(this.entries) }
      await this.d.storage.put({ [STORAGE_KEY]: out })
    }
    if (counts.generated + counts.rejected + counts.failed > 0) this.log.info('alert summary run', counts)
  }
}
