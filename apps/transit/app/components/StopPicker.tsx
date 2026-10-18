/** "Use a stop": search every ferry terminal, train station and bus stop; Around you then centres on the pick. */
import { ModePin } from '@bft/ui'
import { useQueries } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { fetchStopIndex } from '../lib/api.ts'
import { NEARBY_MODES, type NearbyMode } from '../lib/nearby.ts'
import { useApi } from '../lib/queries.ts'
import { matchStops, type PickStop } from '../lib/stop-pick.ts'

export type { PickStop }

const LABEL: Record<NearbyMode, string> = { ferry: 'Ferry', train: 'Train', bus: 'Bus' }

export default function StopPicker({
  onPick,
  onCancel,
}: {
  onPick: (s: PickStop) => void
  onCancel: () => void
}) {
  const { mode, fetcher } = useApi()
  const [q, setQ] = useState('')
  const { all, pending } = useQueries({
    queries: NEARBY_MODES.map((m) => ({
      queryKey: ['transit', 'stop-index', mode.fixtures, m],
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchStopIndex(fetcher, m, signal),
      staleTime: Number.POSITIVE_INFINITY,
    })),
    combine: (rs) => ({
      all: rs.flatMap((r, i) =>
        (r.data?.stops ?? []).map((s) => ({ ...s, mode: NEARBY_MODES[i] as NearbyMode })),
      ),
      pending: rs.some((r) => r.isPending),
    }),
  })
  const results = useMemo(() => matchStops(q, all), [q, all])
  return (
    <section aria-labelledby="pick-heading" className="flex flex-col gap-2.5">
      <label
        id="pick-heading"
        htmlFor="pick"
        className="text-sm font-semibold text-aqua-text dark:text-ferry-aqua-light"
      >
        Stop, station or terminal
      </label>
      <input
        id="pick"
        type="search"
        // biome-ignore lint/a11y/noAutofocus: the user just asked to type a stop.
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="e.g. Cultural Centre, Central, Bulimba, 10802"
        className="h-12 rounded-full border-2 border-ferry-orange/40 bg-white px-4 text-base outline-none focus:border-ferry-orange dark:bg-night-card"
      />
      {pending && q.length > 1 ? <p className="text-xs text-sched-text">Loading every stop…</p> : null}
      <ul className="flex flex-col gap-1.5">
        {results.map((s) => (
          <li key={`${s.mode}:${s.key}`}>
            <button
              type="button"
              onClick={() => onPick(s)}
              className="flex min-h-12 w-full items-center gap-2.5 rounded-card bg-white/90 px-3 py-2 text-left shadow-card dark:bg-night-card"
            >
              <ModePin mode={s.mode} />
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-semibold">{s.name}</span>
                <span className="text-xs text-sched-text">
                  {LABEL[s.mode]}
                  {s.code && s.mode === 'bus' ? ` · stop ${s.code}` : ''}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={onCancel} className="self-start text-sm font-semibold underline">
        Cancel
      </button>
    </section>
  )
}
