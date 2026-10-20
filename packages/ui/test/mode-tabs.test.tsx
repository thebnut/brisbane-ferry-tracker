import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MODE_TABS, ModeTabs } from '../src/chrome.tsx'

describe('Mode Tabs', () => {
  it('order is My Transit, Nearby, Ferry, Train, Bus (Brett, 20 Oct)', () => {
    expect(MODE_TABS.map((t) => t.key)).toEqual(['saved', 'nearby', 'ferry', 'train', 'bus'])
    expect(MODE_TABS.map((t) => t.label)).toEqual(['My Transit', 'Nearby', 'Ferry', 'Train', 'Bus'])
  })

  it('renders in that order and no tab is called "Saved"', () => {
    render(<ModeTabs active="saved" />)
    const links = within(screen.getByRole('navigation', { name: 'Modes' })).getAllByRole('link')
    expect(links.map((l) => l.textContent)).toEqual(['My Transit', 'Nearby', 'Ferry', 'Train', 'Bus'])
    expect(screen.queryByRole('link', { name: /^Saved$/ })).toBeNull()
    expect(links[0]).toHaveAttribute('aria-current', 'page')
  })
})
