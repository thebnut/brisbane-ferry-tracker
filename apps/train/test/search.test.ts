import { describe, expect, it } from 'vitest'
import { STATIONS } from '../app/lib/network.ts'
import { searchStations } from '../app/lib/search.ts'

const names = (q: string) => searchStations(q, STATIONS).map((s) => s.name)

describe('station search (uFuzzy)', () => {
  it('tolerates a typo per word', () => {
    expect(names('bowen hils')[0]).toBe('Bowen Hills')
    expect(names('indooroopily')[0]).toBe('Indooroopilly')
  })
  it('puts names that start with the query first', () => {
    expect(names('cen')[0]).toBe('Central')
    expect(names('cen')).toContain('Springfield Central')
  })
  it('empty query lists stations; nonsense finds nothing', () => {
    expect(names('')).toHaveLength(12)
    expect(names('zzzzqq')).toEqual([])
  })
})
