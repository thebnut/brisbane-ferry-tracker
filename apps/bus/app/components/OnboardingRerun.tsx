/**
 * "Set up My Transit stops" from Settings (THE-113): the onboarding map picker again, with My stops in the tray. Save
 * writes them as first-run onboarding does (a stop taken out is unsaved); Cancel changes nothing. Lazy: Settings
 * loads it when the entry is used. Inside BrisbaneTransit this module is swapped for transit's own (modes.config.ts),
 * which edits every mode's stops.
 */
import OnboardingPicker from '@bft/ui/onboarding-picker'
import { useState } from 'react'
import { at } from '../lib/base.ts'
import { busTrayItems, resaveBus, useBusSource } from '../lib/onboarding.ts'

export default function BusOnboardingRerun({ onClose }: { onClose: () => void }) {
  const [before] = useState(busTrayItems)
  const bus = useBusSource()
  return (
    <OnboardingPicker
      sources={[bus]}
      initialItems={before}
      onSave={(tray) => {
        const ok = resaveBus(tray.items)
        // The home page lists My stops (and the server renders the first few from their cookie) on a fresh load.
        if (ok) location.assign(at('/'))
        return ok
      }}
      onClose={onClose}
    />
  )
}
