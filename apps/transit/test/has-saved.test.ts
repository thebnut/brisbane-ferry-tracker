// @vitest-environment jsdom
/** The landing page's "anything saved?" (lib/has-saved.ts) agrees with what My Transit lists (saved.ts). */
import { KEYS } from '@bft/bus/app/lib/storage.ts'
import { FAVOURITES_KEY as FERRY_FAVOURITES } from '@bft/ferry/app/lib/favourites.ts'
import { STORAGE_KEYS } from '@bft/ferry/app/lib/storage.ts'
import { FAVOURITES_KEY } from '@bft/train/app/lib/storage.ts'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { hasSavedStops } from '../app/lib/has-saved.ts'

const PAIR = { outbound: { id: '317584', name: 'Bulimba' }, inbound: { id: '317590', name: 'Riverside' } }

const CASES: [string, Record<string, string>][] = [
  ['nothing', {}],
  ['empty lists', { [FERRY_FAVOURITES]: '[]', [FAVOURITES_KEY]: '[]', [KEYS.SAVED]: '[]' }],
  ['a ferry favourite', { [FERRY_FAVOURITES]: JSON.stringify([{ from: '317584', to: '317590' }]) }],
  ['a train favourite', { [FAVOURITES_KEY]: JSON.stringify([{ from: 'central', to: null }]) }],
  ['a bus stop', { [KEYS.SAVED]: JSON.stringify([{ id: '10802', name: 'Cultural Centre' }]) }],
  [
    'the remembered ferry pair, before favourites',
    { [STORAGE_KEYS.REMEMBER_SELECTION]: 'true', [STORAGE_KEYS.SELECTED_STOPS]: JSON.stringify(PAIR) },
  ],
  ['the pair, not remembered', { [STORAGE_KEYS.SELECTED_STOPS]: JSON.stringify(PAIR) }],
  [
    'the pair, once favourites exist (empty)',
    {
      [FERRY_FAVOURITES]: '[]',
      [STORAGE_KEYS.REMEMBER_SELECTION]: 'true',
      [STORAGE_KEYS.SELECTED_STOPS]: JSON.stringify(PAIR),
    },
  ],
  ['unreadable JSON', { [KEYS.SAVED]: '{nope' }],
]

describe('hasSavedStops', () => {
  beforeEach(() => {
    localStorage.clear()
    // The bus store caches its list per module: a fresh saved.ts (and stores) for each case.
    vi.resetModules()
  })

  it.each(CASES)('%s: matches readSavedItems', async (_name, items) => {
    for (const [k, v] of Object.entries(items)) localStorage.setItem(k, v)
    const { readSavedItems } = await import('../app/lib/saved.ts')
    expect(hasSavedStops()).toBe(readSavedItems().length > 0)
  })

  it('blocked storage counts as nothing saved', () => {
    const get = Storage.prototype.getItem
    Storage.prototype.getItem = () => {
      throw new Error('blocked')
    }
    try {
      expect(hasSavedStops()).toBe(false)
    } finally {
      Storage.prototype.getItem = get
    }
  })
})
