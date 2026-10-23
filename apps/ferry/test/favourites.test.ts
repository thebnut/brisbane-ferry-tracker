// @vitest-environment jsdom
/**
 * THE-118 PR 1: ferry favourites and their one-time migration from the remembered pair; PR 8: the `bft_pair` mirror of
 * the first favourite, ferry home's headline.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addFerryFavourite,
  FAVOURITES_KEY,
  readFerryFavourites,
  removeFerryFavourite,
  writePairCookie,
} from '../app/lib/favourites.ts'
import { clearPair, savePair } from '../app/lib/save-pair.ts'
import { favouriteFromCookie, PAIR_COOKIE, readSavedPair, STORAGE_KEYS } from '../app/lib/storage.ts'
import { BULIMBA, RIVERSIDE, terminalById, validDestinations } from '../app/lib/terminals.ts'

const PAIR = JSON.stringify({
  outbound: { id: BULIMBA, name: 'Bulimba' },
  inbound: { id: RIVERSIDE, name: 'Riverside' },
})
const stored = () => JSON.parse(localStorage.getItem(FAVOURITES_KEY) ?? 'null')
/** Ferry home's headline as the server reads it. */
const cookie = () => favouriteFromCookie(document.cookie)
const OTHER = validDestinations(RIVERSIDE).find((id) => id !== BULIMBA) as string

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  // biome-ignore lint/suspicious/noDocumentCookie: clearing jsdom's cookies between tests.
  for (const c of document.cookie.split('; ')) document.cookie = `${c.split('=')[0]}=; max-age=0; path=/`
})
afterEach(() => vi.restoreAllMocks())

describe('migration from the remembered pair', () => {
  it('remember on: the pair becomes the first favourite, once', () => {
    localStorage.setItem(STORAGE_KEYS.SELECTED_STOPS, PAIR)
    localStorage.setItem(STORAGE_KEYS.REMEMBER_SELECTION, 'true')
    expect(readFerryFavourites()).toEqual([{ from: BULIMBA, to: RIVERSIDE }])
    expect(stored()).toEqual([{ from: BULIMBA, to: RIVERSIDE }])
    // The remembered pair itself stays for the standalone stop selector.
    expect(readSavedPair()?.outbound.id).toBe(BULIMBA)
  })

  it('remember off: no phantom favourite, from a pair in localStorage or this session', () => {
    localStorage.setItem(STORAGE_KEYS.SELECTED_STOPS, PAIR)
    sessionStorage.setItem(STORAGE_KEYS.SELECTED_STOPS_SESSION, PAIR)
    expect(readFerryFavourites()).toEqual([])
    expect(stored()).toEqual([])
  })

  it('already migrated: a list (even an empty one) is never seeded again', () => {
    localStorage.setItem(FAVOURITES_KEY, '[]')
    localStorage.setItem(STORAGE_KEYS.SELECTED_STOPS, PAIR)
    localStorage.setItem(STORAGE_KEYS.REMEMBER_SELECTION, 'true')
    expect(readFerryFavourites()).toEqual([])
    localStorage.setItem(FAVOURITES_KEY, JSON.stringify([{ from: RIVERSIDE, to: null }]))
    expect(readFerryFavourites()).toEqual([{ from: RIVERSIDE, to: null }])
  })

  it('malformed JSON reads as nothing and never throws', () => {
    localStorage.setItem(STORAGE_KEYS.SELECTED_STOPS, '{not json')
    localStorage.setItem(STORAGE_KEYS.REMEMBER_SELECTION, 'true')
    expect(readFerryFavourites()).toEqual([])
    localStorage.setItem(FAVOURITES_KEY, '{also not json')
    expect(readFerryFavourites()).toEqual([])
    localStorage.setItem(FAVOURITES_KEY, JSON.stringify({ from: BULIMBA }))
    expect(readFerryFavourites()).toEqual([])
  })

  it('cleans the list: unknown terminals dropped, an unreachable "To" becomes none, no duplicates', () => {
    localStorage.setItem(
      FAVOURITES_KEY,
      JSON.stringify([
        { from: 'nope', to: RIVERSIDE },
        { from: BULIMBA, to: RIVERSIDE },
        { from: BULIMBA, to: RIVERSIDE },
        { from: BULIMBA, to: '999999' },
        null,
        { from: RIVERSIDE },
      ]),
    )
    expect(readFerryFavourites()).toEqual([
      { from: BULIMBA, to: RIVERSIDE },
      { from: BULIMBA, to: null },
      { from: RIVERSIDE, to: null },
    ])
  })

  it('blocked storage: reads as no favourites, and saving never throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    expect(readFerryFavourites()).toEqual([])
    expect(() => addFerryFavourite({ from: BULIMBA, to: RIVERSIDE })).not.toThrow()
    expect(() => removeFerryFavourite({ from: BULIMBA, to: RIVERSIDE })).not.toThrow()
    expect(cookie()).toBeNull()
  })
})

describe('saving and unsaving', () => {
  it('as many as the rider likes, in the order saved, each trip once; "To" is optional', () => {
    addFerryFavourite({ from: BULIMBA, to: RIVERSIDE })
    addFerryFavourite({ from: RIVERSIDE, to: null })
    addFerryFavourite({ from: BULIMBA, to: RIVERSIDE })
    addFerryFavourite({ from: RIVERSIDE, to: OTHER })
    expect(stored()).toEqual([
      { from: BULIMBA, to: RIVERSIDE },
      { from: RIVERSIDE, to: null },
      { from: RIVERSIDE, to: OTHER },
    ])
    expect(removeFerryFavourite({ from: RIVERSIDE, to: null })).toEqual([
      { from: BULIMBA, to: RIVERSIDE },
      { from: RIVERSIDE, to: OTHER },
    ])
  })

  it('a restore goes back at its place', () => {
    addFerryFavourite({ from: BULIMBA, to: RIVERSIDE })
    addFerryFavourite({ from: RIVERSIDE, to: OTHER })
    addFerryFavourite({ from: RIVERSIDE, to: null }, 1)
    expect(stored().map((f: { to: string | null }) => f.to)).toEqual([RIVERSIDE, null, OTHER])
  })

  it('unsaving the remembered pair forgets it, so the board stops opening on it', () => {
    savePair(JSON.parse(PAIR), true)
    expect(stored()).toEqual([{ from: BULIMBA, to: RIVERSIDE }])
    removeFerryFavourite({ from: BULIMBA, to: RIVERSIDE })
    expect(readSavedPair()).toBeNull()
    expect(localStorage.getItem(STORAGE_KEYS.REMEMBER_SELECTION)).toBeNull()
  })

  it('unsaving another trip leaves the remembered pair alone', () => {
    savePair(JSON.parse(PAIR), true)
    addFerryFavourite({ from: RIVERSIDE, to: null })
    removeFerryFavourite({ from: RIVERSIDE, to: null })
    expect(readSavedPair()?.inbound.id).toBe(RIVERSIDE)
  })
})

describe('the standalone stop selector', () => {
  it('remembering a pair keeps working and also makes it a favourite; the old remembered pair stays one', () => {
    localStorage.setItem(STORAGE_KEYS.SELECTED_STOPS, PAIR)
    localStorage.setItem(STORAGE_KEYS.REMEMBER_SELECTION, 'true')
    const next = {
      outbound: { id: RIVERSIDE, name: 'Riverside' },
      inbound: { id: OTHER, name: terminalById(OTHER)?.name ?? '' },
    }
    savePair(next, true)
    expect(readSavedPair()?.outbound.id).toBe(RIVERSIDE)
    expect(stored()).toEqual([
      { from: BULIMBA, to: RIVERSIDE },
      { from: RIVERSIDE, to: OTHER },
    ])
  })

  it("a pair for this session only (remember off) is the board's for now, never a favourite", () => {
    savePair(JSON.parse(PAIR), false)
    expect(readSavedPair()?.outbound.id).toBe(BULIMBA)
    expect(readFerryFavourites()).toEqual([])
  })

  it('clearPair unsaves the remembered pair and its favourite, and the cookie follows', () => {
    savePair(JSON.parse(PAIR), true)
    addFerryFavourite({ from: RIVERSIDE, to: OTHER })
    clearPair()
    expect(readSavedPair()).toBeNull()
    expect(stored()).toEqual([{ from: RIVERSIDE, to: OTHER }])
    expect(cookie()).toEqual({ from: RIVERSIDE, to: OTHER })
  })
})

describe("the bft_pair cookie (SSR): the first favourite, ferry home's headline", () => {
  it('is the first ferry favourite', () => {
    addFerryFavourite({ from: RIVERSIDE, to: OTHER })
    addFerryFavourite({ from: BULIMBA, to: RIVERSIDE })
    expect(document.cookie).toContain(`${PAIR_COOKIE}=fav.${RIVERSIDE}.${OTHER}`)
    expect(cookie()).toEqual({ from: RIVERSIDE, to: OTHER })
  })

  it('a first favourite with no "To" is the whole terminal', () => {
    addFerryFavourite({ from: RIVERSIDE, to: null })
    expect(document.cookie).toContain(`${PAIR_COOKIE}=fav.${RIVERSIDE}.`)
    expect(cookie()).toEqual({ from: RIVERSIDE, to: null })
  })

  it('remember off: a pair for this session only never heads ferry home (no phantom favourite)', () => {
    savePair(JSON.parse(PAIR), false)
    expect(cookie()).toBeNull()
    addFerryFavourite({ from: RIVERSIDE, to: OTHER })
    savePair(JSON.parse(PAIR), false)
    expect(cookie()).toEqual({ from: RIVERSIDE, to: OTHER })
    // A pair left in localStorage with remember off isn't a favourite either.
    localStorage.setItem(STORAGE_KEYS.SELECTED_STOPS, PAIR)
    writePairCookie()
    expect(cookie()).toEqual({ from: RIVERSIDE, to: OTHER })
  })

  it('remember on: the remembered pair is a favourite, at the end of the list', () => {
    addFerryFavourite({ from: RIVERSIDE, to: OTHER })
    savePair(JSON.parse(PAIR), true)
    expect(cookie()).toEqual({ from: RIVERSIDE, to: OTHER })
    removeFerryFavourite({ from: RIVERSIDE, to: OTHER })
    expect(cookie()).toEqual({ from: BULIMBA, to: RIVERSIDE })
  })

  it("the older value (the home board's pair, maybe this session's) is never read as a favourite", () => {
    expect(favouriteFromCookie(`${PAIR_COOKIE}=${BULIMBA}.${RIVERSIDE}`)).toBeNull()
    expect(favouriteFromCookie(`${PAIR_COOKIE}=fav.999999.${RIVERSIDE}`)).toBeNull()
    // An unreachable "To" reads as the whole terminal.
    expect(favouriteFromCookie(`${PAIR_COOKIE}=fav.${BULIMBA}.999999`)).toEqual({ from: BULIMBA, to: null })
  })

  describe('a refused write (storage full) leaves the cookie on what storage holds', () => {
    const refuseFavourites = () => {
      const real = Storage.prototype.setItem
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
        this: Storage,
        key: string,
        value: string,
      ) {
        if (key === FAVOURITES_KEY) throw new DOMException('full', 'QuotaExceededError')
        return real.call(this, key, value)
      })
    }

    it('nothing saved yet: no cookie, so the next ferry home has no headline for the unsaved trip', () => {
      localStorage.setItem(FAVOURITES_KEY, '[]')
      refuseFavourites()
      expect(addFerryFavourite({ from: RIVERSIDE, to: OTHER })).toEqual([])
      expect(document.cookie).not.toContain(`${PAIR_COOKIE}=`)
    })

    it('a favourite saved before: the cookie stays on it', () => {
      addFerryFavourite({ from: BULIMBA, to: RIVERSIDE })
      refuseFavourites()
      addFerryFavourite({ from: RIVERSIDE, to: OTHER })
      expect(readFerryFavourites()).toEqual([{ from: BULIMBA, to: RIVERSIDE }])
      expect(cookie()).toEqual({ from: BULIMBA, to: RIVERSIDE })
    })
  })

  it('is cleared when nothing is saved', () => {
    addFerryFavourite({ from: BULIMBA, to: RIVERSIDE })
    removeFerryFavourite({ from: BULIMBA, to: RIVERSIDE })
    expect(document.cookie).not.toContain(`${PAIR_COOKIE}=`)
  })
})
