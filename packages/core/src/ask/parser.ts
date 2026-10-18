/**
 * Deterministic natural-language parser for /v1/ask (transit-architecture.md §3.9 step 2, ADR-0008).
 *
 * Handles the common shapes with a small grammar plus an injected fuzzy stop resolver, so most questions never
 * reach an LLM (target ≥ 70%). It only produces an *intent*; answers are always computed from live data.
 */
import type { Mode } from '../contract/index.ts'

export interface StopCandidate {
  mode: Mode
  key: string
  name: string
  /** 0..1, higher is better. */
  score: number
}

/** Fuzzy stop lookup (uFuzzy over the stop index in apps/edge). Returns best-first candidates. */
export type StopResolver = (text: string, mode?: Mode) => StopCandidate[]

export type Intent =
  | { kind: 'next_departure'; mode?: Mode; from: StopCandidate; to: StopCandidate; route?: string }
  | { kind: 'departures_at'; mode?: Mode; at: StopCandidate; route?: string }
  | { kind: 'route_status'; mode?: Mode; route: string }
  | { kind: 'alerts'; mode?: Mode; line?: string; stop?: StopCandidate }
  | { kind: 'trip_plan_unsupported'; from?: string; to?: string }

export type ParseResult =
  | { ok: true; intent: Intent; normalized: string }
  | {
      ok: false
      reason: 'no_match' | 'unresolved_stop' | 'ambiguous_stop'
      normalized: string
      detail?: string
    }

const MODE_WORDS: Array<[RegExp, Mode]> = [
  [/\b(ferry|ferries|citycat|city cat|citycats|cityhopper|kittycat|boat)\b/, 'ferry'],
  [/\b(train|trains|rail|railway)\b/, 'train'],
  [/\b(bus|buses|busway|metro|glider|cityglider|buz)\b/, 'bus'],
  [/\b(tram|trams|g:link|glink|light rail)\b/, 'tram'],
]

/** Lowercase, strip punctuation and filler, expand abbreviations. Also the intent-cache key. */
export function normalizeQuestion(q: string): string {
  return q
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\b(what's|whats)\b/g, 'what is')
    .replace(/\b(when's|whens)\b/g, 'when is')
    .replace(/\b(where's|wheres)\b/g, 'where is')
    .replace(/\bstn\b/g, 'station')
    .replace(/\bnxt\b/g, 'next')
    .replace(/\bcbd\b/g, 'city')
    .replace(/[?!.,;]+/g, ' ')
    .replace(/\b(please|pls|hey|hi|ok|okay|um|uh|thanks|thank you)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function detectMode(s: string): Mode | undefined {
  for (const [re, mode] of MODE_WORDS) if (re.test(s)) return mode
  return undefined
}

function stripModeWords(s: string): string {
  let out = s
  for (const [re] of MODE_WORDS) out = out.replace(new RegExp(re.source, 'g'), ' ')
  return out
    .replace(/\b(the|a|an|my|next|first|last|station|stop|terminal|wharf|platform|service|services)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function resolve(
  resolver: StopResolver,
  raw: string,
  mode?: Mode,
): StopCandidate | 'unresolved' | 'ambiguous' {
  const text = stripModeWords(raw)
  if (!text) return 'unresolved'
  const c = resolver(text, mode)
  const best = c[0]
  if (!best || best.score < 0.6) return 'unresolved'
  const second = c[1]
  // Two near-equal distinct stops (any mode, e.g. several "Queen Street" bus stops): ask rather than guess.
  // An exact name match beats a non-exact one.
  const exactWins = best.score === 1 && (second?.score ?? 0) < 1
  if (second && !exactWins && second.score >= best.score - 0.05 && second.key !== best.key) {
    return 'ambiguous'
  }
  return best
}

const FROM_TO: RegExp[] = [
  /\b(?:from (.+?) (?:to|into|towards|toward|->|→) (.+)|to .+? from .+)$/,
  /^(.+?) (?:to|->|→) (.+?)(?: (?:next|now|soon|today|tonight))?$/,
]
const FROM_ONLY =
  /\b(?:from|leaving|leave|leaves|departing|depart|departs|out of) (.+?)(?: (?:next|now|soon|today|tonight))?$/
const AT_ONLY = /\b(?:at|for) (.+?)(?: (?:next|now|soon|today|tonight))?$/

export function parseQuestion(question: string, resolver: StopResolver): ParseResult {
  const s = normalizeQuestion(question)
  const mode = detectMode(s)
  const fail = (reason: 'no_match' | 'unresolved_stop' | 'ambiguous_stop', detail?: string): ParseResult => ({
    ok: false,
    reason,
    normalized: s,
    ...(detail ? { detail } : {}),
  })

  // Time constraints the grammar can't represent (first/last service, another day, a clock time) must not be
  // silently answered as "next departures" (Codex PR review). Leave them to the LLM / hint.
  if (
    /\b(first|last|final|earliest|latest|tomorrow|yesterday|weekend|saturday|sunday|monday|tuesday|wednesday|thursday|friday|after|before|until|by)\b/.test(
      s,
    ) ||
    /\b\d{1,2}([:.]\d{2})?\s*(am|pm)\b|\b\d{1,2}[:.]\d{2}\b/.test(s)
  ) {
    return fail('no_match', 'unsupported time constraint')
  }

  // Trip planning is out of scope until a planner exists (§3.9 step 6).
  if (/\b(how (do|can|would) i get|best way|fastest way|plan (a|my) (trip|journey)|directions)\b/.test(s)) {
    const m = /\b(?:from (.+?) )?to (.+)$/.exec(s)
    return {
      ok: true,
      normalized: s,
      intent: {
        kind: 'trip_plan_unsupported',
        ...(m?.[1] ? { from: m[1] } : {}),
        ...(m?.[2] ? { to: m[2] } : {}),
      },
    }
  }

  // Route status: "is my 199 late", "is the 60 running", "where is my F1".
  const statusMatch =
    /\b(?:is|are|where is|where's|how late is|how is) (?:my |the )?(?:route )?([pmfwgx]?\d{1,4}[a-z]?|cityglider|glider)\b(.*)$/.exec(
      s,
    )
  if (
    statusMatch &&
    /\b(late|on time|running|delayed|early|where|cancelled|canceled|how late|coming)\b/.test(s)
  ) {
    const route = (statusMatch[1] as string).toUpperCase()
    return { ok: true, normalized: s, intent: { kind: 'route_status', ...(mode ? { mode } : {}), route } }
  }

  // Alerts and disruptions.
  if (
    /\b(alert|alerts|disruption|disruptions|delays|delayed|trackwork|track work|closures|closed|outage|problems|issues)\b/.test(
      s,
    ) &&
    !/\b(is|am) (my|the)\b/.test(s)
  ) {
    const line = /\b(?:on|for|at) (?:the )?(.+?)(?: line| route)?$/.exec(s)?.[1]
    const lineText = line ? stripModeWords(line) : undefined
    return {
      ok: true,
      normalized: s,
      intent: { kind: 'alerts', ...(mode ? { mode } : {}), ...(lineText ? { line: lineText } : {}) },
    }
  }

  const routeInQuery = /\b(?:the|route|my) ([pmfwgx]?\d{1,4}[a-z]?)\b/.exec(s)?.[1]?.toUpperCase()

  // Next departure between two stops.
  if (
    /\b(next|when|what time|times?|departures?|leave|leaving|going|get|catch|is there)\b|->|→| to /.test(s)
  ) {
    for (const re of FROM_TO) {
      const m = re.exec(s)
      if (!m) continue
      let fromText = m[1] as string
      let toText = m[2] as string
      // "next train to X from Y": the destination came first.
      const swapped = /^(?:.*\b)?to (.+?) from (.+)$/.exec(s)
      if (swapped && re === FROM_TO[0]) {
        toText = swapped[1] as string
        fromText = swapped[2] as string
      }
      fromText = fromText
        .replace(/^.*\b(?:next|when is the next|when is|what time is the next|what time|is there a)\b/, '')
        .trim()
      const from = resolve(resolver, fromText, mode)
      const to = resolve(resolver, toText, mode ?? (typeof from === 'object' ? from.mode : undefined))
      if (from === 'ambiguous' || to === 'ambiguous') return fail('ambiguous_stop')
      if (from === 'unresolved' || to === 'unresolved') continue
      return {
        ok: true,
        normalized: s,
        intent: {
          kind: 'next_departure',
          mode: mode ?? from.mode,
          from,
          to,
          ...(routeInQuery ? { route: routeInQuery } : {}),
        },
      }
    }
    const fm = FROM_ONLY.exec(s)
    if (fm) {
      const from = resolve(resolver, fm[1] as string, mode)
      if (from === 'ambiguous') return fail('ambiguous_stop')
      if (from !== 'unresolved') {
        return {
          ok: true,
          normalized: s,
          intent: {
            kind: 'departures_at',
            mode: mode ?? from.mode,
            at: from,
            ...(routeInQuery ? { route: routeInQuery } : {}),
          },
        }
      }
      return fail('unresolved_stop', fm[1])
    }
  }

  // Departures at a stop: "departures at X", "what's leaving X", "X departures", "X".
  const am = AT_ONLY.exec(s) ?? /^(.+?) (?:departures|times|timetable|board)$/.exec(s)
  if (am && /\b(departures|leaving|times|timetable|board|next|what is)\b/.test(s)) {
    const at = resolve(resolver, am[1] as string, mode)
    if (at === 'ambiguous') return fail('ambiguous_stop')
    if (at !== 'unresolved') {
      return {
        ok: true,
        normalized: s,
        intent: {
          kind: 'departures_at',
          mode: mode ?? at.mode,
          at,
          ...(routeInQuery ? { route: routeInQuery } : {}),
        },
      }
    }
  }
  if (/\b(departures|what is leaving|leaving|timetable)\b/.test(s)) {
    const at = resolve(
      resolver,
      s.replace(/\b(departures|what is leaving|leaving|timetable|show|me|from|at)\b/g, ' '),
      mode,
    )
    if (typeof at === 'object')
      return { ok: true, normalized: s, intent: { kind: 'departures_at', mode: mode ?? at.mode, at } }
  }
  return fail('no_match')
}
