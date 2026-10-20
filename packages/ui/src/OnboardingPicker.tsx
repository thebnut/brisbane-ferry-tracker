/**
 * First-visit onboarding (P4), the picker (`@bft/ui/onboarding-picker`, default export): the map stop picker in
 * multi-select mode beside a tray (a side panel at md+, a bottom sheet on phones). Each tap on a pin, a "Stops in
 * view" row or a search result puts the stop in the tray without leaving the map; the tray removes and reorders, and
 * one Save hands everything to the app, which writes each mode's own store. Always lazy (it pulls in MapLibre).
 *
 * Without WebGL the map shows "Map unavailable", and the search and "Stops in view" list still fill the tray: the
 * keyboard and screen-reader path never needs the map. A modal dialog: focus starts in it, Tab wraps, the page
 * behind is inert, Escape steps back (list, then the picker).
 */
import { type KeyboardEvent, useEffect, useId, useMemo, useReducer, useRef, useState } from 'react'
import type { PinShape, ViewBounds } from './map/MapView.tsx'
import {
  emptyTray,
  type OnboardMode,
  type TrayItem,
  type TrayState,
  trayKey,
  trayReducer,
  traySavable,
} from './onboarding.ts'
import StopPickerMap from './StopPickerMap.tsx'
import type { PickerStop } from './stop-picker.ts'

export type { TrayItem, TrayState } from './onboarding.ts'

/** One mode's stops for the picker, from the app (bus loads them by area; train and ferry ship theirs). */
export interface ModeSource {
  mode: OnboardMode
  /** The mode switch's label: "Ferry", "Train", "Bus". */
  label: string
  /** "Bus stops", "Train stations", "Ferry terminals". */
  title: string
  noun: string
  shape: PinShape
  zoom?: number
  stops: PickerStop[]
  onViewChange?: (bounds: ViewBounds, zoom: number) => void
  notice?: string | null
  /** Stops matching a name (up to a handful). */
  search: (query: string) => PickerStop[]
  /** Called on the first keystroke: bus loads its stop index then (`searching` until it has). */
  prepareSearch?: () => void
  searching?: boolean
  /** Ferry: the terminals reachable from `fromId`, for the tray's "To". */
  destinations?: (fromId: string) => { id: string; name: string }[]
}

export interface OnboardingPickerProps {
  sources: ModeSource[]
  /** The mode the picker opens on (default: the first source). */
  initialMode?: OnboardMode
  /**
   * Writes the tray through each mode's store. Throws (or returns false) when storage refuses; the tray stays so the
   * visitor can try again. After a save the app usually reloads its home, which reads the stores.
   */
  onSave: (tray: TrayState) => boolean | undefined
  onClose: () => void
}

const BTN =
  'flex min-h-11 items-center justify-center rounded-button px-3 text-sm font-bold transition active:scale-95'
const SMALL =
  'flex size-11 shrink-0 items-center justify-center rounded-full text-sched-text hover:bg-ferry-orange-light disabled:opacity-30 dark:hover:bg-night-2'

/** Tab and Shift+Tab wrap inside the dialog (as StopPickerMap's wrapTab). */
function wrapTab(e: KeyboardEvent<HTMLElement>) {
  if (e.key !== 'Tab') return
  const items = [
    ...e.currentTarget.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input, select, [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((el) => el.getClientRects().length > 0)
  const first = items[0]
  const last = items[items.length - 1]
  if (!first || !last) return
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault()
    first.focus()
  }
}

export default function OnboardingPicker({ sources, initialMode, onSave, onClose }: OnboardingPickerProps) {
  const [tray, dispatch] = useReducer(trayReducer, undefined, emptyTray)
  const [modeName, setMode] = useState<OnboardMode>(initialMode ?? sources[0]?.mode ?? 'bus')
  const source = sources.find((s) => s.mode === modeName) ?? (sources[0] as ModeSource)
  const [query, setQuery] = useState('')
  const [error, setError] = useState(false)
  const lastView = useRef<{ bounds: ViewBounds; zoom: number } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const ids = useId()

  // The page behind is inert while onboarding is open (as the picker's own modal mode).
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const made: Element[] = []
    for (let el: Element | null = root; el?.parentElement && el !== document.body; el = el.parentElement)
      for (const sib of el.parentElement.children)
        if (sib !== el && !sib.hasAttribute('inert')) {
          sib.setAttribute('inert', '')
          made.push(sib)
        }
    return () => {
      for (const sib of made) sib.removeAttribute('inert')
    }
  }, [])

  const switchTo = (mode: OnboardMode) => {
    setMode(mode)
    setQuery('')
    // The map doesn't move on a switch: tell the new mode what is in view, so bus loads its tiles for it.
    const v = lastView.current
    if (v) sources.find((s) => s.mode === mode)?.onViewChange?.(v.bounds, v.zoom)
  }
  const pickedIds = useMemo(
    () => tray.items.filter((i) => i.mode === source.mode).map((i) => i.id),
    [tray.items, source.mode],
  )
  const toItem = (s: PickerStop): TrayItem => ({
    mode: source.mode,
    id: s.id,
    name: s.name,
    detail: s.code ? `Stop ${s.code}` : s.detail,
  })
  const pick = (s: PickerStop) => dispatch({ type: 'toggle', item: toItem(s) })
  const results = query.trim() ? source.search(query).slice(0, 8) : []
  const savable = traySavable(tray)
  const byMode = (m: OnboardMode) => sources.find((s) => s.mode === m)
  const ferryMissingTo = tray.items.some((i) => i.mode === 'ferry' && !i.to)

  const save = () => {
    setError(false)
    let ok: boolean | undefined
    try {
      ok = onSave(tray)
    } catch {
      ok = false
    }
    if (ok === false) setError(true)
    else onClose()
  }

  const toolbar =
    sources.length > 1 ? (
      <fieldset className="flex shrink-0 gap-1">
        <legend className="sr-only">Mode</legend>
        {sources.map((s) => (
          <button
            key={s.mode}
            type="button"
            aria-pressed={s.mode === source.mode}
            onClick={() => switchTo(s.mode)}
            className={`min-h-11 rounded-full border px-3 text-sm font-semibold ${
              s.mode === source.mode
                ? 'border-ferry-orange bg-ferry-orange-aa text-white'
                : 'border-ferry-orange/30 bg-white text-charcoal dark:bg-night-card dark:text-night-text'
            }`}
          >
            {s.label}
          </button>
        ))}
      </fieldset>
    ) : null

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label="Set up your favourite stops"
      data-onboarding-picker=""
      onKeyDown={(e) => {
        // The map picker handles its own Escape (list, then close); this is Escape from the tray.
        if (e.key === 'Escape') onClose()
        else wrapTab(e)
      }}
      className="bg-page fixed inset-0 z-50 flex flex-col md:flex-row"
    >
      <StopPickerMap
        title={source.title}
        noun={source.noun}
        shape={source.shape}
        stops={source.stops}
        zoom={source.zoom}
        mode="multi"
        multi={{ pickedIds, onPick: pick }}
        toolbar={toolbar}
        unavailableHint={
          <span className="text-sm text-sched-text">
            Search for a {source.noun} by name, or use “{source.noun[0]?.toUpperCase()}
            {source.noun.slice(1)}s in view”.
          </span>
        }
        notice={source.notice}
        onViewChange={(bounds, zoom) => {
          lastView.current = { bounds, zoom }
          source.onViewChange?.(bounds, zoom)
        }}
        onClose={onClose}
        className="relative flex min-h-0 flex-1 flex-col"
      />
      <aside
        aria-label="Your favourite stops"
        data-onboarding-tray=""
        className="flex max-h-[48vh] shrink-0 flex-col gap-2 overflow-y-auto border-t border-ferry-orange/20 bg-white p-3 shadow-header md:max-h-none md:w-96 md:border-t-0 md:border-l dark:bg-night-card"
      >
        <label htmlFor={`${ids}-q`} className="text-sm font-semibold">
          Find a {source.noun} by name
        </label>
        <input
          id={`${ids}-q`}
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            source.prepareSearch?.()
          }}
          autoComplete="off"
          className="min-h-11 rounded-button border border-ferry-orange/30 bg-white px-3 text-base dark:bg-night-2"
        />
        {query.trim() ? (
          source.searching ? (
            <p className="text-sm text-sched-text">Loading {source.noun}s…</p>
          ) : results.length === 0 ? (
            <p className="text-sm text-sched-text">No {source.noun}s match.</p>
          ) : (
            <ul aria-label={`${source.title} matching ${query}`} className="flex flex-col">
              {results.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    aria-pressed={pickedIds.includes(s.id)}
                    onClick={() => pick(s)}
                    className="flex min-h-11 w-full items-center justify-between gap-2 rounded-button px-2.5 text-left text-sm hover:bg-ferry-orange-light aria-pressed:bg-ferry-orange-light dark:hover:bg-night-2"
                  >
                    <span className="truncate font-semibold">{s.name}</span>
                    {s.code ? <span className="shrink-0 text-xs text-sched-text">{s.code}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : null}

        <h3 className="mt-1 text-sm font-extrabold">
          Your stops{tray.items.length ? ` (${tray.items.length})` : ''}
        </h3>
        {tray.items.length === 0 ? (
          <p className="text-sm text-sched-text">Tap stops on the map or in the list to add them here.</p>
        ) : (
          <ol className="flex flex-col gap-1" data-tray-items="">
            {tray.items.map((item, i) => {
              const key = trayKey(item)
              const dests = item.mode === 'ferry' ? (byMode('ferry')?.destinations?.(item.id) ?? []) : []
              return (
                <li
                  key={key}
                  className="flex flex-col gap-1 rounded-button bg-ferry-orange-light/60 p-2 dark:bg-night-2"
                >
                  <div className="flex items-center gap-1">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">
                        {item.mode === 'ferry' ? `From ${item.name}` : item.name}
                      </p>
                      <p className="text-xs text-sched-text">
                        {byMode(item.mode)?.label ?? item.mode}
                        {item.detail ? ` · ${item.detail}` : ''}
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label={`Move ${item.name} up`}
                      disabled={i === 0}
                      onClick={() => dispatch({ type: 'move', key, by: -1 })}
                      className={SMALL}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${item.name} down`}
                      disabled={i === tray.items.length - 1}
                      onClick={() => dispatch({ type: 'move', key, by: 1 })}
                      className={SMALL}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove ${item.name}`}
                      onClick={() => dispatch({ type: 'remove', key })}
                      className={SMALL}
                    >
                      ✕
                    </button>
                  </div>
                  {item.mode === 'ferry' ? (
                    <label className="flex items-center gap-2 text-sm">
                      <span className="font-semibold">To</span>
                      <select
                        value={item.to ?? ''}
                        onChange={(e) =>
                          dispatch({
                            type: 'setTo',
                            key,
                            to: e.target.value || null,
                            toName: dests.find((d) => d.id === e.target.value)?.name,
                          })
                        }
                        className="min-h-11 min-w-0 flex-1 rounded-button border border-ferry-orange/30 bg-white px-2 dark:bg-night-card"
                      >
                        <option value="">Choose where you're going</option>
                        {dests.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </li>
              )
            })}
          </ol>
        )}
        <p role="status" aria-live="polite" className="text-sm text-sched-text">
          {error ? "Couldn't save on this device (storage is blocked or full)." : tray.said}
        </p>
        {ferryMissingTo ? (
          <p className="text-sm text-sched-text">Choose where your ferry trip goes to save it.</p>
        ) : null}
        <div className="mt-auto flex gap-2 pt-1">
          <button
            type="button"
            disabled={!savable}
            onClick={save}
            className={`${BTN} flex-1 bg-ferry-orange-aa text-white hover:bg-ferry-orange-deep disabled:opacity-50`}
          >
            {tray.items.length > 1 ? `Save ${tray.items.length} stops` : 'Save'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className={`${BTN} border-2 border-ferry-orange bg-white text-ferry-orange-deep dark:bg-night-card dark:text-ferry-sunset`}
          >
            Cancel
          </button>
        </div>
      </aside>
    </div>
  )
}
