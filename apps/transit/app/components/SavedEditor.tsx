/**
 * My Transit's "Edit list" (THE-114), loaded when it opens: put saved items in your own order and give them your own
 * names. Each row's handle drags with a mouse or a finger (touch-action: none, so the page doesn't scroll instead);
 * from the keyboard, Space or Enter on the handle picks the item up, the arrow keys move it, Space or Enter drops it
 * and Escape puts it back, each step read out in a live region. Move up/down buttons do the same in one tap.
 * Names are plain text (cleanLabel); an empty one goes back to the stop's own name. Each row's Delete unsaves the item
 * (THE-115, through `onDelete`, which offers Undo).
 */

import { ModeTile } from '@bft/ui'
import { type KeyboardEvent, type PointerEvent, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { SavedItem } from '../lib/saved.ts'
import { type PrefsStore, savePrefs } from '../lib/saved-prefs-save.ts'

const SMALL =
  'flex size-11 shrink-0 items-center justify-center rounded-full text-lg text-sched-text hover:bg-ferry-orange-light disabled:opacity-30 dark:text-night-text/80 dark:hover:bg-night-2'
const MODE_NAME = { ferry: 'Ferry', train: 'Train', bus: 'Bus' } as const

const nameOf = (item: SavedItem) => item.label || item.title

function moved<T>(list: T[], from: number, to: number): T[] {
  const next = list.slice()
  const [it] = next.splice(from, 1)
  next.splice(to, 0, it as T)
  return next
}

export function SavedEditor({
  items,
  onChange,
  store,
  onDelete,
  onDone,
}: {
  items: SavedItem[]
  /** The list as now shown (saved here, through `store`). */
  onChange: (next: SavedItem[]) => void
  store: PrefsStore
  /** Unsaves the item (focus moves to the next row's Delete). */
  onDelete: (item: SavedItem) => void
  onDone: () => void
}) {
  const [list, setList] = useState(items)
  const listRef = useRef(list)
  listRef.current = list
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [grabbed, setGrabbed] = useState<{ id: string; before: SavedItem[]; how: 'key' | 'pointer' } | null>(
    null,
  )
  // A delete or its Undo changes the list from outside: show it (not mid-move, which ends in a commit of its own).
  const [shown, setShown] = useState(items)
  if (items !== shown) {
    setShown(items)
    if (!grabbed) setList(items)
  }
  const [said, say] = useState('')
  const [unsaved, setUnsaved] = useState(false)
  const rows = useRef(new Map<string, HTMLLIElement>())
  const handles = useRef(new Map<string, HTMLButtonElement>())
  /** A held row is being moved in the page (its handle's blur then isn't the visitor leaving it). */
  const moving = useRef(false)
  /** Ends a drag in progress (its window listeners) if the editor closes during it. */
  const stopDrag = useRef<(() => void) | null>(null)
  useEffect(() => () => stopDrag.current?.(), [])
  // Opening it moves focus here, where the button that opened it was.
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => heading.current?.focus(), [])

  const commit = (next: SavedItem[]) => {
    setList(next)
    onChange(next)
    setUnsaved(!savePrefs(next, store))
  }
  const where = (id: string, l = listRef.current) =>
    `position ${l.findIndex((i) => i.id === id) + 1} of ${l.length}`

  // A row moved down is re-inserted, which takes focus off its handle: give it back.
  useLayoutEffect(() => {
    if (!moving.current) return
    moving.current = false
    if (grabbed) handles.current.get(grabbed.id)?.focus()
  })

  /** A Move up/down that had focus: its row, and which arrow (-1 up, 1 down). */
  const stepped = useRef<{ id: string; by: -1 | 1 } | null>(null)
  // After a Move up/down, focus stays on the item: on the same arrow, or the other one when it reached the end (its
  // own is now disabled), or the handle when both are (a one-item list). Otherwise it would fall to the page.
  useLayoutEffect(() => {
    const was = stepped.current
    if (!was) return
    stepped.current = null
    const row = rows.current.get(was.id)
    const arrow = (by: -1 | 1) => row?.querySelector<HTMLButtonElement>(`[data-step="${by}"]:not(:disabled)`)
    ;(arrow(was.by) ?? arrow(was.by === -1 ? 1 : -1) ?? handles.current.get(was.id))?.focus()
  })

  const drop = (id: string) => {
    setGrabbed(null)
    commit(listRef.current)
    const item = listRef.current.find((i) => i.id === id)
    if (item) say(`${nameOf(item)} dropped at ${where(id)}.`)
  }
  const cancel = () => {
    if (!grabbed) return
    setList(grabbed.before)
    setGrabbed(null)
    const item = grabbed.before.find((i) => i.id === grabbed.id)
    if (item) say(`Move cancelled. ${nameOf(item)} is back at ${where(grabbed.id, grabbed.before)}.`)
  }

  const onHandleKey = (e: KeyboardEvent<HTMLButtonElement>, item: SavedItem) => {
    const held = grabbed?.id === item.id
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault()
      if (held) drop(item.id)
      else {
        setGrabbed({ id: item.id, before: list, how: 'key' })
        say(
          `${nameOf(item)} picked up, ${where(item.id)}. Use the up and down arrow keys to move it, Space to drop it, Escape to cancel.`,
        )
      }
    } else if (held && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault()
      const i = list.findIndex((x) => x.id === item.id)
      const to = e.key === 'ArrowUp' ? i - 1 : i + 1
      if (to < 0 || to >= list.length) return say(`${nameOf(item)} is at ${where(item.id)}.`)
      const next = moved(list, i, to)
      moving.current = true
      setList(next)
      say(`${nameOf(item)} moved to ${where(item.id, next)}.`)
    } else if (held && e.key === 'Escape') {
      e.preventDefault()
      cancel()
    }
  }

  const onHandlePointer = (e: PointerEvent<HTMLButtonElement>, item: SavedItem) => {
    // One drag at a time (a second finger on another handle does nothing).
    if ((e.pointerType === 'mouse' && e.button !== 0) || stopDrag.current) return
    e.preventDefault()
    const before = list
    const pointerId = e.pointerId
    setGrabbed({ id: item.id, before, how: 'pointer' })
    // On the window, not the handle: moving its row in the page would end a pointer capture.
    const move = (ev: globalThis.PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      ev.preventDefault()
      const cur = listRef.current
      const others = cur.filter((i) => i.id !== item.id)
      // The dragged row goes after every other row whose middle is above the pointer.
      const to = others.filter((o) => {
        const r = rows.current.get(o.id)?.getBoundingClientRect()
        return r != null && r.top + r.height / 2 < ev.clientY
      }).length
      const from = cur.findIndex((i) => i.id === item.id)
      if (to !== from) setList(moved(cur, from, to))
    }
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      stopDrag.current = null
    }
    const end = (ev: globalThis.PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      stop()
      if (ev.type === 'pointercancel') {
        setList(before)
        setGrabbed(null)
      } else drop(item.id)
    }
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    stopDrag.current = stop
  }

  const step = (item: SavedItem, by: -1 | 1, button: HTMLButtonElement) => {
    // Only a focused button keeps focus on its item (a tap that doesn't focus, as in Safari, takes none).
    if (document.activeElement === button) stepped.current = { id: item.id, by }
    const i = list.findIndex((x) => x.id === item.id)
    const next = moved(list, i, i + by)
    commit(next)
    say(`${nameOf(item)} moved to ${where(item.id, next)}.`)
  }

  const rename = (item: SavedItem, raw: string) => {
    setDrafts((d) => ({ ...d, [item.id]: raw }))
    const label = store.clean(raw)
    commit(list.map((x) => (x.id === item.id ? { ...x, label: label || undefined } : x)))
  }

  return (
    <section aria-labelledby="saved-edit-title" className="flex flex-col gap-2" data-saved-editor="">
      <div className="flex items-center justify-between gap-2">
        <h2 id="saved-edit-title" ref={heading} tabIndex={-1} className="text-base font-bold">
          Edit My Transit
        </h2>
        <button
          type="button"
          onClick={onDone}
          className="flex min-h-11 items-center rounded-button bg-ferry-orange-aa px-4 text-sm font-bold text-white"
        >
          Done
        </button>
      </div>
      <p id="saved-edit-help" className="text-sm text-sched-text dark:text-night-text/70">
        Drag ⠿ to reorder, or focus it and press Space, then the arrow keys. Clear a name to use the stop's
        own. Delete takes a stop off this device; Undo puts it back.
      </p>
      <ol className="flex flex-col gap-2">
        {list.map((item, i) => {
          const name = nameOf(item)
          const held = grabbed?.id === item.id
          return (
            <li
              key={item.id}
              ref={(el) => {
                if (el) rows.current.set(item.id, el)
                else rows.current.delete(item.id)
              }}
              data-saved-edit-row={item.id}
              data-grabbed={held ? '' : undefined}
              className={
                held
                  ? 'flex flex-col gap-1.5 rounded-card border-2 border-ferry-orange bg-white px-2 py-2 shadow-hot dark:bg-night-card'
                  : 'flex flex-col gap-1.5 rounded-card border-2 border-transparent bg-white/90 px-2 py-2 shadow-card dark:bg-night-card'
              }
            >
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  ref={(el) => {
                    if (el) handles.current.set(item.id, el)
                    else handles.current.delete(item.id)
                  }}
                  aria-label={`Reorder ${name}`}
                  aria-describedby="saved-edit-help"
                  aria-pressed={held}
                  onKeyDown={(e) => onHandleKey(e, item)}
                  // Leaving a held item (Tab, a click elsewhere) drops it where it is.
                  onBlur={() => {
                    if (held && grabbed?.how === 'key' && !moving.current) drop(item.id)
                  }}
                  onPointerDown={(e) => onHandlePointer(e, item)}
                  data-drag-handle=""
                  className={`${SMALL} cursor-grab touch-none select-none active:cursor-grabbing`}
                >
                  <span aria-hidden="true">⠿</span>
                </button>
                <ModeTile mode={item.mode} size="sm" />
                <span className="flex min-w-0 flex-1 flex-col px-1">
                  <span className="truncate text-[15px] font-bold">{name}</span>
                  <span className="truncate text-xs text-sched-text dark:text-night-text/70">
                    {item.label ? `${MODE_NAME[item.mode]} · ${item.title}` : MODE_NAME[item.mode]}
                  </span>
                </span>
                <button
                  type="button"
                  aria-label={`Move ${name} up`}
                  disabled={i === 0}
                  onClick={(e) => step(item, -1, e.currentTarget)}
                  data-step="-1"
                  className={SMALL}
                >
                  <span aria-hidden="true">↑</span>
                </button>
                <button
                  type="button"
                  aria-label={`Move ${name} down`}
                  disabled={i === list.length - 1}
                  onClick={(e) => step(item, 1, e.currentTarget)}
                  data-step="1"
                  className={SMALL}
                >
                  <span aria-hidden="true">↓</span>
                </button>
              </div>
              <div className="flex items-center gap-1.5 pl-1">
                <input
                  type="text"
                  aria-label={`Name for ${item.title}`}
                  placeholder={item.title}
                  maxLength={store.maxLength}
                  autoComplete="off"
                  enterKeyHint="done"
                  value={drafts[item.id] ?? item.label ?? ''}
                  onChange={(e) => rename(item, e.target.value)}
                  onBlur={() => setDrafts(({ [item.id]: _, ...rest }) => rest)}
                  className="min-h-11 min-w-0 flex-1 rounded-button border border-ferry-orange/30 bg-white px-3 text-[15px] text-charcoal placeholder:text-sched-text dark:border-night-text/30 dark:bg-night-2 dark:text-night-text dark:placeholder:text-night-text/60"
                />
                <button
                  type="button"
                  aria-label={`Reset name for ${item.title}`}
                  disabled={!item.label}
                  onClick={() => {
                    rename(item, '')
                    say(`${item.title}: name reset.`)
                  }}
                  className="flex min-h-11 shrink-0 items-center rounded-button px-3 text-sm font-semibold text-ferry-orange-deep hover:bg-ferry-orange-light disabled:opacity-30 dark:text-ferry-sunset dark:hover:bg-night-2"
                >
                  Reset
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${name}`}
                  onClick={() => onDelete(item)}
                  data-saved-delete=""
                  className="flex min-h-11 shrink-0 items-center rounded-button px-3 text-sm font-semibold text-cancel-text hover:bg-red-50 dark:text-red-300 dark:hover:bg-night-2"
                >
                  Delete
                </button>
              </div>
            </li>
          )
        })}
      </ol>
      {unsaved ? (
        <p className="text-sm font-semibold text-cancel-text dark:text-red-300">
          This device isn't keeping changes, so they'll be gone when the page reloads.
        </p>
      ) : null}
      <p role="status" aria-live="polite" className="sr-only" data-saved-edit-status="">
        {said}
      </p>
    </section>
  )
}
