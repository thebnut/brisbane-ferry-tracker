/**
 * My Transit's saved list once it can be changed (THE-114, THE-115), loaded after hydration so none of it is on the
 * page's first load: the "Edit order and names" editor (its own chunk, on the first tap), and deleting a saved item.
 *  - Touch: swipe a card left to show its Delete action, then tap it; a long swipe deletes straight away. Only a
 *    sideways move swipes (the axis is decided after a few px, and the row allows vertical panning), so the page still
 *    scrolls and a tap still opens the stop. The drag handle in the editor is a separate control.
 *  - Keyboard and screen readers: each card is followed by its Delete button, shown when it has focus; the editor
 *    has one per row too (the way to delete with a mouse).
 * A delete is written at once (saved-delete.ts) and an Undo toast offers it back for a few seconds, paused while
 * pointed at or focused. Focus moves to the next item (or the empty list) after a delete, and back to the item on Undo.
 */

import {
  createContext,
  type PointerEvent,
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import type { SavedItem } from '../lib/saved.ts'
import { type Removal, removeSaved, restoreSaved } from '../lib/saved-delete.ts'
import type { PrefsStore } from '../lib/saved-prefs-save.ts'
import type { SavedEditor } from './SavedEditor.tsx'

/** How far a card moves to show its Delete action (px): the action's width plus a gap. */
const REVEAL = 104
/** A swipe past this share of the card's width deletes without the tap. */
const FLING = 0.6
/** Movement before a gesture counts as a swipe or a scroll (px). */
const SLOP = 8
/** How long the Undo toast stays (ms), counted again after the pointer or focus leaves it. */
const TOAST_MS = 7000
/** Space between the toast and the bottom navigation (px). */
const GAP = 12

const nameOf = (item: SavedItem) => item.label || item.title
const rowSel = (id: string) => `[data-saved-row="${CSS.escape(id)}"] a`
const editSel = (id: string) => `[data-saved-edit-row="${CSS.escape(id)}"] [data-saved-delete]`

const Rows = createContext<{
  open: string | null
  setOpen: (id: string | null) => void
  remove: (item: SavedItem, focus: boolean) => void
} | null>(null)

/** One saved card that swipes left to show its Delete action. */
export function SwipeRow({ item, children }: { item: SavedItem; children: ReactNode }) {
  const ctx = useContext(Rows)
  const [drag, setDrag] = useState<number | null>(null)
  const [focused, setFocused] = useState(false)
  /** The finger down on the card; `x` is where the card is now (the state can lag behind the last move). */
  const gesture = useRef<{
    id: number
    x0: number
    y0: number
    base: number
    axis: 'x' | 'y' | null
    x: number
  } | null>(null)
  /** The last gesture was a swipe, so the click that may follow it doesn't open the stop. */
  const swiped = useRef(false)
  const row = useRef<HTMLDivElement>(null)
  if (!ctx) return children
  const open = ctx.open === item.id
  const x = drag ?? (open || focused ? -REVEAL : 0)
  const name = nameOf(item)

  const down = (e: PointerEvent<HTMLDivElement>) => {
    swiped.current = false
    if (e.pointerType === 'mouse' || gesture.current) return
    if (ctx.open && !open) ctx.setOpen(null)
    const base = open ? -REVEAL : 0
    gesture.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, base, axis: null, x: base }
  }
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current
    if (!g || e.pointerId !== g.id) return
    const dx = e.clientX - g.x0
    const dy = e.clientY - g.y0
    if (!g.axis) {
      if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return
      g.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
      // A scroll: the page has it.
      if (g.axis === 'y') {
        gesture.current = null
        return
      }
      e.currentTarget.setPointerCapture(e.pointerId)
      swiped.current = true
    }
    g.x = Math.min(0, g.base + dx)
    setDrag(g.x)
  }
  const up = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current
    if (!g || e.pointerId !== g.id) return
    gesture.current = null
    if (g.axis !== 'x') return
    setDrag(null)
    if (e.type === 'pointercancel') return
    const width = row.current?.offsetWidth ?? 0
    if (g.x < -width * FLING) ctx.remove(item, false)
    else ctx.setOpen(g.x < -REVEAL / 2 ? item.id : null)
  }

  return (
    <div ref={row} data-saved-row={item.id} data-open={open ? '' : undefined} className="relative">
      <div
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onClickCapture={(e) => {
          // After a swipe, or on an open card (a tap closes it), the card's link stays put.
          if (!swiped.current && !open) return
          e.preventDefault()
          e.stopPropagation()
          swiped.current = false
          if (open) ctx.setOpen(null)
        }}
        style={{ transform: x ? `translateX(${x}px)` : undefined, touchAction: 'pan-y pinch-zoom' }}
        className={`relative z-[1] flex flex-col ${drag == null ? 'motion-safe:transition-transform motion-safe:duration-200' : ''}`}
      >
        {children}
      </div>
      <button
        type="button"
        aria-label={`Delete ${name}`}
        data-saved-delete=""
        onClick={(e) => ctx.remove(item, document.activeElement === e.currentTarget)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className={`absolute inset-y-0 right-0 flex w-24 items-center justify-center rounded-card bg-cancel-text text-sm font-bold text-white dark:bg-red-700 ${x === 0 ? 'opacity-0' : ''}`}
      >
        Delete
      </button>
    </div>
  )
}

/** Where the toast sits: above the highest fixed bottom bar (the Mode Tabs), as the onboarding prompt does. */
function liftAboveDocks(): number {
  let top = innerHeight
  for (const d of document.querySelectorAll('[data-bft-dock]')) {
    const r = d.getBoundingClientRect()
    if (r.height > 0 && r.top < top && getComputedStyle(d).position === 'fixed') top = r.top
  }
  return Math.ceil(innerHeight - top) + GAP
}

function UndoToast({
  removal,
  onUndo,
  onGone,
}: {
  removal: Removal | null
  onUndo: () => void
  onGone: () => void
}) {
  const [held, setHeld] = useState({ pointer: false, focus: false })
  const [bottom, setBottom] = useState(GAP)
  useLayoutEffect(() => {
    if (removal) setBottom(liftAboveDocks())
  }, [removal])
  const paused = held.pointer || held.focus
  useEffect(() => {
    if (!removal || paused) return
    const t = setTimeout(onGone, TOAST_MS)
    return () => clearTimeout(t)
  }, [removal, paused, onGone])
  // Always in the page, so the first message is announced too.
  return (
    <div
      role="status"
      aria-live="polite"
      data-saved-toast=""
      // Pointed at or focused, it stays (the bar inside takes the pointer; this box lets it through elsewhere).
      onPointerEnter={() => setHeld((h) => ({ ...h, pointer: true }))}
      onPointerLeave={() => setHeld((h) => ({ ...h, pointer: false }))}
      onFocus={() => setHeld((h) => ({ ...h, focus: true }))}
      onBlur={() => setHeld((h) => ({ ...h, focus: false }))}
      style={{ bottom }}
      className="pointer-events-none fixed inset-x-3 z-40 mx-auto flex max-w-md justify-center"
    >
      {removal ? (
        <div className="pointer-events-auto flex w-full items-center gap-3 rounded-card bg-charcoal py-1.5 pr-1.5 pl-4 text-sm text-white shadow-header dark:border dark:border-night-text/20 dark:bg-night-2 dark:text-night-text">
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold">Removed {nameOf(removal.item)}</span>
            {removal.kept ? null : (
              <span className="block text-xs">
                This device isn't keeping changes, so it's back after a reload.
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={onUndo}
            className="flex min-h-11 shrink-0 items-center rounded-button px-4 font-bold text-ferry-sunset hover:bg-white/10"
          >
            Undo
          </button>
        </div>
      ) : null}
    </div>
  )
}

/**
 * The saved list (`list`, its cards wrapped in SwipeRow) with the Edit button, the editor in its place while open, or
 * `empty` when nothing is saved; and the Undo toast.
 */
export function SavedArea({
  items,
  onItems,
  store,
  list,
  empty,
}: {
  items: SavedItem[]
  onItems: (next: SavedItem[]) => void
  store: PrefsStore
  list: ReactNode
  empty: ReactNode
}) {
  const [open, setOpen] = useState<string | null>(null)
  const [toast, setToast] = useState<{ removal: Removal; at: number } | null>(null)
  const [Editor, setEditor] = useState<typeof SavedEditor | null>(null)
  const [editing, setEditing] = useState(false)
  /** What gets focus once the next render is in the page. */
  const focusNext = useRef<string | null>(null)
  useLayoutEffect(() => {
    const sel = focusNext.current
    if (!sel) return
    focusNext.current = null
    document.querySelector<HTMLElement>(sel)?.focus()
  })
  const [gone] = useState(() => () => setToast(null))

  const remove = (item: SavedItem, focus: boolean) => {
    const at = items.findIndex((i) => i.id === item.id)
    if (at < 0) return
    const removal = removeSaved(item, store)
    const next = items.filter((i) => i.id !== item.id)
    onItems(next)
    setOpen(null)
    // A second delete replaces the toast; the first stays done.
    setToast({ removal, at })
    if (next.length === 0) setEditing(false)
    if (focus) {
      const to = next[at] ?? next[at - 1]
      focusNext.current = to ? (editing ? editSel(to.id) : rowSel(to.id)) : '[data-saved-empty]'
    }
  }
  const undo = () => {
    if (!toast) return
    const { removal, at } = toast
    restoreSaved(removal, store)
    const rest = items.filter((i) => i.id !== removal.item.id)
    onItems([...rest.slice(0, at), removal.item, ...rest.slice(at)])
    setToast(null)
    focusNext.current = editing ? editSel(removal.item.id) : rowSel(removal.item.id)
  }
  const edit = () =>
    void import('./SavedEditor.tsx').then((m) => {
      setEditor(() => m.SavedEditor)
      setEditing(true)
    })

  return (
    <>
      {items.length && editing && Editor ? (
        <Editor
          items={items}
          onChange={onItems}
          store={store}
          onDelete={(item, focus) => remove(item, focus)}
          onDone={() => {
            // Closing the editor gives focus back to the button that opened it.
            focusNext.current = '[data-saved-edit]'
            setEditing(false)
          }}
        />
      ) : items.length ? (
        <Rows.Provider value={{ open, setOpen, remove }}>
          {list}
          <button
            type="button"
            onClick={edit}
            data-saved-edit=""
            className="flex min-h-11 items-center justify-center gap-2 self-end rounded-button px-3 text-sm font-semibold text-ferry-orange-deep hover:bg-ferry-orange-light dark:text-ferry-sunset dark:hover:bg-night-2"
          >
            Edit order and names
          </button>
        </Rows.Provider>
      ) : (
        <div data-saved-empty="" tabIndex={-1} className="rounded-card">
          {empty}
        </div>
      )}
      <UndoToast removal={toast?.removal ?? null} onUndo={undo} onGone={gone} />
    </>
  )
}
