/**
 * The one BrisbaneTransit header (THE-118 PR 2), on every page: the transit pages use it directly, and each mode
 * app's header module (`app/components/header.tsx`) resolves to a thin adapter around it (modes.config.ts), so the
 * standalone builds keep their own.
 *  - Phones: a 52 px app bar. A back link to the parent page ("‹ Train"), or the emblem on a top-level page; then the
 *    LIVE state and an icon-only gear. The page title stays in the page.
 *  - Desktop: one 60 px bar with the lockup, the five mode pills, Alerts, the LIVE state and the gear.
 * The status line (StatusLine.tsx, mode pages only) replaces the "Updated … · refresh" strip.
 */
import { cx, Icon } from '@bft/ui'
import emblem from '@bft/ui/assets/emblem-transit.svg?url'
import { lazy, Suspense, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { type ConnectionState, connectionState } from '../lib/connection.ts'
import { useOnline } from '../lib/useNow.ts'
import { activeTab, DESKTOP_TABS, parentOf } from './ModeBar.tsx'

// Loaded on first open: keeps the bottom sheet and segmented control off every page's first load.
const SettingsSheet = lazy(() => import('./SettingsSheet.tsx'))

export interface BackLink {
  href: string
  label: string
}

/** The page's live answer for the header and the status line (see connectionState). */
export interface LiveProps {
  /** Undefined: the page has no live data. */
  live?: boolean
  /** Still waiting for the page's first answer. */
  pending?: boolean
}

export function useConnection({ live, pending }: LiveProps): ConnectionState | null {
  return connectionState({ live, pending, online: useOnline() })
}

export const DOT: Record<ConnectionState, string> = {
  live: 'bg-ferry-orange-aa',
  connecting: 'bg-gray-400 motion-safe:animate-pulse',
  offline: 'bg-cancel-text',
}

function LiveState({ state }: { state: ConnectionState | null }) {
  if (state === 'live')
    return (
      <span
        data-live-claim=""
        data-connection="live"
        className="rounded-full bg-ferry-orange-aa px-3 py-1.5 text-xs font-bold text-white shadow-live motion-safe:animate-glow"
      >
        LIVE
      </span>
    )
  if (state == null) return null
  return (
    <span
      data-connection={state}
      className="flex items-center gap-1.5 rounded-full bg-sched-bg px-3 py-1.5 text-xs font-bold text-sched-text dark:bg-night-card dark:text-night-text/80"
    >
      <span aria-hidden="true" className={cx('size-2 rounded-full', DOT[state])} />
      {state === 'connecting' ? 'Connecting…' : 'OFFLINE'}
    </span>
  )
}

const PILL = 'flex h-11 items-center gap-1.5 rounded-full px-3 text-sm no-underline'

export function ModeHeader({
  back,
  onSettings,
  ...live
}: LiveProps & {
  /** The parent page for the phone's back link; by default the mode's home from any page under it. */
  back?: BackLink | null
  /** The page's own settings (the ferry board's stop selector); otherwise the transit Settings sheet. */
  onSettings?: () => void
}) {
  const { pathname } = useLocation()
  const parent = back === undefined ? parentOf(pathname) : back
  const active = activeTab(pathname)
  const state = useConnection(live)
  const [settings, setSettings] = useState<boolean | null>(null)
  return (
    <>
      <header className="bg-header sticky top-0 z-40 border-b border-ferry-orange/30 pt-[env(safe-area-inset-top)] shadow-header">
        <div className="mx-auto flex h-13 max-w-6xl items-center gap-2 px-2 md:h-15 md:px-4">
          {parent ? (
            <Link
              to={parent.href}
              className="flex min-h-11 min-w-0 items-center gap-0.5 rounded-lg pr-2 font-bold text-aqua-text no-underline md:hidden dark:text-ferry-aqua-light"
            >
              <Icon name="chevronLeft" size={22} />
              <span className="truncate">{parent.label}</span>
            </Link>
          ) : null}
          <Link
            to="/"
            aria-label="BrisbaneTransit, My Transit"
            className={cx(
              'min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-lg no-underline md:flex',
              parent ? 'hidden' : 'flex',
            )}
          >
            <img
              src={emblem}
              alt=""
              width={40}
              height={40}
              className="size-10 dark:rounded-full dark:bg-night-text dark:p-0.5"
            />
            <span
              aria-hidden="true"
              className="hidden font-wordmark text-xl font-bold text-logo-teal lg:inline dark:text-ferry-aqua-light"
            >
              Brisbane<span className="text-logo-orange dark:text-ferry-sunset">Transit</span>
            </span>
          </Link>
          <nav aria-label="Modes" className="hidden md:block">
            <ul className="flex items-center gap-1.5">
              {DESKTOP_TABS.map((i) => {
                const on = i.key === active
                return (
                  <li key={i.key}>
                    <Link
                      to={i.href}
                      prefetch="intent"
                      aria-current={on ? 'page' : undefined}
                      className={cx(
                        PILL,
                        on
                          ? 'bg-ferry-orange-aa font-bold text-white'
                          : 'border border-ferry-orange/25 bg-white font-semibold text-gray-700 dark:bg-night-card dark:text-night-text',
                      )}
                    >
                      <Icon name={i.icon} size={18} />
                      {i.label}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </nav>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <Link
              to="/alerts"
              prefetch="intent"
              aria-current={pathname === '/alerts' ? 'page' : undefined}
              aria-label="Alerts"
              className={cx(
                PILL,
                'hidden font-semibold text-ferry-orange-deep md:flex dark:text-ferry-sunset',
              )}
            >
              <Icon name="alert" size={18} />
              <span className="hidden lg:inline">Alerts</span>
            </Link>
            <LiveState state={state} />
            <button
              type="button"
              onClick={onSettings ?? (() => setSettings(true))}
              aria-label="Settings"
              className="group flex size-11 items-center justify-center rounded-full border border-ferry-orange/20 bg-white/90 text-aqua-text shadow-md transition hover:border-ferry-orange/40 dark:bg-night-card dark:text-ferry-aqua-light"
            >
              <Icon
                name="gear"
                size={20}
                className="transition-transform motion-safe:group-hover:rotate-45"
              />
            </button>
          </div>
        </div>
      </header>
      {/* Mounted from the first open on: closing the sheet (not unmounting it) gives focus back to the gear. */}
      {settings != null ? (
        <Suspense fallback={null}>
          <SettingsSheet open={settings} onClose={() => setSettings(false)} />
        </Suspense>
      ) : null}
    </>
  )
}
