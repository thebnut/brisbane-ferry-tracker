/**
 * "Find a station" at the top of the Train tab's home inside BrisbaneTransit (THE-118 PR 3: Stations left the section
 * bar). The /stations search's combobox and fuzzy match over the stations bundled with the app (network.ts); a pick
 * opens that station's board. Its own chunk, loaded after hydration (Ark UI), so the home's first load is unchanged.
 */
import type { StopOption } from '@bft/ui/stop-search'
import { StopSearch } from '@bft/ui/stop-search'
import { useNavigate } from 'react-router'
import { STATIONS, stationHref } from '../lib/network.ts'
import { searchStations } from '../lib/search.ts'

const OPTIONS: StopOption[] = STATIONS.map((s) => ({ id: s.key, name: s.name })).sort((a, b) =>
  a.name.localeCompare(b.name),
)

const fuzzy = (query: string, options: StopOption[]) =>
  searchStations(
    query,
    options.map((o) => ({ ...o, key: o.id })),
    20,
  )

export default function StationSearch() {
  const navigate = useNavigate()
  return (
    <StopSearch
      label="Find a station"
      placeholder="Station name"
      options={OPTIONS}
      value={null}
      filter={fuzzy}
      onChange={(k) => navigate(stationHref(k))}
    />
  )
}
