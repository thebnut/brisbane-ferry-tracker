import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.ts'
import type { StaticStore } from '../src/data/static-store.ts'
import { ERROR_BODY_MAX_BYTES, errorLogFields } from '../src/error-log.ts'
import { createLogger } from '../src/log.ts'
import type { SnapshotClient } from '../src/snapshot-client.ts'

/** An app whose store has a generation for ferry but no index for it, logging into `lines`. */
function setup(generation: string | null = 'g9') {
  const lines: Array<Record<string, unknown>> = []
  const store = {
    currentGeneration: async () => generation,
    getIndex: async () => null,
  } as unknown as StaticStore
  const app = createApp({
    store,
    snapshots: {} as SnapshotClient,
    log: createLogger({}, (l) => lines.push(JSON.parse(l))),
    combinedFeeds: false,
    polledModes: ['ferry'],
  })
  const requestLine = () => lines.find((l) => l.msg === 'request') as Record<string, unknown>
  return { app, lines, requestLine }
}

/** A response whose body counts the bytes a reader pulled from it. */
function counted(status: number, body: string, headers: Record<string, string>) {
  const bytes = new TextEncoder().encode(body)
  const pulled = { n: 0 }
  let at = 0
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(ctl) {
        if (at >= bytes.byteLength) return ctl.close()
        const chunk = bytes.subarray(at, at + 512)
        at += chunk.byteLength
        pulled.n += chunk.byteLength
        ctl.enqueue(chunk)
      },
    },
    // Pull only on demand, so `pulled` counts what a reader actually read.
    { highWaterMark: 0 },
  )
  return { res: new Response(stream, { status, headers }), pulled, size: bytes.byteLength }
}

describe('request log: 5xx lines name their error', () => {
  it('a 503 static index missing logs its error code and the generation id', async () => {
    const s = setup('g9')
    const res = await s.app.request('/v1/ferry/stops/317584/departures')
    expect(res.status).toBe(503)
    expect(s.requestLine()).toMatchObject({ status: 503, error: 'static index missing', detail: 'g9' })
    // The client still gets the whole body.
    expect(await res.json()).toEqual({ error: 'static index missing', detail: 'g9' })
  })

  it('a 503 no static data for mode logs that code and the mode', async () => {
    const s = setup(null)
    await s.app.request('/v1/ferry/stops/317584/departures')
    expect(s.requestLine()).toMatchObject({ status: 503, error: 'no static data for mode', detail: 'ferry' })
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

  it('an unhandled error (500) logs internal error', async () => {
    const s = setup()
    s.app.get('/x/boom', () => {
      throw new Error('kaboom')
    })
    await s.app.request('/x/boom')
    expect(s.requestLine()).toMatchObject({ status: 500, error: 'internal error' })
  })

  it('a detail that is not an identifier is not logged; a long error code is capped', async () => {
    const s = setup()
    s.app.get('/x/free', (c) =>
      c.json({ error: 'e'.repeat(500), detail: 'some free text, maybe user input' }, 502),
    )
    await s.app.request('/x/free')
    const line = s.requestLine()
    expect((line.error as string).length).toBe(120)
    expect(line).not.toHaveProperty('detail')
  })
})

describe('errorLogFields reads only small JSON error bodies', () => {
  it('does not read a large 5xx body whole (stops just past the cap)', async () => {
    const big = JSON.stringify({ error: 'x', pad: 'y'.repeat(20_000) })
    const c = counted(500, big, { 'content-type': 'application/json' })
    expect(await errorLogFields(c.res)).toEqual({})
    // The cap plus at most two 512-byte chunks (the one that crossed it, and one the tee may read ahead).
    expect(c.pulled.n).toBeLessThanOrEqual(ERROR_BODY_MAX_BYTES + 1024)
    expect(c.pulled.n).toBeLessThan(c.size)
  })

  it('skips a body whose declared length is over the cap without reading it', async () => {
    const c = counted(500, JSON.stringify({ error: 'x' }), {
      'content-type': 'application/json',
      'content-length': String(ERROR_BODY_MAX_BYTES + 1),
    })
    expect(await errorLogFields(c.res)).toEqual({})
    expect(c.pulled.n).toBe(0)
  })

  it('does not read a non-JSON 5xx body, or any 2xx body', async () => {
    const html = counted(502, '<html>bad gateway</html>', { 'content-type': 'text/html' })
    expect(await errorLogFields(html.res)).toEqual({})
    expect(html.pulled.n).toBe(0)
    const ok = counted(200, JSON.stringify({ error: 'not really' }), { 'content-type': 'application/json' })
    expect(await errorLogFields(ok.res)).toEqual({})
    expect(ok.pulled.n).toBe(0)
  })

  it('a malformed JSON body logs nothing rather than throwing', async () => {
    const c = counted(503, '{"error":', { 'content-type': 'application/json' })
    expect(await errorLogFields(c.res)).toEqual({})
  })
})
