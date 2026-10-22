/**
 * The status line (THE-118 PR 2): the "Updated … · refresh" strip of the mode pages becomes one quiet line above the
 * rows, with the header's connection state. Its own module: the transit pages (My Transit, Nearby, Alerts) keep their
 * strip, so it stays off their first load.
 */
import { cx, Icon } from '@bft/ui'
import type { ReactNode } from 'react'
import { DOT, type LiveProps, useConnection } from './ModeHeader.tsx'

/**
 * "● Live · updated 12 s ago" above the rows; tapping it refreshes the page's live data. The page's own controls
 * (filters, Map) sit on its right until THE-118 PR 3 and 5 move them.
 */
export function StatusLine({
  detail,
  onRefresh,
  refreshing,
  children,
  ...live
}: LiveProps & {
  /** "updated 12 s ago" (formatAge). */
  detail?: string | null
  /** Without it (a page with nothing to refresh) the line is plain text. */
  onRefresh?: () => void
  refreshing?: boolean
  children?: ReactNode
}) {
  const state = useConnection(live)
  const words =
    state === 'connecting'
      ? 'Connecting…'
      : [state === 'live' ? 'Live' : state && 'Offline', detail].filter(Boolean).join(' · ')
  if (!words && !children) return null
  const Line = onRefresh ? 'button' : 'p'
  return (
    <div data-status-strip="" className="border-b border-ferry-orange/15">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-2 px-3 md:px-4">
        <Line
          type={onRefresh ? 'button' : undefined}
          onClick={() => refreshing || onRefresh?.()}
          aria-busy={onRefresh ? refreshing : undefined}
          data-live-claim={state === 'live' ? '' : undefined}
          data-status-line=""
          className="flex min-h-11 items-center gap-1.5 rounded-lg pr-1 text-sm text-sched-text tabular dark:text-night-text/80"
        >
          {state ? <span aria-hidden="true" className={cx('size-2 rounded-full', DOT[state])} /> : null}
          {words}
          {onRefresh ? (
            <>
              <span className="sr-only">. Refresh</span>
              <Icon
                name="refresh"
                size={14}
                className={cx(
                  'text-aqua-text dark:text-ferry-aqua-light',
                  refreshing && 'motion-safe:animate-spin',
                )}
              />
            </>
          ) : null}
        </Line>
        {children ? <div className="flex flex-wrap items-center gap-1.5 py-1.5">{children}</div> : null}
      </div>
    </div>
  )
}
