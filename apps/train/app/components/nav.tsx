/**
 * BrisbaneTrain section navigation (Home, Map, Alerts): the one-handed bottom nav on phones, links in the header on
 * desktop (T-Desktop has no bottom nav; smoke test T6). /stations is no longer a destination here (THE-118): it is the
 * full list behind "All N stations" on home, as on BrisbaneTransit. Kept in its own module
 * because BrisbaneTransit swaps exactly this file at build time for its Mode Tabs (apps/transit/modes.config.ts), so
 * the train pages themselves are reused unchanged.
 */
import { BottomNav, type NavItem } from '@bft/ui'
import { Link } from 'react-router'
import { at } from '../lib/base.ts'

export const NAV: NavItem[] = [
  { key: 'home', label: 'Home', icon: 'home', href: at('/') },
  { key: 'map', label: 'Map', icon: 'map', href: at('/map') },
  { key: 'alerts', label: 'Alerts', icon: 'bell', href: at('/alerts') },
]

/** Bottom navigation (phones only). */
export function TrainNav({ active }: { active: string }) {
  return (
    <div className="md:hidden">
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
    </div>
  )
}

/** Desktop navigation links in the header. */
export function DesktopNav({ active }: { active: string }) {
  return (
    <nav aria-label="Sections" className="hidden items-center gap-1.5 md:flex">
      {NAV.map((i) => (
        <Link
          key={i.key}
          to={i.href}
          prefetch="intent"
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
