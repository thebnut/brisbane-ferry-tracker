/**
 * Settings (theme, and "Set up My Transit stops": THE-113), loaded by the header on first open (Shell.tsx). The
 * theme is per device (storage.ts).
 */
import { BottomSheet } from '@bft/ui'
import { SegmentedControl } from '@bft/ui/bus'
import { RerunEntry, RerunHost } from '@bft/ui/onboarding-rerun'
import { lazy, useState } from 'react'
import { Link } from 'react-router'
import { at } from '../lib/base.ts'
import { readTheme, type ThemePref, writeTheme } from '../lib/storage.ts'

// Inside BrisbaneTransit this resolves to transit's picker, with every mode (modes.config.ts).
const OnboardingRerun = lazy(() => import('./OnboardingRerun.tsx'))

export default function SettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [theme, setTheme] = useState<ThemePref>(readTheme)
  const [rerun, setRerun] = useState(false)
  if (rerun)
    return (
      <RerunHost
        onClose={() => {
          setRerun(false)
          onClose()
        }}
      >
        {(close) => <OnboardingRerun onClose={close} />}
      </RerunHost>
    )
  return (
    <BottomSheet open={open} onClose={onClose} title="Settings">
      <div className="flex flex-col gap-5">
        <div className="flex items-center justify-between gap-3">
          <span className="font-semibold">Appearance</span>
          <SegmentedControl<ThemePref>
            label="Appearance"
            value={theme}
            onChange={(t) => {
              setTheme(t)
              writeTheme(t)
            }}
            options={[
              { value: 'system', label: 'Auto' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
          />
        </div>
        <RerunEntry onOpen={() => setRerun(true)} />
        <p className="text-sm text-sched-text">
          Saved stops, recent searches and offline timetables stay on this device. Times refresh every 15
          seconds while the page is open.
        </p>
        <p className="text-sm">
          <Link
            to={at('/about')}
            className="font-semibold text-ferry-orange-deep underline"
            onClick={onClose}
          >
            About BrisbaneBus and data sources
          </Link>
        </p>
      </div>
    </BottomSheet>
  )
}
