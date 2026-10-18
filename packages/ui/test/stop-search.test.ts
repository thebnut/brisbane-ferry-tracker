import { describe, expect, it } from 'vitest'
import { matchStops } from '../src/StopSearch.tsx'

const stops = [
  { id: '1', name: 'Northshore Hamilton' },
  { id: '2', name: 'QUT Gardens Point' },
  { id: '3', name: 'UQ St Lucia' },
  { id: '4', name: 'Bulimba', detail: 'Stop 317584' },
]

describe('matchStops', () => {
  it('matches word prefixes in any order', () => {
    expect(matchStops('ham', stops).map((s) => s.id)).toEqual(['1'])
    expect(matchStops('point gard', stops).map((s) => s.id)).toEqual(['2'])
    expect(matchStops('st lu', stops).map((s) => s.id)).toEqual(['3'])
  })
  it('matches stop numbers in the detail and returns all for an empty query', () => {
    expect(matchStops('3175', stops).map((s) => s.id)).toEqual(['4'])
    expect(matchStops('  ', stops)).toHaveLength(4)
  })
  it('does not match the middle of a word', () => {
    expect(matchStops('ilton', stops)).toHaveLength(0)
  })
})
