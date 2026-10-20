/** The Mode Tabs shell (mode-layout.tsx): the only transit chrome on mode pages, so it stays small. */
import { Icon, MODE_TABS, ModeTabs, type NavItem } from '@bft/ui'
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

/** Desktop pills: the same order as the phone tabs (Brett, 20 Oct), so the two can't drift; Alerts sits on the right. */
export const DESKTOP_TABS: NavItem[] = TABS

export function DesktopModeBar() {
  const { pathname } = useLocation()
  const active = activeTab(pathname)
  const items = DESKTOP_TABS
  return (
    <nav
      aria-label="Modes"
      className="hidden border-b border-ferry-orange/20 bg-white/95 md:block dark:bg-night-2/95"
    >
      <ul className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-2">
        {items.map((i) => {
          const on = i.key === active
          return (
            <li key={i.key}>
              <Link
                to={i.href}
                prefetch="intent"
                aria-current={on ? 'page' : undefined}
                className={
                  on
                    ? 'flex h-10 items-center gap-1.5 rounded-full bg-ferry-orange-aa px-4 text-sm font-bold text-white no-underline'
                    : 'flex h-10 items-center gap-1.5 rounded-full border border-ferry-orange/25 bg-white px-3.5 text-sm font-semibold text-gray-700 no-underline dark:bg-night-card dark:text-night-text'
                }
              >
                <Icon name={i.icon} size={18} />
                {i.label}
              </Link>
            </li>
          )
        })}
        <li className="ml-auto">
          <Link
            to="/alerts"
            prefetch="intent"
            className="flex h-10 items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-ferry-orange-deep no-underline dark:text-ferry-sunset"
          >
            <Icon name="alert" size={18} />
            Alerts
          </Link>
        </li>
      </ul>
    </nav>
  )
}
