/** The Mode Tabs shell (mode-layout.tsx), the phone's bottom bar, and the header's back link. */
import { MODE_TABS, ModeTabs, type NavItem } from '@bft/ui'
import { Link, useLocation } from 'react-router'

/** Tab order on phones: My Transit | Nearby | Ferry | Train | Bus (Brett, 20 Oct). My Transit is the home page. */
export const TABS: NavItem[] = MODE_TABS.map((t) => (t.key === 'saved' ? { ...t, href: '/' } : t))

export function activeTab(pathname: string): string {
  for (const k of ['ferry', 'train', 'bus', 'nearby'])
    if (pathname === `/${k}` || pathname.startsWith(`/${k}/`)) return k
  return pathname === '/' ? 'saved' : ''
}

/** The Mode Tabs shell: bottom bar on phones, a pill row above the page on desktop, in the same order. */
export function ModeBar() {
  const { pathname } = useLocation()
  const active = activeTab(pathname)
  return (
    <>
      <div className="md:hidden">
        <ModeTabs
          items={TABS}
          active={active}
          renderLink={(item, className, children) => (
            <Link
              to={item.href}
              prefetch="intent"
              className={className}
              aria-current={item.key === active ? 'page' : undefined}
            >
              {children}
            </Link>
          )}
        />
      </div>
      {/* Phones: room for the Mode Tabs (and a mode's section pills just above them). */}
      <div className="h-28 md:hidden" aria-hidden="true" />
    </>
  )
}

/**
 * Desktop pills (in the header, ModeHeader.tsx): the same order as the phone tabs (Brett, 20 Oct), so the two can't
 * drift; Alerts sits on the right.
 */
export const DESKTOP_TABS: NavItem[] = TABS

const MODE_NAMES: Record<string, string> = { ferry: 'Ferry', train: 'Train', bus: 'Bus' }

/** The phone header's back link from a page under a mode ("‹ Train" from a station); null on a top-level page. */
export function parentOf(pathname: string): { href: string; label: string } | null {
  const mode = /^\/(ferry|train|bus)\/./.exec(pathname)?.[1]
  return mode ? { href: `/${mode}`, label: MODE_NAMES[mode] as string } : null
}
