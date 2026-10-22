/**
 * The one star for saving a place to My Transit (THE-118 PR 1, absorbs THE-116), on every mode's board header and
 * trip dock. Its own small module so a page carries it without the bus elements, and the toast stays in
 * SaveToast.tsx, which a page can load on the first tap.
 */
import { cx } from './cx.ts'
import { Icon } from './icons.tsx'

export interface StarButtonProps {
  saved: boolean
  onToggle: () => void
  /** The place, for the accessible name: "Save Central to My Transit". */
  name: string
  /** Labelled (default): a 44 px pill with "Save" / "Saved". Icon: 44 px, only in dense lists. */
  variant?: 'labelled' | 'icon'
  disabled?: boolean
  className?: string
}

/** Save / Saved toggle (`aria-pressed`). The name stays the same either way; the pressed state says which. */
export function StarButton({
  saved,
  onToggle,
  name,
  variant = 'labelled',
  disabled,
  className,
}: StarButtonProps) {
  const label = `${name} to My Transit`
  const icon = variant === 'icon'
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={saved}
      // Icon-only has no visible words; the labelled one's visible "Save"/"Saved" starts its name (label in name).
      aria-label={icon ? `Save ${label}` : undefined}
      disabled={disabled}
      data-star=""
      className={cx(
        'flex min-h-11 shrink-0 items-center justify-center rounded-full border-2 transition active:scale-95 disabled:opacity-60 motion-reduce:transition-none motion-reduce:active:scale-100',
        icon ? 'size-11' : 'gap-1.5 pr-4 pl-3 text-sm font-bold',
        saved
          ? 'border-ferry-orange-light bg-ferry-orange-light text-ferry-orange-deep dark:border-ferry-sunset/40 dark:bg-ferry-sunset/20 dark:text-ferry-sunset'
          : 'border-ferry-orange bg-white text-ferry-orange-deep dark:bg-night-card dark:text-ferry-sunset',
        className,
      )}
    >
      <Icon name="star" size={22} fill={saved ? 'currentColor' : 'none'} />
      {icon ? null : (
        <span>
          {saved ? 'Saved' : 'Save'} <span className="sr-only">{label}</span>
        </span>
      )}
    </button>
  )
}
