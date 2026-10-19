// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { savePair } from '../app/lib/save-pair.ts'
import { markSelectorSeen, STORAGE_KEYS, shouldShowSelector } from '../app/lib/storage.ts'

const pair = { outbound: { id: '317584', name: 'Bulimba' }, inbound: { id: '317590', name: 'Riverside' } }

describe('stop selector on load (X1)', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
  it('opens by itself on the first visit only', () => {
    expect(shouldShowSelector()).toBe(true)
    markSelectorSeen()
    // Closed without saving: later loads show the default board, not the modal again.
    expect(shouldShowSelector()).toBe(false)
  })
  it('never opens by itself with a remembered pair', () => {
    savePair(pair, true)
    expect(shouldShowSelector()).toBe(false)
  })
  it('"Remember selection" off no longer reopens it on every load', () => {
    savePair(pair, false)
    markSelectorSeen()
    expect(localStorage.getItem(STORAGE_KEYS.SELECTED_STOPS)).toBeNull()
    expect(shouldShowSelector()).toBe(false)
  })
})
