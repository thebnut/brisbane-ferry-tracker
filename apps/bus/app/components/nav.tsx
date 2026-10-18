/**
 * BrisbaneBus section navigation: bottom nav on phones, pills in the status strip on desktop. Kept in its own module
 * because BrisbaneTransit swaps exactly this file at build time for its Mode Tabs (apps/transit/modes.config.ts), so
 * the bus pages themselves are reused unchanged.
 */
import { BottomNav, type NavItem } from '@bft/ui'
import { Link } from 'react-router'
import { at } from '../lib/base.ts'

export const NAV: NavItem[] = [
  { key: 'home', label: 'My stops', icon: 'star', href: at('/') },
  { key: 'nearby', label: 'Nearby', icon: 'nearby', href: at('/nearby') },
  { key: 'map', label: 'Map', icon: 'map', href: at('/map') },
  { key: 'alerts', label: 'Alerts', icon: 'alert', href: at('/alerts') },
]

/** One-handed bottom navigation (phones); desktop uses the header and status strip. */
export function BusNav({ active, alertCount }: { active: string; alertCount?: number }) {
  const items = NAV.map((i) =>
    i.key === 'alerts' && alertCount ? { ...i, label: `Alerts (${alertCount})` } : i,
  )
  return (
    <div className="md:hidden">
      <BottomNav
        items={items}
        active={active}
        renderLink={(item, className, children) => (
          <Link
            to={item.href}
            className={className}
            aria-current={item.key === active ? 'page' : undefined}
            prefetch="intent"
          >
            {children}
          </Link>
        )}
      />
    </div>
  )
}

/** Desktop navigation links in the status strip. */
export function DesktopNav({ active }: { active: string }) {
  return (
    <nav aria-label="Sections" className="hidden items-center gap-1.5 md:flex">
      {NAV.map((i) => (
        <Link
          key={i.key}
          to={i.href}
          aria-current={i.key === active ? 'page' : undefined}
          className={
            i.key === active
              ? 'flex h-9 items-center rounded-full bg-ferry-orange-aa px-3 text-sm font-bold text-white'
              : 'flex h-9 items-center rounded-full border border-ferry-orange/20 bg-white px-3 text-sm font-semibold text-aqua-text hover:border-ferry-orange/50 dark:bg-night-card dark:text-ferry-aqua-light'
          }
        >
          {i.label}
        </Link>
      ))}
    </nav>
  )
}
