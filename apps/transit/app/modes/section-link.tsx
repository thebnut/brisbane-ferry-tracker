import type { SectionLink } from '@bft/ui'
import { Link } from 'react-router'

/** React Router link for SectionTabs (prefetch on intent, like the apps' own navs). */
export function sectionLink(item: SectionLink, className: string, current: boolean) {
  return (
    <Link to={item.href} prefetch="intent" className={className} aria-current={current ? 'page' : undefined}>
      {item.label}
    </Link>
  )
}

/** Fixed just above the Mode Tabs on phones; in the page flow on desktop. */
export const SECTION_BAR =
  'fixed inset-x-0 bottom-[calc(max(env(safe-area-inset-bottom),6px)+3.75rem)] z-30 border-t border-ferry-orange/10 bg-white/90 backdrop-blur dark:bg-night-2/90'
