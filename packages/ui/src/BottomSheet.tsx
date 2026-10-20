/**
 * Bottom sheet on phones, centred dialog on desktop. Built on the native <dialog> element (inert page behind it,
 * Escape and the top layer for free), rendered through a portal into document.body. Tab and Shift+Tab wrap inside
 * the sheet: a native modal dialog otherwise lets focus leave the page for the browser's own UI.
 */
import { type KeyboardEvent, type ReactNode, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './icons.tsx'

export interface BottomSheetProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  /** Extra header content under the title (badges, subtitle). */
  subtitle?: ReactNode
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Keep Tab focus inside the dialog: wrap from the last focusable element to the first and back. */
export function wrapTabFocus(e: KeyboardEvent<HTMLElement>) {
  if (e.key !== 'Tab') return
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.getClientRects().length > 0,
  )
  const first = items[0]
  const last = items[items.length - 1]
  if (!first || !last) return
  const active = document.activeElement
  if (e.shiftKey && (active === first || active === e.currentTarget)) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && active === last) {
    e.preventDefault()
    first.focus()
  }
}

export function BottomSheet({ open, onClose, title, subtitle, children }: BottomSheetProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const [mounted, setMounted] = useState(false)
  // Layout effects: the sheet is portalled and opened before the browser paints, so a sheet that loads on demand goes
  // straight from its fallback to the open sheet, with no blank frame between (R15-S1, the lazy ferry DetailsSheet).
  useLayoutEffect(() => setMounted(true), [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run once the portal target exists.
  useLayoutEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) {
      // jsdom has no showModal; fall back to the open attribute.
      if (typeof d.showModal === 'function') d.showModal()
      else d.setAttribute('open', '')
    } else if (!open && d.open) {
      d.close()
    }
  }, [open, mounted])

  if (!mounted) return null
  return createPortal(
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onKeyDown={wrapTabFocus}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => {
        // A click on the backdrop lands on the dialog element itself.
        if (e.target === e.currentTarget) onClose()
      }}
      className="fixed inset-x-0 top-auto bottom-0 m-0 mx-auto max-h-[88dvh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-white p-0 text-charcoal shadow-2xl backdrop:bg-black/45 md:top-1/2 md:bottom-auto md:-translate-y-1/2 md:rounded-2xl dark:bg-night-card dark:text-night-text"
    >
      <div className="sticky top-0 z-10 border-b border-ferry-orange/15 bg-hot px-5 pt-2.5 pb-3">
        <span
          aria-hidden="true"
          className="mx-auto mb-2 block h-1.5 w-10 rounded-full bg-gray-300 md:hidden"
        />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id={titleId} className="text-xl font-bold">
              {title}
            </h2>
            {subtitle ? <div className="mt-1">{subtitle}</div> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-11 shrink-0 items-center justify-center rounded-full text-gray-600 hover:bg-ferry-orange-light"
          >
            <Icon name="close" size={22} />
          </button>
        </div>
      </div>
      <div className="px-5 py-4 pb-[max(env(safe-area-inset-bottom),16px)]">{children}</div>
    </dialog>,
    document.body,
  )
}
