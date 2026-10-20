/**
 * The "Map" button beside a stop search (`@bft/ui/map-toggle`). It is on the search's first load, so it stays tiny:
 * the picker itself (`@bft/ui/stop-picker-map`) is lazy. Once a device has used the map for a search, the button is
 * highlighted on later visits ("remembered per device"), read after hydration only so the first paint never differs.
 */
import { useEffect, useState } from 'react'
import { cx } from './cx.ts'
import { Icon } from './icons.tsx'
import { readMapPref, writeMapPref } from './map-pref.ts'

export { writeMapPref }

export function MapToggle({
  open,
  onToggle,
  noun = 'stops',
  className,
}: {
  open: boolean
  onToggle: (open: boolean) => void
  /** "stops", "stations", "terminals", for the accessible name. */
  noun?: string
  className?: string
}) {
  const [remembered, setRemembered] = useState(false)
  useEffect(() => setRemembered(readMapPref()), [])
  const hot = open || remembered
  return (
    <button
      type="button"
      aria-pressed={open}
      aria-label={`Show ${noun} on a map`}
      data-map-toggle={remembered ? 'remembered' : ''}
      onClick={() => {
        writeMapPref(!open)
        setRemembered(!open)
        onToggle(!open)
      }}
      className={cx(
        'flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border-2 px-3.5 text-sm font-bold',
        hot
          ? 'border-ferry-orange bg-ferry-orange-aa text-white'
          : 'border-ferry-orange/30 bg-white text-aqua-text dark:bg-night-card dark:text-ferry-aqua-light',
        className,
      )}
    >
      <Icon name="map" size={18} />
      Map
    </button>
  )
}
