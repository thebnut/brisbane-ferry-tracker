/**
 * First-visit onboarding (P4), the prompt (`@bft/ui/onboarding-prompt`, default export): "Set up your favourite
 * stops?" [Yes] [Not now], once per device. Loaded by each app's onboarding slot after hydration, so never on a first
 * load or first paint. It waits for the visitor to be idle and never takes focus; Yes opens the app's picker (lazy:
 * MapLibre loads only then).
 */
import { type ReactNode, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { markOnboardingDone, whenIdle } from './onboarding.ts'

export interface OnboardingPromptProps {
  /** onboarding.ts shouldOffer with the app's own context: checked when idle, and again just before showing. */
  offer: () => boolean
  /** The app's picker (lazy). `close` ends onboarding; the picker saves through the app's stores before calling it. */
  renderPicker: (close: () => void) => ReactNode
  /** Called on either answer (ferry marks its stop selector as seen, as its first-visit opening did). */
  onAnswer?: () => void
  quietMs?: number
}

const BUTTON = 'min-h-11 rounded-button px-4 text-sm font-bold transition active:scale-95'

/**
 * Bottom chrome the prompt stays above (R15) while it is fixed there: the bottom nav, transit's section pills, bus's
 * search sheet and trip footer.
 */
const DOCK = '[data-bft-dock]'
/** Space between the prompt and the chrome below it (px). */
const GAP = 12

export interface Lift {
  /** The prompt's `bottom` (px): its class position (bottom-24, md:bottom-6), or higher to clear a dock. */
  bottom: number
  /** In-flow space after the page so its end scrolls clear of the prompt, not just of the docks (px). */
  spacer: number
}

/**
 * Where the prompt goes: above the highest visible dock, never lower than its class position. Docks change with the
 * page and width (the bus search sheet is phone-only), so this is measured while the prompt shows.
 */
export function measureLift(prompt: HTMLElement): Lift {
  const vh = innerHeight
  let top = vh
  for (const d of document.querySelectorAll(DOCK)) {
    const r = d.getBoundingClientRect()
    if (r.height > 0 && r.top < top && getComputedStyle(d).position === 'fixed') top = r.top
  }
  const docked = Math.ceil(vh - top)
  const base = typeof matchMedia === 'function' && matchMedia('(min-width: 768px)').matches ? 24 : 96
  const bottom = Math.max(base, docked + GAP)
  return { bottom, spacer: bottom + prompt.offsetHeight - docked }
}

export default function OnboardingPrompt({ offer, renderPicker, onAnswer, quietMs }: OnboardingPromptProps) {
  const [step, setStep] = useState<'waiting' | 'prompt' | 'picker' | 'done'>('waiting')
  const offerRef = useRef(offer)
  offerRef.current = offer
  /** Where focus goes back to once the prompt or picker has gone: what had it when the prompt appeared. */
  const returnTo = useRef<Element | null>(null)
  /** Set by an answer: only then does focus move. A prompt that goes by itself leaves focus alone (Codex r2). */
  const restore = useRef(false)
  const box = useRef<HTMLElement>(null)
  const spacer = useRef<HTMLDivElement>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: decided once per page view.
  useEffect(() => {
    if (!offerRef.current()) return setStep('done')
    return whenIdle(() => {
      returnTo.current = document.activeElement
      setStep(offerRef.current() ? 'prompt' : 'done')
    }, quietMs)
  }, [])
  // While it shows, the visitor may save a stop through the page itself (it isn't modal): then it goes (Codex r1).
  useEffect(() => {
    if (step !== 'prompt') return
    const recheck = () => {
      if (offerRef.current()) return
      // Focus on one of its buttons would be lost with it: then it goes back too (Codex r3). Otherwise untouched.
      restore.current = !!document.activeElement?.closest('[data-onboarding-prompt]')
      setStep('done')
    }
    const id = setInterval(recheck, 1_000)
    addEventListener('storage', recheck)
    return () => {
      clearInterval(id)
      removeEventListener('storage', recheck)
    }
  }, [step])
  // It never covers the page's fixed controls (R15: bus search's field and Map button sat under it on phones).
  // Placed before paint, and again before the paint after any change to the page under it: the prompt outlives client
  // navigations, so a dock that mounts with the next route (the Bus tab's search sheet) moves it at once (Codex r1).
  // Set on the elements directly, not through state, so a re-render can't lag a frame behind.
  useLayoutEffect(() => {
    if (step !== 'prompt') return
    const place = () => {
      const el = box.current
      if (!el) return
      const { bottom, spacer: h } = measureLift(el)
      el.style.bottom = `${bottom}px`
      if (spacer.current) spacer.current.style.height = `${h}px`
    }
    place()
    // Mutation callbacks run before the next paint; the timer is a fallback for changes no mutation shows.
    const seen = new MutationObserver(place)
    seen.observe(document.body, { childList: true, subtree: true })
    const id = setInterval(place, 1_000)
    addEventListener('resize', place)
    return () => {
      seen.disconnect()
      clearInterval(id)
      removeEventListener('resize', place)
    }
  }, [step])
  // The prompt's buttons and the picker are gone: put focus back where it was, never on <body> (Codex r1).
  useEffect(() => {
    if (step !== 'done' || !restore.current) return
    const active = document.activeElement
    if (active && active !== document.body) return
    const back = returnTo.current
    const target =
      back instanceof HTMLElement && back.isConnected && back !== document.body
        ? back
        : (document.querySelector<HTMLElement>('main h1') ??
          document.querySelector<HTMLElement>('h1') ??
          document.querySelector<HTMLElement>('main'))
    if (!target) return
    if (!target.matches('a[href], button, input, select, textarea, [tabindex]')) target.tabIndex = -1
    target.focus({ preventScroll: true })
  }, [step])

  // Answered either way: the prompt never comes back on this device, whatever happens in the picker.
  const answer = (next: 'picker' | 'done') => {
    restore.current = true
    // Saved meanwhile (another tab, or the page itself): nothing to set up.
    if (next === 'picker' && !offerRef.current()) return setStep('done')
    markOnboardingDone()
    onAnswer?.()
    setStep(next)
  }
  const notNow = () => answer('done')
  if (step === 'picker')
    return (
      <Suspense
        fallback={
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" role="status">
            <span className="rounded-card bg-white px-6 py-4 text-sm shadow-lg dark:bg-night-card">
              Loading…
            </span>
          </div>
        }
      >
        {renderPicker(() => setStep('done'))}
      </Suspense>
    )
  if (step !== 'prompt') return null
  return (
    <>
      <div ref={spacer} aria-hidden="true" data-onboarding-spacer="" />
      <section
        ref={box}
        aria-labelledby="bft-onboarding-title"
        data-onboarding-prompt=""
        onKeyDown={(e) => {
          if (e.key === 'Escape') notNow()
        }}
        className="fixed inset-x-3 bottom-24 z-40 mx-auto flex max-w-md flex-col gap-3 rounded-card border border-ferry-orange/30 bg-white p-4 text-charcoal shadow-header md:inset-x-auto md:right-6 md:bottom-6 dark:bg-night-card dark:text-night-text"
      >
        {/* Announced when it appears, without moving focus away from whatever the visitor is doing. */}
        <div role="status">
          <h2 id="bft-onboarding-title" className="text-base font-extrabold">
            Set up your favourite stops?
          </h2>
          <p className="text-sm text-sched-text">
            Pick them on a map, and they'll be here every time you open the app.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => answer('picker')}
            className={`${BUTTON} flex-1 bg-ferry-orange-aa text-white hover:bg-ferry-orange-deep`}
          >
            Yes
          </button>
          <button
            type="button"
            onClick={notNow}
            className={`${BUTTON} flex-1 border-2 border-ferry-orange bg-white text-ferry-orange-deep hover:bg-ferry-orange-light dark:bg-night-card dark:text-ferry-sunset`}
          >
            Not now
          </button>
        </div>
      </section>
    </>
  )
}
