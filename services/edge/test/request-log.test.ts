import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.ts'
import type { StaticStore } from '../src/data/static-store.ts'
import { createLogger } from '../src/log.ts'
import type { SnapshotClient } from '../src/snapshot-client.ts'

/** An app whose store has `generation` for ferry but no index for it, logging into `lines`. */
function setup(generation: string | null = 'g9') {
  const lines: Array<Record<string, unknown>> = []
  const store = {
    currentGeneration: async () => generation,
    getIndex: async () => null,
  } as unknown as StaticStore
  const app = createApp({
    store,
    snapshots: { raw: async () => null } as unknown as SnapshotClient,
    log: createLogger({}, (l) => lines.push(JSON.parse(l))),
    combinedFeeds: false,
    polledModes: ['ferry'],
  })
  const requestLine = () => lines.find((l) => l.msg === 'request') as Record<string, unknown>
  return { app, lines, requestLine }
}

describe('request log: 5xx lines name their error', () => {
  it('a 503 static index missing logs its error code and the generation id', async () => {
    const s = setup('g9')
    const res = await s.app.request('/v1/ferry/stops/317584/departures')
    expect(res.status).toBe(503)
    expect(s.requestLine()).toMatchObject({ status: 503, error: 'static index missing', detail: 'g9' })
    // The client's body is unchanged.
    expect(await res.json()).toEqual({ error: 'static index missing', detail: 'g9' })
  })

  it('a 503 no static data for mode logs that code and the mode (departures and trips)', async () => {
    for (const path of ['/v1/ferry/stops/317584/departures', '/v1/ferry/trips/T1@20261020']) {
      const s = setup(null)
      const res = await s.app.request(path)
      expect(res.status).toBe(503)
      expect(s.requestLine()).toMatchObject({
        status: 503,
        error: 'no static data for mode',
        detail: 'ferry',
      })
    }
  })

  it('the legacy proxy 503 logs its error, with no detail', async () => {
    const s = setup()
    const res = await s.app.request('/api/gtfs-proxy?endpoint=TripUpdates')
    expect(res.status).toBe(503)
    expect(s.requestLine()).toMatchObject({ status: 503, error: 'Realtime feed not available yet' })
    expect(s.requestLine()).not.toHaveProperty('detail')
  })

  it('an unhandled error (500) logs internal error', async () => {
    const s = setup()
    s.app.get('/x/boom', () => {
      throw new Error('kaboom')
    })
    await s.app.request('/x/boom')
    expect(s.requestLine()).toMatchObject({ status: 500, error: 'internal error' })
  })

  it('a 200 or a 4xx line carries no error field', async () => {
    const s = setup()
    s.app.get('/x/ok', (c) => c.json({ ok: true }))
    await s.app.request('/x/ok')
    expect(s.requestLine().status).toBe(200)
    expect(s.requestLine()).not.toHaveProperty('error')
    const t = setup()
    await t.app.request('/v1/nope/stops/1/departures')
    expect(t.requestLine().status).toBe(400)
    expect(t.requestLine()).not.toHaveProperty('error')
  })

  it('a 5xx body is never read: a stream that never ends neither delays the response nor the log line', async () => {
    const s = setup()
    const pulled = { n: 0 }
    s.app.get(
      '/x/stream',
      () =>
        new Response(
          new ReadableStream<Uint8Array>(
            {
              pull() {
                pulled.n++
                // Never enqueues or closes: a reader would wait forever.
                return new Promise(() => {})
              },
            },
            { highWaterMark: 0 },
          ),
          { status: 502, headers: { 'content-type': 'application/json' } },
        ),
    )
    const res = await s.app.request('/x/stream')
    expect(res.status).toBe(502)
    expect(s.requestLine()).toMatchObject({ status: 502 })
    expect(s.requestLine()).not.toHaveProperty('error')
    expect(pulled.n).toBe(0)
  })
})
