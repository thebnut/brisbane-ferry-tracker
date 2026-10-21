// @vitest-environment jsdom
/**
 * P4: transit onboarding saves a mixed tray into each mode's own store, and My Transit (saved.ts) reads them all back
 * with the apps' own code; the prompt's "anything saved" matches what My Transit lists.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

async function modules() {
  vi.resetModules()
  return {
    picker: await import('../app/components/OnboardingPicker.tsx'),
    prompt: await import('../app/components/Onboarding.tsx'),
    saved: await import('../app/lib/saved.ts'),
  }
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  // biome-ignore lint/suspicious/noDocumentCookie: clearing jsdom's cookies between tests.
  for (const c of document.cookie.split('; ')) document.cookie = `${c.split('=')[0]}=; max-age=0; path=/`
})

describe('transit onboarding', () => {
  it('one Save fills every mode’s store, in tray order, and My Transit lists them', async () => {
    const { picker, prompt, saved } = await modules()
    expect(prompt.anySaved()).toBe(false)
    expect(saved.readSavedItems()).toEqual([])
    const ok = picker.saveAll({
      said: '',
      items: [
        { mode: 'bus', id: '10802', name: 'Cultural Centre, platform 1' },
        { mode: 'train', id: 'central', name: 'Central' },
        { mode: 'ferry', id: '317584', name: 'Bulimba', to: '317590' },
        { mode: 'bus', id: '1832', name: 'King George Square' },
      ],
    })
    expect(ok).toBe(true)
    expect(saved.readSavedItems().map((i) => i.id)).toEqual([
      'ferry:317584>317590',
      'train:central>',
      'bus:10802',
      'bus:1832',
    ])
    expect(prompt.anySaved()).toBe(true)
  })

  it('anySaved sees a bus stop saved in another tab after this tab read the bus list (Codex r2)', async () => {
    const { prompt } = await modules()
    const bus = await import('@bft/bus/app/lib/storage.ts')
    expect(bus.readSaved()).toEqual([])
    localStorage.setItem('bft-bus-saved', JSON.stringify([{ id: '10802', name: 'Cultural Centre' }]))
    window.dispatchEvent(new StorageEvent('storage', { key: 'bft-bus-saved' }))
    expect(bus.readSaved()).toEqual([])
    expect(prompt.anySaved()).toBe(true)
  })

  it('anySaved sees each mode on its own (a session-only ferry pair too)', async () => {
    const { prompt } = await modules()
    localStorage.setItem('bft-train-favourites', JSON.stringify([{ from: 'central', to: null }]))
    expect(prompt.anySaved()).toBe(true)
    localStorage.clear()
    sessionStorage.setItem(
      'brisbane-ferry-selected-stops-session',
      JSON.stringify({ outbound: { id: '317584', name: 'B' }, inbound: { id: '317590', name: 'R' } }),
    )
    expect(prompt.anySaved()).toBe(true)
  })
})

describe('transit re-run from Settings (THE-113)', () => {
  it('the tray opens with every mode’s saved stops; one Save edits each store, and My Transit matches the tray', async () => {
    const { picker, saved } = await modules()
    picker.saveAll({
      said: '',
      items: [
        { mode: 'bus', id: '10802', name: 'Cultural Centre, platform 1' },
        { mode: 'train', id: 'central', name: 'Central' },
        { mode: 'ferry', id: '317584', name: 'Bulimba', to: '317590' },
      ],
    })
    const before = picker.allTrayItems()
    expect(before.map((i) => `${i.mode}:${i.id}`)).toEqual(['ferry:317584', 'train:central', 'bus:10802'])
    // Ferry taken out, a bus stop added, train untouched.
    const ok = picker.resaveAll(before, {
      said: '',
      items: [before[1], before[2], { mode: 'bus', id: '1832', name: 'King George Square' }].filter(
        (i) => i != null,
      ),
    })
    expect(ok).toBe(true)
    expect(saved.readSavedItems().map((i) => i.id)).toEqual(['train:central>', 'bus:10802', 'bus:1832'])
  })
})
