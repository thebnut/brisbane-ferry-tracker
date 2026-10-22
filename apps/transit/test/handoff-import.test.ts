// @vitest-environment jsdom
/**
 * P6b: favourites arriving in `#import=` are merged into this origin's stores without duplicates and in each store's
 * own format, read back through the mode apps' own storage code.
 */
import { MAX_FAVOURITES } from '@bft/train/app/lib/storage.ts'
import type { HandoffPayload } from '@bft/ui/handoff-codec'
import { encodeHandoff, HANDOFF_PREFIX } from '@bft/ui/handoff-codec'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const PAIR = { outbound: { id: '317584', name: 'Bulimba' }, inbound: { id: '317590', name: 'Riverside' } }
const BUS_A = { id: '10802', name: 'Cultural Centre station, platform 1' }
const BUS_B = { id: '1832', name: 'King George Square station' }

/** Fresh modules each time, so the bus store's in-memory cache can't hide what storage holds. */
async function modules() {
  vi.resetModules()
  return {
    imp: await import('../app/lib/handoff-import.ts'),
    bus: await import('@bft/bus/app/lib/storage.ts'),
    train: await import('@bft/train/app/lib/storage.ts'),
    ferry: await import('@bft/ferry/app/lib/storage.ts'),
  }
}

const cookies = () =>
  Object.fromEntries(
    document.cookie
      .split('; ')
      .filter(Boolean)
      .map((c) => c.split('=') as [string, string]),
  )

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  // biome-ignore lint/suspicious/noDocumentCookie: clearing jsdom's cookies between tests.
  for (const c of document.cookie.split('; ')) document.cookie = `${c.split('=')[0]}=; max-age=0; path=/`
  history.replaceState(null, '', '/')
  document.body.innerHTML = ''
})
afterEach(() => vi.useRealTimers())

describe('STORES', () => {
  it('match the mode apps’ own storage keys, cookies and limits', async () => {
    const { imp, bus, train, ferry } = await modules()
    expect(imp.STORES.bus).toEqual({
      key: bus.KEYS.SAVED,
      cookie: bus.SAVED_COOKIE,
      ssrMax: bus.SSR_SAVED_MAX,
    })
    expect(imp.STORES.train).toEqual({
      key: train.FAVOURITES_KEY,
      cookie: train.FAV_COOKIE,
      ssrMax: train.MAX_SSR_FAVOURITES,
      max: train.MAX_FAVOURITES,
    })
    expect(imp.STORES.ferry).toEqual({
      pair: ferry.STORAGE_KEYS.SELECTED_STOPS,
      session: ferry.STORAGE_KEYS.SELECTED_STOPS_SESSION,
      remember: ferry.STORAGE_KEYS.REMEMBER_SELECTION,
      seen: ferry.STORAGE_KEYS.SELECTOR_SEEN,
      cookie: ferry.PAIR_COOKIE,
      favourites: (await import('@bft/ferry/app/lib/favourites.ts')).FAVOURITES_KEY,
    })
  })

  it('a pair merged here is what ferry savePair would have written', async () => {
    const { imp } = await modules()
    imp.mergeHandoff({ v: 1, ferry: { pair: PAIR, remember: true } })
    localStorage.removeItem(imp.LEDGER_KEY)
    const merged = { local: { ...localStorage }, cookie: document.cookie }
    localStorage.clear()
    const { savePair } = await import('@bft/ferry/app/lib/save-pair.ts')
    savePair(PAIR, true)
    localStorage.setItem('brisbane-ferry-selector-seen', '1')
    expect({ local: { ...localStorage }, cookie: document.cookie }).toEqual(merged)
  })

  it('train favourites merged here are what writeFavourites would have written', async () => {
    const list = [
      { from: 'central', to: null },
      { from: 'roma-street', to: 'indooroopilly' },
    ]
    const { imp, train } = await modules()
    imp.mergeHandoff({ v: 1, train: list })
    const merged = { local: localStorage.getItem('bft-train-favourites'), cookie: document.cookie }
    localStorage.clear()
    train.writeFavourites(list)
    expect({ local: localStorage.getItem('bft-train-favourites'), cookie: document.cookie }).toEqual(merged)
  })
})

const ledger = () => JSON.parse(localStorage.getItem('bft-handoff-imported') ?? '[]')
const none = { added: 0, left: 0, ferryConflict: null }

describe('mergeHandoff', () => {
  it('bus: appends new stops after this device’s, no duplicates, same format and cookie as the bus app', async () => {
    localStorage.setItem('bft-bus-saved', JSON.stringify([BUS_B]))
    const { imp, bus } = await modules()
    expect(imp.mergeHandoff({ v: 1, bus: [BUS_A, BUS_B, BUS_A] })).toEqual({ ...none, added: 1 })
    expect(JSON.parse(localStorage.getItem('bft-bus-saved') ?? '')).toEqual([BUS_B, BUS_A])
    expect(bus.readSaved()).toEqual([BUS_B, BUS_A])
    expect(cookies().bft_bus_saved).toBe('1832.10802')
    expect(ledger()).toEqual(['bus:1832', 'bus:10802'])
    // Again (the old site hands over on every visit): nothing new.
    expect(imp.mergeHandoff({ v: 1, bus: [BUS_A] })).toEqual(none)
    expect(JSON.parse(localStorage.getItem('bft-bus-saved') ?? '')).toEqual([BUS_B, BUS_A])
  })

  it('a stop removed here after its import is not added back by a later handoff', async () => {
    const { imp } = await modules()
    imp.mergeHandoff({ v: 1, bus: [BUS_A, BUS_B] })
    localStorage.setItem('bft-bus-saved', JSON.stringify([BUS_B]))
    expect(imp.mergeHandoff({ v: 1, bus: [BUS_A, BUS_B] })).toEqual(none)
    expect(JSON.parse(localStorage.getItem('bft-bus-saved') ?? '')).toEqual([BUS_B])
  })

  it('bus lists that arrive in turns all end up saved', async () => {
    const all = Array.from({ length: 70 }, (_, i) => ({ id: `${20000 + i}`, name: `Stop ${i}` }))
    const { imp } = await modules()
    expect(imp.mergeHandoff({ v: 1, bus: all.slice(0, 50) }).added).toBe(50)
    // The next turn starts where this one stopped and wraps round.
    expect(imp.mergeHandoff({ v: 1, bus: [...all.slice(50), ...all.slice(0, 30)] }).added).toBe(20)
    expect(JSON.parse(localStorage.getItem('bft-bus-saved') ?? '')).toEqual(all)
  })

  it('train: adds favourites not already saved, same format and cookie', async () => {
    localStorage.setItem('bft-train-favourites', JSON.stringify([{ from: 'central', to: null }]))
    const { imp, train } = await modules()
    const r = imp.mergeHandoff({
      v: 1,
      train: [
        { from: 'central', to: null },
        { from: 'roma-street', to: 'indooroopilly' },
      ],
    })
    expect(r).toEqual({ ...none, added: 1 })
    expect(train.readFavourites()).toEqual([
      { from: 'central', to: null },
      { from: 'roma-street', to: 'indooroopilly' },
    ])
    expect(JSON.parse(localStorage.getItem('bft-train-favourites') ?? '')).toEqual(train.readFavourites())
    expect(decodeURIComponent(cookies().bft_fav ?? '')).toBe('central.,roma-street.indooroopilly')
  })

  it('train: what doesn’t fit under the cap is left (not recorded), and moves once there is room', async () => {
    const own = Array.from({ length: MAX_FAVOURITES - 1 }, (_, i) => ({ from: `own-${i}`, to: null }))
    localStorage.setItem('bft-train-favourites', JSON.stringify(own))
    const { imp, train } = await modules()
    const incoming = {
      v: 1 as const,
      train: [
        { from: 'a', to: null },
        { from: 'b', to: null },
      ],
    }
    expect(imp.mergeHandoff(incoming)).toEqual({ ...none, added: 1, left: 1 })
    expect(train.readFavourites()).toHaveLength(MAX_FAVOURITES)
    expect(train.readFavourites().slice(0, own.length)).toEqual(own)
    expect(ledger()).toEqual(['train:a>'])
    // The visitor removes one here; the old site's next handoff brings the one that didn't fit.
    train.writeFavourites(train.readFavourites().slice(1))
    expect(imp.mergeHandoff(incoming)).toEqual({ ...none, added: 1 })
    expect(train.readFavourites().map((f) => f.from)).toContain('b')
  })

  it('ferry: sets the pair when there is none here (remembered as on the old site) and marks the selector seen', async () => {
    const { imp, ferry } = await modules()
    expect(imp.mergeHandoff({ v: 1, ferry: { pair: PAIR, remember: true } })).toEqual({ ...none, added: 1 })
    expect(ferry.readSavedPair()).toEqual(PAIR)
    expect(JSON.parse(localStorage.getItem('brisbane-ferry-selected-stops') ?? '')).toEqual(PAIR)
    expect(localStorage.getItem('brisbane-ferry-remember-selection')).toBe('true')
    expect(localStorage.getItem('brisbane-ferry-selector-seen')).toBe('1')
    expect(cookies().bft_pair).toBe('317584.317590')
  })

  it('ferry: not remembered on the old site → this session only, as the ferry app does', async () => {
    const { imp, ferry } = await modules()
    expect(imp.mergeHandoff({ v: 1, ferry: { pair: PAIR, remember: false } }).added).toBe(1)
    expect(localStorage.getItem('brisbane-ferry-selected-stops')).toBeNull()
    expect(JSON.parse(sessionStorage.getItem('brisbane-ferry-selected-stops-session') ?? '')).toEqual(PAIR)
    expect(ferry.readSavedPair()).toEqual(PAIR)
  })

  it('ferry: a different pair here is never replaced unasked; it is offered (the conflict), and stays unrecorded', async () => {
    const mine = { outbound: { id: '317590', name: 'Riverside' }, inbound: { id: '317584', name: 'Bulimba' } }
    localStorage.setItem('brisbane-ferry-selected-stops', JSON.stringify(mine))
    const { imp, ferry } = await modules()
    const handed = { pair: PAIR, remember: true }
    expect(imp.mergeHandoff({ v: 1, ferry: handed })).toEqual({ added: 0, left: 1, ferryConflict: handed })
    expect(ferry.readSavedPair()).toEqual(mine)
    expect(ledger()).toEqual([])
    // The same pair here already: recorded, nothing to do.
    localStorage.setItem('brisbane-ferry-selected-stops', JSON.stringify(PAIR))
    expect(imp.mergeHandoff({ v: 1, ferry: handed })).toEqual(none)
    expect(ledger()).toEqual(['ferry:317584>317590'])
  })

  it('ferry: a pair that isn’t a real route is dropped (nothing saved, not offered again)', async () => {
    const { imp } = await modules()
    const fake = { outbound: { id: '999999', name: 'Nowhere' }, inbound: { id: '317590', name: 'Riverside' } }
    expect(imp.mergeHandoff({ v: 1, ferry: { pair: fake, remember: true } })).toEqual(none)
    expect(localStorage.getItem('brisbane-ferry-selected-stops')).toBeNull()
  })

  it('storage that throws: counted as left, nothing recorded, so the next handoff stores them', async () => {
    const { imp, bus } = await modules()
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(imp.mergeHandoff({ v: 1, bus: [BUS_A] })).toEqual({ ...none, left: 1 })
    set.mockRestore()
    expect(localStorage.getItem('bft-handoff-imported')).toBeNull()
    expect(imp.mergeHandoff({ v: 1, bus: [BUS_A] })).toEqual({ ...none, added: 1 })
    expect(bus.readSaved()).toEqual([BUS_A])
  })
})

describe('failures never lose or resurrect a favourite (Codex r2)', () => {
  it('the ledger is never trimmed: after 301 imported stops, a removed first stop stays removed', async () => {
    const all = Array.from({ length: 301 }, (_, i) => ({ id: `${30000 + i}`, name: `Stop ${i}` }))
    const { imp } = await modules()
    for (let i = 0; i < all.length; i += 50) imp.mergeHandoff({ v: 1, bus: all.slice(i, i + 50) })
    expect(ledger()).toHaveLength(301)
    localStorage.setItem('bft-bus-saved', JSON.stringify(all.slice(1)))
    expect(imp.mergeHandoff({ v: 1, bus: all.slice(0, 50) })).toEqual(none)
    expect(
      JSON.parse(localStorage.getItem('bft-bus-saved') ?? '').map((s: { id: string }) => s.id),
    ).not.toContain('30000')
  })

  it('a ledger write that fails puts the store back: nothing stored unrecorded, retried next time', async () => {
    localStorage.setItem('bft-bus-saved', JSON.stringify([BUS_B]))
    const { imp, bus } = await modules()
    const real = Storage.prototype.setItem
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k, v) {
      if (k === 'bft-handoff-imported') throw new Error('QuotaExceededError')
      real.call(this, k, v)
    })
    expect(imp.mergeHandoff({ v: 1, bus: [BUS_A] })).toEqual({ ...none, left: 1 })
    set.mockRestore()
    expect(JSON.parse(localStorage.getItem('bft-bus-saved') ?? '')).toEqual([BUS_B])
    // As before the merge: there was no cookie.
    expect(cookies().bft_bus_saved).toBeUndefined()
    expect(imp.mergeHandoff({ v: 1, bus: [BUS_A] })).toEqual({ ...none, added: 1 })
    expect(bus.readSaved()).toEqual([BUS_B, BUS_A])
  })

  it('"Use it" that can’t be saved keeps the current pair (written before the old one is removed, rolled back)', async () => {
    const mine = { outbound: { id: '317590', name: 'Riverside' }, inbound: { id: '317584', name: 'Bulimba' } }
    localStorage.setItem('brisbane-ferry-selected-stops', JSON.stringify(mine))
    localStorage.setItem('brisbane-ferry-remember-selection', 'true')
    const { imp, ferry } = await modules()
    const real = Storage.prototype.setItem
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k, v) {
      if (this === sessionStorage) throw new Error('QuotaExceededError')
      real.call(this, k, v)
    })
    expect(imp.useHandedPair({ pair: PAIR, remember: false })).toBe(false)
    set.mockRestore()
    expect(ferry.readSavedPair()).toEqual(mine)
    expect(localStorage.getItem('brisbane-ferry-remember-selection')).toBe('true')
    expect(ledger()).toEqual([])
    // A late failure (the ledger) is rolled back too.
    const set2 = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k, v) {
      if (k === 'bft-handoff-imported') throw new Error('QuotaExceededError')
      real.call(this, k, v)
    })
    expect(imp.useHandedPair({ pair: PAIR, remember: true })).toBe(false)
    set2.mockRestore()
    expect(ferry.readSavedPair()).toEqual(mine)
    expect(imp.useHandedPair({ pair: PAIR, remember: true })).toBe(true)
    expect(ferry.readSavedPair()).toEqual(PAIR)
  })

  it('"Use it" failing in the notice: no reload, and it says the current trip is unchanged', async () => {
    vi.useFakeTimers()
    const mine = { outbound: { id: '317590', name: 'Riverside' }, inbound: { id: '317584', name: 'Bulimba' } }
    localStorage.setItem('brisbane-ferry-selected-stops', JSON.stringify(mine))
    history.replaceState(
      null,
      '',
      `/ferry${encodeHandoff({ v: 1, ferry: { pair: PAIR, remember: true } }) ?? ''}`,
    )
    const { imp } = await modules()
    imp.run(() => {})
    vi.advanceTimersByTime(300)
    const notice = document.querySelector('[data-handoff-notice]')
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    const reload = vi.fn()
    vi.stubGlobal('location', { ...location, reload, pathname: '/ferry' })
    ;[...(notice?.querySelectorAll('button') ?? [])].find((b) => b.textContent === 'Use it')?.click()
    vi.unstubAllGlobals()
    set.mockRestore()
    expect(reload).not.toHaveBeenCalled()
    expect(notice?.textContent).toContain(
      "Couldn't save that trip on this device. Your current ferry trip is unchanged.",
    )
  })
})

describe('Codex r3: the ledger first, cookies restored as they were', () => {
  it('a stop already here whose record can’t be written: nothing done, counted as left, recorded next time', async () => {
    localStorage.setItem('bft-bus-saved', JSON.stringify([BUS_A]))
    const { imp } = await modules()
    const real = Storage.prototype.setItem
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k, v) {
      if (k === 'bft-handoff-imported') throw new Error('QuotaExceededError')
      real.call(this, k, v)
    })
    expect(imp.mergeHandoff({ v: 1, bus: [BUS_A, BUS_B] })).toEqual({ ...none, left: 2 })
    set.mockRestore()
    expect(JSON.parse(localStorage.getItem('bft-bus-saved') ?? '')).toEqual([BUS_A])
    expect(imp.mergeHandoff({ v: 1, bus: [BUS_A, BUS_B] })).toEqual({ ...none, added: 1 })
    expect(ledger()).toEqual(['bus:10802', 'bus:1832'])
  })

  it('a store write that fails takes its items out of the ledger again (tried next time)', async () => {
    const { imp, bus } = await modules()
    const real = Storage.prototype.setItem
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k, v) {
      if (k === 'bft-bus-saved') throw new Error('QuotaExceededError')
      real.call(this, k, v)
    })
    expect(imp.mergeHandoff({ v: 1, bus: [BUS_A] })).toEqual({ ...none, left: 1 })
    set.mockRestore()
    expect(ledger()).toEqual([])
    expect(imp.mergeHandoff({ v: 1, bus: [BUS_A] })).toEqual({ ...none, added: 1 })
    expect(bus.readSaved()).toEqual([BUS_A])
  })

  it('a failed "Use it" restores a session-only pair’s cookie as a session cookie', async () => {
    const mine = { outbound: { id: '317590', name: 'Riverside' }, inbound: { id: '317584', name: 'Bulimba' } }
    sessionStorage.setItem('brisbane-ferry-selected-stops-session', JSON.stringify(mine))
    // biome-ignore lint/suspicious/noDocumentCookie: the session-only pair cookie the ferry app sets.
    document.cookie = 'bft_pair=317590.317584; path=/; samesite=lax'
    const { imp, ferry } = await modules()
    const writes: string[] = []
    const desc = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')
    const cookie = vi.spyOn(Document.prototype, 'cookie', 'set').mockImplementation(function (
      this: Document,
      v,
    ) {
      writes.push(v)
      desc?.set?.call(this, v)
    })
    const real = Storage.prototype.setItem
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k, v) {
      if (k === 'brisbane-ferry-selector-seen') throw new Error('QuotaExceededError')
      real.call(this, k, v)
    })
    expect(imp.useHandedPair({ pair: PAIR, remember: true })).toBe(false)
    set.mockRestore()
    cookie.mockRestore()
    expect(ferry.readSavedPair()).toEqual(mine)
    expect(localStorage.getItem('brisbane-ferry-selected-stops')).toBeNull()
    expect(cookies().bft_pair).toBe('317590.317584')
    expect(writes.at(-1)).toBe('bft_pair=317590.317584; path=/; samesite=lax')
    expect(ledger()).toEqual([])
  })
})

describe('Codex r4: pending until stored, so failed clean-up stays recoverable', () => {
  it('bus: the store write, its rollback and the ledger clean-up all fail; after recovery the stop is stored', async () => {
    const { imp, bus } = await modules()
    const real = Storage.prototype.setItem
    let ledgerWrites = 0
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k, v) {
      if (k === 'bft-bus-saved') throw new Error('QuotaExceededError')
      // The first ledger write (pending) works; the clean-up afterwards fails.
      if (k === 'bft-handoff-imported' && ++ledgerWrites > 1) throw new Error('QuotaExceededError')
      real.call(this, k, v)
    })
    const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    expect(imp.mergeHandoff({ v: 1, bus: [BUS_A] })).toEqual({ ...none, left: 1 })
    set.mockRestore()
    remove.mockRestore()
    expect(ledger()).toEqual(['?bus:10802'])
    expect(imp.mergeHandoff({ v: 1, bus: [BUS_A] })).toEqual({ ...none, added: 1 })
    expect(bus.readSaved()).toEqual([BUS_A])
    expect(ledger()).toEqual(['bus:10802'])
  })

  it('a stored stop whose final record fails stays pending: found saved next time and marked done', async () => {
    const { imp, bus } = await modules()
    const real = Storage.prototype.setItem
    let ledgerWrites = 0
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k, v) {
      if (k === 'bft-handoff-imported' && ++ledgerWrites > 1) throw new Error('QuotaExceededError')
      real.call(this, k, v)
    })
    expect(imp.mergeHandoff({ v: 1, bus: [BUS_A] })).toEqual({ ...none, added: 1 })
    set.mockRestore()
    expect(ledger()).toEqual(['?bus:10802'])
    expect(imp.mergeHandoff({ v: 1, bus: [BUS_A] })).toEqual(none)
    expect(ledger()).toEqual(['bus:10802'])
    expect(bus.readSaved()).toEqual([BUS_A])
  })

  it('a failed "Use it" whose clean-up also fails is offered again next time', async () => {
    const mine = { outbound: { id: '317590', name: 'Riverside' }, inbound: { id: '317584', name: 'Bulimba' } }
    localStorage.setItem('brisbane-ferry-selected-stops', JSON.stringify(mine))
    const { imp } = await modules()
    const real = Storage.prototype.setItem
    let ledgerWrites = 0
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k, v) {
      if (k === 'brisbane-ferry-selector-seen') throw new Error('QuotaExceededError')
      if (k === 'bft-handoff-imported' && ++ledgerWrites > 1) throw new Error('QuotaExceededError')
      real.call(this, k, v)
    })
    expect(imp.useHandedPair({ pair: PAIR, remember: true })).toBe(false)
    set.mockRestore()
    const handed = { pair: PAIR, remember: true }
    expect(imp.mergeHandoff({ v: 1, ferry: handed })).toEqual({ added: 0, left: 1, ferryConflict: handed })
  })
})

describe('noticeText', () => {
  it('says what moved, what was left and why, and asks about a ferry conflict', async () => {
    const { imp } = await modules()
    expect(imp.noticeText({ added: 3, left: 0, ferryConflict: null })).toBe(
      'Your 3 stops moved to My Transit.',
    )
    expect(imp.noticeText({ added: 1, left: 0, ferryConflict: null })).toBe(
      'Your 1 stop moved to My Transit.',
    )
    expect(imp.noticeText(none)).toBe('')
    expect(imp.noticeText({ added: 2, left: 1, ferryConflict: null })).toBe(
      "Your 2 stops moved to My Transit. 1 stop couldn't be added here (My Transit is full, or this browser blocked saving). They're still on the old site and will be tried again next time you open it.",
    )
    expect(imp.noticeText({ added: 0, left: 1, ferryConflict: { pair: PAIR, remember: true } })).toBe(
      'You already have a ferry trip here. Use Bulimba → Riverside from the old site instead?',
    )
  })
})

describe('run (entry.client.tsx)', () => {
  const open = (hash: string, path = '/bus/stop/10802?route=66') =>
    history.replaceState(null, '', `${path}${hash}`)

  it('merges, strips the fragment before hydrating, hydrates once, then shows the notice as text', async () => {
    vi.useFakeTimers()
    const p: HandoffPayload = { v: 1, bus: [BUS_A, BUS_B] }
    open(encodeHandoff(p) ?? '')
    const { imp, bus } = await modules()
    const seen: string[] = []
    const hydrate = vi.fn(() => seen.push(location.href))
    imp.run(hydrate)
    expect(hydrate).toHaveBeenCalledTimes(1)
    expect(seen[0]).toBe('http://localhost:3000/bus/stop/10802?route=66')
    expect(location.hash).toBe('')
    expect(bus.readSaved()).toEqual([BUS_A, BUS_B])
    expect(document.querySelector('[data-handoff-notice]')).toBeNull()
    vi.advanceTimersByTime(300)
    const notice = document.querySelector('[data-handoff-notice]')
    expect(notice?.getAttribute('role')).toBe('status')
    expect(notice?.textContent).toContain('Your 2 stops moved to My Transit')
    expect(notice?.querySelector('a')?.getAttribute('href')).toBe('/')
    vi.advanceTimersByTime(12_000)
    expect(document.querySelector('[data-handoff-notice]')).toBeNull()
  })

  it('one stop: singular; on My Transit itself, no "Open" link', async () => {
    vi.useFakeTimers()
    open(encodeHandoff({ v: 1, bus: [BUS_A] }) ?? '', '/')
    const { imp } = await modules()
    imp.run(() => {})
    vi.advanceTimersByTime(300)
    const notice = document.querySelector('[data-handoff-notice]')
    expect(notice?.textContent).toContain('Your 1 stop moved to My Transit')
    expect(notice?.querySelector('a')).toBeNull()
  })

  it('a name with markup is shown as text, never as HTML', async () => {
    vi.useFakeTimers()
    open(encodeHandoff({ v: 1, bus: [{ id: '1', name: '<img src=x onerror=alert(1)>' }] }) ?? '')
    const { imp } = await modules()
    imp.run(() => {})
    vi.advanceTimersByTime(300)
    expect(document.querySelector('img')).toBeNull()
  })

  it.each([
    ['malformed', `${HANDOFF_PREFIX}%%%`],
    ['huge', `${HANDOFF_PREFIX}${'A'.repeat(50_000)}`],
    [
      'extra keys',
      `${HANDOFF_PREFIX}${btoa(JSON.stringify({ v: 1, bus: [BUS_A], evil: 1 })).replace(/=+$/, '')}`,
    ],
    ['script', `${HANDOFF_PREFIX}${btoa('<script>alert(1)</script>').replace(/=+$/, '')}`],
  ])('%s: nothing stored, fragment stripped, page hydrates, no notice', async (_, hash) => {
    vi.useFakeTimers()
    open(hash)
    const { imp } = await modules()
    const hydrate = vi.fn()
    imp.run(hydrate)
    expect(hydrate).toHaveBeenCalledTimes(1)
    expect(location.hash).toBe('')
    expect(localStorage.length).toBe(0)
    vi.advanceTimersByTime(1000)
    expect(document.querySelector('[data-handoff-notice]')).toBeNull()
  })

  it('a ferry conflict asks, and "Use it" saves the old site’s pair and reloads', async () => {
    vi.useFakeTimers()
    const mine = { outbound: { id: '317590', name: 'Riverside' }, inbound: { id: '317584', name: 'Bulimba' } }
    localStorage.setItem('brisbane-ferry-selected-stops', JSON.stringify(mine))
    open(encodeHandoff({ v: 1, ferry: { pair: PAIR, remember: true } }) ?? '', '/ferry')
    const { imp, ferry } = await modules()
    imp.run(() => {})
    vi.advanceTimersByTime(300)
    const notice = document.querySelector('[data-handoff-notice]')
    expect(notice?.textContent).toContain('Use Bulimba → Riverside from the old site instead?')
    // A question stays until answered.
    vi.advanceTimersByTime(60_000)
    expect(document.querySelector('[data-handoff-notice]')).not.toBeNull()
    const reload = vi.fn()
    vi.stubGlobal('location', { ...location, reload, pathname: '/ferry' })
    const use = [...(notice?.querySelectorAll('button') ?? [])].find((b) => b.textContent === 'Use it')
    use?.click()
    vi.unstubAllGlobals()
    expect(reload).toHaveBeenCalledOnce()
    expect(ferry.readSavedPair()).toEqual(PAIR)
    expect(ledger()).toEqual(['ferry:317584>317590'])
  })

  it('all duplicates: no notice', async () => {
    vi.useFakeTimers()
    localStorage.setItem('bft-bus-saved', JSON.stringify([BUS_A]))
    open(encodeHandoff({ v: 1, bus: [BUS_A] }) ?? '')
    const { imp } = await modules()
    imp.run(() => {})
    vi.advanceTimersByTime(1000)
    expect(document.querySelector('[data-handoff-notice]')).toBeNull()
  })
})
