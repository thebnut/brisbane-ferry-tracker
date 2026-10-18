/**
 * Replaces apps/bus/app/components/nav.tsx inside BrisbaneTransit (modes.config.ts). The bus pages are unchanged; the
 * bottom bar is the Mode Tabs (mode-layout.tsx), so the bus sections become a pill row just above it on phones and
 * stay as the status-strip pills on desktop. Same exports as the original (test/nav-slots.test.ts).
 */

import { at } from '@bft/bus/app/lib/base.ts'
import { type NavItem, SectionTabs } from '@bft/ui'
import { SECTION_BAR, sectionLink } from './section-link.tsx'

export const NAV: NavItem[] = [
  { key: 'home', label: 'My stops', icon: 'star', href: at('/') },
  { key: 'nearby', label: 'Nearby', icon: 'nearby', href: at('/nearby') },
  { key: 'map', label: 'Map', icon: 'map', href: at('/map') },
  { key: 'alerts', label: 'Alerts', icon: 'alert', href: at('/alerts') },
]

export function BusNav({ active, alertCount }: { active: string; alertCount?: number }) {
  const items = NAV.map((i) =>
    i.key === 'alerts' && alertCount ? { ...i, label: `Alerts (${alertCount})` } : i,
  )
  return (
    <SectionTabs
      label="Bus sections"
      items={items}
      active={active}
      renderLink={sectionLink}
      className={`${SECTION_BAR} md:hidden`}
    />
  )
}

/** Desktop: the same pills in the status strip (as the standalone bus app). */
export function DesktopNav({ active }: { active: string }) {
  return (
    <SectionTabs
      label="Bus sections"
      items={NAV}
      active={active}
      renderLink={sectionLink}
      className="hidden md:block [&_ul]:p-0"
    />
  )
}
