/**
 * The onboarding picker with the three modes' stops (lazy, after Yes, or from Settings): Save writes each mode's own
 * store with that app's own code (bus My stops, train favourites, the ferry pair), then opens My Transit, which reads
 * them all.
 */
import { busTrayItems, resaveBus, saveBus, useBusSource } from '@bft/bus/app/lib/onboarding.ts'
import { ferrySource, ferryTrayItems, resaveFerry, saveFerry } from '@bft/ferry/app/lib/onboarding.ts'
import { resaveTrain, saveTrain, trainSource, trainTrayItems } from '@bft/train/app/lib/onboarding.ts'
import type { OnboardMode, TrayItem, TrayState } from '@bft/ui/onboarding'
import OnboardingPicker from '@bft/ui/onboarding-picker'
import { MODE_BASES } from '../lib/modes.ts'

/** Every mode's store; true only if each kept its stops. Every store is written even if one refuses. */
export function saveAll(tray: TrayState): boolean {
  const ok = [saveBus(tray.items), saveTrain(tray.items), saveFerry(tray.items)]
  return ok.every(Boolean)
}

/** Re-run from Settings (THE-113): every mode's saved stops, in My Transit's order (saved.ts readSavedItems). */
export const allTrayItems = (): TrayItem[] => [...ferryTrayItems(), ...trainTrayItems(), ...busTrayItems()]

/** Re-run from Settings: each mode's store matches the tray; a mode that already does isn't written. */
export function resaveAll(tray: TrayState): boolean {
  const ok = [resaveBus(tray.items), resaveTrain(tray.items), resaveFerry(tray.items)]
  return ok.every(Boolean)
}

/** The tab the visitor is on picks the picker's first mode. */
export function currentMode(): OnboardMode {
  const p = location.pathname
  return p.startsWith(MODE_BASES.ferry) ? 'ferry' : p.startsWith(MODE_BASES.train) ? 'train' : 'bus'
}

export default function TransitOnboardingPicker({
  initialItems,
  onClose,
}: {
  /** A re-run from Settings: the stops saved on this device, already in the tray. */
  initialItems?: TrayItem[]
  onClose: () => void
}) {
  const bus = useBusSource()
  return (
    <OnboardingPicker
      sources={[bus, trainSource, ferrySource]}
      initialMode={currentMode()}
      initialItems={initialItems}
      onSave={(tray) => {
        const ok = initialItems ? resaveAll(tray) : saveAll(tray)
        // My Transit reads every store (and the server their cookies) on a fresh load.
        if (ok) location.assign('/')
        return ok
      }}
      onClose={onClose}
    />
  )
}
