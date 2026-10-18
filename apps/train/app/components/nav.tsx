/**
 * BrisbaneTrain section navigation (Home, Stations, Map, Alerts) as the one-handed bottom nav. Kept in its own module
 * because BrisbaneTransit swaps exactly this file at build time for its Mode Tabs (apps/transit/modes.config.ts), so
 * the train pages themselves are reused unchanged.
 */
import { BottomNav, type NavItem } from '@bft/ui'
import { Link } from 'react-router'
import { at } from '../lib/base.ts'

export const NAV: NavItem[] = [
  { key: 'home', label: 'Home', icon: 'home', href: at('/') },
  { key: 'stations', label: 'Stations', icon: 'search', href: at('/stations') },
  { key: 'map', label: 'Map', icon: 'map', href: at('/map') },
  { key: 'alerts', label: 'Alerts', icon: 'bell', href: at('/alerts') },
]

export function TrainNav({ active }: { active: string }) {
  return (
    <BottomNav
      items={NAV}
      active={active}
      renderLink={(item, className, inner) => (
        <Link
          to={item.href}
          prefetch="intent"
          className={className}
          aria-current={item.key === active ? 'page' : undefined}
        >
          {inner}
        </Link>
      )}
    />
  )
}
