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
    /** ferry favourites.ts (THE-118): a remembered pair is also a favourite. */
    favourites: 'bft-ferry-favourites',
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
  // The new pair is written before the old one is removed, so a failed write leaves a pair (see storeWithRollback).
  if (p.remember) {
    localStorage.setItem(f.pair, JSON.stringify(pair))
    localStorage.setItem(f.remember, 'true')
    sessionStorage.removeItem(f.session)
  } else {
    sessionStorage.setItem(f.session, JSON.stringify(pair))
    localStorage.removeItem(f.remember)
    localStorage.removeItem(f.pair)
  }
  setCookie(
    `${f.cookie}=${pair.outbound.id}.${pair.inbound.id}; path=/; samesite=lax${p.remember ? `; ${YEAR}` : ''}`,
  )
  // As save-pair.ts: a remembered pair joins the ferry favourites, at the end (a new list when there is none: only a
  // device with no pair gets here, so the migration would have found nothing else).
  const had = readJson(localStorage, f.favourites)
  const favs = Array.isArray(had) ? had : []
  const fav = { from: pair.outbound.id, to: pair.inbound.id }
  if (p.remember && !favs.some((x) => x?.from === fav.from && (x?.to ?? null) === fav.to))
    localStorage.setItem(f.favourites, JSON.stringify([...favs, fav]))
  // The stop selector doesn't open by itself for someone who already chose their stops.
  localStorage.setItem(f.seen, '1')
}

// ---- the ledger: what an import has stored here before ----

/**
 * Items an import has stored here (or found already saved), e.g. "bus:10802". The mode host hands its favourites over
 * on every visit until it has none, so a done item is skipped: one removed here isn't added back. An item is first
 * recorded as pending ("?bus:10802") and marked done only once its store write has succeeded, so any failure on the
 * way (the write, a rollback, the final record) leaves at most a pending entry, which never skips anything: the item
 * is tried again next time. Anything not stored at all (no room, a different ferry pair) isn't recorded.
 */
export const LEDGER_KEY = 'bft-handoff-imported'
const PENDING = '?'
const readLedger = (): string[] => {
  const v = readJson(localStorage, LEDGER_KEY)
  return Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string') : []
}
/** Done keys (the ones that are skipped). */
const doneKeys = () => new Set(readLedger().filter((k) => !k.startsWith(PENDING)))

/**
 * Rewrites the ledger in one write: `done` keys become done (replacing their pending entries), `pending` keys are
 * added as pending, `dropped` pending entries go. Throws when storage refuses. Never trimmed: a done entry is what
 * keeps a stop removed here from coming back while the old site still hands it over, and it only grows with the
 * visitor's own favourites (a few bytes each).
 */
function writeLedger(change: { done?: string[]; pending?: string[]; dropped?: string[] }): void {
  const done = change.done ?? []
  const pending = (change.pending ?? []).map((k) => `${PENDING}${k}`)
  const gone = new Set([
    ...done.map((k) => `${PENDING}${k}`),
    ...(change.dropped ?? []).map((k) => `${PENDING}${k}`),
  ])
  const had = readLedger().filter((k) => !gone.has(k))
  const next = [...had, ...[...done, ...pending].filter((k) => !had.includes(k))]
  localStorage.setItem(LEDGER_KEY, JSON.stringify(next))
}

/** A cookie a store writes, and whether it outlives the session (the ferry pair's only when remembered). */
type CookieSpec = [name: string, persistent: boolean]

/** The current values of some storage keys and cookies, and a function that puts them back as they were. */
function snapshot(keys: [Storage, string][], cookies: CookieSpec[]): () => void {
  const values = keys.map(([store, key]) => store.getItem(key))
  const jar = cookies.map(
    ([name]) => document.cookie.split('; ').find((c) => c.startsWith(`${name}=`)) ?? null,
  )
  return () => {
    keys.forEach(([store, key], i) => {
      const v = values[i]
      if (v == null) store.removeItem(key)
      else store.setItem(key, v)
    })
    for (const [i, [name, persistent]] of cookies.entries()) {
      const was = jar[i]
      setCookie(
        was ? `${was}; path=/; samesite=lax${persistent ? `; ${YEAR}` : ''}` : `${name}=; path=/; max-age=0`,
      )
    }
  }
}

/** Writes a store; if the write throws, the store (and its cookie) is put back as it was. */
function storeWithRollback(keys: [Storage, string][], cookies: CookieSpec[], write: () => void): boolean {
  let restore: (() => void) | null = null
  try {
    restore = snapshot(keys, cookies)
    write()
    return true
  } catch {
    try {
      restore?.()
    } catch {
      // Storage refuses even the old values: nothing more can be done here.
    }
    return false
  }
}

/** Best effort: a ledger write that fails leaves pending entries, which are tried again next time. */
function tryLedger(change: Parameters<typeof writeLedger>[0]): void {
  try {
    writeLedger(change)
  } catch {
    // Pending entries stay pending.
  }
}

/** The ferry pair's cookie lasts a year only while the pair is remembered (ferry save-pair.ts). */
const FERRY_COOKIES = (): CookieSpec[] => [
  [STORES.ferry.cookie, localStorage.getItem(STORES.ferry.remember) === 'true'],
]
const FERRY_KEYS = (): [Storage, string][] => [
  [localStorage, STORES.ferry.pair],
  [localStorage, STORES.ferry.remember],
  [localStorage, STORES.ferry.seen],
  [localStorage, STORES.ferry.favourites],
  [sessionStorage, STORES.ferry.session],
]

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

/**
 * Merges a validated payload into this origin's stores, without duplicates and never replacing what is here. The ledger
 * is written first, for every incoming item that is here or about to be stored: if it can't be written, nothing is
 * stored and everything is left for next time (an item stored or found here but unrecorded could come back after
 * the visitor removes it).
 */
export function mergeHandoff(p: HandoffPayload): MergeResult {
  const result: MergeResult = { added: 0, left: 0, ferryConflict: null }
  const ledger = doneKeys()
  const present: string[] = []
  const writes: { items: string[]; keys: [Storage, string][]; cookies: CookieSpec[]; write: () => void }[] =
    []

  if (p.ferry && !ledger.has(ferryKey(p.ferry))) {
    const ferry = p.ferry
    const here = ferryPairKey()
    const pair = ferryPair(ferry)
    // Not a real route (nothing to store or offer), or already here.
    if (!pair || here === `${pair.outbound.id}>${pair.inbound.id}`) present.push(ferryKey(ferry))
    else if (here) {
      // Ask rather than replace.
      result.left += 1
      result.ferryConflict = ferry
    } else
      writes.push({
        items: [ferryKey(ferry)],
        keys: FERRY_KEYS(),
        cookies: FERRY_COOKIES(),
        write: () => saveFerryPair(ferry),
      })
  }

  if (p.train) {
    const had = readTrain()
    const incoming = p.train.filter((f, i) => p.train?.findIndex((x) => sameFavourite(x, f)) === i)
    present.push(...incoming.filter((f) => had.some((x) => sameFavourite(x, f))).map(trainKey))
    const fresh = incoming.filter((f) => !ledger.has(trainKey(f)) && !had.some((x) => sameFavourite(x, f)))
    // The cap (MAX_FAVOURITES) holds: this device's own favourites stay; what doesn't fit is left for next time.
    const fits = fresh.slice(0, Math.max(0, STORES.train.max - had.length))
    result.left += fresh.length - fits.length
    if (fits.length)
      writes.push({
        items: fits.map(trainKey),
        keys: [[localStorage, STORES.train.key]],
        cookies: [[STORES.train.cookie, true]],
        write: () => writeTrain([...had, ...fits]),
      })
  }

  if (p.bus) {
    const had = readBusSaved()
    const incoming = p.bus.filter((s, i) => p.bus?.findIndex((x) => x.id === s.id) === i)
    present.push(...incoming.filter((s) => had.some((x) => x.id === s.id)).map(busKey))
    const fresh = incoming.filter((s) => !ledger.has(busKey(s)) && !had.some((x) => x.id === s.id))
    if (fresh.length)
      writes.push({
        items: fresh.map(busKey),
        keys: [[localStorage, STORES.bus.key]],
        cookies: [[STORES.bus.cookie, true]],
        write: () => writeBusSaved([...had, ...fresh]),
      })
  }

  const fresh = writes.flatMap((w) => w.items)
  try {
    writeLedger({ done: present, pending: fresh })
  } catch {
    result.left += fresh.length + present.filter((k) => !ledger.has(k)).length
    return result
  }
  const stored: string[] = []
  const failed: string[] = []
  for (const w of writes) {
    if (storeWithRollback(w.keys, w.cookies, w.write)) {
      stored.push(...w.items)
      result.added += w.items.length
    } else {
      failed.push(...w.items)
      result.left += w.items.length
    }
  }
  tryLedger({ done: stored, dropped: failed })
  return result
}

/** The notice's "Use it": the old site's ferry pair replaces this one, or nothing changes (false). */
export function useHandedPair(ferry: FerryHandoff): boolean {
  const key = ferryKey(ferry)
  try {
    writeLedger({ pending: [key] })
  } catch {
    return false
  }
  const ok = storeWithRollback(FERRY_KEYS(), FERRY_COOKIES(), () => saveFerryPair(ferry))
  tryLedger(ok ? { done: [key] } : { dropped: [key] })
  return ok
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
      `${stops(left)} couldn't be added here (My Transit is full, or this browser blocked saving). They're still on the old site and will be tried again next time you open it.`,
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
      if (useHandedPair(conflict)) location.reload()
      else text.textContent = "Couldn't save that trip on this device. Your current ferry trip is unchanged."
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
