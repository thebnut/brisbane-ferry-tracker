/**
 * First-visit onboarding (P4) in BrisbaneTransit: offered once, on any tab, when nothing is saved in any mode (and no
 * favourites were handed over from a mode site). Yes opens the map picker (OnboardingPicker.tsx, lazy: MapLibre loads
 * only then) with a mode switch.
 *
 * Ferry's stop selector no longer opens by itself on the Ferry tab's first visit (this prompt replaced it); a device
 * it had opened on before counts as onboarded, and either answer marks it as seen, as its opening did.
 */
import { readSaved as readBusSaved } from '@bft/bus/app/lib/storage.ts'
import { markSelectorSeen, readSavedPair, STORAGE_KEYS } from '@bft/ferry/app/lib/storage.ts'
import { readFavourites } from '@bft/train/app/lib/storage.ts'
import { shouldOffer } from '@bft/ui/onboarding'
import OnboardingPrompt from '@bft/ui/onboarding-prompt'
import { lazy } from 'react'
import { MODE_BASES } from '../lib/modes.ts'

const Picker = lazy(() => import('./OnboardingPicker.tsx'))

/** Anything saved in any mode: what My Transit lists (saved.ts readSavedItems), read with each app's own code. */
export const anySaved = () =>
  readBusSaved().length > 0 || readFavourites().length > 0 || readSavedPair() != null

/** The Ferry tab's stop selector has opened by itself before (the old first visit). Blocked storage: yes. */
function ferrySeen(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEYS.SELECTOR_SEEN) === '1'
  } catch {
    return true
  }
}

/** The tab the visitor is on picks the picker's first mode. */
function currentMode(): 'bus' | 'train' | 'ferry' {
  const p = location.pathname
  return p.startsWith(MODE_BASES.ferry) ? 'ferry' : p.startsWith(MODE_BASES.train) ? 'train' : 'bus'
}

export default function Onboarding() {
  return (
    <OnboardingPrompt
      offer={() => shouldOffer({ anySaved: anySaved(), seenBefore: ferrySeen() })}
      onAnswer={markSelectorSeen}
      renderPicker={(close) => <Picker initialMode={currentMode()} onClose={close} />}
    />
  )
}
