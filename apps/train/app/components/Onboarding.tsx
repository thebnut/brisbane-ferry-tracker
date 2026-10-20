/**
 * First-visit onboarding (P4) in BrisbaneTrain: once per device, on any page, when there are no favourites. Yes opens
 * the map picker (lazy: MapLibre loads only then); Save adds each station as a favourite and opens the home page.
 */
import { shouldOffer } from '@bft/ui/onboarding'
import OnboardingPrompt from '@bft/ui/onboarding-prompt'
import { lazy } from 'react'
import { at } from '../lib/base.ts'
import { readFavourites } from '../lib/storage.ts'

const OnboardingPicker = lazy(() => import('@bft/ui/onboarding-picker'))
// The stations ship with the app, so the picker's source is plain data (loaded with the picker, not the prompt).
const loadTrain = () => import('../lib/onboarding.ts')

export default function Onboarding() {
  return (
    <OnboardingPrompt
      offer={() => shouldOffer({ anySaved: readFavourites().length > 0 })}
      renderPicker={(close) => <TrainPicker onClose={close} />}
    />
  )
}

const TrainPicker = lazy(async () => {
  const { saveTrain, trainSource } = await loadTrain()
  return {
    default: ({ onClose }: { onClose: () => void }) => (
      <OnboardingPicker
        sources={[trainSource]}
        onSave={(tray) => {
          const ok = saveTrain(tray.items)
          // The home page lists favourites (and the server renders the first few from their cookie) on a fresh load.
          if (ok) location.assign(at('/'))
          return ok
        }}
        onClose={onClose}
      />
    ),
  }
})
