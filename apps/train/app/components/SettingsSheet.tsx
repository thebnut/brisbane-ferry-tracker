/**
 * Settings (theme, and "Set up My Transit stops": THE-113), loaded by Shell on first open (Chrome.tsx). The theme
 * goes in the cookie the server reads, so pages render in it with no flash.
 */
import { BottomSheet } from '@bft/ui'
import { RerunEntry, RerunHost } from '@bft/ui/onboarding-rerun'
import { lazy, useState } from 'react'
import { useRouteLoaderData } from 'react-router'
import { type Theme, writeTheme } from '../lib/storage.ts'
import type { loader as rootLoader } from '../root.tsx'

// Inside BrisbaneTransit this resolves to transit's picker, with every mode (modes.config.ts).
const OnboardingRerun = lazy(() => import('./OnboardingRerun.tsx'))

const THEMES: Array<{ value: Theme; label: string }> = [
  { value: 'system', label: 'Match my device' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

function applyTheme(theme: Theme) {
  const el = document.documentElement
  el.classList.remove('light', 'dark')
  if (theme !== 'system') el.classList.add(theme)
  else if (matchMedia('(prefers-color-scheme: dark)').matches) el.classList.add('dark')
}

export default function SettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const root = useRouteLoaderData<typeof rootLoader>('root')
  const [theme, setTheme] = useState<Theme>(root?.theme ?? 'system')
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
      <fieldset className="px-5 py-4">
        <legend className="text-sm font-semibold text-gray-700 dark:text-night-text/80">Appearance</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {THEMES.map((t) => (
            <label
              key={t.value}
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-ferry-orange/30 bg-white px-4 text-sm font-semibold has-checked:border-ferry-orange-aa has-checked:bg-ferry-orange-light dark:bg-night-2 dark:has-checked:bg-night-card"
            >
              <input
                type="radio"
                name="theme"
                value={t.value}
                checked={theme === t.value}
                onChange={() => {
                  setTheme(t.value)
                  writeTheme(t.value)
                  applyTheme(t.value)
                }}
                className="accent-ferry-orange-aa"
              />
              {t.label}
            </label>
          ))}
        </div>
        <p className="mt-4 text-xs text-sched-text">
          Favourites and today's offline timetable are kept on this device only.
        </p>
      </fieldset>
      <div className="border-t border-ferry-orange/15 px-5 py-4">
        <RerunEntry onOpen={() => setRerun(true)} />
      </div>
    </BottomSheet>
  )
}
