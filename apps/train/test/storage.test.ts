import { describe, expect, it } from 'vitest'
import { favouritesCookieValue, favouritesFromCookie, themeFromCookie } from '../app/lib/storage.ts'

describe('favourites cookie (SSR)', () => {
  it('round-trips and caps at three', () => {
    const list = [
      { from: 'central', to: 'indooroopilly' },
      { from: 'roma-street', to: null },
      { from: 'bowen-hills', to: 'doomben' },
      { from: 'milton', to: null },
    ]
    const v = favouritesCookieValue(list)
    expect(v).toBe('central.indooroopilly,roma-street.,bowen-hills.doomben')
    expect(favouritesFromCookie(`a=1; bft_fav=${encodeURIComponent(v)}`)).toEqual(list.slice(0, 3))
  })
  it('rejects junk', () => {
    expect(favouritesFromCookie('bft_fav=%3Cscript%3E.x,ok.')).toEqual([{ from: 'ok', to: null }])
    expect(favouritesFromCookie(null)).toEqual([])
  })
  it('theme defaults to system', () => {
    expect(themeFromCookie('bft_theme=dark')).toBe('dark')
    expect(themeFromCookie('bft_theme=purple')).toBe('system')
  })
})
