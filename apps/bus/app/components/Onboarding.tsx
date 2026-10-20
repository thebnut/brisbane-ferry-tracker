/**
 * First-visit onboarding (P4) in BrisbaneBus: once per device, on any page, when nothing is in My stops. Yes opens
 * the map picker (OnboardingPicker.tsx, lazy: MapLibre loads only then); Save adds the stops to My stops.
 */
import { shouldOffer } from '@bft/ui/onboarding'
import OnboardingPrompt from '@bft/ui/onboarding-prompt'
import { lazy } from 'react'
import { KEYS, readSaved } from '../lib/storage.ts'

const Picker = lazy(() => import('./OnboardingPicker.tsx'))

/**
 * My stops in storage itself too: storage.ts's in-memory list misses another tab's save unless a list of saved stops
 * is mounted (Codex r2 on #115).
 */
function anySaved(): boolean {
  if (readSaved().length > 0) return true
  try {
    const v = JSON.parse(localStorage.getItem(KEYS.SAVED) ?? '[]')
    return Array.isArray(v) && v.length > 0
  } catch {
    return false
  }
}

export default function Onboarding() {
  return (
    <OnboardingPrompt
      offer={() => shouldOffer({ anySaved: anySaved() })}
      renderPicker={(close) => <Picker onClose={close} />}
    />
  )
}
