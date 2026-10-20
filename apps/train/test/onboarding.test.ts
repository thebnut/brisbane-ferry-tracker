// @vitest-environment jsdom
/** P4: train onboarding saves stations as favourites through storage.ts (format, cookie and cap unchanged). */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { saveTrain, trainHasSaved, trainSource } from '../app/lib/onboarding.ts'
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
