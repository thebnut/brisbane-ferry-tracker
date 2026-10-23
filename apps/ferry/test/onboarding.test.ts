// @vitest-environment jsdom
/** P4: ferry onboarding saves the pair through savePair (formats unchanged) and replaces the first-visit selector. */
import type { TrayItem } from '@bft/ui/onboarding'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ferryAnswered,
  ferryHasSaved,
  ferrySeenBefore,
  ferrySource,
  ferryTrayItems,
  resaveFerry,
  saveFerry,
} from '../app/lib/onboarding.ts'
import { PAIR_COOKIE, readSavedPair, STORAGE_KEYS, shouldShowSelector } from '../app/lib/storage.ts'
import { BULIMBA, RIVERSIDE, terminalById, validDestinations } from '../app/lib/terminals.ts'

const trip = (from: string, to: string | null): TrayItem => ({ mode: 'ferry', id: from, name: from, to })

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  // biome-ignore lint/suspicious/noDocumentCookie: clearing jsdom's cookies between tests.
  for (const c of document.cookie.split('; ')) document.cookie = `${c.split('=')[0]}=; max-age=0; path=/`
  vi.restoreAllMocks()
})

describe('ferry onboarding', () => {
  it('saves the tray trip as the remembered pair, in the selector’s format, cookie included', () => {
    expect(ferryHasSaved()).toBe(false)
    expect(saveFerry([{ mode: 'bus', id: '1', name: 'x' }, trip(BULIMBA, RIVERSIDE)])).toBe(true)
    const b = terminalById(BULIMBA)
    const r = terminalById(RIVERSIDE)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.SELECTED_STOPS) ?? 'null')).toEqual({
      outbound: { id: BULIMBA, name: b?.name },
      inbound: { id: RIVERSIDE, name: r?.name },
    })
    expect(localStorage.getItem(STORAGE_KEYS.REMEMBER_SELECTION)).toBe('true')
    expect(document.cookie).toContain(`${PAIR_COOKIE}=fav.${BULIMBA}.${RIVERSIDE}`)
    expect(readSavedPair()?.inbound.id).toBe(RIVERSIDE)
    expect(ferryHasSaved()).toBe(true)
    // The selector never opens by itself after this, as after its own Save.
    expect(shouldShowSelector()).toBe(false)
  })

  it('nothing to do without a ferry item; a trip that is not a direct route is refused', () => {
    expect(saveFerry([])).toBe(true)
    const from = terminalById(BULIMBA)
    const unreachable = ferrySource.stops.find((s) => s.id !== BULIMBA && !from?.destinations.includes(s.id))
    expect(unreachable).toBeTruthy()
    expect(saveFerry([trip(BULIMBA, unreachable?.id ?? '')])).toBe(false)
    expect(saveFerry([trip(BULIMBA, null)])).toBe(false)
    expect(localStorage.getItem(STORAGE_KEYS.SELECTED_STOPS)).toBeNull()
  })

  it('reports a save that storage refused', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(saveFerry([trip(BULIMBA, RIVERSIDE)])).toBe(false)
  })

  it('the picker offers every terminal, and only direct destinations for To', () => {
    expect(ferrySource.stops.length).toBeGreaterThan(10)
    expect(ferrySource.destinations?.(BULIMBA).map((d) => d.id)).toEqual(validDestinations(BULIMBA))
    expect(ferrySource.search('bulim').map((s) => s.id)).toEqual([BULIMBA])
  })

  it('a device whose selector opened before counts as onboarded; answering marks it so', () => {
    expect(ferrySeenBefore()).toBe(false)
    ferryAnswered()
    expect(ferrySeenBefore()).toBe(true)
    expect(shouldShowSelector()).toBe(false)
  })
})

describe('ferry re-run from Settings (THE-113)', () => {
  it('the tray opens with the saved pair: From, with its To chosen', () => {
    expect(ferryTrayItems()).toEqual([])
    saveFerry([trip(BULIMBA, RIVERSIDE)])
    expect(ferryTrayItems()).toEqual([
      expect.objectContaining({
        mode: 'ferry',
        id: BULIMBA,
        name: terminalById(BULIMBA)?.name,
        to: RIVERSIDE,
      }),
    ])
  })

  it('a changed trip replaces the pair; taking it out unsaves the pair and its cookie', () => {
    saveFerry([trip(BULIMBA, RIVERSIDE)])
    const to = validDestinations(RIVERSIDE).find((id) => id !== BULIMBA) ?? BULIMBA
    expect(resaveFerry([trip(RIVERSIDE, to)])).toBe(true)
    expect(readSavedPair()?.outbound.id).toBe(RIVERSIDE)
    expect(resaveFerry([])).toBe(true)
    expect(readSavedPair()).toBeNull()
    expect(localStorage.getItem(STORAGE_KEYS.REMEMBER_SELECTION)).toBeNull()
    expect(document.cookie).not.toContain(`${PAIR_COOKIE}=`)
  })

  it('with storage blocked after the tray opened, taking the trip out is never reported as saved (Codex r3)', () => {
    saveFerry([trip(BULIMBA, RIVERSIDE)])
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    expect(resaveFerry([])).toBe(false)
  })

  it('an unchanged trip writes nothing: a pair kept for this session only stays so', () => {
    sessionStorage.setItem(
      STORAGE_KEYS.SELECTED_STOPS_SESSION,
      JSON.stringify({ outbound: { id: BULIMBA, name: 'B' }, inbound: { id: RIVERSIDE, name: 'R' } }),
    )
    const before = ferryTrayItems()
    expect(before[0]?.to).toBe(RIVERSIDE)
    expect(resaveFerry([...before])).toBe(true)
    expect(localStorage.getItem(STORAGE_KEYS.SELECTED_STOPS)).toBeNull()
    expect(readSavedPair()?.inbound.id).toBe(RIVERSIDE)
  })
})
