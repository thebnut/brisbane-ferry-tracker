// @vitest-environment jsdom
/** P4: train onboarding saves stations as favourites through storage.ts (format, cookie and cap unchanged). */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resaveTrain, saveTrain, trainHasSaved, trainSource, trainTrayItems } from '../app/lib/onboarding.ts'
import { FAV_COOKIE, FAVOURITES_KEY, MAX_FAVOURITES, writeFavourites } from '../app/lib/storage.ts'

const station = (id: string) => ({ mode: 'train' as const, id, name: id })

beforeEach(() => {
  localStorage.clear()
  // biome-ignore lint/suspicious/noDocumentCookie: clearing jsdom's cookies between tests.
  for (const c of document.cookie.split('; ')) document.cookie = `${c.split('=')[0]}=; max-age=0; path=/`
  vi.restoreAllMocks()
})

describe('train onboarding', () => {
  it('saves each station as a favourite with no destination, after any already there', () => {
    expect(trainHasSaved()).toBe(false)
    writeFavourites([{ from: 'central', to: 'roma-street' }])
    expect(saveTrain([station('bowen-hills'), { mode: 'bus', id: '1', name: 'x' }, station('central')])).toBe(
      true,
    )
    expect(JSON.parse(localStorage.getItem(FAVOURITES_KEY) ?? '[]')).toEqual([
      { from: 'central', to: 'roma-street' },
      { from: 'bowen-hills', to: null },
      { from: 'central', to: null },
    ])
    expect(decodeURIComponent(document.cookie)).toContain(
      `${FAV_COOKIE}=central.roma-street,bowen-hills.,central.`,
    )
    expect(trainHasSaved()).toBe(true)
  })

  it('keeps the store’s cap: favourites already there stay, and an overflow is reported', () => {
    writeFavourites(Array.from({ length: MAX_FAVOURITES }, (_, i) => ({ from: `s${i}`, to: null })))
    expect(saveTrain([station('central')])).toBe(false)
    expect(JSON.parse(localStorage.getItem(FAVOURITES_KEY) ?? '[]')).toHaveLength(MAX_FAVOURITES)
  })

  it('the picker has every station, with platforms; search finds them by name', () => {
    expect(trainSource.stops.length).toBeGreaterThan(100)
    expect(trainSource.search('bowen hils')[0]?.id).toBe('bowen-hills')
  })
})

describe('train re-run from Settings (THE-113)', () => {
  it('the tray opens with the station favourites (trips with a destination stay out of it)', () => {
    writeFavourites([
      { from: 'central', to: null },
      { from: 'central', to: 'roma-street' },
      { from: 'bowen-hills', to: null },
    ])
    expect(trainTrayItems().map((i) => [i.mode, i.id])).toEqual([
      ['train', 'central'],
      ['train', 'bowen-hills'],
    ])
    expect(trainTrayItems()[0]?.name).toBe('Central')
  })

  it('Save makes the station favourites match the tray; favourite trips keep their place', () => {
    writeFavourites([
      { from: 'central', to: null },
      { from: 'central', to: 'roma-street' },
      { from: 'bowen-hills', to: null },
    ])
    const before = trainTrayItems()
    expect(resaveTrain(before, [station('bowen-hills'), station('fortitude-valley')])).toBe(true)
    expect(JSON.parse(localStorage.getItem(FAVOURITES_KEY) ?? '[]')).toEqual([
      { from: 'bowen-hills', to: null },
      { from: 'central', to: 'roma-street' },
      { from: 'fortitude-valley', to: null },
    ])
    expect(decodeURIComponent(document.cookie)).toContain(
      `${FAV_COOKIE}=bowen-hills.,central.roma-street,fortitude-valley.`,
    )
  })

  it('an unchanged tray writes nothing; an emptied one leaves only the trips', () => {
    writeFavourites([
      { from: 'central', to: null },
      { from: 'central', to: 'roma-street' },
    ])
    const before = trainTrayItems()
    const set = vi.spyOn(Storage.prototype, 'setItem')
    expect(resaveTrain(before, [...before])).toBe(true)
    expect(set).not.toHaveBeenCalled()
    set.mockRestore()
    expect(resaveTrain(before, [])).toBe(true)
    expect(JSON.parse(localStorage.getItem(FAVOURITES_KEY) ?? '[]')).toEqual([
      { from: 'central', to: 'roma-street' },
    ])
  })

  it('an overflow past the store’s cap is reported', () => {
    writeFavourites(Array.from({ length: MAX_FAVOURITES }, (_, i) => ({ from: `s${i}`, to: 'central' })))
    expect(resaveTrain([], [station('central')])).toBe(false)
  })
})
