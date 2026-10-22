/**
 * "{Name} saved to My Transit · Undo" after a star tap (THE-118 PR 1). On a train or ferry board with no destination it
 * also offers "Pick a destination". It stays a few seconds, longer while pointed at or focused, and sits above the
 * page's fixed bottom bars (`data-bft-dock`), as My Transit's delete toast does.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/** How long the toast stays (ms), counted again after the pointer or focus leaves it. */
const TOAST_MS = 7000
/** Space between the toast and the bottom bar (px). */
const GAP = 12

export interface SaveToastMessage {
  /** The place saved, e.g. "Central". */
  name: string
  /** Opens the board's destination picker; shown only when the save has no destination. */
  pickDestination?: () => void
  /** False when this device's storage refused the save (it lasts until the page is reloaded). */
  kept?: boolean
}

function liftAboveDocks(): number {
  let top = innerHeight
  for (const d of document.querySelectorAll('[data-bft-dock]')) {
    const r = d.getBoundingClientRect()
    if (r.height > 0 && r.top < top && getComputedStyle(d).position === 'fixed') top = r.top
  }
  return Math.ceil(innerHeight - top) + GAP
}

export function SaveToast({
  toast,
  onUndo,
  onGone,
}: {
  toast: SaveToastMessage | null
  onUndo: () => void
  onGone: () => void
}) {
  const [mounted, setMounted] = useState(false)
  const [held, setHeld] = useState({ pointer: false, focus: false })
  const [bottom, setBottom] = useState(GAP)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => setMounted(true), [])
  useLayoutEffect(() => {
    if (!toast) return
    setBottom(liftAboveDocks())
    const bar = box.current?.firstElementChild
    setHeld({ pointer: !!bar?.matches(':hover'), focus: !!bar?.contains(document.activeElement) })
  }, [toast])
  const paused = held.pointer || held.focus
  useEffect(() => {
    if (!toast || paused) return
    const t = setTimeout(onGone, TOAST_MS)
    return () => clearTimeout(t)
  }, [toast, paused, onGone])
  if (!mounted) return null
  // In the body (a dock's backdrop blur would trap a fixed child), and always there so the first message is announced.
  return createPortal(
    <div
      ref={box}
      role="status"
      aria-live="polite"
      data-save-toast=""
      onPointerEnter={() => setHeld((h) => ({ ...h, pointer: true }))}
      onPointerLeave={() => setHeld((h) => ({ ...h, pointer: false }))}
      onFocus={() => setHeld((h) => ({ ...h, focus: true }))}
      onBlur={() => setHeld((h) => ({ ...h, focus: false }))}
      style={{ bottom }}
      className="pointer-events-none fixed inset-x-3 z-40 mx-auto flex max-w-md justify-center"
    >
      {toast ? (
        <div className="pointer-events-auto flex w-full flex-wrap items-center gap-x-1 gap-y-0.5 rounded-card bg-charcoal py-1.5 pr-1.5 pl-4 text-sm text-white shadow-header dark:border dark:border-night-text/20 dark:bg-night-2 dark:text-night-text">
          <span className="min-w-0 flex-1 basis-40">
            <span className="block font-semibold">{toast.name} saved to My Transit</span>
            {toast.kept === false ? (
              <span className="block text-xs">
                This device isn't keeping changes, so it's gone after a reload.
              </span>
            ) : null}
          </span>
          {toast.pickDestination ? (
            <button
              type="button"
              onClick={() => {
                onGone()
                toast.pickDestination?.()
              }}
              className="flex min-h-11 shrink-0 items-center rounded-button px-3 font-bold text-ferry-sunset hover:bg-white/10"
            >
              Pick a destination
            </button>
          ) : null}
          <button
            type="button"
            onClick={onUndo}
            className="flex min-h-11 shrink-0 items-center rounded-button px-4 font-bold text-ferry-sunset hover:bg-white/10"
          >
            Undo
          </button>
        </div>
      ) : null}
    </div>,
    document.body,
  )
}
