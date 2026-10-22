/**
 * Replaces apps/train/app/components/nav.tsx inside BrisbaneTransit (modes.config.ts). The train pages are unchanged;
 * the five Mode Tabs (mode-layout.tsx) are the only bottom layer, so the Home/Stations/Map/Alerts section pills render
 * nothing here (THE-118 PR 3): Home is the Train tab, Stations the search on its home, Map a chip on the board and the
 * home, Alerts the count in the board header. Same exports as the original (test/nav-slots.test.ts).
 */

import { at } from '@bft/train/app/lib/base.ts'
import type { NavItem } from '@bft/ui'

export const NAV: NavItem[] = [
  { key: 'home', label: 'Home', icon: 'home', href: at('/') },
  { key: 'stations', label: 'Stations', icon: 'search', href: at('/stations') },
  { key: 'map', label: 'Map', icon: 'map', href: at('/map') },
  { key: 'alerts', label: 'Alerts', icon: 'bell', href: at('/alerts') },
]

export function DesktopNav(_: { active: string }) {
  return null
}

export function TrainNav(_: { active: string }) {
  return null
}
