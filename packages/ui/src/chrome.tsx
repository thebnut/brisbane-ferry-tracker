/** App chrome: header lockup, header pills, status strip, filter pills, bottom navigation and mode tabs. */
import type { ReactNode } from 'react'
import { cx } from './cx.ts'
import { Icon, type IconName } from './icons.tsx'

export type BrandMode = 'ferry' | 'train' | 'bus' | 'transit'

const WORDMARK: Record<BrandMode, string> = {
  ferry: 'BrisbaneFerry',
  train: 'BrisbaneTrain',
  bus: 'BrisbaneBus',
  transit: 'BrisbaneTransit',
}

export interface AppHeaderProps {
  mode: BrandMode
  /** Ferry: the real lockup image (489×199). Other modes: the square emblem SVG. */
  logoSrc: string
  /** Responsive sources for the ferry lockup (e.g. WebP at 1x/2x); it is the page's LCP element on phones. */
  logoSrcSet?: string
  /** Link target for the lockup. */
  homeHref?: string
  children?: ReactNode
  className?: string
}

/**
 * Header bar in the ferry look. Ferry shows its real lockup image; train, bus and transit build the lockup from the
 * emblem plus a two-line Poppins wordmark ("Brisbane___" teal over "Departure Boards" orange).
 */
export function AppHeader({
  mode,
  logoSrc,
  logoSrcSet,
  homeHref = '/',
  children,
  className,
}: AppHeaderProps) {
  const label = `${WORDMARK[mode]} Departure Boards`
  return (
    <header
      className={cx(
        'bg-header sticky top-0 z-40 border-b-2 border-ferry-orange/50 shadow-header',
        'pt-[env(safe-area-inset-top)]',
        className,
      )}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-2 py-1 md:px-4">
        <a
          href={homeHref}
          className="flex shrink-0 items-center gap-1 rounded-lg"
          aria-label={`${label}, home`}
        >
          {mode === 'ferry' ? (
            <img
              src={logoSrc}
              srcSet={logoSrcSet}
              sizes={logoSrcSet ? '(min-width: 768px) 276px, 158px' : undefined}
              alt={label}
              width={489}
              height={199}
              fetchPriority="high"
              className="h-16 w-auto max-w-[180px] md:h-28 md:max-w-none"
            />
          ) : (
            <>
              <img src={logoSrc} alt="" width={56} height={56} className="size-14 md:size-24" />
              <span className="flex flex-col font-wordmark leading-[1.08]" aria-hidden="true">
                <span className="text-xl font-bold text-logo-teal md:text-3xl">{WORDMARK[mode]}</span>
                <span className="text-base font-semibold text-logo-orange md:text-2xl">Departure Boards</span>
              </span>
            </>
          )}
        </a>
        <div className="flex items-center gap-2">{children}</div>
      </div>
    </header>
  )
}

export interface SettingsPillProps {
  onClick: () => void
  /** Hide the text label on narrow layouts (icon-only, still labelled). */
  compact?: boolean
}

export function SettingsPill({ onClick, compact = false }: SettingsPillProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Settings"
      className={cx(
        'group flex h-11 items-center gap-2 rounded-full border border-ferry-orange/20 bg-white/90 text-sm font-semibold text-aqua-text shadow-md',
        'transition hover:border-ferry-orange/40 hover:shadow-lg dark:bg-night-card dark:text-ferry-aqua-light',
        compact ? 'w-11 justify-center' : 'pr-3 pl-4',
      )}
    >
      {compact ? null : <span>Settings</span>}
      <Icon name="gear" size={20} className="transition-transform group-hover:rotate-45" />
    </button>
  )
}

export interface LivePillProps {
  /** false shows the muted "OFFLINE" state instead of the glowing LIVE pill. */
  live?: boolean
}

export function LivePill({ live = true }: LivePillProps) {
  return live ? (
    <span className="rounded-full bg-ferry-orange-aa px-3 py-1.5 text-xs font-bold text-white shadow-live motion-safe:animate-glow">
      LIVE
    </span>
  ) : (
    <span className="rounded-full bg-sched-bg px-3 py-1.5 text-xs font-bold text-sched-text">OFFLINE</span>
  )
}

export interface StatusStripProps {
  /** e.g. "Last updated 2:41 pm". */
  updated: ReactNode
  /** e.g. "updated 12 s ago". */
  detail?: ReactNode
  children?: ReactNode
}

export function StatusStrip({ updated, detail, children }: StatusStripProps) {
  return (
    <div className="bg-strip border-b border-ferry-orange/20">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-3 py-2 md:px-4">
        <p
          className="flex items-center gap-1.5 text-sm text-charcoal tabular dark:text-night-text"
          aria-live="polite"
        >
          <Icon name="clock" size={16} className="text-ferry-orange" />
          <span>{updated}</span>
          {detail ? (
            <span className="text-xs text-sched-text dark:text-night-text/70">· {detail}</span>
          ) : null}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">{children}</div>
      </div>
    </div>
  )
}

export interface PillButtonProps {
  children: ReactNode
  onClick?: () => void
  pressed?: boolean
  icon?: IconName
  label?: string
  disabled?: boolean
}

/** Small pill in the status strip (Map, Refresh). */
export function PillButton({ children, onClick, pressed, icon, label, disabled }: PillButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      aria-label={label}
      disabled={disabled}
      className={cx(
        'flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition disabled:opacity-60 md:text-sm',
        pressed
          ? 'bg-ferry-orange-aa text-white'
          : 'border border-ferry-orange/20 bg-white text-aqua-text hover:border-ferry-orange/50 dark:bg-night-card dark:text-ferry-aqua-light',
      )}
    >
      {icon ? <Icon name={icon} size={16} /> : null}
      {children}
    </button>
  )
}

export interface FilterOption<T extends string> {
  value: T
  label: string
}

export interface FilterPillsProps<T extends string> {
  options: FilterOption<T>[]
  value: T
  onChange: (value: T) => void
  label: string
}

/** Segmented service filter (All / Express). */
export function FilterPills<T extends string>({ options, value, onChange, label }: FilterPillsProps<T>) {
  return (
    <fieldset className="flex gap-1.5">
      <legend className="sr-only">{label}</legend>
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={cx(
              'h-9 rounded-full px-3 text-xs md:text-sm',
              active
                ? 'bg-ferry-orange-aa font-bold text-white'
                : 'border border-ferry-orange/30 bg-white font-semibold text-ferry-orange-deep dark:bg-night-card dark:text-ferry-sunset',
            )}
          >
            {o.label}
          </button>
        )
      })}
    </fieldset>
  )
}

export interface NavItem {
  key: string
  label: string
  icon: IconName
  href: string
}

export interface BottomNavProps {
  items: NavItem[]
  active: string
  label?: string
  /** Render links with the app's router (e.g. React Router's Link). Defaults to <a>. */
  renderLink?: (item: NavItem, className: string, children: ReactNode) => ReactNode
}

/** One-handed bottom navigation; also the Mode Tabs shell (Ferry | Train | Bus | Nearby | Saved). */
export function BottomNav({ items, active, label = 'Main', renderLink }: BottomNavProps) {
  return (
    <nav
      aria-label={label}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-ferry-orange/20 bg-white/95 pb-[max(env(safe-area-inset-bottom),6px)] backdrop-blur dark:bg-night-2/95"
    >
      <ul
        className="mx-auto grid max-w-xl px-1.5 pt-1.5"
        style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0,1fr))` }}
      >
        {items.map((item) => {
          const on = item.key === active
          const className = cx(
            'flex min-h-13 flex-col items-center justify-center gap-0.5 text-[11px]',
            on
              ? 'font-bold text-ferry-orange-deep dark:text-ferry-sunset'
              : 'font-medium text-sched-text dark:text-night-text/70',
          )
          const children = (
            <>
              <span
                className={cx(
                  'flex h-7.5 w-12 items-center justify-center rounded-full',
                  on && 'bg-ferry-orange-light dark:bg-night-card',
                )}
              >
                <Icon name={item.icon} size={22} />
              </span>
              {item.label}
            </>
          )
          return (
            <li key={item.key}>
              {renderLink ? (
                renderLink(item, className, children)
              ) : (
                <a href={item.href} className={className} aria-current={on ? 'page' : undefined}>
                  {children}
                </a>
              )}
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

export const MODE_TABS: NavItem[] = [
  { key: 'ferry', label: 'Ferry', icon: 'ferry', href: '/ferry' },
  { key: 'train', label: 'Train', icon: 'train', href: '/train' },
  { key: 'bus', label: 'Bus', icon: 'bus', href: '/bus' },
  { key: 'nearby', label: 'Nearby', icon: 'nearby', href: '/nearby' },
  { key: 'saved', label: 'Saved', icon: 'saved', href: '/saved' },
]

/** The transit app's Mode Tabs shell: BottomNav preset with the five mode tabs. */
export function ModeTabs({
  items = MODE_TABS,
  ...rest
}: Omit<BottomNavProps, 'items' | 'label'> & { items?: NavItem[] }) {
  return <BottomNav label="Modes" items={items} {...rest} />
}
