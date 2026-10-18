/** Alerts, line status, empty/error states and the offline banner. */
import type { ReactNode } from 'react'
import { SecondaryButton } from './board.tsx'
import { cx } from './cx.ts'
import { Icon } from './icons.tsx'

export interface AlertCardProps {
  title: string
  children?: ReactNode
  severity?: 'info' | 'warning' | 'severe'
  meta?: ReactNode
}

export function AlertCard({ title, children, severity = 'warning', meta }: AlertCardProps) {
  return (
    <article
      className={cx(
        'rounded-card border-l-4 bg-white/90 p-4 shadow-card dark:bg-night-card',
        severity === 'severe'
          ? 'border-cancel-text'
          : severity === 'warning'
            ? 'border-ferry-orange'
            : 'border-aqua-text',
      )}
    >
      <h3 className="flex items-center gap-2 text-sm font-bold">
        <Icon
          name="alert"
          size={18}
          className={severity === 'info' ? 'text-aqua-text' : 'text-ferry-orange-dark'}
        />
        {title}
      </h3>
      {children ? (
        <div className="mt-1.5 text-sm text-gray-700 dark:text-night-text/80">{children}</div>
      ) : null}
      {meta ? <p className="mt-2 text-xs text-sched-text">{meta}</p> : null}
    </article>
  )
}

export type LineHealth = 'good' | 'minor' | 'major'

export interface LineStatusProps {
  lines: Array<{ id: string; name: string; color?: string; status: LineHealth; detail?: string }>
}

const HEALTH: Record<LineHealth, { text: string; className: string }> = {
  good: { text: 'Good service', className: 'text-chip-later-text' },
  minor: { text: 'Minor delays', className: 'text-ferry-orange-deep' },
  major: { text: 'Disruption', className: 'text-cancel-text' },
}

/** Line-status board (train alerts). */
export function LineStatus({ lines }: LineStatusProps) {
  return (
    <ul className="divide-y divide-ferry-orange/10 overflow-hidden rounded-card bg-white/90 shadow-card dark:bg-night-card">
      {lines.map((l) => (
        <li key={l.id} className="flex items-center gap-3 px-4 py-3">
          <span
            aria-hidden="true"
            className="h-8 w-1.5 rounded-full"
            style={{ background: l.color ? `#${l.color}` : 'var(--color-ferry-aqua)' }}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{l.name}</span>
            {l.detail ? <span className="block truncate text-xs text-sched-text">{l.detail}</span> : null}
          </span>
          <span className={cx('text-xs font-bold', HEALTH[l.status].className)}>{HEALTH[l.status].text}</span>
        </li>
      ))}
    </ul>
  )
}

export interface EmptyStateProps {
  title: string
  children?: ReactNode
}

export function EmptyState({ title, children }: EmptyStateProps) {
  return (
    <div
      className="rounded-card bg-white/90 px-4 py-8 text-center shadow-card dark:bg-night-card"
      role="status"
    >
      <p className="font-semibold text-gray-700 dark:text-night-text">{title}</p>
      {children ? <div className="mt-2 text-sm text-sched-text">{children}</div> : null}
    </div>
  )
}

export interface ErrorStateProps {
  title?: string
  children?: ReactNode
  onRetry?: () => void
}

export function ErrorState({ title = "Couldn't load live times", children, onRetry }: ErrorStateProps) {
  return (
    <div
      className="rounded-card border border-cancel-text/20 bg-white/90 p-4 shadow-card dark:bg-night-card"
      role="alert"
    >
      <p className="flex items-center gap-2 font-semibold text-cancel-text">
        <Icon name="alert" size={18} />
        {title}
      </p>
      {children ? (
        <div className="mt-1.5 text-sm text-gray-700 dark:text-night-text/80">{children}</div>
      ) : null}
      {onRetry ? (
        <SecondaryButton className="mt-3 min-h-10 px-4 text-sm" onClick={onRetry}>
          Try again
        </SecondaryButton>
      ) : null}
    </div>
  )
}

export type OfflineKind = 'offline' | 'unavailable' | 'stale' | 'reloading'

const OFFLINE_TEXT: Record<OfflineKind, { title: string; body: string }> = {
  offline: { title: 'Offline · scheduled', body: 'You are offline. Showing saved timetable times.' },
  unavailable: { title: 'Live times unavailable', body: 'Showing scheduled times until live data returns.' },
  stale: { title: 'Live times delayed', body: 'Live data is more than 5 minutes old.' },
  reloading: { title: 'Timetable updating', body: 'Showing scheduled times while the new timetable loads.' },
}

export interface OfflineBannerProps {
  kind: OfflineKind
  detail?: ReactNode
}

export function OfflineBanner({ kind, detail }: OfflineBannerProps) {
  const t = OFFLINE_TEXT[kind]
  return (
    <div
      role="status"
      data-banner={kind}
      className="flex items-start gap-2.5 rounded-card border border-ferry-orange/30 bg-ferry-orange-light/70 px-3.5 py-2.5 text-sm text-charcoal dark:bg-night-card dark:text-night-text"
    >
      <Icon
        name={kind === 'offline' ? 'offline' : 'alert'}
        size={18}
        className="mt-0.5 shrink-0 text-ferry-orange-dark"
      />
      <p>
        <strong className="font-bold">{t.title}</strong>
        <span className="block text-xs text-gray-700 dark:text-night-text/80">{detail ?? t.body}</span>
      </p>
    </div>
  )
}
