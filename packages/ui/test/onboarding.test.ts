/** P4 onboarding's rules and tray (onboarding.ts). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyTray,
  emptyTray,
  HANDOFF_LEDGER_KEY,
  markOnboardingDone,
  modeChanged,
  ONBOARDING_KEY,
  onboardingDone,
  shouldOffer,
  type TrayItem,
  type TrayState,
  trayReducer,
  trayRerunSavable,
  traySavable,
  whenIdle,
} from '../src/onboarding.ts'

const bus = (id: string): TrayItem => ({ mode: 'bus', id, name: `Stop ${id}` })
const train = (id: string): TrayItem => ({ mode: 'train', id, name: id })
const ferry = (id: string): TrayItem => ({ mode: 'ferry', id, name: id })
const run = (...actions: Parameters<typeof trayReducer>[1][]) =>
  actions.reduce<TrayState>((s, a) => trayReducer(s, a), emptyTray())
const keys = (s: TrayState) => s.items.map((i) => `${i.mode}:${i.id}`)

describe('show once', () => {
  beforeEach(() => {
    localStorage.clear()
    history.replaceState(null, '', '/')
    document.body.innerHTML = ''
  })

  it('offers on a first visit with nothing saved', () => {
    expect(shouldOffer({ anySaved: false })).toBe(true)
    // Offering writes nothing: the prompt may still not show (the visitor leaves first).
    expect(localStorage.getItem(ONBOARDING_KEY)).toBeNull()
  })

  it('never after an answer ("Not now" or a save)', () => {
    markOnboardingDone()
    expect(onboardingDone()).toBe(true)
    expect(shouldOffer({ anySaved: false })).toBe(false)
  })

  it('not when something is saved, and that settles it for good', () => {
    expect(shouldOffer({ anySaved: true })).toBe(false)
    expect(onboardingDone()).toBe(true)
    expect(shouldOffer({ anySaved: false })).toBe(false)
  })

  it('not for a device the app onboarded before (ferry: its stop selector has opened)', () => {
    expect(shouldOffer({ anySaved: false, seenBefore: true })).toBe(false)
    expect(onboardingDone()).toBe(true)
  })

  it('not after a handoff import (its ledger), for good', () => {
    localStorage.setItem(HANDOFF_LEDGER_KEY, '["bus:10802"]')
    expect(shouldOffer({ anySaved: false })).toBe(false)
    expect(onboardingDone()).toBe(true)
  })

  it('not while a handoff arrives or its notice is on screen, but later it may', () => {
    history.replaceState(null, '', '/#import=abc')
    expect(shouldOffer({ anySaved: false })).toBe(false)
    history.replaceState(null, '', '/')
    const notice = document.createElement('div')
    notice.dataset.handoffNotice = ''
    document.body.appendChild(notice)
    expect(shouldOffer({ anySaved: false })).toBe(false)
    expect(onboardingDone()).toBe(false)
    notice.remove()
    expect(shouldOffer({ anySaved: false })).toBe(true)
  })

  it('blocked storage counts as answered: never nags', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    expect(onboardingDone()).toBe(true)
    expect(shouldOffer({ anySaved: false })).toBe(false)
    expect(() => markOnboardingDone()).not.toThrow()
    get.mockRestore()
    set.mockRestore()
  })
})

describe('whenIdle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    document.body.innerHTML = '<input id="q" /><div id="sheet"></div>'
  })
  afterEach(() => vi.useRealTimers())

  it('runs after a quiet spell', () => {
    const fn = vi.fn()
    whenIdle(fn, 2000)
    vi.advanceTimersByTime(1999)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fn).toHaveBeenCalledOnce()
  })

  it('waits while the visitor taps or types, and while a field has focus', () => {
    const fn = vi.fn()
    whenIdle(fn, 2000)
    vi.advanceTimersByTime(1500)
    dispatchEvent(new Event('pointerdown'))
    vi.advanceTimersByTime(1500)
    expect(fn).not.toHaveBeenCalled()
    ;(document.getElementById('q') as HTMLInputElement).focus()
    vi.advanceTimersByTime(10_000)
    expect(fn).not.toHaveBeenCalled()
    ;(document.getElementById('q') as HTMLInputElement).blur()
    vi.advanceTimersByTime(600)
    expect(fn).toHaveBeenCalledOnce()
  })

  it('waits while a modal is open, and can be cancelled', () => {
    const fn = vi.fn()
    const sheet = document.getElementById('sheet') as HTMLElement
    sheet.setAttribute('aria-modal', 'true')
    const cancel = whenIdle(fn, 2000)
    vi.advanceTimersByTime(5000)
    expect(fn).not.toHaveBeenCalled()
    cancel()
    sheet.removeAttribute('aria-modal')
    vi.advanceTimersByTime(5000)
    expect(fn).not.toHaveBeenCalled()
  })
})

describe('tray (multi-select)', () => {
  it('a tap adds, a second tap removes, without duplicates', () => {
    const s = run({ type: 'toggle', item: bus('1') }, { type: 'toggle', item: bus('2') })
    expect(keys(s)).toEqual(['bus:1', 'bus:2'])
    expect(s.said).toBe('Added Stop 2')
    const t = trayReducer(s, { type: 'toggle', item: bus('1') })
    expect(keys(t)).toEqual(['bus:2'])
    expect(t.said).toBe('Removed Stop 1')
  })

  it('the same id in two modes is two items', () => {
    expect(keys(run({ type: 'toggle', item: bus('x') }, { type: 'toggle', item: train('x') }))).toEqual([
      'bus:x',
      'train:x',
    ])
  })

  it('remove and reorder (no moves past either end)', () => {
    let s = run(
      { type: 'toggle', item: bus('1') },
      { type: 'toggle', item: bus('2') },
      { type: 'toggle', item: bus('3') },
    )
    s = trayReducer(s, { type: 'move', key: 'bus:3', by: -1 })
    expect(keys(s)).toEqual(['bus:1', 'bus:3', 'bus:2'])
    expect(trayReducer(s, { type: 'move', key: 'bus:1', by: -1 })).toBe(s)
    expect(trayReducer(s, { type: 'move', key: 'bus:2', by: 1 })).toBe(s)
    s = trayReducer(s, { type: 'remove', key: 'bus:3' })
    expect(keys(s)).toEqual(['bus:1', 'bus:2'])
    expect(trayReducer(s, { type: 'remove', key: 'bus:9' })).toBe(s)
  })

  it('train stops at its store limit (8 favourites)', () => {
    let s = emptyTray()
    for (let i = 0; i < 9; i++) s = trayReducer(s, { type: 'toggle', item: train(`s${i}`) })
    expect(s.items).toHaveLength(8)
    expect(s.said).toMatch(/up to 8 train/)
  })

  it('ferry: one pair; a new From replaces the old and clears its destination', () => {
    let s = run({ type: 'toggle', item: ferry('bulimba') })
    expect(s.said).toMatch(/choose where you're going/)
    expect(traySavable(s)).toBe(false)
    s = trayReducer(s, { type: 'setTo', key: 'ferry:bulimba', to: 'riverside', toName: 'Riverside' })
    expect(s.items[0]?.to).toBe('riverside')
    expect(traySavable(s)).toBe(true)
    s = trayReducer(s, { type: 'toggle', item: ferry('hawthorne') })
    expect(s.items).toEqual([{ mode: 'ferry', id: 'hawthorne', name: 'hawthorne', to: null }])
    expect(traySavable(s)).toBe(false)
  })

  it('setTo only applies to a ferry item; an empty tray is not savable', () => {
    const s = run({ type: 'toggle', item: bus('1') })
    expect(trayReducer(s, { type: 'setTo', key: 'bus:1', to: 'x' })).toBe(s)
    expect(traySavable(emptyTray())).toBe(false)
    expect(traySavable(s)).toBe(true)
  })
})

describe('re-run from Settings (THE-113)', () => {
  it('a mode changed when its stops, their order or the ferry To differ; other modes are not looked at', () => {
    const before = [bus('1'), train('central'), bus('2'), { ...ferry('bulimba'), to: 'riverside' }]
    expect(modeChanged(before, [...before], 'bus')).toBe(false)
    expect(modeChanged(before, [bus('2'), train('central'), bus('1')], 'bus')).toBe(true)
    expect(modeChanged(before, [bus('1'), bus('2')], 'bus')).toBe(false)
    expect(modeChanged(before, [bus('1'), bus('2')], 'train')).toBe(true)
    expect(modeChanged(before, [{ ...ferry('bulimba'), to: 'hawthorne' }], 'ferry')).toBe(true)
    expect(modeChanged(before, [{ ...ferry('bulimba'), to: 'riverside' }], 'ferry')).toBe(false)
  })

  type Fav = { from: string; to: string | null; extra?: string }
  const stationId = (f: Fav) => (f.to == null ? f.from : null)
  const make = (i: TrayItem): Fav => ({ from: i.id, to: null })

  it('an unchanged tray gives the list back as it was, kept entries as they are', () => {
    const list: Fav[] = [
      { from: 'a', to: null, extra: 'x' },
      { from: 'a', to: 'b' },
      { from: 'c', to: null },
    ]
    const out = applyTray(list, stationId, [train('a'), train('c')], make)
    expect(out).toEqual(list)
    expect(out[0]).toBe(list[0])
  })

  it('removes, adds at the end and reorders; entries the tray does not show keep their place', () => {
    const list: Fav[] = [
      { from: 'a', to: null },
      { from: 'a', to: 'b' },
      { from: 'c', to: null },
    ]
    expect(applyTray(list, stationId, [train('c'), train('d')], make)).toEqual([
      { from: 'c', to: null },
      { from: 'a', to: 'b' },
      { from: 'd', to: null },
    ])
    expect(applyTray(list, stationId, [train('c'), train('a')], make)).toEqual([
      { from: 'c', to: null },
      { from: 'a', to: 'b' },
      { from: 'a', to: null },
    ])
    expect(applyTray(list, stationId, [], make)).toEqual([{ from: 'a', to: 'b' }])
    expect(applyTray([], stationId, [train('a')], make)).toEqual([{ from: 'a', to: null }])
  })

  it('a re-run may save an empty tray (unsaving everything) only if it opened with stops; the ferry needs its To', () => {
    expect(trayRerunSavable(emptyTray(), [])).toBe(false)
    expect(trayRerunSavable(emptyTray(), [bus('1')])).toBe(true)
    expect(trayRerunSavable({ items: [bus('1')], said: '' }, [])).toBe(true)
    expect(trayRerunSavable({ items: [ferry('bulimba')], said: '' }, [bus('1')])).toBe(false)
    expect(trayRerunSavable({ items: [{ ...ferry('bulimba'), to: 'riverside' }], said: '' }, [])).toBe(true)
  })
})
