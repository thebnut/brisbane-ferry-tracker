/**
 * The train journey planner (lib/journey.ts) and its landmark cards (PlannerSheets): From first then To, one change at
 * most, the nearest start once the position is known, the last destination kept on the device.
 */
import { type LANDMARKS, matchLandmarks } from '@bft/core/landmarks'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { landmarkResult } from '../app/components/PlannerSheets.tsx'
import {
  closestStations,
  isDirect,
  LAST_TO_KEY,
  nearestStart,
  POPULAR_TO,
  planTrip,
  readLastTo,
  writeLastTo,
} from '../app/lib/journey.ts'
import { isReachable, STATIONS, stationByKey } from '../app/lib/network.ts'

describe('planTrip', () => {
  it('a direct train', () => {
    expect(planTrip('central', 'roma-street')).toEqual({ kind: 'direct' })
    expect(isDirect('roma-street', 'milton')).toBe(isReachable('roma-street', 'milton'))
  })

  it('the same station', () => {
    expect(planTrip('central', 'central')).toEqual({ kind: 'same' })
  })

  it('agrees with the stopping patterns for every pair, and a change is two direct legs', () => {
    const keys = STATIONS.map((s) => s.key)
    let changes = 0
    for (const a of keys.filter((_, i) => i % 7 === 0))
      for (const b of keys.filter((_, i) => i % 5 === 0)) {
        if (a === b) continue
        expect(isDirect(a, b), `${a} → ${b}`).toBe(isReachable(a, b))
        const p = planTrip(a, b)
        if (p.kind === 'change') {
          changes++
          expect(isReachable(a, p.via.key) && isReachable(p.via.key, b), `${a} → ${p.via.key} → ${b}`).toBe(
            true,
          )
        }
      }
    expect(changes).toBeGreaterThan(0)
  })

  it('every popular destination is a station', () => {
    for (const k of POPULAR_TO) expect(stationByKey(k), k).not.toBeNull()
  })
})

describe('nearestStart', () => {
  const roma = stationByKey('roma-street')
  it('the nearest station, and with a destination the closest of three with a direct train there', () => {
    if (!roma) throw new Error('no Roma Street')
    expect(nearestStart(roma.lat, roma.lon, null)?.key).toBe('roma-street')
    expect(closestStations(roma.lat, roma.lon)[0]?.station.key).toBe('roma-street')
    const start = nearestStart(roma.lat, roma.lon, 'roma-street')
    expect(start?.key).not.toBe('roma-street')
  })
})

describe('the last destination', () => {
  const store = new Map<string, string>()
  beforeEach(() => {
    store.clear()
    globalThis.localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    } as Storage
  })
  afterEach(() => {
    // @ts-expect-error: the node environment has none.
    delete globalThis.localStorage
  })

  it('is kept on the device as a station key', () => {
    writeLastTo('central')
    expect(store.get(LAST_TO_KEY)).toBe('central')
    expect(readLastTo()?.name).toBe('Central')
    writeLastTo(null)
    expect(readLastTo()).toBeNull()
  })
})

describe('landmarks on the train', () => {
  const card = (q: string) => landmarkResult(matchLandmarks(q)[0] as (typeof LANDMARKS)[number])

  it('Suncorp Stadium: get off at Milton (or Roma Street)', () => {
    const r = card('suncorp')
    expect(r.pick).toBe('milton')
    expect(r.text).toMatch(/^Get off at Milton for Suncorp Stadium \(or Roma Street\)/)
  })

  it('the Gabba: Buranda (or Boggo Road)', () => {
    expect(card('gabba').pick).toBe('buranda')
  })

  it('South Bank Parklands: South Brisbane', () => {
    expect(card('brisbane sign').pick).toBe('south-brisbane')
  })

  it('Eat Street is not near a train: it says so and points to the ferry', () => {
    const r = card('eat street')
    expect(r.pick).toBeUndefined()
    expect(r.text).toBe('Not near a train station. Take the ferry to Northshore Hamilton.')
  })
})
