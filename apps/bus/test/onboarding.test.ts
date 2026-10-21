// @vitest-environment jsdom
/** P4: bus onboarding adds the tray's stops to My stops through storage.ts (format and cookie unchanged). */
import { beforeEach, describe, expect, it, vi } from 'vitest'

async function modules() {
  vi.resetModules()
  return {
    onb: await import('../app/lib/onboarding.ts'),
    storage: await import('../app/lib/storage.ts'),
  }
}

beforeEach(() => {
  localStorage.clear()
  // biome-ignore lint/suspicious/noDocumentCookie: clearing jsdom's cookies between tests.
  for (const c of document.cookie.split('; ')) document.cookie = `${c.split('=')[0]}=; max-age=0; path=/`
  vi.restoreAllMocks()
})

describe('bus onboarding', () => {
  it('adds the tray’s stops after any already saved, in order, without duplicates', async () => {
    const { onb, storage } = await modules()
    expect(onb.busHasSaved()).toBe(false)
    storage.toggleSaved({ id: '1832', name: 'King George Square' })
    const ok = onb.saveBus([
      { mode: 'bus', id: '10802', name: 'Cultural Centre', detail: 'Stop 010802' },
      { mode: 'train', id: 'central', name: 'Central' },
      { mode: 'bus', id: '1832', name: 'King George Square' },
      { mode: 'bus', id: '600', name: 'Chermside' },
    ])
    expect(ok).toBe(true)
    // Exactly the store's own shape: { id, name }, nothing from the tray (detail, mode) leaks in.
    expect(JSON.parse(localStorage.getItem(storage.KEYS.SAVED) ?? '[]')).toEqual([
      { id: '1832', name: 'King George Square' },
      { id: '10802', name: 'Cultural Centre' },
      { id: '600', name: 'Chermside' },
    ])
    expect(document.cookie).toContain(`${storage.SAVED_COOKIE}=1832.10802.600`)
    expect(onb.busHasSaved()).toBe(true)
  })

  it('a refused save can be retried once storage works again (Codex r1)', async () => {
    const { onb, storage } = await modules()
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    const tray = [
      { mode: 'bus' as const, id: '10802', name: 'Cultural Centre' },
      { mode: 'bus' as const, id: '600', name: 'Chermside' },
    ]
    expect(onb.saveBus(tray)).toBe(false)
    set.mockRestore()
    expect(onb.saveBus(tray)).toBe(true)
    expect(JSON.parse(localStorage.getItem(storage.KEYS.SAVED) ?? '[]')).toEqual([
      { id: '10802', name: 'Cultural Centre' },
      { id: '600', name: 'Chermside' },
    ])
  })

  it('reports a save that storage refused', async () => {
    const { onb } = await modules()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(onb.saveBus([{ mode: 'bus', id: '10802', name: 'Cultural Centre' }])).toBe(false)
  })
})

describe('bus re-run from Settings (THE-113)', () => {
  const stop = (id: string, name = `Stop ${id}`) => ({ mode: 'bus' as const, id, name })

  it('the tray opens with My stops; Save makes My stops match it (added, removed, reordered)', async () => {
    const { onb, storage } = await modules()
    storage.toggleSaved({ id: '1832', name: 'King George Square' })
    storage.toggleSaved({ id: '10802', name: 'Cultural Centre' })
    const before = onb.busTrayItems()
    expect(before).toEqual([stop('1832', 'King George Square'), stop('10802', 'Cultural Centre')])
    const after = [stop('600', 'Chermside'), stop('1832', 'King George Square')]
    expect(onb.resaveBus(after)).toBe(true)
    expect(JSON.parse(localStorage.getItem(storage.KEYS.SAVED) ?? '[]')).toEqual([
      { id: '600', name: 'Chermside' },
      { id: '1832', name: 'King George Square' },
    ])
    expect(document.cookie).toContain(`${storage.SAVED_COOKIE}=600.1832`)
    expect(storage.readSaved().map((s) => s.id)).toEqual(['600', '1832'])
  })

  it('an unchanged tray writes nothing; an emptied one unsaves every stop', async () => {
    const { onb, storage } = await modules()
    storage.toggleSaved({ id: '1832', name: 'King George Square' })
    const before = onb.busTrayItems()
    const set = vi.spyOn(Storage.prototype, 'setItem')
    expect(onb.resaveBus([{ mode: 'train', id: 'central', name: 'Central' }, ...before])).toBe(true)
    expect(set).not.toHaveBeenCalled()
    set.mockRestore()
    expect(onb.resaveBus([])).toBe(true)
    expect(JSON.parse(localStorage.getItem(storage.KEYS.SAVED) ?? 'null')).toEqual([])
  })

  it('the tray opens with what storage holds, also a save from another tab the in-memory list missed (Codex r1)', async () => {
    const { onb, storage } = await modules()
    storage.toggleSaved({ id: '1832', name: 'King George Square' })
    localStorage.setItem(
      storage.KEYS.SAVED,
      JSON.stringify([
        { id: '1832', name: 'King George Square' },
        { id: '10802', name: 'Cultural Centre' },
      ]),
    )
    expect(storage.readSaved().map((s) => s.id)).toEqual(['1832'])
    const before = onb.busTrayItems()
    expect(before.map((i) => i.id)).toEqual(['1832', '10802'])
    expect(onb.resaveBus([...before, stop('600', 'Chermside')])).toBe(true)
    expect(
      JSON.parse(localStorage.getItem(storage.KEYS.SAVED) ?? '[]').map((s: { id: string }) => s.id),
    ).toEqual(['1832', '10802', '600'])
  })

  it('reports a re-save that storage refused', async () => {
    const { onb, storage } = await modules()
    storage.toggleSaved({ id: '1832', name: 'King George Square' })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(onb.resaveBus([stop('600')])).toBe(false)
  })
})
