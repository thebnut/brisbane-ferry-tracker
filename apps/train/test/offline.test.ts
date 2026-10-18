import { gtfsToEpoch } from '@bft/core'
import { describe, expect, it } from 'vitest'
import { handleFixtureApi } from '../app/lib/fixtures.server.ts'
import { fetchRestOfDay, serviceDayEnd } from '../app/lib/offline.ts'

describe('offline full day', () => {
  it('service day ends at 03:00 Brisbane', () => {
    const noon = gtfsToEpoch('20261020', 12 * 3600) * 1000
    expect(serviceDayEnd(noon)).toBe(gtfsToEpoch('20261020', 27 * 3600))
    const late = gtfsToEpoch('20261020', 25 * 3600) * 1000 // 01:00 on the 21st
    expect(serviceDayEnd(late)).toBe(gtfsToEpoch('20261020', 27 * 3600))
  })
  it('pages through the rest of the day with `at` and keeps every train once', async () => {
    const now = gtfsToEpoch('20261020', 6 * 3600) * 1000
    const calls: string[] = []
    const fetcher = (path: string) => {
      calls.push(path)
      return handleFixtureApi(new URL(`http://x/__fixtures${path}`), now)
    }
    const day = await fetchRestOfDay(fetcher, { from: 'central', to: null }, now)
    expect(calls.length).toBeGreaterThan(1)
    expect(calls[1]).toContain('at=')
    const keys = day.departures.map((d) => `${d.tripInstance}:${d.stopSequence}`)
    expect(new Set(keys).size).toBe(keys.length)
    expect(day.departures.at(-1)?.schedDep).toBeLessThanOrEqual(serviceDayEnd(now))
    // Whole-day size for the busiest station, to compare with the ~300 KB network estimate.
    expect(JSON.stringify(day).length).toBeGreaterThan(10_000)
  })
})
