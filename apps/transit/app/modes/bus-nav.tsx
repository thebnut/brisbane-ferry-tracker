/**
 * Replaces apps/bus/app/components/nav.tsx inside BrisbaneTransit (modes.config.ts). The bus pages are unchanged; the
 * five Mode Tabs (mode-layout.tsx) are the only bottom layer, so the My stops/Nearby/Map/Alerts section pills render
 * nothing here (THE-118 PR 3): My stops is the Bus tab, Map a chip on the board and the home, Alerts the count in the
 * board header. Same exports as the original (test/nav-slots.test.ts).
 */

import { at } from '@bft/bus/app/lib/base.ts'
import type { NavItem } from '@bft/ui'

export const NAV: NavItem[] = [
  { key: 'home', label: 'My stops', icon: 'star', href: at('/') },
  { key: 'nearby', label: 'Nearby', icon: 'nearby', href: at('/nearby') },
  { key: 'map', label: 'Map', icon: 'map', href: at('/map') },
  { key: 'alerts', label: 'Alerts', icon: 'alert', href: at('/alerts') },
]

export function BusNav(_: { active: string; alertCount?: number }) {
  return null
}

export function DesktopNav(_: { active: string }) {
  return null
}
