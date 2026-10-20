import { describe, expect, it } from 'vitest'
import { fetchStationIndex, STOP_INDEX_PATH } from '../app/lib/stop-index.ts'

const respond = (status: number, body: unknown) => async () =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

describe('fetchStationIndex', () => {
  it('returns the index from a 200 with a stop list', async () => {
    const file = { generatedAt: 1, stops: [{ key: 'central', name: 'Central' }] }
    let url = ''
    const fetchFn = (async (u: string) => {
      url = u
      return respond(200, file)()
    }) as unknown as typeof fetch
    expect(await fetchStationIndex(undefined, fetchFn)).toEqual(file)
    expect(url).toBe(STOP_INDEX_PATH)
  })

  it("never returns the edge's 503 JSON body as data", async () => {
    const body = { error: 'static data unavailable', detail: 'passthrough', retryable: true }
    await expect(fetchStationIndex(undefined, respond(503, body) as unknown as typeof fetch)).rejects.toThrow(
      'HTTP 503',
    )
  })

  it.each([404, 500, 502])('throws on HTTP %i', async (status) => {
    await expect(
      fetchStationIndex(undefined, respond(status, { stops: [] }) as unknown as typeof fetch),
    ).rejects.toThrow(`HTTP ${status}`)
  })

  it('throws on a 200 without a stop list', async () => {
    for (const body of [
      { error: 'x' },
      null,
      { stops: 'nope' },
      { stops: {} },
      { stops: [null] },
      { stops: [{ key: 'central', name: 42 }] },
      { stops: [{ name: 'Central' }] },
    ])
      await expect(
        fetchStationIndex(undefined, respond(200, body) as unknown as typeof fetch),
      ).rejects.toThrow('No stop list')
  })

  it('throws on a body that is not JSON', async () => {
    await expect(
      fetchStationIndex(undefined, respond(200, '<html>') as unknown as typeof fetch),
    ).rejects.toThrow()
  })

  it('rejects when the network fails', async () => {
    const fetchFn = (async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch
    await expect(fetchStationIndex(undefined, fetchFn)).rejects.toThrow('Failed to fetch')
  })
})
