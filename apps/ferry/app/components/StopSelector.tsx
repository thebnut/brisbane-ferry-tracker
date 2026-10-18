/**
 * Stop selector (legacy StopSelectorModal): pick origin and a directly reachable destination, with
 * "Remember selection". Loaded lazily (Ark UI combobox) on first visit or from Settings.
 */
import { BottomSheet, PrimaryButton, SecondaryButton } from '@bft/ui'
import { StopSearch } from '@bft/ui/stop-search'
import { lazy, Suspense, useMemo, useState } from 'react'
import { readRemember } from '../lib/storage.ts'
import {
  choice,
  normalisePair,
  type StopPair,
  TERMINALS,
  terminalById,
  validDestinations,
} from '../lib/terminals.ts'

const MapView = lazy(() => import('@bft/ui/map'))

export interface StopSelectorProps {
  initial: StopPair
  onSave: (pair: StopPair, remember: boolean) => void
  onClose: () => void
}

export default function StopSelector({ initial, onSave, onClose }: StopSelectorProps) {
  const [origin, setOrigin] = useState(initial.outbound.id)
  const [destination, setDestination] = useState(initial.inbound.id)
  const [remember, setRemember] = useState(readRemember)
  const [mapFor, setMapFor] = useState<'origin' | 'destination' | null>(null)

  const origins = useMemo(() => TERMINALS.map((t) => ({ id: t.id, name: t.name })), [])
  const reachable = validDestinations(origin)
  const destinations = useMemo(
    () => TERMINALS.filter((t) => reachable.includes(t.id)).map((t) => ({ id: t.id, name: t.name })),
    [reachable],
  )
  const destOk = reachable.includes(destination)

  const changeOrigin = (id: string) => {
    setOrigin(id)
    const next = validDestinations(id)
    if (!next.includes(destination) && next[0]) setDestination(next[0])
  }

  // Map picker (legacy StopSelectorMap): every terminal for the origin, only reachable ones for the destination.
  const mapMarkers = (() => {
    if (!mapFor) return []
    const pool = mapFor === 'origin' ? TERMINALS : TERMINALS.filter((t) => reachable.includes(t.id))
    const current = mapFor === 'origin' ? origin : destination
    return pool.map((t) => ({
      id: t.id,
      lat: t.lat,
      lon: t.lng,
      tone: t.id === current ? ('selected' as const) : ('stop' as const),
      label: `Choose ${t.name} as ${mapFor === 'origin' ? 'origin' : 'destination'}`,
      onClick: () => {
        if (mapFor === 'origin') changeOrigin(t.id)
        else setDestination(t.id)
        setMapFor(null)
      },
    }))
  })()

  const mapToggle = (which: 'origin' | 'destination') => (
    <button
      type="button"
      aria-pressed={mapFor === which}
      onClick={() => setMapFor((m) => (m === which ? null : which))}
      className="self-start text-sm font-semibold text-aqua-text underline underline-offset-2"
    >
      {mapFor === which ? 'Hide map' : 'Pick on map'}
    </button>
  )

  const save = () => {
    const o = terminalById(origin)
    const d = terminalById(destination)
    if (!o || !d) return
    onSave(normalisePair({ outbound: choice(o), inbound: choice(d) }), remember)
  }

  return (
    <BottomSheet open onClose={onClose} title="Select ferry stops">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <StopSearch
          inline
          label="From"
          options={origins}
          value={origin}
          onChange={changeOrigin}
          placeholder="Origin terminal"
        />
        {mapToggle('origin')}
        <StopSearch
          inline
          label="To"
          options={destinations}
          value={destOk ? destination : null}
          onChange={setDestination}
          placeholder="Destination terminal"
        />
        {mapToggle('destination')}
        {mapFor ? (
          <Suspense fallback={<div className="h-64 rounded-card bg-map-ground" />}>
            <MapView
              markers={mapMarkers}
              label={`Map of ferry terminals: choose the ${mapFor}`}
              className="h-64 w-full overflow-hidden rounded-card bg-map-ground"
            />
          </Suspense>
        ) : null}
        {destinations.length === 0 ? (
          <p className="text-sm text-cancel-text">No direct ferries from this terminal.</p>
        ) : null}
        <label className="flex min-h-11 items-center gap-3 text-sm font-medium">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="size-5 accent-ferry-orange-dark"
          />
          Remember selection
        </label>
        <div className="flex gap-3">
          <SecondaryButton className="flex-1" onClick={onClose}>
            Cancel
          </SecondaryButton>
          <PrimaryButton type="submit" className="flex-1" disabled={!destOk}>
            Save
          </PrimaryButton>
        </div>
      </form>
    </BottomSheet>
  )
}
