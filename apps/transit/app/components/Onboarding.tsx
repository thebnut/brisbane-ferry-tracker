/**
 * First-visit onboarding (P4) in BrisbaneTransit: offered once, inline at the top of My Transit (THE-118 PR 3: never a
 * floating card over the boards), when nothing is saved in any mode (and no favourites were handed over from a mode
 * site). Yes opens the map picker (OnboardingPicker.tsx, lazy: MapLibre loads
 * only then) with a mode switch.
 *
 * Ferry's stop selector no longer opens by itself on the Ferry tab's first visit (this prompt replaced it); a device
 * it had opened on before counts as onboarded, and either answer marks it as seen, as its opening did.
 */
import { KEYS as BUS_KEYS, readSaved as readBusSaved } from '@bft/bus/app/lib/storage.ts'
import { readFerryFavourites } from '@bft/ferry/app/lib/favourites.ts'
import { markSelectorSeen, readSavedPair, STORAGE_KEYS } from '@bft/ferry/app/lib/storage.ts'
import { readFavourites } from '@bft/train/app/lib/storage.ts'
import { shouldOffer } from '@bft/ui/onboarding'
import OnboardingPrompt from '@bft/ui/onboarding-prompt'
import { lazy } from 'react'

const Picker = lazy(() => import('./OnboardingPicker.tsx'))

/**
 * Bus stops in storage itself: bus storage.ts keeps its list in memory, refreshed by another tab's save only while a
 * bus list is mounted, so a save made in another tab isn't in it on the other tabs (Codex r2).
 */
function busStored(): boolean {
  try {
    const v = JSON.parse(localStorage.getItem(BUS_KEYS.SAVED) ?? '[]')
    return Array.isArray(v) && v.length > 0
  } catch {
    return false
  }
}

/** Anything saved in any mode: what My Transit lists (saved.ts readSavedItems), read with each app's own code. */
export const anySaved = () =>
  readBusSaved().length > 0 ||
  busStored() ||
  readFavourites().length > 0 ||
  readFerryFavourites().length > 0 ||
  readSavedPair() != null

/** The Ferry tab's stop selector has opened by itself before (the old first visit). Blocked storage: yes. */
function ferrySeen(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEYS.SELECTOR_SEEN) === '1'
  } catch {
    return true
  }
}

export default function Onboarding() {
  return (
    <OnboardingPrompt
      offer={() => shouldOffer({ anySaved: anySaved(), seenBefore: ferrySeen() })}
      onAnswer={markSelectorSeen}
      inline
      // In the page flow, not over anyone's thumb: no need to wait for a quiet moment.
      quietMs={0}
      renderPicker={(close) => <Picker onClose={close} />}
    />
  )
}
