/**
 * P6b: favourites handed over by a mode host (brisbanebus.com etc.), whose localStorage this origin can't see. Its
 * handoff page sends them in the fragment (`#import=…`, never sent to a server). entry.client.tsx loads this module
 * only when the page opens with that fragment, before hydrating, so every store reads the merged lists.
 *
 * The payload is validated strictly (@bft/ui/handoff-codec), then merged without duplicates into the stores each
 * mode already uses on this origin, in their own formats: nothing on this device that is already saved is replaced.
 */

import { terminalById } from '@bft/ferry/app/lib/terminals.ts'
import { decodeHandoff, HANDOFF_PREFIX, type HandoffPayload, type HandoffStop } from '@bft/ui/handoff-codec'

/**
 * The stores' keys, cookies and limits, as the mode apps define them (bus, ferry and train `lib/storage.ts`, ferry
 * `lib/save-pair.ts`). Written out here rather than imported: importing those modules into this lazy chunk makes the
 * bundler split them differently and moved about 250 B onto every page's first load. test/handoff-import.test.ts
 * checks each value against the app's own module and reads every merged store back through the app's own code.
 */
export const STORES = {
  bus: { key: 'bft-bus-saved', cookie: 'bft_bus_saved', ssrMax: 3 },
  train: { key: 'bft-train-favourites', cookie: 'bft_fav', ssrMax: 3, max: 8 },
  ferry: {
    pair: 'brisbane-ferry-selected-stops',
    session: 'brisbane-ferry-selected-stops-session',
    remember: 'brisbane-ferry-remember-selection',
    seen: 'brisbane-ferry-selector-seen',
    cookie: 'bft_pair',
  },
} as const

const YEAR = 'max-age=31536000'
/** ferry names.ts cleanStopName. */
const cleanStopName = (name: string) => name.replace(/\s+ferry terminal$/i, '').trim()
const setCookie = (value: string) => {
  // biome-ignore lint/suspicious/noDocumentCookie: the Cookie Store API is not in Safari; plain preference cookies.
  document.cookie = value
}
const readJson = (store: Storage, key: string): unknown => {
  try {
    return JSON.parse(store.getItem(key) ?? 'null')
  } catch {
    return null
  }
}

/** bus storage.ts readList (without its in-memory cache). */
function readBusSaved(): HandoffStop[] {
  const v = readJson(localStorage, STORES.bus.key)
  return Array.isArray(v)
    ? v.filter((s): s is HandoffStop => typeof s?.id === 'string' && typeof s?.name === 'string')
    : []
}

/** bus storage.ts writeSaved: the list, and the cookie with the first few ids for server rendering. */
function writeBusSaved(list: HandoffStop[]): void {
  localStorage.setItem(STORES.bus.key, JSON.stringify(list))
  const ids = list
    .slice(0, STORES.bus.ssrMax)
    .map((s) => s.id)
    .filter((id) => /^[\w-]+$/.test(id))
  setCookie(`${STORES.bus.cookie}=${ids.join('.')}; path=/; samesite=lax; ${YEAR}`)
}

type Favourite = NonNullable<HandoffPayload['train']>[number]
const KEY_RE = /^[a-z0-9-]+$/
const sameFavourite = (a: Favourite, b: Favourite) => a.from === b.from && a.to === b.to

/** train storage.ts readFavourites (its clean(): valid keys, no duplicates, the cap). */
function readTrain(): Favourite[] {
  const v = readJson(localStorage, STORES.train.key)
  const out: Favourite[] = []
  for (const f of Array.isArray(v) ? v : []) {
    const from = f?.from
    const to = f?.to ?? null
    if (typeof from !== 'string' || !KEY_RE.test(from)) continue
    if (to !== null && (typeof to !== 'string' || !KEY_RE.test(to))) continue
    if (!out.some((x) => sameFavourite(x, { from, to }))) out.push({ from, to })
  }
  return out.slice(0, STORES.train.max)
}

/** train storage.ts writeFavourites: the list and the cookie of the first few ("from.to,from."). */
function writeTrain(list: Favourite[]): void {
  localStorage.setItem(STORES.train.key, JSON.stringify(list))
  const value = list
    .slice(0, STORES.train.ssrMax)
    .map((f) => `${f.from}.${f.to ?? ''}`)
    .join(',')
  setCookie(`${STORES.train.cookie}=${encodeURIComponent(value)}; path=/; samesite=lax; ${YEAR}`)
}

/** Whether ferry storage.ts readSavedPair finds a pair (localStorage, then this session's). */
function ferryPairKey(): string | null {
  const key = (p: unknown) => {
    const q = p as { outbound?: { id?: unknown }; inbound?: { id?: unknown } } | null
    return q?.outbound?.id && q?.inbound?.id ? `${q.outbound.id}>${q.inbound.id}` : null
  }
  return key(readJson(localStorage, STORES.ferry.pair)) ?? key(readJson(sessionStorage, STORES.ferry.session))
}

type FerryHandoff = NonNullable<HandoffPayload['ferry']>

/** As ferry save-pair.ts savePair, with the curated names (normalisePair's); null when it isn't a real route. */
function ferryPair(p: FerryHandoff) {
  const origin = terminalById(p.pair.outbound.id)
  const dest = terminalById(p.pair.inbound.id)
  if (!origin || !dest || !origin.destinations.includes(dest.id)) return null
  return { outbound: { id: origin.id, name: origin.name }, inbound: { id: dest.id, name: dest.name } }
}

export function saveFerryPair(p: FerryHandoff): void {
  const pair = ferryPair(p)
  if (!pair) return
  const f = STORES.ferry
  if (p.remember) {
    localStorage.setItem(f.remember, 'true')
    localStorage.setItem(f.pair, JSON.stringify(pair))
    sessionStorage.removeItem(f.session)
  } else {
    localStorage.removeItem(f.remember)
    localStorage.removeItem(f.pair)
    sessionStorage.setItem(f.session, JSON.stringify(pair))
  }
  setCookie(
    `${f.cookie}=${pair.outbound.id}.${pair.inbound.id}; path=/; samesite=lax${p.remember ? `; ${YEAR}` : ''}`,
  )
  // The stop selector doesn't open by itself for someone who already chose their stops.
  localStorage.setItem(f.seen, '1')
}

// ---- the ledger: what an import has stored here before ----

/**
 * Items an import has stored here (or found already saved), e.g. "bus:10802". The mode host hands its favourites over
 * on every visit until it has none, so an item in the ledger is skipped: one removed here isn't added back. Anything
 * not stored (no room, a different ferry pair, storage errors) stays out of it and is tried again next time.
 */
export const LEDGER_KEY = 'bft-handoff-imported'
const LEDGER_MAX = 300
const readLedger = (): string[] => {
  const v = readJson(localStorage, LEDGER_KEY)
  return Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string') : []
}
function addToLedger(keys: string[]): void {
  if (keys.length === 0) return
  try {
    const all = [...readLedger().filter((k) => !keys.includes(k)), ...keys]
    localStorage.setItem(LEDGER_KEY, JSON.stringify(all.slice(-LEDGER_MAX)))
  } catch {
    // Not recorded: those items are offered again next time and found already saved then.
  }
}

export interface MergeResult {
  /** Stored here now. */
  added: number
  /** Not stored (no room, or storage failed): still on the old site, tried again on its next visit. */
  left: number
  /** The old site's ferry pair, when this device already keeps a different one here (the ferry app keeps one). */
  ferryConflict: FerryHandoff | null
}

const ferryKey = (p: FerryHandoff) => `ferry:${p.pair.outbound.id}>${p.pair.inbound.id}`
const trainKey = (f: Favourite) => `train:${f.from}>${f.to ?? ''}`
const busKey = (s: HandoffStop) => `bus:${s.id}`

/** Merges a validated payload into this origin's stores, without duplicates and never replacing what is here. */
export function mergeHandoff(p: HandoffPayload): MergeResult {
  const result: MergeResult = { added: 0, left: 0, ferryConflict: null }
  const ledger = new Set(readLedger())
  const stored: string[] = []
  const attempt = (n: number, write: () => void) => {
    try {
      write()
      result.added += n
      return true
    } catch {
      result.left += n
      return false
    }
  }

  if (p.ferry && !ledger.has(ferryKey(p.ferry))) {
    const here = ferryPairKey()
    const pair = ferryPair(p.ferry)
    const mine = pair && `${pair.outbound.id}>${pair.inbound.id}`
    if (!pair || here === mine) stored.push(ferryKey(p.ferry))
    else if (here) {
      // A real route (pair is set): ask rather than replace.
      result.left += 1
      result.ferryConflict = p.ferry
    } else if (attempt(1, () => saveFerryPair(p.ferry as FerryHandoff))) stored.push(ferryKey(p.ferry))
  }

  if (p.train) {
    const had = readTrain()
    const incoming = p.train.filter((f, i) => p.train?.findIndex((x) => sameFavourite(x, f)) === i)
    const present = incoming.filter((f) => had.some((x) => sameFavourite(x, f)))
    const fresh = incoming.filter((f) => !ledger.has(trainKey(f)) && !had.some((x) => sameFavourite(x, f)))
    stored.push(...present.map(trainKey))
    // The cap (MAX_FAVOURITES) holds: this device's own favourites stay; what doesn't fit is left for next time.
    const fits = fresh.slice(0, Math.max(0, STORES.train.max - had.length))
    result.left += fresh.length - fits.length
    if (fits.length && attempt(fits.length, () => writeTrain([...had, ...fits])))
      stored.push(...fits.map(trainKey))
  }

  if (p.bus) {
    const had = readBusSaved()
    const incoming = p.bus.filter((s, i) => p.bus?.findIndex((x) => x.id === s.id) === i)
    stored.push(...incoming.filter((s) => had.some((x) => x.id === s.id)).map(busKey))
    const fresh = incoming.filter((s) => !ledger.has(busKey(s)) && !had.some((x) => x.id === s.id))
    if (fresh.length && attempt(fresh.length, () => writeBusSaved([...had, ...fresh])))
      stored.push(...fresh.map(busKey))
  }

  addToLedger(stored)
  return result
}

// ---- the notice ----

const stops = (n: number) => `${n} ${n === 1 ? 'stop' : 'stops'}`

/** What the notice says (empty when there is nothing to say). */
export function noticeText(r: MergeResult): string {
  const parts: string[] = []
  if (r.added > 0) parts.push(`Your ${stops(r.added)} moved to My Transit.`)
  const left = r.left - (r.ferryConflict ? 1 : 0)
  if (left > 0)
    parts.push(
      `${stops(left)} couldn't be added here (My Transit is full, or this browser blocked saving). They're still on the old site and move next time you open it.`,
    )
  const pair = r.ferryConflict && ferryPair(r.ferryConflict)
  if (pair)
    parts.push(
      `You already have a ferry trip here. Use ${cleanStopName(pair.outbound.name)} → ${cleanStopName(pair.inbound.name)} from the old site instead?`,
    )
  return parts.join(' ')
}

/** The notice, after the page has hydrated. Plain DOM, text only (names are never parsed as HTML). */
export function showMovedNotice(r: MergeResult): void {
  const message = noticeText(r)
  if (!message) return
  const box = document.createElement('div')
  box.setAttribute('role', 'status')
  box.dataset.handoffNotice = ''
  box.className =
    'fixed inset-x-3 bottom-24 z-50 mx-auto flex max-w-md flex-wrap items-center gap-3 rounded-card border border-ferry-orange/30 bg-ferry-orange-light px-4 py-3 text-sm text-charcoal shadow-lg dark:bg-night-card dark:text-night-text'
  const text = document.createElement('p')
  text.className = 'flex-1'
  text.textContent = message
  box.appendChild(text)
  const conflict = r.ferryConflict
  if (conflict) {
    const use = document.createElement('button')
    use.type = 'button'
    use.className = 'min-h-11 font-semibold text-ferry-orange-deep'
    use.textContent = 'Use it'
    use.addEventListener('click', () => {
      try {
        saveFerryPair(conflict)
        addToLedger([ferryKey(conflict)])
      } catch {
        // Storage blocked: nothing changes.
      }
      location.reload()
    })
    box.appendChild(use)
  } else if (location.pathname !== '/' && r.added > 0) {
    const open = document.createElement('a')
    open.href = '/'
    open.className = 'font-semibold text-ferry-orange-deep'
    open.textContent = 'Open'
    box.appendChild(open)
  }
  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'min-h-11 px-2 font-semibold'
  close.setAttribute('aria-label', 'Dismiss')
  close.textContent = '✕'
  close.addEventListener('click', () => box.remove())
  box.appendChild(close)
  document.body.appendChild(box)
  // A question stays until answered or dismissed; news goes by itself.
  if (!conflict) setTimeout(() => box.remove(), 12_000)
}

/**
 * Called by entry.client.tsx for an `#import=` page: merge, strip the fragment, then `hydrate`; the notice follows
 * once React has taken over the page. `hydrate` runs exactly once, whatever the payload holds.
 */
export function run(hydrate: () => void): void {
  let result: MergeResult | null = null
  try {
    const payload = location.hash.startsWith(HANDOFF_PREFIX) ? decodeHandoff(location.hash) : null
    if (payload) result = mergeHandoff(payload)
    history.replaceState(history.state, '', `${location.pathname}${location.search}`)
  } catch {
    // An unusable fragment is ignored: the page opens as usual.
  }
  hydrate()
  const r = result
  if (r && noticeText(r)) window.setTimeout(() => showMovedNotice(r), 300)
}
