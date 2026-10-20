/**
 * /data reads (stop index, geo tiles): a non-OK answer, above all the edge's 503 JSON body when R2 is slow, must never
 * become data (a page reading `.stops` off `{ error }` would crash to the error boundary). It throws ApiError, which
 * the pages show as "Couldn't load" with a Try again; a geo tile's 404 alone means "no stops here".
 */
import { describe, expect, it } from 'vitest'
import { ApiError, type ApiFetcher } from '../app/lib/api.ts'
import { fetchGeoTile, fetchStopIndex } from '../app/lib/data-files.ts'

const EDGE_503 = { error: 'static data unavailable', detail: 'passthrough', retryable: true }

const serve =
  (status: number, body: unknown): ApiFetcher =>
  async () =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('/data reads', () => {
  it.each([503, 500, 502, 404])(
    'stop index: HTTP %i with a JSON body throws, never returns it',
    async (status) => {
      const fetcher = serve(status, EDGE_503)
      const error = await fetchStopIndex(fetcher, 'bus').catch((e: unknown) => e)
      expect(error).toBeInstanceOf(ApiError)
      expect(error).toMatchObject({ kind: 'http', status })
    },
  )

  it('stop index: a network failure is an ApiError (network)', async () => {
    const fetcher: ApiFetcher = async () => {
      throw new TypeError('Failed to fetch')
    }
    await expect(fetchStopIndex(fetcher, 'bus')).rejects.toMatchObject({ kind: 'network' })
  })

  it('stop index: a 200 is returned as is', async () => {
    const file = { generatedAt: 1, stops: [] }
    const fetcher = serve(200, file)
    expect(await fetchStopIndex(fetcher, 'bus')).toEqual(file)
  })

  it('geo tile: a 404 is an empty cell (null)', async () => {
    const fetcher = serve(404, { error: 'not found' })
    expect(await fetchGeoTile(fetcher, 'bus', 'r7hgd')).toBeNull()
  })

  it.each([503, 500])('geo tile: HTTP %i throws, never returns the body', async (status) => {
    const fetcher = serve(status, EDGE_503)
    await expect(fetchGeoTile(fetcher, 'bus', 'r7hgd')).rejects.toMatchObject({ kind: 'http', status })
  })

  it('a 200 without a stops list is a contract error, never data', async () => {
    for (const body of [{ error: 'x' }, { stops: {} }, null]) {
      const fetcher = serve(200, body)
      await expect(fetchStopIndex(fetcher, 'bus')).rejects.toMatchObject({ kind: 'contract' })
      await expect(fetchGeoTile(fetcher, 'bus', 'r7hgd')).rejects.toMatchObject({ kind: 'contract' })
    }
  })
})
