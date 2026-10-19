/** The feedback entry point (ferry's footer, and transit's), kept apart so transit doesn't load ferry's chrome. */
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useRouteLoaderData } from 'react-router'

const FeedbackSheet = lazy(() => import('./FeedbackSheet.tsx'))

/** The legacy footer's feedback entry point; the form loads on first open. */
export function FeedbackButton() {
  // Ferry's and transit's root loaders both expose the Turnstile sitekey (absent in local dev).
  const root = useRouteLoaderData('root') as { turnstileSitekey?: string | null } | undefined
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(false)
  // The sheet unmounts instead of closing, so the browser can't restore focus itself. Refocus after the unmount:
  // while the modal dialog is still up, everything outside it is inert.
  useEffect(() => {
    if (wasOpen.current && !open) button.current?.focus()
    wasOpen.current = open
  }, [open])
  // /feedback redirects to ?feedback=1, which opens the sheet.
  useEffect(() => {
    if (new URLSearchParams(location.search).get('feedback') === '1') setOpen(true)
  }, [])
  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-11 font-semibold text-ferry-orange-deep transition-colors hover:text-ferry-orange-dark"
      >
        <span aria-hidden="true">💬 </span>Send Feedback & Ideas
      </button>
      {open ? (
        <Suspense fallback={null}>
          <FeedbackSheet onClose={() => setOpen(false)} sitekey={root?.turnstileSitekey ?? null} />
        </Suspense>
      ) : null}
    </>
  )
}
