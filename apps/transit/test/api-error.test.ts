/**
 * A 404's API error code reaches the card (Codex r1): only "unknown stop" is a stop the timetable no longer has
 * (@bft/ui isMissingStop); any other 404 or error is an ordinary failure.
 */
import { isMissingStop } from '@bft/ui'
import { describe, expect, it } from 'vitest'
import { type ApiFetcher, getJson } from '../app/lib/api.ts'

const answer =
  (status: number, body: string): ApiFetcher =>
  async () =>
    new Response(body, { status, headers: { 'content-type': 'application/json' } })

const failure = (fetcher: ApiFetcher) =>
  getJson(fetcher, '/v1/ferry/stops/317584/departures').then(
    () => null,
    (error: unknown) => error,
  )

describe('getJson errors', () => {
  it('a 404 "unknown stop" is a missing stop', async () => {
    const e = await failure(answer(404, '{"error":"unknown stop","detail":"317584"}'))
    expect(e).toMatchObject({ kind: 'http', status: 404 })
    expect(isMissingStop(e)).toBe(true)
  })

  it('any other 404, or a 503, is not', async () => {
    for (const [status, body] of [
      [404, '{"error":"not found"}'],
      [404, 'Not found'],
      [503, '{"error":"unknown stop"}'],
    ] as const) {
      const e = await failure(answer(status, body))
      expect(e).toMatchObject({ kind: 'http', status })
      expect(isMissingStop(e)).toBe(false)
    }
  })
})
