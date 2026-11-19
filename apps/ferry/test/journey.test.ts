/**
 * The ferry journey planner's logic (lib/journey.ts), the landmarks it searches (@bft/core/landmarks, as the ferry
 * sheet words them) and the change-at connection (ChangePlan): From first then To, one change at most for the
 * cross-river ferries, a closed terminal left out of Popular and of the nearest default, the last destination kept on
 * the device.
 */
import { readFileSync } from 'node:fs'
import type { Departure } from '@bft/core/contract'
import { LANDMARKS, matchLandmarks } from '@bft/core/landmarks'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { connection } from '../app/components/ChangePlan.tsx'
import { landmarkResult } from '../app/components/PlannerSheets.tsx'
import {
  closedNote,
  closestTerminals,
  isDirect,
  LAST_TO_KEY,
  nearestStart,
  planTrip,
  popularTerminals,
  readLastTo,
  writeLastTo,
} from '../app/lib/journey.ts'
import { TERMINALS, terminalBySlug } from '../app/lib/terminals.ts'

const id = (slug: string) => {
  const t = terminalBySlug(slug)
  if (!t) throw new Error(`no terminal ${slug}`)
  return t.id
}
/** 19 Nov 2026, noon AEST: Bulimba closed for works. */
const CLOSED_DAY = Date.UTC(2026, 10, 19, 2)
/** 20 Dec 2026: reopened. */
const OPEN_DAY = Date.UTC(2026, 11, 20, 2)

describe('planTrip', () => {
  it('a direct ferry', () => {
    expect(planTrip(id('new-farm-park'), id('howard-smith-wharves'), CLOSED_DAY)).toEqual({ kind: 'direct' })
    expect(isDirect(id('south-bank'), id('uq-st-lucia'))).toBe(true)
  })

  it('the cross-river ferries: one change, at the terminal both legs reach', () => {
    const dockside = planTrip(id('dockside'), id('howard-smith-wharves'), CLOSED_DAY)
    expect(dockside.kind === 'change' && dockside.via.slug).toBe('sydney-street')
    const holman = planTrip(id('holman-street'), id('south-bank'), CLOSED_DAY)
    expect(holman.kind === 'change' && holman.via.slug).toBe('riverside')
    const museum = planTrip(id('maritime-museum'), id('new-farm-park'), CLOSED_DAY)
    expect(museum.kind === 'change' && museum.via.slug).toBe('qut-gardens-point')
    // And the other way.
    const toHolman = planTrip(id('uq-st-lucia'), id('holman-street'), CLOSED_DAY)
    expect(toHolman.kind === 'change' && toHolman.via.slug).toBe('riverside')
  })

  it('two cross-river ferries apart: no one-change trip', () => {
    expect(planTrip(id('dockside'), id('holman-street'), CLOSED_DAY)).toEqual({ kind: 'none' })
  })

  it('the same terminal, or an unknown one', () => {
    expect(planTrip(id('riverside'), id('riverside'), CLOSED_DAY)).toEqual({ kind: 'same' })
    expect(planTrip('nope', id('riverside'), CLOSED_DAY)).toEqual({ kind: 'none' })
  })

  it('every pair of terminals is direct, one change, the same, or (only between cross-river ferries) none', () => {
    const cross = new Set(['dockside', 'holman-street', 'maritime-museum'])
    for (const a of TERMINALS)
      for (const b of TERMINALS) {
        const p = planTrip(a.id, b.id, OPEN_DAY)
        if (p.kind === 'none')
          expect(cross.has(a.slug) && cross.has(b.slug), `${a.slug} → ${b.slug}`).toBe(true)
        if (p.kind === 'change') {
          expect(isDirect(a.id, p.via.id)).toBe(true)
          expect(isDirect(p.via.id, b.id)).toBe(true)
        }
      }
  })
})

describe('a closed terminal (Bulimba, 9 Nov to mid-December 2026)', () => {
  it('has a note while closed, none after', () => {
    expect(closedNote(id('bulimba'), CLOSED_DAY)).toMatch(/closed for works/i)
    expect(closedNote(id('bulimba'), OPEN_DAY)).toBeNull()
    expect(closedNote(id('riverside'), CLOSED_DAY)).toBeNull()
  })

  it('is left out of Popular while closed', () => {
    expect(popularTerminals(CLOSED_DAY).map((t) => t.slug)).toEqual([
      'south-bank',
      'howard-smith-wharves',
      'northshore-hamilton',
      'new-farm-park',
      'uq-st-lucia',
    ])
    expect(popularTerminals(OPEN_DAY).map((t) => t.slug)).toContain('bulimba')
  })

  it('is never the nearest start while closed', () => {
    const bulimba = terminalBySlug('bulimba')
    if (!bulimba) throw new Error('no Bulimba')
    expect(nearestStart(bulimba.lat, bulimba.lng, null, CLOSED_DAY)?.slug).not.toBe('bulimba')
    expect(closestTerminals(bulimba.lat, bulimba.lng, CLOSED_DAY).map((c) => c.terminal.slug)).not.toContain(
      'bulimba',
    )
    expect(nearestStart(bulimba.lat, bulimba.lng, null, OPEN_DAY)?.slug).toBe('bulimba')
  })
})

describe('nearestStart', () => {
  // Streets Beach, South Bank Parklands.
  const HERE = { lat: -27.4776, lon: 153.0228 }
  it('the nearest open terminal', () => {
    expect(nearestStart(HERE.lat, HERE.lon, null, CLOSED_DAY)?.slug).toBe('south-bank')
  })
  it('with a destination: the closest of the three with a direct ferry there, never the destination itself', () => {
    expect(nearestStart(HERE.lat, HERE.lon, id('south-bank'), CLOSED_DAY)?.slug).not.toBe('south-bank')
    // Near Kangaroo Point's cross-river stop, for Riverside: Holman Street runs straight there.
    const holman = terminalBySlug('holman-street')
    if (!holman) throw new Error('no Holman Street')
    const start = nearestStart(holman.lat, holman.lng, id('new-farm-park'), CLOSED_DAY)
    expect(start && isDirect(start.id, id('new-farm-park'))).toBe(true)
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

  it('is kept on the device as a slug, and read back as its terminal', () => {
    expect(readLastTo()).toBeNull()
    writeLastTo('howard-smith-wharves')
    expect(store.get(LAST_TO_KEY)).toBe('howard-smith-wharves')
    expect(readLastTo()?.name).toBe('Howard Smith Wharves')
    writeLastTo(null)
    expect(readLastTo()).toBeNull()
  })

  it('an unknown slug reads as none; storage that throws is ignored', () => {
    store.set(LAST_TO_KEY, 'atlantis')
    expect(readLastTo()).toBeNull()
    globalThis.localStorage.getItem = () => {
      throw new Error('denied')
    }
    expect(readLastTo()).toBeNull()
  })
})

describe('landmarks', () => {
  const stations = new Set(
    (
      JSON.parse(readFileSync(new URL('../../train/app/data/network.json', import.meta.url), 'utf8')) as {
        stations: Array<{ k: string; n: string }>
      }
    ).stations.map((s) => `${s.k}:${s.n}`),
  )

  it('every ferry terminal and train station named is a real one', () => {
    for (const l of LANDMARKS) {
      for (const slug of l.ferry) expect(terminalBySlug(slug), `${l.id}: ${slug}`).not.toBeNull()
      for (const s of l.train) expect(stations.has(`${s.key}:${s.name}`), `${l.id}: ${s.key}`).toBe(true)
    }
  })

  it.each([
    ['eat street', 'Get off at Northshore Hamilton for Eat Street', 'northshore-hamilton'],
    ['felons', 'Get off at Howard Smith Wharves for Felons Brewing', 'howard-smith-wharves'],
    ['botanic', 'Get off at QUT Gardens Point for the City Botanic Gardens', 'qut-gardens-point'],
    ['brisbane sign', 'Get off at South Bank for South Bank Parklands', 'south-bank'],
    ['powerhouse', 'Get off at New Farm Park for New Farm Park and the Powerhouse', 'new-farm-park'],
    [
      'story bridge',
      'Get off at Howard Smith Wharves for the Story Bridge (or Holman Street)',
      'howard-smith-wharves',
    ],
    ['UQ', 'Get off at UQ St Lucia for UQ', 'uq-st-lucia'],
  ])('"%s" resolves to the terminal to get off at', (query, text, slug) => {
    const r = landmarkResult(matchLandmarks(query)[0] as (typeof LANDMARKS)[number])
    expect(r.text.startsWith(text)).toBe(true)
    expect(r.pick).toBe(id(slug))
  })

  it('Suncorp Stadium and the Gabba are not ferry stops: they say so and point to the train (and bus)', () => {
    const suncorp = landmarkResult(matchLandmarks('suncorp')[0] as (typeof LANDMARKS)[number])
    expect(suncorp.pick).toBeUndefined()
    expect(suncorp.text).toMatch(/^Not near a ferry terminal\. Take the train to Milton or Roma Street/)
    const gabba = landmarkResult(matchLandmarks('gabba')[0] as (typeof LANDMARKS)[number])
    expect(gabba.pick).toBeUndefined()
    expect(gabba.text).toMatch(/Woolloongabba busway station/)
    expect(gabba.text).toMatch(/train to Buranda or Boggo Road/)
  })

  it('nothing for a blank query; every word must match', () => {
    expect(matchLandmarks('  ')).toEqual([])
    expect(matchLandmarks('eat zoo')).toEqual([])
  })
})

describe('the change-at connection', () => {
  const d = (dep: number, arr: number | null, extra: Partial<Departure> = {}) =>
    ({
      tripInstance: `t${dep}`,
      status: 'scheduled',
      schedDep: dep,
      estDep: null,
      schedArrTo: arr,
      estArrTo: null,
      route: { short: 'F1' },
      headsign: 'UQ St Lucia',
      ...extra,
    }) as unknown as Departure

  it('the second leg leaves at least two minutes after the first arrives', () => {
    const c = connection([d(1000, 1300)], [d(1350, 1700), d(1420, 1800)])
    expect(c?.a.schedDep).toBe(1000)
    expect(c?.arr).toBe(1300)
    expect(c?.b?.schedDep).toBe(1420)
    expect(c?.arrB).toBe(1800)
  })

  it('a cancelled first ferry is skipped; live estimates count', () => {
    const c = connection(
      [
        d(900, 1200, { status: 'cancelled' }),
        d(1000, 1300, { estDep: 1060, estArrTo: 1360, status: 'live' }),
      ],
      [d(1420, 1800), d(1500, 1900)],
    )
    expect(c?.a.schedDep).toBe(1000)
    expect(c?.arr).toBe(1360)
    expect(c?.b?.schedDep).toBe(1500)
  })

  it('no second leg after the first: the first leg only; no first leg: nothing', () => {
    expect(connection([d(1000, 1300)], [d(1200, 1500)])?.b).toBeNull()
    expect(connection([], [d(1200, 1500)])).toBeNull()
  })
})
