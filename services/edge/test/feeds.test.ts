import { describe, expect, it } from 'vitest'
import { feedsFor, parseRtModes } from '../src/rt/feeds.ts'

describe('RT_MODES / RT_INDEX_MODES', () => {
  it('per-mode by default, combined for all', () => {
    expect(parseRtModes(undefined)).toEqual({
      modes: ['ferry', 'train'],
      combined: false,
      indexModes: ['ferry', 'train'],
    })
    expect(feedsFor(parseRtModes('ferry')).map((f) => f.key)).toEqual([
      'TripUpdates/Ferry',
      'VehiclePositions/Ferry',
      'alerts',
    ])
    expect(feedsFor(parseRtModes('all')).map((f) => f.key)).toEqual([
      'TripUpdates',
      'VehiclePositions',
      'alerts',
    ])
  })

  it('never loads bus trip indexes unless asked (DO memory)', () => {
    expect(parseRtModes('all').indexModes).toEqual(['ferry', 'train', 'tram'])
    expect(parseRtModes('all', 'ferry,bus').indexModes).toEqual(['ferry', 'bus'])
    expect(parseRtModes('ferry', 'train').indexModes).toEqual([])
  })

  it('rejects an empty mode list', () => {
    expect(() => parseRtModes('boats')).toThrow()
  })
})
