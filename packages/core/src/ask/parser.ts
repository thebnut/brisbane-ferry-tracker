/**
 * Deterministic natural-language parser for /v1/ask (transit-architecture.md §3.9 step 2, ADR-0008).
 *
 * Handles the common shapes with a small grammar plus an injected fuzzy stop resolver, so most questions never
 * reach an LLM (target ≥ 70%). It only produces an *intent*; answers are always computed from live data.
 */
import type { Mode } from '../contract/index.ts'
import { CITY_STOPS, type CityDirection, isCityStop } from './city.ts'

export interface StopCandidate {
  mode: Mode
  key: string
  name: string
  /** 0..1, higher is better. */
  score: number
  /** Public stop code (bus stop number), to tell same-named stops apart in an ambiguity reply. */
  code?: string
  /**
   * One place made of several stops (a busway station's platforms, R11-A1): every stop key, `key` first. Answers
   * cover them all; more than MAX_PLACE_STOPS is too many to fan out, so the question asks for the platform instead.
   */
  stopKeys?: string[]
}

/** The most stops one place may fan out to when answering (each is a departures read). */
export const MAX_PLACE_STOPS = 8

/**
 * Fuzzy stop lookup (uFuzzy over the stop index in apps/edge). Returns best-first candidates. With `platform` (a
 * platform or stop identifier the question named, lowercase: "2", "1e", "a"), only stops carrying it may come back:
 * never a whole station, and nothing when no candidate has it.
 */
export type StopResolver = (text: string, mode?: Mode, opts?: { platform?: string }) => StopCandidate[]

export type Intent =
  | {
      kind: 'next_departure'
      mode?: Mode
      from: StopCandidate
      to: StopCandidate
      route?: string
      /** A fact about the chosen destination the answer must state (e.g. "the airport" → International first). */
      note?: string
      /** `out`: `from` is the city itself (every stop in CITY_STOPS), "next ferry from the city to Bulimba". */
      city?: 'out'
    }
  | {
      kind: 'departures_at'
      mode?: Mode
      at: StopCandidate
      route?: string
      /** Only services that go on to a city stop (`in`) or that don't (`out`): "next bus from Krupp Rd to the city". */
      city?: CityDirection
    }
  | { kind: 'route_status'; mode?: Mode; route: string }
  | { kind: 'alerts'; mode?: Mode; line?: string; stop?: StopCandidate }
  | { kind: 'trip_plan_unsupported'; from?: string; to?: string }

export type ParseResult =
  | { ok: true; intent: Intent; normalized: string }
  | {
      ok: false
      reason: 'no_match' | 'unresolved_stop' | 'ambiguous_stop' | 'city_question'
      normalized: string
      /** For unresolved_stop and ambiguous_stop: the stop name as the question gave it (normalised, mode words removed). */
      detail?: string
      /** The mode the question named, if any (an ambiguity reply then mustn't ask for it). */
      mode?: Mode
      /** For ambiguous_stop: the places it could be, best first (two or three display names). */
      options?: string[]
      /** For ambiguous_stop on one station with too many stops to answer for at once: its name and stop count. */
      station?: { name: string; stops: number }
      /**
       * For city_question: why "the city" can't be answered as asked. `origin_in_city`: the stop (detail) is itself in
       * the city, so "to/out of the city" says nothing; `too_many_stops`: "from the city" by bus, which has too many
       * city stops to answer for at once.
       */
      city?: { why: 'origin_in_city' | 'too_many_stops'; dir: CityDirection }
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

interface Ambiguous {
  ambiguous: true
  text: string
  options: StopCandidate[]
  station?: { name: string; stops: number }
}

const AIRPORT = /^(?:brisbane )?airports?$/
/**
 * "The airport" by train: both airport stations are on the Airport line, and every airport train calls at
 * International Airport and then Domestic Airport (the terminus), minutes apart. So for a destination either is
 * correct and International, the first reached, gives the right departures (from International itself: Domestic). As
 * an origin they're different places and the question must say which.
 */
const AIRPORT_STATIONS = ['international-airport', 'domestic-airport'] as const

/**
 * "cultural centre platform 2", "strathpine bus station stop a", "queen street station platform 1 (southport) bus": a
 * platform or stop identifier after a name, taken out before filler words are stripped (the "a" of "stop a" is also an
 * article). With no name before it, "stop 123" is a stop number and stays.
 */
const PLATFORM = /^(.+?)\s*\b(?:platform|stop|bay)\s+(\d{1,3}[a-z]?|[a-z])\b(.*)$/

/**
 * The stop text and any platform it names. Only filler (mode words, articles) and a parenthesised locality may follow
 * the identifier; anything else makes the constraint unclear, and an unclear constraint is never dropped (that would
 * answer for the whole station): `null`, so the stop is unresolved.
 */
function splitPlatform(raw: string): { text: string; platform?: string } | null {
  const m = PLATFORM.exec(raw.trim())
  if (!m || !stripModeWords(m[1] as string)) return { text: stripModeWords(raw) }
  const tail = m[3] as string
  const locality = /\([^)]*\)/.exec(tail)?.[0]
  if (stripModeWords(tail.replace(/\([^)]*\)/, ' '))) return null
  return { text: stripModeWords(`${m[1]}${locality ? ` ${locality}` : ''}`), platform: m[2] as string }
}

function resolve(
  resolver: StopResolver,
  raw: string,
  mode?: Mode,
  role: 'from' | 'to' = 'from',
  fromKey?: string,
): StopCandidate | 'unresolved' | Ambiguous {
  const split = splitPlatform(raw)
  // "The city" is never a stop name: as a bus stop search it finds "City of Gold Coast, Nerang".
  if (!split?.text || CITY_WORDS.test(split.text)) return 'unresolved'
  const { text, platform } = split
  // Same place twice (a resolver may list a station once per platform): collapse before the ambiguity test.
  const seen = new Set<string>()
  const c = resolver(text, mode, platform ? { platform } : undefined).filter((x) => {
    const k = `${x.mode}:${x.key}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  const best = c[0]
  if (!best || best.score < 0.6) return 'unresolved'

  if (AIRPORT.test(text) && best.mode === 'train') {
    const byKey = new Map(c.filter((x) => x.mode === 'train').map((x) => [x.key, x]))
    const [intl, dom] = AIRPORT_STATIONS.map((k) => byKey.get(k))
    if (intl && dom) {
      if (role === 'to') return { ...(fromKey === intl.key ? dom : intl), score: 1 }
      return { ambiguous: true, text, options: [dom, intl] }
    }
  }

  // Near-equal distinct places (any mode, e.g. several "Queen Street" bus stops): ask rather than guess.
  // An exact name match beats a non-exact one.
  const second = c[1]
  const exactWins = best.score === 1 && (second?.score ?? 0) < 1
  if (second && !exactWins && second.score >= best.score - 0.05) {
    return { ambiguous: true, text, options: c.filter((x) => x.score >= best.score - 0.05) }
  }
  // One station with more stops than an answer can cover: ask for the platform (R11-A1).
  if (best.stopKeys && best.stopKeys.length > MAX_PLACE_STOPS)
    return {
      ambiguous: true,
      text,
      options: [best],
      station: { name: best.name, stops: best.stopKeys.length },
    }
  return best
}

const isAmbiguous = (r: StopCandidate | 'unresolved' | Ambiguous): r is Ambiguous =>
  typeof r === 'object' && 'ambiguous' in r

/** Words a trailing-word retry never drops: they tell places apart ("Kangaroo Point North"). */
const KEEP_WORDS = /^(?:north|south|east|west|central|upper|lower|inner|outer)$/
const JOINS = /\b(?:to|into|towards|toward|for|via|from|and|or|then)\b|->|→/

/**
 * A stop the question named explicitly ("from X", "at X"): as resolve(), then, if nothing matches, again without the
 * last one or two words ("bulimba jetty" → Bulimba, THE-117). A retry only counts when it is confident (an exact or
 * prefix match, score ≥ 0.9) and is never a guess between places: an ambiguous retry asks, like any ambiguous stop.
 */
function resolveExplicit(
  resolver: StopResolver,
  raw: string,
  mode?: Mode,
  role: 'from' | 'to' = 'from',
  fromKey?: string,
): StopCandidate | 'unresolved' | Ambiguous {
  const first = resolve(resolver, raw, mode, role, fromKey)
  if (first !== 'unresolved') return first
  const split = splitPlatform(raw)
  // A phrase that still joins two places ("bulimba to nowhereville") is never cut down to the first of them.
  if (!split?.text || split.platform || JOINS.test(split.text)) return first
  const words = split.text.split(' ')
  for (let drop = 1; drop <= 2 && words.length > drop; drop++) {
    if (words.slice(-drop).some((w) => KEEP_WORDS.test(w))) break
    const text = words.slice(0, -drop).join(' ')
    if (text.length < 3) break
    const again = resolve(resolver, text, mode, role, fromKey)
    if (again === 'unresolved') continue
    if (isAmbiguous(again) || again.score >= 0.9) return again
  }
  return first
}

/** Display names for an ambiguity reply: the mode when they span modes, the stop number when names repeat. */
function optionNames(options: StopCandidate[]): string[] {
  const modes = new Set(options.map((o) => o.mode))
  const names = options.map((o) => o.name)
  return options.map((o) => {
    const dup = names.filter((n) => n === o.name).length > 1
    if (modes.size > 1) return `${o.name} (${o.mode})`
    return dup && o.code ? `${o.name} (stop ${o.code.replace(/^0+/, '')})` : o.name
  })
}

const FROM_TO: RegExp[] = [
  /\b(?:from (.+?) (?:to|into|towards|toward|->|→) (.+)|to .+? from .+)$/,
  // "leaving bulimba for riverside": with no "from", the stop after leaving/departing is the origin (THE-117).
  /\b(?:leaving|leave|leaves|departing|depart|departs) (.+?) (for|to|into|towards|toward) (.+)$/,
  /^(.+?) (?:to|->|→) (.+?)(?: (?:next|now|soon|today|tonight))?$/,
]
const LEAVING_FOR = FROM_TO[1] as RegExp
const LOOSE_TO = FROM_TO[2] as RegExp

/**
 * A verb between the origin and "to" is not part of the stop name: "from bulimba going to riverside", "bulimba heading
 * to riverside", "bound for riverside" (THE-117). No stop name in the ferry, train or bus index contains one.
 */
const CONNECTOR =
  /\b(?:going|heading|headed|travelling|traveling|getting|riding|bound|on (?:my|the) way) (to|into|in to|towards|toward|for)\b/g

/** The city as words: "the city", "city centre", "town" ("the cbd" is normalised to "the city"). */
const CITY = `(?:the )?(?:city(?: centre| center)?|town)`
/** What may end a question after its stops: "next", a mode word, a time filler ("... to the city next bus"). */
const TAIL = `(?: next)?(?: (?:ferry|ferries|citycat|boat|train|trains|bus|buses|service|services))?(?: (?:right now|now|soon|today))?$`
/** The city phrase ends the question (TAIL aside) or comes before "from"/"leaving": "to city hall" stays a stop. */
const CITY_END = `(?=${TAIL}| (?:from|leaving|departing) )`
const CITY_WORDS = /^(?:city(?: centre| center)?|town)$/
const CITY_IN = new RegExp(String.raw`\b(?:to|towards|toward|into|in to|for) ${CITY}${CITY_END}|\binbound\b`)
const CITY_OUT = new RegExp(String.raw`\b(?:out of|away from) ${CITY}${CITY_END}|\boutbound\b`)
const CITY_ORIGIN = new RegExp(
  String.raw`\b(?:from|leaving|out of) ${CITY} (?:to|for|into|towards|toward) (.+)$|\bto (.+?) from ${CITY}$`,
)
/** Question lead-ins before the origin ("when is the next", "what time is the next"). */
const LEAD = /^.*\b(?:next|when is the next|when is|what time is the next|what time|is there a)\b/
/** Trailing fillers ("to bulimba now") aren't part of a stop name, nor of the name an answer reports. */
const FILLER = /\s+(?:right now|next|now|soon|today)$/
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
  const ambiguous = (a: Ambiguous): ParseResult => ({
    ok: false,
    reason: 'ambiguous_stop',
    normalized: s,
    detail: a.text,
    ...(mode ? { mode } : {}),
    options: [...new Set(optionNames(a.options))].slice(0, 3),
    ...(a.station ? { station: a.station } : {}),
  })
  // The first stop name an explicit "from X to Y", "from X" or "at X" couldn't resolve, so the answer can say which.
  // Looser shapes ("X to Y" with no "from") don't set it: their halves are often not stop names at all.
  let missing: string | undefined
  const miss = (raw: string) => {
    missing ??= stripModeWords(raw) || undefined
  }

  // Time constraints the grammar can't represent (first/last service, another day, a clock time) must not be
  // silently answered as "next departures" (Codex PR review). Leave them to the LLM / hint.
  if (
    /\b(first|last|final|earliest|latest|tomorrow|yesterday|tonight|weekend|saturday|sunday|monday|tuesday|wednesday|thursday|friday|after|before|until|by|noon|midday|midnight|morning|afternoon|evening|later|o'?clock)\b/.test(
      s,
    ) ||
    /\bin (a|an|one|two|three|four|five|ten|half an?|\d+) (min|mins|minutes?|hours?|hrs?)\b/.test(s) ||
    /\bat \d/.test(s) ||
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
    // A named route ("disruptions affecting the F1 citycat") is the line; otherwise "on/for/at the X line".
    // Compound or stop-number scopes ("F1 and F11", "at stop 1853 for route 66") can't be represented by one alerts
    // line: refuse rather than narrow or misassign the scope (Codex review, post-approval).
    if (/\b(stop|platform|number|no)\s*\d/.test(s)) return fail('no_match', 'stop-scoped alerts')
    const codes = [
      ...new Set([...s.matchAll(/\b([pmfwgx]\d{1,4}[a-z]?|\d{2,4}[a-z]?)\b/g)].map((m) => m[1] as string)),
    ]
    if (codes.length > 1 || /\b(and|or|plus)\b/.test(s)) return fail('no_match', 'compound alerts scope')
    const routeCode = codes[0]
    // Trailing time fillers ("today", "right now") aren't part of the line name (Codex verification).
    const sl = s.replace(/\s+(?:today|now|right now|currently|at the moment|at present)$/, '')
    const line =
      routeCode ??
      /\b(?:on|for|at|affecting) (?:the )?(.+?)(?: line| route)?$/.exec(sl)?.[1] ??
      /^(?:any |are there (?:any )?)?(?:the )?(.+?) (?:line|route) (?:alerts?|disruptions?|delays|trackwork|track work|closures|problems|issues)\b/.exec(
        sl,
      )?.[1]
    const lineText = line ? stripModeWords(line) : undefined
    return {
      ok: true,
      normalized: s,
      intent: { kind: 'alerts', ...(mode ? { mode } : {}), ...(lineText ? { line: lineText } : {}) },
    }
  }

  // Route restrictions: "the/route/my 199", "next bus 199", or any letter+digit code (F11, P137, M2). A route the
  // question names must never be silently dropped (Codex review round 5).
  const routeInQuery = (
    /\b(?:the|route|my) ([pmfwgx]?\d{1,4}[a-z]?)\b/.exec(s)?.[1] ??
    /\b(?:bus|ferry|citycat|train|tram) (\d{1,4}[a-z]?)\b/.exec(s)?.[1] ??
    /\bnext (\d{1,4}[a-z]?)\b/.exec(s)?.[1] ??
    /\b([pmfwgx]\d{1,4}[a-z]?)\b/.exec(s)?.[1]
  )?.toUpperCase()
  // Any other bare number we can't place (not a stop number, not the route) would be silently dropped: refuse instead.
  const strayNumber = [...s.matchAll(/\b\d{1,4}[a-z]?\b/g)].some((m) => {
    const before = s.slice(0, m.index).trimEnd()
    return m[0].toUpperCase() !== routeInQuery && !/\b(stop|platform|bay|number|no)$/.test(before)
  })
  if (strayNumber) return fail('no_match', 'unplaced number')

  // Verbs between the stops ("going to", "heading for") read as "to" from here on; `s` stays the cache key.
  const t = s.replace(CONNECTOR, (_m, to: string) => (to === 'for' ? 'to' : to))

  // "The city" as a destination or origin (THE-117): never a fuzzy stop match.
  const cityFail = (
    why: 'origin_in_city' | 'too_many_stops',
    dir: CityDirection,
    detail?: string,
  ): ParseResult => ({
    ok: false,
    reason: 'city_question',
    normalized: s,
    ...(detail ? { detail } : {}),
    ...(mode ? { mode } : {}),
    city: { why, dir },
  })
  const route = routeInQuery ? { route: routeInQuery } : {}
  // From the city to a stop: the city's stops are the origin, one place (ferry and train have a few; bus too many).
  const co = CITY_ORIGIN.exec(t)
  if (co) {
    const toText = ((co[1] ?? co[2]) as string).replace(FILLER, '')
    const to = resolveExplicit(resolver, toText, mode, 'to')
    if (isAmbiguous(to)) return ambiguous(to)
    if (to === 'unresolved') {
      miss(toText)
      return fail('unresolved_stop', missing)
    }
    const m = mode ?? to.mode
    const keys = CITY_STOPS[m]
    if (keys.length === 0 || keys.length > MAX_PLACE_STOPS) return cityFail('too_many_stops', 'out')
    const from: StopCandidate = {
      mode: m,
      key: keys[0] as string,
      name: 'the city',
      score: 1,
      stopKeys: [...keys],
    }
    return {
      ok: true,
      normalized: s,
      intent: { kind: 'next_departure', mode: m, from, to, ...route, city: 'out' },
    }
  }
  // From a stop towards the city, or away from it: that stop's departures, by where they go next.
  const ci = CITY_IN.exec(t)
  const cout = ci ? null : CITY_OUT.exec(t)
  const cm = ci ?? cout
  if (cm) {
    const dir: CityDirection = ci ? 'in' : 'out'
    const rest = `${t.slice(0, cm.index)} ${t.slice(cm.index + cm[0].length)}`
      .replace(/\s+/g, ' ')
      .trim()
      .replace(new RegExp(TAIL), '')
    const named = /\b(?:from|leaving|leave|leaves|departing|depart|departs) (.+?)$/.exec(rest)?.[1]
    // Without "from", what's left once the lead-in is gone ("krupp road to the city", "inbound buses at krupp road").
    const originText = (named ?? rest.replace(LEAD, '').replace(/^(?:.*\s)?(?:at|from) /, ''))
      .replace(FILLER, '')
      .trim()
    if (stripModeWords(originText)) {
      const at = named ? resolveExplicit(resolver, originText, mode) : resolve(resolver, originText, mode)
      if (isAmbiguous(at)) return ambiguous(at)
      if (at !== 'unresolved') {
        const m = mode ?? at.mode
        if (isCityStop(at.mode, at.stopKeys ?? [at.key])) return cityFail('origin_in_city', dir, at.name)
        return {
          ok: true,
          normalized: s,
          intent: { kind: 'departures_at', mode: m, at, ...route, city: dir },
        }
      }
      if (named) {
        miss(originText)
        return fail('unresolved_stop', missing)
      }
    }
  }

  // Next departure between two stops.
  if (
    /\b(next|when|what time|times?|departures?|leave|leaving|depart|departing|going|get|catch|is there)\b|->|→| to /.test(
      t,
    )
  ) {
    for (const re of FROM_TO) {
      const m = re.exec(t)
      if (!m) continue
      const explicit = re !== LOOSE_TO
      const leaving = re === LEAVING_FOR
      let fromText = m[1] as string
      let toText = (leaving ? m[3] : m[2]) as string
      // "next train to X from Y": the destination came first.
      const swapped = /^(?:.*\b)?to (.+?) from (.+)$/.exec(t)
      if (swapped && re === FROM_TO[0]) {
        toText = swapped[1] as string
        fromText = swapped[2] as string
      }
      fromText = fromText.replace(LEAD, '').trim()
      fromText = fromText.replace(FILLER, '')
      toText = toText.replace(FILLER, '')
      if (leaving) {
        // "leaving X for Y" must not split a stop named "... for ..." (Lake Sherrin Homes for Aged), nor read a route
        // ("leaving bulimba for the 66") as a stop number.
        const whole = resolve(resolver, `${fromText} ${m[2]} ${toText}`, mode)
        if (typeof whole === 'object' && !isAmbiguous(whole) && whole.score >= 0.9) continue
        if (/^\d/.test(stripModeWords(toText))) continue
      }
      const look = explicit ? resolveExplicit : resolve
      const from = look(resolver, fromText, mode)
      if (isAmbiguous(from)) return ambiguous(from)
      const to = look(
        resolver,
        toText,
        mode ?? (typeof from === 'object' ? from.mode : undefined),
        'to',
        typeof from === 'object' ? from.key : undefined,
      )
      if (isAmbiguous(to)) return ambiguous(to)
      if (from === 'unresolved' || to === 'unresolved') {
        if (explicit) miss(from === 'unresolved' ? fromText : toText)
        continue
      }
      const airport = to.mode === 'train' && AIRPORT.test(stripModeWords(toText))
      return {
        ok: true,
        normalized: s,
        intent: {
          kind: 'next_departure',
          mode: mode ?? from.mode,
          from,
          to,
          ...(routeInQuery ? { route: routeInQuery } : {}),
          ...(airport && to.key === 'international-airport'
            ? { note: 'Airport trains stop at International Airport, then continue to Domestic Airport.' }
            : {}),
        },
      }
    }
    // An explicit stop that didn't resolve ("to zzyzx from bulimba") is never answered as departures from the other.
    if (missing) return fail('unresolved_stop', missing)
    const fm = FROM_ONLY.exec(t)
    if (fm) {
      const from = resolveExplicit(resolver, fm[1] as string, mode)
      if (isAmbiguous(from)) return ambiguous(from)
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
      miss(fm[1] as string)
      return fail('unresolved_stop', missing)
    }
  }

  // Departures at a stop: "departures at X", "what's leaving X", "X departures", "X".
  const am = AT_ONLY.exec(s) ?? /^(.+?) (?:departures|times|timetable|board)$/.exec(s)
  if (am && /\b(departures|leaving|times|timetable|board|next|what is)\b/.test(s)) {
    const at = resolveExplicit(resolver, am[1] as string, mode)
    if (isAmbiguous(at)) return ambiguous(at)
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
    if (/\b(departures|leaving|times|timetable|board|next)\b/.test(s)) miss(am[1] as string)
  }
  if (/\b(departures|what is leaving|leaving|timetable)\b/.test(s)) {
    const at = resolve(
      resolver,
      s.replace(/\b(departures|what is leaving|leaving|timetable|show|me|from|at)\b/g, ' '),
      mode,
    )
    if (isAmbiguous(at)) return ambiguous(at)
    if (typeof at === 'object')
      return { ok: true, normalized: s, intent: { kind: 'departures_at', mode: mode ?? at.mode, at } }
  }
  return missing ? fail('unresolved_stop', missing) : fail('no_match')
}
