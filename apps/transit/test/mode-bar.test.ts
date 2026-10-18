import { describe, expect, it } from 'vitest'
import { activeTab, TABS } from '../app/components/ModeBar.tsx'

describe('Mode Tabs', () => {
  it('X-* order and Saved is the home page', () => {
    expect(TABS.map((t) => `${t.label}:${t.href}`)).toEqual([
      'Ferry:/ferry',
      'Train:/train',
      'Bus:/bus',
      'Nearby:/nearby',
      'Saved:/',
    ])
  })

  it('the URL is the only mode state', () => {
    expect(activeTab('/')).toBe('saved')
    expect(activeTab('/bus')).toBe('bus')
    expect(activeTab('/bus/stop/10802')).toBe('bus')
    expect(activeTab('/train/trip/x')).toBe('train')
    expect(activeTab('/nearby')).toBe('nearby')
    expect(activeTab('/alerts')).toBe('')
    expect(activeTab('/busway')).toBe('')
  })
})
