/**
 * "Set up My Transit stops" from Settings (THE-113): the onboarding map picker again, with every mode's saved stops in
 * the tray, opening on the tab's mode. Save writes each mode's store as first-run onboarding does (a stop taken out is
 * unsaved); Cancel changes nothing. Lazy: Settings loads it when the entry is used. The mode apps' own
 * `OnboardingRerun.tsx` resolve to this module inside BrisbaneTransit (modes.config.ts), so a mode tab's Settings
 * edits all of My Transit too.
 */
import { useState } from 'react'
import TransitOnboardingPicker, { allTrayItems } from './OnboardingPicker.tsx'

export default function TransitOnboardingRerun({ onClose }: { onClose: () => void }) {
  const [before] = useState(allTrayItems)
  return <TransitOnboardingPicker initialItems={before} onClose={onClose} />
}
