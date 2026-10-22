// @vitest-environment jsdom
import type { TrayItem } from '@bft/ui/onboarding'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PREFS_KEY, PREFS_VERSION } from '../app/lib/saved-prefs.ts'
import {
  inOverlayOrder,
  keepTrayOrder,
  OVERLAY_KEY,
  OVERLAY_VERSION,
  savedId,
  storeTray,
  trayOrder,
} from '../app/lib/saved-prefs-tray.ts'

const ferry: TrayItem = { mode: 'ferry', id: '317584', name: 'Bulimba', to: '317590' }
const central: TrayItem = { mode: 'train', id: 'central', name: 'Central' }
const roma: TrayItem = { mode: 'train', id: 'roma-street', name: 'Roma Street' }
const cultural: TrayItem = { mode: 'bus', id: '10802', name: 'Cultural Centre' }
const TRIP = 'train:roma-street>indooroopilly'

const stored = () => JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null')

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

it('reads and writes the overlay saved-prefs.ts keeps', () => {
  expect(OVERLAY_KEY).toBe(PREFS_KEY)
  expect(OVERLAY_VERSION).toBe(PREFS_VERSION)
})

describe('savedId', () => {
  it('matches the ids My Transit gives each mode (saved.ts readSavedItems)', () => {
    expect(savedId(ferry)).toBe('ferry:317584>317590')
    expect(savedId(central)).toBe('train:central>')
    expect(savedId(cultural)).toBe('bus:10802')
  })
})

describe('trayOrder', () => {
  const F = savedId(ferry)
  const C = savedId(central)
  const B = savedId(cultural)

  it('puts the tray items in the tray order, in the places tray items held', () => {
    expect(trayOrder([B, TRIP, F, C], [F, C, B], [C, B, F])).toEqual([C, TRIP, B, F])
  })

  it('keeps items the tray never had where they were', () => {
    expect(trayOrder([TRIP, F, 'bus:999', C], [F, C], [C, F])).toEqual([TRIP, C, 'bus:999', F])
  })

  it('adds new tray items after the rest, in tray order, and drops a place left by one taken out', () => {
    const R = savedId(roma)
    expect(trayOrder([F, TRIP, C, B], [F, C, B], [R, C, F])).toEqual([R, TRIP, C, F])
    expect(trayOrder([F, TRIP, C], [F, C], [C])).toEqual([C, TRIP])
  })

  it('places a tray item missing from the order (saved since) by the tray too', () => {
    expect(trayOrder([F, C], [F, C, B], [B, F, C])).toEqual([B, F, C])
  })
})

describe('inOverlayOrder', () => {
  const defaults = [ferry, central, roma, cultural]
  const overlay = (value: unknown) => localStorage.setItem(PREFS_KEY, JSON.stringify(value))

  it('puts the tray in the overlay order, skipping ids the tray does not have', () => {
    overlay({
      v: 1,
      order: [savedId(cultural), TRIP, savedId(roma), savedId(ferry), savedId(central)],
      labels: {},
    })
    expect(inOverlayOrder(defaults)).toEqual([cultural, roma, ferry, central])
  })

  it('puts items missing from the order after the rest, in the default order', () => {
    overlay({ v: 1, order: [savedId(cultural), TRIP, savedId(central)], labels: {} })
    expect(inOverlayOrder(defaults)).toEqual([cultural, central, ferry, roma])
  })

  it('keeps the default order with no overlay, another version, an empty order or junk', () => {
    expect(inOverlayOrder(defaults)).toEqual(defaults)
    overlay({ v: 2, order: [savedId(cultural)], labels: {} })
    expect(inOverlayOrder(defaults)).toEqual(defaults)
    overlay({ v: 1, order: [], labels: {} })
    expect(inOverlayOrder(defaults)).toEqual(defaults)
    overlay([savedId(cultural)])
    expect(inOverlayOrder(defaults)).toEqual(defaults)
    localStorage.setItem(PREFS_KEY, '{not json')
    expect(inOverlayOrder(defaults)).toEqual(defaults)
  })

  it('ignores ids that are not strings', () => {
    overlay({ v: 1, order: [7, null, savedId(roma)], labels: {} })
    expect(inOverlayOrder(defaults)).toEqual([roma, ferry, central, cultural])
  })

  it('keeps the default order when storage is blocked', () => {
    overlay({ v: 1, order: [savedId(cultural)], labels: {} })
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    expect(inOverlayOrder(defaults)).toEqual(defaults)
    get.mockRestore()
  })
})

describe('storeTray', () => {
  const stored = [ferry, central, roma, cultural]
  const opened = [cultural, roma, ferry, central]

  it('gives every mode its store order back when the tray is saved as it opened', () => {
    expect(storeTray(stored, opened, [...opened])).toEqual(stored)
  })

  it('gives a changed mode the tray order and leaves the others in store order', () => {
    expect(storeTray(stored, opened, [cultural, central, roma, ferry])).toEqual([
      ferry,
      central,
      roma,
      cultural,
    ])
    const other: TrayItem = { mode: 'bus', id: '1', name: 'Other' }
    expect(storeTray(stored, opened, [cultural, roma, ferry, central, other])).toEqual([
      ferry,
      central,
      roma,
      cultural,
      other,
    ])
  })

  it('counts a new ferry To or a stop taken out as a change', () => {
    const toElsewhere = { ...ferry, to: '317600' }
    expect(storeTray(stored, opened, [cultural, roma, toElsewhere, central])).toEqual([
      toElsewhere,
      central,
      roma,
      cultural,
    ])
    expect(storeTray(stored, opened, [cultural, ferry, central])).toEqual([ferry, central, cultural])
  })
})

describe('keepTrayOrder', () => {
  it('rewrites the overlay order to the tray order and keeps every name', () => {
    const labels = { [savedId(cultural)]: 'Work', [TRIP]: 'Uni', 'bus:gone': 'Old' }
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({ v: 1, order: [savedId(ferry), TRIP, savedId(central), savedId(cultural)], labels }),
    )
    keepTrayOrder([ferry, central, cultural], [cultural, central, ferry])
    expect(stored()).toEqual({
      v: 1,
      order: [savedId(cultural), TRIP, savedId(central), savedId(ferry)],
      labels,
    })
  })

  it('writes nothing with no overlay', () => {
    keepTrayOrder([ferry, central, cultural], [cultural, central, ferry])
    expect(localStorage.getItem(PREFS_KEY)).toBeNull()
  })

  it('leaves an overlay it cannot read (a newer version) as it is', () => {
    const future = JSON.stringify({ v: 9, order: [savedId(ferry), savedId(cultural)], labels: {} })
    localStorage.setItem(PREFS_KEY, future)
    keepTrayOrder([ferry, cultural], [cultural, ferry])
    expect(localStorage.getItem(PREFS_KEY)).toBe(future)
  })

  it('changes nothing when storage is blocked', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    expect(() => keepTrayOrder([ferry, cultural], [cultural, ferry])).not.toThrow()
    get.mockRestore()
  })

  it('writes nothing when the tray is saved as it opened, even with tray items missing from the order', () => {
    const same = JSON.stringify({ v: 1, order: [savedId(cultural), TRIP], labels: {} })
    localStorage.setItem(PREFS_KEY, same)
    const opened = inOverlayOrder([ferry, central, cultural])
    keepTrayOrder(opened, [...opened])
    expect(localStorage.getItem(PREFS_KEY)).toBe(same)
  })

  it('does not rewrite an overlay already in the tray order', () => {
    const same = JSON.stringify({ v: 1, order: [savedId(ferry), savedId(cultural)], labels: {} })
    localStorage.setItem(PREFS_KEY, same)
    keepTrayOrder([ferry, cultural], [ferry, cultural])
    expect(localStorage.getItem(PREFS_KEY)).toBe(same)
  })
})
