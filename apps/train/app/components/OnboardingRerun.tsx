/**
 * "Set up My Transit stops" from Settings (THE-113): the onboarding map picker again, with the station favourites in
 * the tray. Save writes them as first-run onboarding does (a station taken out is unsaved); Cancel changes nothing.
 * Lazy: Settings loads it when the entry is used. Inside BrisbaneTransit this module is swapped for transit's own
 * (modes.config.ts), which edits every mode's stops.
 */
import OnboardingPicker from '@bft/ui/onboarding-picker'
import { useState } from 'react'
import { at } from '../lib/base.ts'
import { resaveTrain, trainSource, trainTrayItems } from '../lib/onboarding.ts'

export default function TrainOnboardingRerun({ onClose }: { onClose: () => void }) {
  const [before] = useState(trainTrayItems)
  return (
    <OnboardingPicker
      sources={[trainSource]}
      initialItems={before}
      onSave={(tray) => {
        const ok = resaveTrain(before, tray.items)
        // The home page lists favourites (and the server renders the first few from their cookie) on a fresh load.
        if (ok) location.assign(at('/'))
        return ok
      }}
      onClose={onClose}
    />
  )
}
