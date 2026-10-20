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
function hasFerryPair(): boolean {
  const ok = (p: unknown) => {
    const q = p as { outbound?: { id?: unknown }; inbound?: { id?: unknown } } | null
    return Boolean(q?.outbound?.id && q?.inbound?.id)
  }
  return ok(readJson(localStorage, STORES.ferry.pair)) || ok(readJson(sessionStorage, STORES.ferry.session))
}

/** The ferry pair, only when this device has none here (the ferry app keeps one pair) and it is a real route. */
function mergeFerry(p: NonNullable<HandoffPayload['ferry']>): number {
  if (hasFerryPair()) return 0
  const origin = terminalById(p.pair.outbound.id)
  const dest = terminalById(p.pair.inbound.id)
  if (!origin || !dest || !origin.destinations.includes(dest.id)) return 0
  // As ferry save-pair.ts savePair, with the curated names (normalisePair's).
  const pair = { outbound: { id: origin.id, name: origin.name }, inbound: { id: dest.id, name: dest.name } }
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
  return 1
}

function mergeTrain(list: NonNullable<HandoffPayload['train']>): number {
  const had = readTrain()
  const fresh = list.filter(
    (f, i) => !had.some((x) => sameFavourite(x, f)) && list.findIndex((x) => sameFavourite(x, f)) === i,
  )
  // The cap (MAX_FAVOURITES) holds: this device's own favourites come first.
  const room = Math.max(0, STORES.train.max - had.length)
  const added = fresh.slice(0, room)
  if (added.length === 0) return 0
  writeTrain([...had, ...added])
  return added.length
}

function mergeBus(list: NonNullable<HandoffPayload['bus']>): number {
  const had = readBusSaved()
  const fresh = list.filter(
    (s, i) => !had.some((x) => x.id === s.id) && list.findIndex((x) => x.id === s.id) === i,
  )
  if (fresh.length === 0) return 0
  writeBusSaved([...had, ...fresh])
  return fresh.length
}

/** Merges a validated payload into this origin's stores; the number of stops and trips added. */
export function mergeHandoff(p: HandoffPayload): number {
  let added = 0
  for (const merge of [
    () => (p.ferry ? mergeFerry(p.ferry) : 0),
    () => (p.train ? mergeTrain(p.train) : 0),
    () => (p.bus ? mergeBus(p.bus) : 0),
  ]) {
    try {
      added += merge()
    } catch {
      // Storage blocked or full: the favourites stay on the old site; nothing here is lost.
    }
  }
  return added
}

/** "Your 3 stops moved to My Transit", once, after the page has hydrated. Plain DOM, text only. */
export function showMovedNotice(n: number): void {
  const box = document.createElement('div')
  box.setAttribute('role', 'status')
  box.dataset.handoffNotice = ''
  box.className =
    'fixed inset-x-3 bottom-24 z-50 mx-auto flex max-w-md items-center gap-3 rounded-card border border-ferry-orange/30 bg-ferry-orange-light px-4 py-3 text-sm text-charcoal shadow-lg dark:bg-night-card dark:text-night-text'
  const text = document.createElement('p')
  text.className = 'flex-1'
  text.textContent = `Your ${n} ${n === 1 ? 'stop' : 'stops'} moved to My Transit`
  box.appendChild(text)
  if (location.pathname !== '/') {
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
  setTimeout(() => box.remove(), 12_000)
}

/**
 * Called by entry.client.tsx for an `#import=` page: merge, strip the fragment, then `hydrate`; the notice follows
 * once React has taken over the page. `hydrate` runs exactly once, whatever the payload holds.
 */
export function run(hydrate: () => void): void {
  let added = 0
  try {
    const payload = location.hash.startsWith(HANDOFF_PREFIX) ? decodeHandoff(location.hash) : null
    if (payload) added = mergeHandoff(payload)
    history.replaceState(history.state, '', `${location.pathname}${location.search}`)
  } catch {
    // An unusable fragment is ignored: the page opens as usual.
  }
  hydrate()
  if (added > 0) window.setTimeout(() => showMovedNotice(added), 300)
}
