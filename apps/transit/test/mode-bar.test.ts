import { describe, expect, it } from 'vitest'
import { activeTab, DESKTOP_TABS, parentOf, TABS } from '../app/components/ModeBar.tsx'

describe('Mode Tabs', () => {
  it('phone order: My Transit, Nearby, Ferry, Train, Bus; My Transit is /saved', () => {
    expect(TABS.map((t) => `${t.label}:${t.href}`)).toEqual([
      'My Transit:/saved',
      'Nearby:/nearby',
      'Ferry:/ferry',
      'Train:/train',
      'Bus:/bus',
    ])
  })

  it('desktop pills use the phone order', () => {
    expect(DESKTOP_TABS.map((t) => t.key)).toEqual(['saved', 'nearby', 'ferry', 'train', 'bus'])
    expect(DESKTOP_TABS.map((t) => t.key)).toEqual(TABS.map((t) => t.key))
  })

  it('the URL is the only mode state', () => {
    // Release 24: My Transit is /saved; / is the landing page, no tab's.
    expect(activeTab('/saved')).toBe('saved')
    expect(activeTab('/')).toBe('')
    expect(TABS.find((t) => t.key === 'saved')?.href).toBe('/saved')
    expect(activeTab('/bus')).toBe('bus')
    expect(activeTab('/bus/stop/10802')).toBe('bus')
    expect(activeTab('/train/trip/x')).toBe('train')
    expect(activeTab('/nearby')).toBe('nearby')
    expect(activeTab('/alerts')).toBe('')
    expect(activeTab('/busway')).toBe('')
  })
})

describe('header back link (THE-118 PR 2)', () => {
  it('a page under a mode goes back to that mode; top-level pages show the emblem instead', () => {
    expect(parentOf('/train/station/central')).toEqual({ href: '/train', label: 'Train' })
    expect(parentOf('/bus/stop/10802')).toEqual({ href: '/bus', label: 'Bus' })
    expect(parentOf('/ferry/terminal/bulimba')).toEqual({ href: '/ferry', label: 'Ferry' })
    for (const p of ['/', '/saved', '/ferry', '/train', '/bus', '/nearby', '/alerts', '/busway/x'])
      expect(parentOf(p)).toBeNull()
  })
})
