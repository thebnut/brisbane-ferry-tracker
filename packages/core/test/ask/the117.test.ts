/**
 * THE-117: connector verbs between the stops ("from bulimba going to riverside"), the trailing-word retry for an
 * explicit stop, and "the city" as a destination or origin.
 */
import { describe, expect, it } from 'vitest'
import { CITY_STOPS } from '../../src/ask/city.ts'
import { type ParseResult, parseQuestion, type StopResolver } from '../../src/ask/parser.ts'
import { testResolver } from './resolver.ts'

const BULIMBA = '317584'
const RIVERSIDE = '317590'
const KRUPP = '2869'

/** The stops of a next_departure, or the failure, for a compact assertion. */
const pair = (r: ParseResult) =>
  r.ok
    ? r.intent.kind === 'next_departure'
      ? [r.intent.from.key, r.intent.to.key]
      : r.intent
    : [r.reason, r.detail]

/** The stop and city direction of a departures_at, or the failure. */
const at = (r: ParseResult) =>
  r.ok
    ? r.intent.kind === 'departures_at'
      ? [r.intent.mode, r.intent.at.key, r.intent.city]
      : r.intent
    : [r.reason, r.detail, r.city?.why]

describe('connector verbs between the stops', () => {
  it.each([
    'Next ferry from bulimba going to riverside?',
    'next ferry from bulimba going to riverside',
    'bulimba heading to riverside',
    'next ferry leaving bulimba for riverside',
    'next ferry departing bulimba for riverside',
    'from bulimba travelling to riverside',
    'from bulimba traveling to riverside',
    'getting from bulimba to riverside',
    'next citycat from bulimba heading towards riverside',
    'ferry from bulimba headed for riverside',
    'bulimba bound for riverside next ferry',
    'leaving bulimba to riverside',
  ])('%s → Bulimba to Riverside', (q) => {
    expect(pair(parseQuestion(q, testResolver))).toEqual([BULIMBA, RIVERSIDE])
  })

  it('an unknown stop stays unresolved, named as asked', () => {
    expect(pair(parseQuestion('next ferry from zzyzx going to riverside', testResolver))).toEqual([
      'unresolved_stop',
      'zzyzx',
    ])
    expect(pair(parseQuestion('next ferry leaving zzyzx for riverside', testResolver))).toEqual([
      'unresolved_stop',
      'zzyzx',
    ])
    expect(pair(parseQuestion('next ferry from bulimba heading to nowhereville', testResolver))).toEqual([
      'unresolved_stop',
      'nowhereville',
    ])
  })

  it('an ambiguous stop stays ambiguous', () => {
    const r = parseQuestion('from toowong going to bowen hills', testResolver)
    expect(r.ok ? r.intent : r.reason).toBe('ambiguous_stop')
  })

  it('a stop named "... for ..." is not split at "for"', () => {
    const lake: StopResolver = (text, mode) =>
      text === 'lake sherrin homes for aged'
        ? [{ mode: 'bus', key: '7001', name: 'Lake Sherrin Homes for Aged', score: 1 }]
        : testResolver(text, mode)
    expect(at(parseQuestion('next bus leaving lake sherrin homes for aged', lake))).toEqual([
      'bus',
      '7001',
      undefined,
    ])
  })

  it('"for" before a route is not read as a destination stop', () => {
    const r = parseQuestion('next bus leaving cultural centre for the 199', testResolver)
    expect(r.ok && r.intent.kind === 'departures_at' && [r.intent.at.key, r.intent.route]).toEqual([
      '10802',
      '199',
    ])
  })

  it('"for" alone keeps its old reading ("timetable for south bank ferry")', () => {
    expect(at(parseQuestion('timetable for south bank ferry', testResolver))).toEqual([
      'ferry',
      '321666',
      undefined,
    ])
  })
})

describe('trailing-word retry for an explicit stop', () => {
  it('drops a trailing word that is not part of any stop name', () => {
    expect(pair(parseQuestion('next ferry from bulimba jetty to riverside', testResolver))).toEqual([
      BULIMBA,
      RIVERSIDE,
    ])
    expect(at(parseQuestion('departures at bulimba wharf area', testResolver))).toEqual([
      'ferry',
      BULIMBA,
      undefined,
    ])
  })

  it('never drops a word that tells places apart', () => {
    expect(pair(parseQuestion('next ferry from bulimba north to riverside', testResolver))).toEqual([
      'unresolved_stop',
      'bulimba north',
    ])
  })

  it('never cuts "X to Y" down to X', () => {
    expect(pair(parseQuestion('next ferry from bulimba to nowhereville', testResolver))).toEqual([
      'unresolved_stop',
      'nowhereville',
    ])
    expect(pair(parseQuestion('next ferry to zzyzx from bulimba', testResolver))).toEqual([
      'unresolved_stop',
      'zzyzx',
    ])
  })

  it('a retry that is not confident (below 0.9) stays unresolved', () => {
    const fuzzy: StopResolver = (text) =>
      text === 'bulimba' ? [{ mode: 'ferry', key: BULIMBA, name: 'Bulimba', score: 0.7 }] : []
    expect(pair(parseQuestion('next ferry from bulimba jetty to riverside', fuzzy))).toEqual([
      'unresolved_stop',
      'bulimba jetty',
    ])
  })

  it('a retry that fits several places asks, never guesses', () => {
    const r = parseQuestion('departures at toowong jetty', testResolver)
    expect(r.ok ? r.intent : r.reason).toBe('ambiguous_stop')
  })
})

describe('towards the city (stopping pattern, CITY_STOPS)', () => {
  it.each([
    ['next bus from krupp road towards the city', 'bus', KRUPP, 'in'],
    ['next bus from Krupp Road towards the CBD', 'bus', KRUPP, 'in'],
    ['train from bowen hills into the cbd', 'train', 'bowen-hills', 'in'],
    ['ferry from bulimba to the city', 'ferry', BULIMBA, 'in'],
    ['next ferry from bulimba into town', 'ferry', BULIMBA, 'in'],
    ['next train from bowen hills to the city centre', 'train', 'bowen-hills', 'in'],
    ['next ferry from bulimba going to the city', 'ferry', BULIMBA, 'in'],
    ['next inbound bus from krupp road', 'bus', KRUPP, 'in'],
    ['next bus towards the city from krupp road', 'bus', KRUPP, 'in'],
    ['krupp road to the city next bus', 'bus', KRUPP, 'in'],
    ['next bus from krupp road out of the city', 'bus', KRUPP, 'out'],
    ['outbound train from bowen hills', 'train', 'bowen-hills', 'out'],
    ['next ferry from bulimba away from the city', 'ferry', BULIMBA, 'out'],
  ])('%s', (q, mode, key, dir) => {
    expect(at(parseQuestion(q, testResolver))).toEqual([mode, key, dir])
  })

  it('from the city to a stop: the city stops of that mode are the origin', () => {
    for (const q of [
      'next ferry from the city to bulimba',
      'next ferry to bulimba from the city',
      'next ferry departing the city for bulimba',
      'next ferry leaving the cbd for bulimba',
    ]) {
      const r = parseQuestion(q, testResolver)
      expect(
        r.ok &&
          r.intent.kind === 'next_departure' && [r.intent.from.stopKeys, r.intent.to.key, r.intent.city],
        q,
      ).toEqual([[...CITY_STOPS.ferry], BULIMBA, 'out'])
    }
    const t = parseQuestion('next train from the cbd to bowen hills', testResolver)
    expect(t.ok && t.intent.kind === 'next_departure' && t.intent.from.stopKeys).toEqual([
      ...CITY_STOPS.train,
    ])
  })

  it('from the city by bus: too many city stops, said plainly', () => {
    expect(at(parseQuestion('next bus from the city to krupp road', testResolver))).toEqual([
      'city_question',
      undefined,
      'too_many_stops',
    ])
  })

  it('an origin inside the city is said, not guessed', () => {
    expect(at(parseQuestion('next ferry from riverside to the city', testResolver))).toEqual([
      'city_question',
      'Riverside',
      'origin_in_city',
    ])
    expect(at(parseQuestion('next train from central into the cbd', testResolver))).toEqual([
      'city_question',
      'Central',
      'origin_in_city',
    ])
    expect(at(parseQuestion('outbound bus from king george square', testResolver))).toEqual([
      'city_question',
      'King George Square',
      'origin_in_city',
    ])
  })

  it('an unknown origin stays unresolved', () => {
    expect(at(parseQuestion('next bus from zzyzx towards the city', testResolver))).toEqual([
      'unresolved_stop',
      'zzyzx',
      undefined,
    ])
  })

  it('"city" is never a fuzzy stop match, and city-named stops stay stops', () => {
    const named: StopResolver = (text, mode) =>
      text === 'city hall' || text === 'town centre'
        ? [{ mode: 'bus', key: text === 'city hall' ? '18' : '9001', name: text, score: 1 }]
        : text.includes('city') || text === 'town'
          ? [{ mode: 'bus', key: 'NERANG', name: 'City of Gold Coast, Nerang', score: 0.9 }]
          : testResolver(text, mode)
    expect(pair(parseQuestion('next bus from krupp road to city hall', named))).toEqual([KRUPP, '18'])
    expect(pair(parseQuestion('next bus from krupp road to town centre', named))).toEqual([KRUPP, '9001'])
    const r = parseQuestion('departures at the city', named)
    expect(r.ok).toBe(false)
  })
})
