/**
 * First-visit onboarding (P4), the prompt (`@bft/ui/onboarding-prompt`, default export): "Set up your favourite
 * stops?" [Yes] [Not now], once per device. Loaded by each app's onboarding slot after hydration, so never on a first
 * load or first paint. It waits for the visitor to be idle and never takes focus; Yes opens the app's picker (lazy:
 * MapLibre loads only then).
 */
import { type ReactNode, Suspense, useEffect, useRef, useState } from 'react'
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

export default function OnboardingPrompt({ offer, renderPicker, onAnswer, quietMs }: OnboardingPromptProps) {
  const [step, setStep] = useState<'waiting' | 'prompt' | 'picker' | 'done'>('waiting')
  const offerRef = useRef(offer)
  offerRef.current = offer
  // biome-ignore lint/correctness/useExhaustiveDependencies: decided once per page view.
  useEffect(() => {
    if (!offerRef.current()) return setStep('done')
    return whenIdle(() => setStep(offerRef.current() ? 'prompt' : 'done'), quietMs)
  }, [])

  // Answered either way: the prompt never comes back on this device, whatever happens in the picker.
  const answer = (next: 'picker' | 'done') => {
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
    <section
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
  )
}
