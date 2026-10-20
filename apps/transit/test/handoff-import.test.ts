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
    })
  })

  it('a pair merged here is what ferry savePair would have written', async () => {
    const { imp } = await modules()
    imp.mergeHandoff({ v: 1, ferry: { pair: PAIR, remember: true } })
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

describe('mergeHandoff', () => {
  it('bus: appends new stops after this device’s, no duplicates, same format and cookie as the bus app', async () => {
    localStorage.setItem('bft-bus-saved', JSON.stringify([BUS_B]))
    const { imp, bus } = await modules()
    expect(imp.mergeHandoff({ v: 1, bus: [BUS_A, BUS_B, BUS_A] })).toBe(1)
    expect(JSON.parse(localStorage.getItem('bft-bus-saved') ?? '')).toEqual([BUS_B, BUS_A])
    expect(bus.readSaved()).toEqual([BUS_B, BUS_A])
    expect(cookies().bft_bus_saved).toBe('1832.10802')
    // Again: nothing new.
    expect(imp.mergeHandoff({ v: 1, bus: [BUS_A] })).toBe(0)
    expect(JSON.parse(localStorage.getItem('bft-bus-saved') ?? '')).toEqual([BUS_B, BUS_A])
  })

  it('train: adds favourites not already saved, keeps the cap, same format and cookie', async () => {
    localStorage.setItem('bft-train-favourites', JSON.stringify([{ from: 'central', to: null }]))
    const { imp, train } = await modules()
    const added = imp.mergeHandoff({
      v: 1,
      train: [
        { from: 'central', to: null },
        { from: 'roma-street', to: 'indooroopilly' },
      ],
    })
    expect(added).toBe(1)
    expect(train.readFavourites()).toEqual([
      { from: 'central', to: null },
      { from: 'roma-street', to: 'indooroopilly' },
    ])
    expect(JSON.parse(localStorage.getItem('bft-train-favourites') ?? '')).toEqual(train.readFavourites())
    expect(decodeURIComponent(cookies().bft_fav ?? '')).toBe('central.,roma-street.indooroopilly')
  })

  it('train: only what fits under the favourites cap is counted', async () => {
    const own = Array.from({ length: MAX_FAVOURITES - 1 }, (_, i) => ({ from: `own-${i}`, to: null }))
    localStorage.setItem('bft-train-favourites', JSON.stringify(own))
    const { imp, train } = await modules()
    const added = imp.mergeHandoff({
      v: 1,
      train: [
        { from: 'a', to: null },
        { from: 'b', to: null },
      ],
    })
    expect(added).toBe(1)
    expect(train.readFavourites()).toHaveLength(MAX_FAVOURITES)
    expect(train.readFavourites().slice(0, own.length)).toEqual(own)
  })

  it('ferry: sets the pair when there is none here (remembered as on the old site) and marks the selector seen', async () => {
    const { imp, ferry } = await modules()
    expect(imp.mergeHandoff({ v: 1, ferry: { pair: PAIR, remember: true } })).toBe(1)
    expect(ferry.readSavedPair()).toEqual(PAIR)
    expect(JSON.parse(localStorage.getItem('brisbane-ferry-selected-stops') ?? '')).toEqual(PAIR)
    expect(localStorage.getItem('brisbane-ferry-remember-selection')).toBe('true')
    expect(localStorage.getItem('brisbane-ferry-selector-seen')).toBe('1')
    expect(cookies().bft_pair).toBe('317584.317590')
  })

  it('ferry: not remembered on the old site → this session only, as the ferry app does', async () => {
    const { imp, ferry } = await modules()
    expect(imp.mergeHandoff({ v: 1, ferry: { pair: PAIR, remember: false } })).toBe(1)
    expect(localStorage.getItem('brisbane-ferry-selected-stops')).toBeNull()
    expect(JSON.parse(sessionStorage.getItem('brisbane-ferry-selected-stops-session') ?? '')).toEqual(PAIR)
    expect(ferry.readSavedPair()).toEqual(PAIR)
  })

  it('ferry: never replaces a pair already saved here, and ignores pairs that aren’t real routes', async () => {
    const mine = { outbound: { id: '317590', name: 'Riverside' }, inbound: { id: '317584', name: 'Bulimba' } }
    localStorage.setItem('brisbane-ferry-selected-stops', JSON.stringify(mine))
    let m = await modules()
    expect(m.imp.mergeHandoff({ v: 1, ferry: { pair: PAIR, remember: true } })).toBe(0)
    expect(m.ferry.readSavedPair()).toEqual(mine)
    localStorage.clear()
    m = await modules()
    const fake = { outbound: { id: '999999', name: 'Nowhere' }, inbound: { id: '317590', name: 'Riverside' } }
    expect(m.imp.mergeHandoff({ v: 1, ferry: { pair: fake, remember: true } })).toBe(0)
    expect(localStorage.length).toBe(0)
  })

  it('storage that throws loses nothing and stops nothing', async () => {
    const { imp } = await modules()
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(imp.mergeHandoff({ v: 1, bus: [BUS_A] })).toBe(0)
    set.mockRestore()
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
