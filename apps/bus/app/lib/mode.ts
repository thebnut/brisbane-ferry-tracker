/** Data mode (live API vs fixtures) from the root loader, and the browser fetcher for it. */
import { useRouteLoaderData } from 'react-router'
import type { ApiFetcher } from './api.ts'
import { type DataMode, useFetcher } from './queries.ts'

const LIVE: DataMode = { fixtures: false, rt: null }

export function useDataMode(): DataMode {
  const root = useRouteLoaderData('root') as { mode?: DataMode } | undefined
  return root?.mode ?? LIVE
}

export function useApi(): { mode: DataMode; fetcher: ApiFetcher } {
  const mode = useDataMode()
  return { mode, fetcher: useFetcher(mode) }
}
