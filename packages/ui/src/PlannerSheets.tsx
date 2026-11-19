/**
 * The journey planner's two sheets (@bft/ui/planner), loaded when first opened, never on a home's first load:
 *  - "Where are you going?": type to search places (terminals or stations) and landmarks, then the full list A to Z.
 *    Each landmark is its own small card ("Get off at Northshore Hamilton for Eat Street"), one result each.
 *  - "Where are you starting?": a big "Use my location" (the position stays on the phone: the app works out the
 *    nearest places from its bundled list), the closest places once known, then the full list.
 */
import { type ReactNode, useId, useState } from 'react'
import { BottomSheet } from './BottomSheet.tsx'
import { cx } from './cx.ts'
import { Icon } from './icons.tsx'

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()

/** Every query word starts a word of the name ("how sm" finds Howard Smith Wharves), as @bft/core/landmarks'. */
export function matchPlaces<T extends { name: string }>(query: string, options: readonly T[]): T[] {
  const q = norm(query)
    .trim()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
  if (q.length === 0) return []
  return options.filter((o) => {
    const words = norm(o.name).split(/[^a-z0-9]+/)
    return q.every((part) => words.some((w) => w.startsWith(part)))
  })
}

export interface PlaceOption {
  id: string
  name: string
  /** On the right: the routes ("F1 · F11"), "direct", "change at Sydney Street". */
  tag?: string | null
  /** Under the name: "650 m", a closure note. */
  detail?: string | null
}

/** A landmark result: the stop to get off at (`pick`), or, not near this mode, a link elsewhere (`href`). */
export interface PlaceResult {
  key: string
  name: string
  /** "Get off at Northshore Hamilton for Eat Street · about 7 min walk". */
  text: string
  /** The place it resolves to (a terminal or station id). */
  pick?: string
  /** Shown under the chosen place: "for Eat Street". */
  hint?: string
  href?: string
  /** The link's words ("Train times"). */
  linkText?: string
}

type RenderLink = (props: { href: string; className: string; children: ReactNode }) => ReactNode

const HEADING =
  'px-1 text-[13px] font-bold tracking-[0.06em] text-aqua-text uppercase dark:text-ferry-aqua-light'
const ROW =
  'flex min-h-12 w-full items-center justify-between gap-3 border-b border-gray-200 px-1 py-2 text-left focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-aqua-text dark:border-night-2'

function OptionList({
  label,
  options,
  selected,
  onPick,
}: {
  label: string
  options: readonly PlaceOption[]
  selected?: string | null
  onPick: (id: string) => void
}) {
  return (
    <ul aria-label={label} className="flex flex-col">
      {options.map((o) => (
        <li key={o.id}>
          <button
            type="button"
            onClick={() => onPick(o.id)}
            aria-current={selected === o.id || undefined}
            data-place-option={o.id}
            className={ROW}
          >
            <span className="flex min-w-0 flex-col">
              <span
                className={cx(
                  'text-base font-semibold',
                  selected === o.id ? 'text-ferry-orange-deep dark:text-ferry-sunset' : '',
                )}
              >
                {o.name}
              </span>
              {o.detail ? (
                <span className="text-[13px] text-sched-text dark:text-night-text/70">{o.detail}</span>
              ) : null}
            </span>
            {o.tag ? (
              <span className="shrink-0 text-right text-[13px] font-bold text-aqua-text dark:text-ferry-aqua-light">
                {o.tag}
              </span>
            ) : null}
          </button>
        </li>
      ))}
    </ul>
  )
}

/** One landmark result as its own card (room for a sponsored card beside it later; none now). */
function ResultCard({
  result,
  onPick,
  renderLink,
}: {
  result: PlaceResult
  onPick: (id: string, from: PlaceResult) => void
  renderLink?: RenderLink
}) {
  const className =
    'flex w-full items-center gap-3 rounded-card border border-ferry-orange/15 bg-white px-3.5 py-3 text-left text-inherit no-underline shadow-card focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-aqua-text dark:bg-night-2'
  const body = (
    <>
      <Icon name="pin" size={20} className="shrink-0 text-ferry-orange-deep dark:text-ferry-sunset" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-base font-bold">{result.name}</span>
        <span className="text-[13px] text-sched-text dark:text-night-text/80">{result.text}</span>
        {result.href && result.linkText ? (
          <span className="text-[13px] font-bold text-aqua-text dark:text-ferry-aqua-light">
            {result.linkText} ›
          </span>
        ) : null}
      </span>
    </>
  )
  const pick = result.pick
  return (
    <li data-landmark={result.key}>
      {pick ? (
        <button type="button" onClick={() => onPick(pick, result)} className={className}>
          {body}
        </button>
      ) : result.href ? (
        renderLink ? (
          renderLink({ href: result.href, className, children: body })
        ) : (
          <a href={result.href} className={className}>
            {body}
          </a>
        )
      ) : (
        <div className={className}>{body}</div>
      )}
    </li>
  )
}

export function DestinationPicker({
  open,
  onClose,
  what,
  options,
  selected,
  results,
  onPick,
  renderLink,
}: {
  open: boolean
  onClose: () => void
  /** "terminals", "stations". */
  what: string
  /** Every place, A to Z. */
  options: readonly PlaceOption[]
  selected?: string | null
  /** The landmarks matching a query. */
  results?: (query: string) => PlaceResult[]
  /** A place, and the landmark result it came from. */
  onPick: (id: string, from?: PlaceResult) => void
  renderLink?: RenderLink
}) {
  const [query, setQuery] = useState('')
  const inputId = useId()
  const typed = query.trim().length > 0
  const matches = matchPlaces(query, options)
  const places = typed && results ? results(query) : []
  return (
    <BottomSheet open={open} onClose={onClose} title="Where are you going?">
      <div className="flex flex-col gap-4 px-4 pt-2 pb-5">
        <div className="flex flex-col gap-1">
          <label htmlFor={inputId} className="text-sm font-semibold text-gray-700 dark:text-night-text/80">
            Search {what} and places
          </label>
          <span className="relative">
            <Icon
              name="search"
              size={18}
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ferry-orange"
            />
            <input
              id={inputId}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`A ${what.replace(/s$/, '')} or place, e.g. Eat Street`}
              autoComplete="off"
              className="h-12 w-full rounded-card border-2 border-ferry-orange/40 bg-white pr-3 pl-10 text-base font-semibold text-charcoal placeholder:font-normal placeholder:text-gray-500 focus:border-ferry-orange dark:bg-night-2 dark:text-night-text"
            />
          </span>
        </div>
        {typed ? (
          <div className="flex flex-col gap-3" aria-live="polite">
            {matches.length ? (
              <section className="flex flex-col gap-1">
                <h3 className={HEADING}>Matches</h3>
                <OptionList
                  label={`Matching ${what}`}
                  options={matches}
                  selected={selected}
                  onPick={onPick}
                />
              </section>
            ) : null}
            {places.length ? (
              <section className="flex flex-col gap-2">
                <h3 className={HEADING}>Places</h3>
                <ul aria-label="Matching places" className="flex flex-col gap-2">
                  {places.map((r) => (
                    <ResultCard key={r.key} result={r} onPick={onPick} renderLink={renderLink} />
                  ))}
                </ul>
              </section>
            ) : null}
            {!matches.length && !places.length ? (
              <p className="px-1 text-sm text-sched-text dark:text-night-text/80">
                Nothing matches “{query.trim()}”. Try another name, or pick from the list.
              </p>
            ) : null}
          </div>
        ) : null}
        <section className="flex flex-col gap-1">
          <h3 className={HEADING}>All {what} A–Z</h3>
          <OptionList label={`All ${what}`} options={options} selected={selected} onPick={onPick} />
        </section>
      </div>
    </BottomSheet>
  )
}

export function StartPicker({
  open,
  onClose,
  goingTo,
  what,
  locate,
  closest,
  options,
  selected,
  onPick,
}: {
  open: boolean
  onClose: () => void
  /** The destination's name, when set: "Going to Howard Smith Wharves". */
  goingTo: string | null
  /** "terminal", "station". */
  what: string
  locate: { state: 'idle' | 'locating' | 'denied' | 'unavailable' | 'ok'; onLocate: () => void }
  /** The closest places, once the position is known. */
  closest: readonly PlaceOption[] | null
  options: readonly PlaceOption[]
  selected?: string | null
  onPick: (id: string) => void
}) {
  const off = locate.state === 'denied' || locate.state === 'unavailable'
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Where are you starting?"
      subtitle={
        goingTo ? (
          <span className="text-sm text-sched-text dark:text-night-text/80">
            Going to <strong className="text-ferry-orange-deep dark:text-ferry-sunset">{goingTo}</strong>
          </span>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4 px-4 pt-2 pb-5">
        {closest?.length ? null : (
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={locate.onLocate}
              disabled={locate.state === 'locating'}
              className="flex min-h-13 items-center justify-center gap-2 rounded-full bg-ferry-orange-aa px-5 text-base font-bold text-white focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-aqua-text disabled:opacity-70"
            >
              <Icon name="locate" size={20} />
              {locate.state === 'locating' ? 'Locating…' : 'Use my location'}
            </button>
            <p className="text-center text-[13px] text-sched-text dark:text-night-text/80" role="status">
              {off
                ? `Location is off. Pick a ${what} below, or allow location and try again.`
                : `Finds the closest ${what}. Your location stays on your phone.`}
            </p>
          </div>
        )}
        {closest?.length ? (
          <section className="flex flex-col gap-1">
            <h3 className={HEADING}>Closest to you</h3>
            <OptionList label={`Closest ${what}s`} options={closest} selected={selected} onPick={onPick} />
          </section>
        ) : null}
        <section className="flex flex-col gap-1">
          <h3 className={HEADING}>{closest?.length ? `Or pick a ${what}` : `All ${what}s A–Z`}</h3>
          <OptionList label={`All ${what}s`} options={options} selected={selected} onPick={onPick} />
        </section>
      </div>
    </BottomSheet>
  )
}
