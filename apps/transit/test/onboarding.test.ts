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
