/** Settings (theme) for the transit pages; lazy, see Chrome.tsx. Writes the same cookie and key the mode pages read. */
import { KEYS as BUS_KEYS } from '@bft/bus/app/lib/storage.ts'
import { BottomSheet, SegmentedControl } from '@bft/ui'
import { useState } from 'react'
import { useRouteLoaderData } from 'react-router'
import { safe, THEME_COOKIE } from '../lib/storage.ts'

export type ThemePref = 'system' | 'light' | 'dark'

function applyTheme(pref: ThemePref) {
  const el = document.documentElement
  el.classList.remove('light', 'dark')
  if (pref !== 'system') el.classList.add(pref)
  else if (matchMedia('(prefers-color-scheme: dark)').matches) el.classList.add('dark')
}

export default function SettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const root = useRouteLoaderData('root') as { theme?: ThemePref } | undefined
  const [theme, setTheme] = useState<ThemePref>(root?.theme ?? 'system')
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
              safe(() => {
                // biome-ignore lint/suspicious/noDocumentCookie: plain preference cookie, shared with every tab.
                document.cookie = `${THEME_COOKIE}=${t}; path=/; samesite=lax; max-age=31536000`
                // The bus pages' settings read it from localStorage.
                if (t === 'system') localStorage.removeItem(BUS_KEYS.THEME)
                else localStorage.setItem(BUS_KEYS.THEME, t)
              }, undefined)
              applyTheme(t)
            }}
            options={[
              { value: 'system', label: 'Auto' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
          />
        </div>
        <p className="text-sm text-sched-text">
          Saved stops come from the Ferry, Train and Bus tabs and stay on this device. Times refresh every 15
          seconds while the page is open.
        </p>
      </div>
    </BottomSheet>
  )
}
