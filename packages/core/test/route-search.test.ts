/** Route search (P2): short names exact first, prefixes for route-like queries, long-name words otherwise. */
import { describe, expect, it } from 'vitest'
import { buildRouteSearchIndex, compareShort, searchRoutes } from '../src/route/search.ts'

const lines = [
  { short: '333', long: 'Chermside - Woolloongabba via City' },
  { short: '330', long: 'Bracken Ridge - City Express' },
  { short: '340', long: 'Carseldine - Woolloongabba Express via City' },
  { short: '33', long: 'Imaginary - Test' },
  { short: 'M1', long: 'Eight Mile Plains - City' },
  { short: 'M2', long: 'RBWH - UQ Lakes via City' },
  { short: '29', long: 'Woolloongabba - UQ Lakes Shuttle' },
  { short: '66', long: 'RBWH - UQ Lakes' },
  { short: 'N199', long: 'NightLink' },
  { short: 'GONE', long: 'Chermside Old Route' },
]
const shorts = ['333', '330', '340', '33', 'M1', 'M2', '29', '66', 'N199', '345']
const index = buildRouteSearchIndex(shorts, lines)
const shortsOf = (q: string, limit?: number) => searchRoutes(index, q, limit).hits.map((h) => h.short)

describe('searchRoutes', () => {
  it('puts the exact short name first, then prefixes in timetable order', () => {
    expect(shortsOf('33')).toEqual(['33', '330', '333'])
    expect(shortsOf('333')).toEqual(['333'])
    expect(shortsOf('3')).toEqual(['33', '330', '333', '340', '345'])
    expect(shortsOf('3', 2)).toEqual(['33', '330'])
  })

  it('matches letter-prefixed names in any case, with "route" or "#" in front', () => {
    expect(shortsOf('m1')).toEqual(['M1'])
    expect(shortsOf('M')).toEqual([])
    expect(shortsOf('route 66')).toEqual(['66'])
    expect(shortsOf('#n199')).toEqual(['N199'])
    expect(searchRoutes(index, 'm2').routeLike).toBe(true)
  })

  it('matches long-name words by prefix, every word, in timetable order', () => {
    expect(shortsOf('Chermside')).toEqual(['333'])
    expect(shortsOf('cherm')).toEqual(['333'])
    expect(shortsOf('UQ Lakes')).toEqual(['29', '66', 'M2'])
    expect(shortsOf('lakes uq')).toEqual(['29', '66', 'M2'])
    expect(shortsOf('woolloongabba express')).toEqual(['340'])
    expect(searchRoutes(index, 'Chermside').routeLike).toBe(false)
  })

  it('leaves out lines with no page, and short queries that are not route-like', () => {
    expect(shortsOf('Old Route')).toEqual([])
    expect(shortsOf('uq')).toEqual([])
    expect(shortsOf('')).toEqual([])
  })

  it('works on short names alone before the long names load', () => {
    const bare = buildRouteSearchIndex(shorts)
    expect(searchRoutes(bare, '333').hits).toEqual([{ short: '333' }])
    expect(searchRoutes(bare, 'Chermside').hits).toEqual([])
  })

  it('does not treat a five- or six-digit stop number as a route', () => {
    expect(searchRoutes(index, '10802')).toEqual({ hits: [], routeLike: false })
    expect(searchRoutes(index, '010802').routeLike).toBe(false)
  })
})

describe('compareShort', () => {
  it('orders numbers numerically, then lettered names by prefix', () => {
    expect(['M1', '100', '29', 'N100', '61', 'M2'].sort(compareShort)).toEqual([
      '29',
      '61',
      '100',
      'M1',
      'M2',
      'N100',
    ])
  })
})
