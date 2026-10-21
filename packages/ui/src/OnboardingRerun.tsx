/**
 * Re-running onboarding from Settings (THE-113, `@bft/ui/onboarding-rerun`): the "Set up My Transit stops" entry each
 * app's settings surface shows, and the host its picker opens in. Loaded only with those surfaces (all lazy), and the
 * picker itself only when the entry is used. The picker opens with this device's saved stops in the tray; each app's
 * `OnboardingRerun.tsx` saves the result through its own stores. The first-visit prompt is never brought back.
 */
import { type ReactNode, Suspense, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { markOnboardingDone } from './onboarding.ts'

export const RERUN_LABEL = 'Set up My Transit stops'

/** The settings row: what it does, and the button that opens the picker. */
export function RerunEntry({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="flex flex-col gap-2" data-onboarding-rerun="">
      <span className="font-semibold">My Transit stops</span>
      <p className="text-sm text-sched-text">Add, remove or reorder the stops you've saved, on a map.</p>
      <button
        type="button"
        onClick={onOpen}
        className="flex min-h-11 items-center justify-center rounded-button border-2 border-ferry-orange bg-white px-4 text-sm font-bold text-ferry-orange-deep transition hover:bg-ferry-orange-light active:scale-95 dark:bg-night-card dark:text-ferry-sunset dark:hover:bg-night-2"
      >
        {RERUN_LABEL}
      </button>
    </div>
  )
}

/**
 * Focus after the picker closes without a save (a save reloads the page): the Settings button that opened it all,
 * since the settings surface has gone with it.
 */
export function focusSettings() {
  const pill = [...document.querySelectorAll<HTMLElement>('button[aria-label="Settings"]')].find(
    (b) => b.getClientRects().length > 0,
  )
  const target =
    pill ?? document.querySelector<HTMLElement>('main h1') ?? document.querySelector<HTMLElement>('h1')
  if (!target) return
  if (!target.matches('button, a[href], [tabindex]')) target.tabIndex = -1
  target.focus({ preventScroll: true })
}

/**
 * Where the picker renders: on <body>, above everything (a settings surface can sit inside the header), with the same
 * loading screen as the first-visit picker. `children` gets the picker's close: `onClose` (the settings surface goes
 * too), then focus goes back to Settings once the picker has let go of the page. Using it counts as having been
 * onboarded: the prompt never shows after.
 */
export function RerunHost({
  onClose,
  children,
}: {
  onClose: () => void
  children: (close: () => void) => ReactNode
}) {
  useEffect(markOnboardingDone, [])
  const close = () => {
    onClose()
    // After the picker has unmounted and lifted `inert` from the page.
    setTimeout(focusSettings, 0)
  }
  return createPortal(
    <Suspense
      fallback={
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" role="status">
          <span className="rounded-card bg-white px-6 py-4 text-sm shadow-lg dark:bg-night-card">
            Loading…
          </span>
        </div>
      }
    >
      {children(close)}
    </Suspense>,
    document.body,
  )
}
