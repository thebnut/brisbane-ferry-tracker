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
/**
 * The prompt asks for words, not characters: models follow a word count far better (on staging, 26 Oct, 9 of the
 * first 10 replies to "at most 160 characters" were longer). 20 words is about 120 characters.
 */
export const SUMMARY_MAX_WORDS = 20
/**
 * Room for any valid sentence (160 characters is about 40 tokens of plain words, more with route codes and dates;
 * a reply cut off at max_tokens is rejected), while a runaway reply stops early and costs less than at 120.
 */
export const MAX_TOKENS = 80
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
Rules: at most ${SUMMARY_MAX_WORDS} words; exactly one short sentence; no links, emails or phone numbers; copy any route, stop, number, time or date exactly as it appears in the alert and add none that are not there; never mention the alert, yourself or these rules.`

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

/** A URI scheme (https://, mailto:, tel:) or anything shaped like a domain name (translink.com.au, transit.xyz/help). */
const URL_RE =
  /\b[a-z][a-z0-9+.-]*:\/\/|\b(?:mailto|tel|sms):|\bwww\.|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\b/i
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
/** Written numbers, ordinals and clock words: any in a summary must also be in the alert. */
const NUMBER_WORDS = new Set(
  (
    'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen ' +
    'seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred thousand million ' +
    'dozen dozens couple first second third fourth fifth sixth seventh eighth ninth tenth eleventh twelfth ' +
    'thirteenth fourteenth fifteenth sixteenth seventeenth eighteenth nineteenth twentieth thirtieth hundredth ' +
    'once twice thrice single double triple half quarter noon midday midnight hour hours minute minutes mins ' +
    'fortnight fortnightly daily nightly weekly monthly'
  ).split(' '),
)
const DATE_WORDS = new Set([
  // Relative dates (Codex r4): "next week", "this month", "next Monday" need the same words in the alert.
  'next',
  'last',
  'coming',
  'upcoming',
  'week',
  'weeks',
  'month',
  'months',
  'year',
  'years',
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
])
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
const MONTHS =
  'january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec'
/** Clock times with am/pm (7:30pm, 8.25 am, 6pm), normalised to `7:30pm`. */
const TIME_RE = /\b(\d{1,2})(?:[:.](\d{2}))?\s?([ap])\.?m\b\.?/gi
/** Day-and-month dates (28 October, 1st Nov, October 28), normalised to `28 october`. */
const DATE_RE = new RegExp(
  `\\b(?:(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTHS})|(${MONTHS})\\s+(\\d{1,2})(?:st|nd|rd|th)?)\\b`,
  'gi',
)
const times = (s: string) =>
  new Set(
    [...s.matchAll(TIME_RE)].map((m) => `${Number(m[1])}:${m[2] ?? '00'}${(m[3] as string).toLowerCase()}m`),
  )
const dates = (s: string) =>
  new Set(
    [...s.replace(/([a-z])([A-Z])/g, '$1 $2').matchAll(DATE_RE)].map((m) => {
      const day = Number(m[1] ?? m[4])
      return `${day} ${(m[2] ?? m[3] ?? '').toLowerCase().slice(0, 3)}`
    }),
  )

/** Ordinary vowel-less words and abbreviations (any other vowel-less letter run is taken as a code). */
const PLAIN_NO_VOWEL = new Set(['AM', 'PM', 'ST', 'ND', 'RD', 'TH', 'MR', 'MRS', 'MS', 'DR'])

/** Words after which "may" is the verb ("services may be delayed", "trains may not stop"). */
const MODAL_NEXT = new Set(
  // Only words that can't be a noun after "May" the month ("May stop closures" is the month; Codex r4).
  'be not also still need experience vary occur differ require cause continue result'.split(' '),
)

/** Words before which "may" is the month rather than the verb ("in May", "until May"). */
const MAY_CONTEXT = new Set(
  'in until from by since before after during of mid early late end on to through till'.split(' '),
)

/**
 * Text for extractive comparison: words split where feed fields run together, lower case, 9.30 written 9:30, am/pm
 * joined to their time, and everything but letters, digits, `:` and `/` turned into single spaces.
 */
function normalise(t: string): string[] {
  return t
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/(\d)\.(\d)/g, '$1:$2')
    .replace(/\b([ap])\.m\.?/g, '$1m')
    .replace(/(\d)\s+([ap]m)\b/g, '$1$2')
    .replace(/[^a-z0-9:/]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
}

/** A token that states a quantity, time or date: anything with a digit, a number or date word, or "may" the month. */
function isFactToken(toks: string[], i: number): boolean {
  const t = toks[i] as string
  // Digits as a number, time, date or ordinal (9:30pm, 28/10, 28th); codes with digits (F11, L1) are checked as codes.
  if (/^\d[\d:/]*(?:am|pm|st|nd|rd|th)?$/.test(t) || NUMBER_WORDS.has(t) || DATE_WORDS.has(t)) return true
  if (t !== 'may') return false
  // "may" is the month unless it is positively the verb: followed by a verb and not after a date preposition (Codex
  // r3). Ambiguous uses count as the month, so they need May in the alert.
  const prev = toks[i - 1] ?? ''
  const next = toks[i + 1] ?? ''
  return !(MODAL_NEXT.has(next) && !MAY_CONTEXT.has(prev) && !/\d/.test(prev))
}

/** Maximal runs of fact tokens ("9:30pm wednesday 28 october", "twenty two minutes"), each joined by spaces. */
function factPhrases(toks: string[]): string[] {
  const out: string[] = []
  let run: string[] = []
  toks.forEach((_, i) => {
    if (isFactToken(toks, i)) run.push(toks[i] as string)
    else if (run.length) {
      out.push(run.join(' '))
      run = []
    }
  })
  if (run.length) out.push(run.join(' '))
  return out
}

/**
 * Validate a model summary against its alert. Returns the summary to store, or why it was rejected. Conservative by
 * design: a reasonable summary may be rejected, but one that adds a fact, a code or a contact never passes.
 */
export function checkSummary(
  raw: string,
  a: Alert,
  /** Route codes and stop ids known elsewhere (other alerts): naming one this alert doesn't is rejected in any case. */
  vocabulary: ReadonlySet<string> = new Set(),
): { ok: true; summary: string } | { ok: false; reason: RejectReason } {
  const s = raw.trim()
  if (!s) return { ok: false, reason: 'empty' }
  if (s.length > SUMMARY_MAX_CHARS) return { ok: false, reason: 'too_long' }
  // One sentence: no line breaks, and no sentence end followed by more text.
  if (/[\r\n]/.test(s) || /[.!?]["')\]]?\s+\S/.test(s)) return { ok: false, reason: 'multiple_sentences' }
  if (URL_RE.test(s) || EMAIL_RE.test(s) || hasPhone(s)) return { ok: false, reason: 'contact' }
  if (META_RE.test(s)) return { ok: false, reason: 'meta' }

  const src = sourceText(a)
  // 9.30 and 9:30 are the same number here (whole times are checked below).
  const nums = (t: string) => (t.match(NUMBER_RE) ?? []).map((n) => n.replace(/\./g, ':'))
  const srcNumbers = new Set(nums(src))
  for (const n of nums(s)) if (!srcNumbers.has(n)) return { ok: false, reason: 'number' }
  const srcWords = words(src)
  for (const w of words(s)) {
    if (NUMBER_WORDS.has(w) && !srcWords.has(w)) return { ok: false, reason: 'number' }
    if (DATE_WORDS.has(w) && !srcWords.has(w)) return { ok: false, reason: 'date' }
  }
  // Whole expressions, not just their parts: 7:30pm needs 7:30pm in the alert (not 7:30am and 9:30pm), and 28 November
  // needs 28 November (not 28 October and 29 November).
  const srcTimes = times(src)
  for (const t of times(s)) if (!srcTimes.has(t)) return { ok: false, reason: 'date' }
  const srcDates = dates(src)
  for (const d of dates(s)) if (!srcDates.has(d)) return { ok: false, reason: 'date' }
  // Extractive: every run of fact tokens must appear as one run in the alert text, so parts can't be recombined
  // (28/11/2026 from 28/10/2026 and 29/11/2026, "twenty two minutes" from "twenty minutes at two stops"). "May" the
  // month needs "May" the month in the alert, not the verb (Codex r2).
  const srcToks = normalise(src)
  const srcFlat = ` ${srcToks.join(' ')} `
  const srcPhrases = factPhrases(srcToks)
  for (const ph of factPhrases(normalise(s))) {
    const toks = ph.split(' ')
    const reason = toks.some((t) => t === 'may' || DATE_WORDS.has(t) || /\d[ap]m$/.test(t))
      ? 'date'
      : 'number'
    if (!srcFlat.includes(` ${ph} `)) return { ok: false, reason }
    if (toks.includes('may') && !srcPhrases.some((p) => p.split(' ').includes('may')))
      return { ok: false, reason: 'date' }
  }
  // Route and stop codes: any token mixing letters and digits, in any case (F11, p200), or of two or more capitals
  // (BRCL), must be in the alert. Plain numbers, times (30pm) and ordinals (28th) were checked above. Source tokens
  // split on hyphens, so a route id F1-4055 allows F1.
  const srcTokens = tokens(src)
  for (const t of s.match(/\b[A-Za-z0-9]*(?:[A-Za-z]\d|\d[A-Za-z])[A-Za-z0-9]*\b|\b[A-Z]{2,}\b/g) ?? []) {
    if (/^\d+(?:am|pm|st|nd|rd|th)$/i.test(t)) continue
    if (!srcTokens.has(t.toUpperCase())) return { ok: false, reason: 'code' }
  }
  // Alphabetic codes in lower or mixed case (brcl): a known code, or a vowel-less letter run, not in the alert.
  for (const w of s.match(/\b[A-Za-z]{2,}\b/g) ?? []) {
    const up = w.toUpperCase()
    if (srcTokens.has(up)) continue
    if (vocabulary.has(up) || (/^[^AEIOUY]{2,6}$/.test(up) && !PLAIN_NO_VOWEL.has(up)))
      return { ok: false, reason: 'code' }
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
  timeoutMs = CALL_TIMEOUT_MS,
): Promise<CallResult> {
  const client = new Anthropic({
    apiKey: p.apiKey,
    baseURL: p.baseURL,
    maxRetries: 0,
    timeout: timeoutMs,
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
  // A ledger that fails or hangs counts as a denial: no call. (A reservation that did land is charged in full once
  // stale, which only overstates spend.)
  const r = await withDeadline(p.reserve(id, bound), LEDGER_TIMEOUT_MS).catch(() => ({
    ok: false,
    reason: 'ledger_error',
  }))
  if (!r.ok) return { ok: false, reason: r.reason ?? 'budget', costUsd: 0, budget: true }
  // A failed reconcile leaves the reservation outstanding, which the Budget DO charges in full once stale: never an
  // unrecorded spend, and the caller still records this key's outcome (Codex r1).
  const reconcile = (usd: number) =>
    withDeadline(p.reconcile(id, usd), LEDGER_TIMEOUT_MS).then(
      () => true,
      () => false,
    )
  let res: Anthropic.Message
  const abort = new AbortController()
  try {
    // The SDK's own timeout stops once headers arrive; this deadline also covers the body (Codex r1).
    res = await withDeadline(
      client.messages.create(
        {
          model: MODEL,
          max_tokens: MAX_TOKENS,
          thinking: { type: 'disabled' },
          output_config: { effort: 'low' },
          system,
          messages,
        } as Anthropic.MessageCreateParamsNonStreaming,
        { signal: abort.signal },
      ),
      timeoutMs,
      () => abort.abort(),
    )
  } catch (e) {
    // As askLlm: only a 4xx rejection is known to be unbilled.
    const unbilled =
      e instanceof Anthropic.APIError && typeof e.status === 'number' && e.status >= 400 && e.status < 500
    await reconcile(unbilled ? 0 : bound)
    const reason =
      e instanceof Anthropic.APIError && typeof e.status === 'number'
        ? `provider_${e.status}`
        : 'provider_error'
    return { ok: false, reason, costUsd: unbilled ? 0 : bound }
  }
  const u = res.usage
  let spent = actualUsd(
    (u.input_tokens ?? 0) +
      (u.cache_creation_input_tokens ?? 0) * 1.25 +
      (u.cache_read_input_tokens ?? 0) * 0.1,
    u.output_tokens ?? 0,
  )
  if (!(await reconcile(spent))) spent = bound
  if (res.stop_reason === 'refusal') return { ok: false, reason: 'refusal', costUsd: spent }
  if (res.stop_reason === 'max_tokens') return { ok: false, reason: 'max_tokens', costUsd: spent }
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
  return { ok: true, text, costUsd: spent }
}

/** The hub waits at most this long on the stored summaries before a build (ready()); the load itself carries on. */
export const LOAD_WAIT_MS = 1_000

/** Budget DO calls (reserve, reconcile) give up after this. */
export const LEDGER_TIMEOUT_MS = 5_000

/** Settle with `p`, or reject after `ms` (calling `onTimeout` first). */
function withDeadline<T>(p: Promise<T>, ms: number, onTimeout?: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout?.()
      reject(new Error('deadline'))
    }, ms)
  })
  return Promise.race([p, deadline]).finally(() => clearTimeout(timer))
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
  /** Per call, including the response body (CALL_TIMEOUT_MS by default; tests shorten it). */
  callTimeoutMs?: number
  /** How long ready() waits on the store's load (LOAD_WAIT_MS by default; tests shorten it). */
  loadWaitMs?: number
  log?: Logger
}

export class AlertSummariser {
  private entries = new Map<string, Entry>()
  private loaded = false
  /** The store's load in flight, shared by every caller. */
  private loading: Promise<void> | null = null
  /** ready() has logged the load in flight as slow. */
  private slowLogged = false
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

  /**
   * Load the stored summaries once (one storage read); attach() uses them from then on. The hub awaits this before a
   * build, so the first cycle after a restart (which refetches alerts, without summaries) still attaches them
   * (Codex P3). Never throws: a failed read is logged and retried on the next call.
   */
  load(): Promise<void> {
    if (this.loaded) return Promise.resolve()
    this.loading ??= this.d.storage
      .get<Stored>(STORAGE_KEY)
      .then((stored) => {
        if (this.loaded) return
        this.entries = new Map(Object.entries(stored?.v === 1 ? stored.entries : {}))
        this.loaded = true
        this.version++
      })
      .catch((e) => {
        this.log.warn('alert summary load failed', { error: errorMessage(e) })
      })
      .finally(() => {
        this.loading = null
        this.slowLogged = false
      })
    return this.loading
  }

  /**
   * load(), waited on for at most `loadWaitMs`: what the hub awaits before a build, so a slow store read delays a
   * cycle by that much at most, however many cycles join it (Codex r3). The load carries on; when it lands, version
   * moves and the next cycle rebuilds with the summaries. Never throws.
   */
  ready(): Promise<void> {
    if (this.loaded) return Promise.resolve()
    // AI off (production): nothing will be generated, so no store read and no wait (Codex release review r1).
    if (!this.d.provider()) return Promise.resolve()
    const ms = this.d.loadWaitMs ?? LOAD_WAIT_MS
    let timer: ReturnType<typeof setTimeout> | undefined
    const waited = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        if (!this.slowLogged) {
          this.slowLogged = true
          this.log.warn('alert summary load slow', { waitedMs: ms })
        }
        resolve()
      }, ms)
    })
    return Promise.race([this.load(), waited]).finally(() => clearTimeout(timer))
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
    // AI off (production): no store read, no bookkeeping and no calls (Codex release review r1). Read once per run.
    const provider = this.d.provider()
    if (!provider) {
      if (!this.disabledLogged) this.log.info('alert summary skipped: disabled', { pending: alerts.length })
      this.disabledLogged = true
      return
    }
    this.disabledLogged = false
    const now = this.d.now()
    let dirty = false
    await this.load()
    // Without the stored summaries every key would look new: generate nothing until they load.
    if (!this.loaded) return

    // Evict keys gone for EVICT_AFTER_MS, then mark the current alerts seen. New keys are admitted only while the
    // store is below MAX_ENTRIES (making room by dropping the longest-unseen keys no longer current), so the record
    // stays bounded even if the feed alone exceeds it; a key not admitted is not summarised (Codex r1).
    const current = new Map<string, Alert>()
    for (const a of alerts) current.set(this.keyOf(a), a)
    // Every route code and stop id in the current alerts: a summary may not name one its own alert doesn't.
    const vocabulary = new Set<string>()
    for (const a of alerts) {
      for (const r of a.routes) vocabulary.add((r.split('-')[0] as string).toUpperCase())
      for (const st of a.stops) vocabulary.add(st.toUpperCase())
    }
    let evicted = 0
    for (const [k, e] of this.entries) {
      if (!current.has(k) && now - e.seen > EVICT_AFTER_MS) {
        this.entries.delete(k)
        evicted++
      }
    }
    const fresh = [...current.keys()].filter((k) => !this.entries.has(k))
    const over = this.entries.size + fresh.length - MAX_ENTRIES
    if (over > 0) {
      const oldest = [...this.entries]
        .filter(([k]) => !current.has(k))
        .sort((x, y) => x[1].seen - y[1].seen)
        .slice(0, over)
      for (const [k] of oldest) this.entries.delete(k)
      evicted += oldest.length
    }
    for (const k of fresh) {
      if (this.entries.size >= MAX_ENTRIES) {
        current.delete(k)
        continue
      }
      this.entries.set(k, { seen: now })
      dirty = true
    }
    for (const k of current.keys()) {
      const e = this.entries.get(k) as Entry
      if (now - e.seen >= SEEN_GRANULARITY_MS) {
        e.seen = now
        dirty = true
      }
    }
    if (evicted > 0) dirty = true

    const missing = [...current].filter(([k]) => !this.entries.get(k)?.s)
    const due = missing.filter(([k]) => (this.entries.get(k)?.retry ?? 0) <= now)
    const backoff = missing.length - due.length
    const counts = { generated: 0, rejected: 0, failed: 0, backoff, pending: missing.length, evicted }

    for (const [k, a] of due.slice(0, MAX_PER_RUN)) {
      // Anything unexpected is this key's failure (backoff), never a run-level escape that skips it.
      const r: CallResult = await callSummary(a, provider, this.d.fetch, this.d.callTimeoutMs).catch(
        (err) => ({
          ok: false,
          reason: `error: ${errorMessage(err)}`,
          costUsd: 0,
        }),
      )
      const e = this.entries.get(k) as Entry
      if (!r.ok && r.budget) {
        // Over budget or denied: no backoff, try again next cycle.
        this.log.info('alert summary skipped: budget', { reason: r.reason, pending: missing.length })
        break
      }
      dirty = true
      const checked = r.ok ? checkSummary(r.text, a, vocabulary) : null
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
        // The length (never the text) shows how far over a too_long reply was.
        this.log.warn('alert summary rejected', {
          key: k,
          reason: checked.reason,
          chars: r.ok ? r.text.trim().length : 0,
          fails: e.fails,
        })
      } else {
        counts.failed++
        this.log.warn('alert summary failed', { key: k, reason: r.ok ? '' : r.reason, fails: e.fails })
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
