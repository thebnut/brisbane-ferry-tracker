/**
 * "Set up My Transit stops" from Settings (THE-113): the onboarding map picker again, with every mode's saved stops in
 * the tray in My Transit's order (its own, when it has one: THE-114), opening on the tab's mode. Save writes each
 * mode's store as first-run onboarding does (a stop taken out is unsaved); Cancel changes nothing. Lazy: Settings
 * loads it when the entry is used. The mode apps' own `OnboardingRerun.tsx` resolve to this module inside
 * BrisbaneTransit (modes.config.ts), so a mode tab's Settings edits all of My Transit too.
 */
import { useState } from 'react'
import { inOverlayOrder } from '../lib/saved-prefs-tray.ts'
import TransitOnboardingPicker, { allTrayItems } from './OnboardingPicker.tsx'

export default function TransitOnboardingRerun({ onClose }: { onClose: () => void }) {
  const [stored] = useState(allTrayItems)
  const [before] = useState(() => inOverlayOrder(stored))
  return <TransitOnboardingPicker initialItems={before} storedItems={stored} onClose={onClose} />
}
