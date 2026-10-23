/**
 * The alert count in a board header (`@bft/ui/alert-count`, THE-118 PR 3: Alerts left BrisbaneTransit's section bar).
 * Its own entry, so only the boards that show it load it.
 */
import type { ReactNode } from 'react'
import { type OfflineCopy, type PageCheck, type Received, useOnline, usePageCheck } from './connectivity.ts'
import { cx } from './cx.ts'
import { Icon } from './icons.tsx'

/** The parts of an alerts answer (and its query) that say whether it is current. */
type AlertsAnswer = { rtState: string; generatedAt: number } & OfflineCopy & Received
interface AlertsQuery<T> {
  data?: T
  isError: boolean
  /** TanStack's: the query has fetched since it started (from its seed). */
  isFetched?: boolean
}

/** Loader answers a page came with (useCurrentAlerts' `seed`): network answers without a device arrival time. */
const seeds = new WeakSet<object>()

/**
 * Is this alerts answer current enough to count (Codex r4, r5 on THE-118 PR 3)? Only a live one (the Alerts page's own
 * test) from the network, whose query's latest fetch didn't fail, while the connection is up. From the network means
 * stamped on arrival (noteCacheCopy's `receivedAt`, which the service worker's copies never get and which survives
 * TanStack's structural sharing, unlike the cache-copy mark) or a page's own loader answer before the query has
 * fetched anything (`seeded`; a later copy equal to it keeps the seed object, Codex r6), and not from a
 * page loaded from a cache (usePageCheck, null before hydration). Otherwise an old, open-ended alert stayed up as
 * "1 alert" for as long as the refetches failed or the service worker answered.
 */
export function isCurrentAlerts(
  data: AlertsAnswer | undefined,
  {
    isError,
    online,
    page,
    seeded = false,
  }: { isError: boolean; online: boolean; page: PageCheck | null; seeded?: boolean },
): boolean {
  if (!data || isError || !online || !page || data.rtState !== 'live' || data.offline === true) return false
  if (page.unconfirmedBefore != null && data.generatedAt <= page.unconfirmedBefore) return false
  return data.receivedAt != null || seeded
}

/**
 * The query's answer when it is current (isCurrentAlerts), else null: the board header then shows plain "Alerts".
 * `seed`: the page's loader answer the query started from, if any; it counts until the query's first fetch.
 */
export function useCurrentAlerts<T extends AlertsAnswer>(q: AlertsQuery<T>, seed?: T | null): T | null {
  const online = useOnline()
  const page = usePageCheck()
  if (seed) seeds.add(seed)
  const { data, isError, isFetched } = q
  const seeded = !isFetched && !!data && seeds.has(data)
  return data && isCurrentAlerts(data, { isError, online, page, seeded }) ? data : null
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
