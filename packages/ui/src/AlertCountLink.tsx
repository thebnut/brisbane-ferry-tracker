/**
 * The alert count in a board header (`@bft/ui/alert-count`, THE-118 PR 3: Alerts left BrisbaneTransit's section bar).
 * Its own entry, so only the boards that show it load it.
 */
import type { ReactNode } from 'react'
import { cx } from './cx.ts'
import { Icon } from './icons.tsx'

/**
 * "1 alert" when alerts affect the
 * place, else a quiet "Alerts", both linking to the mode's alerts page. `count` null: not known yet.
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
