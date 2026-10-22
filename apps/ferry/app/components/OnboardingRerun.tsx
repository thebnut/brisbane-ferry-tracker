/**
 * "Set up My Transit stops" from Settings (THE-113): the onboarding map picker again, with the saved pair in the tray.
 * Save writes the pair as first-run onboarding does (or unsaves it when taken out); Cancel changes nothing. Lazy: the
 * stop selector loads it when the entry is used. Inside BrisbaneTransit this module is swapped for transit's own
 * (modes.config.ts), which edits every mode's stops.
 */
import OnboardingPicker from '@bft/ui/onboarding-picker'
import { useState } from 'react'
import { at } from '../lib/base.ts'
import { ferrySource, ferryTrayItems, resaveFerry } from '../lib/onboarding.ts'

export default function FerryOnboardingRerun({ onClose }: { onClose: () => void }) {
  const [before] = useState(ferryTrayItems)
  return (
    <OnboardingPicker
      sources={[ferrySource]}
      initialItems={before}
      onSave={(tray) => {
        const ok = resaveFerry(tray.items)
        // The home board reads the saved pair (and the server its cookie) on a fresh load.
        if (ok) location.assign(at('/'))
        return ok
      }}
      onClose={onClose}
    />
  )
}
