/**
 * The onboarding picker with the three modes' stops (lazy, after Yes). Save writes each mode's own store with that
 * app's own code (bus My stops, train favourites, the ferry pair), then opens My Transit, which reads them all.
 */
import { saveBus, useBusSource } from '@bft/bus/app/lib/onboarding.ts'
import { ferrySource, saveFerry } from '@bft/ferry/app/lib/onboarding.ts'
import { saveTrain, trainSource } from '@bft/train/app/lib/onboarding.ts'
import type { OnboardMode, TrayState } from '@bft/ui/onboarding'
import OnboardingPicker from '@bft/ui/onboarding-picker'

/** Every mode's store; true only if each kept its stops. Every store is written even if one refuses. */
export function saveAll(tray: TrayState): boolean {
  const ok = [saveBus(tray.items), saveTrain(tray.items), saveFerry(tray.items)]
  return ok.every(Boolean)
}

export default function TransitOnboardingPicker({
  initialMode,
  onClose,
}: {
  initialMode: OnboardMode
  onClose: () => void
}) {
  const bus = useBusSource()
  return (
    <OnboardingPicker
      sources={[bus, trainSource, ferrySource]}
      initialMode={initialMode}
      onSave={(tray) => {
        const ok = saveAll(tray)
        // My Transit reads every store (and the server their cookies) on a fresh load.
        if (ok) location.assign('/')
        return ok
      }}
      onClose={onClose}
    />
  )
}
