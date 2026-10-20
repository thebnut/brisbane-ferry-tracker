/**
 * First-visit onboarding (P4) in BrisbaneBus: once per device, on any page, when nothing is in My stops. Yes opens
 * the map picker (OnboardingPicker.tsx, lazy: MapLibre loads only then); Save adds the stops to My stops.
 */
import { shouldOffer } from '@bft/ui/onboarding'
import OnboardingPrompt from '@bft/ui/onboarding-prompt'
import { lazy } from 'react'
import { readSaved } from '../lib/storage.ts'

const Picker = lazy(() => import('./OnboardingPicker.tsx'))

export default function Onboarding() {
  return (
    <OnboardingPrompt
      offer={() => shouldOffer({ anySaved: readSaved().length > 0 })}
      renderPicker={(close) => <Picker onClose={close} />}
    />
  )
}
