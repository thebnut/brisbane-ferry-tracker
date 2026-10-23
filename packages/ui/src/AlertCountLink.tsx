/**
 * The alert count in a board header (`@bft/ui/alert-count`, THE-118 PR 3: Alerts left BrisbaneTransit's section bar).
 * Its own entry, so only the boards that show it load it.
 */
import type { ReactNode } from 'react'
import { isNetworkAnswer, type OfflineCopy, type PageCheck, useOnline, usePageCheck } from './connectivity.ts'
import { cx } from './cx.ts'
import { Icon } from './icons.tsx'

/** The parts of an alerts answer (and its query) that say whether it is current. */
type AlertsAnswer = { rtState: string; generatedAt: number } & OfflineCopy
interface AlertsQuery<T> {
  data?: T
  isError: boolean
}

/**
 * Is this alerts answer current enough to count (Codex r4 on THE-118 PR 3)? Only a live one (the Alerts page's own
 * test), from the network (not the service worker's cache, an offline copy, or a page loaded from a cache: usePageCheck,
 * null before hydration), whose query's latest fetch didn't fail. Otherwise an old, open-ended alert kept as "1 alert"
 * for as long as the refetches failed.
 */
export function isCurrentAlerts(
  data: AlertsAnswer | undefined,
  { isError, online, page }: { isError: boolean; online: boolean; page: PageCheck | null },
): boolean {
  if (!data || isError || !online || !page || data.rtState !== 'live' || data.offline === true) return false
  if (page.unconfirmedBefore != null && data.generatedAt <= page.unconfirmedBefore) return false
  return isNetworkAnswer(data)
}

/** The query's answer when it is current (isCurrentAlerts), else null: the board header then shows plain "Alerts". */
export function useCurrentAlerts<T extends AlertsAnswer>(q: AlertsQuery<T>): T | null {
  const online = useOnline()
  const page = usePageCheck()
  return q.data && isCurrentAlerts(q.data, { isError: q.isError, online, page }) ? q.data : null
}

/**
 * "1 alert" when alerts affect the
 * place, else a quiet "Alerts", both linking to the mode's alerts page. `count` null: not known, or not current (useCurrentAlerts).
 */
export function AlertCountLink({
  count,
  href,
  renderLink,
}: {
  count: number | null
  href: string
  /** The app's router link (React Router's Link); defaults to <a>. */
  renderLink?: (props: { href: string; className: string; children: ReactNode }) => ReactNode
}) {
  const some = count != null && count > 0
  const className = cx(
    'inline-flex min-h-11 items-center gap-1.5 self-start rounded-lg pr-1 text-sm no-underline',
    some
      ? 'font-bold text-ferry-orange-deep dark:text-ferry-sunset'
      : 'font-semibold text-sched-text dark:text-night-text/80',
  )
  const children = (
    <>
      <Icon name="alert" size={16} />
      {some ? `${count} alert${count === 1 ? '' : 's'}` : 'Alerts'}
    </>
  )
  return (
    <span data-board-alerts="" className="contents">
      {renderLink ? (
        renderLink({ href, className, children })
      ) : (
        <a href={href} className={className}>
          {children}
        </a>
      )}
    </span>
  )
}
