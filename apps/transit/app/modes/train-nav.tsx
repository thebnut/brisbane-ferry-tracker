/**
 * Replaces apps/train/app/components/nav.tsx inside BrisbaneTransit (modes.config.ts). The train pages are unchanged;
 * the bottom bar is the Mode Tabs (mode-layout.tsx), so Home, Stations, Map and Alerts become a pill row just above
 * it on phones and at the bottom on desktop (where the Mode Tabs are a row at the top). Same exports as the original (test/nav-slots.test.ts).
 */
import { type NavItem, SectionTabs } from '@bft/ui'
import { at } from '@bft/train/app/lib/base.ts'
import { SECTION_BAR, sectionLink } from './section-link.tsx'

export const NAV: NavItem[] = [
  { key: 'home', label: 'Home', icon: 'home', href: at('/') },
  { key: 'stations', label: 'Stations', icon: 'search', href: at('/stations') },
  { key: 'map', label: 'Map', icon: 'map', href: at('/map') },
  { key: 'alerts', label: 'Alerts', icon: 'bell', href: at('/alerts') },
]

export function TrainNav({ active }: { active: string }) {
  return (
    <SectionTabs
      label="Train sections"
      items={NAV}
      active={active}
      renderLink={sectionLink}
      className={`${SECTION_BAR} md:bottom-0`}
    />
  )
}
