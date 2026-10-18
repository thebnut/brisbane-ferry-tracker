// @vitest-environment jsdom
import type { DeparturesResponse } from '@bft/core/contract'
import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it } from 'vitest'
import { departuresOptions } from '../app/lib/queries.ts'
import { readOffline, writeOffline } from '../app/lib/storage.ts'

const NOW = Date.now()
const body = (generatedAt: number): DeparturesResponse => ({
  schemaVersion: 1,
  staticGeneration: 'g',
  serviceDates: ['20261019'],
  rtSourceTimestamp: Math.floor(generatedAt / 1000),
  rtState: 'live',
  generatedAt,
  mode: 'ferry',
  stop: { key: '317584', name: 'Bulimba', stopIds: ['317584'] },
  to: { key: '317590', name: 'Riverside' },
  departures: [],
})

beforeEach(() => localStorage.clear())

describe('a board never goes back to an older body (R6-B1, Codex review round 3)', () => {
  it('an answer older than the kept copy the board shows replaces neither the board nor the copy', async () => {
    const mode = { fixtures: false, rt: null }
    const fetcher = async () => Response.json(body(NOW - 20_000))
    const opts = departuresOptions(fetcher, mode, '317584', '317590', null, null)
    const client = new QueryClient()
    client.setQueryData(opts.queryKey, body(NOW - 60_000))
    writeOffline('317584', '317590', body(NOW - 10_000))
    const out = await opts.queryFn({
      signal: new AbortController().signal,
      client,
      queryKey: opts.queryKey,
      meta: undefined,
    })
    expect(out.generatedAt).toBe(NOW - 10_000)
    expect((out as { offline?: boolean }).offline).toBe(true)
    expect((readOffline('317584', '317590') as DeparturesResponse).generatedAt).toBe(NOW - 10_000)
  })
})
