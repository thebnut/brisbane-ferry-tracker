/**
 * searchStops' no-space fallback ("southbank" → South Bank): uFuzzy can't bridge a missing space, so when it finds
 * nothing the resolver compares names with spaces and punctuation removed (exact 1, starts-with 0.9).
 */
import { type Mode, parseQuestion, type StopIndexEntry } from '@bft/core'
import { describe, expect, it } from 'vitest'
import { buildIndex, resolverFor, searchStops } from '../src/ai/resolver.ts'

const stop = (key: string, name: string): StopIndexEntry => ({ key, name, lat: -27.4, lon: 153, routes: [] })

// Real names from the SEQ feed (17 Oct 2026); that feed has no stop named Kangaroo Point, so it is synthetic here.
const STOPS: Record<Mode, StopIndexEntry[]> = {
  ferry: [
    stop('317584', 'Bulimba ferry terminal'),
    stop('321666', 'South Bank ferry terminal'),
    stop('317588', 'New Farm Park ferry terminal'),
    stop('317580', 'Holman Street ferry terminal'),
    stop('KP-F', 'Kangaroo Point ferry terminal'),
  ],
  train: [
    stop('place_sbasta', 'South Bank station'),
    stop('place_bowsta', 'Bowen Hills station'),
    stop('place_censta', 'Central station'),
  ],
  bus: [
    stop('place_sbank', 'South Bank busway station'),
    stop('KP-B', 'Kangaroo Point'),
    stop('5010', 'Brunswick St at New Farm Junction'),
  ],
  tram: [],
}
const indexes = (['ferry', 'train', 'bus'] as const).map((m) => buildIndex(m, STOPS[m]))
const resolver = resolverFor(indexes)

describe('searchStops no-space fallback', () => {
  it.each([
    ['southbank', 'ferry', '321666', 1],
    ['southbank', 'train', 'place_sbasta', 1],
    ['southbank', 'bus', 'place_sbank', 1],
    ['newfarm', 'ferry', '317588', 0.9],
    ['kangaroopoint', 'ferry', 'KP-F', 1],
    ['kangaroopoint', 'bus', 'KP-B', 1],
  ] as const)('%s (%s) → %s scoring %d', (q, mode, key, score) => {
    const [best, second] = searchStops(indexes, q, mode)
    expect(best).toMatchObject({ mode, key, score })
    expect(second).toBeUndefined()
  })

  it('keeps the bus demotion for starts-with hits when no mode is given', () => {
    const r = searchStops(indexes, 'kangaroopoi')
    expect(r.map((c) => [c.key, c.score])).toEqual([
      ['KP-F', 0.9],
      ['KP-B', 0.8],
    ])
  })

  it('a name only in the middle of a stop name does not match (no false positives)', () => {
    // "Brunswick St at New Farm Junction" contains "newfarm" but doesn't start with it.
    expect(searchStops(indexes, 'newfarm', 'bus')).toEqual([])
    expect(searchStops(indexes, 'zzyzxroad')).toEqual([])
  })

  it('short terms never use the fallback', () => {
    expect(searchStops(indexes, 'sbk', 'ferry')).toEqual([])
  })

  it('does not fire when uFuzzy already matched', () => {
    const idx = [
      buildIndex('ferry', [stop('A', 'Southbankia ferry terminal'), stop('B', 'South Bank ferry terminal')]),
    ]
    // uFuzzy finds "southbankia" (prefix); the fallback would have added South Bank as an exact match.
    expect(searchStops(idx, 'southbank').map((c) => [c.key, c.score])).toEqual([['A', 0.9]])
    // And with the space, uFuzzy's own ranking is unchanged.
    expect(searchStops(idx, 'south bank')[0]).toMatchObject({ key: 'B', score: 1 })
  })
})

describe('the parser resolves no-space stop names', () => {
  it.each([
    ['next ferry from southbank to bulimba', 'ferry', '321666', '317584'],
    ['next ferry from bulimba to southbank', 'ferry', '317584', '321666'],
    ['next ferry from newfarm to bulimba', 'ferry', '317588', '317584'],
    ['next ferry from bulimba to newfarm', 'ferry', '317584', '317588'],
    ['next ferry from kangaroopoint to bulimba', 'ferry', 'KP-F', '317584'],
    ['next ferry from bulimba to kangaroopoint', 'ferry', '317584', 'KP-F'],
    ['next train from southbank to bowen hills', 'train', 'place_sbasta', 'place_bowsta'],
    ['next train from central to southbank', 'train', 'place_censta', 'place_sbasta'],
  ])('%s', (q, mode, from, to) => {
    const r = parseQuestion(q, resolver)
    expect(
      r.ok && r.intent.kind === 'next_departure' && [r.intent.mode, r.intent.from.key, r.intent.to.key],
    ).toEqual([mode, from, to])
  })

  it('departures at a no-space stop, by bus', () => {
    const r = parseQuestion('bus departures at kangaroopoint', resolver)
    expect(r.ok && r.intent.kind === 'departures_at' && r.intent.at.key).toBe('KP-B')
  })

  it('with no mode, the same name in several modes stays ambiguous (as "south bank" is today)', () => {
    expect(parseQuestion('departures at southbank', resolver)).toMatchObject({
      ok: false,
      reason: 'ambiguous_stop',
    })
    expect(parseQuestion('departures at south bank', resolver)).toMatchObject({
      ok: false,
      reason: 'ambiguous_stop',
    })
  })
})
