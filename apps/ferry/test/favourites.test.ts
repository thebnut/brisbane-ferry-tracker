// @vitest-environment jsdom
/** THE-118 PR 1: ferry favourites, their one-time migration from the remembered pair, and the `bft_pair` mirror. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addFerryFavourite,
  FAVOURITES_KEY,
  firstFavouritePair,
  readFerryFavourites,
  removeFerryFavourite,
  writePairCookie,
} from '../app/lib/favourites.ts'
import { clearPair, savePair } from '../app/lib/save-pair.ts'
import { PAIR_COOKIE, pairFromCookie, readSavedPair, STORAGE_KEYS } from '../app/lib/storage.ts'
import { BULIMBA, RIVERSIDE, terminalById, validDestinations } from '../app/lib/terminals.ts'

const PAIR = JSON.stringify({
  outbound: { id: BULIMBA, name: 'Bulimba' },
  inbound: { id: RIVERSIDE, name: 'Riverside' },
})
const stored = () => JSON.parse(localStorage.getItem(FAVOURITES_KEY) ?? 'null')
const cookie = () => pairFromCookie(document.cookie)
/** The pair the home board opens with (FerryBoards): the saved pair, else the first favourite. */
const readHomePair = () => readSavedPair() ?? firstFavouritePair()
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
    expect(readHomePair()).toBeNull()
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
    expect(cookie()?.outbound.id).toBe(RIVERSIDE)
  })
})

describe('the bft_pair cookie (SSR)', () => {
  it('is the first ferry favourite when nothing is remembered', () => {
    addFerryFavourite({ from: RIVERSIDE, to: OTHER })
    addFerryFavourite({ from: BULIMBA, to: RIVERSIDE })
    expect(document.cookie).toContain(`${PAIR_COOKIE}=${RIVERSIDE}.${OTHER}`)
    expect(readHomePair()?.inbound.id).toBe(OTHER)
  })

  it('a first favourite with no "To" opens with its first destination', () => {
    addFerryFavourite({ from: RIVERSIDE, to: null })
    const first = validDestinations(RIVERSIDE)[0]
    expect(cookie()).toEqual(readHomePair())
    expect(cookie()?.inbound.id).toBe(first)
  })

  it("the remembered pair comes first, then this session's pair, as the board opens", () => {
    addFerryFavourite({ from: RIVERSIDE, to: OTHER })
    savePair(JSON.parse(PAIR), false)
    expect(cookie()?.outbound.id).toBe(BULIMBA)
    expect(readHomePair()?.outbound.id).toBe(BULIMBA)
    savePair(JSON.parse(PAIR), true)
    writePairCookie()
    expect(cookie()?.outbound.id).toBe(BULIMBA)
  })

  it('a pair kept on the device with remember off still wins, as the board picks it (Codex r1)', () => {
    localStorage.setItem(STORAGE_KEYS.SELECTED_STOPS, PAIR)
    localStorage.setItem(FAVOURITES_KEY, JSON.stringify([{ from: RIVERSIDE, to: OTHER }]))
    writePairCookie()
    expect(cookie()?.outbound.id).toBe(BULIMBA)
    expect(readHomePair()?.outbound.id).toBe(BULIMBA)
    expect(readFerryFavourites()).toEqual([{ from: RIVERSIDE, to: OTHER }])
  })

  it('is cleared when nothing is saved', () => {
    addFerryFavourite({ from: BULIMBA, to: RIVERSIDE })
    removeFerryFavourite({ from: BULIMBA, to: RIVERSIDE })
    expect(document.cookie).not.toContain(`${PAIR_COOKIE}=`)
  })
})
