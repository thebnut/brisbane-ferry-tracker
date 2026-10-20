/**
 * First-visit onboarding (P4) on the ferry home: replaces the stop selector that used to open by itself. "Not now"
 * leaves the default board, as closing that selector did, and both answers mark the selector as seen. Yes opens the
 * map picker: tap a terminal (From), choose a reachable To in the tray, Save stores the pair (savePair).
 */
import { shouldOffer } from '@bft/ui/onboarding'
import OnboardingPrompt from '@bft/ui/onboarding-prompt'
import { lazy } from 'react'
import { at } from '../lib/base.ts'
import { ferryAnswered, ferryHasSaved, ferrySeenBefore, ferrySource, saveFerry } from '../lib/onboarding.ts'

const OnboardingPicker = lazy(() => import('@bft/ui/onboarding-picker'))

/** Only on the plain home board, as the old first-visit selector: never over a terminal page or a ?from=&to= link. */
const onHome = () => location.pathname === at('/') && !/[?&](from|to)=/.test(location.search)

export default function Onboarding() {
  return (
    <OnboardingPrompt
      offer={() => onHome() && shouldOffer({ anySaved: ferryHasSaved(), seenBefore: ferrySeenBefore() })}
      onAnswer={ferryAnswered}
      renderPicker={(close) => (
        <OnboardingPicker
          sources={[ferrySource]}
          onSave={(tray) => {
            const ok = saveFerry(tray.items)
            // The home board reads the saved pair (and the server its cookie) on a fresh load.
            if (ok) location.assign(at('/'))
            return ok
          }}
          onClose={close}
        />
      )}
    />
  )
}
