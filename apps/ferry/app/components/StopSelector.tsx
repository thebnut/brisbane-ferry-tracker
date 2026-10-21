/**
 * Stop selector (legacy StopSelectorModal): pick origin and a directly reachable destination, with
 * "Remember selection". Loaded lazily (Ark UI combobox) on first visit or from Settings. Each field has a Map button
 * that opens the map stop picker (P3): tap a terminal for its next ferries, then "Use as From/To" fills the field and
 * Save stores the pair as before (a ferry favourite is a pair, not a terminal). "Set up My Transit stops" (THE-113)
 * swaps the sheet for the onboarding map picker with the saved pair in its tray (OnboardingRerun.tsx, lazy).
 */
import type { DeparturesResponse } from '@bft/core/contract'
import { BottomSheet, PrimaryButton, SecondaryButton } from '@bft/ui'
import { MapToggle } from '@bft/ui/map-toggle'
import { RerunEntry, RerunHost } from '@bft/ui/onboarding-rerun'
import type { PickerStop } from '@bft/ui/stop-picker'
import { StopSearch } from '@bft/ui/stop-search'
import { lazy, Suspense, useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router'
import type { ApiFetcher } from '../lib/api.ts'
import { savePair } from '../lib/save-pair.ts'
import { readRemember } from '../lib/storage.ts'
import {
  choice,
  normalisePair,
  type StopPair,
  TERMINALS,
  terminalById,
  terminalHref,
  validDestinations,
} from '../lib/terminals.ts'

// If the map's chunk can't load (offline), the selector says so and the fields still work.
const StopPickerMap = lazy(() =>
  import('@bft/ui/stop-picker-map').catch(() => ({
    default: () => <p className="text-sm text-sched-text">Map unavailable right now.</p>,
  })),
)

// Inside BrisbaneTransit this resolves to transit's picker, with every mode (modes.config.ts).
const OnboardingRerun = lazy(() => import('./OnboardingRerun.tsx'))

export interface StopSelectorProps {
  initial: StopPair
  /** For the map card's next departures. */
  fetcher: ApiFetcher
  /** After the pair is saved on this device. */
  onSave: (pair: StopPair) => void
  onClose: () => void
}

export default function StopSelector({ initial, fetcher, onSave, onClose }: StopSelectorProps) {
  const [origin, setOrigin] = useState(initial.outbound.id)
  const [destination, setDestination] = useState(initial.inbound.id)
  const [remember, setRemember] = useState(readRemember)
  const [mapFor, setMapFor] = useState<'origin' | 'destination' | null>(null)
  const [rerun, setRerun] = useState(false)

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

  // Map picker: every terminal for the origin, only reachable ones for the destination.
  const mapStops = useMemo<PickerStop[]>(() => {
    if (!mapFor) return []
    const pool = mapFor === 'origin' ? TERMINALS : TERMINALS.filter((t) => reachable.includes(t.id))
    return pool.map((t) => ({ id: t.id, name: t.name, lat: t.lat, lon: t.lng, detail: t.routes.join(' · ') }))
  }, [mapFor, reachable])
  const loadDepartures = useCallback(
    async (s: PickerStop, signal: AbortSignal) => {
      const [res, { toCardDepartures }] = await Promise.all([
        // The path is spelled here, not taken from api.ts: importing api.ts into this lazy module splits it into its own
        // chunk on the boards' first load. The card claims nothing live, so a plain fetch is enough.
        fetcher(`/v1/ferry/stops/${encodeURIComponent(s.id)}/departures?limit=3`, { signal }).then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
          return r.json() as Promise<DeparturesResponse>
        }),
        import('@bft/ui/stop-picker-map'),
      ])
      return toCardDepartures(res.departures)
    },
    [fetcher],
  )

  const mapToggle = (which: 'origin' | 'destination') => (
    <MapToggle
      open={mapFor === which}
      onToggle={(open) => setMapFor(open ? which : null)}
      noun={which === 'origin' ? 'origin terminals' : 'destination terminals'}
      className="self-start"
    />
  )

  const save = () => {
    const o = terminalById(origin)
    const d = terminalById(destination)
    if (!o || !d) return
    const pair = normalisePair({ outbound: choice(o), inbound: choice(d) })
    savePair(pair, remember)
    onSave(pair)
  }

  if (rerun) return <RerunHost onClose={onClose}>{(close) => <OnboardingRerun onClose={close} />}</RerunHost>
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
          <Suspense fallback={<div className="h-[60dvh] rounded-card bg-map-ground" />}>
            <StopPickerMap
              key={mapFor}
              title={mapFor === 'origin' ? 'Choose where from' : 'Choose where to'}
              noun="terminal"
              shape="circle"
              stops={mapStops}
              zoom={12}
              loadDepartures={loadDepartures}
              renderOpen={(s, className) => {
                const t = terminalById(s.id)
                return t ? (
                  <Link to={terminalHref(t.slug)} className={className}>
                    Open
                  </Link>
                ) : null
              }}
              save={{
                label: () => (mapFor === 'origin' ? 'Use as From' : 'Use as To'),
                onClick: (s) => {
                  if (mapFor === 'origin') changeOrigin(s.id)
                  else setDestination(s.id)
                  setMapFor(null)
                },
              }}
              onClose={() => setMapFor(null)}
              // Inside the selector sheet (a modal dialog), not a second full-screen layer.
              className="flex h-[60dvh] flex-col overflow-hidden rounded-card border border-ferry-orange/20 bg-white dark:bg-night-card"
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
      <div className="mt-5 border-t border-ferry-orange/15 pt-4">
        <RerunEntry onOpen={() => setRerun(true)} />
      </div>
    </BottomSheet>
  )
}
