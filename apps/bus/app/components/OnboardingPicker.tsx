/** The onboarding picker with bus stops (lazy, after Yes): Save adds them to My stops and opens the home page. */
import OnboardingPicker from '@bft/ui/onboarding-picker'
import { at } from '../lib/base.ts'
import { saveBus, useBusSource } from '../lib/onboarding.ts'

export default function BusOnboardingPicker({ onClose }: { onClose: () => void }) {
  const bus = useBusSource()
  return (
    <OnboardingPicker
      sources={[bus]}
      onSave={(tray) => {
        const ok = saveBus(tray.items)
        // The home page lists My stops (and the server renders the first few from their cookie) on a fresh load.
        if (ok) location.assign(at('/'))
        return ok
      }}
      onClose={onClose}
    />
  )
}
