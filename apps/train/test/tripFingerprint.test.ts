import { gtfsToEpoch, TripResponse } from '@bft/core'
import { describe, expect, it } from 'vitest'
import { handleFixtureApi } from '../app/lib/fixtures.server.ts'
import { tripFingerprint } from '../app/lib/tripFingerprint.ts'

const AM8 = gtfsToEpoch('20261020', 8 * 3600) * 1000

describe('WebSocket push fingerprint', () => {
  it('ignores envelope timestamps, changes when the train moves', async () => {
    const d = (await (
      await handleFixtureApi(new URL('http://x/__fixtures/v1/train/stops/central/departures?limit=20'), AM8)
    ).json()) as { departures: Array<{ tripInstance: string; gps: boolean }> }
    const key = d.departures.find((x) => x.gps)?.tripInstance ?? ''
    const at = async (ms: number) =>
      TripResponse.parse(
        await (
          await handleFixtureApi(new URL(`http://x/__fixtures/v1/train/trips/${encodeURIComponent(key)}`), ms)
        ).json(),
      )
    const a = await at(AM8)
    const sameCycle = await at(AM8 + 3000)
    expect(sameCycle.generatedAt).not.toBe(a.generatedAt)
    expect(tripFingerprint(sameCycle)).toBe(tripFingerprint(a))
    expect(tripFingerprint(await at(AM8 + 60_000))).not.toBe(tripFingerprint(a))
  })
})
