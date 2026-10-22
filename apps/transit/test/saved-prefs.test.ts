// @vitest-environment jsdom
import { KEYS } from '@bft/bus/app/lib/storage.ts'
import { STORAGE_KEYS } from '@bft/ferry/app/lib/storage.ts'
import { FAVOURITES_KEY } from '@bft/train/app/lib/storage.ts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readSavedItems as readDefault } from '../app/lib/saved.ts'
import {
  applyPrefs,
  cleanLabel,
  EMPTY_PREFS,
  LABEL_MAX,
  migratePrefs,
  PREFS_KEY,
  readPrefs,
  writePrefs,
} from '../app/lib/saved-prefs.ts'
import { prefsFor as prefsWith, savePrefs as saveWith } from '../app/lib/saved-prefs-save.ts'
import { cardModel } from '../app/routes/saved.tsx'

const store = { read: readPrefs, write: writePrefs, clean: cleanLabel, maxLength: LABEL_MAX }
const prefsFor = (list: Parameters<typeof prefsWith>[0], prev: Parameters<typeof prefsWith>[1]) =>
  prefsWith(list, prev, cleanLabel)
const savePrefs = (list: Parameters<typeof saveWith>[0]) => saveWith(list, store)
/** What My Transit lists (the saved route reads it the same way). */
const readSavedItems = () => applyPrefs(readDefault(), readPrefs())
const items = (...ids: string[]) => ids.map((id) => ({ id, title: id.toUpperCase() }))
const ids = (list: Array<{ id: string }>) => list.map((i) => i.id)

/** One of each mode, saved in each app's own store (as readSavedItems reads them). */
function saveAll() {
  localStorage.setItem(
    STORAGE_KEYS.SELECTED_STOPS,
    JSON.stringify({
      outbound: { id: '317584', name: 'Bulimba' },
      inbound: { id: '317590', name: 'Riverside' },
    }),
  )
  localStorage.setItem(FAVOURITES_KEY, JSON.stringify([{ from: 'roma-street', to: null }]))
  localStorage.setItem(
    KEYS.SAVED,
    JSON.stringify([
      { id: '1832', name: 'Cultural Centre, platform 1' },
      { id: '10795', name: 'Queen Street station' },
    ]),
  )
}
const DEFAULT = ['ferry:317584>317590', 'train:roma-street>', 'bus:1832', 'bus:10795']

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('My Transit order and names overlay (THE-114)', () => {
  it('no overlay: the default order and names, exactly as before, and nothing written', () => {
    saveAll()
    const list = readSavedItems()
    expect(ids(list)).toEqual(DEFAULT)
    expect(list.every((i) => i.label === undefined)).toBe(true)
    expect(localStorage.getItem(PREFS_KEY)).toBeNull()
  })

  it('merges the order with the default list: unlisted items at the end, in the default order', () => {
    const prefs = { ...EMPTY_PREFS, order: ['c', 'a'] }
    expect(ids(applyPrefs(items('a', 'b', 'c', 'd'), prefs))).toEqual(['c', 'a', 'b', 'd'])
  })

  it('ignores entries for items no longer saved, and prunes them from what it writes', () => {
    const prefs = { ...EMPTY_PREFS, order: ['gone', 'b', 'a'], labels: { gone: 'Old', a: 'Home' } }
    const shown = applyPrefs(items('a', 'b'), prefs)
    expect(shown).toEqual([
      { id: 'b', title: 'B' },
      { id: 'a', title: 'A', label: 'Home' },
    ])
    const next = prefsFor(shown, prefs)
    expect(next.order).toEqual(['b', 'a'])
    // The gone item's name is kept, so saving it again brings it back.
    expect(next.labels).toEqual({ gone: 'Old', a: 'Home' })
    expect(applyPrefs(items('gone'), next)[0]?.label).toBe('Old')
  })

  it('keeps only a bounded number of names for items no longer saved', () => {
    const labels = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`x${i}`, `L${i}`]))
    const next = prefsFor(items('a'), { ...EMPTY_PREFS, labels })
    expect(Object.keys(next.labels)).toHaveLength(50)
    expect(next.labels.x79).toBe('L79')
    expect(next.labels.x0).toBeUndefined()
  })

  it('label falls back to the stop’s own name when cleared', () => {
    saveAll()
    let list = readSavedItems()
    list = list.map((i) => (i.id === 'bus:1832' ? { ...i, label: 'Work' } : i))
    expect(savePrefs(list)).toBe(true)
    expect(readSavedItems().find((i) => i.id === 'bus:1832')?.label).toBe('Work')
    savePrefs(list.map((i) => ({ ...i, label: i.id === 'bus:1832' ? '   ' : i.label })))
    const item = readSavedItems().find((i) => i.id === 'bus:1832')
    expect(item?.label).toBeUndefined()
    expect(item?.title).toBe('Cultural Centre, platform 1')
  })

  it('reorder and names persist through each mode’s store unchanged', () => {
    saveAll()
    const before = {
      ferry: localStorage.getItem(STORAGE_KEYS.SELECTED_STOPS),
      train: localStorage.getItem(FAVOURITES_KEY),
      bus: localStorage.getItem(KEYS.SAVED),
    }
    const list = readSavedItems()
    savePrefs([
      list[3],
      list[0],
      { ...(list[2] as (typeof list)[number]), label: 'Uni' },
      list[1],
    ] as typeof list)
    expect(ids(readSavedItems())).toEqual([
      'bus:10795',
      'ferry:317584>317590',
      'bus:1832',
      'train:roma-street>',
    ])
    expect(localStorage.getItem(STORAGE_KEYS.SELECTED_STOPS)).toBe(before.ferry)
    expect(localStorage.getItem(FAVOURITES_KEY)).toBe(before.train)
    expect(localStorage.getItem(KEYS.SAVED)).toBe(before.bus)
  })

  it('cleans names: trimmed, one line, spaces collapsed, capped, plain text', () => {
    expect(cleanLabel('  Home  ')).toBe('Home')
    expect(cleanLabel('a\n\tb\u0000c  d')).toBe('a b c d')
    expect(cleanLabel('x'.repeat(100))).toHaveLength(LABEL_MAX)
    // Capped by characters, never splitting an emoji's surrogate pair.
    expect(cleanLabel('🚢'.repeat(50))).toBe('🚢'.repeat(LABEL_MAX))
    expect(cleanLabel('<img src=x onerror=alert(1)>')).toBe('<img src=x onerror=alert(1)>')
    expect(cleanLabel('   ')).toBe('')
    expect(cleanLabel(42)).toBe('')
  })

  it('a hostile stored overlay stays plain data', () => {
    localStorage.setItem(
      PREFS_KEY,
      '{"v":1,"order":["a",3,null,"a"],"labels":{"__proto__":"x","a":"  Home ","b":7,"c":""}}',
    )
    const prefs = readPrefs()
    expect(prefs.order).toEqual(['a'])
    expect(Object.getPrototypeOf(prefs.labels)).toBe(Object.prototype)
    expect(Object.keys(prefs.labels).sort()).toEqual(['__proto__', 'a'])
    expect(prefs.labels.a).toBe('Home')
    expect(applyPrefs(items('__proto__'), prefs)[0]?.label).toBe('x')
    expect(applyPrefs(items('toString'), prefs)[0]?.label).toBeUndefined()
  })

  it('migrates a v0 overlay to v1 and writes it back', () => {
    expect(migratePrefs(['b', 'a'])).toEqual({
      prefs: { v: 1, order: ['b', 'a'], labels: {} },
      migrated: true,
    })
    localStorage.setItem(PREFS_KEY, JSON.stringify({ order: ['b'], labels: { b: 'Gym' } }))
    expect(readPrefs()).toEqual({ v: 1, order: ['b'], labels: { b: 'Gym' } })
    expect(JSON.parse(localStorage.getItem(PREFS_KEY) as string)).toEqual({
      v: 1,
      order: ['b'],
      labels: { b: 'Gym' },
    })
  })

  it('v1 reads as it is; unreadable or future versions read as no overlay and are left alone', () => {
    expect(migratePrefs({ v: 1, order: ['a'], labels: {} }).migrated).toBe(false)
    for (const bad of [null, 'x', 7, { v: 99, order: ['a'] }])
      expect(migratePrefs(bad).prefs).toEqual(EMPTY_PREFS)
    localStorage.setItem(PREFS_KEY, '{not json')
    expect(readPrefs()).toEqual(EMPTY_PREFS)
    localStorage.setItem(PREFS_KEY, '{"v":2,"order":["a"]}')
    readPrefs()
    expect(localStorage.getItem(PREFS_KEY)).toBe('{"v":2,"order":["a"]}')
  })

  it('blocked storage: no crash, the default list, and saving reports failure', () => {
    saveAll()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((k) => {
      if (k === PREFS_KEY) throw new DOMException('blocked', 'SecurityError')
      return null
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    expect(readPrefs()).toEqual(EMPTY_PREFS)
    expect(() => readSavedItems()).not.toThrow()
    expect(savePrefs(items('a'))).toBe(false)
  })

  it('the card heads with the custom name and keeps what it would have said under it', () => {
    const item = {
      id: 'bus:1832',
      mode: 'bus' as const,
      key: '1832',
      to: null,
      title: 'CC',
      href: '/bus/stop/1832',
    }
    expect(cardModel(item, undefined, Date.now())).toMatchObject({ title: 'CC', subtitle: null })
    expect(cardModel({ ...item, label: 'Work' }, undefined, Date.now())).toMatchObject({
      title: 'Work',
      subtitle: 'CC',
    })
  })
})
